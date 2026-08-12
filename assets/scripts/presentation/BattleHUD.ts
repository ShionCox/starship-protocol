import { _decorator, Button, Color, Component, director, error, Graphics, Label, Layers, Node, UITransform, Widget } from 'cc';

const { ccclass, menu, property } = _decorator;

/** 战斗 HUD 只展示明确绑定的双方飞船作用域，不搜索场景中的 RoomView。 */
@ccclass('BattleHUD')
@menu('星舰协议/界面/战斗界面')
export class BattleHUD extends Component {
  @property({ type: Label, displayName: '我方飞船', tooltip: '显示我方飞船实例标识。', group: '显示' })
  public playerShipLabel: Label | null = null;

  @property({ type: Label, displayName: '敌方飞船', tooltip: '显示敌方飞船实例标识。', group: '显示' })
  public enemyShipLabel: Label | null = null;

  @property({ type: Label, displayName: '战斗状态', tooltip: '当前阶段仅显示战斗系统尚未开放。', group: '显示' })
  public statusLabel: Label | null = null;

  @property({ type: Button, displayName: '返回主场景按钮', tooltip: '返回 MainScene 的中文按钮。', group: '操作' })
  public backButton: Button | null = null;

  /** 仅供创作插件生成共享 UIRoot Prefab 的战斗内容。 */
  public ensureAuthoringPrefabStructure(): boolean {
    this.node.layer = Layers.Enum.UI_2D;
    this.getComponent(UITransform) ?? this.addComponent(UITransform);
    const widget = this.getComponent(Widget) ?? this.addComponent(Widget);
    widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
    this.playerShipLabel = ensureHudLabel(this.node, '我方飞船', '我方飞船：未绑定', -240, 330);
    this.enemyShipLabel = ensureHudLabel(this.node, '敌方飞船', '敌方飞船：未绑定', 240, 330);
    this.statusLabel = ensureHudLabel(this.node, '战斗状态', '战斗规则将在后续 R1 切片开放', 0, -330);
    this.backButton = ensureHudButton(this.node, '返回主场景按钮', '返回主场景', 0, -285, 140);
    return true;
  }

  protected onEnable(): void {
    this.backButton = this.node.getChildByName('返回主场景按钮')?.getComponent(Button) ?? null;
    this.backButton?.node.off(Node.EventType.TOUCH_END, this.returnToMain, this);
    this.backButton?.node.on(Node.EventType.TOUCH_END, this.returnToMain, this);
  }

  protected onDisable(): void {
    this.backButton?.node.off(Node.EventType.TOUCH_END, this.returnToMain, this);
  }

  public bind(playerShipId: string, enemyShipId: string): void {
    if (playerShipId.trim() === '' || enemyShipId.trim() === '' || playerShipId === enemyShipId) {
      error('[UI] 战斗界面必须绑定两个不同的非空飞船实例标识');
      return;
    }
    if (this.playerShipLabel !== null) this.playerShipLabel.string = `我方飞船：${playerShipId}`;
    if (this.enemyShipLabel !== null) this.enemyShipLabel.string = `敌方飞船：${enemyShipId}`;
    if (this.statusLabel !== null) this.statusLabel.string = '战斗规则将在后续 R1 切片开放';
  }

  private returnToMain(): void {
    director.loadScene('MainScene', (cause) => {
      if (cause !== null && cause !== undefined) error(`[UI] 无法返回主场景：${cause.message}`);
    });
  }
}

function ensureHudLabel(parent: Node, name: string, text: string, x: number, y: number): Label {
  const existing = parent.getChildByName(name);
  const node = existing ?? new Node(name);
  if (existing === null) {
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(360, 32);
  }
  node.layer = Layers.Enum.UI_2D;
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  if (existing === null) {
    label.string = text;
    label.fontSize = 18;
    label.lineHeight = 28;
  }
  return label;
}

function ensureHudButton(parent: Node, name: string, text: string, x: number, y: number, width: number): Button {
  const existing = parent.getChildByName(name);
  const node = existing ?? new Node(name);
  if (existing === null) {
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, 36);
  }
  node.layer = Layers.Enum.UI_2D;
  const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
  if (existing === null) {
    graphics.clear();
    graphics.fillColor = new Color(27, 67, 92, 245);
    graphics.roundRect(-width / 2, -18, width, 36, 5);
    graphics.fill();
    graphics.strokeColor = new Color(92, 187, 220, 255);
    graphics.roundRect(-width / 2, -18, width, 36, 5);
    graphics.stroke();
  }
  const button = node.getComponent(Button) ?? node.addComponent(Button);
  ensureHudLabel(node, '文字', text, 0, 0);
  return button;
}
