import {
  _decorator,
  Color,
  Component,
  error,
  Graphics,
  Label,
  Layers,
  Node,
  UITransform,
  Widget,
  HorizontalTextAlignment,
  VerticalTextAlignment,
} from 'cc';

import { CREW_ROLE_LABELS } from '../game-core/CrewDefinition';
import type { CrewReadState } from '../game-core/CrewModel';

const { ccclass, menu, property } = _decorator;

/** 船员状态面板只展示只读状态和中文反馈，不直接持有或修改 CrewModel。 */
@ccclass('CrewStatusPanel')
@menu('星舰协议/界面/船员状态面板')
export class CrewStatusPanel extends Component {
  @property({ type: Label, displayName: '当前选择', tooltip: '显示当前选中的船员及职业。', group: '显示' })
  public selectionLabel: Label | null = null;

  @property({ type: Label, displayName: '所在房间', tooltip: '显示当前逻辑房间实例 ID。', group: '显示' })
  public currentRoomLabel: Label | null = null;

  @property({ type: Label, displayName: '目标房间', tooltip: '显示移动目标；空闲时显示“无”。', group: '显示' })
  public targetRoomLabel: Label | null = null;

  @property({ type: Label, displayName: '船员状态', tooltip: '显示空闲或移动中。', group: '显示' })
  public stateLabel: Label | null = null;

  @property({ type: Label, displayName: '状态提示', tooltip: '显示移动成功、房间已满或存档错误等中文反馈。', group: '显示' })
  public statusLabel: Label | null = null;

  private shipId = '';

  /** 仅供创作插件补齐共享 UIRoot Prefab 中的持久船员状态面板。 */
  public ensureAuthoringPrefabStructure(): boolean {
    this.node.layer = Layers.Enum.UI_2D;
    const existingTransform = this.getComponent(UITransform);
    if (existingTransform === null) this.addComponent(UITransform).setContentSize(320, 184);
    if (this.getComponent(Widget) === null) {
      const widget = this.addComponent(Widget);
      widget.isAlignRight = true;
      widget.isAlignBottom = true;
      widget.right = 16;
      widget.bottom = 16;
    }
    this.getComponent(Graphics) ?? this.addComponent(Graphics);
    this.selectionLabel = ensureStatusLabel(this.node, '当前选择', '当前选择：无', 67);
    this.currentRoomLabel = ensureStatusLabel(this.node, '所在房间', '所在房间：无', 36);
    this.targetRoomLabel = ensureStatusLabel(this.node, '目标房间', '目标房间：无', 5);
    this.stateLabel = ensureStatusLabel(this.node, '船员状态', '状态：空闲', -26);
    this.statusLabel = ensureStatusLabel(this.node, '状态提示', '请点击船员，再点击目标房间', -67, 12);
    if (existingTransform === null) this.drawChrome();
    return true;
  }

  protected onEnable(): void {
    // 面板外观由 Creator 中持久化的 Graphics 参数决定。
  }

  public bind(shipId: string): void {
    if (shipId.trim() === '') {
      error('[UI] 船员状态面板绑定的飞船实例标识不能为空');
      return;
    }
    this.shipId = shipId;
  }

  public refresh(selected: CrewReadState | null, message = ''): void {
    if (this.selectionLabel !== null) {
      this.selectionLabel.string = selected === null
        ? '当前选择：无'
        : `当前选择：${selected.displayName}（${CREW_ROLE_LABELS[selected.role]}）`;
    }
    if (this.currentRoomLabel !== null) this.currentRoomLabel.string = `所在房间：${selected?.currentRoomId ?? '无'}`;
    if (this.targetRoomLabel !== null) this.targetRoomLabel.string = `目标房间：${selected?.targetRoomId ?? '无'}`;
    if (this.stateLabel !== null) this.stateLabel.string = `状态：${selected?.state === 'MOVING' ? '移动中' : '空闲'}`;
    if (message.length > 0 && this.statusLabel !== null) this.statusLabel.string = message;
  }

  private drawChrome(): void {
    const graphics = this.getComponent(Graphics);
    if (graphics === null) {
      error('[UI] 请在船员状态面板 Prefab 根节点持久挂载图形组件');
      return;
    }
    graphics.clear();
    graphics.fillColor = new Color(7, 22, 35, 238);
    graphics.roundRect(-160, -92, 320, 184, 10);
    graphics.fill();
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(218, 177, 55, 255);
    graphics.roundRect(-160, -92, 320, 184, 10);
    graphics.stroke();
  }
}

function ensureStatusLabel(parent: Node, name: string, text: string, y: number, fontSize = 14): Label {
  const existing = parent.getChildByName(name);
  const node = existing ?? new Node(name);
  if (existing === null) {
    parent.addChild(node);
    node.setPosition(0, y, 0);
    node.addComponent(UITransform).setContentSize(288, 26);
  }
  node.layer = Layers.Enum.UI_2D;
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  if (existing === null) {
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = 22;
    label.horizontalAlign = HorizontalTextAlignment.LEFT;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.color = new Color(230, 240, 248, 255);
  }
  return label;
}
