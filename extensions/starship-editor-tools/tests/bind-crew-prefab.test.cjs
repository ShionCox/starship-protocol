const assert = require('node:assert/strict');
const test = require('node:test');

const { bindCrewDefinitionToOpenPrefab } = require('../dist/crew/bind-crew-prefab.js');

test('船员 Prefab 同步定义、默认实例 ID 和职业颜色后保存', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  const scene = {
    async queryNodeTree() {
      return { uuid: 'prefab-root', components: [{ type: 'CrewView', value: 'crew-view', nodeUuid: 'prefab-root', index: 0 }], children: [] };
    },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async setProperty(...args) { calls.push(['set', ...args]); return true; },
    async executeComponentMethod() { return { ok: true, message: '有效' }; },
    async endRecording(id) { calls.push(['end', id]); },
    async cancelRecording(id) { calls.push(['cancel', id]); },
  };

  const result = await bindCrewDefinitionToOpenPrefab(scene, 'config-gunner', 'crew-gunner', 'GUNNER');

  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'definitionAsset'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'crewDefinitionId' && call[3] === 'crew-gunner'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'crewInstanceId' && call[3] === 'crew-gunner-1'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'bodyColor' && call[3].value.r === 224), true);
  assert.deepEqual(calls.filter((call) => call[0] === 'begin' || call[0] === 'end'), [['begin', 'prefab-root'], ['end', 'undo']]);
  assert.equal(calls.filter((call) => call[0] === 'set').every((call) => call[4]?.record === false), true);
  assert.equal(calls.some((call) => call[0] === 'scene' && call[1] === 'save-scene'), true);
  delete global.Editor;
});
