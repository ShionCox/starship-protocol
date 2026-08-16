import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHullCellMask, parseHullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';

const VALID = {
  schemaVersion: 2,
  id: 'hull-starter',
  displayName: '启航者船体',
  level: 1,
  gridWidth: 3,
  gridHeight: 2,
  cellTypes: ['VOID', 'BUILDABLE', 'VOID', 'BUILDABLE', 'BUILDABLE', 'FIXED_WALL'],
  baseConstructionSlots: 3,
  maxCrew: 4,
  maxRooms: 3,
  visualId: 'visual-hull-starter',
};

test('合法非矩形船体解析并冻结', () => {
  const result = parseHullDefinition(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition.cellTypes, ['VOID', 'BUILDABLE', 'VOID', 'BUILDABLE', 'BUILDABLE', 'FIXED_WALL']);
    assert.equal(Object.isFrozen(result.definition), true);
    assert.equal(Object.isFrozen(result.definition.cellTypes), true);
  }
});

test('CSV cellMask 按 V/B/W 和斜线逐格展开为 cellTypes', () => {
  const result = parseHullDefinition({
    ...VALID,
    cellTypes: undefined,
    cellMask: 'VBW/BVW',
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.definition.cellTypes, ['VOID', 'BUILDABLE', 'FIXED_WALL', 'BUILDABLE', 'VOID', 'FIXED_WALL']);
  const direct = parseHullCellMask('VBW/BVW', 3, 2);
  assert.equal(direct.ok, true);
});

test('拒绝空ID、非法Mask、非法限制和空外观ID', () => {
  const invalid = [
    { ...VALID, id: '' },
    { ...VALID, cellTypes: ['BUILDABLE'] },
    { ...VALID, cellTypes: ['VOID', 'BUILDABLE', 'BROKEN', 'BUILDABLE', 'BUILDABLE', 'BUILDABLE'] },
    { ...VALID, maxCrew: -1 },
    { ...VALID, maxRooms: 0 },
    { ...VALID, baseConstructionSlots: 9 },
    { ...VALID, visualId: '' },
    { ...VALID, cellTypes: undefined, cellMask: 'VBW/BV' },
    { ...VALID, cellTypes: undefined, cellMask: 'VBX/BVW' },
    { ...VALID, cellTypes: undefined, cellMask: 'VBW/BVW/' },
  ];
  for (const value of invalid) assert.equal(parseHullDefinition(value).ok, false);
});
