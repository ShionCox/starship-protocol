import {
  _decorator,
  Color,
  Component,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Node,
  ProgressBar,
  UITransform,
  VerticalTextAlignment,
  Widget,
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
  readonly availablePower: number;
  readonly allocatedPower: number;
  readonly allocations: readonly EnergyAllocation[];
}

export interface PowerPanelCommandResult {
  readonly ok: boolean;
  readonly message: string;
  readonly state: PowerPanelState;
}

export type PowerCommandHandler = (command: EnergyCommand) => PowerPanelCommandResult;

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

  /**
   * 当旧 PrototypeScene 尚未保存能源节点时创建 Web 原型兜底面板。
   * Creator 场景中的持久 PowerPanel 优先使用；该方法不会创建 GameCore 或存档状态。
   */
  public static createRuntimeFallback(parent: Node): PowerPanel {
    const node = new Node('能源面板');
    parent.addChild(node);
    node.addComponent(UITransform);
    const panel = node.addComponent(PowerPanel);
    panel.ensureAuthoringStructure();
    return panel;
  }

  /** 供创作面板调用：创建可直接保存到场景的 HUD 内容与两条能源房间行。 */
  public ensureAuthoringStructure(): boolean {
    this.synchronizeUiRootSize();
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
    transform.setContentSize(320, 220);
    transform.anchorPoint.set(0.5, 0.5);
    const widget = this.getComponent(Widget) ?? this.addComponent(Widget);
    widget.isAlignTop = true;
    widget.isAlignRight = true;
    widget.top = 16;
    widget.right = 16;

    this.summaryLabel = ensurePanelLabel(this.node, '能源汇总', '能源：0 / 10', 0, 82, 18);
    const progressNode = this.node.getChildByName('能源进度条') ?? new Node('能源进度条');
    if (progressNode.parent === null) this.node.addChild(progressNode);
    progressNode.setPosition(0, 51, 0);
    const progressTransform = progressNode.getComponent(UITransform) ?? progressNode.addComponent(UITransform);
    progressTransform.setContentSize(288, 18);
    progressNode.getComponent(Graphics) ?? progressNode.addComponent(Graphics);
    this.progressBar = progressNode.getComponent(ProgressBar) ?? progressNode.addComponent(ProgressBar);
    this.statusLabel = ensurePanelLabel(this.node, '状态提示', '能源状态已就绪', 0, -87, 12);

    const laser = PowerRoomRow.ensureAuthoringStructure(this.node, 'room-laser-1', '激光室');
    const shield = PowerRoomRow.ensureAuthoringStructure(this.node, 'room-shield-1', '护盾室');
    laser.node.setPosition(0, 12, 0);
    shield.node.setPosition(0, -31, 0);
    this.roomRows = [laser, shield];
    this.drawChrome();
    return true;
  }

  protected onEnable(): void {
    this.drawChrome();
  }

  /** 为未配置的耗能房间生成运行时行；持久行优先保留。 */
  public ensureRuntimeRows(rooms: readonly PowerPanelRoom[]): void {
    // Prefab 实例中的跨资源组件引用在 Web 构建反序列化后可能失效；
    // 当前场景树才是持久行的权威来源，不能继续使用已销毁组件对象。
    const rows = this.getAttachedRoomRows();
    const existing = new Map(rows.map((row) => [row.roomInstanceId, row]));
    for (const room of rooms) {
      if (existing.has(room.roomId)) continue;
      const row = PowerRoomRow.createRuntime(this.node, room);
      rows.push(row);
    }
    const orderedRoomIds = rooms.map((room) => room.roomId).sort((left, right) => left.localeCompare(right));
    for (let index = 0; index < orderedRoomIds.length; index += 1) {
      rows.find((row) => row.roomInstanceId === orderedRoomIds[index])?.node.setPosition(0, 12 - index * 43, 0);
    }
    this.roomRows = rows;
  }

  public bind(
    rooms: readonly PowerPanelRoom[],
    state: PowerPanelState,
    dispatch: PowerCommandHandler,
  ): void {
    this.dispatch = dispatch;
    this.roomRows = this.getAttachedRoomRows();
    const roomsById = new Map(rooms.map((room) => [room.roomId, room]));
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
    this.drawChrome();
    const powers = new Map(state.allocations.map((allocation) => [allocation.roomId, allocation.power]));
    for (const row of this.roomRows) {
      const power = powers.get(row.roomInstanceId);
      if (power !== undefined) row.refreshPower(power);
    }
  }

  private handleCommand = (command: EnergyCommand): void => {
    if (this.dispatch === null) return;
    const result = this.dispatch(command);
    this.refresh(result.state);
    if (this.statusLabel !== null) this.statusLabel.string = result.message;
  };

  private getPower(state: PowerPanelState, roomId: string): number {
    return state.allocations.find((allocation) => allocation.roomId === roomId)?.power ?? 0;
  }

  private getAttachedRoomRows(): PowerRoomRow[] {
    return this.node.getComponentsInChildren(PowerRoomRow).filter((row) => row.node !== null);
  }

  private synchronizeUiRootSize(): void {
    const canvasTransform = this.node.scene?.getComponentInChildren(UITransform) ?? null;
    const canvasSize = canvasTransform?.contentSize;
    if (canvasSize === undefined) return;
    let cursor = this.node.parent;
    for (let depth = 0; cursor !== null && depth < 2; depth += 1) {
      const transform = cursor.getComponent(UITransform);
      if (transform !== null) {
        transform.setContentSize(canvasSize);
        transform.anchorPoint.set(0.5, 0.5);
      }
      cursor = cursor.parent;
    }
  }

  private drawChrome(): void {
    const panelGraphics = this.getComponent(Graphics) ?? this.addComponent(Graphics);
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

function ensurePanelLabel(parent: Node, name: string, text: string, x: number, y: number, fontSize: number): Label {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.setPosition(x, y, 0);
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(288, 28);
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = 24;
  label.horizontalAlign = HorizontalTextAlignment.CENTER;
  label.verticalAlign = VerticalTextAlignment.CENTER;
  label.color = new Color(230, 240, 248, 255);
  return label;
}
