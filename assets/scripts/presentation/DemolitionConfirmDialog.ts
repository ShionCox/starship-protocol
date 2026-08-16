import { _decorator, Button, Component, error, Label } from 'cc';

const { ccclass, menu, property } = _decorator;

export type DemolitionConfirmationRequest = Readonly<{
  readonly targetId: string;
  readonly targetType: 'FLOOR' | 'ROOM';
  readonly message: string;
}>;

/**
 * 拆除确认的前置抽象。具体按钮和中文文案由持久 UI 适配器提供；组件只保证
 * 同一时刻只有一个待确认请求，取消或关闭时绝不会触发确认回调。
 */
@ccclass('DemolitionConfirmDialog')
@menu('星舰协议/输入/拆除确认弹窗')
export class DemolitionConfirmDialog extends Component {
  @property({ type: Label, displayName: '标题', tooltip: '拆除确认标题。', group: '持久引用' })
  public titleLabel: Label | null = null;

  @property({ type: Label, displayName: '说明', tooltip: '显示目标、耗时和退款。', group: '持久引用' })
  public messageLabel: Label | null = null;

  @property({ type: Button, displayName: '确认按钮', tooltip: '确认后才发送 START_DEMOLITION。', group: '持久引用' })
  public confirmButton: Button | null = null;

  @property({ type: Button, displayName: '取消按钮', tooltip: '取消不会发送任何拆除 Command。', group: '持久引用' })
  public cancelButton: Button | null = null;

  private pending: { readonly request: DemolitionConfirmationRequest; readonly resolve: (value: boolean) => void } | null = null;

  public request(request: DemolitionConfirmationRequest): Promise<boolean> {
    this.cancel();
    if (this.messageLabel !== null) this.messageLabel.string = request.message;
    // 弹窗层本身是共享的 inactive 容器；激活子弹窗时必须先打开父层，
    // 否则拆除确认会被世界菜单关闭流程一起裁掉。
    if (this.node.parent !== null) this.node.parent.active = true;
    this.node.active = true;
    return new Promise<boolean>((resolve) => {
      this.pending = { request, resolve };
    });
  }

  public getRequest(): DemolitionConfirmationRequest | null {
    return this.pending?.request ?? null;
  }

  public confirm(): void {
    const pending = this.pending;
    this.pending = null;
    this.node.active = false;
    this.deactivateParentIfEmpty();
    pending?.resolve(true);
  }

  public cancel(): void {
    const pending = this.pending;
    this.pending = null;
    this.node.active = false;
    this.deactivateParentIfEmpty();
    pending?.resolve(false);
  }

  private deactivateParentIfEmpty(): void {
    const parent = this.node.parent;
    if (parent !== null && parent.children.every((child) => child.active !== true)) parent.active = false;
  }

  protected onEnable(): void {
    if (this.titleLabel === null || this.messageLabel === null || this.confirmButton === null || this.cancelButton === null) {
      error('拆除确认弹窗 Prefab 缺少持久文字或按钮引用，运行时不会重建弹窗。');
    }
    this.confirmButton?.node.on(Button.EventType.CLICK, this.confirm, this);
    this.cancelButton?.node.on(Button.EventType.CLICK, this.cancel, this);
  }

  protected onDisable(): void {
    this.confirmButton?.node.off(Button.EventType.CLICK, this.confirm, this);
    this.cancelButton?.node.off(Button.EventType.CLICK, this.cancel, this);
    this.cancel();
  }

}
