import type { RoomDefinition } from './RoomDefinition.ts';

export const ENERGY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface EnergyRoom {
  /** 房间实例的稳定 ID，不使用数组下标作为长期标识。 */
  readonly id: string;
  readonly powerGeneration?: number;
  readonly minPower: number;
  readonly maxPower: number;
}

export interface EnergyAllocation {
  readonly roomId: string;
  readonly power: number;
}

export interface EnergySnapshot {
  readonly schemaVersion: typeof ENERGY_SNAPSHOT_SCHEMA_VERSION;
  readonly allocations: readonly EnergyAllocation[];
}

export type EnergyErrorCode =
  | 'INVALID_ROOM_ID'
  | 'DUPLICATE_ROOM_ID'
  | 'INVALID_ROOM'
  | 'UNKNOWN_ROOM'
  | 'INVALID_COMMAND'
  | 'BELOW_MIN_POWER'
  | 'ABOVE_MAX_POWER'
  | 'INSUFFICIENT_POWER'
  | 'INVALID_SNAPSHOT';

export type EnergyCommand =
  | { readonly type: 'SET_ROOM_POWER'; readonly roomId: string; readonly power: number }
  | { readonly type: 'RESET_ROOM_POWER'; readonly roomId: string };

export type EnergyCommandResult =
  | { readonly ok: true; readonly snapshot: EnergySnapshot }
  | { readonly ok: false; readonly code: EnergyErrorCode; readonly message: string };

export type EnergyRestoreResult =
  | { readonly ok: true; readonly model: EnergyModel }
  | { readonly ok: false; readonly code: EnergyErrorCode; readonly message: string };

/** 把已解析的房间定义按实例 ID 转换为能源模型输入，保持 GameCore 与 Cocos 解耦。 */
export function createEnergyRooms(
  definitionsByRoomInstanceId: ReadonlyMap<string, Readonly<RoomDefinition>>,
): readonly EnergyRoom[] {
  const rooms: EnergyRoom[] = [];
  for (const [roomId, definition] of definitionsByRoomInstanceId) {
    if (roomId.trim().length === 0) throw new RangeError('能源房间实例 ID 不能为空');
    if (definition.category !== 'ENERGY' && definition.powerGeneration > 0) {
      throw new RangeError(`非能源房间不能提供能源：${roomId}`);
    }
    rooms.push({
      id: roomId,
      powerGeneration: definition.powerGeneration,
      minPower: definition.minPower,
      maxPower: definition.maxPower,
    });
  }
  rooms.sort((left, right) => left.id.localeCompare(right.id));
  return rooms;
}

/**
 * R1 的最小能源规则模型。
 *
 * 不变量：所有分配都以稳定字符串房间 ID 保存；一次 Command 先完整校验，失败时不修改
 * 任何旧状态。产能是有效能源房间产出的总和，当前阶段还没有状态惩罚或 Tick 衰减。
 */
export class EnergyModel {
  private readonly rooms: Map<string, EnergyRoom>;
  private readonly allocations = new Map<string, number>();

  public constructor(rooms: readonly EnergyRoom[]) {
    this.rooms = new Map();
    for (const room of rooms) {
      const validation = validateRoom(room);
      if (validation !== null) throw new RangeError(validation.message);
      if (this.rooms.has(room.id)) throw new RangeError(`能源房间 ID 重复：${room.id}`);
      this.rooms.set(room.id, Object.freeze({ ...room, powerGeneration: room.powerGeneration ?? 0 }));
      this.allocations.set(room.id, 0);
    }
  }

  public getAvailablePower(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.powerGeneration ?? 0;
    return total;
  }

  public getAllocatedPower(): number {
    let total = 0;
    for (const power of this.allocations.values()) total += power;
    return total;
  }

  public getRoomPower(roomId: string): number | null {
    return this.allocations.get(roomId) ?? null;
  }

  public getSnapshot(): EnergySnapshot {
    const allocations = Array.from(this.allocations, ([roomId, power]) => ({ roomId, power }));
    allocations.sort((left, right) => left.roomId.localeCompare(right.roomId));
    return { schemaVersion: ENERGY_SNAPSHOT_SCHEMA_VERSION, allocations };
  }

  public apply(command: EnergyCommand): EnergyCommandResult {
    const roomId = command?.roomId;
    if (typeof roomId !== 'string' || roomId.trim().length === 0) {
      return failure('INVALID_ROOM_ID', '能源分配必须使用非空房间 ID');
    }
    const room = this.rooms.get(roomId);
    if (room === undefined) return failure('UNKNOWN_ROOM', `未知能源房间：${roomId}`);

    let nextPower: number;
    if (command.type === 'RESET_ROOM_POWER') {
      nextPower = 0;
    } else if (command.type === 'SET_ROOM_POWER' && Number.isInteger(command.power) && command.power >= 0) {
      nextPower = command.power;
    } else {
      return failure('INVALID_COMMAND', '能源 Command 必须设置非负整数功率');
    }

    // 0 表示断电；只有开启房间时才要求达到最低运行能源。
    if (nextPower !== 0 && nextPower < room.minPower) return failure('BELOW_MIN_POWER', `房间 ${roomId} 的分配能源不能低于 ${room.minPower}`);
    if (nextPower > room.maxPower) return failure('ABOVE_MAX_POWER', `房间 ${roomId} 的分配能源不能高于 ${room.maxPower}`);

    const previousPower = this.allocations.get(roomId) ?? 0;
    const nextTotal = this.getAllocatedPower() - previousPower + nextPower;
    if (nextTotal > this.getAvailablePower()) {
      return failure('INSUFFICIENT_POWER', `能源不足：需要 ${nextTotal}，可用 ${this.getAvailablePower()}`);
    }

    this.allocations.set(roomId, nextPower);
    return { ok: true, snapshot: this.getSnapshot() };
  }

  public static restore(rooms: readonly EnergyRoom[], snapshot: unknown): EnergyRestoreResult {
    if (!isRecord(snapshot) || snapshot.schemaVersion !== ENERGY_SNAPSHOT_SCHEMA_VERSION || !Array.isArray(snapshot.allocations)) {
      return failure('INVALID_SNAPSHOT', '能源快照版本或分配列表无效');
    }
    const model = new EnergyModel(rooms);
    const seen = new Set<string>();
    for (const value of snapshot.allocations) {
      if (!isRecord(value) || typeof value.roomId !== 'string' || typeof value.power !== 'number' || !Number.isInteger(value.power) || value.power < 0) {
        return failure('INVALID_SNAPSHOT', '能源快照包含非法分配');
      }
      const roomId = value.roomId;
      const power = value.power;
      if (seen.has(roomId)) return failure('INVALID_SNAPSHOT', `能源快照重复房间：${roomId}`);
      seen.add(roomId);
      const result = model.apply({ type: 'SET_ROOM_POWER', roomId, power });
      if (result.ok === false) return { ok: false, code: result.code, message: result.message };
    }
    return { ok: true, model };
  }
}

function validateRoom(room: EnergyRoom): { readonly message: string } | null {
  if (typeof room.id !== 'string' || room.id.trim().length === 0) return { message: '能源房间 ID 不能为空' };
  if (!Number.isInteger(room.minPower) || room.minPower < 0) return { message: `房间 ${room.id} 的最低能源无效` };
  if (!Number.isInteger(room.maxPower) || room.maxPower < room.minPower) return { message: `房间 ${room.id} 的能源范围无效` };
  if (room.powerGeneration !== undefined && (!Number.isInteger(room.powerGeneration) || room.powerGeneration < 0)) {
    return { message: `房间 ${room.id} 的能源产能无效` };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: EnergyErrorCode, message: string): { readonly ok: false; readonly code: EnergyErrorCode; readonly message: string } {
  return { ok: false, code, message };
}
