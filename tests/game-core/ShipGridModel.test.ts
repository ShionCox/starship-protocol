import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipGridModel, type PlacementErrorCode, type PlacementValidation, type RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';
import { hull, placement } from './fixtures.ts';

function expectError(result: PlacementValidation, code: PlacementErrorCode): void {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

test('网格尺寸和有效格完全来自船体定义', () => {
  const grid = new ShipGridModel(hull('hull-test', 20, 10));
  assert.equal(grid.width, 20);
  assert.equal(grid.height, 10);
  assert.equal(grid.isCellUsable(19, 9), true);
  assert.equal(grid.isCellUsable(20, 9), false);
});

test('合法房间写入占用表并可移除', () => {
  const grid = new ShipGridModel(hull());
  assert.equal(grid.placeRoom(placement('room-reactor-1', 'room-reactor', 3, 2)).ok, true);
  assert.equal(grid.getOccupant(4, 3), 'room-reactor-1');
  assert.equal(grid.removeRoom('room-reactor-1'), true);
  assert.equal(grid.getOccupant(3, 2), null);
});

test('拒绝空实例/定义ID、非整数、越界、重叠和重复实例', () => {
  const grid = new ShipGridModel(hull());
  expectError(grid.placeRoom(placement('   ', 'room-a', 0, 0)), 'INVALID_ROOM_ID');
  expectError(grid.placeRoom(placement('room-a-1', '   ', 0, 0)), 'INVALID_DEFINITION_ID');
  expectError(grid.placeRoom({ ...placement('room-a-1', 'room-a', 0, 0), instanceId: null } as unknown as RoomPlacement), 'INVALID_ROOM_ID');
  expectError(grid.placeRoom(placement('fractional', 'room-a', 0.5, 0)), 'INVALID_GRID_VALUE');
  expectError(grid.placeRoom(placement('outside', 'room-a', 19, 9)), 'OUT_OF_BOUNDS');
  assert.equal(grid.placeRoom(placement('room-a-1', 'room-a', 0, 0)).ok, true);
  expectError(grid.placeRoom(placement('room-b-1', 'room-b', 1, 1)), 'OVERLAP');
  expectError(grid.placeRoom(placement('room-a-1', 'room-a', 4, 4)), 'DUPLICATE_ROOM_ID');
});

test('非矩形船体拒绝占用无效格，非法Mask拒绝构造', () => {
  const mask = [1, 1, 0, 1, 0, 0];
  const grid = new ShipGridModel(hull('hull-mask', 3, 2, mask));
  expectError(grid.placeRoom(placement('room-a-1', 'room-a', 0, 0)), 'INVALID_HULL_CELL');
  assert.throws(() => new ShipGridModel({ ...hull(), validCells: [1] }), RangeError);
});

test('房间上限由船体定义控制', () => {
  const grid = new ShipGridModel({ ...hull('hull-limit', 4, 2), maxRooms: 1 });
  assert.equal(grid.placeRoom(placement('room-a-1', 'room-a', 0, 0)).ok, true);
  expectError(grid.placeRoom(placement('room-b-1', 'room-b', 2, 0)), 'ROOM_LIMIT_REACHED');
});

test('房间移动预检不改状态，成功原子更新，失败保留旧位置', () => {
  const grid = new ShipGridModel(hull());
  grid.placeRoom(placement('room-a-1', 'room-a', 0, 0));
  grid.placeRoom(placement('room-b-1', 'room-b', 4, 0));
  const move = { type: 'MOVE_ROOM' as const, roomInstanceId: 'room-a-1', x: 2, y: 0 };
  assert.equal(grid.validateRoomMove(move).ok, true);
  assert.equal(grid.getOccupant(0, 0), 'room-a-1');
  assert.equal(grid.moveRoom(move).ok, true);
  assert.equal(grid.getOccupant(2, 0), 'room-a-1');
  const before = grid.getRooms();
  expectError(grid.moveRoom({ ...move, x: 3 }), 'OVERLAP');
  assert.deepEqual(grid.getRooms(), before);
  expectError(grid.validateRoomMove({ ...move, roomInstanceId: 'missing' }), 'ROOM_NOT_FOUND');
});
