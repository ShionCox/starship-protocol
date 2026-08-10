import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHIP_GRID_HEIGHT,
  SHIP_GRID_WIDTH,
  ShipGridModel,
  type PlacementErrorCode,
  type PlacementValidation,
  type RoomPlacement,
} from '../../assets/scripts/game-core/ShipGridModel.ts';

function expectError(result: PlacementValidation, code: PlacementErrorCode): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, code);
  }
}

test('默认创建 20×10 的完整可用网格', () => {
  const grid = new ShipGridModel();

  assert.equal(grid.width, SHIP_GRID_WIDTH);
  assert.equal(grid.height, SHIP_GRID_HEIGHT);
  assert.equal(grid.isCellUsable(0, 0), true);
  assert.equal(grid.isCellUsable(19, 9), true);
  assert.equal(grid.isCellUsable(20, 9), false);
  assert.equal(grid.isCellUsable(19, 10), false);
});

test('合法 2×2 房间会写入占用表并可移除', () => {
  const grid = new ShipGridModel();
  const result = grid.placeRoom({ id: 'room-reactor-1', x: 3, y: 2, width: 2, height: 2 });

  assert.equal(result.ok, true);
  assert.equal(grid.getOccupant(3, 2), 'room-reactor-1');
  assert.equal(grid.getOccupant(4, 3), 'room-reactor-1');
  assert.equal(grid.getRooms().length, 1);
  assert.equal(grid.removeRoom('room-reactor-1'), true);
  assert.equal(grid.getOccupant(3, 2), null);
  assert.equal(grid.removeRoom('room-reactor-1'), false);
});

test('拒绝非整数、越界、重叠和重复 ID', () => {
  const grid = new ShipGridModel();

  expectError(grid.placeRoom({ id: '   ', x: 0, y: 0, width: 2, height: 2 }), 'INVALID_ROOM_ID');
  expectError(
    grid.placeRoom({ id: null, x: 0, y: 0, width: 2, height: 2 } as unknown as RoomPlacement),
    'INVALID_ROOM_ID',
  );
  expectError(grid.placeRoom({ id: 'fractional', x: 0.5, y: 0, width: 2, height: 2 }), 'INVALID_GRID_VALUE');
  expectError(grid.placeRoom({ id: 'outside', x: 19, y: 9, width: 2, height: 2 }), 'OUT_OF_BOUNDS');
  assert.equal(grid.placeRoom({ id: 'room-a', x: 0, y: 0, width: 2, height: 2 }).ok, true);
  expectError(grid.placeRoom({ id: 'room-b', x: 1, y: 1, width: 2, height: 2 }), 'OVERLAP');
  expectError(grid.placeRoom({ id: 'room-a', x: 4, y: 4, width: 2, height: 2 }), 'DUPLICATE_ROOM_ID');
  assert.deepEqual(grid.getRooms(), [{ id: 'room-a', x: 0, y: 0, width: 2, height: 2 }]);
  assert.equal(grid.getOccupant(1, 1), 'room-a');
});

test('拒绝占用非有效船体格', () => {
  const grid = new ShipGridModel(3, 2, [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);

  expectError(grid.placeRoom({ id: 'room-a', x: 0, y: 0, width: 2, height: 2 }), 'INVALID_HULL_CELL');
});

test('拒绝非法网格尺寸和非法有效格定义', () => {
  assert.throws(() => new ShipGridModel(0, 10), RangeError);
  assert.throws(() => new ShipGridModel(20, 10, [{ x: 20, y: 0 }]), RangeError);
});

test('移除一个房间不会清空其他房间占用', () => {
  const grid = new ShipGridModel();
  assert.equal(grid.placeRoom({ id: 'room-a', x: 0, y: 0, width: 2, height: 2 }).ok, true);
  assert.equal(grid.placeRoom({ id: 'room-b', x: 2, y: 0, width: 2, height: 2 }).ok, true);

  assert.equal(grid.removeRoom('room-a'), true);
  assert.equal(grid.getOccupant(0, 0), null);
  assert.equal(grid.getOccupant(2, 0), 'room-b');
});

test('房间移动预检不改状态，提交成功后原子更新占用，失败时回滚', () => {
  const grid = new ShipGridModel();
  assert.equal(grid.placeRoom({ id: 'room-a', x: 0, y: 0, width: 2, height: 2 }).ok, true);
  assert.equal(grid.placeRoom({ id: 'room-b', x: 4, y: 0, width: 2, height: 2 }).ok, true);

  const move = { type: 'MOVE_ROOM' as const, roomId: 'room-a', x: 2, y: 0 };
  assert.equal(grid.validateRoomMove(move).ok, true);
  assert.equal(grid.getOccupant(0, 0), 'room-a');
  assert.equal(grid.moveRoom(move).ok, true);
  assert.equal(grid.getOccupant(0, 0), null);
  assert.equal(grid.getOccupant(2, 0), 'room-a');

  const beforeRejectedMove = grid.getRooms();
  expectError(grid.moveRoom({ ...move, x: 3 }), 'OVERLAP');
  assert.deepEqual(grid.getRooms(), beforeRejectedMove);
  assert.equal(grid.getOccupant(2, 0), 'room-a');
  assert.equal(grid.getOccupant(4, 0), 'room-b');
  expectError(grid.validateRoomMove({ ...move, roomId: 'missing' }), 'ROOM_NOT_FOUND');
});
