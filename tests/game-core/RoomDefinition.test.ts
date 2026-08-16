import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOM_DEFINITION_SCHEMA_VERSION,
  parseRoomDefinition,
  type RoomDefinitionDocument,
} from '../../assets/scripts/game-core/RoomDefinition.ts';

const VALID_REACTOR: RoomDefinitionDocument = {
  schemaVersion: ROOM_DEFINITION_SCHEMA_VERSION,
  id: 'room-reactor',
  displayName: '反应堆',
  category: 'ENERGY',
  width: 2,
  height: 2,
  maxLevel: 1,
  maxHp: 100,
  minPower: 0,
  maxPower: 0,
  powerGeneration: 10,
  crewCapacity: 0,
  healingHpPerTick: 0,
  verticalConnectorKind: 'NONE',
  visualId: 'visual-room-reactor',
  metalCost: 150,
  buildDurationMs: 30000,
  demolishDurationMs: 10000,
  refundPermille: 500,
};

test('解析合法的版本化房间定义', () => {
  const result = parseRoomDefinition(VALID_REACTOR);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition, {
      id: 'room-reactor',
      displayName: '反应堆',
      category: 'ENERGY',
      width: 2,
      height: 2,
      maxLevel: 1,
      maxHp: 100,
      minPower: 0,
      maxPower: 0,
      powerGeneration: 10,
      crewCapacity: 0,
      healingHpPerTick: 0,
      verticalConnectorKind: 'NONE',
      visualId: 'visual-room-reactor',
      metalCost: 150,
      buildDurationMs: 30000,
      demolishDurationMs: 10000,
      refundPermille: 500,
    });
  }
});

test('旧版本和缺失权威施工字段直接拒绝', () => {
  assert.equal(parseRoomDefinition({ ...VALID_REACTOR, schemaVersion: 2 }).ok, false);
  assert.equal(parseRoomDefinition({ ...VALID_REACTOR, metalCost: undefined }).ok, false);
});

test('拒绝非对象和不支持的 schemaVersion', () => {
  assert.equal(parseRoomDefinition(null).ok, false);
  assert.equal(parseRoomDefinition([]).ok, false);
  const result = parseRoomDefinition({ ...VALID_REACTOR, schemaVersion: 1 });
  assert.deepEqual(result.ok ? null : result.code, 'UNSUPPORTED_SCHEMA');
});

test('拒绝缺失字段和非法稳定 ID', () => {
  assert.deepEqual(
    parseRoomDefinition({ ...VALID_REACTOR, displayName: '' }).ok,
    false,
  );
  const result = parseRoomDefinition({ ...VALID_REACTOR, id: 'Reactor Room' });
  assert.deepEqual(result.ok ? null : result.code, 'INVALID_ID');
});

test('拒绝未知房间分类', () => {
  const result = parseRoomDefinition({ ...VALID_REACTOR, category: 'UNKNOWN' });
  assert.deepEqual(result.ok ? null : result.code, 'INVALID_CATEGORY');
});

test('拒绝非能源房间声明正产能', () => {
  const result = parseRoomDefinition({ ...VALID_REACTOR, category: 'WEAPON', powerGeneration: 1 });
  assert.deepEqual(result.ok ? null : result.code, 'INVALID_NUMBER_RANGE');
});

test('拒绝非正整数网格尺寸', () => {
  for (const width of [0, -1, 1.5, '2']) {
    const result = parseRoomDefinition({ ...VALID_REACTOR, width });
    assert.deepEqual(result.ok ? null : result.code, 'INVALID_GRID_SIZE');
  }
});

test('拒绝非法等级、耐久、能源和船员容量', () => {
  const invalidValues: readonly Partial<RoomDefinitionDocument>[] = [
    { maxLevel: 0 },
    { maxHp: -1 },
    { minPower: -1 },
    { minPower: 2, maxPower: 1 },
    { powerGeneration: -1 },
    { powerGeneration: 1.5 },
    { crewCapacity: 1.5 },
    { healingHpPerTick: -1 },
    { healingHpPerTick: 1.5 },
  ];
  for (const invalid of invalidValues) {
    const result = parseRoomDefinition({ ...VALID_REACTOR, ...invalid });
    assert.deepEqual(result.ok ? null : result.code, 'INVALID_NUMBER_RANGE');
  }
});

test('只有支援房间可以声明正治疗量', () => {
  const medical = parseRoomDefinition({ ...VALID_REACTOR, id: 'room-medbay', displayName: '医疗室', category: 'SUPPORT', powerGeneration: 0, healingHpPerTick: 1 });
  assert.equal(medical.ok, true);
  const weapon = parseRoomDefinition({ ...VALID_REACTOR, category: 'WEAPON', powerGeneration: 0, healingHpPerTick: 1 });
  assert.deepEqual(weapon.ok ? null : weapon.code, 'INVALID_NUMBER_RANGE');
});
