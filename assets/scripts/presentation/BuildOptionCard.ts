import { _decorator, Button, Color, Component, error, EventMouse, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, menu, property } = _decorator;

export interface BuildOptionCardModel {
  readonly kind: 'FLOOR' | 'ROOM';
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly width: number;
  readonly height: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly previewFrame: SpriteFrame | null;
}

/** 建造目录中的可拖拽卡片；卡片只负责视觉和输入，不直接提交 GameCore Command。 */
@ccclass('BuildOptionCard')
@menu('星舰协议/界面/建造选项卡片')
export class BuildOptionCard extends Component {
  @property({ type: Button, displayName: '卡片按钮', tooltip: '使用 Cocos 原生 Button 处理普通、悬停、按下和禁用状态。', group: '持久引用' })
  public button: Button | null = null;

  @property({ type: SpriteFrame, displayName: '普通状态素材', tooltip: '透明卡片底图，不包含文字。', group: '按钮素材' })
  public normalSprite: SpriteFrame | null = null;

  @property({ type: SpriteFrame, displayName: '悬停状态素材', tooltip: '鼠标悬停时的透明卡片底图。', group: '按钮素材' })
  public hoverSprite: SpriteFrame | null = null;

  @property({ type: SpriteFrame, displayName: '按下状态素材', tooltip: '按下时的透明卡片底图。', group: '按钮素材' })
  public pressedSprite: SpriteFrame | null = null;

  @property({ type: SpriteFrame, displayName: '禁用状态素材', tooltip: '材料不足或施工槽已满时的透明卡片底图。', group: '按钮素材' })
  public disabledSprite: SpriteFrame | null = null;

  @property({ type: Sprite, displayName: '预览图', tooltip: '由可建造目录绑定的代表性首帧。', group: '显示' })
  public preview: Sprite | null = null;

  @property({ type: Label, displayName: '名称文字', tooltip: '建筑中文名称。', group: '显示' })
  public nameLabel: Label | null = null;

  @property({ type: Label, displayName: '详情文字', tooltip: '占地、材料和施工时间。', group: '显示' })
  public detailLabel: Label | null = null;

  @property({ type: Label, displayName: '状态文字', tooltip: '材料不足或施工槽已满时的中文原因。', group: '显示' })
  public statusLabel: Label | null = null;

  private enabledForDrag = false;
  private startDrag: (() => void) | null = null;
  private readonly handleMouseDown = (event: EventMouse): void => {
    if (!this.enabledForDrag || this.startDrag === null) return;
    event.propagationStopped = true;
    this.startDrag();
  };

  public bind(model: BuildOptionCardModel, enabled: boolean, reason: string, startDrag: () => void): void {
    this.enabledForDrag = enabled;
    this.startDrag = startDrag;
    if (this.preview !== null) {
      this.preview.spriteFrame = model.previewFrame;
      this.preview.color = enabled ? Color.WHITE : new Color(112, 122, 128, 255);
      this.preview.node.active = model.previewFrame !== null;
    }
    if (this.nameLabel !== null) {
      this.nameLabel.string = model.name;
      this.nameLabel.color = enabled ? new Color(235, 247, 252, 255) : new Color(145, 153, 158, 255);
    }
    if (this.detailLabel !== null) {
      this.detailLabel.string = `${model.width}×${model.height}格　${model.cost} 金属　${Math.ceil(model.durationMs / 1000)}秒`;
      this.detailLabel.color = enabled ? new Color(178, 210, 220, 255) : new Color(120, 128, 132, 255);
    }
    if (this.statusLabel !== null) {
      this.statusLabel.string = reason;
      this.statusLabel.color = new Color(255, 170, 106, 255);
    }
    if (this.button !== null) {
      this.button.transition = Button.Transition.SPRITE;
      this.button.normalSprite = this.normalSprite;
      this.button.hoverSprite = this.hoverSprite;
      this.button.pressedSprite = this.pressedSprite;
      this.button.disabledSprite = this.disabledSprite;
      this.button.interactable = enabled;
    }
  }

  protected onEnable(): void {
    if (this.button === null || this.preview === null || this.nameLabel === null || this.detailLabel === null || this.statusLabel === null) {
      error('建造卡片 Prefab 缺少 Button、预览图或文字引用，运行时不会重建卡片。');
      return;
    }
    this.node.on(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
    this.startDrag = null;
  }
}
