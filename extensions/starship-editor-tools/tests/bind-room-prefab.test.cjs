const assert = require('node:assert/strict');
const test = require('node:test');

const { bindRoomDefinitionToOpenPrefab } = require('../dist/rooms/bind-room-prefab.js');

test('新 Prefab 自动绑定定义 JSON 并保存', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  let queryCount = 0;
  const scene = {
    async queryNodeTree() {
      queryCount += 1;
      return queryCount === 1
        ? { uuid: 'prefab-root', children: [] }
        : { uuid: 'prefab-root', components: [{ type: 'RoomView', value: 'room-view' }] };
    },
    async setProperty(...args) { calls.push(['set', ...args]); return true; },
    async validateRoomComponent() { return { ok: true, message: '有效' }; },
  };
  const result = await bindRoomDefinitionToOpenPrefab(scene, 'config-1', 'room-laser');
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'definitionAsset'), true);
  assert.equal(calls.some((call) => call[0] === 'scene' && call[1] === 'save-scene'), true);
  delete global.Editor;
});
