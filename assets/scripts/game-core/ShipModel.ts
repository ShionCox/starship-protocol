import type { CrewDefinition } from './CrewDefinition.ts';
import { CrewModel, type CrewInitialState, type CrewSnapshot } from './CrewModel.ts';
import { createEnergyRooms, EnergyModel, type EnergySnapshot } from './EnergyModel.ts';
import type { HullDefinition } from './HullDefinition.ts';
import { NavigationGraph } from './NavigationGraph.ts';
import type { RoomDefinition } from './RoomDefinition.ts';
import {
  ShipGridModel,
  createShipLayoutSnapshot,
  restoreShipLayout,
  type RoomPlacement,
} from './ShipGridModel.ts';

export const SHIP_SNAPSHOT_SCHEMA_VERSION = 1 as const;

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
  readonly energy: EnergySnapshot;
  readonly crews: CrewSnapshot;
}

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
}

/** 单舰蓝图只引用已校验规则定义，实例 ID 仅在当前飞船内唯一。 */
export interface ShipModelBlueprint {
  readonly shipId: string;
  readonly hull: Readonly<HullDefinition>;
  readonly rooms: readonly ShipRoomInitialState[];
  readonly crews: readonly ShipCrewInitialState[];
}

/** 所有会修改单舰状态的 Command 都必须显式携带目标飞船 ID。 */
export type ShipCommand =
  | { readonly type: 'MOVE_ROOM'; readonly shipId: string; readonly roomInstanceId: string; readonly x: number; readonly y: number }
  | { readonly type: 'SET_ROOM_POWER'; readonly shipId: string; readonly roomInstanceId: string; readonly power: number }
  | { readonly type: 'RESET_ROOM_POWER'; readonly shipId: string; readonly roomInstanceId: string }
  | { readonly type: 'MOVE_CREW'; readonly shipId: string; readonly crewInstanceId: string; readonly targetRoomInstanceId: string };

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
 * 修改子模型。当前阶段不实现建造、拆除、维修和战斗。
 */
export class ShipModel {
  public readonly shipId: string;
  public readonly hull: Readonly<HullDefinition>;

  private grid: ShipGridModel;
  private navigation: NavigationGraph;
  private crew: CrewModel;
  private readonly energy: EnergyModel;
  private readonly roomStates = new Map<string, RoomRuntimeState>();
  private readonly roomDefinitions = new Map<string, Readonly<RoomDefinition>>();
  private readonly crewInitialStates: readonly CrewInitialState[];
  private revision = 0;

  public constructor(blueprint: ShipModelBlueprint) {
    if (typeof blueprint.shipId !== 'string' || blueprint.shipId.trim().length === 0) {
      throw new RangeError('飞船实例 ID 不能为空');
    }
    if (blueprint.crews.length > blueprint.hull.maxCrew) throw new RangeError('船员数量超过船体上限');
    this.shipId = blueprint.shipId;
    this.hull = blueprint.hull;
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

    this.navigation = new NavigationGraph(this.grid.getRooms(), this.roomDefinitions);
    this.crewInitialStates = Object.freeze(blueprint.crews.map((entry) => ({
      id: entry.instanceId,
      definition: entry.definition,
      roomId: entry.roomInstanceId,
      stationIndex: entry.stationIndex,
    })));
    this.crew = new CrewModel(this.navigation, this.crewInitialStates);
    this.energy = new EnergyModel(createEnergyRooms(this.roomDefinitions));
  }

  public getSnapshot(): ShipSnapshot {
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
      if (this.crew.isAnyCrewMoving()) return failure('CREW_MOVING', '船员移动期间不能调整房间布局', before);
      const moved = this.applyRoomMove(command.roomInstanceId, command.x, command.y, before);
      if (moved.ok === false) return moved;
      message = '房间位置已更新';
    } else if (command.type === 'SET_ROOM_POWER' || command.type === 'RESET_ROOM_POWER') {
      const result = this.energy.apply(command.type === 'SET_ROOM_POWER'
        ? { type: 'SET_ROOM_POWER', roomId: command.roomInstanceId, power: command.power }
        : { type: 'RESET_ROOM_POWER', roomId: command.roomInstanceId });
      if (result.ok === false) return failure('ENERGY_COMMAND_FAILED', result.message, before);
      message = '能源分配已更新';
    } else if (command.type === 'MOVE_CREW') {
      const result = this.crew.apply({ type: 'MOVE_CREW', crewId: command.crewInstanceId, targetRoomId: command.targetRoomInstanceId });
      if (result.ok === false) return failure('CREW_COMMAND_FAILED', result.message, before);
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

  public advanceOneTick(): ShipSnapshot {
    const before = this.crew.getSnapshot();
    this.crew.advanceOneTick();
    if (JSON.stringify(before) !== JSON.stringify(this.crew.getSnapshot())) this.revision += 1;
    return this.getSnapshot();
  }

  public static restore(blueprint: ShipModelBlueprint, snapshot: unknown): ShipRestoreResult {
    if (!isShipSnapshot(snapshot) || snapshot.shipId !== blueprint.shipId || snapshot.hullId !== blueprint.hull.id) {
      return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船快照版本、实例或船体不匹配' };
    }
    const roomBlueprints = new Map(blueprint.rooms.map((room) => [room.instanceId, room]));
    if (snapshot.rooms.length !== roomBlueprints.size) return { ok: false, code: 'INVALID_SNAPSHOT', message: '飞船快照房间数量不匹配' };
    const restoredRooms: ShipRoomInitialState[] = [];
    for (const room of snapshot.rooms) {
      const initial = roomBlueprints.get(room.instanceId);
      if (initial === undefined || initial.definition.id !== room.definitionId) {
        return { ok: false, code: 'INVALID_SNAPSHOT', message: `飞船快照包含未知房间：${room.instanceId}` };
      }
      restoredRooms.push({ ...room, definition: initial.definition });
    }
    let model: ShipModel;
    try {
      model = new ShipModel({ ...blueprint, rooms: restoredRooms });
    } catch (cause) {
      return { ok: false, code: 'INVALID_SNAPSHOT', message: describeCause(cause) };
    }
    const energy = EnergyModel.restore(createEnergyRooms(model.roomDefinitions), snapshot.energy);
    if (energy.ok === false) return { ok: false, code: 'INVALID_SNAPSHOT', message: energy.message };
    const crew = CrewModel.restore(model.navigation, model.crewInitialStates, snapshot.crews);
    if (crew.ok === false) return { ok: false, code: 'INVALID_SNAPSHOT', message: crew.message };
    model.copyEnergyFrom(energy.model);
    model.crew = crew.model;
    model.revision = snapshot.revision;
    return { ok: true, model };
  }

  private applyRoomMove(roomInstanceId: string, x: number, y: number, before: ShipSnapshot): ShipCommandResult | { readonly ok: true } {
    const validation = this.grid.moveRoom({ type: 'MOVE_ROOM', roomInstanceId, x, y });
    if (validation.ok === false) return failure('ROOM_COMMAND_FAILED', `房间移动失败：${validation.code}`, before);
    let nextNavigation: NavigationGraph;
    try {
      nextNavigation = new NavigationGraph(this.grid.getRooms(), this.roomDefinitions);
    } catch (cause) {
      this.restoreGridFromSnapshot(before);
      return failure('ROOM_COMMAND_FAILED', describeCause(cause), before);
    }
    const restoredCrew = CrewModel.restore(nextNavigation, this.crewInitialStates, this.crew.getSnapshot());
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShipSnapshot(value: unknown): value is ShipSnapshot {
  return isRecord(value) && value.schemaVersion === SHIP_SNAPSHOT_SCHEMA_VERSION &&
    typeof value.shipId === 'string' && typeof value.hullId === 'string' &&
    Number.isInteger(value.revision) && (value.revision as number) >= 0 &&
    Array.isArray(value.rooms) && isRecord(value.energy) && isRecord(value.crews) &&
    value.rooms.every((room) => isRecord(room) && typeof room.instanceId === 'string' &&
      typeof room.definitionId === 'string' && Number.isInteger(room.x) && Number.isInteger(room.y) &&
      Number.isInteger(room.level) && Number.isInteger(room.hp));
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(code: ShipCommandErrorCode, message: string, snapshot: ShipSnapshot): ShipCommandResult {
  return { ok: false, code, message, snapshot };
}
