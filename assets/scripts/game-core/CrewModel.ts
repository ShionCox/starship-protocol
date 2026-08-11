import type { CrewDefinition, CrewRole } from './CrewDefinition.ts';
import { NavigationGraph, stationNodeId } from './NavigationGraph.ts';

export const CREW_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type CrewState = 'IDLE' | 'MOVING';

export interface CrewInitialState {
  readonly id: string;
  readonly definition: Readonly<CrewDefinition>;
  readonly roomId: string;
  readonly stationIndex: number;
}

export interface CrewSnapshotEntry {
  readonly id: string;
  readonly definitionId: string;
  readonly hp: number;
  readonly state: CrewState;
  readonly currentRoomId: string;
  readonly currentStationIndex: number | null;
  readonly targetRoomId: string | null;
  readonly targetStationIndex: number | null;
  readonly pathNodeIds: readonly string[];
  readonly pathIndex: number;
  readonly ticksIntoEdge: number;
}

export interface CrewSnapshot {
  readonly schemaVersion: typeof CREW_SNAPSHOT_SCHEMA_VERSION;
  readonly crews: readonly CrewSnapshotEntry[];
}

export interface CrewReadState extends CrewSnapshotEntry {
  readonly displayName: string;
  readonly role: CrewRole;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
  readonly currentNodeId: string;
  readonly nextNodeId: string | null;
  readonly edgeProgress: number;
}

export type CrewCommand = {
  readonly type: 'MOVE_CREW';
  readonly crewId: string;
  readonly targetRoomId: string;
};

export type CrewErrorCode =
  | 'INVALID_CREW_ID'
  | 'DUPLICATE_CREW_ID'
  | 'UNKNOWN_CREW'
  | 'UNKNOWN_ROOM'
  | 'ROOM_FULL'
  | 'PATH_NOT_FOUND'
  | 'CREW_BUSY'
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
  hp: number;
  state: CrewState;
  currentRoomId: string;
  currentStationIndex: number | null;
  targetRoomId: string | null;
  targetStationIndex: number | null;
  pathNodeIds: string[];
  pathIndex: number;
  ticksIntoEdge: number;
}

/** 船员站位与移动的最小确定性模型；所有状态只通过 Command 或固定 Tick 修改。 */
export class CrewModel {
  private readonly crews = new Map<string, MutableCrewState>();
  private readonly navigation: NavigationGraph;

  public constructor(
    navigation: NavigationGraph,
    initialStates: readonly CrewInitialState[],
  ) {
    this.navigation = navigation;
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
      this.crews.set(initial.id, {
        id: initial.id,
        definition: initial.definition,
        hp: initial.definition.maxHp,
        state: 'IDLE',
        currentRoomId: initial.roomId,
        currentStationIndex: initial.stationIndex,
        targetRoomId: null,
        targetStationIndex: null,
        pathNodeIds: [stationId],
        pathIndex: 0,
        ticksIntoEdge: 0,
      });
    }
  }

  public getReadStates(): readonly CrewReadState[] {
    return Array.from(this.crews.values())
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((crew) => {
        const currentNodeId = crew.pathNodeIds[crew.pathIndex] ?? stationNodeId(crew.currentRoomId, crew.currentStationIndex ?? 0);
        const nextNodeId = crew.state === 'MOVING' ? crew.pathNodeIds[crew.pathIndex + 1] ?? null : null;
        return Object.freeze({
          ...snapshotEntry(crew),
          displayName: crew.definition.displayName,
          role: crew.definition.role,
          maxHp: crew.definition.maxHp,
          moveTicksPerEdge: crew.definition.moveTicksPerEdge,
          currentNodeId,
          nextNodeId,
          edgeProgress: crew.state === 'MOVING' ? crew.ticksIntoEdge / crew.definition.moveTicksPerEdge : 0,
        });
      });
  }

  public getSnapshot(): CrewSnapshot {
    const crews = Array.from(this.crews.values())
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((crew) => Object.freeze(snapshotEntry(crew)));
    return { schemaVersion: CREW_SNAPSHOT_SCHEMA_VERSION, crews: Object.freeze(crews) };
  }

  public isAnyCrewMoving(): boolean {
    return Array.from(this.crews.values()).some((crew) => crew.state === 'MOVING');
  }

  public apply(command: CrewCommand): CrewCommandResult {
    if (!isRecord(command) || command.type !== 'MOVE_CREW') {
      return failure('INVALID_COMMAND', '船员 Command 类型无效');
    }
    if (typeof command.crewId !== 'string' || command.crewId.trim().length === 0) {
      return failure('INVALID_CREW_ID', '移动命令必须使用非空船员实例 ID');
    }
    if (typeof command.targetRoomId !== 'string' || command.targetRoomId.trim().length === 0) {
      return failure('INVALID_COMMAND', '移动命令必须使用非空目标房间 ID');
    }
    const crew = this.crews.get(command.crewId);
    if (crew === undefined) return failure('UNKNOWN_CREW', `未知船员：${command.crewId}`);
    if (!this.navigation.hasRoom(command.targetRoomId)) return failure('UNKNOWN_ROOM', `未知目标房间：${command.targetRoomId}`);
    if (crew.state === 'MOVING') return failure('CREW_BUSY', `${crew.definition.displayName}正在移动中`);
    if (crew.currentRoomId === command.targetRoomId) {
      return { ok: true, snapshot: this.getSnapshot(), message: `${crew.definition.displayName}已在目标房间` };
    }

    const stationIndex = this.findFirstFreeStation(command.targetRoomId);
    if (stationIndex === null) return failure('ROOM_FULL', `目标房间已满：${command.targetRoomId}`);
    const fromStation = stationNodeId(crew.currentRoomId, crew.currentStationIndex ?? -1);
    const toStation = stationNodeId(command.targetRoomId, stationIndex);
    const path = this.navigation.findPath(fromStation, toStation);
    if (path.ok === false) return failure('PATH_NOT_FOUND', `无法到达目标房间：${command.targetRoomId}`);

    crew.state = 'MOVING';
    crew.currentStationIndex = null;
    crew.targetRoomId = command.targetRoomId;
    crew.targetStationIndex = stationIndex;
    crew.pathNodeIds = [...path.nodeIds];
    crew.pathIndex = 0;
    crew.ticksIntoEdge = 0;
    return { ok: true, snapshot: this.getSnapshot(), message: `已命令${crew.definition.displayName}前往${command.targetRoomId}` };
  }

  public advanceOneTick(): CrewTickResult {
    let crossedEdge = false;
    for (const crew of Array.from(this.crews.values()).sort((left, right) => left.id.localeCompare(right.id))) {
      if (crew.state !== 'MOVING') continue;
      crew.ticksIntoEdge += 1;
      if (crew.ticksIntoEdge < crew.definition.moveTicksPerEdge) continue;
      crew.ticksIntoEdge = 0;
      crew.pathIndex += 1;
      crossedEdge = true;
      const currentNode = this.navigation.getNode(crew.pathNodeIds[crew.pathIndex]);
      if (currentNode !== null) crew.currentRoomId = currentNode.roomId;
      if (crew.pathIndex < crew.pathNodeIds.length - 1) continue;
      crew.state = 'IDLE';
      crew.currentRoomId = crew.targetRoomId ?? crew.currentRoomId;
      crew.currentStationIndex = crew.targetStationIndex;
      crew.targetRoomId = null;
      crew.targetStationIndex = null;
      crew.pathNodeIds = [stationNodeId(crew.currentRoomId, crew.currentStationIndex ?? 0)];
      crew.pathIndex = 0;
    }
    return { snapshot: this.getSnapshot(), crossedEdge };
  }

  public static restore(
    navigation: NavigationGraph,
    initialStates: readonly CrewInitialState[],
    snapshot: unknown,
  ): CrewRestoreResult {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== CREW_SNAPSHOT_SCHEMA_VERSION || !Array.isArray(snapshot.crews)) {
      return failure('INVALID_SNAPSHOT', '船员快照版本或船员列表无效');
    }
    let model: CrewModel;
    try {
      model = new CrewModel(navigation, initialStates);
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
      const occupiedStation = entry.state === 'IDLE'
        ? stationNodeId(entry.currentRoomId, entry.currentStationIndex ?? -1)
        : stationNodeId(entry.targetRoomId ?? '', entry.targetStationIndex ?? -1);
      if (occupied.has(occupiedStation)) return failure('INVALID_SNAPSHOT', `船员快照站位冲突：${occupiedStation}`);
      occupied.add(occupiedStation);
      const crew = model.crews.get(entry.id) as MutableCrewState;
      Object.assign(crew, {
        hp: entry.hp,
        state: entry.state,
        currentRoomId: entry.currentRoomId,
        currentStationIndex: entry.currentStationIndex,
        targetRoomId: entry.targetRoomId,
        targetStationIndex: entry.targetStationIndex,
        pathNodeIds: [...entry.pathNodeIds],
        pathIndex: entry.pathIndex,
        ticksIntoEdge: entry.ticksIntoEdge,
      });
    }
    for (const crew of model.crews.values()) {
      if (seen.has(crew.id)) continue;
      const station = stationNodeId(crew.currentRoomId, crew.currentStationIndex ?? -1);
      if (occupied.has(station)) return failure('INVALID_SNAPSHOT', `新增船员默认站位冲突：${station}`);
      occupied.add(station);
    }
    return { ok: true, model };
  }

  private findFirstFreeStation(roomId: string): number | null {
    const occupied = new Set<string>();
    for (const crew of this.crews.values()) {
      const station = crew.state === 'IDLE'
        ? stationNodeId(crew.currentRoomId, crew.currentStationIndex ?? -1)
        : stationNodeId(crew.targetRoomId ?? '', crew.targetStationIndex ?? -1);
      occupied.add(station);
    }
    for (let index = 0; index < this.navigation.getRoomStationCount(roomId); index += 1) {
      if (!occupied.has(stationNodeId(roomId, index))) return index;
    }
    return null;
  }
}

function snapshotEntry(crew: MutableCrewState): CrewSnapshotEntry {
  return {
    id: crew.id,
    definitionId: crew.definition.id,
    hp: crew.hp,
    state: crew.state,
    currentRoomId: crew.currentRoomId,
    currentStationIndex: crew.currentStationIndex,
    targetRoomId: crew.targetRoomId,
    targetStationIndex: crew.targetStationIndex,
    pathNodeIds: Object.freeze([...crew.pathNodeIds]),
    pathIndex: crew.pathIndex,
    ticksIntoEdge: crew.ticksIntoEdge,
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
  if (!Number.isInteger(value.hp) || (value.hp as number) < 0 || (value.hp as number) > crew.definition.maxHp) {
    return failure('INVALID_SNAPSHOT', `船员生命值无效：${value.id}`);
  }
  if (value.state !== 'IDLE' && value.state !== 'MOVING') return failure('INVALID_SNAPSHOT', `船员状态无效：${value.id}`);
  const currentRoomId = value.currentRoomId;
  if (typeof currentRoomId !== 'string' || !navigation.hasRoom(currentRoomId)) {
    return failure('INVALID_SNAPSHOT', `船员当前房间无效：${value.id}`);
  }
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
  if (!Number.isInteger(value.ticksIntoEdge) || (value.ticksIntoEdge as number) < 0 || (value.ticksIntoEdge as number) >= crew.definition.moveTicksPerEdge) {
    return failure('INVALID_SNAPSHOT', `船员 Tick 进度无效：${value.id}`);
  }
  if (value.state === 'IDLE') {
    if (!Number.isInteger(value.currentStationIndex)) {
      return failure('INVALID_SNAPSHOT', `船员当前站位无效：${value.id}`);
    }
    const currentStationNodeId = stationNodeId(currentRoomId, value.currentStationIndex as number);
    if (navigation.getNode(currentStationNodeId) === null || pathNodeIds[0] !== currentStationNodeId) {
      return failure('INVALID_SNAPSHOT', `船员当前站位与路径不一致：${value.id}`);
    }
    if (value.targetRoomId !== null || value.targetStationIndex !== null || pathNodeIds.length !== 1 || value.pathIndex !== 0 || value.ticksIntoEdge !== 0) {
      return failure('INVALID_SNAPSHOT', `空闲船员快照包含移动状态：${value.id}`);
    }
  } else {
    const targetRoomId = value.targetRoomId;
    if (value.currentStationIndex !== null || typeof targetRoomId !== 'string' || !navigation.hasRoom(targetRoomId)) {
      return failure('INVALID_SNAPSHOT', `移动船员目标房间无效：${value.id}`);
    }
    if (!Number.isInteger(value.targetStationIndex)) {
      return failure('INVALID_SNAPSHOT', `移动船员目标站位无效：${value.id}`);
    }
    const targetStationNodeId = stationNodeId(targetRoomId, value.targetStationIndex as number);
    if (navigation.getNode(targetStationNodeId) === null) {
      return failure('INVALID_SNAPSHOT', `移动船员目标站位无效：${value.id}`);
    }
    const currentNode = navigation.getNode(pathNodeIds[value.pathIndex as number]);
    if (currentNode === null || currentNode.roomId !== currentRoomId || (value.pathIndex as number) >= pathNodeIds.length - 1) {
      return failure('INVALID_SNAPSHOT', `移动船员当前位置与路径不一致：${value.id}`);
    }
    if (pathNodeIds[pathNodeIds.length - 1] !== targetStationNodeId) {
      return failure('INVALID_SNAPSHOT', `移动船员路径终点无效：${value.id}`);
    }
  }
  return { ok: true, entry: value as unknown as CrewSnapshotEntry };
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
