import type { CrewDefinition } from './CrewDefinition.ts';
import { CrewModel, type CrewInitialState, type CrewSnapshot, type CrewSnapshotEntry } from './CrewModel.ts';
import type { CrewIdentityInitialState } from './CrewIdentity.ts';
import { ConstructionModel, type ConstructionCrewProfile, type ConstructionJobSnapshot, type ConstructionPreview } from './ConstructionModel.ts';
import type { ConnectorPortDefinition, FloorDefinition } from './CsvGameConfig.ts';
import { VoxelLayoutModel, type FloorInstanceSnapshot } from './VoxelLayoutModel.ts';
import { createEnergyRooms, EnergyModel, type EnergySnapshot } from './EnergyModel.ts';
import type { HullDefinition } from './HullDefinition.ts';
import { NavigationGraph, floorNodeId } from './NavigationGraph.ts';
import type { RoomDefinition } from './RoomDefinition.ts';
import {
  ShipGridModel,
  createShipLayoutSnapshot,
  restoreShipLayout,
  type RoomPlacement,
} from './ShipGridModel.ts';

export const SHIP_SNAPSHOT_SCHEMA_VERSION = 6 as const;

/** 房间实例快照；定义标识与实例标识必须分开，位置始终使用逻辑网格坐标。 */
export interface RoomInstanceSnapshot {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly hp: number;
}

/** 单艘飞船的完整可序列化状态，不包含 Node、Prefab 或世界像素坐标。 */
export interface ShipSnapshot {
  readonly schemaVersion: typeof SHIP_SNAPSHOT_SCHEMA_VERSION;
  readonly shipId: string;
  readonly hullId: string;
  readonly revision: number;
  readonly rooms: readonly RoomInstanceSnapshot[];
  readonly floors: readonly FloorInstanceSnapshot[];
  readonly constructionJobs: readonly ConstructionJobSnapshot[];
  readonly energy: EnergySnapshot;
  readonly crews: CrewSnapshot;
}

export type ShipConstructionPreview = ConstructionPreview & Readonly<{ revision: number }>;

/** 创建单舰聚合根时使用的房间初始状态。 */
export interface ShipRoomInitialState {
  readonly instanceId: string;
  readonly definition: Readonly<RoomDefinition>;
  readonly x: number;
  readonly y: number;
  readonly level?: number;
  readonly hp?: number;
}

/** 创建单舰聚合根时使用的船员初始站位。 */
export interface ShipCrewInitialState {
  readonly instanceId: string;
  readonly definition: Readonly<CrewDefinition>;
  readonly roomInstanceId: string;
  readonly stationIndex: number;
  readonly hp?: number;
  /** 船员代号输入；省略时由 GameCore 按飞船与配置版本稳定生成。 */
  readonly identity?: CrewIdentityInitialState;
  readonly patrolRoomIds?: readonly string[];
}

/** 单舰蓝图只引用已校验规则定义，实例 ID 仅在当前飞船内唯一。 */
export interface ShipModelBlueprint {
  readonly shipId: string;
  /** 生成船员代号的配置版本；旧装配未提供时使用稳定默认值。 */
  readonly configVersion?: string;
  readonly hull: Readonly<HullDefinition>;
  readonly rooms: readonly ShipRoomInitialState[];
  readonly floors?: readonly FloorInstanceSnapshot[];
  readonly crews: readonly ShipCrewInitialState[];
  readonly construction?: ShipConstructionBlueprint;
}

/** P8 施工所需的已解析目录；不包含 Cocos 资源或系统时间。 */
export interface ShipConstructionBlueprint {
  readonly initialMetal: number;
  readonly floorDefinitions: readonly Readonly<FloorDefinition>[];
  readonly roomDefinitions: readonly Readonly<RoomDefinition>[];
  readonly connectorPorts: readonly Readonly<ConnectorPortDefinition>[];
  readonly crewProfiles: readonly ConstructionCrewProfile[];
}

/** 所有会修改单舰状态的 Command 都必须显式携带目标飞船 ID。 */
export type ShipCommand =
  | { readonly type: 'MOVE_ROOM'; readonly shipId: string; readonly roomInstanceId: string; readonly x: number; readonly y: number }
  | { readonly type: 'SET_ROOM_POWER'; readonly shipId: string; readonly roomInstanceId: string; readonly power: number }
  | { readonly type: 'RESET_ROOM_POWER'; readonly shipId: string; readonly roomInstanceId: string }
  | { readonly type: 'MOVE_CREW'; readonly shipId: string; readonly crewInstanceId: string; readonly targetRoomInstanceId: string }
  | { readonly type: 'ISSUE_MOVE_ORDER'; readonly shipId: string; readonly crewInstanceId: string; readonly targetNodeId: string }
  | { readonly type: 'ISSUE_REPAIR_ORDER'; readonly shipId: string; readonly crewInstanceId: string; readonly roomInstanceId: string }
  | { readonly type: 'ISSUE_HEAL_ORDER'; readonly shipId: string; readonly patientCrewInstanceId: string; readonly medicCrewInstanceId: string; readonly roomInstanceId: string }
  | { readonly type: 'CANCEL_CREW_ORDER'; readonly shipId: string; readonly crewInstanceId: string }
  | { readonly type: 'LEAVE_CONSTRUCTION'; readonly shipId: string; readonly crewInstanceId: string }
  | { readonly type: 'SET_PATROL_ENABLED'; readonly shipId: string; readonly crewInstanceId: string; readonly enabled: boolean }
  | { readonly type: 'START_REPAIR'; readonly shipId: string; readonly crewInstanceId: string; readonly roomInstanceId: string }
  | { readonly type: 'STOP_REPAIR'; readonly shipId: string; readonly crewInstanceId: string }
  | { readonly type: 'START_HEAL'; readonly shipId: string; readonly patientCrewInstanceId: string; readonly medicCrewInstanceId: string; readonly roomInstanceId: string }
  | { readonly type: 'STOP_HEAL'; readonly shipId: string; readonly patientCrewInstanceId: string }
  | { readonly type: 'START_BUILD_FLOOR'; readonly shipId: string; readonly jobId: string; readonly floorInstanceId: string; readonly floorDefinitionId: string; readonly x: number; readonly y: number; readonly nowUnixMs: number }
  | { readonly type: 'START_BUILD_ROOM'; readonly shipId: string; readonly jobId: string; readonly roomInstanceId: string; readonly roomDefinitionId: string; readonly x: number; readonly y: number; readonly nowUnixMs: number }
  | { readonly type: 'ASSIGN_BUILDERS'; readonly shipId: string; readonly jobId: string; readonly crewInstanceIds: readonly string[] }
  | { readonly type: 'CANCEL_CONSTRUCTION'; readonly shipId: string; readonly jobId: string }
  | { readonly type: 'START_DEMOLITION'; readonly shipId: string; readonly jobId: string; readonly targetInstanceId: string; readonly targetType: 'FLOOR' | 'ROOM'; readonly nowUnixMs: number };

/** 单舰状态变化事件；未来可直接映射到服务端权威事件流。 */
export interface ShipEvent {
  readonly type: 'SHIP_STATE_CHANGED';
  readonly shipId: string;
  readonly revision: number;
}

/** 单舰 Command 的稳定错误分类，UI 应显示 message 而不是自行解释规则。 */
export type ShipCommandErrorCode =
  | 'INVALID_COMMAND'
  | 'UNKNOWN_SHIP'
  | 'CREW_MOVING'
  | 'ROOM_COMMAND_FAILED'
  | 'ENERGY_COMMAND_FAILED'
  | 'CREW_COMMAND_FAILED'
  | 'REPAIR_COMMAND_FAILED'
  | 'HEAL_COMMAND_FAILED'
  | 'CONSTRUCTION_COMMAND_FAILED'
  | 'INVALID_SNAPSHOT';

/** Command 成功返回新快照和事件，失败必须返回未改变的旧快照。 */
export type ShipCommandResult =
  | { readonly ok: true; readonly snapshot: ShipSnapshot; readonly events: readonly ShipEvent[]; readonly message: string }
  | { readonly ok: false; readonly code: ShipCommandErrorCode; readonly message: string; readonly snapshot: ShipSnapshot };

/** 快照恢复采用全量校验，失败时不会向调用方暴露半份模型。 */
export type ShipRestoreResult =
  | { readonly ok: true; readonly model: ShipModel }
  | { readonly ok: false; readonly code: 'INVALID_SNAPSHOT'; readonly message: string };

interface RoomRuntimeState {
  readonly definition: Readonly<RoomDefinition>;
  level: number;
  hp: number;
}

/**
 * 单舰聚合根。跨布局、能源、导航和船员的不变量只在这里协调，View 与存储都不得分别
 * 修改子模型。P8 增加体素施工与多层导航，但仍不实现武器、伤害或通用 AI。
 */
export class ShipModel {
  public readonly shipId: string;
  public readonly hull: Readonly<HullDefinition>;

  private readonly configVersion: string;
  private grid: ShipGridModel;
  private navigation: NavigationGraph;
  private crew: CrewModel;
  private energy: EnergyModel;
  private readonly roomStates = new Map<string, RoomRuntimeState>();
  private readonly roomDefinitions = new Map<string, Readonly<RoomDefinition>>();
  private readonly crewInitialStates: readonly CrewInitialState[];
  private readonly initialFloors: readonly FloorInstanceSnapshot[];
  private constructionJobs: readonly ConstructionJobSnapshot[] = Object.freeze([]);
  private readonly constructionBlueprint: ShipConstructionBlueprint | null;
  private voxelLayout: VoxelLayoutModel | null = null;
  private construction: ConstructionModel | null = null;
  private readonly constructionRoomDefinitions = new Map<string, Readonly<RoomDefinition>>();
  private readonly floorDefinitions = new Map<string, Readonly<FloorDefinition>>();
  private readonly connectorPorts: readonly Readonly<ConnectorPortDefinition>[];
  private revision = 0;

  public constructor(blueprint: ShipModelBlueprint) {
    if (typeof blueprint.shipId !== 'string' || blueprint.shipId.trim().length === 0) {
      throw new RangeError('飞船实例 ID 不能为空');
    }
    if (blueprint.crews.length > blueprint.hull.maxCrew) throw new RangeError('船员数量超过船体上限');
    this.shipId = blueprint.shipId;
    this.configVersion = blueprint.configVersion ?? 'default';
    this.hull = blueprint.hull;
    this.constructionBlueprint = blueprint.construction ?? null;
    this.connectorPorts = Object.freeze([...(blueprint.construction?.connectorPorts ?? [])]);
    this.initialFloors = Object.freeze([...(blueprint.floors ?? [])].map((floor) => Object.freeze({ ...floor })));
    this.grid = new ShipGridModel(blueprint.hull);

    for (const room of blueprint.rooms) {
      if (this.roomDefinitions.has(room.instanceId)) throw new RangeError(`房间实例 ID 重复：${room.instanceId}`);
      const level = room.level ?? 1;
      const hp = room.hp ?? room.definition.maxHp;
      if (!Number.isInteger(level) || level <= 0 || level > room.definition.maxLevel) throw new RangeError(`房间等级无效：${room.instanceId}`);
      if (!Number.isInteger(hp) || hp < 0 || hp > room.definition.maxHp) throw new RangeError(`房间生命值无效：${room.instanceId}`);
      const placement: RoomPlacement = {
        instanceId: room.instanceId,
        definitionId: room.definition.id,
        x: room.x,
        y: room.y,
        width: room.definition.width,
        height: room.definition.height,
      };
      const placed = this.grid.placeRoom(placement);
      if (placed.ok === false) throw new RangeError(`房间 ${room.instanceId} 放置失败：${placed.code}`);
      this.roomDefinitions.set(room.instanceId, room.definition);
      this.roomStates.set(room.instanceId, { definition: room.definition, level, hp });
    }

    if (this.constructionBlueprint !== null) {
      for (const definition of this.constructionBlueprint.floorDefinitions) this.floorDefinitions.set(definition.id, definition);
      for (const definition of this.constructionBlueprint.roomDefinitions) this.constructionRoomDefinitions.set(definition.id, definition);
      for (const definition of this.roomDefinitions.values()) this.constructionRoomDefinitions.set(definition.id, definition);
      this.voxelLayout = new VoxelLayoutModel(this.hull);
      for (const floor of this.initialFloors) {
        const definition = this.floorDefinitions.get(floor.definitionId);
        if (definition === undefined) throw new RangeError(`初始地板定义不存在：${floor.definitionId}`);
        const placed = this.voxelLayout.placeInitialFloor(floor.instanceId, definition, floor.x, floor.y);
        if (placed.ok === false) throw new RangeError(placed.message);
      }
      for (const placement of this.grid.getRooms()) {
        const definition = this.roomDefinitions.get(placement.instanceId) as Readonly<RoomDefinition>;
        const placed = this.voxelLayout.buildRoom(placement.instanceId, definition, placement.x, placement.y);
        if (placed.ok === false) throw new RangeError(`初始体素房间无效：${placed.message}`);
      }
    }
    this.navigation = this.createNavigation();
    this.crewInitialStates = Object.freeze(blueprint.crews.map((entry) => ({
      id: entry.instanceId,
      definition: entry.definition,
      roomId: entry.roomInstanceId,
      stationIndex: entry.stationIndex,
      hp: entry.hp,
      identity: entry.identity,
      patrolRoomIds: entry.patrolRoomIds,
    })));
    this.crew = new CrewModel(this.navigation, this.crewInitialStates, {
      shipId: this.shipId,
      configVersion: this.configVersion,
    });
    this.energy = new EnergyModel(createEnergyRooms(this.roomDefinitions));
    if (this.voxelLayout !== null && this.constructionBlueprint !== null) {
      this.construction = new ConstructionModel(
        this.voxelLayout,
        this.hull.baseConstructionSlots,
        this.constructionBlueprint.initialMetal,
        this.constructionBlueprint.crewProfiles,
        this.floorDefinitions,
        this.constructionRoomDefinitions,
      );
    }
  }

  public getSnapshot(): ShipSnapshot {
    // buildersAtSite 是船员状态的派生字段；任何边界读取都先收敛一次，
    // 这样 UI、存档和施工结算不会各自看到不同的到场人数。
    this.syncConstructionBuildersAtSite();
    const rooms = this.grid.getRooms().map((placement) => {
      const state = this.roomStates.get(placement.instanceId) as RoomRuntimeState;
      return Object.freeze({
        instanceId: placement.instanceId,
        definitionId: placement.definitionId,
        x: placement.x,
        y: placement.y,
        level: state.level,
        hp: state.hp,
      });
    });
    return Object.freeze({
      schemaVersion: SHIP_SNAPSHOT_SCHEMA_VERSION,
      shipId: this.shipId,
      hullId: this.hull.id,
      revision: this.revision,
      rooms: Object.freeze(rooms),
      floors: this.voxelLayout?.getSnapshot().floors ?? this.initialFloors,
      constructionJobs: this.construction?.getSnapshot().jobs ?? this.constructionJobs,
      energy: this.energy.getSnapshot(),
      crews: this.crew.getSnapshot(),
    });
  }

  public apply(command: ShipCommand): ShipCommandResult {
    const before = this.getSnapshot();
    if (!isRecord(command) || typeof command.type !== 'string') return failure('INVALID_COMMAND', '飞船 Command 格式无效', before);
    if (command.shipId !== this.shipId) return failure('UNKNOWN_SHIP', `Command 目标飞船不存在：${String(command.shipId)}`, before);

    let message: string;
    if (command.type === 'MOVE_ROOM') {
      if (this.crew.isAnyCrewBusy()) return failure('CREW_MOVING', '船员执行任务期间不能调整房间布局', before);
      const moved = this.applyRoomMove(command.roomInstanceId, command.x, command.y, before);
      if (moved.ok === false) return moved;
      message = '房间位置已更新';
    } else if (command.type === 'SET_ROOM_POWER' || command.type === 'RESET_ROOM_POWER') {
      const result = this.energy.apply(command.type === 'SET_ROOM_POWER'
        ? { type: 'SET_ROOM_POWER', roomId: command.roomInstanceId, power: command.power }
        : { type: 'RESET_ROOM_POWER', roomId: command.roomInstanceId });
      if (result.ok === false) return failure('ENERGY_COMMAND_FAILED', result.message, before);
      const roomId = command.roomInstanceId;
      const room = this.roomStates.get(roomId);
      const treatmentStopped = room !== undefined && room.definition.healingHpPerTick > 0 &&
        (this.energy.getRoomPower(roomId) ?? 0) < room.definition.minPower && this.crew.stopHealingInRoom(roomId);
      message = treatmentStopped ? '医疗室已断电，治疗已停止' : '能源分配已更新';
    } else if (command.type === 'MOVE_CREW') {
      const result = this.crew.apply({ type: 'MOVE_CREW', crewId: command.crewInstanceId, targetRoomId: command.targetRoomInstanceId });
      if (result.ok === false) return failure('CREW_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'ISSUE_MOVE_ORDER') {
      const result = this.crew.apply({ type: 'ISSUE_MOVE_ORDER', crewId: command.crewInstanceId, targetNodeId: command.targetNodeId });
      if (result.ok === false) return failure('CREW_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'ISSUE_REPAIR_ORDER') {
      const room = this.roomStates.get(command.roomInstanceId);
      if (room === undefined) return failure('REPAIR_COMMAND_FAILED', `未知维修房间：${command.roomInstanceId}`, before);
      if (room.hp >= room.definition.maxHp) return failure('REPAIR_COMMAND_FAILED', `${room.definition.displayName}耐久已满`, before);
      const result = this.crew.apply({ type: 'ISSUE_REPAIR_ORDER', crewId: command.crewInstanceId, targetRoomId: command.roomInstanceId });
      if (result.ok === false) return failure('REPAIR_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'ISSUE_HEAL_ORDER') {
      const room = this.roomStates.get(command.roomInstanceId);
      if (room === undefined || room.definition.healingHpPerTick <= 0) {
        return failure('HEAL_COMMAND_FAILED', `目标房间不具备医疗能力：${command.roomInstanceId}`, before);
      }
      if ((this.energy.getRoomPower(command.roomInstanceId) ?? 0) < room.definition.minPower) {
        return failure('HEAL_COMMAND_FAILED', `${room.definition.displayName}能源不足`, before);
      }
      const result = this.crew.apply({
        type: 'ISSUE_HEAL_ORDER', patientCrewId: command.patientCrewInstanceId,
        medicCrewId: command.medicCrewInstanceId, targetRoomId: command.roomInstanceId,
      });
      if (result.ok === false) return failure('HEAL_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'CANCEL_CREW_ORDER') {
      const result = this.crew.apply({ type: 'CANCEL_CREW_ORDER', crewId: command.crewInstanceId });
      if (result.ok === false) return failure('CREW_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'SET_PATROL_ENABLED') {
      const result = this.crew.apply({ type: 'SET_PATROL_ENABLED', crewId: command.crewInstanceId, enabled: command.enabled });
      if (result.ok === false) return failure('CREW_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'LEAVE_CONSTRUCTION') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      const crewState = this.crew.getReadStates().find((entry) => entry.id === command.crewInstanceId);
      const jobId = crewState?.constructionJobId ?? null;
      if (jobId === null) return failure('CONSTRUCTION_COMMAND_FAILED', '该船员没有施工分配', before);
      const job = construction.getSnapshot().jobs.find((entry) => entry.jobId === jobId);
      if (job === undefined) return failure('CONSTRUCTION_COMMAND_FAILED', `施工项目不存在：${jobId}`, before);
      const assigned = construction.assignBuilders(jobId, job.assignedCrewIds.filter((id) => id !== command.crewInstanceId));
      if (assigned.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', assigned.message, before);
      this.crew.releaseCrewFromConstruction(command.crewInstanceId);
      message = '工程师已离开施工项目';
    } else if (command.type === 'START_REPAIR') {
      const room = this.roomStates.get(command.roomInstanceId);
      if (room === undefined) return failure('REPAIR_COMMAND_FAILED', `未知维修房间：${command.roomInstanceId}`, before);
      if (room.hp >= room.definition.maxHp) return failure('REPAIR_COMMAND_FAILED', `${room.definition.displayName}耐久已满`, before);
      const result = this.crew.apply({ type: 'START_REPAIR', crewId: command.crewInstanceId, targetRoomId: command.roomInstanceId });
      if (result.ok === false) return failure('REPAIR_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'STOP_REPAIR') {
      const result = this.crew.apply({ type: 'STOP_REPAIR', crewId: command.crewInstanceId });
      if (result.ok === false) return failure('REPAIR_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'START_HEAL') {
      const room = this.roomStates.get(command.roomInstanceId);
      if (room === undefined || room.definition.healingHpPerTick <= 0) {
        return failure('HEAL_COMMAND_FAILED', `目标房间不具备医疗能力：${command.roomInstanceId}`, before);
      }
      if ((this.energy.getRoomPower(command.roomInstanceId) ?? 0) < room.definition.minPower) {
        return failure('HEAL_COMMAND_FAILED', `${room.definition.displayName}能源不足`, before);
      }
      const result = this.crew.apply({
        type: 'START_HEAL',
        patientCrewId: command.patientCrewInstanceId,
        medicCrewId: command.medicCrewInstanceId,
        targetRoomId: command.roomInstanceId,
      });
      if (result.ok === false) return failure('HEAL_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'STOP_HEAL') {
      const result = this.crew.apply({ type: 'STOP_HEAL', patientCrewId: command.patientCrewInstanceId });
      if (result.ok === false) return failure('HEAL_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else if (command.type === 'START_BUILD_FLOOR') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      const result = construction.startBuildFloor(command.jobId, command.floorInstanceId, command.floorDefinitionId, command.x, command.y, command.nowUnixMs);
      if (result.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', result.message, before);
      message = `${result.message}，${this.autoAssignBuilder(command.jobId)}`;
    } else if (command.type === 'START_BUILD_ROOM') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      const result = construction.startBuildRoom(command.jobId, command.roomInstanceId, command.roomDefinitionId, command.x, command.y, command.nowUnixMs);
      if (result.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', result.message, before);
      message = `${result.message}，${this.autoAssignBuilder(command.jobId)}`;
    } else if (command.type === 'ASSIGN_BUILDERS') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      const job = construction.getSnapshot().jobs.find((entry) => entry.jobId === command.jobId);
      if (job === undefined) return failure('CONSTRUCTION_COMMAND_FAILED', `施工项目不存在：${command.jobId}`, before);
      const existing = job.assignedCrewIds;
      const requested = Array.from(new Set([...existing, ...command.crewInstanceIds])).sort((left, right) => left.localeCompare(right));
      if (requested.length > 3) return failure('CONSTRUCTION_COMMAND_FAILED', '同一项目最多分配三名不重复工程师', before);
      const assigned = this.assignBuildersToJob(job, requested);
      if (assigned.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', assigned.message, before);
      message = assigned.message;
    } else if (command.type === 'CANCEL_CONSTRUCTION') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      const result = construction.cancel(command.jobId);
      if (result.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', result.message, before);
      this.crew.releaseConstructionJob(command.jobId);
      message = result.message;
    } else if (command.type === 'START_DEMOLITION') {
      const construction = this.requireConstruction(before);
      if ('ok' in construction) return construction;
      if (command.targetType === 'ROOM') {
        if (this.crew.getReadStates().some((crew) => crew.currentRoomId === command.targetInstanceId || crew.targetRoomId === command.targetInstanceId)) {
          return failure('CONSTRUCTION_COMMAND_FAILED', '请先转移房间内人员或结束相关任务', before);
        }
        if ((this.energy.getRoomPower(command.targetInstanceId) ?? 0) > 0) return failure('CONSTRUCTION_COMMAND_FAILED', '请先断开房间能源', before);
      }
      const result = construction.startDemolition(command.jobId, command.targetType === 'FLOOR' ? 'DEMOLISH_FLOOR' : 'DEMOLISH_ROOM', command.targetInstanceId, command.nowUnixMs);
      if (result.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', result.message, before);
      message = result.message;
    } else {
      return failure('INVALID_COMMAND', '飞船 Command 类型无效', before);
    }

    if (JSON.stringify(before) === JSON.stringify(this.getSnapshot())) {
      return { ok: true, snapshot: before, events: Object.freeze([]), message };
    }
    this.revision += 1;
    const snapshot = this.getSnapshot();
    return {
      ok: true,
      snapshot,
      events: Object.freeze([{ type: 'SHIP_STATE_CHANGED', shipId: this.shipId, revision: this.revision }]),
      message,
    };
  }

  private autoAssignBuilder(jobId: string): string {
    const job = this.construction?.getSnapshot().jobs.find((entry) => entry.jobId === jobId);
    if (job === undefined) return '施工项目等待工程师';
    const candidates = this.getConstructionWorksiteNodes(job);
    const ranked = this.crew.getReadStates()
      .filter((crew) => crew.role === 'ENGINEER' && crew.state === 'IDLE' && crew.constructionJobId === null && crew.activeOrder === null)
      .map((crew) => ({ crew, cost: shortestPathCost(this.navigation, crew.currentNodeId, candidates, crew.moveTicksPerEdge) }))
      .filter((entry): entry is { readonly crew: typeof entry.crew; readonly cost: number } => entry.cost !== null)
      .sort((left, right) => left.cost - right.cost || left.crew.id.localeCompare(right.crew.id));
    const selected = ranked[0]?.crew.id;
    if (selected === undefined) return '施工项目已创建，等待工程师';
    const assigned = this.assignBuildersToJob(job, [selected]);
    return assigned.ok ? `已自动安排${selected}前往施工区域` : '施工项目已创建，等待工程师';
  }

  private assignBuildersToJob(
    job: Readonly<ConstructionJobSnapshot>,
    requestedCrewIds: readonly string[],
  ): { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string } {
    const construction = this.construction;
    if (construction === null) return { ok: false, message: '当前飞船没有施工系统' };
    const states = new Map(this.crew.getReadStates().map((crew) => [crew.id, crew]));
    for (const crewId of requestedCrewIds) {
      const state = states.get(crewId);
      const retainedInThisJob = state?.constructionJobId === job.jobId;
      if (state?.role !== 'ENGINEER' || (!retainedInThisJob && ['IDLE', 'PATROLLING', 'CONSTRUCTING'].indexOf(state.state) < 0)) {
        return { ok: false, message: `施工人员不可用：${crewId}` };
      }
    }
    const constructionBefore = construction.getSnapshot();
    const crewBefore = this.crew.getSnapshot();
    const assigned = construction.assignBuilders(job.jobId, requestedCrewIds);
    if (assigned.ok === false) return { ok: false, message: assigned.message };
    const retained = new Set(requestedCrewIds);
    for (const crewId of job.assignedCrewIds) {
      if (!retained.has(crewId)) this.crew.releaseCrewFromConstruction(crewId);
    }
    const candidates = this.getConstructionWorksiteNodes(job);
    const usedWorksiteNodes = new Set(
      this.crew.getReadStates()
        .filter((crew) => crew.constructionJobId === job.jobId && crew.constructionWorksiteNodeId !== null)
        .map((crew) => crew.constructionWorksiteNodeId as string),
    );
    for (const crewId of [...requestedCrewIds].sort((left, right) => left.localeCompare(right))) {
      const current = states.get(crewId);
      if (current?.constructionJobId === job.jobId && current.constructionWorksiteNodeId !== null && current.state !== 'IDLE') continue;
      let moved = false;
      // 先分散到仍空闲的邻近地板；狭窄工地没有足够地板时才允许同项目共享节点。
      const orderedCandidates = [...candidates.filter((nodeId) => !usedWorksiteNodes.has(nodeId)), ...candidates.filter((nodeId) => usedWorksiteNodes.has(nodeId))];
      for (const nodeId of orderedCandidates) {
        const result = this.crew.assignConstructionJob(crewId, job.jobId, nodeId);
        if (result.ok === true) {
          usedWorksiteNodes.add(nodeId);
          moved = true;
          break;
        }
        if (result.code !== 'CREW_BUSY' && result.code !== 'PATH_NOT_FOUND') {
          construction.restore(constructionBefore);
          const restoredCrew = CrewModel.restore(this.navigation, this.crewInitialStates, crewBefore, { shipId: this.shipId, configVersion: this.configVersion });
          if (restoredCrew.ok === true) this.crew = restoredCrew.model;
          return { ok: false, message: result.message };
        }
      }
      if (!moved) {
        construction.restore(constructionBefore);
        const restoredCrew = CrewModel.restore(this.navigation, this.crewInitialStates, crewBefore, { shipId: this.shipId, configVersion: this.configVersion });
        if (restoredCrew.ok === true) this.crew = restoredCrew.model;
        return { ok: false, message: '没有足够的可达施工地板' };
      }
    }
    const nextStates = this.crew.getReadStates().filter((crew) => requestedCrewIds.indexOf(crew.id) >= 0);
    if (nextStates.length !== requestedCrewIds.length || nextStates.some((crew) => crew.constructionJobId !== job.jobId || crew.activeOrder?.type !== 'CONSTRUCTION')) {
      construction.restore(constructionBefore);
      const restoredCrew = CrewModel.restore(this.navigation, this.crewInitialStates, crewBefore, { shipId: this.shipId, configVersion: this.configVersion });
      if (restoredCrew.ok === true) this.crew = restoredCrew.model;
      return { ok: false, message: '施工人员与项目绑定不一致' };
    }
    const atSite = nextStates.filter((crew) => crew.state === 'CONSTRUCTING').map((crew) => crew.id);
    const synchronized = construction.setBuildersAtSite(job.jobId, atSite);
    if (synchronized.ok === false) return { ok: false, message: synchronized.message };
    return { ok: true, message: requestedCrewIds.length > job.assignedCrewIds.length ? '工程师已追加并前往施工区域' : '施工人员已更新' };
  }

  private getConstructionWorksiteNodes(job: Readonly<ConstructionJobSnapshot>): readonly string[] {
    const floors = this.voxelLayout?.getSnapshot().floors ?? [];
    const room = job.operation === 'BUILD_ROOM' || job.operation === 'DEMOLISH_ROOM' ? this.constructionRoomDefinitions.get(job.definitionId) : undefined;
    const width = room?.width ?? 1;
    const deckY = room === undefined ? job.y : job.y - 1;
    const ranked = floors
      .filter((floor) => floor.y === deckY)
      .map((floor) => ({
        nodeId: floorNodeId(floor.x, floor.y),
        distance: floor.x < job.x ? job.x - floor.x : floor.x >= job.x + width ? floor.x - (job.x + width - 1) : 0,
      }))
      .filter((entry) => this.navigation.getNode(entry.nodeId)?.kind === 'FLOOR')
      .sort((left, right) => left.distance - right.distance || left.nodeId.localeCompare(right.nodeId));
    const nearestDistance = ranked[0]?.distance;
    return nearestDistance === undefined ? [] : ranked.filter((entry) => entry.distance === nearestDistance).map((entry) => entry.nodeId);
  }

  public advanceOneTick(): ShipSnapshot {
    const before = this.getSnapshot();
    this.crew.advanceOneTick((_crewId, roomId, repairHp) => {
      const room = this.roomStates.get(roomId);
      if (room === undefined) return true;
      room.hp = Math.min(room.definition.maxHp, room.hp + repairHp);
      return room.hp >= room.definition.maxHp;
    }, (_medicCrewId, _patientCrewId, roomId) => {
      const room = this.roomStates.get(roomId);
      if (room === undefined || room.definition.healingHpPerTick <= 0) return 0;
      if ((this.energy.getRoomPower(roomId) ?? 0) < room.definition.minPower) return 0;
      return room.definition.healingHpPerTick;
    });
    // 船员到达工位后立即同步施工队列，避免 UI 在下一次整秒结算前出现“施工中但 0/N”。
    this.syncConstructionBuildersAtSite();
    if (JSON.stringify(before) !== JSON.stringify(this.getSnapshot())) this.revision += 1;
    return this.getSnapshot();
  }

  /** 施工使用应用层传入的真实时间，每次调用最多产生一次单舰 revision。 */
  public settleConstruction(nowUnixMs: number): ShipCommandResult {
    const before = this.getSnapshot();
    const construction = this.requireConstruction(before);
    if ('ok' in construction) return construction;
    const jobsBefore = construction.getSnapshot().jobs;
    const presenceSynchronized = this.syncConstructionBuildersAtSite();
    if (presenceSynchronized === false) return failure('CONSTRUCTION_COMMAND_FAILED', '施工队列与船员到场状态同步失败', before);
    const result = construction.settleTo(nowUnixMs);
    if (result.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', result.message, before);
    const completedJobIds = jobsBefore.filter((job) => !result.snapshot.jobs.some((next) => next.jobId === job.jobId)).map((job) => job.jobId);
    if (completedJobIds.length > 0) {
      for (const jobId of completedJobIds) this.crew.releaseConstructionJob(jobId);
      const layoutSynchronized = this.syncRuntimeFromVoxel(before);
      if (layoutSynchronized.ok === false) return layoutSynchronized;
    }
    if (JSON.stringify(before) === JSON.stringify(this.getSnapshot())) return { ok: true, snapshot: before, events: Object.freeze([]), message: result.message };
    this.revision += 1;
    const snapshot = this.getSnapshot();
    return { ok: true, snapshot, events: Object.freeze([{ type: 'SHIP_STATE_CHANGED', shipId: this.shipId, revision: this.revision }]), message: result.message };
  }

  public setConstructionMetal(metal: number): void {
    this.construction?.setMetal(metal);
  }

  public getConstructionMetal(): number | null {
    return this.construction?.getSnapshot().metal ?? null;
  }

  /** 只读建造预览；规则和正式开工共用 ConstructionModel 校验，绝不写入布局或快照。 */
  public previewConstruction(kind: 'FLOOR' | 'ROOM', definitionId: string, x: number, y: number): ShipConstructionPreview {
    const result = this.construction === null
      ? { ok: false as const, code: 'NO_CONSTRUCTION', message: '当前飞船没有可用施工系统', width: 1, height: 1, metalCost: 0, metal: 0, constructionSlots: 0, usedConstructionSlots: 0 }
      : kind === 'FLOOR'
        ? this.construction.previewBuildFloor(definitionId, x, y)
        : this.construction.previewBuildRoom(definitionId, x, y);
    return Object.freeze({ ...result, revision: this.revision });
  }

  public static restore(blueprint: ShipModelBlueprint, snapshot: unknown): ShipRestoreResult {
    if (!isShipSnapshot(snapshot) || snapshot.shipId !== blueprint.shipId || snapshot.hullId !== blueprint.hull.id) {
      return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船快照版本、实例或船体不匹配' };
    }
    const roomBlueprints = new Map(blueprint.rooms.map((room) => [room.instanceId, room]));
    const constructionDefinitions = new Map((blueprint.construction?.roomDefinitions ?? []).map((definition) => [definition.id, definition]));
    if (blueprint.construction === undefined && snapshot.rooms.length !== roomBlueprints.size) return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船快照房间数量不匹配' };
    const restoredRooms: ShipRoomInitialState[] = [];
    for (const room of snapshot.rooms) {
      const initial = roomBlueprints.get(room.instanceId);
      const definition = initial?.definition ?? constructionDefinitions.get(room.definitionId);
      if (definition === undefined || definition.id !== room.definitionId) {
        return { ok: false, code: 'INVALID_SNAPSHOT', message: `飞船快照包含未知房间：${room.instanceId}` };
      }
      restoredRooms.push({ ...room, definition });
    }
    let model: ShipModel;
    try {
      model = new ShipModel({ ...blueprint, rooms: restoredRooms, floors: snapshot.floors });
    } catch (cause) {
      return { ok: false, code: 'INVALID_SNAPSHOT', message: describeCause(cause) };
    }
    const energy = EnergyModel.restore(createEnergyRooms(model.roomDefinitions), snapshot.energy);
    if (energy.ok === false) return { ok: false, code: 'INVALID_SNAPSHOT', message: energy.message };
    if (!Array.isArray(snapshot.constructionJobs)) return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船施工队列无效' };
    const crew = CrewModel.restore(model.navigation, model.crewInitialStates, snapshot.crews, {
      shipId: model.shipId,
      configVersion: model.configVersion,
    });
    if (crew.ok === false) return { ok: false, code: 'INVALID_SNAPSHOT', message: crew.message };
    for (const entry of crew.model.getReadStates()) {
      const room = model.roomStates.get(entry.targetRoomId ?? '');
      if (entry.state === 'REPAIRING' && (room === undefined || room.hp >= room.definition.maxHp)) {
        return { ok: false, code: 'INVALID_SNAPSHOT', message: `维修任务目标无效：${entry.id}` };
      }
      if ((entry.state === 'HEALING' || entry.state === 'TREATING') &&
        (room === undefined || room.definition.healingHpPerTick <= 0 || (energy.model.getRoomPower(entry.currentRoomId) ?? 0) < room.definition.minPower)) {
        return { ok: false, code: 'INVALID_SNAPSHOT', message: `医疗任务目标或能源无效：${entry.id}` };
      }
    }
    model.copyEnergyFrom(energy.model);
    model.crew = crew.model;
    if (model.construction !== null) {
      const restoredConstruction = model.construction.restore({ metal: model.construction.getSnapshot().metal, jobs: snapshot.constructionJobs });
      if (restoredConstruction.ok === false) return { ok: false, code: 'INVALID_SNAPSHOT', message: restoredConstruction.message };
    } else if (snapshot.constructionJobs.length > 0) {
      return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船没有施工目录但快照包含施工项目' };
    }
    const constructionBindingError = validateConstructionCrewBindings(snapshot.constructionJobs, crew.model.getSnapshot().crews);
    if (constructionBindingError !== null) return { ok: false, code: 'INVALID_SNAPSHOT', message: constructionBindingError };
    model.constructionJobs = Object.freeze(snapshot.constructionJobs.map((job) => Object.freeze({ ...job })));
    model.revision = snapshot.revision;
    return { ok: true, model };
  }

  private applyRoomMove(roomInstanceId: string, x: number, y: number, before: ShipSnapshot): ShipCommandResult | { readonly ok: true } {
    if (this.voxelLayout !== null) return failure('ROOM_COMMAND_FAILED', '体素建造模式下房间不能直接拖动，请使用拆除与建造', before);
    const validation = this.grid.moveRoom({ type: 'MOVE_ROOM', roomInstanceId, x, y });
    if (validation.ok === false) return failure('ROOM_COMMAND_FAILED', `房间移动失败：${validation.code}`, before);
    let nextNavigation: NavigationGraph;
    try {
      nextNavigation = new NavigationGraph(this.grid.getRooms(), this.roomDefinitions);
    } catch (cause) {
      this.restoreGridFromSnapshot(before);
      return failure('ROOM_COMMAND_FAILED', describeCause(cause), before);
    }
    const restoredCrew = CrewModel.restore(nextNavigation, this.crewInitialStates, this.crew.getSnapshot(), {
      shipId: this.shipId,
      configVersion: this.getConfigVersion(),
    });
    if (restoredCrew.ok === false) {
      this.restoreGridFromSnapshot(before);
      return failure('ROOM_COMMAND_FAILED', restoredCrew.message, before);
    }
    this.navigation = nextNavigation;
    this.crew = restoredCrew.model;
    return { ok: true };
  }

  private restoreGridFromSnapshot(snapshot: ShipSnapshot): void {
    const layout = {
      schemaVersion: 1,
      hullId: snapshot.hullId,
      rooms: snapshot.rooms.map((room) => {
        const definition = this.roomDefinitions.get(room.instanceId) as RoomDefinition;
        return { ...room, width: definition.width, height: definition.height };
      }),
    };
    const restored = restoreShipLayout(JSON.stringify(layout), this.hull);
    if (restored.ok === false) throw new Error(`内部布局回滚失败：${restored.message}`);
    this.grid = restored.grid;
  }

  private copyEnergyFrom(source: EnergyModel): void {
    const restoredSnapshot = source.getSnapshot();
    for (const allocation of restoredSnapshot.allocations) {
      const result = this.energy.apply({ type: 'SET_ROOM_POWER', roomId: allocation.roomId, power: allocation.power });
      if (result.ok === false) throw new Error(`内部能源恢复失败：${result.message}`);
    }
  }

  private requireConstruction(before: ShipSnapshot): ConstructionModel | ShipCommandResult {
    return this.construction ?? failure('CONSTRUCTION_COMMAND_FAILED', '当前飞船没有启用施工目录', before);
  }

  private createNavigation(): NavigationGraph {
    if (this.voxelLayout === null) return new NavigationGraph(this.grid.getRooms(), this.roomDefinitions);
    const layout = this.voxelLayout.getSnapshot();
    return new NavigationGraph(this.grid.getRooms(), this.roomDefinitions, {
      floors: layout.floors.map((floor) => ({ ...floor, completed: true })),
      connectors: this.grid.getRooms()
        .filter((room) => this.roomDefinitions.get(room.instanceId)?.verticalConnectorKind !== 'NONE')
        .map((room) => ({
          roomInstanceId: room.instanceId,
          definitionId: room.definitionId,
          ports: this.connectorPorts.filter((port) => port.roomDefinitionId === room.definitionId),
          completed: true,
        })),
    });
  }

  /** 施工完成后只重建当前飞船的布局、能源目录与导航；船员快照必须仍能完整恢复。 */
  private syncRuntimeFromVoxel(before: ShipSnapshot): ShipCommandResult | { readonly ok: true } {
    if (this.voxelLayout === null) return { ok: true };
    const layout = this.voxelLayout.getSnapshot();
    const previousRooms = new Map(this.roomStates);
    const previousEnergy = this.energy.getSnapshot();
    const previousCrew = this.crew.getSnapshot();
    const nextGrid = new ShipGridModel(this.hull);
    const nextDefinitions = new Map<string, Readonly<RoomDefinition>>();
    const nextStates = new Map<string, RoomRuntimeState>();
    for (const room of layout.rooms) {
      const definition = this.constructionRoomDefinitions.get(room.definitionId);
      if (definition === undefined) return failure('CONSTRUCTION_COMMAND_FAILED', `施工完成后缺少房间定义：${room.definitionId}`, before);
      const placed = nextGrid.placeRoom({ ...room, width: definition.width, height: definition.height });
      if (placed.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', `施工完成后布局无效：${placed.code}`, before);
      const previous = previousRooms.get(room.instanceId);
      nextDefinitions.set(room.instanceId, definition);
      nextStates.set(room.instanceId, previous ?? { definition, level: 1, hp: definition.maxHp });
    }
    this.grid = nextGrid;
    this.roomDefinitions.clear();
    this.roomStates.clear();
    for (const [id, definition] of nextDefinitions) this.roomDefinitions.set(id, definition);
    for (const [id, state] of nextStates) this.roomStates.set(id, state);
    this.energy = new EnergyModel(createEnergyRooms(this.roomDefinitions));
    for (const allocation of previousEnergy.allocations) {
      if (!this.roomDefinitions.has(allocation.roomId)) continue;
      const applied = this.energy.apply({ type: 'SET_ROOM_POWER', roomId: allocation.roomId, power: allocation.power });
      if (applied.ok === false) this.energy.apply({ type: 'RESET_ROOM_POWER', roomId: allocation.roomId });
    }
    try {
      this.navigation = this.createNavigation();
    } catch (cause) {
      return failure('CONSTRUCTION_COMMAND_FAILED', describeCause(cause), before);
    }
    const crew = CrewModel.restore(this.navigation, this.crewInitialStates, previousCrew, { shipId: this.shipId, configVersion: this.configVersion });
    if (crew.ok === false) return failure('CONSTRUCTION_COMMAND_FAILED', crew.message, before);
    this.crew = crew.model;
    return { ok: true };
  }

  private getConfigVersion(): string {
    // 当前模型只需在构造与布局重建间保持同一代号上下文；从初始身份恢复时已固定为该值。
    // 该字段通过蓝图闭包保存，避免把配置版本重复写入 ShipSnapshot。
    return this.configVersion;
  }

  /**
   * 到场人数是 CrewModel 当前状态的派生值，不允许由 UI 或旧快照独立维护。
   * 统一在固定 Tick、施工结算和分配完成后调用，保证进度封顶与状态面板使用同一份事实。
   */
  private syncConstructionBuildersAtSite(): boolean {
    if (this.construction === null) return true;
    const crewStates = this.crew.getReadStates();
    for (const job of this.construction.getSnapshot().jobs) {
      const onSite = crewStates
        .filter((crew) => crew.constructionJobId === job.jobId
          && job.assignedCrewIds.indexOf(crew.id) >= 0
          // 状态与导航锚点都由 CrewModel 提供；锚点相等时即使 UI 读取跨过了
          // 一个固定 Tick，也不能把已经到工位的工程师误算为“前往工地”。
          && (crew.state === 'CONSTRUCTING' || crew.currentNodeId === crew.constructionWorksiteNodeId))
        .map((crew) => crew.id);
      if (this.construction.setBuildersAtSite(job.jobId, onSite).ok === false) return false;
    }
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShipSnapshot(value: unknown): value is ShipSnapshot {
  return isRecord(value) && value.schemaVersion === SHIP_SNAPSHOT_SCHEMA_VERSION &&
    typeof value.shipId === 'string' && typeof value.hullId === 'string' &&
    Number.isInteger(value.revision) && (value.revision as number) >= 0 &&
    Array.isArray(value.rooms) && Array.isArray(value.floors) && Array.isArray(value.constructionJobs) && isRecord(value.energy) && isRecord(value.crews) &&
    value.rooms.every((room) => isRecord(room) && typeof room.instanceId === 'string' &&
      typeof room.definitionId === 'string' && Number.isInteger(room.x) && Number.isInteger(room.y) &&
      Number.isInteger(room.level) && Number.isInteger(room.hp));
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 施工队列与船员后台任务必须作为一个原子快照恢复。
 * 仅校验两个数组各自合法会把“队列已分配、船员却没有对应施工任务”的存档静默恢复成永久 1/N。
 */
function validateConstructionCrewBindings(
  jobs: readonly ConstructionJobSnapshot[],
  crews: readonly CrewSnapshotEntry[],
): string | null {
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
  const assignedByCrew = new Map<string, ConstructionJobSnapshot>();
  for (const job of jobs) {
    for (const crewId of job.assignedCrewIds) {
      const previous = assignedByCrew.get(crewId);
      if (previous !== undefined && previous.jobId !== job.jobId) return `工程师同时分配到多个施工项目：${crewId}`;
      assignedByCrew.set(crewId, job);
      const crew = crews.find((entry) => entry.id === crewId);
      if (crew === undefined) return `施工项目引用未知工程师：${crewId}`;
      if (crew.constructionJobId !== job.jobId) return `施工项目与工程师任务不一致：${crewId}`;
    }
  }
  for (const crew of crews) {
    if (crew.constructionJobId === null) {
      if (assignedByCrew.has(crew.id)) return `工程师施工分配未写入船员任务：${crew.id}`;
      continue;
    }
    const job = jobsById.get(crew.constructionJobId);
    if (job === undefined) return `船员引用不存在的施工项目：${crew.id}`;
    if (job.assignedCrewIds.indexOf(crew.id) < 0) return `船员未被当前施工项目分配：${crew.id}`;
    if (crew.activeOrder?.type !== 'CONSTRUCTION' || crew.activeOrder.jobId !== job.jobId) {
      return `船员施工订单与项目不一致：${crew.id}`;
    }
  }
  return null;
}

function failure(code: ShipCommandErrorCode, message: string, snapshot: ShipSnapshot): ShipCommandResult {
  return { ok: false, code, message, snapshot };
}

function shortestPathCost(
  navigation: NavigationGraph,
  fromNodeId: string,
  targets: readonly string[],
  moveTicksPerEdge: number,
): number | null {
  let best: number | null = null;
  for (const target of targets) {
    const path = navigation.findPath(fromNodeId, target, moveTicksPerEdge);
    if (path.ok === false) continue;
    let cost = 0;
    for (let index = 1; index < path.nodeIds.length; index += 1) {
      cost += navigation.getEdgeTravelTicks(path.nodeIds[index - 1], path.nodeIds[index], moveTicksPerEdge);
    }
    if (best === null || cost < best) best = cost;
  }
  return best;
}
