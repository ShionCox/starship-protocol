export const SHIP_GRID_WIDTH = 20;
export const SHIP_GRID_HEIGHT = 10;
export const SHIP_LAYOUT_SCHEMA_VERSION = 1;

export interface GridPosition {
  readonly x: number;
  readonly y: number;
}

export interface RoomPlacement extends GridPosition {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** R0 飞船布局存档；只包含逻辑网格与稳定房间 ID。 */
export interface ShipLayoutSnapshot {
  readonly schemaVersion: typeof SHIP_LAYOUT_SCHEMA_VERSION;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly rooms: readonly RoomPlacement[];
}

export type ShipLayoutRestoreErrorCode =
  | 'INVALID_JSON'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_SNAPSHOT'
  | 'GRID_MISMATCH'
  | 'INVALID_ROOM';

export type ShipLayoutRestoreResult =
  | { readonly ok: true; readonly grid: ShipGridModel }
  | { readonly ok: false; readonly code: ShipLayoutRestoreErrorCode; readonly message: string };

/** 运行时拖动房间最终提交给 GameCore 的逻辑命令。 */
export interface MoveRoomCommand extends GridPosition {
  readonly type: 'MOVE_ROOM';
  readonly roomId: string;
}

export type PlacementErrorCode =
  | 'INVALID_ROOM_ID'
  | 'INVALID_GRID_VALUE'
  | 'DUPLICATE_ROOM_ID'
  | 'ROOM_NOT_FOUND'
  | 'OUT_OF_BOUNDS'
  | 'INVALID_HULL_CELL'
  | 'OVERLAP';

export type PlacementValidation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: PlacementErrorCode;
      readonly cell?: GridPosition;
    };

export interface ShipGridReadModel {
  readonly width: number;
  readonly height: number;
  hasRoom(roomId: string): boolean;
  isCellUsable(x: number, y: number): boolean;
  getOccupant(x: number, y: number): string | null;
}

/**
 * 校验房间占用的逻辑网格，不读取任何 Cocos 坐标或节点状态。
 * 这样同一份规则可以在客户端、测试和未来的权威战斗服务中复用。
 */
export function validateRoomPlacement(
  grid: ShipGridReadModel,
  placement: RoomPlacement,
): PlacementValidation {
  return validatePlacement(grid, placement, null);
}

function validatePlacement(
  grid: ShipGridReadModel,
  placement: RoomPlacement,
  ignoredRoomId: string | null,
): PlacementValidation {
  if (typeof placement.id !== 'string' || placement.id.trim().length === 0) {
    return { ok: false, code: 'INVALID_ROOM_ID' };
  }

  const gridValues = [placement.x, placement.y, placement.width, placement.height];
  if (!gridValues.every(Number.isInteger) || placement.width <= 0 || placement.height <= 0) {
    return { ok: false, code: 'INVALID_GRID_VALUE' };
  }

  if (grid.hasRoom(placement.id) && placement.id !== ignoredRoomId) {
    return { ok: false, code: 'DUPLICATE_ROOM_ID' };
  }

  if (
    placement.x < 0 ||
    placement.y < 0 ||
    placement.x + placement.width > grid.width ||
    placement.y + placement.height > grid.height
  ) {
    return { ok: false, code: 'OUT_OF_BOUNDS' };
  }

  for (let y = placement.y; y < placement.y + placement.height; y += 1) {
    for (let x = placement.x; x < placement.x + placement.width; x += 1) {
      if (!grid.isCellUsable(x, y)) {
        return { ok: false, code: 'INVALID_HULL_CELL', cell: { x, y } };
      }

      const occupant = grid.getOccupant(x, y);
      if (occupant !== null && occupant !== ignoredRoomId) {
        return { ok: false, code: 'OVERLAP', cell: { x, y } };
      }
    }
  }

  return { ok: true };
}

/**
 * 飞船逻辑网格。
 *
 * 不变量：
 * 1. 只保存整数逻辑坐标和稳定字符串 ID；
 * 2. 不引用 `cc`、DOM、localStorage 或世界像素坐标；
 * 3. 房间只有通过统一放置校验后才会写入占用表。
 */
export class ShipGridModel implements ShipGridReadModel {
  public readonly width: number;
  public readonly height: number;

  private readonly usableCells: Uint8Array;
  private readonly occupants: Array<string | null>;
  private readonly rooms = new Map<string, RoomPlacement>();

  public constructor(
    width = SHIP_GRID_WIDTH,
    height = SHIP_GRID_HEIGHT,
    validCells?: readonly GridPosition[],
  ) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('网格宽高必须是正整数');
    }

    this.width = width;
    this.height = height;
    this.usableCells = new Uint8Array(width * height);
    this.occupants = Array<string | null>(width * height).fill(null);

    if (validCells === undefined) {
      this.usableCells.fill(1);
      return;
    }

    for (const cell of validCells) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !this.isCellInside(cell.x, cell.y)) {
        throw new RangeError(`无效船体格坐标: (${cell.x}, ${cell.y})`);
      }
      this.usableCells[this.toIndex(cell.x, cell.y)] = 1;
    }
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

  public hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  public getRooms(): readonly RoomPlacement[] {
    return Array.from(this.rooms.values(), (room) => ({ ...room }));
  }

  public placeRoom(placement: RoomPlacement): PlacementValidation {
    const validation = validateRoomPlacement(this, placement);
    if (validation.ok === false) {
      return validation;
    }

    const storedPlacement = { ...placement };
    this.rooms.set(storedPlacement.id, storedPlacement);
    this.forEachPlacementCell(storedPlacement, (x, y) => {
      this.occupants[this.toIndex(x, y)] = storedPlacement.id;
    });
    return validation;
  }

  /**
   * 预检已有房间的移动，不修改占用表。
   * 校验时只忽略房间自己的旧占用，其他房间仍按统一重叠规则处理。
   */
  public validateRoomMove(command: MoveRoomCommand): PlacementValidation {
    const current = typeof command.roomId === 'string' ? this.rooms.get(command.roomId) : undefined;
    if (current === undefined) {
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }

    return validatePlacement(this, { ...current, x: command.x, y: command.y }, current.id);
  }

  /** 原子提交房间移动；失败时原位置和占用表保持不变。 */
  public moveRoom(command: MoveRoomCommand): PlacementValidation {
    const validation = this.validateRoomMove(command);
    if (validation.ok === false) {
      return validation;
    }

    const current = this.rooms.get(command.roomId);
    if (current === undefined) {
      return { ok: false, code: 'ROOM_NOT_FOUND' };
    }

    this.forEachPlacementCell(current, (x, y) => {
      this.occupants[this.toIndex(x, y)] = null;
    });
    const moved = { ...current, x: command.x, y: command.y };
    this.rooms.set(moved.id, moved);
    this.forEachPlacementCell(moved, (x, y) => {
      this.occupants[this.toIndex(x, y)] = moved.id;
    });
    return validation;
  }

  public removeRoom(roomId: string): boolean {
    const placement = this.rooms.get(roomId);
    if (placement === undefined) {
      return false;
    }

    this.rooms.delete(roomId);
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
      for (let x = placement.x; x < placement.x + placement.width; x += 1) {
        visit(x, y);
      }
    }
  }
}

/** 生成可序列化快照，不泄漏网格内部集合或 Cocos 表现对象。 */
export function createShipLayoutSnapshot(grid: ShipGridModel): ShipLayoutSnapshot {
  return {
    schemaVersion: SHIP_LAYOUT_SCHEMA_VERSION,
    gridWidth: grid.width,
    gridHeight: grid.height,
    rooms: grid.getRooms(),
  };
}

export function serializeShipLayout(grid: ShipGridModel): string {
  return JSON.stringify(createShipLayoutSnapshot(grid));
}

/**
 * 从不可信 JSON 恢复临时网格。
 * 只有全部房间都通过统一放置校验后才返回模型，避免半恢复状态污染当前游戏。
 */
export function restoreShipLayout(
  json: string,
  expectedWidth: number,
  expectedHeight: number,
  validCells?: readonly GridPosition[],
): ShipLayoutRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, code: 'INVALID_JSON', message: '存档不是有效 JSON' };
  }

  if (!isRecord(parsed)) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: '存档根节点必须是对象' };
  }
  if (parsed.schemaVersion !== SHIP_LAYOUT_SCHEMA_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_SCHEMA', message: '存档版本不受支持' };
  }
  if (
    !Number.isInteger(parsed.gridWidth) ||
    !Number.isInteger(parsed.gridHeight) ||
    (parsed.gridWidth as number) <= 0 ||
    (parsed.gridHeight as number) <= 0 ||
    !Array.isArray(parsed.rooms)
  ) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: '存档网格或房间列表格式无效' };
  }

  const gridWidth = parsed.gridWidth as number;
  const gridHeight = parsed.gridHeight as number;
  if (gridWidth !== expectedWidth || gridHeight !== expectedHeight) {
    return { ok: false, code: 'GRID_MISMATCH', message: '存档网格尺寸与当前场景不一致' };
  }
  if (parsed.rooms.length > gridWidth * gridHeight) {
    return { ok: false, code: 'INVALID_SNAPSHOT', message: '存档房间数量超过网格容量' };
  }

  // 船体有效格由当前场景配置决定，不写入布局快照；恢复时仍必须经过同一校验。
  const grid = new ShipGridModel(gridWidth, gridHeight, validCells);
  for (const value of parsed.rooms) {
    const placement = readRoomPlacement(value);
    if (placement === null) {
      return { ok: false, code: 'INVALID_ROOM', message: '存档包含格式无效的房间' };
    }
    const validation = grid.placeRoom(placement);
    if (validation.ok === false) {
      return {
        ok: false,
        code: 'INVALID_ROOM',
        message: `房间 ${placement.id} 未通过放置校验：${validation.code}`,
      };
    }
  }

  return { ok: true, grid };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRoomPlacement(value: unknown): RoomPlacement | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, x, y, width, height } = value;
  if (
    typeof id !== 'string' ||
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null;
  }
  return { id, x, y, width, height };
}
