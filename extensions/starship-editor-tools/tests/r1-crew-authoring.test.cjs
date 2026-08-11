const assert = require('node:assert/strict');
const test = require('node:test');

const { configureR1CrewScene } = require('../dist/scene/r1-crew-authoring.js');

test('公开 Scene API 持久化船员层、HUD层和中文船员状态面板', async () => {
  let phase = 0;
  const calls = [];
  const scene = {
    async queryComponents() { return []; },
    async queryNodeTree() {
      const crewPanel = phase >= 3 ? { uuid: 'crew-panel', name: '船员状态面板', components: [{ type: 'CrewStatusPanel', uuid: 'crew-panel-component', nodeUuid: 'crew-panel', index: 0 }], children: [] } : undefined;
      return { uuid: 'scene', name: 'PrototypeScene', children: [
        { uuid: 'ship', name: '飞船根', children: phase >= 1 ? [{ uuid: 'crew-root', name: '船员层', children: [] }] : [] },
        { uuid: 'ui', name: '界面根', children: phase >= 2 ? [{ uuid: 'hud', name: 'HUD层', children: crewPanel ? [crewPanel] : [] }] : [] },
      ] };
    },
    async createNode(options) { calls.push(['create-node', options.name]); phase += 1; return { uuid: options.name === '船员层' ? 'crew-root' : options.name === 'HUD层' ? 'hud' : 'crew-panel' }; },
    async createComponent(uuid, type) { calls.push(['create-component', uuid, type]); phase = 3; },
    async executeComponentMethod(uuid, name) { calls.push(['execute', uuid, name]); return true; },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async endRecording(uuid) { calls.push(['end', uuid]); },
    async cancelRecording(uuid) { calls.push(['cancel', uuid]); },
    async snapshotAbort() { calls.push(['abort']); },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
  };
  const result = await configureR1CrewScene(scene);
  assert.equal(result.ok, true);
  assert.ok(calls.some((call) => call[0] === 'execute' && call[2] === 'ensureAuthoringStructure'));
  assert.deepEqual(calls.filter((call) => call[0] === 'begin' || call[0] === 'end'), [['begin', 'scene'], ['end', 'undo']]);
});
