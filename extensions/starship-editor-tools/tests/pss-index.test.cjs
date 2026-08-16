const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildPssIndex, searchPssAssets } = require('../dist/pss/pss-index.js');

test('PSS 全库 JSON 索引只输出白名单条目并支持稳定分页', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starship-pss-'));
  await fs.mkdir(path.join(root, 'data'));
  const room = { data: { 5: { id: 5, name: '小型电力室 Lv1', description: '能源', construction_sprite: { source: 502, width: 75, height: 50 } } } };
  const crew = { data: { 8: { id: 8, name: '工程师 鲍勃', body_sprite: { source: 190, width: 18, height: 7 } } } };
  await fs.writeFile(path.join(root, 'data', 'CN_rooms.json'), JSON.stringify(room));
  await fs.writeFile(path.join(root, 'data', 'CN_crews.json'), JSON.stringify(crew));
  await fs.writeFile(path.join(root, 'data', '_sprite_mapping.json'), JSON.stringify({ '190': { cats: ['crew'], names: ['工程师别名'] } }));
  const index = await buildPssIndex(root);
  assert.ok(index.entries.some((entry) => entry.assetId === 'room:cn:5'));
  assert.ok(index.entries.some((entry) => entry.assetId === 'crew:cn:8'));
  assert.equal(index.entries.find((entry) => entry.assetId === 'room:cn:5').sourceSprite.path, 'sorted/room/502.png');
  const page = searchPssAssets(index, { query: '工程师', pageSize: 1 });
  assert.equal(page.total, 1);
  assert.equal(page.entries[0].sourceId, '8');
  assert.deepEqual(page.entries[0].aliases, ['工程师别名']);
  assert.equal(page.page, 1);
});

test('缺失 PSS 数据文件只产生中文 warning，不伪造条目', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starship-pss-empty-'));
  const index = await buildPssIndex(root);
  assert.equal(index.entries.length, 0);
  assert.ok(index.warnings.length > 0);
  assert.match(index.warnings[0], /无法读取 PSS (数据文件|素材别名映射)/);
});
