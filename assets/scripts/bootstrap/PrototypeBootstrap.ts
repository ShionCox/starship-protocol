import { _decorator, assetManager, Color, Component, error, instantiate, JsonAsset, log, Node, Prefab, warn } from 'cc';
import { NATIVE } from 'cc/env';

import { ConfigRegistry } from '../application/ConfigRegistry';
import { bootstrapSecureConfig } from '../application/SecureConfigBootstrap';
import { CocosAesGcmDecryptor } from '../adapters/CocosAesGcmDecryptor';
import {
  CocosSecureConfigTransport,
  readCocosLaunchContext,
} from '../adapters/CocosSecureConfigTransport';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import type { CrewDefinition } from '../game-core/CrewDefinition';
import {
  CrewModel,
  type CrewInitialState,
} from '../game-core/CrewModel';
import { NavigationGraph } from '../game-core/NavigationGraph';
import {
  createEnergyRooms,
  EnergyModel,
  type EnergyCommand,
} from '../game-core/EnergyModel';
import {
  ShipGridModel,
  type MoveRoomCommand,
  type PlacementValidation,
  type RoomPlacement,
} from '../game-core/ShipGridModel';
import { CameraController } from '../input/CameraController';
import { RoomView } from '../presentation/RoomView';
import { CrewStatusPanel } from '../presentation/CrewStatusPanel';
import { CrewView } from '../presentation/CrewView';
import {
  PowerPanel,
  type PowerPanelCommandResult,
  type PowerPanelRoom,
  type PowerPanelState,
} from '../presentation/PowerPanel';
import { loadPrototypeLayout, savePrototypeLayout } from './PrototypeLayoutStorage';
import {
  applyPrototypeEnergyCommand,
  loadPrototypeEnergy,
  savePrototypeEnergy,
} from './PrototypeEnergyStorage';
import {
  advancePrototypeCrewTick,
  applyPrototypeCrewCommand,
  loadPrototypeCrew,
  savePrototypeCrew,
} from './PrototypeCrewStorage';
import { PrototypeSceneSettings } from './PrototypeSceneSettings';
import { findPrototypeSceneNode, findPrototypeSceneNodePath } from './PrototypeSceneNodes';
import {
  planPrototypeLayout,
  type PrototypeLayoutRoom,
} from './PrototypeLayoutPlanner';

const { ccclass, menu, property } = _decorator;

/**
 * R0 原型场景的最小装配入口。
 * 这里只连接编辑器中已经挂载的 Cocos 表现组件，不承载网格或房间规则。
 */
@ccclass('PrototypeBootstrap')
@menu('星舰协议/启动/原型场景装配')
export class PrototypeBootstrap extends Component {
  private readonly configRegistry = new ConfigRegistry();
  private readonly runtimeCreatedRoomNodes = new Set<Node>();
  private readonly runtimeCreatedSupportNodes = new Set<Node>();
  private initializationCommitted = false;
  private crewTickHandler: (() => void) | null = null;

  @property({
    type: Prefab,
    displayName: '反应堆房间预制体',
    tooltip: '房间容器中没有编辑器实例时使用的运行时备用预制体。',
    group: '场景资源',
  })
  public reactorRoomPrefab: Prefab | null = null;

  protected start(): void {
    void this.initialize().then(
      () => this.cleanupAfterInitialization(),
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        const detail = cause instanceof Error && typeof cause.stack === 'string'
          ? `\n${cause.stack}`
          : '';
        error(`[BOOT] 原型场景装配失败：${message}${detail}`);
        this.cleanupAfterInitialization();
      },
    );
  }

  private cleanupAfterInitialization(): void {
    // initialize() 的失败分支会直接 return；统一在 Promise 收尾处撤销运行时补齐节点，
    // 避免 RoomView 已挂载但布局/能源尚未提交时把半初始化房间留在场景中。
    if (!this.initializationCommitted) {
      if (this.crewTickHandler !== null) {
        this.unschedule(this.crewTickHandler);
        this.crewTickHandler = null;
      }
      this.cleanupRuntimeCreatedNodes();
    }
  }

  protected onDisable(): void {
    if (this.crewTickHandler !== null) {
      this.unschedule(this.crewTickHandler);
      this.crewTickHandler = null;
    }
  }

  private async initialize(): Promise<void> {
    const scene = this.node.scene;
    const shipRoot = scene === null ? null : findPrototypeSceneNodePath(scene, 'canvas', 'worldRoot', 'shipRoot');
    const roomRoot = shipRoot === null ? null : findPrototypeSceneNode(shipRoot, 'roomRoot');
    const crewRoot = shipRoot === null ? null : findPrototypeSceneNode(shipRoot, 'crewRoot');
    const uiRoot = scene === null ? null : findPrototypeSceneNodePath(scene, 'canvas', 'uiRoot');
    const appRoot = scene === null ? null : findPrototypeSceneNode(scene, 'appRoot');

    if (roomRoot === null || uiRoot === null || appRoot === null) {
      error('[BOOT] PrototypeScene 节点结构不完整');
      return;
    }
    // 只读取持久面板，不在布局规划完成前创建运行时 UI；布局失败时不能暴露半初始化面板。
    const persistedPowerPanel = uiRoot.getComponentInChildren(PowerPanel);

    const sceneSettings = appRoot.getComponent(PrototypeSceneSettings);
    if (sceneSettings === null || sceneSettings.gridRoot === null || !sceneSettings.hasValidGridConfig()) {
      error('[BOOT] 请在 AppRoot 的原型场景设置中配置有效网格参数和 GridRoot 引用');
      return;
    }

    const cameraController = appRoot.getComponent(CameraController);
    if (cameraController === null) {
      error('[BOOT] 请在 Cocos 编辑器中给 AppRoot 挂载 CameraController');
      return;
    }

    let roomViews = roomRoot.getComponentsInChildren(RoomView);
    const runtimeCreatedRoomIds = new Set<string>();
    if (roomViews.length === 0) {
      if (this.reactorRoomPrefab === null) {
        warn('[BOOT] RoomRoot 中没有 ReactorRoom 实例，也未绑定 ReactorRoom Prefab');
        return;
      }
      const roomNode = instantiate(this.reactorRoomPrefab);
      // 规划和所有模型校验完成前保持临时节点不可见；成功提交时统一激活。
      roomNode.active = false;
      roomRoot.addChild(roomNode);
      const roomView = roomNode.getComponent(RoomView);
      if (roomView === null) {
        roomNode.destroy();
        error('[BOOT] ReactorRoom Prefab 缺少 RoomView 组件');
        return;
      }
      this.runtimeCreatedRoomNodes.add(roomNode);
      roomViews = [roomView];
      runtimeCreatedRoomIds.add(roomView.roomInstanceId.trim());
    }

    if (!NATIVE) {
      const runtimeConsumers = await this.ensureRuntimeConsumerRoomViews(roomRoot, roomViews);
      roomViews = runtimeConsumers.roomViews;
      for (const roomId of runtimeConsumers.createdRoomIds) runtimeCreatedRoomIds.add(roomId);
    }

    const roomIds = roomViews.map((roomView) => roomView.roomInstanceId.trim());
    if (roomIds.some((roomId) => roomId.length === 0) || new Set(roomIds).size !== roomIds.length) {
      error('[BOOT] RoomRoot 中每个 RoomView 都必须配置非空且唯一的房间实例 ID');
      return;
    }
    const definitionsByRoomId = new Map<string, Readonly<RoomDefinition>>();
    if (NATIVE) {
      await bootstrapSecureConfig(
        readCocosLaunchContext(),
        new CocosSecureConfigTransport(),
        new CocosAesGcmDecryptor(),
        this.configRegistry,
      );
      for (let index = 0; index < roomViews.length; index += 1) {
        const definitionId = roomViews[index].getRoomDefinitionId();
        const definition = this.configRegistry.getRoomDefinition(definitionId);
        if (definition === null) {
          throw new Error(`安全配置缺少房间定义：${definitionId || '空'}`);
        }
        definitionsByRoomId.set(roomIds[index], definition);
      }
      log(
        `[CONFIG] 已加载受认证规则：Build=${this.configRegistry.buildId ?? ''} ` +
        `Config=${this.configRegistry.configVersion ?? ''}`,
      );
    } else {
      for (let index = 0; index < roomViews.length; index += 1) {
        const definitionResult = roomViews[index].resolveRoomDefinition();
        if (definitionResult.ok === false) {
          error(`[BOOT] 房间 ${roomIds[index]} 定义无效：${definitionResult.message}`);
          return;
        }
        definitionsByRoomId.set(roomIds[index], definitionResult.definition);
      }
    }

    const validHullCells = sceneSettings.getValidHullCells();
    const loadedLayout = loadPrototypeLayout(
      sceneSettings.gridColumns,
      sceneSettings.gridRows,
      validHullCells,
    );
    let gridModel = loadedLayout.status === 'loaded'
      ? loadedLayout.grid
      : new ShipGridModel(sceneSettings.gridColumns, sceneSettings.gridRows, validHullCells);
    const restoredPlacements = loadedLayout.status === 'loaded'
      ? this.getSupportedRestoredPlacements(gridModel, definitionsByRoomId)
      : null;
    if (loadedLayout.status === 'error') {
      warn(`[SAVE] 本地布局恢复失败，已回退编辑器布局：${loadedLayout.message}`);
    } else if (loadedLayout.status === 'loaded' && restoredPlacements === null) {
      warn('[SAVE] 本地布局不符合当前 R0 原型房间配置，已回退编辑器布局');
    }

    // 先完成整个布局规划，再允许能源模型或面板绑定；规划器只写临时网格，失败时
    // 不会留下半初始化的 GameCore、UI 或能源存档。已有编辑器房间优先锁定坐标，
    // 运行时补齐房间随后按固定 y→x 顺序占用首个合法空位。
    const layoutRooms: PrototypeLayoutRoom[] = [];
    for (let index = 0; index < roomViews.length; index += 1) {
      const roomView = roomViews[index];
      const roomId = roomIds[index];
      const definition = definitionsByRoomId.get(roomId);
      if (definition === undefined) {
        error(`[BOOT] 房间 ${roomId} 缺少已解析定义`);
        return;
      }
      let authoredPosition = null;
      if (restoredPlacements === null && !runtimeCreatedRoomIds.has(roomId)) {
        authoredPosition = sceneSettings.worldCenterToGrid(
          roomView.node.worldPosition,
          definition.width,
          definition.height,
        );
        if (authoredPosition === null) {
          error(`[BOOT] 无法把编辑器房间 ${roomId} 的位置转换为逻辑网格`);
          return;
        }
      }
      layoutRooms.push({
        id: roomId,
        width: definition.width,
        height: definition.height,
        authoredPosition,
        runtimeCreated: runtimeCreatedRoomIds.has(roomId),
      });
    }

    const layoutPlan = planPrototypeLayout(
      sceneSettings.gridColumns,
      sceneSettings.gridRows,
      validHullCells,
      layoutRooms,
      restoredPlacements,
    );
    if (layoutPlan.ok === false) {
      error(`[BOOT] 房间布局规划失败：${layoutPlan.message}`);
      return;
    }
    gridModel = layoutPlan.grid;
    const plannedPlacements = layoutPlan.placements;

    // 场景编辑器应只保留一个能源房间实例；旧原型若暂时存在重复反应堆，
    // 仅在能源聚合层去重并发出警告，避免把可用产能错误放大，布局问题仍需回到 Creator 修复。
    const energyDefinitions = new Map<string, Readonly<RoomDefinition>>();
    const energyDefinitionIds = new Set<string>();
    for (const [roomId, definition] of definitionsByRoomId) {
      if (definition.category === 'ENERGY' && definition.powerGeneration > 0) {
        if (energyDefinitionIds.has(definition.id)) {
          warn(`[ENERGY] 检测到重复能源房间定义 ${definition.id}，实例 ${roomId} 不计入产能；请在 Creator 中移除重复实例`);
          continue;
        }
        energyDefinitionIds.add(definition.id);
      }
      energyDefinitions.set(roomId, definition);
    }
    const energyRooms = createEnergyRooms(energyDefinitions);
    const loadedEnergy = loadPrototypeEnergy(energyRooms);
    let energyModel = loadedEnergy.status === 'loaded'
      ? loadedEnergy.model
      : new EnergyModel(energyRooms);
    if (loadedEnergy.status === 'error') {
      warn(`[SAVE] 能源存档恢复失败，已使用全零能源：${loadedEnergy.message}`);
    }
    const powerPanelRooms: readonly PowerPanelRoom[] = Array.from(energyDefinitions, ([roomId, definition]) => ({
      roomId,
      displayName: definition.displayName,
      minPower: definition.minPower,
      maxPower: definition.maxPower,
    })).filter((room) => room.maxPower > 0);

    let navigation: NavigationGraph | null = null;
    let crewModel: CrewModel | null = null;
    let crewInitialStates: readonly CrewInitialState[] = [];
    let crewViews: readonly CrewView[] = [];
    let selectedCrewId: string | null = null;
    let crewClockPaused = false;
    let crewStatusPanel: CrewStatusPanel | null = null;

    const refreshCrewUi = (message = '', animate = true): void => {
      if (crewModel === null) return;
      const states = crewModel.getReadStates();
      const statesById = new Map(states.map((state) => [state.id, state]));
      for (const view of crewViews) {
        const state = statesById.get(view.crewInstanceId.trim());
        if (state === undefined) continue;
        if (navigation !== null) view.setNavigation(navigation);
        view.setSelected(state.id === selectedCrewId);
        view.refresh(state, animate);
      }
      const selected = selectedCrewId === null ? null : statesById.get(selectedCrewId) ?? null;
      crewStatusPanel?.refresh(selected, message);
    };

    const handleCrewSelection = (crewId: string): void => {
      selectedCrewId = crewId;
      refreshCrewUi(`已选择${crewModel?.getReadStates().find((crew) => crew.id === crewId)?.displayName ?? crewId}`, false);
    };

    const handleCrewRoomClick = (roomId: string): void => {
      if (crewModel === null || navigation === null) return;
      if (selectedCrewId === null) {
        crewStatusPanel?.refresh(null, '请先点击一名船员');
        return;
      }
      const result = applyPrototypeCrewCommand(
        crewModel,
        navigation,
        crewInitialStates,
        { type: 'MOVE_CREW', crewId: selectedCrewId, targetRoomId: roomId },
      );
      crewModel = result.model;
      refreshCrewUi(result.message, false);
    };

    const rejectRoomMoveWhileCrewMoving = (): PlacementValidation | null => (
      crewModel?.isAnyCrewMoving()
        ? { ok: false, code: 'INVALID_GRID_VALUE' }
        : null
    );

    const rebuildCrewNavigation = (): boolean => {
      if (crewModel === null || navigation === null) return true;
      try {
        const nextNavigation = new NavigationGraph(gridModel.getRooms(), definitionsByRoomId);
        const restored = CrewModel.restore(nextNavigation, crewInitialStates, crewModel.getSnapshot());
        if (restored.ok === false) {
          error(`[CREW] 房间布局变化后重建导航失败：${restored.message}`);
          return false;
        }
        navigation = nextNavigation;
        crewModel = restored.model;
        refreshCrewUi('房间布局已更新，导航图已重建', false);
        return true;
      } catch (cause) {
        error(`[CREW] 房间布局变化后重建导航失败：${cause instanceof Error ? cause.message : String(cause)}`);
        return false;
      }
    };

    for (let index = 0; index < roomViews.length; index += 1) {
      const roomView = roomViews[index];
      const definition = definitionsByRoomId.get(roomIds[index]);
      if (definition === undefined) {
        error(`[BOOT] 房间 ${roomIds[index]} 缺少已解析定义`);
        return;
      }
      const placement = plannedPlacements.get(roomIds[index]);
      if (placement === undefined) {
        error(`[BOOT] 房间布局规划缺少房间：${roomIds[index]}`);
        return;
      }

      roomView.bind(
        definition,
        placement,
        sceneSettings,
        (command: MoveRoomCommand) => rejectRoomMoveWhileCrewMoving() ?? gridModel.validateRoomMove(command),
        (command: MoveRoomCommand) => {
          const blocked = rejectRoomMoveWhileCrewMoving();
          if (blocked !== null) return blocked;
          const previous = gridModel.getRooms().find((room) => room.id === command.roomId) ?? null;
          const result = gridModel.moveRoom(command);
          if (result.ok && !rebuildCrewNavigation()) {
            if (previous !== null) gridModel.moveRoom({ type: 'MOVE_ROOM', roomId: previous.id, x: previous.x, y: previous.y });
            return { ok: false, code: 'INVALID_GRID_VALUE' };
          }
          if (result.ok) this.saveLayout(gridModel);
          return result;
        },
        (blocked: boolean) => cameraController.setPanBlocked(blocked),
        handleCrewRoomClick,
      );
    }

    if (!NATIVE && crewRoot !== null) {
      crewViews = crewRoot.getComponentsInChildren(CrewView);
      if (crewViews.length > 0) {
        const crewIds = crewViews.map((view) => view.crewInstanceId.trim());
        if (crewIds.some((id) => id.length === 0) || new Set(crewIds).size !== crewIds.length) {
          error('[CREW] 船员层中每个 CrewView 都必须配置非空且唯一的船员实例 ID');
          return;
        }
        const crewDefinitions = new Map<string, Readonly<CrewDefinition>>();
        for (const view of crewViews) {
          const definition = view.resolveCrewDefinition();
          if (definition.ok === false) {
            error(`[CREW] 船员 ${view.crewInstanceId || '空'} 定义无效：${definition.message}`);
            return;
          }
          crewDefinitions.set(view.crewInstanceId.trim(), definition.definition);
        }
        crewInitialStates = crewViews.map((view) => ({
          id: view.crewInstanceId.trim(),
          definition: crewDefinitions.get(view.crewInstanceId.trim()) as Readonly<CrewDefinition>,
          roomId: view.initialRoomInstanceId.trim(),
          stationIndex: view.initialStationIndex,
        }));
        try {
          navigation = new NavigationGraph(gridModel.getRooms(), definitionsByRoomId);
          const loadedCrew = loadPrototypeCrew(navigation, crewInitialStates);
          crewModel = loadedCrew.status === 'loaded' ? loadedCrew.model : new CrewModel(navigation, crewInitialStates);
          if (loadedCrew.status === 'error') warn(`[SAVE] 船员存档恢复失败，已回退编辑器初始站位：${loadedCrew.message}`);
          const persistedCrewPanel = uiRoot.getComponentInChildren(CrewStatusPanel);
          const nextCrewStatusPanel = persistedCrewPanel ?? CrewStatusPanel.createRuntimeFallback(uiRoot);
          crewStatusPanel = nextCrewStatusPanel;
          if (persistedCrewPanel === null) {
            nextCrewStatusPanel.node.active = false;
            this.runtimeCreatedSupportNodes.add(nextCrewStatusPanel.node);
            warn('[CREW] 界面根尚未保存船员状态面板，已创建 Web 运行时兜底面板');
          }
          const statesById = new Map(crewModel.getReadStates().map((state) => [state.id, state]));
          for (const view of crewViews) {
            const state = statesById.get(view.crewInstanceId.trim());
            const definition = crewDefinitions.get(view.crewInstanceId.trim());
            if (state === undefined || definition === undefined) {
              error(`[CREW] 船员运行时映射不完整：${view.crewInstanceId}`);
              return;
            }
            view.bind(definition, state, navigation, sceneSettings, handleCrewSelection);
          }
          refreshCrewUi(loadedCrew.status === 'loaded' ? '已恢复船员位置' : '船员状态已就绪', false);
          if (loadedCrew.status !== 'loaded') {
            const saved = savePrototypeCrew(crewModel);
            if (saved.ok === false) warn(`[SAVE] 初始船员存档写入失败：${saved.message}`);
          }
          this.crewTickHandler = () => {
            if (crewClockPaused || crewModel === null || navigation === null || !crewModel.isAnyCrewMoving()) return;
            const tickResult = advancePrototypeCrewTick(crewModel, navigation, crewInitialStates);
            crewModel = tickResult.model;
            if (!tickResult.ok) crewClockPaused = tickResult.paused;
            refreshCrewUi(tickResult.message, true);
          };
          this.schedule(this.crewTickHandler, 0.1);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          const detail = cause instanceof Error && typeof cause.stack === 'string'
            ? `\n${cause.stack}`
            : '';
          error(`[CREW] 船员初始化失败：${message}${detail}`);
          return;
        }
      } else {
        warn('[CREW] 船员层中没有持久 CrewView 实例');
      }
    } else if (!NATIVE) {
      warn('[CREW] 飞船根缺少持久“船员层”节点');
    }

    // 只有布局、房间表现和可选船员链路都完成后才创建/绑定能源 UI；此前任一
    // 阶段失败都不会暴露 PowerPanel 或写入初始能源快照。
    const powerPanel = persistedPowerPanel ?? PowerPanel.createRuntimeFallback(uiRoot);
    if (persistedPowerPanel === null) {
      powerPanel.node.active = false;
      this.runtimeCreatedSupportNodes.add(powerPanel.node);
      warn('[BOOT] 界面根尚未保存 PowerPanel，已创建 Web 原型运行时兜底面板；请在 Creator 中持久化 UI。');
    }
    powerPanel.ensureRuntimeRows(powerPanelRooms);
    const handleEnergyCommand = (command: EnergyCommand): PowerPanelCommandResult => {
      const result = applyPrototypeEnergyCommand(energyModel, energyRooms, command);
      energyModel = result.model;
      return { ok: result.ok, message: result.message, state: createPowerPanelState(energyModel) };
    };
    powerPanel.bind(powerPanelRooms, createPowerPanelState(energyModel), handleEnergyCommand);
    if (loadedEnergy.status !== 'loaded') {
      const saved = savePrototypeEnergy(energyModel);
      if (saved.ok === false) warn(`[SAVE] 初始能源存档写入失败：${saved.message}`);
    }

    if (restoredPlacements === null) {
      this.saveLayout(gridModel);
    } else {
      log('[SAVE] 已从 localStorage 恢复 R0 飞船布局');
    }

    this.activateRuntimeCreatedNodes();
    this.initializationCommitted = true;
    this.runtimeCreatedRoomNodes.clear();
    this.runtimeCreatedSupportNodes.clear();
  }

  private getSupportedRestoredPlacements(
    grid: ShipGridModel,
    definitionsByRoomId: ReadonlyMap<string, Readonly<RoomDefinition>>,
  ): ReadonlyMap<string, RoomPlacement> | null {
    const rooms = grid.getRooms();
    if (rooms.length !== definitionsByRoomId.size) {
      return null;
    }

    const placements = new Map<string, RoomPlacement>();
    for (const placement of rooms) {
      const definition = definitionsByRoomId.get(placement.id);
      if (
        definition === undefined ||
        placement.width !== definition.width ||
        placement.height !== definition.height
      ) {
        return null;
      }
      placements.set(placement.id, placement);
    }
    return placements;
  }

  private saveLayout(grid: ShipGridModel): void {
    const saved = savePrototypeLayout(grid);
    if (saved.ok === false) {
      error(`[SAVE] 原型布局保存失败：${saved.message}`);
    }
  }

  /**
   * Web 预览在旧场景尚未持久化消费者实例时，从主资源包加载 JSON + Prefab 作为临时补齐。
   * 规则仍来自 JSON，正式场景应通过创作面板保存这些实例；Native 不走此兜底。
   */
  private async ensureRuntimeConsumerRoomViews(
    roomRoot: Node,
    roomViews: readonly RoomView[],
  ): Promise<{ readonly roomViews: RoomView[]; readonly createdRoomIds: readonly string[] }> {
    const nextViews = [...roomViews];
    const createdRoomIds: string[] = [];
    const consumers = [
      { definitionId: 'room-laser', instanceId: 'room-laser-1', displayName: '激光室', prefabPath: 'prefabs/LaserRoom', configPath: 'config/rooms/room-laser', fill: new Color(170, 45, 55, 245), border: new Color(255, 105, 115, 255), core: new Color(255, 190, 195, 255) },
      { definitionId: 'room-shield', instanceId: 'room-shield-1', displayName: '护盾室', prefabPath: 'prefabs/ShieldRoom', configPath: 'config/rooms/room-shield', fill: new Color(25, 120, 145, 245), border: new Color(92, 225, 240, 255), core: new Color(180, 250, 255, 255) },
    ] as const;
    for (const consumer of consumers) {
      if (nextViews.some((view) => view.roomDefinitionId === consumer.definitionId)) continue;
      const [definitionAsset, prefab] = await Promise.all([
        this.loadMainAsset<JsonAsset>(consumer.configPath, JsonAsset),
        this.loadMainAsset<Prefab>(consumer.prefabPath, Prefab),
      ]);
      if (definitionAsset === null || prefab === null) {
        warn(`[BOOT] Web 预览未能加载 ${consumer.displayName} 的资源；请在 Creator 中持久化房间实例`);
        continue;
      }
      const node = instantiate(prefab) as Node;
      node.active = false;
      roomRoot.addChild(node);
      const view = node.getComponent(RoomView);
      if (view === null) {
        node.destroy();
        warn(`[BOOT] ${consumer.displayName} Prefab 缺少房间视图组件`);
        continue;
      }
      this.runtimeCreatedRoomNodes.add(node);
      view.roomInstanceId = consumer.instanceId;
      view.roomDefinitionId = consumer.definitionId;
      view.definitionAsset = definitionAsset;
      view.fillColor = consumer.fill;
      view.borderColor = consumer.border;
      view.coreColor = consumer.core;
      nextViews.push(view);
      createdRoomIds.push(consumer.instanceId);
    }
    return { roomViews: nextViews, createdRoomIds };
  }

  private cleanupRuntimeCreatedNodes(): void {
    for (const node of [...this.runtimeCreatedRoomNodes, ...this.runtimeCreatedSupportNodes]) {
      if (node.isValid) node.destroy();
    }
    this.runtimeCreatedRoomNodes.clear();
    this.runtimeCreatedSupportNodes.clear();
  }

  private activateRuntimeCreatedNodes(): void {
    for (const node of [...this.runtimeCreatedRoomNodes, ...this.runtimeCreatedSupportNodes]) {
      if (node.isValid) node.active = true;
    }
  }

  private loadMainAsset<T extends object>(path: string, type: typeof JsonAsset | typeof Prefab): Promise<T | null> {
    const main = assetManager.main;
    if (main === null) return Promise.resolve(null);
    return new Promise((resolve) => {
      const load = main.load as unknown as (
        requestPath: string,
        assetType: typeof JsonAsset | typeof Prefab,
        callback: (cause: Error | null, asset: T | T[]) => void,
      ) => void;
      load(path, type, (cause: Error | null, asset: T | T[]) => {
        if (cause !== null || Array.isArray(asset)) {
          resolve(null);
          return;
        }
        resolve(asset);
      });
    });
  }
}

function createPowerPanelState(model: EnergyModel): PowerPanelState {
  return {
    availablePower: model.getAvailablePower(),
    allocatedPower: model.getAllocatedPower(),
    allocations: model.getSnapshot().allocations,
  };
}
