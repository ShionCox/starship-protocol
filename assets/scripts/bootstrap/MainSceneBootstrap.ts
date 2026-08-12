import { _decorator, Camera, Canvas, Component, director, error, log, Vec3, warn } from 'cc';

import type { PlayerCommandResult, PlayerStateSnapshot } from '../application/PlayerStatePort';
import { GameConfigCatalog } from '../application/GameConfigCatalog';
import type { CrewDefinition } from '../game-core/CrewDefinition';
import type { CrewReadState } from '../game-core/CrewModel';
import type { EnergyCommand } from '../game-core/EnergyModel';
import { NavigationGraph } from '../game-core/NavigationGraph';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import { ShipGridModel, type MoveRoomCommand, type PlacementValidation } from '../game-core/ShipGridModel';
import type { ShipCommand, ShipModelBlueprint, ShipSnapshot } from '../game-core/ShipModel';
import { CameraController } from '../input/CameraController';
import { CrewStatusPanel } from '../presentation/CrewStatusPanel';
import { CrewView } from '../presentation/CrewView';
import { PowerPanel, type PowerPanelCommandResult, type PowerPanelRoom, type PowerPanelState } from '../presentation/PowerPanel';
import { RoomView } from '../presentation/RoomView';
import { ShipView } from '../presentation/ShipView';
import { getBrowserKeyValueStorage, LocalPlayerStatePort } from './LocalPlayerStatePort';
import { configureGameDisplay } from './configureGameDisplay';

const { ccclass, menu, property } = _decorator;

interface SceneShipBindings {
  readonly blueprint: ShipModelBlueprint;
  readonly roomViews: readonly RoomView[];
  readonly crewViews: readonly CrewView[];
  readonly roomDefinitions: ReadonlyMap<string, Readonly<RoomDefinition>>;
  readonly crewDefinitions: ReadonlyMap<string, Readonly<CrewDefinition>>;
}

/**
 * MainScene 的应用装配入口。它只连接 Creator 已持久保存的 ShipView 与 UIRoot 组件，缺失引用
 * 时立即停止；不会在运行时创建节点、房间、船员或 UI。
 */
@ccclass('MainSceneBootstrap')
@menu('星舰协议/启动/主场景装配')
export class MainSceneBootstrap extends Component {
  @property({ type: ShipView, displayName: '当前飞船视图', tooltip: 'MainScene 当前玩家飞船的持久 ShipView 实例。', group: '场景引用' })
  public shipView: ShipView | null = null;

  @property({ type: PowerPanel, displayName: '能源面板', tooltip: 'UIRoot Prefab 中持久保存的能源面板。', group: '场景引用' })
  public powerPanel: PowerPanel | null = null;

  @property({ type: CrewStatusPanel, displayName: '船员状态面板', tooltip: 'UIRoot Prefab 中持久保存的船员状态面板。', group: '场景引用' })
  public crewStatusPanel: CrewStatusPanel | null = null;

  @property({ type: CameraController, displayName: '镜头控制', tooltip: '绑定当前 MainScene 世界根与画布的镜头控制组件。', group: '场景引用' })
  public cameraController: CameraController | null = null;

  @property({ displayName: '本地配置版本', tooltip: '开发期玩家状态 Envelope 使用的配置版本。规则变化不兼容时修改此值。', group: '开发状态' })
  public configVersion = 'r1-dev-1';

  private port: LocalPlayerStatePort | null = null;
  private state: PlayerStateSnapshot | null = null;
  private bindings: SceneShipBindings | null = null;
  private configCatalog: GameConfigCatalog | null = null;
  private selectedCrewId: string | null = null;
  private requestSequence = 0;
  private tickHandler: (() => void) | null = null;

  /**
   * 由项目创作工具通过 Creator 公开 execute-component-method 调用。
   * 正式 2D 相机使用正交投影，并同时渲染 DEFAULT 与 UI_2D 层。
   */
  public applyEditorCameraDefaults(): { readonly ok: boolean; readonly message: string } {
    const scene = this.node.scene;
    const cameraNode = scene?.getChildByName('主相机') ?? null;
    const camera = cameraNode?.getComponent(Camera) ?? null;
    if (cameraNode === null || camera === null) return { ok: false, message: '主场景缺少“主相机”或 Camera 组件' };
    const canvas = scene?.getChildByName('画布')?.getComponent(Canvas) ?? null;
    if (canvas === null) return { ok: false, message: '主场景缺少“画布”或 Canvas 组件' };
    cameraNode.setPosition(new Vec3(640, 360, 1000));
    cameraNode.setRotationFromEuler(0, 0, 0);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 360;
    camera.far = 2000;
    // 当前场景只有这一台相机，必须清理颜色缓冲；DEPTH_ONLY 会把旧黑帧一直保留下来。
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    // ShipView 的世界根使用 DEFAULT 层，房间与共享 UI 使用 UI_2D 层。
    camera.visibility = 1_107_296_256;
    // Canvas 必须显式绑定这台相机，否则构建产物中的 2D 渲染根无法确定对齐相机。
    canvas.cameraComponent = camera;
    return { ok: true, message: '主场景正交 2D 相机已校正' };
  }

  /**
   * 仅供项目创作工具在编辑器内连接已经保存到场景中的组件。
   * 运行时不会调用此方法，也不会因此动态创建任何节点或组件。
   */
  public applyEditorSceneReferences(): { readonly ok: boolean; readonly message: string } {
    const scene = this.node.scene;
    const shipViews = scene?.getComponentsInChildren(ShipView) ?? [];
    const powerPanels = scene?.getComponentsInChildren(PowerPanel) ?? [];
    const crewPanels = scene?.getComponentsInChildren(CrewStatusPanel) ?? [];
    const cameraController = this.getComponent(CameraController);
    if (shipViews.length !== 1) return { ok: false, message: `主场景必须且只能包含一个飞船视图，当前为 ${shipViews.length} 个` };
    if (powerPanels.length !== 1) return { ok: false, message: `主场景必须且只能包含一个能源面板，当前为 ${powerPanels.length} 个` };
    if (crewPanels.length !== 1) return { ok: false, message: `主场景必须且只能包含一个船员状态面板，当前为 ${crewPanels.length} 个` };
    if (cameraController === null) return { ok: false, message: '主相机缺少镜头控制组件' };
    this.shipView = shipViews[0];
    this.powerPanel = powerPanels[0];
    this.crewStatusPanel = crewPanels[0];
    this.cameraController = cameraController;
    return { ok: true, message: '主场景引用已连接' };
  }

  protected start(): void {
    configureGameDisplay();
    // BattleScene 属于内置 main bundle；预加载只下载并准备资源，不会提前运行战斗场景。
    director.preloadScene('BattleScene', (cause) => {
      if (cause !== null && cause !== undefined) warn(`[BOOT] 战斗场景预加载失败：${cause.message}`);
    });
    void this.initialize().catch((cause: unknown) => {
      error(`[BOOT] 主场景初始化失败：${describeCause(cause)}`);
      this.stopTick();
    });
  }

  protected onDisable(): void {
    this.stopTick();
  }

  private async initialize(): Promise<void> {
    // 跨 Prefab 的场景覆盖引用在场景往返后可能失效；只重新解析已持久组件，绝不创建节点或改变布局。
    // 场景覆盖可能仍指向 Prefab 编辑上下文中的有效对象，因此启动时始终以当前场景树为准。
    const resolved = this.resolvePersistedSceneReferences();
    if (resolved.ok) {
      this.shipView = resolved.shipView;
      this.powerPanel = resolved.powerPanel;
      this.crewStatusPanel = resolved.crewStatusPanel;
    }
    if (!isUsableComponent(this.cameraController)) this.cameraController = this.getComponent(CameraController);
    const missing = [
      !isUsableComponent(this.shipView) ? '飞船视图' : '',
      !isUsableComponent(this.powerPanel) ? '能源面板' : '',
      !isUsableComponent(this.crewStatusPanel) ? '船员状态面板' : '',
      !isUsableComponent(this.cameraController) ? '镜头控制' : '',
    ].filter((name) => name !== '');
    if (missing.length > 0) {
      throw new Error(`主场景缺少可用持久组件：${missing.join('、')}`);
    }
    const shipView = this.shipView as ShipView;
    const powerPanel = this.powerPanel as PowerPanel;
    const crewStatusPanel = this.crewStatusPanel as CrewStatusPanel;
    const cameraController = this.cameraController as CameraController;
    const bindings = this.collectShipBindings(shipView);
    this.bindings = bindings;
    this.configCatalog = this.createConfigCatalog(bindings);
    this.port = new LocalPlayerStatePort({
      storage: getBrowserKeyValueStorage(),
      configVersion: this.configCatalog.configVersion,
      activeShipId: bindings.blueprint.shipId,
      ships: [bindings.blueprint],
      warn: (message) => warn(`[SAVE] ${message}`),
    });
    this.state = await this.port.bootstrap();
    crewStatusPanel.bind(bindings.blueprint.shipId);
    this.shipView = shipView;
    this.powerPanel = powerPanel;
    this.crewStatusPanel = crewStatusPanel;
    this.cameraController = cameraController;
    this.bindViews();
    this.refreshAll('玩家状态已就绪', false);
    this.tickHandler = () => this.advanceCrewTick();
    this.schedule(this.tickHandler, 0.1);
    log(`[BOOT] 主场景已绑定飞船：${bindings.blueprint.shipId}`);
  }

  private resolvePersistedSceneReferences():
    | { readonly ok: true; readonly shipView: ShipView; readonly powerPanel: PowerPanel; readonly crewStatusPanel: CrewStatusPanel }
    | { readonly ok: false } {
    const scene = this.node.scene;
    const ships = scene?.getComponentsInChildren(ShipView) ?? [];
    const powers = scene?.getComponentsInChildren(PowerPanel) ?? [];
    const crews = scene?.getComponentsInChildren(CrewStatusPanel) ?? [];
    if (ships.length !== 1 || powers.length !== 1 || crews.length !== 1) {
      warn(`[BOOT] 主场景持久组件数量无效：飞船=${ships.length}，能源面板=${powers.length}，船员面板=${crews.length}`);
      return { ok: false };
    }
    return { ok: true, shipView: ships[0], powerPanel: powers[0], crewStatusPanel: crews[0] };
  }

  private createConfigCatalog(bindings: SceneShipBindings): GameConfigCatalog {
    return new GameConfigCatalog({
      configVersion: this.configVersion.trim(),
      hulls: [bindings.blueprint.hull],
      rooms: uniqueDefinitions(bindings.roomDefinitions.values(), '房间'),
      crews: uniqueDefinitions(bindings.crewDefinitions.values(), '船员'),
    });
  }

  private collectShipBindings(shipView: ShipView): SceneShipBindings {
    const authoring = shipView.getAuthoringInspectorState();
    if (!authoring.ok || shipView.roomRoot === null || shipView.crewRoot === null) throw new Error(authoring.message);
    const hull = shipView.getHullDefinition();
    const roomViews = shipView.roomRoot.getComponentsInChildren(RoomView);
    const roomDefinitions = new Map<string, Readonly<RoomDefinition>>();
    const rooms = roomViews.map((view) => {
      const instanceId = view.roomInstanceId.trim();
      if (instanceId === '' || roomDefinitions.has(instanceId)) throw new Error(`房间实例标识为空或重复：${instanceId || '空'}`);
      const parsed = view.resolveRoomDefinition();
      if (parsed.ok === false) throw new Error(`房间 ${instanceId || '空'} 定义无效：${parsed.message}`);
      const parent = view.node.parent;
      if (parent === null) throw new Error(`房间 ${instanceId} 缺少父节点`);
      const position = shipView.parentLocalCenterToGrid(parent, view.node.position, parsed.definition.width, parsed.definition.height);
      if (position === null) throw new Error(`房间 ${instanceId} 无法换算为逻辑格位置`);
      roomDefinitions.set(instanceId, parsed.definition);
      return { instanceId, definition: parsed.definition, ...position };
    });
    const crewViews = shipView.crewRoot.getComponentsInChildren(CrewView);
    const crewDefinitions = new Map<string, Readonly<CrewDefinition>>();
    const crews = crewViews.map((view) => {
      const instanceId = view.crewInstanceId.trim();
      if (instanceId === '' || crewDefinitions.has(instanceId)) throw new Error(`船员实例标识为空或重复：${instanceId || '空'}`);
      const parsed = view.resolveCrewDefinition();
      if (parsed.ok === false) throw new Error(`船员 ${instanceId || '空'} 定义无效：${parsed.message}`);
      const authoringState = view.getAuthoringInspectorState();
      if (!authoringState.ok) throw new Error(authoringState.message);
      crewDefinitions.set(instanceId, parsed.definition);
      return {
        instanceId,
        definition: parsed.definition,
        roomInstanceId: view.initialRoomInstanceId.trim(),
        stationIndex: view.initialStationIndex,
      };
    });
    // 在任何 View/UI 绑定前构造一次聚合根，确保房间重叠、船员容量和导航错误整体失败。
    const blueprint: ShipModelBlueprint = { shipId: shipView.shipId.trim(), hull, rooms, crews };
    return { blueprint, roomViews, crewViews, roomDefinitions, crewDefinitions };
  }

  private bindViews(): void {
    if (this.bindings === null || this.shipView === null || this.cameraController === null) return;
    const snapshot = this.getActiveShipSnapshot();
    const grid = this.createGrid(snapshot);
    for (const view of this.bindings.roomViews) {
      const definition = this.bindings.roomDefinitions.get(view.roomInstanceId.trim());
      const placement = grid.getRooms().find((room) => room.instanceId === view.roomInstanceId.trim());
      if (definition === undefined || placement === undefined) throw new Error(`房间运行时映射不完整：${view.roomInstanceId}`);
      view.bind(
        definition,
        placement,
        this.shipView,
        (command) => this.previewRoomMove(command),
        (command) => this.commitRoomMove(command),
        (blocked) => this.cameraController?.setPanBlocked(blocked),
        (roomId) => { void this.handleRoomClick(roomId); },
      );
    }
  }

  private refreshAll(message = '', animateCrew = true): void {
    if (this.bindings === null || this.shipView === null || this.powerPanel === null || this.crewStatusPanel === null) return;
    const snapshot = this.getActiveShipSnapshot();
    const navigation = this.createNavigation(snapshot);
    const crewStates = this.createCrewReadStates(snapshot, navigation);
    const statesById = new Map(crewStates.map((entry) => [entry.id, entry]));
    for (const view of this.bindings.crewViews) {
      const id = view.crewInstanceId.trim();
      const definition = this.bindings.crewDefinitions.get(id);
      const state = statesById.get(id);
      if (definition === undefined || state === undefined) throw new Error(`船员运行时映射不完整：${id}`);
      view.bind(definition, state, navigation, this.shipView, (crewId) => this.selectCrew(crewId));
      view.setSelected(id === this.selectedCrewId);
      view.refresh(state, animateCrew);
    }
    const selected = this.selectedCrewId === null ? null : statesById.get(this.selectedCrewId) ?? null;
    this.crewStatusPanel.refresh(selected, message);

    const panelRooms = this.createPowerPanelRooms();
    const panelState = this.createPowerPanelState(snapshot);
    this.powerPanel.bind(snapshot.shipId, panelRooms, panelState, (command) => this.handleEnergyCommand(command));
    if (message !== '' && this.powerPanel.statusLabel !== null) this.powerPanel.statusLabel.string = message;
  }

  private previewRoomMove(command: MoveRoomCommand): PlacementValidation {
    const snapshot = this.getActiveShipSnapshot();
    if (snapshot.crews.crews.some((crew) => crew.state === 'MOVING')) return { ok: false, code: 'INVALID_GRID_VALUE' };
    return this.createGrid(snapshot).validateRoomMove(command);
  }

  private async commitRoomMove(command: MoveRoomCommand): Promise<PlacementValidation> {
    const result = await this.execute({
      type: 'MOVE_ROOM',
      shipId: this.getActiveShipSnapshot().shipId,
      roomInstanceId: command.roomInstanceId,
      x: command.x,
      y: command.y,
    });
    if (!result.ok) return { ok: false, code: 'INVALID_GRID_VALUE' };
    this.refreshAll(result.message, false);
    return { ok: true };
  }

  private async handleEnergyCommand(command: EnergyCommand): Promise<PowerPanelCommandResult> {
    const shipId = this.getActiveShipSnapshot().shipId;
    const scoped: ShipCommand = command.type === 'SET_ROOM_POWER'
      ? { type: 'SET_ROOM_POWER', shipId, roomInstanceId: command.roomId, power: command.power }
      : { type: 'RESET_ROOM_POWER', shipId, roomInstanceId: command.roomId };
    const result = await this.execute(scoped);
    const panelState = this.createPowerPanelState(this.getActiveShipSnapshot());
    if (result.ok) this.refreshAll(result.message, false);
    return { ok: result.ok, message: result.message, state: panelState };
  }

  private selectCrew(crewId: string): void {
    this.selectedCrewId = crewId;
    this.refreshAll(`已选择${this.bindings?.crewDefinitions.get(crewId)?.displayName ?? crewId}`, false);
  }

  private async handleRoomClick(targetRoomInstanceId: string): Promise<void> {
    if (this.selectedCrewId === null) {
      this.crewStatusPanel?.refresh(null, '请先点击一名船员');
      return;
    }
    const result = await this.execute({
      type: 'MOVE_CREW',
      shipId: this.getActiveShipSnapshot().shipId,
      crewInstanceId: this.selectedCrewId,
      targetRoomInstanceId,
    });
    this.refreshAll(result.message, false);
  }

  private advanceCrewTick(): void {
    if (this.port === null) return;
    const snapshot = this.getActiveShipSnapshot();
    if (!snapshot.crews.crews.some((crew) => crew.state === 'MOVING')) return;
    const result = this.port.advanceOneTick(snapshot.shipId);
    this.state = result.state;
    this.refreshAll(result.message, true);
    if (!result.ok) {
      error(`[SAVE] ${result.message}`);
      this.stopTick();
    }
  }

  private async execute(command: ShipCommand): Promise<PlayerCommandResult> {
    if (this.port === null || this.state === null) throw new Error('玩家状态端口尚未初始化');
    const result = await this.port.execute({
      requestId: `main-${++this.requestSequence}`,
      expectedRevision: this.state.revision,
      command,
    });
    this.state = result.state;
    if (!result.ok) warn(`[COMMAND] ${result.message}`);
    return result;
  }

  private getActiveShipSnapshot(): ShipSnapshot {
    if (this.state === null) throw new Error('玩家状态尚未初始化');
    const snapshot = this.state.ships.find((ship) => ship.shipId === this.state?.activeShipId);
    if (snapshot === undefined) throw new Error('玩家状态缺少当前飞船');
    return snapshot;
  }

  private createGrid(snapshot: ShipSnapshot): ShipGridModel {
    if (this.bindings === null) throw new Error('场景飞船映射尚未初始化');
    const grid = new ShipGridModel(this.bindings.blueprint.hull);
    for (const room of snapshot.rooms) {
      const definition = this.bindings.roomDefinitions.get(room.instanceId);
      if (definition === undefined || definition.id !== room.definitionId) throw new Error(`未知房间快照：${room.instanceId}`);
      const placed = grid.placeRoom({
        instanceId: room.instanceId,
        definitionId: room.definitionId,
        x: room.x,
        y: room.y,
        width: definition.width,
        height: definition.height,
      });
      if (placed.ok === false) throw new Error(`房间快照布局无效：${room.instanceId}（${placed.code}）`);
    }
    return grid;
  }

  private createNavigation(snapshot: ShipSnapshot): NavigationGraph {
    if (this.bindings === null) throw new Error('场景飞船映射尚未初始化');
    return new NavigationGraph(this.createGrid(snapshot).getRooms(), this.bindings.roomDefinitions);
  }

  private createCrewReadStates(snapshot: ShipSnapshot, navigation: NavigationGraph): CrewReadState[] {
    if (this.bindings === null) return [];
    return snapshot.crews.crews.map((crew) => {
      const definition = this.bindings?.crewDefinitions.get(crew.id);
      if (definition === undefined) throw new Error(`未知船员快照：${crew.id}`);
      const currentNodeId = crew.pathNodeIds[crew.pathIndex] ?? crew.pathNodeIds[crew.pathNodeIds.length - 1];
      const nextNodeId = crew.pathIndex + 1 < crew.pathNodeIds.length ? crew.pathNodeIds[crew.pathIndex + 1] : null;
      if (navigation.getNode(currentNodeId) === null || (nextNodeId !== null && navigation.getNode(nextNodeId) === null)) {
        throw new Error(`船员路径包含无效导航节点：${crew.id}`);
      }
      return {
        ...crew,
        displayName: definition.displayName,
        role: definition.role,
        maxHp: definition.maxHp,
        moveTicksPerEdge: definition.moveTicksPerEdge,
        currentNodeId,
        nextNodeId,
        edgeProgress: nextNodeId === null ? 0 : crew.ticksIntoEdge / definition.moveTicksPerEdge,
      };
    });
  }

  private createPowerPanelRooms(): readonly PowerPanelRoom[] {
    if (this.bindings === null) return [];
    return Array.from(this.bindings.roomDefinitions, ([roomId, definition]) => ({
      roomId,
      displayName: definition.displayName,
      minPower: definition.minPower,
      maxPower: definition.maxPower,
    })).filter((room) => room.maxPower > 0).sort((left, right) => left.roomId.localeCompare(right.roomId));
  }

  private createPowerPanelState(snapshot: ShipSnapshot): PowerPanelState {
    if (this.bindings === null) throw new Error('场景飞船映射尚未初始化');
    return {
      shipId: snapshot.shipId,
      availablePower: Array.from(this.bindings.roomDefinitions.values())
        .reduce((total, definition) => total + definition.powerGeneration, 0),
      allocatedPower: snapshot.energy.allocations.reduce((total, allocation) => total + allocation.power, 0),
      allocations: snapshot.energy.allocations,
    };
  }

  private stopTick(): void {
    if (this.tickHandler !== null) this.unschedule(this.tickHandler);
    this.tickHandler = null;
  }
}

function isUsableComponent(component: Component | null): boolean {
  return component !== null && component.isValid && component.node !== null && component.node.isValid;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 同一定义可供多个实例复用，但同一 ID 的规则内容必须完全一致。 */
function uniqueDefinitions<T extends { readonly id: string }>(values: Iterable<T>, label: string): T[] {
  const definitions = new Map<string, T>();
  for (const value of values) {
    const existing = definitions.get(value.id);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`${label}定义内容冲突：${value.id}`);
    }
    definitions.set(value.id, value);
  }
  return Array.from(definitions.values());
}
