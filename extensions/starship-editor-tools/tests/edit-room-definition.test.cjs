const assert = require('node:assert/strict');
const test = require('node:test');

const { updateRoomDefinition } = require('../dist/rooms/edit-room-definition.js');

function request(overrides = {}) {
  return {
    configUrl: 'db://assets/config/rooms/room-reactor.json',
    id: 'room-reactor',
    displayName: '反应堆改名',
    category: 'ENERGY',
    width: 3,
    height: 2,
    maxLevel: 4,
    maxHp: 250,
    minPower: 1,
    maxPower: 5,
    powerGeneration: 8,
    crewCapacity: 2,
    ...overrides,
  };
}

function fakeDb(options = {}) {
  const calls = [];
  return {
    calls,
    async readFile(url) {
      calls.push(['readFile', url]);
      if (options.readFails) throw new Error('模拟读取失败');
      return JSON.stringify({ schemaVersion: 1, id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 10, crewCapacity: 0 });
    },
    async saveAsset(url, content) {
      calls.push(['saveAsset', url, content]);
      if (options.saveFails) return null;
      return { url, uuid: 'config-uuid' };
    },
  };
}

test('属性编辑通过 Asset DB 保存完整版本化 JSON', async () => {
  const db = fakeDb();
  const result = await updateRoomDefinition(request(), db);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(db.calls[1][2]), {
    schemaVersion: 1, id: 'room-reactor', displayName: '反应堆改名', category: 'ENERGY', width: 3, height: 2,
    maxLevel: 4, maxHp: 250, minPower: 1, maxPower: 5, powerGeneration: 8, crewCapacity: 2,
  });
});

test('非法属性或越界路径在保存前拒绝', async () => {
  const db = fakeDb();
  assert.equal((await updateRoomDefinition(request({ width: 0 }), db)).ok, false);
  assert.equal((await updateRoomDefinition(request({ configUrl: 'db://assets/scenes/room-reactor.json' }), db)).ok, false);
  assert.equal(db.calls.some((call) => call[0] === 'saveAsset'), false);
});

test('编辑旧配置时缺失产能按 0 写回，已有产能不会丢失', async () => {
  const legacyDb = fakeDb();
  legacyDb.readFile = async (url) => { legacyDb.calls.push(['readFile', url]); return JSON.stringify({ schemaVersion: 1, id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, crewCapacity: 0 }); };
  const legacyResult = await updateRoomDefinition(request({ powerGeneration: undefined }), legacyDb);
  assert.equal(legacyResult.ok, true);
  assert.equal(JSON.parse(legacyDb.calls[1][2]).powerGeneration, 0);
  const currentDb = fakeDb();
  const currentResult = await updateRoomDefinition(request({ powerGeneration: undefined }), currentDb);
  assert.equal(currentResult.ok, true);
  assert.equal(JSON.parse(currentDb.calls[1][2]).powerGeneration, 10);
});

test('Asset DB 保存失败返回可观察错误', async () => {
  const result = await updateRoomDefinition(request(), fakeDb({ saveFails: true }));
  assert.equal(result.ok, false);
  assert.match(result.message, /保存房间定义失败/);
});
