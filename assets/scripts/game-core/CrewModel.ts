import type { CrewDefinition, CrewRole } from './CrewDefinition.ts';
import {
  resolveCrewIdentities,
  type CrewIdentity,
  type CrewIdentityContext,
  type CrewIdentityInitialState,
  type CrewNameMode,
} from './CrewIdentity.ts';
import { NavigationGraph, stationNodeId, type NavigationNode } from './NavigationGraph.ts';

export const CREW_SNAPSHOT_SCHEMA_VERSION = 6 as const;

export type CrewState = 'IDLE' | 'MOVING' | 'REPAIRING' | 'HEALING' | 'TREATING' | 'PATROLLING' | 'CONSTRUCTING';

export interface CrewInitialState {
  readonly id: string;
  readonly definition: Readonly<CrewDefinition>;
  readonly roomId: string;
  readonly stationIndex: number;
  readonly hp?: number;
  /** 船员代号输入；省略时使用稳定 GENERATED 代号。 */
  readonly identity?: CrewIdentityInitialState;
  /** 士兵实例的有序巡逻房间；普通职业必须为空。 */
  readonly patrolRoomIds?: readonly string[];
}

export interface CrewSnapshotEntry {
  readonly id: string;
  readonly definitionId: string;
  readonly nameMode: CrewNameMode;
  readonly callSign: string;
  readonly hp: number;
  readonly state: CrewState;
  /** 当前完整到达的导航节点；地板停留时 roomId/stationIndex 均为 null。 */
  readonly currentNodeId: string;
  readonly currentRoomId: string | null;
  readonly currentStationIndex: number | null;
  readonly targetNodeId: string | null;
  readonly targetRoomId: string | null;
  readonly targetStationIndex: number | null;
  readonly pathNodeIds: readonly string[];
  readonly pathIndex: number;
  readonly ticksIntoEdge: number;
  readonly taskPartnerCrewId: string | null;
  readonly patrolRoomIds: readonly string[];
  readonly patrolIndex: number;
  readonly patrolPauseTicks: number;
  readonly patrolBlockedGraphVersion: string | null;
  readonly patrolEnabled: boolean;
  readonly constructionJobId: string | null;
  readonly constructionWorksiteNodeId: string | null;
  readonly activeOrder: CrewOrderSnapshot | null;
}

export type CrewOrderSnapshot =
  | { readonly type: 'MOVE'; readonly targetNodeId: string }
  | { readonly type: 'REPAIR'; readonly targetNodeId: string; readonly targetRoomId: string }
  | { readonly type: 'HEAL'; readonly targetNodeId: string; readonly targetRoomId: string; readonly partnerCrewId: string; readonly participant: 'PATIENT' | 'MEDIC' }
  | { readonly type: 'CONSTRUCTION'; readonly targetNodeId: string; readonly jobId: string };

export interface CrewSnapshot {
  readonly schemaVersion: typeof CREW_SNAPSHOT_SCHEMA_VERSION;
  readonly crews: readonly CrewSnapshotEntry[];
}

export interface CrewReadState extends CrewSnapshotEntry {
  readonly displayName: string;
  readonly role: CrewRole;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
  readonly repairHpPerTick: number;
  readonly currentNodeId: string;
  readonly nextNodeId: string | null;
  readonly edgeProgress: number;
}

export type CrewCommand =
  | { readonly type: 'MOVE_CREW'; readonly crewId: string; readonly targetRoomId: string }
  | { readonly type: 'ISSUE_MOVE_ORDER'; readonly crewId: string; readonly targetNodeId: string }
  | { readonly type: 'ISSUE_REPAIR_ORDER'; readonly crewId: string; readonly targetRoomId: string }
  | { readonly type: 'ISSUE_HEAL_ORDER'; readonly patientCrewId: string; readonly medicCrewId: string; readonly targetRoomId: string }
  | { readonly type: 'CANCEL_CREW_ORDER'; readonly crewId: string }
  | { readonly type: 'SET_PATROL_ENABLED'; readonly crewId: string; readonly enabled: boolean }
  | { readonly type: 'START_REPAIR'; readonly crewId: string; readonly targetRoomId: string }
  | { readonly type: 'STOP_REPAIR'; readonly crewId: string }
  | { readonly type: 'START_HEAL'; readonly patientCrewId: string; readonly medicCrewId: string; readonly targetRoomId: string }
  | { readonly type: 'STOP_HEAL'; readonly patientCrewId: string };

/** ShipModel 在同一个固定 Tick 内应用房间维修效果，返回 true 表示目标已经修满。 */
export type CrewRepairTickHandler = (crewId: string, roomId: string, repairHp: number) => boolean;

/** ShipModel 返回当前医疗室本 Tick 的有效治疗量；0 表示治疗条件已失效。 */
export type CrewHealingTickHandler = (medicCrewId: string, patientCrewId: string, roomId: string) => number;

export type CrewErrorCode =
  | 'INVALID_CREW_ID'
  | 'DUPLICATE_CREW_ID'
  | 'UNKNOWN_CREW'
  | 'UNKNOWN_ROOM'
  | 'ROOM_FULL'
  | 'PATH_NOT_FOUND'
  | 'CREW_BUSY'
  | 'REPAIR_NOT_ALLOWED'
  | 'NOT_REPAIRING'
  | 'HEAL_NOT_ALLOWED'
  | 'NOT_HEALING'
  | 'INVALID_COMMAND'
  | 'INVALID_INITIAL_STATE'
  | 'INVALID_SNAPSHOT';

export type CrewCommandResult =
  | { readonly ok: true; readonly snapshot: CrewSnapshot; readonly message: string }
  | { readonly ok: false; readonly code: CrewErrorCode; readonly message: string };

export type CrewTickResult = {
  readonly snapshot: CrewSnapshot;
  readonly crossedEdge: boolean;
};

export type CrewRestoreResult =
  | { readonly ok: true; readonly model: CrewModel }
  | { readonly ok: false; readonly code: CrewErrorCode; readonly message: string };

interface MutableCrewState {
  id: string;
  definition: Readonly<CrewDefinition>;
  identity: CrewIdentity;
  hp: number;
  state: CrewState;
  currentNodeId: string;
  currentRoomId: string | null;
  currentStationIndex: number | null;
  targetNodeId: string | null;
  targetRoomId: string | null;
  targetStationIndex: number | null;
  pathNodeIds: string[];
  pathIndex: number;
  ticksIntoEdge: number;
  taskPartnerCrewId: string | null;
  patrolRoomIds: string[];
  patrolIndex: number;
  patrolPauseTicks: number;
  patrolBlockedGraphVersion: string | null;
  patrolEnabled: boolean;
  constructionJobId: string | null;
  constructionWorksiteNodeId: string | null;
  activeOrder: CrewOrderSnapshot | null;
}

/** 船员站位与移动的最小确定性模型；所有状态只通过 Command 或固定 Tick 修改。 */
export class CrewModel {
  private readonly crews = new Map<string, MutableCrewState>();
  private readonly navigation: NavigationGraph;

  public constructor(
    navigation: NavigationGraph,
    initialStates: readonly CrewInitialState[],
    identityContext: CrewIdentityContext = { shipId: 'ship-unknown', configVersion: 'default' },
  ) {
    this.navigation = navigation;
    const identities = resolveCrewIdentities(
      initialStates.map((initial) => ({ crewId: initial.id, identity: initial.identity })),
      identityContext,
    );
    const occupied = new Set<string>();
    for (const initial of initialStates) {
      if (typeof initial.id !== 'string' || initial.id.trim().length === 0) {
        throw new RangeError('船员实例 ID 不能为空');
      }
      if (this.crews.has(initial.id)) throw new RangeError(`船员实例 ID 重复：${initial.id}`);
      if (!this.navigation.hasRoom(initial.roomId)) throw new RangeError(`船员初始房间不存在：${initial.roomId}`);
      const stationId = stationNodeId(initial.roomId, initial.stationIndex);
      if (this.navigation.getNode(stationId) === null) throw new RangeError(`船员初始站位无效：${stationId}`);
      if (occupied.has(stationId)) throw new RangeError(`船员初始站位冲突：${stationId}`);
      occupied.add(stationId);
      const hp = initial.hp ?? initial.definition.maxHp;
      if (!Number.isInteger(hp) || hp <= 0 || hp > initial.definition.maxHp) {
        throw new RangeError(`船员初始生命必须是 1 到 ${initial.definition.maxHp} 的整数：${initial.id}`);
      }
      const patrolRoomIds = [...(initial.patrolRoomIds ?? [])];
      if (initial.definition.role !== 'SOLDIER' && patrolRoomIds.length > 0) throw new RangeError(`只有士兵可以配置巡逻路线：${initial.id}`);
      if (new Set(patrolRoomIds).size !== patrolRoomIds.length || patrolRoomIds.some((roomId) => !this.navigation.hasRoom(roomId))) {
        throw new RangeError(`船员巡逻路线无效：${initial.id}`);
      }
      this.crews.set(initial.id, {
        id: initial.id,
        definition: initial.definition,
        identity: identities.get(initial.id) as CrewIdentity,
        hp,
        state: 'IDLE',
        currentNodeId: stationId,
        currentRoomId: initial.roomId,
        currentStationIndex: initial.stationIndex,
        targetNodeId: null,
        targetRoomId: null,
        targetStationIndex: null,
        pathNodeIds: [stationId],
        pathIndex: 0,
        ticksIntoEdge: 0,
        taskPartnerCrewId: null,
        patrolRoomIds,
        patrolIndex: 0,
        patrolPauseTicks: 0,
        patrolBlockedGraphVersion: null,
        patrolEnabled: initial.definition.role === 'SOLDIER' && patrolRoomIds.length > 0,
        constructionJobId: null,
        constructionWorksiteNodeId: null,
        activeOrder: null,
      });
    }
  }

  public getReadStates(): readonly CrewReadState[] {
    return Array.from(this.crews.values())
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((crew) => {
        const currentNodeId = crew.pathNodeIds[crew.pathIndex] ?? crew.currentNodeId;
        const nextNodeId = crew.state === 'MOVING' || crew.state === 'PATROLLING' ? crew.pathNodeIds[crew.pathIndex + 1] ?? null : null;
        const edgeTicks = nextNodeId === null
          ? crew.definition.moveTicksPerEdge
          : this.navigation.getEdgeTravelTicks(currentNodeId, nextNodeId, crew.definition.moveTicksPerEdge);
        return Object.freeze({
          ...snapshotEntry(crew),
          displayName: crew.definition.displayName,
          role: crew.definition.role,
          maxHp: crew.definition.maxHp,
          moveTicksPerEdge: crew.definition.moveTicksPerEdge,
          repairHpPerTick: crew.definition.repairHpPerTick,
          currentNodeId,
          nextNodeId,
          edgeProgress: crew.state === 'MOVING' || crew.state === 'PATROLLING'
            ? crew.ticksIntoEdge / Math.max(1, edgeTicks)
            : 0,
        });
      });
  }

  public getSnapshot(): CrewSnapshot {
    const crews = Array.from(this.crews.values())
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((crew) => Object.freeze(snapshotEntry(crew)));
    return { schemaVersion: CREW_SNAPSHOT_SCHEMA_VERSION, crews: Object.freeze(crews) };
  }

  public isAnyCrewBusy(): boolean {
    return Array.from(this.crews.values()).some((crew) => crew.state !== 'IDLE');
  }

  public apply(command: CrewCommand): CrewCommandResult {
    if (!isRecord(command) || [
      'MOVE_CREW', 'ISSUE_MOVE_ORDER', 'ISSUE_REPAIR_ORDER', 'ISSUE_HEAL_ORDER',
      'CANCEL_CREW_ORDER', 'SET_PATROL_ENABLED', 'START_REPAIR', 'STOP_REPAIR',
      'START_HEAL', 'STOP_HEAL',
    ].indexOf(String(command.type)) === -1) {
      return failure('INVALID_COMMAND', '船员 Command 类型无效');
    }
    if (command.type === 'ISSUE_HEAL_ORDER') return this.issueHealingOrder(command);
    if (command.type === 'START_HEAL') return this.startHealing(command);
    if (command.type === 'STOP_HEAL') return this.stopHealing(command.patientCrewId);
    if (typeof command.crewId !== 'string' || command.crewId.trim().length === 0) {
      return failure('INVALID_CREW_ID', '船员命令必须使用非空船员实例 ID');
    }
    const crew = this.crews.get(command.crewId);
    if (crew === undefined) return failure('UNKNOWN_CREW', `未知船员：${command.crewId}`);
    if (command.type === 'SET_PATROL_ENABLED') {
      if (crew.definition.role !== 'SOLDIER' || crew.patrolRoomIds.length === 0) {
        return failure('INVALID_COMMAND', `${crew.definition.displayName}没有可配置的巡逻路线`);
      }
      crew.patrolEnabled = command.enabled;
      if (!command.enabled && crew.state === 'PATROLLING') this.cancelCurrentOrder(crew, false);
      if (command.enabled) crew.patrolBlockedGraphVersion = null;
      return { ok: true, snapshot: this.getSnapshot(), message: command.enabled ? '士兵巡逻已恢复' : '士兵巡逻已暂停' };
    }
    if (command.type === 'CANCEL_CREW_ORDER') return this.cancelCrewOrder(crew);
    if ((crew.state === 'PATROLLING' || crew.state === 'CONSTRUCTING') && command.type !== 'STOP_REPAIR') {
      this.interruptBackgroundTask(crew);
    }
    if (command.type === 'STOP_REPAIR') {
      if (crew.state !== 'REPAIRING') return failure('NOT_REPAIRING', `${crew.definition.displayName}当前没有维修任务`);
      this.finishPlayerOrder(crew);
      return { ok: true, snapshot: this.getSnapshot(), message: `已停止${crew.definition.displayName}的维修任务` };
    }
    if (command.type === 'ISSUE_MOVE_ORDER') return this.issueMoveToNode(crew, command.targetNodeId, { type: 'MOVE', targetNodeId: command.targetNodeId });
    if (typeof command.targetRoomId !== 'string' || command.targetRoomId.trim().length === 0) {
      return failure('INVALID_COMMAND', `${command.type === 'MOVE_CREW' ? '移动' : '维修'}命令必须使用非空目标房间 ID`);
    }
    if (!this.navigation.hasRoom(command.targetRoomId)) return failure('UNKNOWN_ROOM', `未知目标房间：${command.targetRoomId}`);
    if (crew.state !== 'IDLE') return failure('CREW_BUSY', `${crew.definition.displayName}正在执行其他任务`);
    if (command.type === 'ISSUE_REPAIR_ORDER') return this.issueRepairOrder(crew, command.targetRoomId);
    if (command.type === 'START_REPAIR') {
      if (crew.definition.role !== 'ENGINEER' || crew.definition.repairHpPerTick <= 0) {
        return failure('REPAIR_NOT_ALLOWED', `${crew.definition.displayName}不具备维修能力`);
      }
      if (crew.currentRoomId !== command.targetRoomId) {
        return failure('REPAIR_NOT_ALLOWED', `${crew.definition.displayName}必须先到达目标房间`);
      }
      crew.state = 'REPAIRING';
      crew.targetNodeId = crew.currentNodeId;
      crew.targetRoomId = command.targetRoomId;
      crew.targetStationIndex = crew.currentStationIndex;
      crew.activeOrder = { type: 'REPAIR', targetNodeId: crew.currentNodeId, targetRoomId: command.targetRoomId };
      return { ok: true, snapshot: this.getSnapshot(), message: `已命令${crew.definition.displayName}开始维修${command.targetRoomId}` };
    }
    return this.issueMoveToRoom(crew, command.targetRoomId);
  }

  public advanceOneTick(repairRoom?: CrewRepairTickHandler, healCrew?: CrewHealingTickHandler): CrewTickResult {
    let crossedEdge = false;
    const completedRepairRooms = new Set<string>();
    const sorted = Array.from(this.crews.values()).sort((left, right) => left.id.localeCompare(right.id));
    // 所有移动先完成，确保同一 Tick 到达医疗室的船员不会被提前结算治疗。
    for (const crew of sorted) {
      if (crew.state === 'MOVING' || crew.state === 'PATROLLING') {
        crossedEdge = this.advanceMovement(crew) || crossedEdge;
      }
    }
    this.activateArrivedHealingOrders();
    // 医疗必须位于维修之前；按医务员稳定实例 ID 处理配对，渲染帧率不影响结果。
    if (healCrew !== undefined) {
      for (const medic of sorted) {
        if (medic.state !== 'TREATING' || medic.taskPartnerCrewId === null) continue;
        const patient = this.crews.get(medic.taskPartnerCrewId);
        if (patient === undefined || patient.state !== 'HEALING' || patient.taskPartnerCrewId !== medic.id) {
          this.resetHealingPair(medic, patient, true);
          continue;
        }
        const roomId = medic.currentRoomId;
        if (roomId === null) {
          this.resetHealingPair(medic, patient, true);
          continue;
        }
        const amount = healCrew(medic.id, patient.id, roomId);
        if (!Number.isInteger(amount) || amount <= 0) {
          this.resetHealingPair(medic, patient);
          continue;
        }
        patient.hp = Math.min(patient.definition.maxHp, patient.hp + amount);
        if (patient.hp >= patient.definition.maxHp) this.resetHealingPair(medic, patient, true);
      }
    }
    for (const crew of sorted) {
      if (crew.state === 'REPAIRING' && repairRoom !== undefined) {
        const roomId = crew.targetRoomId ?? crew.currentRoomId;
        if (roomId !== null && repairRoom(crew.id, roomId, crew.definition.repairHpPerTick)) completedRepairRooms.add(roomId);
      }
    }
    if (completedRepairRooms.size > 0) {
      for (const crew of this.crews.values()) {
        if (crew.state === 'REPAIRING' && completedRepairRooms.has(crew.targetRoomId ?? '')) this.finishPlayerOrder(crew);
      }
    }
    for (const crew of sorted) this.advanceBackgroundIntent(crew);
    return { snapshot: this.getSnapshot(), crossedEdge };
  }

  /** 由应用层把已分配工程师送往施工区域附近的已完成地板；到达后进入 CONSTRUCTING。 */
  public assignConstructionJob(crewId: string, jobId: string, targetNodeId: string): CrewCommandResult {
    const crew = this.crews.get(crewId);
    if (crew === undefined) return failure('UNKNOWN_CREW', `未知船员：${crewId}`);
    if (crew.definition.role !== 'ENGINEER') return failure('INVALID_COMMAND', `${crew.definition.displayName}不是工程师`);
    const target = this.navigation.getNode(targetNodeId);
    if (target === null || target.kind !== 'FLOOR') return failure('INVALID_COMMAND', '施工工地必须是已完成地板');
    if (crew.state !== 'IDLE' && crew.state !== 'PATROLLING' && crew.state !== 'CONSTRUCTING') return failure('CREW_BUSY', `${crew.definition.displayName}正在执行玩家任务`);
    // 先完成全部只读校验再中断后台任务，保证房间满员失败不会留下半份施工状态。
    if (targetNodeId !== crew.currentNodeId && this.crewsByOtherJob(targetNodeId, crew.id, jobId)) {
      return failure('CREW_BUSY', '施工工地已被其他船员占用或预留');
    }
    const path = targetNodeId === crew.currentNodeId
      ? { ok: true as const, nodeIds: Object.freeze([targetNodeId]) }
      : this.navigation.findPath(crew.currentNodeId, targetNodeId, crew.definition.moveTicksPerEdge);
    if (path.ok === false) return failure('PATH_NOT_FOUND', path.message);
    this.interruptBackgroundTask(crew);
    crew.constructionJobId = jobId;
    crew.constructionWorksiteNodeId = targetNodeId;
    crew.activeOrder = { type: 'CONSTRUCTION', targetNodeId, jobId };
    if (crew.currentNodeId === targetNodeId) {
      crew.state = 'CONSTRUCTING';
      crew.targetNodeId = targetNodeId;
      crew.targetRoomId = null;
      crew.targetStationIndex = null;
      crew.pathNodeIds = [targetNodeId];
      crew.pathIndex = 0;
      crew.ticksIntoEdge = 0;
      return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}已到达工地` };
    }
    this.startPreparedPath(crew, targetNodeId, path.nodeIds, 'MOVING');
    return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}正在前往工地` };
  }

  public releaseConstructionJob(jobId: string): boolean {
    let changed = false;
    for (const crew of this.crews.values()) {
      if (crew.constructionJobId !== jobId) continue;
      crew.constructionJobId = null;
      crew.constructionWorksiteNodeId = null;
      if (crew.activeOrder?.type === 'CONSTRUCTION') crew.activeOrder = null;
      if (crew.state === 'CONSTRUCTING' || (crew.state === 'MOVING' && crew.activeOrder === null)) this.resetToIdle(crew);
      changed = true;
    }
    return changed;
  }

  /** 玩家从单个施工项目撤下工程师时只清除该工程师，不影响同项目其他人员。 */
  public releaseCrewFromConstruction(crewId: string): boolean {
    const crew = this.crews.get(crewId);
    if (crew === undefined || crew.constructionJobId === null) return false;
    crew.constructionJobId = null;
    crew.constructionWorksiteNodeId = null;
    if (crew.activeOrder?.type === 'CONSTRUCTION' || crew.state === 'CONSTRUCTING') this.resetToIdle(crew, true);
    return true;
  }

  /** 医疗室断电时由 ShipModel 立即取消该房间内的全部治疗配对。 */
  public stopHealingInRoom(roomId: string): boolean {
    let changed = false;
    for (const medic of Array.from(this.crews.values()).sort((left, right) => left.id.localeCompare(right.id))) {
      if (medic.state !== 'TREATING' || medic.currentRoomId !== roomId) continue;
      this.resetHealingPair(medic, this.crews.get(medic.taskPartnerCrewId ?? ''), true);
      changed = true;
    }
    return changed;
  }

  public static restore(
    navigation: NavigationGraph,
    initialStates: readonly CrewInitialState[],
    snapshot: unknown,
    identityContext: CrewIdentityContext = { shipId: 'ship-unknown', configVersion: 'default' },
  ): CrewRestoreResult {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== CREW_SNAPSHOT_SCHEMA_VERSION || !Array.isArray(snapshot.crews)) {
      return failure('INVALID_SNAPSHOT', '船员快照版本或船员列表无效');
    }
    let model: CrewModel;
    try {
      model = new CrewModel(navigation, initialStates, identityContext);
    } catch (cause) {
      return failure('INVALID_INITIAL_STATE', describeCause(cause));
    }
    const seen = new Set<string>();
    const occupied = new Set<string>();
    for (const value of snapshot.crews) {
      const validated = validateSnapshotEntry(navigation, model.crews, value);
      if (validated.ok === false) return validated;
      const entry = validated.entry;
      if (seen.has(entry.id)) return failure('INVALID_SNAPSHOT', `船员快照重复实例：${entry.id}`);
      seen.add(entry.id);
      const occupiedNode = reservedNodeId(entry);
      if (occupied.has(occupiedNode)) return failure('INVALID_SNAPSHOT', `船员快照站位冲突：${occupiedNode}`);
      occupied.add(occupiedNode);
      const crew = model.crews.get(entry.id) as MutableCrewState;
      Object.assign(crew, {
        hp: entry.hp,
        state: entry.state,
        currentNodeId: entry.currentNodeId,
        currentRoomId: entry.currentRoomId,
        currentStationIndex: entry.currentStationIndex,
        targetNodeId: entry.targetNodeId,
        targetRoomId: entry.targetRoomId,
        targetStationIndex: entry.targetStationIndex,
        pathNodeIds: [...entry.pathNodeIds],
        pathIndex: entry.pathIndex,
        ticksIntoEdge: entry.ticksIntoEdge,
        taskPartnerCrewId: entry.taskPartnerCrewId,
        patrolRoomIds: [...entry.patrolRoomIds],
        patrolIndex: entry.patrolIndex,
        patrolPauseTicks: entry.patrolPauseTicks,
        patrolBlockedGraphVersion: entry.patrolBlockedGraphVersion,
        patrolEnabled: entry.patrolEnabled,
        constructionJobId: entry.constructionJobId,
        constructionWorksiteNodeId: entry.constructionWorksiteNodeId,
        activeOrder: cloneOrder(entry.activeOrder),
      });
    }
    for (const crew of model.crews.values()) {
      if (seen.has(crew.id)) continue;
      if (occupied.has(crew.currentNodeId)) return failure('INVALID_SNAPSHOT', `新增船员默认站位冲突：${crew.currentNodeId}`);
      occupied.add(crew.currentNodeId);
    }
    const pairing = validateHealingPairs(model.crews);
    if (pairing !== null) return failure('INVALID_SNAPSHOT', pairing);
    return { ok: true, model };
  }

  private findFirstFreeStation(roomId: string, ignoredCrewIds: ReadonlySet<string> = new Set()): number | null {
    const occupied = this.getReservedNodes(ignoredCrewIds);
    for (let index = 0; index < this.navigation.getRoomStationCount(roomId); index += 1) {
      if (!occupied.has(stationNodeId(roomId, index))) return index;
    }
    return null;
  }

  private findFreeStations(roomId: string, count: number, ignoredCrewIds: ReadonlySet<string>): number[] | null {
    const occupied = this.getReservedNodes(ignoredCrewIds);
    const result: number[] = [];
    for (let index = 0; index < this.navigation.getRoomStationCount(roomId) && result.length < count; index += 1) {
      const nodeId = stationNodeId(roomId, index);
      if (!occupied.has(nodeId)) {
        result.push(index);
        occupied.add(nodeId);
      }
    }
    return result.length === count ? result : null;
  }

  private getReservedNodes(ignoredCrewIds: ReadonlySet<string> = new Set()): Set<string> {
    const occupied = new Set<string>();
    for (const crew of this.crews.values()) {
      if (ignoredCrewIds.has(crew.id)) continue;
      occupied.add(crew.targetNodeId ?? crew.currentNodeId);
    }
    return occupied;
  }

  /** 同一施工项目允许最多三名工程师共享一个狭窄工地；其他项目仍必须避让。 */
  private crewsByOtherJob(nodeId: string, ignoredCrewId: string, jobId: string): boolean {
    for (const other of this.crews.values()) {
      if (other.id === ignoredCrewId) continue;
      if ((other.targetNodeId ?? other.currentNodeId) !== nodeId) continue;
      if (other.constructionJobId !== jobId) return true;
    }
    return false;
  }

  private issueMoveToRoom(crew: MutableCrewState, roomId: string): CrewCommandResult {
    if (crew.currentRoomId === roomId && crew.currentStationIndex !== null) {
      return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}已在目标房间` };
    }
    const stationIndex = this.findFirstFreeStation(roomId, new Set([crew.id]));
    if (stationIndex === null) return failure('ROOM_FULL', `目标房间已满：${roomId}`);
    const targetNodeId = stationNodeId(roomId, stationIndex);
    return this.issueMoveToNode(crew, targetNodeId, { type: 'MOVE', targetNodeId });
  }

  private issueMoveToNode(crew: MutableCrewState, targetNodeId: string, order: CrewOrderSnapshot): CrewCommandResult {
    if (crew.state !== 'IDLE') return failure('CREW_BUSY', `${crew.definition.displayName}正在执行其他任务`);
    const target = this.navigation.getNode(targetNodeId);
    if (target === null || (target.kind !== 'FLOOR' && target.kind !== 'STATION')) {
      return failure('INVALID_COMMAND', '移动终点必须是地板或房间站位');
    }
    if (targetNodeId !== crew.currentNodeId && this.getReservedNodes(new Set([crew.id])).has(targetNodeId)) {
      return failure(target.kind === 'STATION' ? 'ROOM_FULL' : 'CREW_BUSY', '目标位置已被其他船员占用或预留');
    }
    if (crew.currentNodeId === targetNodeId) {
      crew.activeOrder = order.type === 'MOVE' ? null : cloneOrder(order);
      crew.targetNodeId = order.type === 'MOVE' ? null : targetNodeId;
      return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}已在目标位置` };
    }
    crew.activeOrder = cloneOrder(order);
    const moved = this.startPath(crew, targetNodeId, 'MOVING');
    return moved.ok === false
      ? moved
      : { ok: true, snapshot: this.getSnapshot(), message: `已命令${crew.definition.displayName}移动到目标位置` };
  }

  private issueRepairOrder(crew: MutableCrewState, roomId: string): CrewCommandResult {
    if (crew.definition.role !== 'ENGINEER' || crew.definition.repairHpPerTick <= 0) {
      return failure('REPAIR_NOT_ALLOWED', `${crew.definition.displayName}不具备维修能力`);
    }
    const stationIndex = crew.currentRoomId === roomId && crew.currentStationIndex !== null
      ? crew.currentStationIndex
      : this.findFirstFreeStation(roomId, new Set([crew.id]));
    if (stationIndex === null) return failure('ROOM_FULL', `目标房间已满：${roomId}`);
    const targetNodeId = stationNodeId(roomId, stationIndex);
    const order: CrewOrderSnapshot = { type: 'REPAIR', targetNodeId, targetRoomId: roomId };
    if (crew.currentNodeId === targetNodeId) {
      crew.state = 'REPAIRING';
      crew.targetNodeId = targetNodeId;
      crew.targetRoomId = roomId;
      crew.targetStationIndex = stationIndex;
      crew.activeOrder = order;
      return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}已开始维修${roomId}` };
    }
    crew.activeOrder = order;
    const moved = this.startPath(crew, targetNodeId, 'MOVING');
    return moved.ok === false
      ? moved
      : { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}正在前往维修目标` };
  }

  private issueHealingOrder(command: Extract<CrewCommand, { readonly type: 'ISSUE_HEAL_ORDER' }>): CrewCommandResult {
    if (typeof command.patientCrewId !== 'string' || typeof command.medicCrewId !== 'string' || typeof command.targetRoomId !== 'string'
      || command.patientCrewId.trim() === '' || command.medicCrewId.trim() === '' || command.targetRoomId.trim() === '') {
      return failure('INVALID_COMMAND', '治疗订单必须提供病员、医务员和医疗室实例 ID');
    }
    if (command.patientCrewId === command.medicCrewId) return failure('HEAL_NOT_ALLOWED', '医务员和病员不能是同一船员');
    const patient = this.crews.get(command.patientCrewId);
    const medic = this.crews.get(command.medicCrewId);
    if (patient === undefined || medic === undefined) return failure('UNKNOWN_CREW', '治疗订单包含未知船员');
    if (!this.navigation.hasRoom(command.targetRoomId)) return failure('UNKNOWN_ROOM', `未知医疗室：${command.targetRoomId}`);
    if (medic.definition.role !== 'MEDIC') return failure('HEAL_NOT_ALLOWED', `${medic.definition.displayName}不是医务员`);
    if (patient.hp >= patient.definition.maxHp) return failure('HEAL_NOT_ALLOWED', `${patient.definition.displayName}生命已满`);
    if (![patient.state, medic.state].every((state) => state === 'IDLE' || state === 'PATROLLING' || state === 'CONSTRUCTING')) {
      return failure('CREW_BUSY', '病员或医务员正在执行玩家任务');
    }
    const stations = this.findFreeStations(command.targetRoomId, 2, new Set([patient.id, medic.id]));
    if (stations === null) return failure('ROOM_FULL', '医疗室没有两个可用站位');
    const patientNodeId = patient.currentRoomId === command.targetRoomId && patient.currentStationIndex !== null
      ? patient.currentNodeId
      : stationNodeId(command.targetRoomId, stations[0]);
    const medicNodeId = medic.currentRoomId === command.targetRoomId && medic.currentStationIndex !== null && medic.currentNodeId !== patientNodeId
      ? medic.currentNodeId
      : stationNodeId(command.targetRoomId, patientNodeId === stationNodeId(command.targetRoomId, stations[0]) ? stations[1] : stations[0]);
    const patientPath = this.navigation.findPath(patient.currentNodeId, patientNodeId, patient.definition.moveTicksPerEdge);
    const medicPath = this.navigation.findPath(medic.currentNodeId, medicNodeId, medic.definition.moveTicksPerEdge);
    if (patientPath.ok === false || medicPath.ok === false) return failure('PATH_NOT_FOUND', '病员或医务员无法到达医疗室');
    this.interruptBackgroundTask(patient);
    this.interruptBackgroundTask(medic);
    patient.activeOrder = { type: 'HEAL', targetNodeId: patientNodeId, targetRoomId: command.targetRoomId, partnerCrewId: medic.id, participant: 'PATIENT' };
    medic.activeOrder = { type: 'HEAL', targetNodeId: medicNodeId, targetRoomId: command.targetRoomId, partnerCrewId: patient.id, participant: 'MEDIC' };
    patient.taskPartnerCrewId = medic.id;
    medic.taskPartnerCrewId = patient.id;
    this.startPreparedPath(patient, patientNodeId, patientPath.nodeIds, 'MOVING');
    this.startPreparedPath(medic, medicNodeId, medicPath.nodeIds, 'MOVING');
    this.activateArrivedHealingOrders();
    return { ok: true, snapshot: this.getSnapshot(), message: `${patient.definition.displayName}和${medic.definition.displayName}正在前往医疗室` };
  }

  private startPath(crew: MutableCrewState, targetNodeId: string, state: 'MOVING' | 'PATROLLING'): CrewCommandResult {
    const path = this.navigation.findPath(crew.currentNodeId, targetNodeId, crew.definition.moveTicksPerEdge);
    if (path.ok === false) return failure('PATH_NOT_FOUND', path.message);
    this.startPreparedPath(crew, targetNodeId, path.nodeIds, state);
    return { ok: true, snapshot: this.getSnapshot(), message: '移动路径已建立' };
  }

  private startPreparedPath(
    crew: MutableCrewState,
    targetNodeId: string,
    nodeIds: readonly string[],
    state: 'MOVING' | 'PATROLLING',
  ): void {
    const target = this.navigation.getNode(targetNodeId) as Readonly<NavigationNode>;
    crew.state = state;
    crew.targetNodeId = targetNodeId;
    crew.targetRoomId = target.roomId;
    crew.targetStationIndex = target.kind === 'STATION' ? target.stationIndex ?? null : null;
    crew.pathNodeIds = [...nodeIds];
    crew.pathIndex = 0;
    crew.ticksIntoEdge = 0;
  }

  private advanceMovement(crew: MutableCrewState): boolean {
    if (crew.pathIndex >= crew.pathNodeIds.length - 1) {
      this.completeMovement(crew);
      return false;
    }
    const fromNodeId = crew.pathNodeIds[crew.pathIndex];
    const toNodeId = crew.pathNodeIds[crew.pathIndex + 1];
    const travelTicks = this.navigation.getEdgeTravelTicks(fromNodeId, toNodeId, crew.definition.moveTicksPerEdge);
    if (travelTicks <= 0) {
      this.cancelCurrentOrder(crew, true);
      return false;
    }
    crew.ticksIntoEdge += 1;
    if (crew.ticksIntoEdge < travelTicks) return false;
    crew.ticksIntoEdge = 0;
    crew.pathIndex += 1;
    crew.currentNodeId = toNodeId;
    this.updateLocationFromNode(crew, toNodeId);
    if (crew.pathIndex >= crew.pathNodeIds.length - 1) this.completeMovement(crew);
    return true;
  }

  private completeMovement(crew: MutableCrewState): void {
    if (crew.state === 'PATROLLING') {
      this.resetToIdle(crew, true);
      if (crew.patrolRoomIds.length > 0) crew.patrolIndex = (crew.patrolIndex + 1) % crew.patrolRoomIds.length;
      return;
    }
    const order = crew.activeOrder;
    if (order?.type === 'REPAIR') {
      crew.state = 'REPAIRING';
      this.setStationaryTaskPath(crew, order.targetNodeId);
      return;
    }
    if (order?.type === 'CONSTRUCTION') {
      crew.state = 'CONSTRUCTING';
      this.setStationaryTaskPath(crew, order.targetNodeId);
      return;
    }
    if (order?.type === 'HEAL') {
      this.setStationaryTaskPath(crew, order.targetNodeId);
      crew.state = 'MOVING';
      return;
    }
    this.finishPlayerOrder(crew);
  }

  private setStationaryTaskPath(crew: MutableCrewState, nodeId: string): void {
    crew.currentNodeId = nodeId;
    this.updateLocationFromNode(crew, nodeId);
    crew.targetNodeId = nodeId;
    crew.pathNodeIds = [nodeId];
    crew.pathIndex = 0;
    crew.ticksIntoEdge = 0;
  }

  private updateLocationFromNode(crew: MutableCrewState, nodeId: string): void {
    const node = this.navigation.getNode(nodeId);
    crew.currentRoomId = node?.roomId ?? null;
    crew.currentStationIndex = node?.kind === 'STATION' ? node.stationIndex ?? null : null;
  }

  private cancelCrewOrder(crew: MutableCrewState): CrewCommandResult {
    if (crew.state === 'HEALING' || crew.state === 'TREATING' || crew.activeOrder?.type === 'HEAL') {
      const healingOrder = crew.activeOrder?.type === 'HEAL' ? crew.activeOrder : null;
      const partner = this.crews.get(crew.taskPartnerCrewId ?? healingOrder?.partnerCrewId ?? '');
      this.resetHealingPair(healingOrder?.participant === 'MEDIC' || crew.state === 'TREATING' ? crew : partner, healingOrder?.participant === 'PATIENT' || crew.state === 'HEALING' ? crew : partner, true);
      return { ok: true, snapshot: this.getSnapshot(), message: '治疗任务已停止' };
    }
    if (crew.state === 'IDLE' && crew.activeOrder === null) return failure('INVALID_COMMAND', `${crew.definition.displayName}没有可停止的任务`);
    this.cancelCurrentOrder(crew, true);
    return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}的当前任务已停止` };
  }

  private cancelCurrentOrder(crew: MutableCrewState, resumeBackground: boolean): void {
    crew.state = 'IDLE';
    crew.targetNodeId = null;
    crew.targetRoomId = null;
    crew.targetStationIndex = null;
    crew.pathNodeIds = [crew.currentNodeId];
    crew.pathIndex = 0;
    crew.ticksIntoEdge = 0;
    crew.taskPartnerCrewId = null;
    crew.activeOrder = null;
    if (resumeBackground && (crew.patrolEnabled || crew.constructionJobId !== null)) crew.patrolPauseTicks = 10;
  }

  private resetToIdle(crew: MutableCrewState, resumeBackground = false): void {
    this.cancelCurrentOrder(crew, resumeBackground);
  }

  private finishPlayerOrder(crew: MutableCrewState): void {
    this.resetToIdle(crew, true);
  }

  private interruptBackgroundTask(crew: MutableCrewState): void {
    crew.activeOrder = null;
    this.cancelCurrentOrder(crew, true);
  }

  private advanceBackgroundIntent(crew: MutableCrewState): void {
    if (crew.state !== 'IDLE' || crew.activeOrder !== null) return;
    if (crew.patrolPauseTicks > 0) {
      crew.patrolPauseTicks -= 1;
      return;
    }
    if (crew.constructionJobId !== null && crew.constructionWorksiteNodeId !== null) {
      const order: CrewOrderSnapshot = { type: 'CONSTRUCTION', targetNodeId: crew.constructionWorksiteNodeId, jobId: crew.constructionJobId };
      crew.activeOrder = order;
      if (crew.currentNodeId === order.targetNodeId) {
        crew.state = 'CONSTRUCTING';
        crew.targetNodeId = order.targetNodeId;
      } else if (this.startPath(crew, order.targetNodeId, 'MOVING').ok === false) {
        crew.activeOrder = null;
      }
      return;
    }
    this.advancePatrolIntent(crew);
  }

  private advancePatrolIntent(crew: MutableCrewState): void {
    if (crew.state !== 'IDLE' || !crew.patrolEnabled || crew.definition.role !== 'SOLDIER' || crew.patrolRoomIds.length === 0) return;
    if (crew.patrolBlockedGraphVersion === this.navigation.version) return;
    const targetRoomId = crew.patrolRoomIds[crew.patrolIndex % crew.patrolRoomIds.length];
    if (targetRoomId === crew.currentRoomId) {
      crew.patrolIndex = (crew.patrolIndex + 1) % crew.patrolRoomIds.length;
      crew.patrolPauseTicks = 10;
      return;
    }
    const stationIndex = this.findFirstFreeStation(targetRoomId, new Set([crew.id]));
    if (stationIndex === null) {
      crew.patrolBlockedGraphVersion = this.navigation.version;
      return;
    }
    const targetNodeId = stationNodeId(targetRoomId, stationIndex);
    const path = this.navigation.findPath(crew.currentNodeId, targetNodeId, crew.definition.moveTicksPerEdge);
    if (path.ok === false) {
      crew.patrolBlockedGraphVersion = this.navigation.version;
      return;
    }
    crew.patrolBlockedGraphVersion = null;
    this.startPreparedPath(crew, targetNodeId, path.nodeIds, 'PATROLLING');
  }

  private startHealing(command: Extract<CrewCommand, { readonly type: 'START_HEAL' }>): CrewCommandResult {
    if (typeof command.patientCrewId !== 'string' || typeof command.medicCrewId !== 'string' || typeof command.targetRoomId !== 'string' ||
      command.patientCrewId.trim() === '' || command.medicCrewId.trim() === '' || command.targetRoomId.trim() === '') {
      return failure('INVALID_COMMAND', '治疗命令必须提供病员、医务员和医疗室实例 ID');
    }
    if (command.patientCrewId === command.medicCrewId) return failure('HEAL_NOT_ALLOWED', '医务员和病员不能是同一船员');
    const patient = this.crews.get(command.patientCrewId);
    const medic = this.crews.get(command.medicCrewId);
    if (patient === undefined) return failure('UNKNOWN_CREW', `未知病员：${command.patientCrewId}`);
    if (medic === undefined) return failure('UNKNOWN_CREW', `未知医务员：${command.medicCrewId}`);
    if (!this.navigation.hasRoom(command.targetRoomId)) return failure('UNKNOWN_ROOM', `未知医疗室：${command.targetRoomId}`);
    if (patient.state !== 'IDLE' || medic.state !== 'IDLE') return failure('CREW_BUSY', '病员或医务员正在执行其他任务');
    if (medic.definition.role !== 'MEDIC') return failure('HEAL_NOT_ALLOWED', `${medic.definition.displayName}不是医务员`);
    if (patient.hp >= patient.definition.maxHp) return failure('HEAL_NOT_ALLOWED', `${patient.definition.displayName}生命已满`);
    if (patient.currentRoomId !== command.targetRoomId || medic.currentRoomId !== command.targetRoomId) {
      return failure('HEAL_NOT_ALLOWED', '病员和医务员必须位于同一医疗室');
    }
    patient.state = 'HEALING';
    patient.targetNodeId = patient.currentNodeId;
    patient.targetRoomId = command.targetRoomId;
    patient.targetStationIndex = patient.currentStationIndex;
    patient.taskPartnerCrewId = medic.id;
    patient.activeOrder = { type: 'HEAL', targetNodeId: patient.currentNodeId, targetRoomId: command.targetRoomId, partnerCrewId: medic.id, participant: 'PATIENT' };
    medic.state = 'TREATING';
    medic.targetNodeId = medic.currentNodeId;
    medic.targetRoomId = command.targetRoomId;
    medic.targetStationIndex = medic.currentStationIndex;
    medic.taskPartnerCrewId = patient.id;
    medic.activeOrder = { type: 'HEAL', targetNodeId: medic.currentNodeId, targetRoomId: command.targetRoomId, partnerCrewId: patient.id, participant: 'MEDIC' };
    return { ok: true, snapshot: this.getSnapshot(), message: `已命令${medic.definition.displayName}开始治疗${patient.definition.displayName}` };
  }

  private stopHealing(patientCrewId: string): CrewCommandResult {
    if (typeof patientCrewId !== 'string' || patientCrewId.trim() === '') return failure('INVALID_CREW_ID', '停止治疗必须使用非空病员实例 ID');
    const patient = this.crews.get(patientCrewId);
    if (patient === undefined) return failure('UNKNOWN_CREW', `未知病员：${patientCrewId}`);
    if (patient.state !== 'HEALING' || patient.taskPartnerCrewId === null) return failure('NOT_HEALING', `${patient.definition.displayName}当前没有治疗任务`);
    const medic = this.crews.get(patient.taskPartnerCrewId);
    this.resetHealingPair(medic, patient, true);
    return { ok: true, snapshot: this.getSnapshot(), message: `已停止${patient.definition.displayName}的治疗任务` };
  }

  private activateArrivedHealingOrders(): void {
    for (const patient of Array.from(this.crews.values()).sort((left, right) => left.id.localeCompare(right.id))) {
      const order = patient.activeOrder;
      if (order?.type !== 'HEAL' || order.participant !== 'PATIENT' || patient.currentNodeId !== order.targetNodeId) continue;
      const medic = this.crews.get(order.partnerCrewId);
      const medicOrder = medic?.activeOrder;
      if (medic === undefined || medicOrder?.type !== 'HEAL' || medicOrder.participant !== 'MEDIC'
        || medicOrder.partnerCrewId !== patient.id || medic.currentNodeId !== medicOrder.targetNodeId) continue;
      patient.state = 'HEALING';
      medic.state = 'TREATING';
      patient.taskPartnerCrewId = medic.id;
      medic.taskPartnerCrewId = patient.id;
    }
  }

  private resetHealingPair(
    medic: MutableCrewState | undefined,
    patient: MutableCrewState | undefined,
    resumeBackground = false,
  ): void {
    if (medic !== undefined) this.resetToIdle(medic, resumeBackground);
    if (patient !== undefined) this.resetToIdle(patient, resumeBackground);
  }
}

function snapshotEntry(crew: MutableCrewState): CrewSnapshotEntry {
  return {
    id: crew.id,
    definitionId: crew.definition.id,
    nameMode: crew.identity.nameMode,
    callSign: crew.identity.callSign,
    hp: crew.hp,
    state: crew.state,
    currentNodeId: crew.currentNodeId,
    currentRoomId: crew.currentRoomId,
    currentStationIndex: crew.currentStationIndex,
    targetNodeId: crew.targetNodeId,
    targetRoomId: crew.targetRoomId,
    targetStationIndex: crew.targetStationIndex,
    pathNodeIds: Object.freeze([...crew.pathNodeIds]),
    pathIndex: crew.pathIndex,
    ticksIntoEdge: crew.ticksIntoEdge,
    taskPartnerCrewId: crew.taskPartnerCrewId,
    patrolRoomIds: Object.freeze([...crew.patrolRoomIds]),
    patrolIndex: crew.patrolIndex,
    patrolPauseTicks: crew.patrolPauseTicks,
    patrolBlockedGraphVersion: crew.patrolBlockedGraphVersion,
    patrolEnabled: crew.patrolEnabled,
    constructionJobId: crew.constructionJobId,
    constructionWorksiteNodeId: crew.constructionWorksiteNodeId,
    activeOrder: cloneOrder(crew.activeOrder),
  };
}

function validateSnapshotEntry(
  navigation: NavigationGraph,
  crews: ReadonlyMap<string, MutableCrewState>,
  value: unknown,
): { readonly ok: true; readonly entry: CrewSnapshotEntry } | { readonly ok: false; readonly code: CrewErrorCode; readonly message: string } {
  if (!isRecord(value) || typeof value.id !== 'string') return failure('INVALID_SNAPSHOT', '船员快照包含非法实例');
  const crew = crews.get(value.id);
  if (crew === undefined) return failure('INVALID_SNAPSHOT', `船员快照包含未知实例：${value.id}`);
  if (value.definitionId !== crew.definition.id) return failure('INVALID_SNAPSHOT', `船员定义不匹配：${value.id}`);
  if (value.nameMode !== crew.identity.nameMode || value.callSign !== crew.identity.callSign) {
    return failure('INVALID_SNAPSHOT', `船员代号不匹配：${value.id}`);
  }
  if (typeof value.callSign !== 'string' || value.callSign.trim().length === 0) {
    return failure('INVALID_SNAPSHOT', `船员代号无效：${value.id}`);
  }
  if (!Number.isInteger(value.hp) || (value.hp as number) < 0 || (value.hp as number) > crew.definition.maxHp) {
    return failure('INVALID_SNAPSHOT', `船员生命值无效：${value.id}`);
  }
  if (['IDLE', 'MOVING', 'REPAIRING', 'HEALING', 'TREATING', 'PATROLLING', 'CONSTRUCTING'].indexOf(String(value.state)) === -1) {
    return failure('INVALID_SNAPSHOT', `船员状态无效：${value.id}`);
  }
  if (!Array.isArray(value.patrolRoomIds) || !value.patrolRoomIds.every((roomId) => typeof roomId === 'string' && navigation.hasRoom(roomId)) ||
    !Number.isInteger(value.patrolIndex) || !Number.isInteger(value.patrolPauseTicks) || (value.patrolPauseTicks as number) < 0 ||
    (value.patrolBlockedGraphVersion !== null && typeof value.patrolBlockedGraphVersion !== 'string') ||
    typeof value.patrolEnabled !== 'boolean' ||
    (value.constructionJobId !== null && typeof value.constructionJobId !== 'string') ||
    (value.constructionWorksiteNodeId !== null && typeof value.constructionWorksiteNodeId !== 'string')) {
    return failure('INVALID_SNAPSHOT', `船员后台行为快照无效：${value.id}`);
  }
  if ((value.constructionJobId === null) !== (value.constructionWorksiteNodeId === null)) {
    return failure('INVALID_SNAPSHOT', `船员施工分配不完整：${value.id}`);
  }
  if (typeof value.constructionWorksiteNodeId === 'string') {
    const worksite = navigation.getNode(value.constructionWorksiteNodeId);
    if (worksite === null || worksite.kind !== 'FLOOR') return failure('INVALID_SNAPSHOT', `船员工地节点无效：${value.id}`);
  }
  if (crew.definition.role !== 'SOLDIER' && value.patrolEnabled === true) {
    return failure('INVALID_SNAPSHOT', `非士兵不能启用巡逻：${value.id}`);
  }
  if (value.taskPartnerCrewId !== null && typeof value.taskPartnerCrewId !== 'string') return failure('INVALID_SNAPSHOT', `船员任务伙伴无效：${value.id}`);
  if (typeof value.currentNodeId !== 'string') return failure('INVALID_SNAPSHOT', `船员当前节点无效：${value.id}`);
  const currentNode = navigation.getNode(value.currentNodeId);
  if (currentNode === null || value.currentRoomId !== currentNode.roomId ||
    value.currentStationIndex !== (currentNode.kind === 'STATION' ? currentNode.stationIndex ?? null : null)) {
    return failure('INVALID_SNAPSHOT', `船员当前位置与导航节点不一致：${value.id}`);
  }
  if (value.targetNodeId !== null && (typeof value.targetNodeId !== 'string' || navigation.getNode(value.targetNodeId) === null)) {
    return failure('INVALID_SNAPSHOT', `船员目标节点无效：${value.id}`);
  }
  const targetNode = typeof value.targetNodeId === 'string' ? navigation.getNode(value.targetNodeId) : null;
  if (targetNode !== null && targetNode.kind !== 'FLOOR' && targetNode.kind !== 'STATION') {
    return failure('INVALID_SNAPSHOT', `连接器停靠口不能作为船员最终位置：${value.id}`);
  }
  if (targetNode !== null && (value.targetRoomId !== targetNode.roomId ||
    value.targetStationIndex !== (targetNode.kind === 'STATION' ? targetNode.stationIndex ?? null : null))) {
    return failure('INVALID_SNAPSHOT', `船员目标位置与导航节点不一致：${value.id}`);
  }
  if (!validateOrder(value.activeOrder, navigation, value.id)) return failure('INVALID_SNAPSHOT', `船员任务订单无效：${value.id}`);
  const pathNodeIds = value.pathNodeIds;
  if (!Array.isArray(pathNodeIds) || pathNodeIds.length === 0 || !pathNodeIds.every((node) => typeof node === 'string' && navigation.getNode(node) !== null)) {
    return failure('INVALID_SNAPSHOT', `船员路径无效：${value.id}`);
  }
  if (!Number.isInteger(value.pathIndex) || (value.pathIndex as number) < 0 || (value.pathIndex as number) >= pathNodeIds.length) {
    return failure('INVALID_SNAPSHOT', `船员路径进度无效：${value.id}`);
  }
  for (let index = 1; index < pathNodeIds.length; index += 1) {
    if (!navigation.areConnected(pathNodeIds[index - 1], pathNodeIds[index])) {
      return failure('INVALID_SNAPSHOT', `船员路径包含断开的导航边：${value.id}`);
    }
  }
  if (pathNodeIds[value.pathIndex as number] !== value.currentNodeId) {
    return failure('INVALID_SNAPSHOT', `船员当前节点与路径进度不一致：${value.id}`);
  }
  const nextNodeId = (value.pathIndex as number) + 1 < pathNodeIds.length ? pathNodeIds[(value.pathIndex as number) + 1] : null;
  const edgeTicks = nextNodeId === null ? 1 : navigation.getEdgeTravelTicks(value.currentNodeId, nextNodeId, crew.definition.moveTicksPerEdge);
  if (!Number.isInteger(value.ticksIntoEdge) || (value.ticksIntoEdge as number) < 0 || (value.ticksIntoEdge as number) >= edgeTicks) {
    return failure('INVALID_SNAPSHOT', `船员 Tick 进度无效：${value.id}`);
  }
  if (value.state === 'IDLE') {
    if (value.targetNodeId !== null || value.targetRoomId !== null || value.targetStationIndex !== null || value.taskPartnerCrewId !== null ||
      value.activeOrder !== null || pathNodeIds.length !== 1 || value.pathIndex !== 0 || value.ticksIntoEdge !== 0) {
      return failure('INVALID_SNAPSHOT', `空闲船员快照包含移动状态：${value.id}`);
    }
  } else if (value.state === 'MOVING' || value.state === 'PATROLLING') {
    if (typeof value.targetNodeId !== 'string' || pathNodeIds[pathNodeIds.length - 1] !== value.targetNodeId) {
      return failure('INVALID_SNAPSHOT', `移动船员路径终点无效：${value.id}`);
    }
    if (value.state === 'PATROLLING') {
      if (crew.definition.role !== 'SOLDIER' || value.activeOrder !== null || value.taskPartnerCrewId !== null || value.patrolEnabled !== true) {
        return failure('INVALID_SNAPSHOT', `巡逻船员状态无效：${value.id}`);
      }
    } else if ((value.pathIndex as number) >= pathNodeIds.length - 1 && (!isRecord(value.activeOrder) || value.activeOrder.type !== 'HEAL')) {
      return failure('INVALID_SNAPSHOT', `移动船员已经位于路径终点：${value.id}`);
    }
  } else if (value.state === 'CONSTRUCTING') {
    if (crew.definition.role !== 'ENGINEER' || typeof value.constructionJobId !== 'string' ||
      !isRecord(value.activeOrder) || value.activeOrder.type !== 'CONSTRUCTION' || value.currentNodeId !== value.targetNodeId) {
      return failure('INVALID_SNAPSHOT', `施工船员状态无效：${value.id}`);
    }
  } else if (value.state === 'REPAIRING') {
    if (crew.definition.role !== 'ENGINEER' || crew.definition.repairHpPerTick <= 0) {
      return failure('INVALID_SNAPSHOT', `维修船员不具备维修能力：${value.id}`);
    }
    if (value.taskPartnerCrewId !== null || currentNode.kind !== 'STATION' || value.targetRoomId !== currentNode.roomId ||
      value.targetNodeId !== value.currentNodeId || !isRecord(value.activeOrder) || value.activeOrder.type !== 'REPAIR') {
      return failure('INVALID_SNAPSHOT', `维修船员房间或站位无效：${value.id}`);
    }
    if (pathNodeIds.length !== 1 || pathNodeIds[0] !== value.currentNodeId || value.pathIndex !== 0 || value.ticksIntoEdge !== 0) {
      return failure('INVALID_SNAPSHOT', `维修船员路径状态无效：${value.id}`);
    }
  } else {
    if (currentNode.kind !== 'STATION' || value.targetNodeId !== value.currentNodeId || value.targetRoomId !== currentNode.roomId ||
      typeof value.taskPartnerCrewId !== 'string' || value.taskPartnerCrewId === value.id ||
      !isRecord(value.activeOrder) || value.activeOrder.type !== 'HEAL') {
      return failure('INVALID_SNAPSHOT', `医疗船员房间、站位或配对无效：${value.id}`);
    }
    if (value.state === 'TREATING' && crew.definition.role !== 'MEDIC') return failure('INVALID_SNAPSHOT', `诊疗船员不是医务员：${value.id}`);
    if (pathNodeIds.length !== 1 || pathNodeIds[0] !== value.currentNodeId || value.pathIndex !== 0 || value.ticksIntoEdge !== 0) {
      return failure('INVALID_SNAPSHOT', `医疗船员路径状态无效：${value.id}`);
    }
  }
  return { ok: true, entry: value as unknown as CrewSnapshotEntry };
}

function validateHealingPairs(crews: ReadonlyMap<string, MutableCrewState>): string | null {
  for (const crew of crews.values()) {
    if (crew.state !== 'HEALING' && crew.state !== 'TREATING' && crew.activeOrder?.type !== 'HEAL') continue;
    const partner = crews.get(crew.taskPartnerCrewId ?? '');
    const order = crew.activeOrder;
    const partnerOrder = partner?.activeOrder;
    if (partner === undefined || order?.type !== 'HEAL' || partnerOrder?.type !== 'HEAL' ||
      order.partnerCrewId !== partner.id || partnerOrder.partnerCrewId !== crew.id || partner.taskPartnerCrewId !== crew.id ||
      order.targetRoomId !== partnerOrder.targetRoomId) {
      return `医疗配对不完整或不在同一房间：${crew.id}`;
    }
    if (crew.state === 'HEALING' || crew.state === 'TREATING') {
      const expected = crew.state === 'HEALING' ? 'TREATING' : 'HEALING';
      if (partner.state !== expected || partner.currentRoomId !== crew.currentRoomId) return `医疗配对不完整或不在同一房间：${crew.id}`;
    }
  }
  return null;
}

function reservedNodeId(entry: CrewSnapshotEntry): string {
  return entry.targetNodeId ?? entry.currentNodeId;
}

function cloneOrder(order: CrewOrderSnapshot | null): CrewOrderSnapshot | null {
  return order === null ? null : Object.freeze({ ...order });
}

function validateOrder(order: unknown, navigation: NavigationGraph, crewId: string): boolean {
  if (order === null) return true;
  if (!isRecord(order) || typeof order.type !== 'string' || typeof order.targetNodeId !== 'string') return false;
  const node = navigation.getNode(order.targetNodeId);
  if (node === null || (node.kind !== 'FLOOR' && node.kind !== 'STATION')) return false;
  if (order.type === 'MOVE') return true;
  if (order.type === 'REPAIR') return typeof order.targetRoomId === 'string' && node.roomId === order.targetRoomId;
  if (order.type === 'CONSTRUCTION') return typeof order.jobId === 'string' && order.jobId.trim() !== '';
  if (order.type === 'HEAL') {
    return typeof order.targetRoomId === 'string' && node.roomId === order.targetRoomId &&
      typeof order.partnerCrewId === 'string' && order.partnerCrewId !== crewId &&
      (order.participant === 'PATIENT' || order.participant === 'MEDIC');
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(code: CrewErrorCode, message: string): { readonly ok: false; readonly code: CrewErrorCode; readonly message: string } {
  return { ok: false, code, message };
}
