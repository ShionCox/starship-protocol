const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createRoomContent,
} = require('../dist/rooms/create-room-content.js');

function validRequest(overrides = {}) {
  return {
    id: 'room-laser',
    displayName: '激光室',
    category: 'WEAPON',
    width: 2,
    height: 2,
    maxLevel: 1,
    maxHp: 100,
    minPower: 0,
    maxPower: 2,
    powerGeneration: 0,
    crewCapacity: 2,
    prefabName: 'LaserRoom',
    templateUrl: 'db://assets/prefabs/ReactorRoom.prefab',
    targetDirectory: 'db://assets/prefabs',
    ...overrides,
  };
}

function fakeAssetDb(options = {}) {
  const existing = new Set(options.existing ?? ['db://assets/prefabs/ReactorRoom.prefab']);
  const calls = [];
  return {
    calls,
    async queryUuid(url) {
      calls.push(['queryUuid', url]);
      return existing.has(url) ? `uuid:${url}` : '';
    },
    async createAsset(url, content) {
      calls.push(['createAsset', url, content]);
      if (options.createFails) return null;
      existing.add(url);
      return { uuid: `uuid:${url}`, url };
    },
    async copyAsset(sourceUrl, targetUrl) {
      calls.push(['copyAsset', sourceUrl, targetUrl]);
      if (options.copyThrows) throw new Error('模拟复制失败');
      existing.add(targetUrl);
      return { uuid: `uuid:${targetUrl}`, url: targetUrl };
    },
    async deleteAsset(url) {
      calls.push(['deleteAsset', url]);
      if (options.deleteThrows) throw new Error('模拟回滚失败');
      existing.delete(url);
      return { url };
    },
  };
}

test('合法请求创建 JSON 后复制 Prefab，且 JSON 使用版本化规则字段', async () => {
  const db = fakeAssetDb();
  const result = await createRoomContent(validRequest(), db);
  assert.equal(result.ok, true);
  assert.deepEqual(db.calls.map((call) => call[0]), [
    'queryUuid',
    'queryUuid',
    'queryUuid',
    'createAsset',
    'copyAsset',
  ]);
  const document = JSON.parse(db.calls.find((call) => call[0] === 'createAsset')[2]);
  assert.deepEqual(document, {
    schemaVersion: 1,
    id: 'room-laser',
    displayName: '激光室',
    category: 'WEAPON',
    width: 2,
    height: 2,
    maxLevel: 1,
    maxHp: 100,
    minPower: 0,
    maxPower: 2,
    powerGeneration: 0,
    crewCapacity: 2,
  });
});

test('新建表单把分类显示为中文但继续提交稳定英文值', () => {
  let panelDefinition;
  global.Editor = { Panel: { define(value) { panelDefinition = value; return value; } } };
  delete require.cache[require.resolve('../dist/panels/room-create.js')];
  require('../dist/panels/room-create.js');
  assert.match(panelDefinition.template, /<option value="ENERGY">能源<\/option>/);
  assert.match(panelDefinition.template, /<option value="WEAPON">武器<\/option>/);
  delete global.Editor;
});

test('非法路径和名称在任何 Asset DB 写入前失败', async () => {
  for (const request of [
    validRequest({ id: 'Laser Room' }),
    validRequest({ prefabName: '../LaserRoom' }),
    validRequest({ targetDirectory: 'db://assets/scenes' }),
    validRequest({ templateUrl: 'db://assets/scenes/Test.prefab' }),
  ]) {
    const db = fakeAssetDb();
    const result = await createRoomContent(request, db);
    assert.equal(result.ok, false);
    assert.equal(db.calls.length, 0);
  }
});

test('能源产能必须是非负整数，非能源房间不能发电', async () => {
  for (const request of [
    validRequest({ powerGeneration: -1 }),
    validRequest({ powerGeneration: 1.5 }),
    validRequest({ category: 'WEAPON', powerGeneration: 1 }),
  ]) {
    const db = fakeAssetDb();
    const result = await createRoomContent(request, db);
    assert.equal(result.ok, false);
    assert.equal(db.calls.length, 0);
  }
});

test('已有定义或 Prefab 时拒绝覆盖', async () => {
  const db = fakeAssetDb({
    existing: [
      'db://assets/prefabs/ReactorRoom.prefab',
      'db://assets/config/rooms/room-laser.json',
    ],
  });
  const result = await createRoomContent(validRequest(), db);
  assert.equal(result.ok, false);
  assert.match(result.message, /已存在/);
  assert.equal(db.calls.some((call) => call[0] === 'createAsset'), false);
});

test('Prefab 复制失败会删除刚创建的 JSON', async () => {
  const db = fakeAssetDb({ copyThrows: true });
  const result = await createRoomContent(validRequest(), db);
  assert.equal(result.ok, false);
  assert.match(result.message, /模拟复制失败/);
  assert.equal(db.calls.some((call) => call[0] === 'deleteAsset'), true);
});

test('回滚失败会保留可观察错误', async () => {
  const db = fakeAssetDb({ copyThrows: true, deleteThrows: true });
  const result = await createRoomContent(validRequest(), db);
  assert.equal(result.ok, false);
  assert.match(result.message, /模拟复制失败/);
  assert.match(result.message, /模拟回滚失败/);
});
