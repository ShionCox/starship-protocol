import { _decorator, Camera, Canvas, Component, director, error, log, Node, Vec3, warn } from 'cc';

import type { ConstructionPreviewRequest, ConstructionPreviewResult, OfflineConstructionSummary, PlayerCommandResult, PlayerStateSnapshot } from '../application/PlayerStatePort';
import { GameConfigCatalog } from '../application/GameConfigCatalog';
import type { CrewDefinition } from '../game-core/CrewDefinition';
import type { CrewReadState } from '../game-core/CrewModel';
import type { EnergyCommand } from '../game-core/EnergyModel';
import { floorNodeId, NavigationGraph, stationNodeId } from '../game-core/NavigationGraph';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import { ShipGridModel } from '../game-core/ShipGridModel';
import type { ShipCommand, ShipModelBlueprint, ShipSnapshot } from '../game-core/ShipModel';
import { CameraController } from '../input/CameraController';
import {
  CrewStatusPanel,
  type CrewTaskPanelCommand,
  type CrewStatusRoomState,
  type CrewStatusTelemetry,
} from '../presentation/CrewStatusPanel';
import { CrewView } from '../presentation/CrewView';
import { BuildPageController, type BuildPageIntent } from '../presentation/BuildPageController';
import { FloorView } from '../presentation/FloorView';
import { GameConfigCsvSource } from '../presentation/GameConfigCsvSource';
import { PowerPanel, type PowerPanelCommandResult, type PowerPanelRoom, type PowerPanelState } from '../presentation/PowerPanel';
import { RoomView } from '../presentation/RoomView';
import { ShipView } from '../presentation/ShipView';
import { ShipContentViewSync } from '../presentation/ShipContentViewSync';
import { ConstructionGhostView } from '../presentation/ConstructionGhostView';
import { DemolitionConfirmDialog } from '../presentation/DemolitionConfirmDialog';
import { OfflineSettlementDialog } from '../presentation/OfflineSettlementDialog';
import { MainPageRouter } from '../presentation/MainPageRouter';
import {
  WorldInteractionController,
  type WorldContextActionId,
  type WorldContextActionState,
  type WorldContextTarget,
  type WorldSelection,
  type BuildDragRequest,
  type BuildPlacementPreview,
} from '../presentation/WorldInteractionController';
import type { ParsedGameConfig } from '../game-core/CsvGameConfig';
import { getBrowserKeyValueStorage, LocalPlayerStatePort } from './LocalPlayerStatePort';
import { configureGameDisplay, GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from './configureGameDisplay';

const { ccclass, menu, property } = _decorator;

interface SceneShipBindings {
  readonly blueprint: ShipModelBlueprint;
  readonly roomViews: readonly RoomView[];
  readonly crewViews: readonly CrewView[];
  readonly roomDefinitions: ReadonlyMap<string, Readonly<RoomDefinition>>;
  readonly crewDefinitions: ReadonlyMap<string, Readonly<CrewDefinition>>;
  readonly config: Readonly<ParsedGameConfig>;
}

/**
 * MainScene 的应用装配入口。它只连接 Creator 已持久保存的 ShipView、UIRoot 和公共 UI 模块；
 * 主页面由 MainPageRouter 管理 MainScreen 中的五个持久节点，缺失引用时立即停止。
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

  @property({ type: MainPageRouter, displayName: '主界面页面路由', tooltip: 'MainScreen Prefab 中负责五个持久页面切换的路由。', group: '场景引用' })
  public mainPageRouter: MainPageRouter | null = null;

  @property({ type: BuildPageController, displayName: '建造页面控制', tooltip: 'MainScreen 中持久建造页面的控制组件；切页只切换节点 active。', group: '场景引用' })
  public buildPageController: BuildPageController | null = null;

  @property({ type: CameraController, displayName: '镜头控制', tooltip: '绑定当前 MainScene 世界根与画布的镜头控制组件。', group: '场景引用' })
  public cameraController: CameraController | null = null;

  @property({ type: ShipContentViewSync, displayName: '动态内容同步', tooltip: '当前 ShipView 的地板、施工和玩家建造内容表现同步器。', group: '场景引用' })
  public contentViewSync: ShipContentViewSync | null = null;

  @property({ type: WorldInteractionController, displayName: '世界交互控制', tooltip: 'UIRoot 中持久保存的选择、悬浮和右键菜单协调器。', group: '场景引用' })
  public worldInteractionController: WorldInteractionController | null = null;

  @property({ type: DemolitionConfirmDialog, displayName: '拆除确认弹窗', tooltip: '拆除房间或地板前必须显示并确认的持久弹窗。', group: '场景引用' })
  public demolitionConfirmDialog: DemolitionConfirmDialog | null = null;

  @property({ type: OfflineSettlementDialog, displayName: '离线结算弹窗', tooltip: '主场景初始化后一次性显示离线施工结算摘要。', group: '场景引用' })
  public offlineSettlementDialog: OfflineSettlementDialog | null = null;

  @property({ displayName: '本地配置版本', tooltip: '开发期玩家状态 Envelope 使用的配置版本。规则变化不兼容时修改此值。', group: '开发状态' })
  public configVersion = 'r1-p8-close-1';

  private port: LocalPlayerStatePort | null = null;
  private state: PlayerStateSnapshot | null = null;
  private bindings: SceneShipBindings | null = null;
  private configCatalog: GameConfigCatalog | null = null;
  private selectedCrewId: string | null = null;
  private requestSequence = 0;
  private tickHandler: (() => void) | null = null;
  private constructionTickHandler: (() => void) | null = null;
  private offlineConstruction: OfflineConstructionSummary | undefined;
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
    cameraNode.setPosition(new Vec3(GAME_DESIGN_WIDTH / 2, GAME_DESIGN_HEIGHT / 2, 1000));
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
    // 引用必须由编辑器公开 set-property 持久写入；运行时不再扫描场景树猜测归属。
    const missing = [
      !isUsableComponent(this.shipView) ? '飞船视图' : '',
      !isUsableComponent(this.powerPanel) ? '能源面板' : '',
      !isUsableComponent(this.crewStatusPanel) ? '船员状态面板' : '',
      !isUsableComponent(this.mainPageRouter) ? '主界面页面路由' : '',
      !isUsableComponent(this.buildPageController) ? '建造页面控制' : '',
      !isUsableComponent(this.cameraController) ? '镜头控制' : '',
      !isUsableComponent(this.contentViewSync) ? '动态内容同步' : '',
      !isUsableComponent(this.worldInteractionController) ? '世界交互控制' : '',
      !isUsableComponent(this.demolitionConfirmDialog) ? '拆除确认弹窗' : '',
      !isUsableComponent(this.offlineSettlementDialog) ? '离线结算弹窗' : '',
    ].filter((name) => name !== '');
    if (missing.length > 0) return { ok: false, message: `主场景 Bootstrap 引用未持久绑定：${missing.join('、')}` };
    if ((this.cameraController as CameraController).worldRoot === null) return { ok: false, message: '镜头控制组件缺少世界根节点引用' };
    const source = this.getComponent(GameConfigCsvSource);
    if (source === null || !source.hasCompleteBinding() || !source.resolve().ok) {
      return { ok: false, message: '主场景应用根缺少完整且有效的九张权威 CSV 来源' };
    }
    if ((this.shipView as ShipView).configSource !== source) {
      return { ok: false, message: '主场景飞船视图未指向应用根权威 CSV 来源' };
    }
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
    // 所有跨 Prefab 引用都必须在 Creator 中持久化；运行时不能扫描整棵场景树猜测引用。
    const missing = [
      !isUsableComponent(this.shipView) ? '飞船视图' : '',
      !isUsableComponent(this.powerPanel) ? '能源面板' : '',
      !isUsableComponent(this.crewStatusPanel) ? '船员状态面板' : '',
      !isUsableComponent(this.mainPageRouter) ? '主界面页面路由' : '',
      !isUsableComponent(this.buildPageController) ? '建造页面控制' : '',
      !isUsableComponent(this.cameraController) ? '镜头控制' : '',
      !isUsableComponent(this.contentViewSync) ? '动态内容同步' : '',
      !isUsableComponent(this.worldInteractionController) ? '世界交互控制' : '',
      !isUsableComponent(this.demolitionConfirmDialog) ? '拆除确认弹窗' : '',
      !isUsableComponent(this.offlineSettlementDialog) ? '离线结算弹窗' : '',
    ].filter((name) => name !== '');
    if (missing.length > 0) {
      throw new Error(`主场景缺少可用持久组件：${missing.join('、')}`);
    }
    const shipView = this.shipView as ShipView;
    const source = this.getComponent(GameConfigCsvSource);
    if (source === null || !source.hasCompleteBinding()) throw new Error('主场景应用根缺少完整的九张权威 CSV 来源');
    const sourceResult = source.resolve();
    if (sourceResult.ok === false) throw new Error(`主场景权威 CSV 校验失败：${sourceResult.message}`);
    if (shipView.configSource !== source) throw new Error('主场景飞船视图未指向应用根权威 CSV 来源');
    const powerPanel = this.powerPanel as PowerPanel;
    const crewStatusPanel = this.crewStatusPanel as CrewStatusPanel;
    const cameraController = this.cameraController as CameraController;
    const worldInteractionController = this.worldInteractionController as WorldInteractionController;
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
    const bootstrapResult = await this.port.bootstrap();
    this.state = bootstrapResult.state;
    this.offlineConstruction = bootstrapResult.offlineConstruction;
    crewStatusPanel.bind(bindings.blueprint.shipId, (command) => this.handleCrewTaskCommand(command));
    this.shipView = shipView;
    this.powerPanel = powerPanel;
    this.crewStatusPanel = crewStatusPanel;
    this.cameraController = cameraController;
    this.worldInteractionController = worldInteractionController;
    if (this.offlineConstruction !== undefined) this.offlineSettlementDialog?.show(this.offlineConstruction);
    this.bindWorldInteraction(worldInteractionController, cameraController, shipView);
    this.bindViews();
    this.refreshAll('玩家状态已就绪', false);
    this.tickHandler = () => this.advanceShipTick();
    this.schedule(this.tickHandler, 0.1);
    this.constructionTickHandler = () => this.advanceConstructionTime();
    this.schedule(this.constructionTickHandler, 1);
    log(`[BOOT] 主场景已绑定飞船：${bindings.blueprint.shipId}`);
  }

  private createConfigCatalog(bindings: SceneShipBindings): GameConfigCatalog {
    return new GameConfigCatalog({
      configVersion: bindings.blueprint.configVersion ?? this.configVersion.trim(),
      hulls: bindings.config.hulls,
      rooms: bindings.config.rooms,
      crews: bindings.config.crews,
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
      if (!Number.isInteger(view.initialHp) || view.initialHp < -1 || view.initialHp > parsed.definition.maxHp) {
        throw new Error(`房间 ${instanceId} 初始耐久必须是 -1 或 0 到 ${parsed.definition.maxHp} 的整数`);
      }
      return {
        instanceId,
        definition: parsed.definition,
        hp: view.initialHp === -1 ? parsed.definition.maxHp : view.initialHp,
        ...position,
      };
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
        hp: view.initialHp === -1 ? parsed.definition.maxHp : view.initialHp,
        identity: view.nameMode === 'FIXED'
          ? { nameMode: 'FIXED' as const, callSign: view.callSign.trim() }
          : { nameMode: 'GENERATED' as const },
      };
    });
    // 在任何 View/UI 绑定前构造一次聚合根，确保房间重叠、船员容量和导航错误整体失败。
    const config = shipView.configSource?.getConfig();
    if (config === undefined) throw new Error('飞船视图缺少权威 CSV 配置来源');
    const floorViews = shipView.floorRoot?.getComponentsInChildren(FloorView) ?? [];
    if (floorViews.length === 0) throw new Error('当前飞船缺少持久初始地板，请先运行 P8 场景装配');
    const floors = floorViews.map((view) => {
      const parent = view.node.parent;
      const position = parent === null ? null : shipView.parentLocalCenterToGrid(parent, view.node.position, 1, 1);
      if (position === null || view.floorInstanceId.trim() === '') throw new Error(`初始地板实例无效：${view.node.name}`);
      return { instanceId: view.floorInstanceId.trim(), definitionId: view.floorDefinitionId.trim(), ...position };
    });
    const traits = new Map(config.crewTraits.map((trait) => [trait.id, trait]));
    const crewProfiles = crews.map((crew) => ({
      crewId: crew.instanceId,
      role: crew.definition.role,
      speedBonusPermille: crew.definition.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SPEED_PERMILLE' ? traits.get(id)?.effectValue ?? 0 : 0), 0),
      slotBonus: crew.definition.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SLOT_BONUS' ? traits.get(id)?.effectValue ?? 0 : 0), 0),
    }));
    const blueprint: ShipModelBlueprint = {
      shipId: shipView.shipId.trim(), configVersion: config.configVersion, hull, rooms, floors,
      crews: crews.map((crew, index) => ({ ...crew, patrolRoomIds: crewViews[index]?.patrolRoomInstanceIds.map((id) => id.trim()).filter((id) => id !== '') })),
      construction: { initialMetal: config.initialMetal, floorDefinitions: config.floors, roomDefinitions: config.rooms, connectorPorts: config.connectorPorts, crewProfiles },
    };
    return { blueprint, roomViews, crewViews, roomDefinitions, crewDefinitions, config };
  }

  private bindViews(): void {
    if (this.bindings === null || this.shipView === null || this.cameraController === null) return;
    const snapshot = this.getActiveShipSnapshot();
    if (this.contentViewSync !== null && !this.contentViewSync.sync(snapshot, this.bindings.config)) throw new Error('飞船动态内容同步失败');
    this.bindRoomViews(snapshot);
  }

  private bindRoomViews(snapshot: ShipSnapshot): void {
    if (this.bindings === null || this.shipView === null || this.cameraController === null) return;
    const grid = this.createGrid(snapshot);
    const currentRoomViews = this.shipView.roomRoot?.getComponentsInChildren(RoomView) ?? [];
    for (const view of currentRoomViews) {
      const roomSnapshot = snapshot.rooms.find((room) => room.instanceId === view.roomInstanceId.trim());
      const definition = roomSnapshot === undefined ? undefined : this.bindings.config.rooms.find((entry) => entry.id === roomSnapshot.definitionId);
      const placement = grid.getRooms().find((room) => room.instanceId === view.roomInstanceId.trim());
      // 拆除完成后规则快照会先移除房间，但场景中的 RoomView 是持久实例，不能在运行期创建/销毁。
      // 将已不存在的实例停用即可避免下一次刷新把陈旧节点误当成有效房间；同一实例以后重新建造时会重新启用并绑定。
      if (definition === undefined || placement === undefined) {
        view.node.active = false;
        continue;
      }
      view.node.active = true;
      view.bind(
        definition,
        placement,
        this.shipView,
        (roomId) => this.worldInteractionController?.selectObject('ROOM', roomId),
        (roomId, event) => this.worldInteractionController?.openObjectContext('ROOM', roomId, event),
      );
    }
  }

  private bindWorldInteraction(
    interaction: WorldInteractionController,
    cameraController: CameraController,
    shipView: ShipView,
  ): void {
    if (cameraController.canvasRoot === null) throw new Error('镜头控制缺少持久画布根节点');
    if (cameraController.camera === null) throw new Error('镜头控制缺少持久主相机引用');
    interaction.bind({
      canvasRoot: cameraController.canvasRoot,
      camera: cameraController.camera,
      shipView,
      onSelectionChanged: (selection) => this.handleWorldSelectionChanged(selection),
      resolveActions: (selection, target) => this.resolveWorldContextActions(selection, target),
      executeAction: (actionId, selection, target) => this.executeWorldContextAction(actionId, selection, target),
      confirmAction: (actionId, target) => this.confirmWorldContextAction(actionId, target),
      previewBuild: (request) => this.previewBuildPlacement(request),
      commitBuild: (request) => this.commitBuildPlacement(request),
      setCameraPanBlocked: (blocked) => cameraController.setPanBlocked(blocked),
      onBuildPreviewMessage: (message) => this.buildPageController?.setStatus(message),
    });
    this.contentViewSync?.bindInteraction(
      (jobId) => interaction.selectObject('CONSTRUCTION', jobId),
      (jobId, event) => interaction.openObjectContext('CONSTRUCTION', jobId, event),
    );
  }

  private async previewBuildPlacement(request: BuildDragRequest): Promise<BuildPlacementPreview> {
    const ship = this.getActiveShipSnapshot();
    const previewRequest: ConstructionPreviewRequest = {
      shipId: ship.shipId,
      definitionKind: request.definitionKind,
      definitionId: request.definitionId,
      x: request.x,
      y: request.y,
    };
    if (this.port === null) return { ok: false, message: '玩家状态端口尚未初始化', width: request.width, height: request.height };
    const result: ConstructionPreviewResult = await this.port.previewConstruction(previewRequest);
    return { ok: result.ok, message: result.message, width: result.width, height: result.height, revision: result.revision };
  }

  private async commitBuildPlacement(request: BuildDragRequest): Promise<{ readonly ok: boolean; readonly message: string }> {
    return this.handleBuildIntent({
      type: 'START_BUILD',
      definitionKind: request.definitionKind,
      definitionId: request.definitionId,
      x: request.x,
      y: request.y,
    });
  }

  private refreshAll(message = '', animateCrew = true): void {
    if (this.bindings === null || this.shipView === null || this.powerPanel === null || this.crewStatusPanel === null) return;
    const snapshot = this.getActiveShipSnapshot();
    if (this.contentViewSync !== null && !this.contentViewSync.sync(snapshot, this.bindings.config)) throw new Error('飞船动态内容同步失败');
    this.bindRoomViews(snapshot);
    const navigation = this.createNavigation(snapshot);
    const crewStates = this.createCrewReadStates(snapshot, navigation);
    const statesById = new Map(crewStates.map((entry) => [entry.id, entry]));
    for (const view of this.bindings.crewViews) {
      const id = view.crewInstanceId.trim();
      const definition = this.bindings.crewDefinitions.get(id);
      const state = statesById.get(id);
      if (definition === undefined || state === undefined) throw new Error(`船员运行时映射不完整：${id}`);
      view.bind(
        definition,
        state,
        navigation,
        this.shipView,
        (crewId) => this.selectCrew(crewId),
        (crewId, event) => this.worldInteractionController?.openObjectContext('CREW', crewId, event),
      );
      view.setSelected(id === this.selectedCrewId);
      view.refresh(state, animateCrew);
    }
    const selected = this.selectedCrewId === null ? null : statesById.get(this.selectedCrewId) ?? null;
    const repairingRoomIds = new Set(snapshot.crews.crews
      .filter((crew) => crew.state === 'REPAIRING' && crew.targetRoomId !== null)
      .map((crew) => crew.targetRoomId as string));
    const currentRoomViews = this.shipView.roomRoot?.getComponentsInChildren(RoomView) ?? [];
    for (const view of currentRoomViews) {
      const roomId = view.roomInstanceId.trim();
      const room = snapshot.rooms.find((entry) => entry.instanceId === roomId);
      const roomDefinition = room === undefined ? undefined : this.bindings.config.rooms.find((definition) => definition.id === room.definitionId);
      // getComponentsInChildren 可能仍返回刚被停用的持久实例；拆除完成后保持它隐藏，
      // 不把已从权威快照移除的房间当成运行时错误。
      if (room === undefined) {
        view.node.active = false;
        continue;
      }
      view.node.active = true;
      const allocation = snapshot.energy.allocations.find((entry) => entry.roomId === roomId);
      view.refreshRuntimeState(room.hp, repairingRoomIds.has(roomId), roomDefinition !== undefined
        && (allocation?.power ?? 0) >= roomDefinition.minPower
        && (allocation?.power ?? 0) > 0);
      const selection = this.worldInteractionController?.getSelection();
      view.setSelected(selection?.kind === 'ROOM' && selection.id === roomId);
    }
    const selection = this.worldInteractionController?.getSelection();
    for (const ghost of this.shipView.constructionRoot?.getComponentsInChildren(ConstructionGhostView) ?? []) {
      ghost.setSelected(selection?.kind === 'CONSTRUCTION' && selection.id === ghost.node.name);
    }
    const selectedRoom = this.createCrewStatusRoom(selected, snapshot);
    this.crewStatusPanel.refresh(
      selected,
      selectedRoom,
      this.findAvailableMedicId(selected, selectedRoom, crewStates),
      message,
      this.createCrewStatusTelemetry(selected, snapshot, navigation),
    );

    const panelRooms = this.createPowerPanelRooms();
    const panelState = this.createPowerPanelState(snapshot);
    this.powerPanel.bind(snapshot.shipId, panelRooms, panelState, (command) => this.handleEnergyCommand(command));
    this.bindBuildPage(snapshot);
    if (message !== '' && this.powerPanel.statusLabel !== null) this.powerPanel.statusLabel.string = message;
  }

  private bindBuildPage(snapshot: ShipSnapshot): void {
    if (this.bindings === null || this.buildPageController === null) return;
    this.buildPageController.bind({
      config: this.bindings.config,
      snapshot,
      metal: this.state?.metal ?? 0,
      constructionSlots: Math.min(8, this.bindings.blueprint.hull.baseConstructionSlots
        + (this.bindings.blueprint.construction?.crewProfiles.reduce((sum, crew) => sum + crew.slotBonus, 0) ?? 0)),
      catalog: this.contentViewSync?.catalog ?? null,
      selectedConstructionJobId: this.worldInteractionController?.getSelection()?.kind === 'CONSTRUCTION'
        ? this.worldInteractionController.getSelection()?.id ?? null
        : null,
    }, (intent) => this.handleBuildIntent(intent), (option) => {
      this.worldInteractionController?.beginBuildDrag({
        definitionKind: option.kind,
        definitionId: option.id,
        width: option.width,
        height: option.height,
      });
    }, () => this.worldInteractionController?.cancelBuildDrag('已离开建造页面'));
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

  private async handleCrewTaskCommand(command: CrewTaskPanelCommand): Promise<void> {
    const shipId = this.getActiveShipSnapshot().shipId;
    let scoped: ShipCommand;
    if (command.type === 'START_REPAIR') scoped = { type: 'START_REPAIR', shipId, crewInstanceId: command.crewId, roomInstanceId: command.roomId };
    else if (command.type === 'STOP_REPAIR') scoped = { type: 'STOP_REPAIR', shipId, crewInstanceId: command.crewId };
    else if (command.type === 'START_HEAL') scoped = {
      type: 'START_HEAL', shipId, patientCrewInstanceId: command.patientCrewId,
      medicCrewInstanceId: command.medicCrewId, roomInstanceId: command.roomId,
    };
    else scoped = { type: 'STOP_HEAL', shipId, patientCrewInstanceId: command.patientCrewId };
    const result = await this.execute(scoped);
    this.refreshAll(result.message, false);
  }

  private selectCrew(crewId: string): void {
    this.worldInteractionController?.selectObject('CREW', crewId);
  }

  private handleWorldSelectionChanged(selection: WorldSelection | null): void {
    this.selectedCrewId = selection?.kind === 'CREW' ? selection.id : null;
    if (selection === null) {
      this.refreshAll('已取消选择', false);
      return;
    }
    if (selection.kind === 'CREW') {
      const selected = this.getActiveShipSnapshot().crews.crews.find((crew) => crew.id === selection.id);
      this.refreshAll(`已选择${selected?.callSign ?? selection.id}`, false);
    } else {
      this.refreshAll(`已选择${selection.kind === 'ROOM' ? '房间' : '施工项目'}：${selection.id}`, false);
    }
  }

  private resolveWorldContextActions(
    selection: WorldSelection | null,
    target: WorldContextTarget,
  ): readonly WorldContextActionState[] {
    const snapshot = this.getActiveShipSnapshot();
    const crew = selection?.kind === 'CREW'
      ? snapshot.crews.crews.find((entry) => entry.id === selection.id) ?? null
      : null;
    const definition = crew === null ? null : this.bindings?.crewDefinitions.get(crew.id) ?? null;
    const navigation = this.createNavigation(snapshot);
    const actions: WorldContextActionState[] = [];
    const noCrewReason = selection === null ? '请先选择一名船员' : selection.kind !== 'CREW' ? '当前选择不是船员' : '船员不存在';
    const targetNodeId = crew === null ? null : this.resolveContextTargetNode(target, crew.id, snapshot, navigation);
    const reachable = crew !== null && definition !== null && targetNodeId !== null
      && navigation.findPath(crew.currentNodeId, targetNodeId, definition.moveTicksPerEdge).ok;
    const targetOccupied = crew !== null && targetNodeId !== null && snapshot.crews.crews.some((entry) =>
      entry.id !== crew.id && (entry.currentNodeId === targetNodeId || entry.targetNodeId === targetNodeId),
    );

    if (target.kind === 'GRID' || target.kind === 'ROOM') {
      const demolition = this.getDemolitionTarget(target, snapshot);
      const demolitionReason = demolition === null ? (target.kind === 'GRID' ? '该网格没有已完成地板' : '目标房间不存在')
        : demolition.reason;
      actions.push(actionState('DEMOLISH', '开始拆除', demolition !== null && demolitionReason === '', demolitionReason));
    }

    if (target.kind === 'GRID' || target.kind === 'ROOM') {
      const targetNode = targetNodeId === null ? null : navigation.getNode(targetNodeId);
      const moveReason = crew === null ? noCrewReason
        : targetNode === null ? target.kind === 'GRID' ? '该站立格下方没有已完成地板' : '目标房间没有空闲站位'
          : targetOccupied ? '目标站位已被其他船员占用'
            : !reachable ? '目标不可达' : '';
      actions.push(actionState('MOVE', '移动到这里', moveReason === '', moveReason));
    }

    if (target.kind === 'ROOM') {
      const room = snapshot.rooms.find((entry) => entry.instanceId === target.id);
      const roomDefinition = room === undefined ? undefined : this.bindings?.config.rooms.find((entry) => entry.id === room.definitionId);
      const repairReason = crew === null || definition === null ? noCrewReason
        : definition.role !== 'ENGINEER' || definition.repairHpPerTick <= 0 ? '只有工程师可以维修'
          : room === undefined || roomDefinition === undefined ? '房间不存在'
            : room.hp >= roomDefinition.maxHp ? '房间耐久已满'
              : targetNodeId === null || !reachable ? '工程师无法到达该房间' : '';
      actions.push(actionState('REPAIR', '前往并维修', repairReason === '', repairReason));

      const allocatedPower = room === undefined ? 0 : snapshot.energy.allocations.find((entry) => entry.roomId === room.instanceId)?.power ?? 0;
      const medic = crew === null ? null : snapshot.crews.crews
        .filter((entry) => entry.id !== crew.id)
        .filter((entry) => this.bindings?.crewDefinitions.get(entry.id)?.role === 'MEDIC')
        .filter((entry) => entry.state === 'IDLE' || entry.state === 'PATROLLING' || entry.state === 'CONSTRUCTING')
        .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
      const healReason = crew === null || definition === null ? noCrewReason
        : crew.hp >= definition.maxHp ? '船员生命已满'
          : roomDefinition === undefined || roomDefinition.healingHpPerTick <= 0 ? '请先前往医疗室'
            : allocatedPower < roomDefinition.minPower ? '医疗室能源不足'
              : medic === null ? '没有可用医务员'
                : targetNodeId === null || !reachable ? '病员无法到达医疗室' : '';
      actions.push(actionState('HEAL', '前往并接受治疗', healReason === '', healReason));
    }

    if (target.kind === 'CONSTRUCTION') {
      const job = snapshot.constructionJobs.find((entry) => entry.jobId === target.id);
      const constructReason = crew === null || definition === null ? noCrewReason
        : definition.role !== 'ENGINEER' ? '只有工程师可以参与施工'
          : job === undefined ? '施工项目不存在'
            : job.assignedCrewIds.indexOf(crew.id) >= 0 ? '工程师已分配到该项目'
              : job.assignedCrewIds.length >= 3 ? '施工人员已满'
                : crew.constructionJobId !== null && crew.constructionJobId !== job.jobId ? '工程师已在其他施工项目'
                  : ['IDLE', 'PATROLLING', 'CONSTRUCTING'].indexOf(crew.state) < 0 ? '工程师正在执行其他任务' : '';
      actions.push(actionState('CONSTRUCT', '前往并施工', constructReason === '', constructReason));
    }

    if (crew !== null) {
      const isMoving = crew.state === 'MOVING' || crew.state === 'PATROLLING';
      const moveOnly = crew.activeOrder?.type === 'MOVE' || crew.state === 'PATROLLING';
      if (isMoving && moveOnly) actions.push(actionState('STOP_MOVE', '停止移动', true, ''));
      if ((crew.activeOrder !== null && !moveOnly)
        || crew.state === 'REPAIRING' || crew.state === 'HEALING' || crew.state === 'TREATING' || crew.state === 'CONSTRUCTING') {
        actions.push(actionState('STOP_TASK', '停止当前任务', true, ''));
      }
      if (crew.constructionJobId !== null) actions.push(actionState('LEAVE_CONSTRUCTION', '离开施工', true, ''));
      if (definition?.role === 'SOLDIER' && crew.patrolRoomIds.length > 0) {
        actions.push(actionState('TOGGLE_PATROL', crew.patrolEnabled ? '暂停巡逻' : '恢复巡逻', true, ''));
      }
    }
    return actions;
  }

  private async executeWorldContextAction(
    actionId: WorldContextActionId,
    selection: WorldSelection | null,
    target: WorldContextTarget,
  ): Promise<void> {
    if (actionId === 'DEMOLISH') {
      const ship = this.getActiveShipSnapshot();
      const demolition = this.getDemolitionTarget(target, ship);
      if (demolition === null || demolition.reason !== '') {
        this.refreshAll(demolition?.reason ?? '当前目标不能拆除', false);
        return;
      }
      const suffix = `${Date.now()}-${++this.requestSequence}`;
      const result = await this.execute({
        type: 'START_DEMOLITION',
        shipId: ship.shipId,
        jobId: `job-demolition-${suffix}`,
        targetInstanceId: demolition.targetInstanceId,
        targetType: demolition.targetType,
        nowUnixMs: Date.now(),
      });
      this.refreshAll(result.message, false);
      return;
    }
    if (selection?.kind !== 'CREW') {
      this.refreshAll('请先选择一名船员', false);
      return;
    }
    const ship = this.getActiveShipSnapshot();
    const crew = ship.crews.crews.find((entry) => entry.id === selection.id);
    if (crew === undefined) return;
    let command: ShipCommand | null = null;
    if (actionId === 'MOVE') {
      const targetNodeId = this.resolveContextTargetNode(target, crew.id, ship, this.createNavigation(ship));
      if (targetNodeId !== null) command = { type: 'ISSUE_MOVE_ORDER', shipId: ship.shipId, crewInstanceId: crew.id, targetNodeId };
    } else if (actionId === 'REPAIR' && target.kind === 'ROOM') {
      command = { type: 'ISSUE_REPAIR_ORDER', shipId: ship.shipId, crewInstanceId: crew.id, roomInstanceId: target.id };
    } else if (actionId === 'HEAL' && target.kind === 'ROOM') {
      const medic = ship.crews.crews
        .filter((entry) => entry.id !== crew.id)
        .filter((entry) => this.bindings?.crewDefinitions.get(entry.id)?.role === 'MEDIC')
        .filter((entry) => entry.state === 'IDLE' || entry.state === 'PATROLLING' || entry.state === 'CONSTRUCTING')
        .sort((left, right) => left.id.localeCompare(right.id))[0];
      if (medic !== undefined) command = {
        type: 'ISSUE_HEAL_ORDER',
        shipId: ship.shipId,
        patientCrewInstanceId: crew.id,
        medicCrewInstanceId: medic.id,
        roomInstanceId: target.id,
      };
    } else if (actionId === 'CONSTRUCT' && target.kind === 'CONSTRUCTION') {
      const job = ship.constructionJobs.find((entry) => entry.jobId === target.id);
      if (job !== undefined) command = {
        type: 'ASSIGN_BUILDERS',
        shipId: ship.shipId,
        jobId: job.jobId,
        crewInstanceIds: Array.from(new Set([...job.assignedCrewIds, crew.id])).sort((left, right) => left.localeCompare(right)),
      };
    } else if (actionId === 'STOP_MOVE' || actionId === 'STOP_TASK') {
      command = { type: 'CANCEL_CREW_ORDER', shipId: ship.shipId, crewInstanceId: crew.id };
    } else if (actionId === 'LEAVE_CONSTRUCTION') {
      command = { type: 'LEAVE_CONSTRUCTION', shipId: ship.shipId, crewInstanceId: crew.id };
    } else if (actionId === 'TOGGLE_PATROL') {
      command = { type: 'SET_PATROL_ENABLED', shipId: ship.shipId, crewInstanceId: crew.id, enabled: !crew.patrolEnabled };
    }
    if (command === null) {
      this.refreshAll('当前目标不能执行该操作', false);
      return;
    }
    const result = await this.execute(command);
    this.refreshAll(result.message, false);
  }

  private async confirmWorldContextAction(actionId: WorldContextActionId, target: WorldContextTarget): Promise<boolean> {
    if (actionId !== 'DEMOLISH' || this.demolitionConfirmDialog === null) return false;
    const demolition = this.getDemolitionTarget(target, this.getActiveShipSnapshot());
    if (demolition === null || demolition.reason !== '') return false;
    return await this.demolitionConfirmDialog.request({
      targetId: demolition.targetInstanceId,
      targetType: demolition.targetType,
      message: `确认拆除${demolition.displayName}？预计耗时 ${demolition.durationMs}ms，完成后按规则退款。`,
    });
  }

  private getDemolitionTarget(
    target: WorldContextTarget,
    snapshot: ShipSnapshot,
  ): { readonly targetType: 'FLOOR' | 'ROOM'; readonly targetInstanceId: string; readonly displayName: string; readonly durationMs: number; readonly reason: string } | null {
    const slots = this.bindings === null ? 0 : Math.min(8, this.bindings.blueprint.hull.baseConstructionSlots
      + (this.bindings.blueprint.construction?.crewProfiles.reduce((sum, crew) => sum + crew.slotBonus, 0) ?? 0));
    if (target.kind === 'GRID') {
      const floor = snapshot.floors.find((entry) =>
        (entry.x === target.position.x && entry.y === target.position.y)
        || (entry.x === target.position.x && entry.y + 1 === target.position.y),
      );
      if (floor === undefined) return null;
      const floorDefinition = this.bindings?.config.floors.find((entry) => entry.id === floor.definitionId);
      if (snapshot.constructionJobs.length >= slots) {
        return { targetType: 'FLOOR', targetInstanceId: floor.instanceId, displayName: '地板', durationMs: floorDefinition?.demolishDurationMs ?? 1000, reason: '施工槽已满' };
      }
      if (snapshot.constructionJobs.some((job) => job.targetInstanceId === floor.instanceId || (job.x === floor.x && job.y === floor.y))) {
        return { targetType: 'FLOOR', targetInstanceId: floor.instanceId, displayName: '地板', durationMs: 0, reason: '目标已被施工预留' };
      }
      const occupant = this.createGrid(snapshot).getOccupant(floor.x, floor.y);
      if (occupant !== null) return { targetType: 'FLOOR', targetInstanceId: floor.instanceId, displayName: '地板', durationMs: 0, reason: '地板支撑房间，不能拆除' };
      return { targetType: 'FLOOR', targetInstanceId: floor.instanceId, displayName: '地板', durationMs: 1000, reason: '' };
    }
    if (target.kind !== 'ROOM') return null;
    const room = snapshot.rooms.find((entry) => entry.instanceId === target.id);
    if (room === undefined) return null;
    const definition = this.bindings?.config.rooms.find((entry) => entry.id === room.definitionId);
    if (definition === undefined) return null;
    if (snapshot.constructionJobs.length >= slots) {
      return { targetType: 'ROOM', targetInstanceId: room.instanceId, displayName: definition.displayName, durationMs: definition.demolishDurationMs, reason: '施工槽已满' };
    }
    if (snapshot.crews.crews.some((crew) => crew.currentRoomId === room.instanceId || crew.targetRoomId === room.instanceId)) {
      return { targetType: 'ROOM', targetInstanceId: room.instanceId, displayName: definition.displayName, durationMs: definition.demolishDurationMs, reason: '房间仍有船员或相关任务' };
    }
    if ((snapshot.energy.allocations.find((entry) => entry.roomId === room.instanceId)?.power ?? 0) > 0) {
      return { targetType: 'ROOM', targetInstanceId: room.instanceId, displayName: definition.displayName, durationMs: definition.demolishDurationMs, reason: '目标房间已供电，请先断电' };
    }
    if (snapshot.constructionJobs.some((job) => job.targetInstanceId === room.instanceId)) {
      return { targetType: 'ROOM', targetInstanceId: room.instanceId, displayName: definition.displayName, durationMs: definition.demolishDurationMs, reason: '目标已被施工预留' };
    }
    return { targetType: 'ROOM', targetInstanceId: room.instanceId, displayName: definition.displayName, durationMs: definition.demolishDurationMs, reason: '' };
  }

  private resolveContextTargetNode(
    target: WorldContextTarget,
    selectedCrewId: string,
    snapshot: ShipSnapshot,
    navigation: NavigationGraph,
  ): string | null {
    if (target.kind === 'GRID') {
      // 玩家点击的是“船员脚底要站的位置”。点击地板上方的空气格时，
      // 应落到正下方已完成地板；直接点中地板格仍保持原有行为。
      for (const y of [target.position.y - 1, target.position.y]) {
        const nodeId = floorNodeId(target.position.x, y);
        if (navigation.getNode(nodeId)?.kind === 'FLOOR') return nodeId;
      }
      return null;
    }
    if (target.kind !== 'ROOM') return null;
    const occupied = new Set(snapshot.crews.crews
      .filter((crew) => crew.id !== selectedCrewId)
      .map((crew) => crew.targetNodeId ?? crew.currentNodeId));
    const count = navigation.getRoomStationCount(target.id) ?? 0;
    for (let index = 0; index < count; index += 1) {
      const nodeId = stationNodeId(target.id, index);
      if (!occupied.has(nodeId) && navigation.getNode(nodeId) !== null) return nodeId;
    }
    return null;
  }

  private advanceShipTick(): void {
    if (this.port === null) return;
    const snapshot = this.getActiveShipSnapshot();
    // 后台行为不能因为船员当前恰好处于 IDLE 而停钟：士兵需要从 IDLE
    // 进入巡逻，施工队列也需要在无人移动时继续结算。GameCore 仍是唯一
    // 状态来源，这里只决定是否调用统一固定 Tick。
    const hasBackgroundWork = snapshot.crews.crews.some((crew) =>
      crew.state !== 'IDLE'
      || (crew.patrolEnabled && crew.patrolRoomIds.length > 0)
      || crew.constructionJobId !== null,
    ) || snapshot.constructionJobs.length > 0;
    if (!hasBackgroundWork) return;
    const selectedBefore = this.selectedCrewId === null
      ? null
      : snapshot.crews.crews.find((crew) => crew.id === this.selectedCrewId) ?? null;
    const result = this.port.advanceOneTick(snapshot.shipId);
    this.state = result.state;
    let message = result.message;
    if (result.ok && selectedBefore?.state === 'REPAIRING') {
      const after = this.getActiveShipSnapshot();
      const selectedAfter = after.crews.crews.find((crew) => crew.id === selectedBefore.id);
      const room = after.rooms.find((entry) => entry.instanceId === selectedBefore.targetRoomId);
      const definition = this.bindings?.roomDefinitions.get(selectedBefore.targetRoomId ?? '');
      if (selectedAfter?.state === 'IDLE' && room !== undefined && definition !== undefined && room.hp === definition.maxHp) {
        message = `维修完成：${definition.displayName}已恢复至 ${room.hp}/${definition.maxHp}`;
      }
    } else if (result.ok && selectedBefore?.state === 'HEALING') {
      const after = this.getActiveShipSnapshot();
      const selectedAfter = after.crews.crews.find((crew) => crew.id === selectedBefore.id);
      const definition = this.bindings?.crewDefinitions.get(selectedBefore.id);
      if (selectedAfter?.state === 'IDLE' && definition !== undefined && selectedAfter.hp === definition.maxHp) {
        message = `治疗完成：${definition.displayName}已恢复至 ${selectedAfter.hp}/${definition.maxHp}`;
      } else if (selectedAfter?.state === 'IDLE' && selectedAfter.hp < (definition?.maxHp ?? selectedAfter.hp + 1)) {
        message = '医疗室能源不足，治疗已停止';
      }
    }
    this.refreshAll(message, true);
    if (!result.ok) {
      error(`[SAVE] ${result.message}`);
      this.stopTick();
    }
  }

  private advanceConstructionTime(): void {
    if (this.port === null || this.state === null) return;
    const result = this.port.settleConstruction(this.getActiveShipSnapshot().shipId);
    this.state = result.state;
    // 施工面板的快照对象会在到场同步时被整体替换；即使规则 revision 不变，
    // 每秒重绑一次也必须把 buildersAtSite/进度遥测同步到可见 UI。
    this.refreshAll(result.message, false);
    if (!result.ok) {
      error(`[SAVE] ${result.message}`);
      this.stopTick();
    }
  }

  private async handleBuildIntent(intent: BuildPageIntent): Promise<{ readonly ok: boolean; readonly message: string }> {
    const ship = this.getActiveShipSnapshot();
    let command: ShipCommand;
    if (intent.type === 'START_BUILD') {
      const suffix = `${Date.now()}-${++this.requestSequence}`;
      command = intent.definitionKind === 'FLOOR'
        ? { type: 'START_BUILD_FLOOR', shipId: ship.shipId, jobId: `job-floor-${suffix}`, floorInstanceId: `floor-${suffix}`, floorDefinitionId: intent.definitionId, x: intent.x, y: intent.y, nowUnixMs: Date.now() }
        : { type: 'START_BUILD_ROOM', shipId: ship.shipId, jobId: `job-room-${suffix}`, roomInstanceId: `room-${suffix}`, roomDefinitionId: intent.definitionId, x: intent.x, y: intent.y, nowUnixMs: Date.now() };
    } else command = { type: 'CANCEL_CONSTRUCTION', shipId: ship.shipId, jobId: intent.jobId };
    const result = await this.execute(command);
    this.refreshAll(result.message, false);
    return { ok: result.ok, message: result.message };
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
      const definition = this.bindings.config.rooms.find((entry) => entry.id === room.definitionId);
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
    const definitions = new Map(snapshot.rooms.map((room) => [room.instanceId, this.bindings?.config.rooms.find((definition) => definition.id === room.definitionId) as Readonly<RoomDefinition>]));
    return new NavigationGraph(this.createGrid(snapshot).getRooms(), definitions, {
      floors: snapshot.floors.map((floor) => ({ ...floor, completed: true })),
      connectors: snapshot.rooms.filter((room) => definitions.get(room.instanceId)?.verticalConnectorKind !== 'NONE').map((room) => ({
        roomInstanceId: room.instanceId, definitionId: room.definitionId, completed: true,
        ports: this.bindings?.config.connectorPorts.filter((port) => port.roomDefinitionId === room.definitionId) ?? [],
      })),
    });
  }

  private createCrewReadStates(snapshot: ShipSnapshot, navigation: NavigationGraph): CrewReadState[] {
    if (this.bindings === null) return [];
    return snapshot.crews.crews.map((crew) => {
      const definition = this.bindings?.crewDefinitions.get(crew.id);
      if (definition === undefined) throw new Error(`未知船员快照：${crew.id}`);
      const currentNodeId = crew.currentNodeId;
      const nextNodeId = crew.pathIndex + 1 < crew.pathNodeIds.length ? crew.pathNodeIds[crew.pathIndex + 1] : null;
      if (navigation.getNode(currentNodeId) === null || (nextNodeId !== null && navigation.getNode(nextNodeId) === null)) {
        throw new Error(`船员路径包含无效导航节点：${crew.id}`);
      }
      return {
        ...crew,
        displayName: crew.callSign,
        role: definition.role,
        maxHp: definition.maxHp,
        moveTicksPerEdge: definition.moveTicksPerEdge,
        repairHpPerTick: definition.repairHpPerTick,
        currentNodeId,
        nextNodeId,
        edgeProgress: nextNodeId === null ? 0 : crew.ticksIntoEdge
          / navigation.getEdgeTravelTicks(currentNodeId, nextNodeId, definition.moveTicksPerEdge),
      };
    });
  }

  private createCrewStatusRoom(selected: CrewReadState | null, snapshot: ShipSnapshot): CrewStatusRoomState | null {
    if (selected === null || this.bindings === null) return null;
    const roomId = selected.state === 'REPAIRING' || selected.state === 'HEALING' || selected.state === 'TREATING'
      ? selected.targetRoomId : selected.currentRoomId;
    if (roomId === null) return null;
    const room = snapshot.rooms.find((entry) => entry.instanceId === roomId);
    const definition = room === undefined ? undefined : this.bindings.config.rooms.find((entry) => entry.id === room.definitionId);
    if (room === undefined || definition === undefined) return null;
    return {
      roomId,
      displayName: definition.displayName,
      hp: room.hp,
      maxHp: definition.maxHp,
      minPower: definition.minPower,
      allocatedPower: snapshot.energy.allocations.find((entry) => entry.roomId === roomId)?.power ?? 0,
      healingHpPerTick: definition.healingHpPerTick,
    };
  }

  private createCrewStatusTelemetry(selected: CrewReadState | null, snapshot: ShipSnapshot, navigation: NavigationGraph): CrewStatusTelemetry | undefined {
    if (selected === null) return undefined;
    const total = selected.nextNodeId === null
      ? 0
      : navigation.getEdgeTravelTicks(selected.currentNodeId, selected.nextNodeId, selected.moveTicksPerEdge);
    const currentNode = navigation.getNode(selected.currentNodeId);
    const nextNode = selected.nextNodeId === null ? null : navigation.getNode(selected.nextNodeId);
    const connectorRoom = currentNode?.kind === 'CONNECTOR_STOP' && nextNode?.kind === 'CONNECTOR_STOP' && currentNode.roomId === nextNode.roomId
      ? snapshot.rooms.find((room) => room.instanceId === currentNode.roomId)
      : undefined;
    const connectorKind = connectorRoom === undefined
      ? 'NONE'
      : this.bindings?.config.rooms.find((room) => room.id === connectorRoom.definitionId)?.verticalConnectorKind ?? 'NONE';
    const job = selected.constructionJobId === null
      ? undefined
      : snapshot.constructionJobs.find((entry) => entry.jobId === selected.constructionJobId);
    return {
      edgeLabel: total === 0 ? '—' : connectorKind === 'ELEVATOR' ? '电梯' : connectorKind === 'STAIRS' ? '楼梯' : '普通',
      edgeUsedTicks: selected.ticksIntoEdge,
      edgeTotalTicks: total,
      patrolEnabled: selected.patrolEnabled,
      patrolResumeTicks: selected.patrolPauseTicks,
      constructionJobId: selected.constructionJobId,
      constructionAtSite: job !== undefined && job.buildersAtSite.indexOf(selected.id) !== -1
        || (job !== undefined && selected.constructionJobId === job.jobId && selected.state === 'CONSTRUCTING'
          && selected.currentNodeId === selected.constructionWorksiteNodeId),
    };
  }

  private findAvailableMedicId(
    selected: CrewReadState | null,
    room: CrewStatusRoomState | null,
    crews: readonly CrewReadState[],
  ): string | null {
    if (selected === null || room === null || selected.state !== 'IDLE' || selected.hp >= selected.maxHp) return null;
    return crews
      .filter((crew) => crew.role === 'MEDIC' && crew.state === 'IDLE' && crew.currentRoomId === room.roomId && crew.id !== selected.id)
      .map((crew) => crew.id)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
  }

  private createPowerPanelRooms(): readonly PowerPanelRoom[] {
    if (this.bindings === null) return [];
    const snapshot = this.getActiveShipSnapshot();
    return snapshot.rooms.map((room) => ({
      roomId: room.instanceId,
      definition: this.bindings?.config.rooms.find((entry) => entry.id === room.definitionId),
    })).filter((entry): entry is { roomId: string; definition: Readonly<RoomDefinition> } => entry.definition !== undefined).map(({ roomId, definition }) => ({
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
      availablePower: snapshot.rooms.reduce((total, room) => total + (this.bindings?.config.rooms.find((definition) => definition.id === room.definitionId)?.powerGeneration ?? 0), 0),
      allocatedPower: snapshot.energy.allocations.reduce((total, allocation) => total + allocation.power, 0),
      allocations: snapshot.energy.allocations,
    };
  }

  private stopTick(): void {
    if (this.tickHandler !== null) this.unschedule(this.tickHandler);
    this.tickHandler = null;
    if (this.constructionTickHandler !== null) this.unschedule(this.constructionTickHandler);
    this.constructionTickHandler = null;
  }
}

function isUsableComponent(component: Component | null): boolean {
  return component !== null && component.isValid && component.node !== null && component.node.isValid;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function actionState(
  id: WorldContextActionId,
  label: string,
  enabled: boolean,
  reason: string,
): WorldContextActionState {
  return { id, label, enabled, reason };
}
