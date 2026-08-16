import type { FloorDefinition } from './CsvGameConfig.ts';
import type { HullDefinition } from './HullDefinition.ts';
import type { RoomDefinition } from './RoomDefinition.ts';
import type { RoomPlacement } from './ShipGridModel.ts';

export const VOXEL_LAYOUT_SCHEMA_VERSION = 1 as const;

export interface FloorInstanceSnapshot {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
}

export interface VoxelRoomInstanceSnapshot extends RoomPlacement {
  readonly completed: boolean;
}

export interface VoxelLayoutSnapshot {
  readonly schemaVersion: typeof VOXEL_LAYOUT_SCHEMA_VERSION;
  readonly hullId: string;
  readonly floors: readonly FloorInstanceSnapshot[];
  readonly rooms: readonly VoxelRoomInstanceSnapshot[];
}

export type VoxelPlacementResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'INVALID_ID' | 'INVALID_GRID' | 'FIXED_WALL' | 'VOID_CELL' | 'OVERLAP' | 'MISSING_SUPPORT' | 'NOT_ADJACENT' | 'NOT_FOUND' | 'DEPENDENCY'; readonly message: string };

/**
 * 体素布局只保存格坐标和稳定 ID。地板是唯一水平行走层；房间底边必须由下一行完整地板支撑。
 */
export class VoxelLayoutModel {
  public readonly hull: Readonly<HullDefinition>;
  private readonly floors = new Map<string, FloorInstanceSnapshot>();
  private readonly rooms = new Map<string, VoxelRoomInstanceSnapshot>();

  public constructor(hull: Readonly<HullDefinition>) {
    this.hull = hull;
  }

  public getSnapshot(): VoxelLayoutSnapshot {
    return Object.freeze({
      schemaVersion: VOXEL_LAYOUT_SCHEMA_VERSION,
      hullId: this.hull.id,
      floors: Object.freeze(Array.from(this.floors.values(), (entry) => Object.freeze({ ...entry })).sort(byInstanceId)),
      rooms: Object.freeze(Array.from(this.rooms.values(), (entry) => Object.freeze({ ...entry })).sort(byInstanceId)),
    });
  }

  public hasFloorAt(x: number, y: number): boolean {
    return Array.from(this.floors.values()).some((floor) => floor.x === x && floor.y === y);
  }

  public getFloor(instanceId: string): Readonly<FloorInstanceSnapshot> | null {
    return this.floors.get(instanceId) ?? null;
  }

  public getRoom(instanceId: string): Readonly<VoxelRoomInstanceSnapshot> | null {
    return this.rooms.get(instanceId) ?? null;
  }

  public placeInitialFloor(instanceId: string, definition: Readonly<FloorDefinition>, x: number, y: number): VoxelPlacementResult {
    return this.placeFloor({ instanceId, definitionId: definition.id, x, y }, false);
  }

  public buildFloor(instanceId: string, definition: Readonly<FloorDefinition>, x: number, y: number): VoxelPlacementResult {
    return this.placeFloor({ instanceId, definitionId: definition.id, x, y }, true);
  }

  public validateFloorBuild(instanceId: string, definitionId: string, x: number, y: number): VoxelPlacementResult {
    return this.validateFloor({ instanceId, definitionId, x, y }, true);
  }

  public buildRoom(instanceId: string, definition: Readonly<RoomDefinition>, x: number, y: number): VoxelPlacementResult {
    const placement: VoxelRoomInstanceSnapshot = {
      instanceId,
      definitionId: definition.id,
      x,
      y,
      width: definition.width,
      height: definition.height,
      completed: true,
    };
    const validated = this.validateRoom(placement, definition.verticalConnectorKind !== 'NONE');
    if (validated.ok === false) return validated;
    this.rooms.set(instanceId, placement);
    return { ok: true };
  }

  public validateRoomBuild(instanceId: string, definition: Readonly<RoomDefinition>, x: number, y: number): VoxelPlacementResult {
    return this.validateRoom(
      { instanceId, definitionId: definition.id, x, y, width: definition.width, height: definition.height, completed: true },
      definition.verticalConnectorKind !== 'NONE',
    );
  }

  public demolishRoom(instanceId: string): VoxelPlacementResult {
    const validated = this.validateRoomDemolition(instanceId);
    if (validated.ok === false) return validated;
    this.rooms.delete(instanceId);
    return { ok: true };
  }

  public validateRoomDemolition(instanceId: string): VoxelPlacementResult {
    return this.rooms.has(instanceId) ? { ok: true } : failure('NOT_FOUND', `房间不存在：${instanceId}`);
  }

  public demolishFloor(instanceId: string): VoxelPlacementResult {
    const validated = this.validateFloorDemolition(instanceId);
    if (validated.ok === false) return validated;
    const floor = this.floors.get(instanceId);
    if (floor === undefined) return failure('NOT_FOUND', `地板不存在：${instanceId}`);
    this.floors.delete(instanceId);
    return { ok: true };
  }

  public validateFloorDemolition(instanceId: string): VoxelPlacementResult {
    const floor = this.floors.get(instanceId);
    if (floor === undefined) return failure('NOT_FOUND', `地板不存在：${instanceId}`);
    const supported = Array.from(this.rooms.values()).find((room) =>
      room.y - 1 === floor.y && floor.x >= room.x && floor.x < room.x + room.width);
    if (supported !== undefined) return failure('DEPENDENCY', `地板正在支撑建筑：${supported.instanceId}`);
    return { ok: true };
  }

  private placeFloor(floor: FloorInstanceSnapshot, requireAdjacent: boolean): VoxelPlacementResult {
    const validated = this.validateFloor(floor, requireAdjacent);
    if (validated.ok === false) return validated;
    this.floors.set(floor.instanceId, Object.freeze({ ...floor }));
    return { ok: true };
  }

  private validateFloor(floor: FloorInstanceSnapshot, requireAdjacent: boolean): VoxelPlacementResult {
    if (!validId(floor.instanceId) || !validId(floor.definitionId) || this.floors.has(floor.instanceId)) return failure('INVALID_ID', '地板实例或定义 ID 无效或重复');
    if (!this.isInside(floor.x, floor.y)) return failure('INVALID_GRID', '地板坐标越界');
    const cell = this.cellTypeAt(floor.x, floor.y);
    if (cell === 'FIXED_WALL') return failure('FIXED_WALL', '固定船体墙格不能建造');
    if (cell === 'VOID') return failure('VOID_CELL', '虚空格不能建造地板');
    if (this.hasFloorAt(floor.x, floor.y) || this.roomOccupies(floor.x, floor.y)) return failure('OVERLAP', '目标格已被占用');
    if (requireAdjacent && this.floors.size > 0 && !this.hasCompletedNeighbor(floor.x, floor.y)) {
      return failure('NOT_ADJACENT', '地板必须与同层已有地板或连接器停靠口相邻');
    }
    return { ok: true };
  }

  private validateRoom(room: VoxelRoomInstanceSnapshot, allowFloorStops = false): VoxelPlacementResult {
    if (!validId(room.instanceId) || !validId(room.definitionId) || this.rooms.has(room.instanceId)) return failure('INVALID_ID', '房间实例或定义 ID 无效或重复');
    if (![room.x, room.y, room.width, room.height].every(Number.isInteger) || room.width <= 0 || room.height <= 0 || room.y <= 0) {
      return failure('INVALID_GRID', '房间格坐标或尺寸无效');
    }
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (!this.isInside(x, y)) return failure('INVALID_GRID', `房间越界：${x},${y}`);
        const cell = this.cellTypeAt(x, y);
        if (cell === 'FIXED_WALL') return failure('FIXED_WALL', `房间与固定墙冲突：${x},${y}`);
        if (cell === 'VOID') return failure('VOID_CELL', `房间进入虚空格：${x},${y}`);
        if (this.roomOccupies(x, y) || (!allowFloorStops && this.hasFloorAt(x, y))) {
          return failure('OVERLAP', `房间格已被占用：${x},${y}`);
        }
      }
    }
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (!this.hasFloorAt(x, room.y - 1)) return failure('MISSING_SUPPORT', `房间缺少地板支撑：${x},${room.y - 1}`);
    }
    return { ok: true };
  }

  private hasCompletedNeighbor(x: number, y: number): boolean {
    return this.hasFloorAt(x - 1, y) || this.hasFloorAt(x + 1, y);
  }

  private roomOccupies(x: number, y: number): boolean {
    return Array.from(this.rooms.values()).some((room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height);
  }

  private isInside(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.hull.gridWidth && y < this.hull.gridHeight;
  }

  private cellTypeAt(x: number, y: number) {
    return this.hull.cellTypes[y * this.hull.gridWidth + x];
  }
}

function validId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function byInstanceId(left: { readonly instanceId: string }, right: { readonly instanceId: string }): number {
  return left.instanceId.localeCompare(right.instanceId);
}

function failure(code: Extract<VoxelPlacementResult, { readonly ok: false }>['code'], message: string): VoxelPlacementResult {
  return { ok: false, code, message };
}
