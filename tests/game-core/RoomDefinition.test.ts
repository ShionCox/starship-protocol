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
  crewCapacity: 0,
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
      crewCapacity: 0,
    });
  }
});

test('拒绝非对象和不支持的 schemaVersion', () => {
  assert.equal(parseRoomDefinition(null).ok, false);
  assert.equal(parseRoomDefinition([]).ok, false);
  const result = parseRoomDefinition({ ...VALID_REACTOR, schemaVersion: 2 });
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
    { crewCapacity: 1.5 },
  ];
  for (const invalid of invalidValues) {
    const result = parseRoomDefinition({ ...VALID_REACTOR, ...invalid });
    assert.deepEqual(result.ok ? null : result.code, 'INVALID_NUMBER_RANGE');
  }
});
