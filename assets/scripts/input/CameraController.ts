import { _decorator, Component, error, EventMouse, Node } from 'cc';

import { findPrototypeSceneNode, findPrototypeSceneNodePath } from '../bootstrap/PrototypeSceneNodes';

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

  private worldRoot: Node | null = null;
  private canvasRoot: Node | null = null;
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
    const scene = this.node.scene;
    this.worldRoot = scene === null ? null : findPrototypeSceneNodePath(scene, 'canvas', 'worldRoot');
    this.canvasRoot = scene === null ? null : findPrototypeSceneNode(scene, 'canvas');

    if (this.worldRoot === null || this.canvasRoot === null) {
      error('[INPUT] PrototypeScene 缺少 Canvas 或 WorldRoot');
      return;
    }

    // Canvas 覆盖整个游戏视口，节点鼠标事件在浏览器预览和正式 Web 构建中表现一致。
    this.canvasRoot.on(Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
    this.canvasRoot.on(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
    this.canvasRoot.on(Node.EventType.MOUSE_UP, this.onMouseUp, this);
    this.canvasRoot.on(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    this.canvasRoot.on(Node.EventType.MOUSE_LEAVE, this.onMouseUp, this);
  }

  protected onDisable(): void {
    this.canvasRoot?.off(Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_UP, this.onMouseUp, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
    this.canvasRoot?.off(Node.EventType.MOUSE_LEAVE, this.onMouseUp, this);
    this.worldRoot = null;
    this.canvasRoot = null;
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
