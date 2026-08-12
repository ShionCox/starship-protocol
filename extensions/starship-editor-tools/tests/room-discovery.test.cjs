const assert = require('node:assert/strict');
const test = require('node:test');

const { discoverRoomPrefabs, parseRoomDefinition } = require('../dist/rooms/discover-room-prefabs.js');

function fakeDb() {
  const configs = [
    { uuid: 'config-laser', url: 'db://assets/config/rooms/room-laser.json', isDirectory: false },
    { uuid: 'config-bad', url: 'db://assets/config/rooms/room-bad.json', isDirectory: false },
  ];
  const prefabs = [
    { uuid: 'prefab-laser', url: 'db://assets/prefabs/LaserRoom.prefab', isDirectory: false },
    { uuid: 'prefab-bad', url: 'db://assets/prefabs/BadRoom.prefab', isDirectory: false },
  ];
  return {
    async queryAssets(options) {
      if (options === undefined) return [...configs, ...prefabs];
      return options.extname === '.json' ? configs : prefabs;
    },
    async queryUuid(url) { return url.endsWith('RoomView.ts') ? 'room-view-script' : ''; },
    async queryInfo() { return null; },
    async readFile(uuid) {
      if (uuid === 'config-laser') return JSON.stringify({ schemaVersion: 1, id: 'room-laser', displayName: '激光室', category: 'WEAPON', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 3, crewCapacity: 1 });
      return JSON.stringify({ schemaVersion: 99, id: 'room-bad' });
    },
    async queryDependencies(uuid) {
      return uuid === 'prefab-laser' ? ['room-view-script', 'config-laser'] : ['room-view-script', 'config-bad'];
    },
  };
}

test('自动发现只返回有效 RoomView Prefab 与房间定义绑定', async () => {
  const result = await discoverRoomPrefabs(fakeDb());
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, 'room-laser');
  assert.equal(result.entries[0].prefabUuid, 'prefab-laser');
  assert.equal(result.warnings.length, 1);
});

test('自动发现通过公开全量查询后按资源 URL 过滤', async () => {
  const db = fakeDb();
  const calls = [];
  const originalQueryAssets = db.queryAssets;
  db.queryAssets = async (options) => {
    calls.push(options);
    return originalQueryAssets(options);
  };
  const result = await discoverRoomPrefabs(db);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(calls, [undefined]);
});

test('编辑器边界解析拒绝未知版本和非法 ID', () => {
  assert.equal(parseRoomDefinition({ schemaVersion: 99 }), null);
  assert.equal(parseRoomDefinition({ schemaVersion: 1, id: 'Laser Room', displayName: '激光室', category: 'WEAPON', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 3, crewCapacity: 1 }), null);
});

test('无法定位 RoomView 脚本时自动发现 fail closed', async () => {
  const db = fakeDb();
  const originalQueryAssets = db.queryAssets;
  db.queryUuid = async () => '';
  db.queryInfo = async () => null;
  db.queryAssets = async (options) => options?.extname === '.ts'
    ? []
    : originalQueryAssets(options);
  const result = await discoverRoomPrefabs(db);
  assert.equal(result.entries.length, 0);
  assert.match(result.warnings[0], /无法定位 RoomView/);
});

test('query-uuid 与 query-info 都为空时不扫描整个项目猜测脚本', async () => {
  const db = fakeDb();
  db.queryUuid = async () => '';
  const originalQueryAssets = db.queryAssets;
  db.queryAssets = async (options) => options?.extname === '.ts'
    ? [{ uuid: 'room-view-script', url: 'db://assets/scripts/presentation/RoomView.ts', isDirectory: false }]
    : originalQueryAssets(options);
  const result = await discoverRoomPrefabs(db);
  assert.equal(result.entries.length, 0);
  assert.match(result.warnings[0], /无法定位 RoomView/);
});

test('query-uuid 为空时优先使用公开 Asset DB 资源信息', async () => {
  const db = fakeDb();
  db.queryUuid = async () => '';
  db.queryInfo = async () => ({ uuid: 'room-view-script', url: 'db://assets/scripts/presentation/RoomView.ts' });
  const result = await discoverRoomPrefabs(db);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].id, 'room-laser');
});
