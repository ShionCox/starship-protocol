import type { HullDefinition } from './HullDefinition.ts';

export const SHIP_LAYOUT_SCHEMA_VERSION = 1 as const;

export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

/** 房间实例的逻辑位置；定义 ID 与实例 ID 必须始终分开。 */
export interface RoomPlacement extends GridPosition {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly width: number;
  readonly height: number;
}

export interface ShipLayoutSnapshot {
  readonly schemaVersion: typeof SHIP_LAYOUT_SCHEMA_VERSION;
  readonly hullId: string;
  readonly rooms: readonly RoomPlacement[];
}

export type ShipLayoutRestoreErrorCode =
  | 'INVALID_JSON'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_SNAPSHOT'
  | 'HULL_MISMATCH'
  | 'INVALID_ROOM';

export type ShipLayoutRestoreResult =
  | { readonly ok: true; readonly grid: ShipGridModel }
  | { readonly ok: false; readonly code: ShipLayoutRestoreErrorCode; readonly message: string };

export interface MoveRoomCommand extends GridPosition {
  readonly type: 'MOVE_ROOM';
  readonly roomInstanceId: string;
}

export type PlacementErrorCode =
  | 'INVALID_ROOM_ID'
  | 'INVALID_DEFINITION_ID'
  | 'INVALID_GRID_VALUE'
  | 'DUPLICATE_ROOM_ID'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_LIMIT_REACHED'
  | 'OUT_OF_BOUNDS'
  | 'INVALID_HULL_CELL'
  | 'OVERLAP';

export type PlacementValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: PlacementErrorCode; readonly cell?: GridPosition };

export interface ShipGridReadModel {
  readonly width: number;
  readonly height: number;
  hasRoom(roomInstanceId: string): boolean;
  isCellUsable(x: number, y: number): boolean;
  getOccupant(x: number, y: number): string | null;
}

export function validateRoomPlacement(grid: ShipGridReadModel, placement: RoomPlacement): PlacementValidation {
  return validatePlacement(grid, placement, null);
}

function validatePlacement(
  grid: ShipGridReadModel,
  placement: RoomPlacement,
  ignoredRoomId: string | null,
): PlacementValidation {
  if (typeof placement.instanceId !== 'string' || placement.instanceId.trim().length === 0) {
    return { ok: false, code: 'INVALID_ROOM_ID' };
  }
  if (typeof placement.definitionId !== 'string' || placement.definitionId.trim().length === 0) {
    return { ok: false, code: 'INVALID_DEFINITION_ID' };
  }
  const gridValues = [placement.x, placement.y, placement.width, placement.height];
  if (!gridValues.every(Number.isInteger) || placement.width <= 0 || placement.height <= 0) {
    return { ok: false, code: 'INVALID_GRID_VALUE' };
  }
  if (grid.hasRoom(placement.instanceId) && placement.instanceId !== ignoredRoomId) {
    return { ok: false, code: 'DUPLICATE_ROOM_ID' };
  }
  if (
    placement.x < 0 || placement.y < 0 ||
    placement.x + placement.width > grid.width ||
    placement.y + placement.height > grid.height
  ) {
    return { ok: false, code: 'OUT_OF_BOUNDS' };
  }
  for (let y = placement.y; y < placement.y + placement.height; y += 1) {
    for (let x = placement.x; x < placement.x + placement.width; x += 1) {
      if (!grid.isCellUsable(x, y)) return { ok: false, code: 'INVALID_HULL_CELL', cell: { x, y } };
      const occupant = grid.getOccupant(x, y);
      if (occupant !== null && occupant !== ignoredRoomId) {
        return { ok: false, code: 'OVERLAP', cell: { x, y } };
      }
    }
  }
  return { ok: true };
}

/**
 * 单艘飞船的逻辑网格。宽高、有效格和房间上限全部来自 HullDefinition，避免场景全局常量
 * 阻止不同船体同时存在。模型只保存整数坐标和稳定字符串 ID。
 */
export class ShipGridModel implements ShipGridReadModel {
  public readonly width: number;
  public readonly height: number;
  public readonly hullId: string;

  private readonly maxRooms: number;
  private readonly usableCells: Uint8Array;
  private readonly occupants: Array<string | null>;
  private readonly rooms = new Map<string, RoomPlacement>();

  public constructor(hull: Readonly<HullDefinition>) {
    if (
      !Number.isInteger(hull.gridWidth) || hull.gridWidth <= 0 ||
      !Number.isInteger(hull.gridHeight) || hull.gridHeight <= 0 ||
      hull.cellTypes.length !== hull.gridWidth * hull.gridHeight ||
      !hull.cellTypes.every((cell) => cell === 'VOID' || cell === 'BUILDABLE' || cell === 'FIXED_WALL') ||
      !Number.isInteger(hull.maxRooms) || hull.maxRooms <= 0
    ) {
      throw new RangeError('船体网格定义无效');
    }
    this.width = hull.gridWidth;
    this.height = hull.gridHeight;
    this.hullId = hull.id;
    this.maxRooms = hull.maxRooms;
    this.usableCells = Uint8Array.from(hull.cellTypes, (cell) => cell === 'BUILDABLE' ? 1 : 0);
    this.occupants = Array<string | null>(this.width * this.height).fill(null);
  }

  public isCellInside(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  public isCellUsable(x: number, y: number): boolean {
    return this.isCellInside(x, y) && this.usableCells[this.toIndex(x, y)] === 1;
  }

  public getOccupant(x: number, y: number): string | null {
    return this.isCellInside(x, y) ? this.occupants[this.toIndex(x, y)] : null;
  }

  public hasRoom(roomInstanceId: string): boolean {
    return this.rooms.has(roomInstanceId);
  }

  public getRooms(): readonly RoomPlacement[] {
    return Array.from(this.rooms.values(), (room) => ({ ...room }))
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  }

  public placeRoom(placement: RoomPlacement): PlacementValidation {
    if (this.rooms.size >= this.maxRooms) return { ok: false, code: 'ROOM_LIMIT_REACHED' };
    const validation = validateRoomPlacement(this, placement);
    if (validation.ok === false) return validation;
    const storedPlacement = { ...placement };
    this.rooms.set(storedPlacement.instanceId, storedPlacement);
    this.forEachPlacementCell(storedPlacement, (x, y) => {
      this.occupants[this.toIndex(x, y)] = storedPlacement.instanceId;
    });
    return validation;
  }

  public validateRoomMove(command: MoveRoomCommand): PlacementValidation {
    const current = typeof command.roomInstanceId === 'string' ? this.rooms.get(command.roomInstanceId) : undefined;
    if (current === undefined) return { ok: false, code: 'ROOM_NOT_FOUND' };
    return validatePlacement(this, { ...current, x: command.x, y: command.y }, current.instanceId);
  }

  /** 原子提交房间移动；失败时旧位置和占用表保持不变。 */
  public moveRoom(command: MoveRoomCommand): PlacementValidation {
    const validation = this.validateRoomMove(command);
    if (validation.ok === false) return validation;
    const current = this.rooms.get(command.roomInstanceId);
    if (current === undefined) return { ok: false, code: 'ROOM_NOT_FOUND' };
    this.forEachPlacementCell(current, (x, y) => {
      this.occupants[this.toIndex(x, y)] = null;
    });
    const moved = { ...current, x: command.x, y: command.y };
    this.rooms.set(moved.instanceId, moved);
    this.forEachPlacementCell(moved, (x, y) => {
      this.occupants[this.toIndex(x, y)] = moved.instanceId;
    });
    return validation;
  }

  public removeRoom(roomInstanceId: string): boolean {
    const placement = this.rooms.get(roomInstanceId);
    if (placement === undefined) return false;
    this.rooms.delete(roomInstanceId);
    this.forEachPlacementCell(placement, (x, y) => {
      this.occupants[this.toIndex(x, y)] = null;
    });
    return true;
  }

  private toIndex(x: number, y: number): number {
    return y * this.width + x;
  }

  private forEachPlacementCell(placement: RoomPlacement, visit: (x: number, y: number) => void): void {
    for (let y = placement.y; y < placement.y + placement.height; y += 1) {
      for (let x = placement.x; x < placement.x + placement.width; x += 1) visit(x, y);
    }
  }
}

export function createShipLayoutSnapshot(grid: ShipGridModel): ShipLayoutSnapshot {
  return {
    schemaVersion: SHIP_LAYOUT_SCHEMA_VERSION,
    hullId: grid.hullId,
    rooms: grid.getRooms(),
  };
}

export function serializeShipLayout(grid: ShipGridModel): string {
  return JSON.stringify(createShipLayoutSnapshot(grid));
}

/** 从不可信 JSON 原子恢复布局；任一房间非法时不返回半份网格。 */
export function restoreShipLayout(json: string, hull: Readonly<HullDefinition>): ShipLayoutRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, code: 'INVALID_JSON', message: '存档不是有效 JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, code: 'INVALID_SNAPSHOT', message: '存档根节点必须是对象' };
  if (parsed.schemaVersion !== SHIP_LAYOUT_SCHEMA_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_SCHEMA', message: '存档版本不受支持' };
  }
  if (parsed.hullId !== hull.id) return { ok: false, code: 'HULL_MISMATCH', message: '存档船体与当前飞船不一致' };
  if (!Array.isArray(parsed.rooms) || parsed.rooms.length > hull.maxRooms) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: '存档房间列表格式或数量无效' };
  }
  const grid = new ShipGridModel(hull);
  for (const value of parsed.rooms) {
    const placement = readRoomPlacement(value);
    if (placement === null) return { ok: false, code: 'INVALID_ROOM', message: '存档包含格式无效的房间' };
    const validation = grid.placeRoom(placement);
    if (validation.ok === false) {
      return { ok: false, code: 'INVALID_ROOM', message: `房间 ${placement.instanceId} 未通过放置校验：${validation.code}` };
    }
  }
  return { ok: true, grid };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRoomPlacement(value: unknown): RoomPlacement | null {
  if (!isRecord(value)) return null;
  const { instanceId, definitionId, x, y, width, height } = value;
  if (
    typeof instanceId !== 'string' || typeof definitionId !== 'string' ||
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number'
  ) return null;
  return { instanceId, definitionId, x, y, width, height };
}
