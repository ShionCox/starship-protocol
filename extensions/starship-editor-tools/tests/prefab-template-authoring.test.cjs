const assert = require('node:assert/strict');
const test = require('node:test');

const { replacePowerRowsWithPrefab } = require('../dist/scene/prefab-template-authoring.js');

test('能源行 Prefab 创建后通过组件方法设置局部坐标', async () => {
  global.Editor = { Message: { async request() { return true; } } };
  const calls = [];
  const panel = {
    uuid: 'panel',
    name: '能源面板',
    components: [{ type: 'PowerPanel', uuid: 'panel-component' }],
    children: [],
  };
  const tree = { uuid: 'scene', name: 'PrototypeScene', components: [], children: [panel] };
  const assetDb = { async queryUuid() { return 'row-prefab'; } };
  const scene = {
    async queryComponents() {
      return [
        { name: 'PowerPanel', cid: 'PowerPanel' },
        { name: 'PowerRoomRow', cid: 'PowerRoomRow' },
      ];
    },
    async queryNodeTree() { return tree; },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async createNode(options) {
      calls.push(['create', options]);
      const node = {
        uuid: `row-${panel.children.length + 1}`,
        name: options.name,
        components: [{ type: 'PowerRoomRow', uuid: `row-component-${panel.children.length + 1}` }],
        children: [],
      };
      panel.children.push(node);
      return node;
    },
    async setProperty(target, path, value, options) {
      calls.push(['set', target.uuid, path, value, options]);
      return true;
    },
    async executeComponentMethod(uuid, name, args) {
      calls.push(['execute', uuid, name, args]);
      return true;
    },
    async removeNode() {},
    async endRecording(id) { calls.push(['end', id]); },
    async cancelRecording(id) { calls.push(['cancel', id]); },
  };

  const result = await replacePowerRowsWithPrefab(assetDb, scene);

  assert.equal(result.ok, true);
  const creates = calls.filter((call) => call[0] === 'create');
  assert.equal(creates.length, 2);
  assert.equal('position' in creates[0][1], false);
  assert.deepEqual(
    calls.filter((call) => call[0] === 'execute').map((call) => [call[2], call[3]]),
    [
      ['applyAuthoringLocalPosition', [0, 12]],
      ['applyAuthoringLocalPosition', [0, -31]],
    ],
  );
  assert.equal(calls.some((call) => call[0] === 'end' && call[1] === 'undo'), true);
});
