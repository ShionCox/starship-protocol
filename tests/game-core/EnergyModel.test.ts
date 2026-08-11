import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EnergyModel,
  createEnergyRooms,
  type EnergyRoom,
} from '../../assets/scripts/game-core/EnergyModel.ts';

const ROOMS: readonly EnergyRoom[] = [
  { id: 'room-reactor-1', powerGeneration: 10, minPower: 0, maxPower: 0 },
  { id: 'room-laser-1', minPower: 2, maxPower: 6 },
  { id: 'room-shield-1', minPower: 2, maxPower: 6 },
];

test('能源产能按有效房间求和，合法分配原子提交', () => {
  const model = new EnergyModel(ROOMS);
  assert.equal(model.getAvailablePower(), 10);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 6 }).ok, true);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-shield-1', power: 4 }).ok, true);
  assert.equal(model.getAllocatedPower(), 10);
  assert.deepEqual(model.getSnapshot().allocations, [
    { roomId: 'room-laser-1', power: 6 },
    { roomId: 'room-reactor-1', power: 0 },
    { roomId: 'room-shield-1', power: 4 },
  ]);
});

test('按房间实例 ID 映射已解析定义，旧产能缺省为 0', () => {
  const rooms = createEnergyRooms(new Map([
    ['room-shield-1', { id: 'room-shield', displayName: '护盾室', category: 'DEFENSE', width: 2, height: 2, maxLevel: 1, maxHp: 120, minPower: 2, maxPower: 6, powerGeneration: 0, crewCapacity: 2 }],
    ['room-reactor-1', { id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 10, crewCapacity: 0 }],
    ['room-laser-1', { id: 'room-laser', displayName: '激光室', category: 'WEAPON', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 2, maxPower: 6, powerGeneration: 0, crewCapacity: 2 }],
  ]));
  assert.deepEqual(rooms, [
    { id: 'room-laser-1', powerGeneration: 0, minPower: 2, maxPower: 6 },
    { id: 'room-reactor-1', powerGeneration: 10, minPower: 0, maxPower: 0 },
    { id: 'room-shield-1', powerGeneration: 0, minPower: 2, maxPower: 6 },
  ]);
});

test('能源不足时激光和护盾不能同时满功率，失败不改旧状态', () => {
  const model = new EnergyModel(ROOMS);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 6 }).ok, true);
  const before = model.getSnapshot();
  const result = model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-shield-1', power: 6 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'INSUFFICIENT_POWER');
  assert.deepEqual(model.getSnapshot(), before);
});

test('分配范围、未知房间、非法命令和重复定义均被拒绝', () => {
  const model = new EnergyModel(ROOMS);
  const below = model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 1 });
  assert.equal(below.ok, false);
  if (!below.ok) assert.equal(below.code, 'BELOW_MIN_POWER');
  const above = model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 7 });
  assert.equal(above.ok, false);
  if (!above.ok) assert.equal(above.code, 'ABOVE_MAX_POWER');
  const unknown = model.apply({ type: 'RESET_ROOM_POWER', roomId: 'room-missing' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, 'UNKNOWN_ROOM');
  assert.throws(() => new EnergyModel([...ROOMS, ROOMS[0]]), /重复/);
});

test('能源快照恢复保持状态，非法快照不会生成半恢复模型', () => {
  const source = new EnergyModel(ROOMS);
  assert.equal(source.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 6 }).ok, true);
  const restored = EnergyModel.restore(ROOMS, source.getSnapshot());
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), source.getSnapshot());

  const invalid = EnergyModel.restore(ROOMS, {
    schemaVersion: 1,
    allocations: [{ roomId: 'room-laser-1', power: 6 }, { roomId: 'room-laser-1', power: 0 }],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, 'INVALID_SNAPSHOT');
});

test('相同初始状态和 Command 序列重复 100 次结果一致', () => {
  const commands = [
    { type: 'SET_ROOM_POWER' as const, roomId: 'room-laser-1', power: 6 },
    { type: 'SET_ROOM_POWER' as const, roomId: 'room-shield-1', power: 4 },
    { type: 'RESET_ROOM_POWER' as const, roomId: 'room-shield-1' },
  ];
  let expected: unknown;
  for (let index = 0; index < 100; index += 1) {
    const model = new EnergyModel(ROOMS);
    for (const command of commands) assert.equal(model.apply(command).ok, true);
    const snapshot = model.getSnapshot();
    if (expected === undefined) expected = snapshot;
    else assert.deepEqual(snapshot, expected);
  }
});
