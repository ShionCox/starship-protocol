import {
  _decorator,
  Button,
  Camera,
  Color,
  Component,
  EventKeyboard,
  EventMouse,
  error,
  input,
  Input,
  KeyCode,
  Label,
  Node,
  UITransform,
  Vec3,
} from 'cc';

import type { GridPosition } from '../game-core/ShipGridModel';
import { ShipView } from './ShipView';

const { ccclass, menu, property } = _decorator;

export type WorldObjectKind = 'CREW' | 'ROOM' | 'CONSTRUCTION';
export type WorldSelection = Readonly<{ kind: WorldObjectKind; id: string }>;
export type WorldContextTarget =
  | Readonly<{ kind: 'GRID'; position: GridPosition }>
  | Readonly<{ kind: WorldObjectKind; id: string; position: GridPosition | null }>;

export type WorldContextActionId =
  | 'MOVE'
  | 'REPAIR'
  | 'HEAL'
  | 'CONSTRUCT'
  | 'DEMOLISH'
  | 'STOP_MOVE'
  | 'STOP_TASK'
  | 'LEAVE_CONSTRUCTION'
  | 'TOGGLE_PATROL';

export interface BuildDragRequest {
  readonly definitionKind: 'FLOOR' | 'ROOM';
  readonly definitionId: string;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

export interface BuildPlacementPreview {
  readonly ok: boolean;
  readonly message: string;
  readonly width: number;
  readonly height: number;
  readonly revision?: number;
}

export interface WorldContextActionState {
  readonly id: WorldContextActionId;
  readonly label: string;
  readonly enabled: boolean;
  readonly reason: string;
}

interface WorldInteractionBinding {
  readonly canvasRoot: Node;
  readonly camera: Camera | null;
  readonly shipView: ShipView;
  readonly onSelectionChanged: (selection: WorldSelection | null) => void;
  readonly resolveActions: (selection: WorldSelection | null, target: WorldContextTarget) => readonly WorldContextActionState[];
  readonly executeAction: (actionId: WorldContextActionId, selection: WorldSelection | null, target: WorldContextTarget) => void | Promise<void>;
  /** 拆除必须先由应用层弹出中文确认；未提供时拆除按钮保持不可用。 */
  readonly confirmAction?: (actionId: WorldContextActionId, target: WorldContextTarget) => boolean | Promise<boolean>;
  readonly previewBuild?: (request: BuildDragRequest) => Promise<BuildPlacementPreview>;
  readonly commitBuild?: (request: BuildDragRequest) => Promise<{ readonly ok: boolean; readonly message: string }>;
  readonly setCameraPanBlocked?: (blocked: boolean) => void;
  readonly onBuildPreviewMessage?: (message: string) => void;
}

const ACTION_IDS: readonly WorldContextActionId[] = [
  'MOVE',
  'REPAIR',
  'HEAL',
  'CONSTRUCT',
  'DEMOLISH',
  'STOP_MOVE',
  'STOP_TASK',
  'LEAVE_CONSTRUCTION',
  'TOGGLE_PATROL',
];

// 菜单框和子按钮尺寸由 WorldContextMenu.prefab 持久保存；运行时只更新状态和根位置。

/**
 * 主场景的临时选择与右键菜单协调器。选择、悬浮和菜单位置都不是权威状态，
 * 不进入 GameCore 或存档；所有操作仍通过上层转换为显式 Command。
 */
@ccclass('WorldInteractionController')
@menu('星舰协议/输入/世界交互控制')
export class WorldInteractionController extends Component {
  @property({ type: Node, displayName: '上下文菜单根', tooltip: 'UIRoot 中持久保存的右键菜单节点。', group: '持久引用' })
  public menuRoot: Node | null = null;

  @property({ type: [Button], displayName: '菜单按钮', tooltip: '固定顺序的 Cocos Button；运行时只切换文本和可用状态。', group: '持久引用' })
  public actionButtons: Button[] = [];

  @property({ type: [Label], displayName: '菜单按钮文字', tooltip: '与菜单按钮一一对应的中文 Label。', group: '持久引用' })
  public actionLabels: Label[] = [];

  @property({ type: Label, displayName: '禁用原因文字', tooltip: '鼠标上下文不可执行时显示中文原因。', group: '持久引用' })
  public reasonLabel: Label | null = null;

  private binding: WorldInteractionBinding | null = null;
  private selection: WorldSelection | null = null;
  private contextTarget: WorldContextTarget | null = null;
  private currentActions: readonly WorldContextActionState[] = [];
  private pointerStartX = 0;
  private pointerStartY = 0;
  private pointerMoved = false;
  private blankPointerActive = false;
  private canvasListenersRegistered = false;
  private buttonListenersRegistered = false;
  private buildGlobalListenersRegistered = false;
  private readonly pointerWorld = new Vec3();
  private buildDrag: {
    readonly base: Omit<BuildDragRequest, 'x' | 'y'>;
    position: GridPosition | null;
    preview: BuildPlacementPreview | null;
    sequence: number;
    pendingPreview: Promise<BuildPlacementPreview> | null;
    committing: boolean;
  } | null = null;
  private readonly clickHandlers = ACTION_IDS.map((_, index) => () => this.handleActionClick(index));

  public bind(binding: WorldInteractionBinding): void {
    this.unregisterCanvasListeners();
    this.binding = binding;
    if (this.enabledInHierarchy) this.registerCanvasListeners();
  }

  public selectObject(kind: WorldObjectKind, id: string): void {
    const normalized = id.trim();
    if (normalized === '') return;
    this.selection = { kind, id: normalized };
    this.closeMenu(true);
    this.binding?.onSelectionChanged(this.selection);
  }

  public clearSelection(): void {
    if (this.selection === null && this.menuRoot?.active !== true) return;
    this.selection = null;
    this.closeMenu(true);
    this.binding?.onSelectionChanged(null);
  }

  public getSelection(): WorldSelection | null {
    return this.selection === null ? null : { ...this.selection };
  }

  /** 从建造卡片进入唯一拖拽会话；拖拽期间相机平移被显式阻塞。 */
  public beginBuildDrag(input: Omit<BuildDragRequest, 'x' | 'y'>): void {
    this.cancelBuildDrag();
    if (this.binding?.previewBuild === undefined || this.binding.commitBuild === undefined) return;
    this.buildDrag = {
      base: { ...input }, position: null, preview: null, sequence: 0, pendingPreview: null, committing: false,
    };
    this.binding.setCameraPanBlocked?.(true);
    this.registerBuildGlobalListeners();
    this.binding.onBuildPreviewMessage?.('拖动到飞船网格，绿色位置可建造');
  }

  public cancelBuildDrag(message = '已取消建造放置'): void {
    if (this.buildDrag === null) return;
    this.buildDrag = null;
    this.unregisterBuildGlobalListeners();
    this.binding?.setCameraPanBlocked?.(false);
    this.binding?.shipView.refreshInteractionRect(null, 1, 1, 'INVALID');
    this.binding?.onBuildPreviewMessage?.(message);
  }

  public openObjectContext(kind: WorldObjectKind, id: string, event: EventMouse): void {
    const position = this.gridFromEvent(event);
    this.openContext({ kind, id: id.trim(), position }, event);
  }

  protected onEnable(): void {
    if (this.menuRoot === null || this.actionButtons.length < ACTION_IDS.length || this.actionLabels.length < ACTION_IDS.length || this.reasonLabel === null) {
      error('世界上下文菜单 Prefab 缺少持久菜单根、按钮或文字引用，运行时不会重建菜单布局。');
      return;
    }
    this.registerButtonListeners();
    this.registerCanvasListeners();
    input.on(Input.EventType.KEY_DOWN, this.handleKeyDown, this);
    if (this.menuRoot !== null) this.menuRoot.active = false;
  }

  protected onDisable(): void {
    this.cancelBuildDrag('建造页面已关闭');
    this.unregisterCanvasListeners();
    this.unregisterButtonListeners();
    input.off(Input.EventType.KEY_DOWN, this.handleKeyDown, this);
    this.selection = null;
    this.closeMenu(true);
  }

  private registerBuildGlobalListeners(): void {
    if (this.buildGlobalListenersRegistered) return;
    // 卡片按下后鼠标会离开 UI 节点；仅依赖 Canvas 冒泡在 Creator/Web 的
    // pointer capture 下可能收不到中间移动事件，因此拖拽期间同时监听全局输入。
    input.on(Input.EventType.MOUSE_MOVE, this.handleGlobalBuildMouseMove, this);
    input.on(Input.EventType.MOUSE_UP, this.handleGlobalBuildMouseUp, this);
    this.buildGlobalListenersRegistered = true;
  }

  private unregisterBuildGlobalListeners(): void {
    if (!this.buildGlobalListenersRegistered) return;
    input.off(Input.EventType.MOUSE_MOVE, this.handleGlobalBuildMouseMove, this);
    input.off(Input.EventType.MOUSE_UP, this.handleGlobalBuildMouseUp, this);
    this.buildGlobalListenersRegistered = false;
  }

  private handleGlobalBuildMouseMove(event: EventMouse): void {
    if (this.buildDrag === null) return;
    this.updateBuildDrag(event);
  }

  private handleGlobalBuildMouseUp(event: EventMouse): void {
    if (this.buildDrag === null) return;
    // Canvas 的 MOUSE_UP 会先提交；全局事件只负责覆盖画布外释放。
    if (event.target instanceof Node && this.isUiEvent(event)) {
      this.cancelBuildDrag('已取消：释放位置不在飞船网格');
      return;
    }
    void this.finishBuildDrag(event);
  }

  private registerCanvasListeners(): void {
    const canvas = this.binding?.canvasRoot ?? null;
    if (canvas === null || this.canvasListenersRegistered) return;
    canvas.on(Node.EventType.MOUSE_DOWN, this.handleCanvasMouseDown, this);
    canvas.on(Node.EventType.MOUSE_MOVE, this.handleCanvasMouseMove, this);
    canvas.on(Node.EventType.MOUSE_UP, this.handleCanvasMouseUp, this);
    this.canvasListenersRegistered = true;
  }

  private unregisterCanvasListeners(): void {
    const canvas = this.binding?.canvasRoot ?? null;
    canvas?.off(Node.EventType.MOUSE_DOWN, this.handleCanvasMouseDown, this);
    canvas?.off(Node.EventType.MOUSE_MOVE, this.handleCanvasMouseMove, this);
    canvas?.off(Node.EventType.MOUSE_UP, this.handleCanvasMouseUp, this);
    this.canvasListenersRegistered = false;
    this.blankPointerActive = false;
  }

  private registerButtonListeners(): void {
    if (this.buttonListenersRegistered) return;
    for (let index = 0; index < this.actionButtons.length && index < this.clickHandlers.length; index += 1) {
      this.actionButtons[index].node.on(Button.EventType.CLICK, this.clickHandlers[index], this);
    }
    this.buttonListenersRegistered = true;
  }

  private unregisterButtonListeners(): void {
    for (let index = 0; index < this.actionButtons.length && index < this.clickHandlers.length; index += 1) {
      this.actionButtons[index].node.off(Button.EventType.CLICK, this.clickHandlers[index], this);
    }
    this.buttonListenersRegistered = false;
  }

  private handleCanvasMouseDown(event: EventMouse): void {
    if (this.buildDrag !== null) {
      if (event.getButton() === EventMouse.BUTTON_RIGHT) this.cancelBuildDrag('已取消：建造拖拽不支持右键');
      return;
    }
    if (this.isUiEvent(event)) return;
    if (event.getButton() === EventMouse.BUTTON_RIGHT) {
      const position = this.gridFromEvent(event);
      if (position !== null) {
        event.propagationStopped = true;
        this.openContext({ kind: 'GRID', position }, event);
      }
      return;
    }
    if (event.getButton() !== EventMouse.BUTTON_LEFT) return;
    const location = event.getUILocation();
    this.pointerStartX = location.x;
    this.pointerStartY = location.y;
    this.pointerMoved = false;
    this.blankPointerActive = true;
    this.closeMenu(true);
  }

  private handleCanvasMouseMove(event: EventMouse): void {
    if (this.buildDrag !== null) {
      this.updateBuildDrag(event);
      return;
    }
    if (this.isUiEvent(event)) {
      this.binding?.shipView.refreshInteractionCell(null);
      return;
    }
    const position = this.gridFromEvent(event);
    if (this.contextTarget?.kind === 'GRID' && this.menuRoot?.active === true) {
      this.binding?.shipView.refreshInteractionCell(this.contextTarget.position, 'TARGET');
    } else if (position === null) {
      this.binding?.shipView.refreshInteractionCell(null);
    } else {
      const cellType = this.binding?.shipView.getHullCellType(position) ?? null;
      this.binding?.shipView.refreshInteractionCell(position, cellType === 'BUILDABLE' ? 'HOVER' : 'INVALID');
    }
    if (!this.blankPointerActive || this.pointerMoved) return;
    const location = event.getUILocation();
    const deltaX = location.x - this.pointerStartX;
    const deltaY = location.y - this.pointerStartY;
    if (deltaX * deltaX + deltaY * deltaY >= 36) this.pointerMoved = true;
  }

  private handleCanvasMouseUp(event: EventMouse): void {
    if (this.buildDrag !== null) {
      if (this.isUiEvent(event)) {
        this.cancelBuildDrag('已取消：不能释放在建造侧栏');
      } else {
        void this.finishBuildDrag(event);
      }
      return;
    }
    if (this.isUiEvent(event)) return;
    if (event.getButton() !== EventMouse.BUTTON_LEFT || !this.blankPointerActive) return;
    if (!this.pointerMoved) this.clearSelection();
    this.blankPointerActive = false;
  }

  private handleKeyDown(event: EventKeyboard): void {
    if (event.keyCode !== KeyCode.ESCAPE) return;
    if (this.buildDrag !== null) this.cancelBuildDrag();
    else this.clearSelection();
  }

  private updateBuildDrag(event: EventMouse): void {
    const drag = this.buildDrag;
    const binding = this.binding;
    if (drag === null || binding?.previewBuild === undefined) return;
    const location = event.getUILocation();
    const projectedPoint = this.eventToWorldPoint(event, location);
    let position = binding.shipView.worldCenterToGridCandidate(
      projectedPoint,
      drag.base.width,
      drag.base.height,
    );
    // Creator Web 预览的调试工具栏可能让 Camera 的物理视口与 Canvas 设计视口
    // 暂时不一致。投影点若已经落在船体矩形外，只回退到同一事件的 Canvas 设计坐标；
    // 不在合法网格内的候选仍交给后续 GameCore 预览拒绝，避免放宽规则。
    const projectedCell = binding.shipView.worldPointToGridCell(projectedPoint);
    if (projectedCell === null) {
      const fallbackPoint = this.pointerWorld.set(location.x, location.y, 0);
      position = binding.shipView.worldCenterToGridCandidate(
        fallbackPoint,
        drag.base.width,
        drag.base.height,
      );
    }
    if (position === null) {
      if (drag.position !== null) {
        drag.position = null;
        drag.preview = null;
        binding.shipView.refreshInteractionRect(null, drag.base.width, drag.base.height, 'INVALID');
      }
      binding.onBuildPreviewMessage?.('请拖到飞船网格');
      return;
    }
    if (drag.position !== null && drag.position.x === position.x && drag.position.y === position.y) return;
    drag.position = position;
    drag.preview = null;
    const sequence = ++drag.sequence;
    const request: BuildDragRequest = { ...drag.base, x: position.x, y: position.y };
    const pending = binding.previewBuild(request);
    drag.pendingPreview = pending;
    void pending.then((preview) => {
      if (this.buildDrag !== drag || drag.sequence !== sequence || drag.position === null) return;
      drag.pendingPreview = null;
      drag.preview = preview;
      binding.shipView.refreshInteractionRect(drag.position, drag.base.width, drag.base.height, preview.ok ? 'VALID' : 'INVALID');
      binding.onBuildPreviewMessage?.(preview.ok ? '松开鼠标开始建造' : preview.message);
    }).catch((cause) => {
      if (this.buildDrag !== drag || drag.sequence !== sequence) return;
      drag.pendingPreview = null;
      drag.preview = { ok: false, message: cause instanceof Error ? cause.message : String(cause), width: drag.base.width, height: drag.base.height };
      binding.shipView.refreshInteractionRect(drag.position, drag.base.width, drag.base.height, 'INVALID');
      binding.onBuildPreviewMessage?.(drag.preview.message);
    });
  }

  private async finishBuildDrag(event: EventMouse): Promise<void> {
    const drag = this.buildDrag;
    const binding = this.binding;
    if (drag === null || binding?.commitBuild === undefined || drag.committing) return;
    if (!this.isCanvasEvent(event) || this.isUiEvent(event)) {
      this.cancelBuildDrag('已取消：不能释放在建造侧栏');
      return;
    }
    if (drag.pendingPreview !== null) {
      try { await drag.pendingPreview; } catch { /* updateBuildDrag 已显示错误 */ }
    }
    if (this.buildDrag !== drag || drag.position === null || drag.preview?.ok !== true) {
      this.cancelBuildDrag(drag.preview?.message ?? '当前位置不能建造');
      return;
    }
    drag.committing = true;
    const request: BuildDragRequest = { ...drag.base, x: drag.position.x, y: drag.position.y };
    try {
      const result = await binding.commitBuild(request);
      this.cancelBuildDrag(result.message);
    } catch (cause) {
      this.cancelBuildDrag(cause instanceof Error ? cause.message : String(cause));
    }
  }

  private openContext(target: WorldContextTarget, event: EventMouse): void {
    const binding = this.binding;
    if (binding === null || this.menuRoot === null) return;
    this.contextTarget = target;
    this.currentActions = binding.resolveActions(this.selection, target);
    const byId = new Map(this.currentActions.map((action) => [action.id, action]));
    let firstReason = '';
    for (let index = 0; index < ACTION_IDS.length; index += 1) {
      const action = byId.get(ACTION_IDS[index]);
      const button = this.actionButtons[index];
      const label = this.actionLabels[index];
      if (button === undefined || label === undefined) continue;
      button.node.active = action !== undefined;
      if (action === undefined) continue;
      button.interactable = action.enabled;
      label.string = action.label;
      label.color = action.enabled ? new Color(235, 247, 252, 255) : new Color(137, 148, 156, 255);
      if (!action.enabled && firstReason === '' && action.reason !== '') firstReason = action.reason;
    }
    if (this.reasonLabel !== null) this.reasonLabel.string = firstReason;
    if (this.reasonLabel !== null) this.reasonLabel.node.active = firstReason !== '';
    // 上下文菜单可能位于独立的“世界交互模块”Prefab 内；沿父链激活到弹窗层，
    // 否则只激活模块根而弹窗层仍 inactive 时，菜单命中正常但画面不可见。
    let popupAncestor = this.menuRoot.parent;
    while (popupAncestor !== null) {
      popupAncestor.active = true;
      if (popupAncestor.name === '弹窗层') break;
      popupAncestor = popupAncestor.parent;
    }
    this.menuRoot.active = true;
    this.menuRoot.setSiblingIndex(Math.max(0, (this.menuRoot.parent?.children.length ?? 1) - 1));
    this.placeMenu(event);
    if (target.position !== null) binding.shipView.refreshInteractionCell(target.position, 'TARGET');
  }

  private placeMenu(event: EventMouse): void {
    const menu = this.menuRoot;
    const canvas = this.binding?.canvasRoot ?? null;
    const canvasTransform = canvas?.getComponent(UITransform) ?? null;
    const menuTransform = menu?.getComponent(UITransform) ?? null;
    if (menu === null || canvasTransform === null || menuTransform === null) return;
    const location = event.getUILocation();
    // EventMouse.getUILocation 已是 Canvas 设计坐标，直接减锚点原点即可。若再按
    // 世界坐标转换，Creator 预览页的画布 DOM 偏移会把菜单推到可视区外。
    const localX = location.x - canvasTransform.contentSize.width * canvasTransform.anchorPoint.x;
    const localY = location.y - canvasTransform.contentSize.height * canvasTransform.anchorPoint.y;
    const halfWidth = menuTransform.contentSize.width / 2;
    const halfHeight = menuTransform.contentSize.height / 2;
    const canvasHalfWidth = canvasTransform.contentSize.width / 2;
    const canvasHalfHeight = canvasTransform.contentSize.height / 2;
    const gap = 10;
    // 默认贴在鼠标右下侧；靠近画布边缘时翻到另一侧，避免菜单中心压住点击目标。
    let menuX = localX + halfWidth + gap;
    if (menuX + halfWidth > canvasHalfWidth) menuX = localX - halfWidth - gap;
    let menuY = localY - halfHeight - gap;
    if (menuY - halfHeight < -canvasHalfHeight) menuY = localY + halfHeight + gap;
    menu.setPosition(
      Math.min(canvasHalfWidth - halfWidth, Math.max(-canvasHalfWidth + halfWidth, menuX)),
      Math.min(canvasHalfHeight - halfHeight, Math.max(-canvasHalfHeight + halfHeight, menuY)),
      0,
    );
  }

  private handleActionClick(index: number): void {
    const actionId = ACTION_IDS[index];
    const action = this.currentActions.find((entry) => entry.id === actionId);
    const target = this.contextTarget;
    if (action === undefined || !action.enabled || target === null) {
      if (this.reasonLabel !== null && action?.reason !== undefined) this.reasonLabel.string = action.reason;
      return;
    }
    this.closeMenu(true);
    if (action.id === 'DEMOLISH') {
      const confirm = this.binding?.confirmAction;
      if (confirm === undefined) return;
      void Promise.resolve(confirm(action.id, target)).then((confirmed) => {
        if (confirmed) void this.binding?.executeAction(action.id, this.selection, target);
      });
      return;
    }
    void this.binding?.executeAction(action.id, this.selection, target);
  }

  private closeMenu(clearHighlight: boolean): void {
    if (this.menuRoot !== null) this.menuRoot.active = false;
    this.currentActions = [];
    this.contextTarget = null;
    if (clearHighlight) this.binding?.shipView.refreshInteractionCell(null);
  }

  private gridFromEvent(event: EventMouse): GridPosition | null {
    const location = event.getUILocation();
    return this.binding?.shipView.worldPointToGridCell(this.eventToWorldPoint(event, location)) ?? null;
  }

  /**
   * 将鼠标屏幕坐标投影回世界平面；直接把 UI 像素当世界坐标会在镜头缩放或平移后错一格。
   * 正交相机下 z 不影响 x/y，缺少主相机时保留旧坐标作为编辑器降级路径。
   */
  private eventToWorldPoint(event: EventMouse, fallback: Readonly<{ x: number; y: number }>): Vec3 {
    const camera = this.binding?.camera;
    if (camera !== null) {
      const location = event.getLocation();
      // cc.Camera 的公开 API 参数顺序是 screenPos, out；传反会把旧的
      // pointerWorld 当作输入并丢弃返回值，导致拖拽预览一直停在上一格。
      camera.screenToWorld(new Vec3(location.x, location.y, 0), this.pointerWorld);
      return this.pointerWorld;
    }
    return this.pointerWorld.set(fallback.x, fallback.y, 0);
  }

  private isUiEvent(event: EventMouse): boolean {
    let cursor = event.target instanceof Node ? event.target : null;
    while (cursor !== null) {
      if (cursor.getComponent(WorldInteractionController) !== null) return true;
      cursor = cursor.parent;
    }
    return false;
  }

  private isCanvasEvent(event: EventMouse): boolean {
    const canvas = this.binding?.canvasRoot;
    if (canvas === null || canvas === undefined) return false;
    let cursor = event.target instanceof Node ? event.target : null;
    while (cursor !== null) {
      if (cursor === canvas) return true;
      cursor = cursor.parent;
    }
    return false;
  }
}
