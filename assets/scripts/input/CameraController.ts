import { _decorator, Camera, Component, error, EventMouse, input, Input, Node } from 'cc';

const { ccclass, menu, property } = _decorator;

@ccclass('CameraController')
@menu('星舰协议/输入/飞船镜头控制')
export class CameraController extends Component {
  @property({ displayName: '最小缩放', tooltip: '滚轮缩小时允许的最小比例。', group: '缩放', min: 0.1, step: 0.1 })
  public minScale = 0.5;

  @property({ displayName: '最大缩放', tooltip: '滚轮放大时允许的最大比例。', group: '缩放', min: 0.1, step: 0.1 })
  public maxScale = 1.8;

  @property({ displayName: '单次缩放步长', tooltip: '每次滚轮事件改变的缩放比例。', group: '缩放', min: 0.01, step: 0.01 })
  public zoomStep = 0.1;

  @property({ type: Node, displayName: '世界根节点', tooltip: '镜头平移与缩放作用的持久世界根节点。', group: '节点引用' })
  public worldRoot: Node | null = null;

  @property({ type: Node, displayName: '画布根节点', tooltip: '接收鼠标拖动和滚轮事件的持久画布节点。', group: '节点引用' })
  public canvasRoot: Node | null = null;

  @property({ type: Camera, displayName: '主相机', tooltip: '用于把屏幕鼠标坐标投影回世界网格的持久正交相机。', group: '节点引用' })
  public camera: Camera | null = null;
  private isDragging = false;
  private isPanBlocked = false;

  /** 房间等前景交互进行时暂停镜头平移，避免同一鼠标事件同时拖动场景。 */
  public setPanBlocked(blocked: boolean): void {
    this.isPanBlocked = blocked;
    if (blocked) {
      this.isDragging = false;
    }
  }

  protected onEnable(): void {
    if (this.worldRoot === null || this.canvasRoot === null) {
      error('[INPUT] 请在镜头控制组件中绑定世界根节点和画布根节点');
      return;
    }

    // Canvas 覆盖整个游戏视口，节点鼠标事件在浏览器预览和正式 Web 构建中表现一致。
    this.canvasRoot.on(Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
    this.canvasRoot.on(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
    this.canvasRoot.on(Node.EventType.MOUSE_UP, this.onMouseUp, this);
    this.canvasRoot.on(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    // 全局释放事件覆盖鼠标在 Canvas 外松开的情况，避免镜头永久保持拖动状态。
    input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
  }

  protected onDisable(): void {
    this.canvasRoot?.off(Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_UP, this.onMouseUp, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
    this.isDragging = false;
    this.isPanBlocked = false;
  }

  private onMouseDown(event: EventMouse): void {
    if (!this.isPanBlocked && event.getButton() === EventMouse.BUTTON_LEFT) {
      this.isDragging = true;
    }
  }

  private onMouseMove(event: EventMouse): void {
    if (this.isPanBlocked || !this.isDragging || this.worldRoot === null) {
      return;
    }

    const delta = event.getDelta();
    const position = this.worldRoot.position;
    const parentScale = this.worldRoot.parent?.worldScale;
    const scaleX = parentScale === undefined || parentScale.x === 0 ? 1 : parentScale.x;
    const scaleY = parentScale === undefined || parentScale.y === 0 ? 1 : parentScale.y;
    this.worldRoot.setPosition(position.x + delta.x / scaleX, position.y + delta.y / scaleY, position.z);
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onMouseWheel(event: EventMouse): void {
    if (this.worldRoot === null) {
      return;
    }

    const direction = event.getScrollY() > 0 ? 1 : -1;
    const scale = Math.min(this.maxScale, Math.max(this.minScale, this.worldRoot.scale.x + direction * this.zoomStep));
    this.worldRoot.setScale(scale, scale, 1);
  }
}
