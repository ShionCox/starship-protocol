const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { bindRoomDefinitionToOpenPrefab } = require('../dist/rooms/bind-room-prefab.js');

function assetDb() {
  return {
    async queryUuid(url) { return `uuid:${url}`; },
    async readFile(url) {
      const file = url.replace('db://assets/', 'assets/');
      return fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    },
  };
}

test('新 Prefab 使用权威 CSV 内存 DTO 预览并保存代表性外观', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  const scene = {
    async queryNodeTree() {
      return { uuid: 'prefab-root', components: [
        { type: 'RoomView', value: 'room-view', nodeUuid: 'prefab-root', index: 0 },
      ] };
    },
    async setProperty(...args) { calls.push(['set', ...args]); return true; },
    async validateRoomComponent() { return { ok: true, message: '有效' }; },
    async executeComponentMethod() { return true; },
  };
  const result = await bindRoomDefinitionToOpenPrefab(scene, assetDb(), 'room-laser');
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[1].uuid === 'csv-source'), false);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'roomDefinitionId'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'configSource'), false);
  assert.equal(calls.some((call) => call[0] === 'scene' && call[1] === 'save-scene'), true);
  delete global.Editor;
});

test('医疗房间 Prefab 自动写入白绿表现默认值', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  const scene = {
    async queryNodeTree() {
      return { uuid: 'prefab-root', components: [
        { type: 'RoomView', value: 'room-view', nodeUuid: 'prefab-root', index: 0 },
      ] };
    },
    async setProperty(...args) { calls.push(['set', ...args]); return true; },
    async validateRoomComponent() { return { ok: true, message: '有效' }; },
    async executeComponentMethod() { return true; },
  };
  try {
    const result = await bindRoomDefinitionToOpenPrefab(scene, assetDb(), 'room-medbay', 1);
    assert.equal(result.ok, true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'fillColor' && call[3].value.g === 123), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'borderColor' && call[3].value.r === 218), true);
  } finally {
    delete global.Editor;
  }
});
