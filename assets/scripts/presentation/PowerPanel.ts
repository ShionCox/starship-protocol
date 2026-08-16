import {
  _decorator,
  Component,
  error,
  Label,
  ProgressBar,
  Prefab,
  instantiate,
  Node,
} from 'cc';

import {
  type EnergyAllocation,
  type EnergyCommand,
} from '../game-core/EnergyModel';
import { PowerRoomRow } from './PowerRoomRow';

const { ccclass, menu, property } = _decorator;

export interface PowerPanelRoom {
  readonly roomId: string;
  readonly displayName: string;
  readonly minPower: number;
  readonly maxPower: number;
}

export interface PowerPanelState {
  readonly shipId: string;
  readonly availablePower: number;
  readonly allocatedPower: number;
  readonly allocations: readonly EnergyAllocation[];
}

export interface PowerPanelCommandResult {
  readonly ok: boolean;
  readonly message: string;
  readonly state: PowerPanelState;
}

export type PowerCommandHandler = (command: EnergyCommand) => Promise<PowerPanelCommandResult>;

/** R1 能源面板；只负责显示状态和发送 Command，不持有能源规则或存档。 */
@ccclass('PowerPanel')
@menu('星舰协议/界面/能源面板')
export class PowerPanel extends Component {
  @property({ type: Label, displayName: '能源汇总', tooltip: '显示当前已分配能源和总可用能源。', group: '显示' })
  public summaryLabel: Label | null = null;

  @property({ type: ProgressBar, displayName: '能源进度条', tooltip: '显示已分配能源占总可用能源的比例。', group: '显示' })
  public progressBar: ProgressBar | null = null;

  @property({ type: Label, displayName: '状态提示', tooltip: '显示能源分配成功、失败和存档状态。', group: '显示' })
  public statusLabel: Label | null = null;

  @property({ type: [PowerRoomRow], displayName: '能源房间行', tooltip: '按顺序引用面板中的能源房间行预制体实例。', group: '房间' })
  public roomRows: PowerRoomRow[] = [];

  @property({ type: Prefab, displayName: '能源行模板', tooltip: '玩家新建耗能房间时实例化的 PowerRoomRow Prefab。', group: '房间' })
  public roomRowTemplate: Prefab | null = null;

  @property({ type: Node, displayName: '能源行容器', tooltip: '持久保存的动态能源行父节点。', group: '房间' })
  public roomRowContainer: Node | null = null;

  private dispatch: PowerCommandHandler | null = null;

  protected onEnable(): void {
    if (this.summaryLabel === null || this.progressBar === null || this.statusLabel === null || this.roomRowContainer === null || this.roomRowTemplate === null) {
      error('能源面板 Prefab 缺少持久引用，运行时不会重建面板结构。');
    }
  }

  public bind(
    shipId: string,
    rooms: readonly PowerPanelRoom[],
    state: PowerPanelState,
    dispatch: PowerCommandHandler,
  ): void {
    if (shipId.trim() === '' || state.shipId !== shipId) {
      error('[UI] 能源面板绑定的飞船实例不一致');
      return;
    }
    this.dispatch = dispatch;
    this.synchronizeRows(rooms);
    this.roomRows = this.getAttachedRoomRows();
    const roomsById = new Map(rooms.map((room) => [room.roomId, room]));
    const missingRows = rooms.filter((room) => !this.roomRows.some((row) => row.roomInstanceId === room.roomId));
    if (missingRows.length > 0) {
      const message = `能源面板缺少持久房间行：${missingRows.map((room) => room.displayName).join('、')}`;
      error(`[UI] ${message}`);
      if (this.statusLabel !== null) this.statusLabel.string = message;
      return;
    }
    for (const row of this.roomRows) {
      const room = roomsById.get(row.roomInstanceId);
      if (room === undefined) continue;
      row.bind(room, this.getPower(state, room.roomId), this.handleCommand);
    }
    this.refresh(state);
  }

  public refresh(state: PowerPanelState): void {
    const available = state.availablePower;
    const allocated = state.allocatedPower;
    if (this.summaryLabel !== null) this.summaryLabel.string = `能源：${allocated} / ${available}`;
    if (this.progressBar !== null) this.progressBar.progress = available <= 0 ? 0 : Math.min(1, allocated / available);
    const powers = new Map(state.allocations.map((allocation) => [allocation.roomId, allocation.power]));
    for (const row of this.roomRows) {
      const power = powers.get(row.roomInstanceId);
      if (power !== undefined) row.refreshPower(power);
    }
  }

  private handleCommand = async (command: EnergyCommand): Promise<void> => {
    if (this.dispatch === null) return;
    const result = await this.dispatch(command);
    this.refresh(result.state);
    if (this.statusLabel !== null) this.statusLabel.string = result.message;
  };

  private getPower(state: PowerPanelState, roomId: string): number {
    return state.allocations.find((allocation) => allocation.roomId === roomId)?.power ?? 0;
  }

  private getAttachedRoomRows(): PowerRoomRow[] {
    return this.node.getComponentsInChildren(PowerRoomRow).filter((row) => row.node !== null);
  }

  private synchronizeRows(rooms: readonly PowerPanelRoom[]): void {
    if (this.roomRowContainer === null) return;
    const wanted = new Set(rooms.map((room) => room.roomId));
    const existing = new Map(this.getAttachedRoomRows().map((row) => [row.roomInstanceId, row]));
    for (const room of rooms) {
      if (existing.has(room.roomId)) continue;
      if (this.roomRowTemplate === null) {
        error(`[UI] 能源面板缺少能源行模板，无法显示：${room.displayName}`);
        continue;
      }
      const node = instantiate(this.roomRowTemplate);
      node.name = `能源行-${room.roomId}`;
      this.roomRowContainer.addChild(node);
      const row = node.getComponent(PowerRoomRow);
      if (row === null) {
        node.destroy();
        error('[UI] PowerRoomRow Prefab 缺少 PowerRoomRow 组件');
        continue;
      }
      row.roomInstanceId = room.roomId;
    }
    for (const row of existing.values()) {
      if (!wanted.has(row.roomInstanceId)) row.node.destroy();
    }
  }

}
