import {
  _decorator,
  Color,
  Component,
  error,
  EventMouse,
  Graphics,
  Label,
  Node,
  Tween,
  tween,
  UITransform,
  Vec3,
  warn,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import { findOwningShipView, ShipView } from './ShipView';
import {
  parseCrewDefinition,
  type CrewDefinition,
  type CrewDefinitionParseResult,
} from '../game-core/CrewDefinition';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import type { CrewReadState } from '../game-core/CrewModel';
import { resolveFixedCrewIdentity, type CrewNameMode } from '../game-core/CrewIdentity';
import type { NavigationGraph, NavigationNode } from '../game-core/NavigationGraph';
import { RoomView } from './RoomView';
import { CrewAppearance } from './CrewAppearance';

const { ccclass, executeInEditMode, menu, property } = _decorator;

// 导航根节点代表脚底；身体从脚底向上绘制。闲逛是纯表现状态，
// 不写入 GameCore，故使用稳定哈希而不是非确定性随机数。
const FLOOR_FOOT_ANCHOR_OFFSET = 0.5;
const IDLE_WANDER_MIN_PAUSE_SECONDS = 1.5;
const IDLE_WANDER_MAX_PAUSE_SECONDS = 4;
const IDLE_WANDER_MIN_DISTANCE_CELLS = 0.5;
const IDLE_WANDER_MAX_DISTANCE_CELLS = 1.5;
const IDLE_WANDER_MIN_SEPARATION_CELLS = 0.35;
const IDLE_WANDER_SPEED_CELLS_PER_SECOND = 0.8;
const FLOOR_WANDER_EDGE_INSET_CELLS = 0.1;
const CREW_HIT_AREA_MIN_CELLS = 1.5;

interface IdleWanderRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export type CrewSelectHandler = (crewInstanceId: string) => void;
export type CrewContextHandler = (crewInstanceId: string, event: EventMouse) => void;

/** 船员表现只处理中文可调外观、选择和移动插值，不修改 GameCore 状态。 */
@ccclass('CrewView')
@executeInEditMode
@menu('星舰协议/场景表现/船员视图')
export class CrewView extends Component {
  @property({ displayName: '船员实例标识', tooltip: '场景内唯一的稳定船员实例 ID。', group: '船员实例' })
  public crewInstanceId = '';

  @property({ displayName: '船员定义标识', tooltip: '必须与 crews.csv 中的稳定 ID 一致。', group: '船员定义' })
  public crewDefinitionId = 'crew-engineer';

  @property({ displayName: '初始房间实例标识', tooltip: '空存档时船员所在的房间实例 ID。', group: '初始站位' })
  public initialRoomInstanceId = '';

  @property({ displayName: '初始站位编号', tooltip: '从 0 开始；必须小于目标房间的船员容量。', group: '初始站位', min: 0, step: 1 })
  public initialStationIndex = 0;

  @property({ displayName: '初始生命', tooltip: '-1 表示按船员定义的最大生命启动；仅用于开发场景初始状态。', group: '开发初始状态', min: -1, step: 1 })
  public initialHp = -1;

  @property({ displayName: '命名方式', tooltip: '自动生成使用稳定中文代号；指定名称会写入该船员实例快照。', group: '船员身份' })
  public nameMode: CrewNameMode = 'GENERATED';

  @property({ displayName: '指定名称', tooltip: '仅在命名方式为“FIXED”时使用；长度 1 到 16 个字符且同舰不得重复。', group: '船员身份' })
  public callSign = '';

  /**
   * Creator 公开 set-property 对 CCString[] 的 dump 结构依赖编辑器内部实现，
   * 在批量场景装配时会出现“保存成功但数组没有序列化”的情况。用一个隐藏的
   * JSON 字符串作为唯一持久字段，运行时仍暴露稳定的数组访问器，避免把编辑器
   * 私有序列化格式带进扩展进程。
   */
  @property({ displayName: '巡逻房间路线（序列化）', tooltip: '仅士兵使用；由创作工具保存为 JSON 字符串。', group: '船员行为', visible: false })
  private patrolRoomInstanceIdsJson = '';

  public get patrolRoomInstanceIds(): readonly string[] {
    try {
      const parsed: unknown = JSON.parse(this.patrolRoomInstanceIdsJson || '[]');
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim())
        : [];
    } catch {
      return [];
    }
  }

  public set patrolRoomInstanceIds(value: readonly string[]) {
    this.patrolRoomInstanceIdsJson = JSON.stringify(value.map((id) => id.trim()).filter((id) => id !== ''));
  }

  @property({ displayName: '船员主体颜色', tooltip: '船员圆形标记的填充颜色。', group: '外观' })
  public bodyColor = new Color(36, 184, 155, 255);

  @property({ displayName: '船员边框颜色', tooltip: '未选中状态的轮廓颜色。', group: '外观' })
  public borderColor = new Color(175, 255, 235, 255);

  @property({ displayName: '选中描边颜色', tooltip: '玩家选中该船员时显示的轮廓颜色。', group: '外观' })
  public selectedOutlineColor = new Color(255, 220, 70, 255);

  @property({ displayName: '船员标记直径', tooltip: '船员圆形标记的像素直径。', group: '外观', min: 16, step: 1 })
  public markerDiameter = 20;

  @property({ type: Node, displayName: '船员图像节点', tooltip: '持久的船员身体节点；底部中心是脚底锚点。为空时使用根节点 Graphics 回退。', group: '外观' })
  public visualRoot: Node | null = null;

  @property({ displayName: '视觉占用宽度（格）', tooltip: '船员身体的表现占格宽度，默认一格；不改变 GameCore 站位规则。', group: '外观', min: 1, step: 1 })
  public visualGridWidth = 1;

  @property({ displayName: '视觉占用高度（格）', tooltip: '船员身体从脚底向上的表现占格高度，默认一格；不改变 GameCore 站位规则。', group: '外观', min: 1, step: 1 })
  public visualGridHeight = 1;

  @property({ displayName: '移动插值时长', tooltip: '每个固定 Tick 之间的画面平滑时长；只影响表现，不改变 GameCore 移动速度。', group: '移动表现', min: 0.02, max: 0.2, step: 0.01 })
  public movementTweenSeconds = 0.1;

  @property({ type: CrewAppearance, displayName: '原生船员外观', tooltip: '可选的 Sprite/Animation 外观适配器；未绑定时继续使用 Graphics 回退。', group: '外观' })
  public crewAppearance: CrewAppearance | null = null;

  private definition: Readonly<CrewDefinition> | null = null;
  private authoringPreviewResult: CrewDefinitionParseResult | null = null;
  private state: CrewReadState | null = null;
  private navigation: NavigationGraph | null = null;
  private shipView: ShipView | null = null;
  private selectHandler: CrewSelectHandler | null = null;
  private contextHandler: CrewContextHandler | null = null;
  private selected = false;
  private previewSignature = '';
  private idleWanderSignature = '';
  private idleWanderCursor = 0;
  private idleWanderOffset = new Vec3();
  private idleWanderLastAnchor: { x: number; y: number } | null = null;
  private labelParentWorldScale = new Vec3();
  private pointerTargets: Node[] = [];

  protected onEnable(): void {
    // 根节点覆盖整格命中区域；视觉子节点覆盖真实精灵边界。两者共用同一处理器，
    // 事件在处理器中停止冒泡，避免一次点击触发两次选择。
    this.pointerTargets = [this.node];
    if (this.visualRoot !== null && this.visualRoot !== this.node) this.pointerTargets.push(this.visualRoot);
    for (const target of this.pointerTargets) target.on(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
    if (EDITOR_NOT_IN_PREVIEW) this.refreshEditorPreview();
  }

  protected onDisable(): void {
    for (const target of this.pointerTargets) target.off(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
    this.pointerTargets = [];
    Tween.stopAllByTarget(this.node);
    this.stopIdleWander();
    this.idleWanderSignature = '';
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) this.refreshEditorPreview();
    else this.syncLabelScreenScale();
  }

  public resolveCrewDefinition(): CrewDefinitionParseResult {
    const source = findOwningShipView(this.node)?.configSource;
    const resolved = source?.resolve();
    if (resolved === undefined) return { ok: false, code: 'INVALID_DOCUMENT', message: '请绑定权威 CSV 来源' };
    if (resolved.ok === false) return { ok: false, code: 'INVALID_DOCUMENT', message: resolved.message };
    const definition = resolved.config.crews.find((entry) => entry.id === this.crewDefinitionId.trim());
    return definition === undefined
      ? { ok: false, code: 'INVALID_ID', message: `crews.csv 不包含船员定义：${this.crewDefinitionId || '空'}` }
      : { ok: true, definition };
  }

  /** 供创作插件在打开 Prefab 后验证绑定的稳定 ID 与权威 CSV。 */
  public validateAuthoringDefinition(): { readonly ok: boolean; readonly message: string } {
    const result = this.authoringPreviewResult ?? this.resolveCrewDefinition();
    if (result.ok === false) return { ok: false, message: result.message };
    return { ok: true, message: `船员定义有效：${result.definition.displayName}（${result.definition.id}）` };
  }

  /** 创作面板以内存配置行刷新船员预览，不改写 CSV 或场景数据。 */
  public applyAuthoringDefinitionPreview(document: unknown): boolean {
    const documentId = typeof document === 'object' && document !== null && typeof (document as { id?: unknown }).id === 'string'
      ? (document as { id: string }).id.trim()
      : '';
    if (documentId !== this.crewDefinitionId.trim()) return true;
    const result = parseCrewDefinition(document);
    this.authoringPreviewResult = result;
    this.previewSignature = '';
    if (result.ok === false) {
      this.refreshEditorPreview();
      return false;
    }
    this.definition = result.definition;
    const label = this.findLabel();
    if (label !== null) label.string = result.definition.displayName;
    this.draw();
    this.getCrewAppearance()?.refreshPreview();
    return true;
  }

  /**
   * 清空创作定义的内存预览覆盖，并立即按权威 CSV 重绘当前船员表现。
   * 预览状态只存在于 View 内存中，不写 Scene，也不创建 Undo 记录。
   */
  public clearAuthoringDefinitionPreview(): void {
    this.authoringPreviewResult = null;
    this.previewSignature = '';
    const authoritative = this.resolveCrewDefinition();
    this.definition = authoritative.ok ? authoritative.definition : null;
    this.refreshEditorPreview();
  }

  /** 房间或船体网格变化后，按原逻辑站位重新计算船员表现位置。 */
  public refreshAuthoringLayoutPreview(): boolean {
    const result = this.authoringPreviewResult ?? this.resolveCrewDefinition();
    if (result.ok === false) {
      this.refreshEditorPreview();
      return false;
    }
    this.definition = result.definition;
    this.previewSignature = '';

    // 独立打开 Crew Prefab 时没有所属飞船布局上下文；这里只刷新自身，
    // 不把无法重算场景站位误报为预览刷新失败。
    if (this.node.parent === null || findOwningShipView(this.node) === null) {
      this.refreshEditorPreview();
      return true;
    }

    const placed = this.applyEditorInitialPlacement();
    this.refreshEditorPreview();
    return placed;
  }

  /** 供创作插件把持久船员实例放到编辑器初始房间的可见站位。 */
  public applyEditorInitialPlacement(): boolean {
    const validation = this.validateInitialPlacement();
    if (validation.ok === false || validation.roomView === undefined || validation.roomDefinition === undefined) return false;
    const parent = this.node.parent;
    const shipView = findOwningShipView(this.node);
    const roomView = validation.roomView;
    const roomState = roomView.getAuthoringInspectorState();
    if (parent === null || shipView === null || roomState.ok !== true || roomState.gridPosition === undefined) return false;
    const center = shipView.gridPositionToParentLocal(
      parent,
      roomState.gridPosition,
      validation.roomDefinition.width,
      validation.roomDefinition.height,
    );
    if (center === null) return false;
    center.x += (this.initialStationIndex - (validation.roomDefinition.crewCapacity - 1) / 2) * shipView.cellSize * 0.42;
    center.y -= validation.roomDefinition.height * shipView.cellSize / 2;
    center.z = 20;
    this.node.setPosition(center);
    return true;
  }

  /**
   * 供 Creator 场景脚本写入士兵巡逻路线。数组属性的 Scene dump 结构由 Creator 内部管理，
   * 面板只通过纯 JSON 参数调用此公开方法，避免扩展进程伪造序列化数组。
   */
  public applyAuthoringPatrolRoute(input: readonly unknown[] | string): boolean {
    let roomInstanceIds: unknown[];
    try {
      roomInstanceIds = typeof input === 'string' ? JSON.parse(input) as unknown[] : [...input];
    } catch {
      return false;
    }
    if (!Array.isArray(roomInstanceIds) || roomInstanceIds.some((id) => typeof id !== 'string' || id.trim() === '')) return false;
    this.patrolRoomInstanceIds = roomInstanceIds.map((id) => (id as string).trim());
    this.refreshEditorPreview();
    return true;
  }

  public getAuthoringInspectorState(): {
    readonly ok: boolean;
    readonly message: string;
    readonly crewInstanceId: string;
    readonly crewDefinitionId: string;
    readonly initialRoomInstanceId: string;
    readonly initialStationIndex: number;
    readonly initialHp: number;
    readonly nameMode: CrewNameMode;
    readonly callSign: string;
    readonly patrolRoomInstanceIds: readonly string[];
  } {
    const result = this.authoringPreviewResult ?? this.resolveCrewDefinition();
    let message: string;
    let ok = result.ok;
    if (result.ok === false) message = result.message;
    else if (this.nameMode !== 'GENERATED' && this.nameMode !== 'FIXED') {
      ok = false;
      message = `船员命名方式无效：${String(this.nameMode)}`;
    } else if (this.nameMode === 'FIXED' && !resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: this.callSign }).ok) {
      ok = false;
      message = '指定船员名称必须是 1 到 16 个字符且不能包含控制字符';
    } else if (!Number.isInteger(this.initialHp) || this.initialHp < -1 || this.initialHp === 0 || this.initialHp > result.definition.maxHp) {
      ok = false;
      message = `船员初始生命必须是 -1 或 1 到 ${result.definition.maxHp} 的整数`;
    } else {
      const placement = this.validateInitialPlacement();
      ok = placement.ok;
      message = placement.ok ? `船员实例有效：${result.definition.displayName}` : placement.message;
    }
    return {
      ok,
      message,
      crewInstanceId: this.crewInstanceId.trim(),
      crewDefinitionId: this.crewDefinitionId.trim(),
      initialRoomInstanceId: this.initialRoomInstanceId.trim(),
      initialStationIndex: this.initialStationIndex,
      initialHp: this.initialHp,
      nameMode: this.nameMode,
      callSign: this.callSign.trim(),
      patrolRoomInstanceIds: Object.freeze(this.patrolRoomInstanceIds.map((id) => id.trim()).filter((id) => id !== '')),
    };
  }

  /**
   * 编辑器和运行时共用的初始站位不变量：目标房间必须存在且已通过 RoomView
   * 校验，站位编号必须落在该房间容量生成的 [0, capacity) 范围内。
   *
   * 这里不检查其他船员占位；场景中已有实例的重复站位由 GameCore 在启动时拒绝，
   * 创作插件则在创建前单独分配最低空闲站位。
   */
  private validateInitialPlacement(): {
    readonly ok: boolean;
    readonly message: string;
    readonly roomView?: RoomView;
    readonly roomDefinition?: Readonly<RoomDefinition>;
  } {
    const roomInstanceId = this.initialRoomInstanceId.trim();
    if (roomInstanceId === '') {
      return { ok: false, message: '船员初始房间标识不能为空' };
    }
    const shipView = findOwningShipView(this.node);
    if (shipView?.roomRoot === null || shipView?.roomRoot === undefined) {
      return { ok: false, message: `船员初始房间不存在：${roomInstanceId}` };
    }
    const roomView = shipView.roomRoot.getComponentsInChildren(RoomView)
      .find((view) => view.roomInstanceId.trim() === roomInstanceId);
    if (roomView === undefined) {
      return { ok: false, message: `船员初始房间不存在：${roomInstanceId}` };
    }
    const roomDefinition = roomView.resolveRoomDefinition();
    if (roomDefinition.ok === false) {
      return { ok: false, message: `船员初始房间定义无效：${roomInstanceId}，${roomDefinition.message}` };
    }
    const roomState = roomView.getAuthoringInspectorState();
    if (roomState.ok !== true) {
      return { ok: false, message: `船员初始房间校验失败：${roomState.message}` };
    }
    const capacity = roomDefinition.definition.crewCapacity;
    if (!Number.isInteger(capacity) || capacity < 0) {
      return { ok: false, message: `船员初始房间容量无效：${roomInstanceId}` };
    }
    if (!Number.isInteger(this.initialStationIndex) || this.initialStationIndex < 0) {
      return { ok: false, message: `船员初始站位必须是非负整数：${this.initialStationIndex}` };
    }
    if (this.initialStationIndex >= capacity) {
      return { ok: false, message: `船员初始站位超出房间容量：${this.initialStationIndex}（容量 ${capacity}）` };
    }
    return { ok: true, message: '', roomView, roomDefinition: roomDefinition.definition };
  }

  public bind(
    definition: Readonly<CrewDefinition>,
    state: CrewReadState,
    navigation: NavigationGraph,
    shipView: ShipView,
    selectHandler: CrewSelectHandler,
    contextHandler: CrewContextHandler | null = null,
  ): void {
    this.definition = definition;
    this.navigation = navigation;
    this.shipView = shipView;
    this.selectHandler = selectHandler;
    this.contextHandler = contextHandler;
  }

  public setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.draw();
  }

  public refresh(state: CrewReadState, animate = true): void {
    this.state = state;
    const current = this.resolveNodePosition(state.currentNodeId);
    const next = state.nextNodeId === null ? null : this.resolveNodePosition(state.nextNodeId);
    if (current === null || (state.nextNodeId !== null && next === null)) {
      error(`[UI] 船员 ${state.id} 的导航节点缺少可视锚点：${state.currentNodeId}${state.nextNodeId === null ? '' : ` → ${state.nextNodeId}`}`);
      return;
    }
    const target = next === null ? current : Vec3.lerp(new Vec3(), current, next, Math.min(1, Math.max(0, state.edgeProgress)));
    if (state.state === 'IDLE' && this.startOrKeepIdleWander(state, current)) {
      const label = this.findLabel();
      if (label !== null) label.string = state.displayName || this.definition?.displayName || this.crewInstanceId;
      this.draw();
      return;
    }
    this.stopIdleWander();
    this.refreshAppearance(state, current, next);
    Tween.stopAllByTarget(this.node);
    this.resetVisualMotion();
    if (animate && !EDITOR_NOT_IN_PREVIEW) tween(this.node).to(Math.min(0.1, this.movementTweenSeconds), { position: target }).start();
    else this.node.setPosition(target);
    const label = this.findLabel();
    if (label !== null) label.string = state.displayName || this.definition?.displayName || this.crewInstanceId;
    this.draw();
  }

  private refreshAppearance(state: CrewReadState, current: Vec3 | null, next: Vec3 | null): void {
    const appearance = this.crewAppearance ?? this.getComponent(CrewAppearance) ?? this.visualRoot?.getComponent(CrewAppearance) ?? null;
    if (appearance === null) return;
    const appearanceState = state.state === 'IDLE'
      ? 'IDLE'
      : state.state === 'MOVING' || state.state === 'PATROLLING'
        ? 'MOVING'
        : 'TASK';
    appearance.playState(appearanceState);
    if ((state.state === 'MOVING' || state.state === 'PATROLLING') && current !== null && next !== null) {
      appearance.setFacingByDelta(next.x - current.x);
    }
  }

  private handleMouseDown(event: EventMouse): void {
    const id = this.crewInstanceId.trim();
    if (event.getButton() === EventMouse.BUTTON_LEFT && this.selectHandler !== null) {
      event.propagationStopped = true;
      this.selectHandler(id);
    } else if (event.getButton() === EventMouse.BUTTON_RIGHT && this.contextHandler !== null) {
      event.propagationStopped = true;
      this.contextHandler(id, event);
    }
  }

  private resolveNodePosition(nodeId: string): Vec3 | null {
    const parent = this.node.parent;
    const navigationNode = this.navigation?.getNode(nodeId) ?? null;
    const anchor = navigationNode?.anchor ?? null;
    if (parent === null || anchor === null || this.shipView === null) return null;
    // FLOOR/CONNECTOR_STOP 使用格子中心锚点，向上半格得到地板上表面的脚底；
    // STATION 的核心锚点本身已经是房间底边（room.y - 0.5），不能再次偏移。
    const visualAnchor = navigationNode.kind === 'FLOOR' || navigationNode.kind === 'CONNECTOR_STOP'
      ? { x: anchor.x, y: anchor.y + FLOOR_FOOT_ANCHOR_OFFSET }
      : anchor;
    const center = this.shipView.navigationAnchorToParentLocal(parent, visualAnchor);
    if (center === null) return null;
    center.z = 20;
    return center;
  }

  /** 空闲走动只改变船员图像子节点；逻辑站位、revision 和玩家存档保持不变。 */
  private startOrKeepIdleWander(state: CrewReadState, authoritativePosition: Vec3): boolean {
    const node = this.navigation?.getNode(state.currentNodeId) ?? null;
    if (node === null || this.shipView === null || this.node.parent === null || this.visualRoot === null) return false;
    let range: IdleWanderRange | null = null;
    if (node.kind === 'STATION' && node.roomId !== null) {
      const room = this.navigation?.getRoomPlacement(node.roomId) ?? null;
      if (room !== null) range = this.getRoomIdleWanderRange(room);
    } else if (node.kind === 'FLOOR') {
      range = this.getFloorIdleWanderRange(node);
    }
    if (range === null) return false;
    const signature = `${state.id}|${state.currentNodeId}|${this.navigation?.version ?? ''}`;
    if (signature === this.idleWanderSignature) return true;
    this.stopIdleWander();
    this.node.setPosition(authoritativePosition);
    this.idleWanderSignature = signature;
    this.idleWanderCursor = 0;
    this.idleWanderLastAnchor = null;
    this.resetVisualMotion();
    this.scheduleIdleWanderPause(state.id, range);
    return true;
  }

  private scheduleIdleWanderPause(
    crewId: string,
    range: IdleWanderRange,
  ): void {
    const target = this.getVisualMotionTarget();
    if (target === null || this.idleWanderSignature === '') return;
    this.refreshAppearanceState('IDLE');
    const pause = IDLE_WANDER_MIN_PAUSE_SECONDS
      + (IDLE_WANDER_MAX_PAUSE_SECONDS - IDLE_WANDER_MIN_PAUSE_SECONDS)
      * stableVisualUnit(crewId, this.idleWanderCursor, 2);
    Tween.stopAllByTarget(target);
    tween(target)
      .delay(pause)
      .call(() => this.scheduleNextIdleWanderPoint(crewId, range))
      .start();
  }

  private scheduleNextIdleWanderPoint(
    crewId: string,
    range: IdleWanderRange,
  ): void {
    if (this.idleWanderSignature === '' || this.shipView === null || this.node.parent === null) return;
    const targetNode = this.getVisualMotionTarget();
    if (targetNode === null) return;
    const authoritativePosition = this.resolveNodePosition(this.state?.currentNodeId ?? '') ?? this.node.position;
    let anchor: { x: number; y: number } | null = null;
    let cursor = this.idleWanderCursor;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const distance = IDLE_WANDER_MIN_DISTANCE_CELLS
        + (IDLE_WANDER_MAX_DISTANCE_CELLS - IDLE_WANDER_MIN_DISTANCE_CELLS) * stableVisualUnit(crewId, cursor, 2);
      const angle = stableVisualUnit(crewId, cursor, 3) * Math.PI * 2;
      // 第一轮也必须从当前站位附近起步，避免静置结束后突然横跨整段地板或房间。
      const currentNode = this.navigation?.getNode(this.state?.currentNodeId ?? '') ?? null;
      const currentAnchor = currentNode === null ? null : this.getIdleWanderAnchor(currentNode);
      const previous = this.idleWanderLastAnchor ?? currentAnchor;
      if (previous === null) return;
      // 围绕上一个脚底点取确定性短步，再夹在视觉盒边界内；不瞬移到随机远点。
      const candidate = {
        x: Math.min(range.maxX, Math.max(range.minX, previous.x + Math.cos(angle) * distance)),
        // 漫步保持脚底高度，只沿同层 X 轴短步移动。
        y: Math.min(range.maxY, Math.max(range.minY, previous.y)),
      };
      const actualDistance = Math.hypot(candidate.x - previous.x, candidate.y - previous.y);
      const farEnough = actualDistance >= IDLE_WANDER_MIN_SEPARATION_CELLS;
      const shortStep = actualDistance >= IDLE_WANDER_MIN_DISTANCE_CELLS * 0.75
        && actualDistance <= IDLE_WANDER_MAX_DISTANCE_CELLS + 0.001;
      if (farEnough && shortStep) {
        anchor = candidate;
        break;
      }
      // 用稳定角度把候选向下一次确定性采样推进，避免重复近点。
      cursor += Math.max(1, Math.round(Math.abs(Math.cos(angle)) + distance));
    }
    this.idleWanderCursor = cursor + 1;
    if (anchor === null) {
      this.scheduleIdleWanderPause(crewId, range);
      return;
    }
    const target = this.shipView.navigationAnchorToParentLocal(this.node.parent, anchor);
    if (target === null) return;
    target.z = 20;
    const motionPosition = new Vec3(target.x - authoritativePosition.x, target.y - authoritativePosition.y, 0);
    const previousPosition = this.idleWanderOffset.clone();
    const distance = Math.hypot(motionPosition.x - previousPosition.x, motionPosition.y - previousPosition.y) / Math.max(1, this.shipView.cellSize);
    const seconds = Math.max(0.25, distance / IDLE_WANDER_SPEED_CELLS_PER_SECOND);
    this.idleWanderLastAnchor = anchor;
    this.refreshAppearanceState('MOVING');
    const appearance = this.getCrewAppearance();
    appearance?.setFacingByDelta(motionPosition.x - previousPosition.x);
    Tween.stopAllByTarget(targetNode);
    tween(targetNode)
      .to(seconds, { position: motionPosition })
      .call(() => {
        this.idleWanderOffset.set(motionPosition);
        this.refreshAppearanceState('IDLE');
        this.scheduleIdleWanderPause(crewId, range);
      })
      .start();
  }

  private stopIdleWander(): void {
    const target = this.getVisualMotionTarget();
    if (target !== null) Tween.stopAllByTarget(target);
    this.idleWanderSignature = '';
    this.idleWanderLastAnchor = null;
    this.resetVisualMotion();
  }

  private getCrewAppearance(): CrewAppearance | null {
    return this.crewAppearance ?? this.getComponent(CrewAppearance) ?? this.visualRoot?.getComponent(CrewAppearance) ?? null;
  }

  private refreshAppearanceState(state: 'IDLE' | 'MOVING' | 'TASK'): void {
    this.getCrewAppearance()?.playState(state);
  }

  private getVisualMotionTarget(): Node | null {
    return this.visualRoot;
  }

  private resetVisualMotion(): void {
    this.idleWanderOffset.set(0, 0, 0);
    if (this.visualRoot !== null) this.visualRoot.setPosition(0, 0, 0);
    this.draw();
  }

  private getRoomIdleWanderRange(room: Readonly<{ x: number; y: number; width: number; height: number }>): IdleWanderRange | null {
    const width = Math.max(1, Math.round(this.visualGridWidth));
    const minX = room.x + (width - 1) / 2;
    const maxX = room.x + room.width - 1 - (width - 1) / 2;
    // 房间 y 是底部格子；脚底位于底边，身体向上占 visualGridHeight 格。
    const stationY = room.y - 0.5;
    const minY = stationY;
    const maxY = stationY;
    if (maxX < minX || maxY < minY) return null;
    // 单格房间没有可用的视觉路径，保持站位静止而不是反复排队零距离 Tween。
    if (Math.abs(maxX - minX) < 0.001 && Math.abs(maxY - minY) < 0.001) return null;
    return { minX, maxX, minY, maxY };
  }

  /** 地板闲逛只在当前地板表面附近进行，不越到相邻占用格，也不改变导航节点或占用。 */
  private getFloorIdleWanderRange(node: Readonly<NavigationNode>): IdleWanderRange | null {
    if (node.kind !== 'FLOOR') return null;
    const halfRange = 0.5 - FLOOR_WANDER_EDGE_INSET_CELLS;
    const footY = node.anchor.y + FLOOR_FOOT_ANCHOR_OFFSET;
    return {
      minX: node.anchor.x - halfRange,
      maxX: node.anchor.x + halfRange,
      minY: footY,
      maxY: footY,
    };
  }

  private getIdleWanderAnchor(node: Readonly<NavigationNode>): Readonly<{ x: number; y: number }> {
    return node.kind === 'FLOOR'
      ? { x: node.anchor.x, y: node.anchor.y + FLOOR_FOOT_ANCHOR_OFFSET }
      : node.anchor;
  }

  private findLabel(): Label | null {
    const label = this.visualRoot?.getChildByName('船员名称')?.getComponent(Label)
      ?? this.node.getChildByName('船员名称')?.getComponent(Label)
      ?? null;
    if (label !== null) applyCrewLabelStyle(label);
    return label;
  }

  /** 名字是屏幕空间可读性元素：跟随船员位置，但抵消世界根缩放。 */
  private syncLabelScreenScale(): void {
    const label = this.findLabel();
    const parent = label?.node.parent ?? null;
    if (label === null || parent === null) return;
    const parentScale = parent.getWorldScale(this.labelParentWorldScale);
    const scaleX = Math.max(0.0001, Math.abs(parentScale.x));
    const scaleY = Math.max(0.0001, Math.abs(parentScale.y));
    // 兼容尚未由 Creator 重建的旧 Prefab：若历史结构仍把名称挂在翻转根下，
    // 用同号反向缩放保证名称最终世界朝向始终为正。
    const facingCorrection = parentScale.x < 0 ? -1 : 1;
    label.node.setScale(facingCorrection / scaleX, 1 / scaleY, 1);
  }

  private refreshEditorPreview(): void {
    const source = findOwningShipView(this.node)?.configSource ?? null;
    if (this.authoringPreviewResult === null && (source === null || !source.hasCompleteBinding())) {
      if (this.previewSignature !== 'config-binding-pending') {
        this.previewSignature = 'config-binding-pending';
        // 独立 Prefab 只保留最近一次合法 DTO 写入的名称与持久外观。
        this.draw();
        this.getCrewAppearance()?.refreshPreview();
      }
      return;
    }
    const result = this.authoringPreviewResult ?? this.resolveCrewDefinition();
    let previewText: string;
    if (result.ok === false) previewText = result.message;
    else previewText = result.definition.displayName;
    const signature = [
      previewText,
      this.markerDiameter,
      this.visualGridWidth,
      this.visualGridHeight,
      this.bodyColor.toHEX('#rrggbbaa'),
      this.borderColor.toHEX('#rrggbbaa'),
      this.selectedOutlineColor.toHEX('#rrggbbaa'),
      this.initialHp,
    ].join('|');
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    if (result.ok === false) warn(`[UI] ${result.message}`);
    const label = this.findLabel();
    if (label !== null) label.string = result.ok ? result.definition.displayName : '船员';
    this.draw();
    this.getCrewAppearance()?.refreshPreview();
  }

  private draw(): void {
    const transform = this.getComponent(UITransform);
    const rootGraphics = this.getComponent(Graphics);
    const visualTransform = this.visualRoot?.getComponent(UITransform) ?? null;
    const visualGraphics = this.visualRoot?.getComponent(Graphics) ?? null;
    if (transform === null || (rootGraphics === null && visualGraphics === null)) return;
    const cellSize = this.shipView?.cellSize ?? 24;
    const width = Math.max(1, Math.round(this.visualGridWidth)) * cellSize;
    const height = Math.max(1, Math.round(this.visualGridHeight)) * cellSize;
    const hitWidth = Math.max(width, cellSize * CREW_HIT_AREA_MIN_CELLS);
    const hitHeight = Math.max(height, cellSize * CREW_HIT_AREA_MIN_CELLS);
    transform.setAnchorPoint(0.5, 0);
    transform.setContentSize(hitWidth, hitHeight);
    visualTransform?.setAnchorPoint(0.5, 0);
    visualTransform?.setContentSize(hitWidth, hitHeight);
    const labelNode = this.visualRoot?.getChildByName('船员名称')
      ?? this.node.getChildByName('船员名称')
      ?? null;
    if (labelNode !== null) {
      labelNode.setPosition(0, height + 8, 1);
      const label = labelNode.getComponent(Label);
      if (label !== null) applyCrewLabelStyle(label);
    }
    this.syncLabelScreenScale();
    const appearance = this.getCrewAppearance();
    const hasNativeVisual = appearance?.hasRenderableVisual() === true;
    const graphics = visualGraphics ?? rootGraphics;
    if (graphics === null) return;
    if (rootGraphics !== null) rootGraphics.enabled = this.visualRoot === null || visualGraphics === null;
    if (visualGraphics !== null) visualGraphics.enabled = true;
    graphics.clear();
    const offsetX = this.visualRoot === null ? this.idleWanderOffset.x : 0;
    const offsetY = this.visualRoot === null ? this.idleWanderOffset.y : 0;
    const centerX = offsetX;
    const centerY = height / 2 + offsetY;
    const diameter = Math.min(this.markerDiameter, Math.min(width, height) - 4);
    if (!hasNativeVisual) {
      graphics.fillColor = this.bodyColor;
      graphics.circle(centerX, centerY, Math.max(2, diameter / 2));
      graphics.fill();
    }
    graphics.lineWidth = this.selected ? 4 : 2;
    graphics.strokeColor = this.selected ? this.selectedOutlineColor : this.borderColor;
    if (!hasNativeVisual) {
      graphics.circle(centerX, centerY, Math.max(2, diameter / 2));
      graphics.stroke();
    } else if (this.selected) {
      graphics.strokeColor = this.selectedOutlineColor;
      graphics.rect(-width / 2 + 1, 1, width - 2, height - 2);
      graphics.stroke();
    }
    const resolved = this.resolveCrewDefinition();
    const maxHp = this.definition?.maxHp ?? (resolved.ok ? resolved.definition.maxHp : 1);
    const hp = this.state?.hp ?? (this.initialHp === -1 ? maxHp : Math.max(0, this.initialHp));
    const barWidth = Math.max(8, Math.min(width, diameter));
    // 生命条挂在脚底以下；图像节点只承担角色身体，不把血条带进房间内部。
    const y = -6 + offsetY;
    graphics.fillColor = new Color(34, 45, 52, 255);
    graphics.rect(centerX - barWidth / 2, y, barWidth, 4);
    graphics.fill();
    graphics.fillColor = new Color(73, 218, 123, 255);
    graphics.rect(centerX - barWidth / 2, y, barWidth * Math.min(1, hp / Math.max(1, maxHp)), 4);
    graphics.fill();
  }
}

function applyCrewLabelStyle(label: Label): void {
  label.fontFamily = 'Microsoft YaHei';
  label.fontSize = 14;
  label.lineHeight = 18;
  label.isBold = true;
  label.cacheMode = Label.CacheMode.NONE;
  label.enableShadow = false;
  label.enableOutline = true;
  label.outlineColor = Color.BLACK;
  label.outlineWidth = 1;
  const transform = label.getComponent(UITransform);
  transform?.setContentSize(128, 22);
}

/** 由稳定船员 ID 和游标产生 [0,1) 表现序列；不使用非确定性随机数，也不进入规则状态。 */
function stableVisualUnit(crewId: string, cursor: number, axis: number): number {
  let hash = 2_166_136_261;
  const input = `${crewId}|${cursor}|${axis}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}
