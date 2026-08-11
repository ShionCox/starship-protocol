import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planPrototypeLayout,
  type PrototypeLayoutRoom,
} from '../../../assets/scripts/bootstrap/PrototypeLayoutPlanner.ts';

const VALID_CELLS = Array.from({ length: 8 * 4 }, (_, index) => ({
  x: index % 8,
  y: Math.floor(index / 8),
}));

test('先锁定已有场景房间，再给运行时房间分配首个合法空位', () => {
  const rooms: readonly PrototypeLayoutRoom[] = [
    {
      id: 'room-laser-1',
      width: 2,
      height: 2,
      authoredPosition: null,
      runtimeCreated: true,
    },
    {
      id: 'room-reactor-1',
      width: 2,
      height: 2,
      authoredPosition: { x: 4, y: 1 },
      runtimeCreated: false,
    },
  ];

  const result = planPrototypeLayout(8, 4, VALID_CELLS, rooms);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.placements.get('room-reactor-1'), {
    id: 'room-reactor-1', x: 4, y: 1, width: 2, height: 2,
  });
  // y=0,x=0 是第一个不与 authored room 重叠的合法空位。
  assert.deepEqual(result.placements.get('room-laser-1'), {
    id: 'room-laser-1', x: 0, y: 0, width: 2, height: 2,
  });
  assert.deepEqual(result.grid.getRooms(), [
    { id: 'room-reactor-1', x: 4, y: 1, width: 2, height: 2 },
    { id: 'room-laser-1', x: 0, y: 0, width: 2, height: 2 },
  ]);
});

test('布局规划失败时不返回半写入网格', () => {
  const result = planPrototypeLayout(2, 2, VALID_CELLS.filter((cell) => cell.x < 2 && cell.y < 2), [
    {
      id: 'room-reactor-1',
      width: 2,
      height: 2,
      authoredPosition: { x: 1, y: 1 },
      runtimeCreated: false,
    },
    {
      id: 'room-laser-1',
      width: 1,
      height: 1,
      authoredPosition: null,
      runtimeCreated: true,
    },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.roomId, 'room-reactor-1');
    assert.equal(result.code, 'OUT_OF_BOUNDS');
  }
});

test('已有房间占满网格时运行时补齐会原子失败', () => {
  const result = planPrototypeLayout(2, 2, VALID_CELLS.filter((cell) => cell.x < 2 && cell.y < 2), [
    {
      id: 'room-reactor-1',
      width: 2,
      height: 2,
      authoredPosition: { x: 0, y: 0 },
      runtimeCreated: false,
    },
    {
      id: 'room-laser-1',
      width: 1,
      height: 1,
      authoredPosition: null,
      runtimeCreated: true,
    },
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.roomId, 'room-laser-1');
    assert.equal(result.code, 'NO_AVAILABLE_SLOT');
  }
});

test('有完整存档时按存档恢复，不因运行时标记改变已有坐标', () => {
  const rooms: readonly PrototypeLayoutRoom[] = [
    {
      id: 'room-reactor-1',
      width: 2,
      height: 2,
      authoredPosition: { x: 0, y: 0 },
      runtimeCreated: false,
    },
    {
      id: 'room-laser-1',
      width: 2,
      height: 2,
      authoredPosition: null,
      runtimeCreated: true,
    },
  ];
  const restored = new Map([
    ['room-reactor-1', { id: 'room-reactor-1', x: 5, y: 1, width: 2, height: 2 }],
    ['room-laser-1', { id: 'room-laser-1', x: 1, y: 5, width: 2, height: 2 }],
  ] as const);

  const result = planPrototypeLayout(8, 8, Array.from({ length: 64 }, (_, index) => ({
    x: index % 8,
    y: Math.floor(index / 8),
  })), rooms, restored);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.placements.get('room-reactor-1'), restored.get('room-reactor-1'));
    assert.deepEqual(result.placements.get('room-laser-1'), restored.get('room-laser-1'));
  }
});
