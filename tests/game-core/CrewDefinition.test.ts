import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREW_ROLE_LABELS,
  parseCrewDefinition,
} from '../../assets/scripts/game-core/CrewDefinition.ts';

const ENGINEER = {
  schemaVersion: 1,
  id: 'crew-engineer',
  displayName: '工程师',
  role: 'ENGINEER',
  maxHp: 100,
  moveTicksPerEdge: 5,
};

test('船员 JSON 合法解析并提供中文职业名称', () => {
  const result = parseCrewDefinition(ENGINEER);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.displayName, '工程师');
    assert.equal(CREW_ROLE_LABELS[result.definition.role], '工程师');
  }
});

test('空 ID、未知职业、非整数生命与移动耗时均被拒绝', () => {
  for (const invalid of [
    { ...ENGINEER, id: '' },
    { ...ENGINEER, role: 'CAPTAIN' },
    { ...ENGINEER, maxHp: 99.5 },
    { ...ENGINEER, moveTicksPerEdge: 0 },
    { ...ENGINEER, moveTicksPerEdge: 1.5 },
  ]) {
    assert.equal(parseCrewDefinition(invalid).ok, false);
  }
});
