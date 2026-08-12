import {
  _decorator,
  Color,
  Component,
  error,
  Graphics,
  Label,
  Layers,
  ProgressBar,
  Node,
  UITransform,
  Widget,
  HorizontalTextAlignment,
  VerticalTextAlignment,
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

  private dispatch: PowerCommandHandler | null = null;

  /** 仅供创作插件补齐可持久保存的面板节点；能源行随后由同一 PowerRoomRow Prefab 实例化。 */
  public ensureAuthoringPrefabStructure(): boolean {
    this.node.layer = Layers.Enum.UI_2D;
    const existingTransform = this.getComponent(UITransform);
    if (existingTransform === null) this.addComponent(UITransform).setContentSize(320, 220);
    const existingWidget = this.getComponent(Widget);
    if (existingWidget === null) {
      const widget = this.addComponent(Widget);
      widget.isAlignTop = true;
      widget.isAlignRight = true;
      widget.top = 16;
      widget.right = 16;
    }
    this.getComponent(Graphics) ?? this.addComponent(Graphics);
    this.summaryLabel = ensurePanelLabel(this.node, '能源汇总', '能源：0 / 10', 82, 18);
    const existingProgress = this.node.getChildByName('能源进度条');
    const progressNode = existingProgress ?? new Node('能源进度条');
    if (existingProgress === null) {
      this.node.addChild(progressNode);
      progressNode.setPosition(0, 51, 0);
      progressNode.addComponent(UITransform).setContentSize(288, 18);
    }
    progressNode.layer = Layers.Enum.UI_2D;
    progressNode.getComponent(Graphics) ?? progressNode.addComponent(Graphics);
    this.progressBar = progressNode.getComponent(ProgressBar) ?? progressNode.addComponent(ProgressBar);
    this.statusLabel = ensurePanelLabel(this.node, '状态提示', '能源状态已就绪', -87, 12);
    if (existingTransform === null) this.drawChrome();
    return true;
  }

  /** Prefab 行替换完成后刷新序列化白名单引用。 */
  public refreshAuthoringReferences(): boolean {
    this.roomRows = this.getAttachedRoomRows();
    return this.roomRows.length > 0;
  }

  protected onEnable(): void {
    // 面板外观由 Creator 中持久化的 Graphics 参数决定，运行时只刷新动态数值。
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

  private drawChrome(): void {
    const panelGraphics = this.getComponent(Graphics);
    if (panelGraphics === null) {
      error('[UI] 请在能源面板 Prefab 根节点持久挂载图形组件');
      return;
    }
    panelGraphics.clear();
    panelGraphics.fillColor = new Color(7, 22, 35, 238);
    panelGraphics.roundRect(-160, -110, 320, 220, 10);
    panelGraphics.fill();
    panelGraphics.lineWidth = 2;
    panelGraphics.strokeColor = new Color(63, 166, 200, 255);
    panelGraphics.roundRect(-160, -110, 320, 220, 10);
    panelGraphics.stroke();

    const progressGraphics = this.progressBar?.getComponent(Graphics);
    const progressTransform = this.progressBar?.getComponent(UITransform);
    if (progressGraphics === null || progressGraphics === undefined || progressTransform === null || progressTransform === undefined) return;
    const { width, height } = progressTransform.contentSize;
    const progress = Math.min(1, Math.max(0, this.progressBar?.progress ?? 0));
    progressGraphics.clear();
    progressGraphics.fillColor = new Color(25, 47, 61, 255);
    progressGraphics.roundRect(-width / 2, -height / 2, width, height, 4);
    progressGraphics.fill();
    if (progress > 0) {
      progressGraphics.fillColor = new Color(52, 197, 224, 255);
      progressGraphics.roundRect(-width / 2, -height / 2, width * progress, height, 4);
      progressGraphics.fill();
    }
  }
}

function ensurePanelLabel(parent: Node, name: string, text: string, y: number, fontSize: number): Label {
  const existing = parent.getChildByName(name);
  const node = existing ?? new Node(name);
  if (existing === null) {
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(288, 28);
  }
  node.layer = Layers.Enum.UI_2D;
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  if (existing === null) {
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = 24;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.color = new Color(230, 240, 248, 255);
  }
  return label;
}
