const assert = require('node:assert/strict');
const test = require('node:test');

const { createHullDocument, parseHullDefinition, validateHullDefinition } = require('../dist/hulls/hull-definition.js');
const { createHullDefinition, updateHullDefinition } = require('../dist/hulls/hull-catalog.js');

const input = { id: 'hull-starter', displayName: '初始护卫舰', level: 1, gridWidth: 3, gridHeight: 2, validCells: [0, 1, 0, 1, 1, 1], maxCrew: 4, maxRooms: 3, visualId: 'visual-starter' };

test('船体创建、发现和编辑共用同一 Mask 校验规则', () => {
  assert.equal(validateHullDefinition(input), null);
  assert.deepEqual(parseHullDefinition(createHullDocument(input)), createHullDocument(input));
  assert.match(validateHullDefinition({ ...input, validCells: [1] }), /长度为 6/);
  assert.match(validateHullDefinition({ ...input, visualId: '中文' }), /外观标识/);
});

test('船体定义只通过 Asset DB 创建和保存版本化 JSON', async () => {
  const writes = [];
  const assetDb = {
    async queryUuid() { return ''; },
    async createAsset(url, content) { writes.push(['create', url, JSON.parse(content)]); return { url }; },
    async saveAsset(url, content) { writes.push(['save', url, JSON.parse(content)]); return { url }; },
  };
  const created = await createHullDefinition(input, assetDb);
  assert.equal(created.ok, true);
  assert.equal(writes[0][2].schemaVersion, 1);
  const updated = await updateHullDefinition({ ...input, displayName: '新名称', configUrl: 'db://assets/config/hulls/hull-starter.json' }, assetDb);
  assert.equal(updated.ok, true);
  assert.equal(writes[1][2].displayName, '新名称');
});
