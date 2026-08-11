import {
  _decorator,
  Button,
  Color,
  Component,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Node,
  UITransform,
  VerticalTextAlignment,
} from 'cc';

import type { EnergyCommand } from '../game-core/EnergyModel';
import type { PowerPanelRoom } from './PowerPanel';

const { ccclass, menu, property } = _decorator;

/** 单个耗能房间的可见能源控制行；规则仍由 Bootstrap 注入的 Command Handler 执行。 */
@ccclass('PowerRoomRow')
@menu('星舰协议/界面/能源房间行')
export class PowerRoomRow extends Component {
  @property({ displayName: '房间实例标识', tooltip: '必须与房间视图组件的稳定实例标识一致。', group: '房间' })
  public roomInstanceId = 'room-laser-1';

  @property({ type: Label, displayName: '房间名称', tooltip: '显示对应房间定义中的中文名称。', group: '显示' })
  public roomNameLabel: Label | null = null;

  @property({ type: Label, displayName: '当前能源', tooltip: '显示该房间当前分配的能源和最高能源。', group: '显示' })
  public powerLabel: Label | null = null;

  @property({ type: Button, displayName: '减少按钮', tooltip: '降低一格能源；降到最低运行能源时直接断电。', group: '操作' })
  public decreaseButton: Button | null = null;

  @property({ type: Button, displayName: '增加按钮', tooltip: '从断电状态开启到最低运行能源，之后每次增加一格。', group: '操作' })
  public increaseButton: Button | null = null;

  @property({ type: Button, displayName: '断电按钮', tooltip: '把该房间的能源分配重置为零。', group: '操作' })
  public resetButton: Button | null = null;

  private room: PowerPanelRoom | null = null;
  private power = 0;
  private dispatch: ((command: EnergyCommand) => void) | null = null;

  /**
   * Web 原型缺少持久化行节点时的最小运行时兜底；正式场景仍应由 Creator 保存 Prefab 实例。
   * 兜底只创建 Cocos UI 表现，不把任何能源规则放进 View。
   */
  public static createRuntime(parent: Node, room: PowerPanelRoom): PowerRoomRow {
    return PowerRoomRow.ensureAuthoringStructure(parent, room.roomId, room.displayName);
  }

  /** 创建或复用可由 Creator 保存的能源行结构；规则数值仍由运行时 bind 注入。 */
  public static ensureAuthoringStructure(parent: Node, roomInstanceId: string, displayName: string): PowerRoomRow {
    const existing = parent.children
      .map((child) => child.getComponent(PowerRoomRow))
      .find((row) => row?.roomInstanceId === roomInstanceId);
    const rowNode = existing?.node ?? new Node(`能源行-${displayName}`);
    if (rowNode.parent === null) parent.addChild(rowNode);
    const rowTransform = rowNode.getComponent(UITransform) ?? rowNode.addComponent(UITransform);
    rowTransform.setContentSize(288, 38);

    const row = existing ?? rowNode.addComponent(PowerRoomRow);
    row.roomInstanceId = roomInstanceId;
    row.roomNameLabel = ensureLabel(rowNode, '房间名称', displayName, -92, 0, 14, 112);
    row.powerLabel = ensureLabel(rowNode, '当前能源', '0 / 6', 8, 0, 13, 72);
    row.decreaseButton = ensureButton(rowNode, '减少按钮', '−', 76, 0);
    row.increaseButton = ensureButton(rowNode, '增加按钮', '+', 106, 0);
    row.resetButton = ensureButton(rowNode, '断电按钮', '断电', 148, 0, 48);
    row.registerEvents();
    return row;
  }

  /** 供创作插件把当前 Prefab 根节点补齐为可复用能源行模板。 */
  public ensureAuthoringPrefabStructure(roomInstanceId: string, displayName: string): boolean {
    this.roomInstanceId = roomInstanceId;
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
    transform.setContentSize(288, 38);
    this.roomNameLabel = ensureLabel(this.node, '房间名称', displayName, -92, 0, 14, 112);
    this.powerLabel = ensureLabel(this.node, '当前能源', '0 / 6', 8, 0, 13, 72);
    this.decreaseButton = ensureButton(this.node, '减少按钮', '−', 76, 0);
    this.increaseButton = ensureButton(this.node, '增加按钮', '+', 106, 0);
    this.resetButton = ensureButton(this.node, '断电按钮', '断电', 148, 0, 48);
    this.registerEvents();
    return true;
  }

  /**
   * Creator 的 create-node.position 使用场景坐标；能源行是面板内布局，必须在实例创建后写局部坐标。
   * 该公开编辑器方法让插件通过 Scene API 调用组件完成换算，避免直接修改场景序列化文本。
   */
  public applyAuthoringLocalPosition(x: number, y: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    this.node.setPosition(x, y, 0);
    return true;
  }

  protected onEnable(): void {
    this.refreshSerializedReferences();
    this.registerEvents();
  }

  protected onDisable(): void {
    this.unregisterEvents();
  }

  private registerEvents(): void {
    this.unregisterEvents();
    this.drawButtons();
    this.decreaseButton?.node.on(Node.EventType.TOUCH_END, this.handleDecrease, this);
    this.increaseButton?.node.on(Node.EventType.TOUCH_END, this.handleIncrease, this);
    this.resetButton?.node.on(Node.EventType.TOUCH_END, this.handleReset, this);
  }

  private unregisterEvents(): void {
    this.decreaseButton?.node.off(Node.EventType.TOUCH_END, this.handleDecrease, this);
    this.increaseButton?.node.off(Node.EventType.TOUCH_END, this.handleIncrease, this);
    this.resetButton?.node.off(Node.EventType.TOUCH_END, this.handleReset, this);
  }

  public bind(room: PowerPanelRoom, power: number, dispatch: (command: EnergyCommand) => void): void {
    this.refreshSerializedReferences();
    this.room = room;
    this.power = power;
    this.dispatch = dispatch;
    this.refresh();
  }

  public refreshPower(power: number): void {
    this.power = power;
    this.refresh();
  }

  private handleDecrease(): void {
    if (this.room === null || this.dispatch === null) return;
    const nextPower = this.power <= this.room.minPower ? 0 : this.power - 1;
    this.dispatch({ type: 'SET_ROOM_POWER', roomId: this.room.roomId, power: nextPower });
  }

  private handleIncrease(): void {
    if (this.room === null || this.dispatch === null || this.power >= this.room.maxPower) return;
    const nextPower = this.power === 0 ? this.room.minPower : this.power + 1;
    this.dispatch({ type: 'SET_ROOM_POWER', roomId: this.room.roomId, power: nextPower });
  }

  private handleReset(): void {
    if (this.room === null || this.dispatch === null) return;
    this.dispatch({ type: 'RESET_ROOM_POWER', roomId: this.room.roomId });
  }

  private refresh(): void {
    if (this.room === null) return;
    if (this.roomNameLabel !== null) this.roomNameLabel.string = this.room.displayName;
    if (this.powerLabel !== null) this.powerLabel.string = `${this.power} / ${this.room.maxPower}`;
    if (this.decreaseButton !== null) this.decreaseButton.interactable = this.power > 0;
    if (this.increaseButton !== null) this.increaseButton.interactable = this.power < this.room.maxPower;
    if (this.resetButton !== null) this.resetButton.interactable = this.power > 0;
    this.drawButtons();
  }

  private drawButtons(): void {
    for (const button of [this.decreaseButton, this.increaseButton, this.resetButton]) {
      const buttonNode = button?.node ?? null;
      if (buttonNode === null) continue;
      const transform = buttonNode.getComponent(UITransform);
      const graphics = buttonNode.getComponent(Graphics);
      if (transform === null || graphics === null) continue;
      const { width, height } = transform.contentSize;
      graphics.clear();
      graphics.fillColor = button.interactable
        ? new Color(42, 91, 118, 245)
        : new Color(45, 55, 65, 210);
      graphics.roundRect(-width / 2, -height / 2, width, height, 4);
      graphics.fill();
      graphics.lineWidth = 1;
      graphics.strokeColor = new Color(92, 187, 220, 255);
      graphics.roundRect(-width / 2, -height / 2, width, height, 4);
      graphics.stroke();
    }
  }

  /**
   * Prefab 实例化后，Creator 可能把跨 Prefab 的旧组件引用恢复为失效组件。
   * 运行时始终以当前行节点内的中文语义子节点重建引用，避免持有已销毁 Node。
   */
  private refreshSerializedReferences(): void {
    this.roomNameLabel = this.node.getChildByName('房间名称')?.getComponent(Label) ?? null;
    this.powerLabel = this.node.getChildByName('当前能源')?.getComponent(Label) ?? null;
    this.decreaseButton = this.node.getChildByName('减少按钮')?.getComponent(Button) ?? null;
    this.increaseButton = this.node.getChildByName('增加按钮')?.getComponent(Button) ?? null;
    this.resetButton = this.node.getChildByName('断电按钮')?.getComponent(Button) ?? null;
  }
}

function ensureLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  width: number,
): Label {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.setPosition(x, y, 0);
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(width, 30);
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = 24;
  label.horizontalAlign = HorizontalTextAlignment.CENTER;
  label.verticalAlign = VerticalTextAlignment.CENTER;
  label.color = new Color(230, 240, 248, 255);
  return label;
}

function ensureButton(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  width = 24,
): Button {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.setPosition(x, y, 0);
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(width, 28);
  node.getComponent(Graphics) ?? node.addComponent(Graphics);
  const button = node.getComponent(Button) ?? node.addComponent(Button);
  const labelNode = node.getChildByName('按钮文字') ?? new Node('按钮文字');
  if (labelNode.parent === null) node.addChild(labelNode);
  const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
  labelTransform.setContentSize(width, 28);
  const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
  label.string = text;
  label.fontSize = text === '断电' ? 11 : 16;
  label.lineHeight = 24;
  label.horizontalAlign = HorizontalTextAlignment.CENTER;
  label.verticalAlign = VerticalTextAlignment.CENTER;
  label.color = new Color(240, 248, 255, 255);
  return button;
}
