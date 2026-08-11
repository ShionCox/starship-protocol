const assert = require('node:assert/strict');
const test = require('node:test');

const { discoverCrewPrefabs, parseCrewDefinition } = require('../dist/crew/discover-crew-prefabs.js');

test('船员 JSON 经 CrewView Prefab 真实依赖发现进入目录 DTO', async () => {
  const db = {
    async queryUuid(url) { return url.endsWith('/CrewView.ts') ? 'crew-script' : ''; },
    async queryInfo() { return null; },
    async queryAssets() { return [
      { uuid: 'crew-config', url: 'db://assets/config/crew/crew-engineer.json' },
      { uuid: 'crew-prefab', url: 'db://assets/prefabs/EngineerCrew.prefab' },
    ]; },
    async readFile() { return JSON.stringify({ schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 }); },
    async queryDependencies() { return ['crew-script', 'crew-config']; },
  };
  const result = await discoverCrewPrefabs(db);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.entries[0], { schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5, prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', prefabUuid: 'crew-prefab', configUrl: 'db://assets/config/crew/crew-engineer.json', configUuid: 'crew-config' });
});

test('船员编辑器解析拒绝空 ID、未知职业和非整数数值', () => {
  const base = { schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 };
  assert.equal(parseCrewDefinition(base)?.role, 'ENGINEER');
  assert.equal(parseCrewDefinition({ ...base, id: '' }), null);
  assert.equal(parseCrewDefinition({ ...base, role: 'CAPTAIN' }), null);
  assert.equal(parseCrewDefinition({ ...base, maxHp: 99.5 }), null);
  assert.equal(parseCrewDefinition({ ...base, moveTicksPerEdge: 2.5 }), null);
});
