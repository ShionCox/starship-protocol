import {
  ShipGridModel,
  type GridPosition,
  type PlacementErrorCode,
  type RoomPlacement,
} from '../game-core/ShipGridModel.ts';

/**
 * Bootstrap 在把场景表现绑定到 GameCore 前使用的房间布局输入。
 *
 * `authoredPosition` 只描述编辑器中已经存在的房间；运行时补齐的房间必须
 * 由规划器寻找空位，不能用房间数组下标推导位置，否则新增房间会挪动旧布局。
 */
export interface PrototypeLayoutRoom {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly authoredPosition: GridPosition | null;
  readonly runtimeCreated: boolean;
}

export type PrototypeLayoutPlanErrorCode =
  | 'INVALID_ROOM_ID'
  | 'DUPLICATE_ROOM_ID'
  | 'INVALID_ROOM'
  | 'MISSING_AUTHORED_POSITION'
  | 'NO_AVAILABLE_SLOT'
  | PlacementErrorCode;

export type PrototypeLayoutPlanResult =
  | {
    readonly ok: true;
    readonly grid: ShipGridModel;
    readonly placements: ReadonlyMap<string, RoomPlacement>;
  }
  | {
    readonly ok: false;
    readonly code: PrototypeLayoutPlanErrorCode;
    readonly roomId: string;
    readonly message: string;
  };

/**
 * 原子规划 Prototype 房间布局。
 *
 * 规划器始终在新建的临时网格上工作，调用方只有拿到 `ok: true` 才替换当前
 * GameCore。这样任一旧房间非法、运行时房间无空位或存档尺寸不匹配时，外部
 * 不会看到半写入的占用表，也不会提前触发 UI/能源初始化。
 */
export function planPrototypeLayout(
  gridColumns: number,
  gridRows: number,
  validHullCells: readonly GridPosition[],
  rooms: readonly PrototypeLayoutRoom[],
  restoredPlacements: ReadonlyMap<string, RoomPlacement> | null = null,
): PrototypeLayoutPlanResult {
  let grid: ShipGridModel;
  try {
    grid = new ShipGridModel(gridColumns, gridRows, validHullCells);
  } catch (cause) {
    return failure('', 'INVALID_ROOM', `无法创建原型布局网格：${describeCause(cause)}`);
  }

  const roomIds = new Set<string>();
  for (const room of rooms) {
    const id = typeof room.id === 'string' ? room.id.trim() : '';
    if (id.length === 0) return failure(id, 'INVALID_ROOM_ID', '房间实例 ID 不能为空');
    if (roomIds.has(id)) return failure(id, 'DUPLICATE_ROOM_ID', `房间实例 ID 重复：${id}`);
    roomIds.add(id);
    if (
      !Number.isInteger(room.width) ||
      !Number.isInteger(room.height) ||
      room.width <= 0 ||
      room.height <= 0
    ) {
      return failure(id, 'INVALID_ROOM', `房间 ${id} 的网格尺寸无效`);
    }
  }

  const placements = new Map<string, RoomPlacement>();
  if (restoredPlacements !== null) {
    if (restoredPlacements.size !== rooms.length) {
      return failure('', 'INVALID_ROOM', '布局存档未覆盖当前全部房间');
    }
    for (const room of rooms) {
      const id = room.id.trim();
      const restored = restoredPlacements.get(id);
      if (restored === undefined) {
        return failure(id, 'INVALID_ROOM', `布局存档缺少房间：${id}`);
      }
      if (restored.width !== room.width || restored.height !== room.height) {
        return failure(id, 'INVALID_ROOM', `布局存档中的房间尺寸不匹配：${id}`);
      }
      const placement: RoomPlacement = { ...restored, id };
      const validation = grid.placeRoom(placement);
      if (validation.ok === false) {
        return failure(id, validation.code, `房间 ${id} 未通过布局存档校验：${validation.code}`);
      }
      placements.set(id, placement);
    }
    return { ok: true, grid, placements };
  }

  // 先锁定编辑器已有房间，再为运行时补齐房间找空位；顺序与 roomViews 无关。
  const authoredRooms = rooms.filter((room) => !room.runtimeCreated);
  const runtimeRooms = rooms.filter((room) => room.runtimeCreated);
  for (const room of authoredRooms) {
    const id = room.id.trim();
    if (room.authoredPosition === null) {
      return failure(id, 'MISSING_AUTHORED_POSITION', `编辑器房间 ${id} 缺少逻辑网格坐标`);
    }
    const placement: RoomPlacement = {
      id,
      ...room.authoredPosition,
      width: room.width,
      height: room.height,
    };
    const validation = grid.placeRoom(placement);
    if (validation.ok === false) {
      return failure(id, validation.code, `初始房间 ${id} 放置失败：${validation.code}`);
    }
    placements.set(id, placement);
  }

  for (const room of runtimeRooms) {
    const id = room.id.trim();
    const placement = findFirstAvailablePlacement(grid, id, room.width, room.height);
    if (placement === null) {
      return failure(id, 'NO_AVAILABLE_SLOT', `运行时房间 ${id} 没有合法空位`);
    }
    placements.set(id, placement);
  }

  return { ok: true, grid, placements };
}

function findFirstAvailablePlacement(
  grid: ShipGridModel,
  id: string,
  width: number,
  height: number,
): RoomPlacement | null {
  // 与创作面板和 SceneSettings 的首个合法空位规则保持一致：先行后列。
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const candidate: RoomPlacement = { id, x, y, width, height };
      const validation = grid.placeRoom(candidate);
      if (validation.ok) return candidate;
    }
  }
  return null;
}

function failure(
  roomId: string,
  code: PrototypeLayoutPlanErrorCode,
  message: string,
): PrototypeLayoutPlanResult {
  return { ok: false, roomId, code, message };
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
