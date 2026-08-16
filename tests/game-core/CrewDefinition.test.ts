import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREW_ROLE_LABELS,
  parseCrewDefinition,
} from '../../assets/scripts/game-core/CrewDefinition.ts';

const ENGINEER = {
  schemaVersion: 4,
  id: 'crew-engineer',
  displayName: '工程师',
  role: 'ENGINEER',
  maxHp: 100,
  moveTicksPerEdge: 5,
  repairHpPerTick: 1,
  rarity: 'RARE',
  appearanceId: 'appearance-engineer',
  traitIds: ['trait-construction-speed-250'],
};

test('船员 JSON 合法解析并提供中文职业名称', () => {
  const result = parseCrewDefinition(ENGINEER);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.definition.displayName, '工程师');
    assert.equal(CREW_ROLE_LABELS[result.definition.role], '工程师');
  }
});

test('医务员定义合法且维修量必须为零', () => {
  const medic = parseCrewDefinition({ ...ENGINEER, id: 'crew-medic', displayName: '医务员', role: 'MEDIC', repairHpPerTick: 0 });
  assert.equal(medic.ok, true);
  if (medic.ok) assert.equal(CREW_ROLE_LABELS[medic.definition.role], '医务员');
  assert.equal(parseCrewDefinition({ ...ENGINEER, role: 'MEDIC', repairHpPerTick: 1 }).ok, false);
});

test('士兵职业与外观、稀有度和词条均为权威字段', () => {
  const soldier = parseCrewDefinition({ ...ENGINEER, id: 'crew-soldier', displayName: '士兵', role: 'SOLDIER', rarity: 'COMMON', repairHpPerTick: 0, appearanceId: 'appearance-soldier', traitIds: [] });
  assert.equal(soldier.ok, true);
  if (soldier.ok) assert.equal(CREW_ROLE_LABELS[soldier.definition.role], '士兵');
});

test('旧版本、非法基础字段和维修量均被拒绝', () => {
  for (const invalid of [
    { ...ENGINEER, schemaVersion: 1 },
    { ...ENGINEER, id: '' },
    { ...ENGINEER, role: 'CAPTAIN' },
    { ...ENGINEER, maxHp: 99.5 },
    { ...ENGINEER, moveTicksPerEdge: 0 },
    { ...ENGINEER, moveTicksPerEdge: 1.5 },
    { ...ENGINEER, repairHpPerTick: -1 },
    { ...ENGINEER, repairHpPerTick: 0 },
    { ...ENGINEER, repairHpPerTick: 1.5 },
    { ...ENGINEER, role: 'GUNNER', repairHpPerTick: 1 },
  ]) {
    assert.equal(parseCrewDefinition(invalid).ok, false);
  }
});
