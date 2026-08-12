import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';

const VALID = {
  schemaVersion: 1,
  id: 'hull-starter',
  displayName: '启航者船体',
  level: 1,
  gridWidth: 3,
  gridHeight: 2,
  validCells: [0, 1, 0, 1, 1, 1],
  maxCrew: 4,
  maxRooms: 3,
  visualId: 'visual-hull-starter',
};

test('合法非矩形船体解析并冻结', () => {
  const result = parseHullDefinition(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition.validCells, [0, 1, 0, 1, 1, 1]);
    assert.equal(Object.isFrozen(result.definition), true);
    assert.equal(Object.isFrozen(result.definition.validCells), true);
  }
});

test('拒绝空ID、非法Mask、非法限制和空外观ID', () => {
  const invalid = [
    { ...VALID, id: '' },
    { ...VALID, validCells: [1] },
    { ...VALID, validCells: [0, 1, 2, 1, 1, 1] },
    { ...VALID, maxCrew: -1 },
    { ...VALID, maxRooms: 0 },
    { ...VALID, visualId: '' },
  ];
  for (const value of invalid) assert.equal(parseHullDefinition(value).ok, false);
});
