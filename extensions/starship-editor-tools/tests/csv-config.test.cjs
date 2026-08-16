const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CSV_CONFIG_TABLES,
  EDITOR_CSV_CONFIG_TABLES,
  EDITOR_PREFABS_TABLE,
  loadCsvConfigBundle,
  normalizeCsvForExcel,
  saveCsvConfigBundle,
  parseVisualDefinition,
  parseEditorPrefabCsv,
  validateEditorCsvConfigTables,
  validateCsvConfigTables,
} = require('../dist/csv/config-csv.js');

function loadTables() {
  return Object.fromEntries(EDITOR_CSV_CONFIG_TABLES.map((name) => [name, readFileSync(path.join(__dirname, '../../../assets/config/csv', name), 'utf8')]));
}

function port(seed = loadTables()) {
  const values = new Map(Object.entries(seed).map(([name, value]) => [`db://assets/config/csv/${name}`, value]));
  const calls = [];
  return {
    calls, values,
    async readFile(url) { calls.push(['read', url]); if (!values.has(url)) throw new Error('missing'); return values.get(url); },
    async saveAsset(url, content) { calls.push(['save', url]); values.set(url, content); return { url }; },
    async reimportAsset(url) { calls.push(['reimport', url]); },
  };
}

test('配置 CSV 严格校验表头、中文第二列和跨表引用', () => {
  const tables = loadTables();
  assert.deepEqual(CSV_CONFIG_TABLES, ['game.csv', 'hulls.csv', 'rooms.csv', 'connector-ports.csv', 'floors.csv', 'crews.csv', 'crew-traits.csv', 'visuals.csv', 'visual-frames.csv']);
  assert.doesNotThrow(() => validateCsvConfigTables(tables));
  assert.throws(() => validateCsvConfigTables({ ...tables, 'hulls.csv': tables['hulls.csv'].replace('visual-hull-starter', 'visual-missing') }), /引用未知视觉/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'hulls.csv': tables['hulls.csv'].replace('visual-hull-starter', 'visual-pss-room-elevator-83') }), /视觉类型必须是 HULL/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'floors.csv': tables['floors.csv'].replace('id,displayName', 'displayName,id') }), /表头必须严格/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'crews.csv': tables['crews.csv'].replace('trait-construction-slot-1', 'trait-missing') }), /引用未知词条/);
});

test('四类定义只能绑定对应 kind 的视觉，且 FLOOR 视觉必须存在', () => {
  const tables = loadTables();
  assert.doesNotThrow(() => validateCsvConfigTables(tables));
  assert.throws(() => validateCsvConfigTables({ ...tables, 'floors.csv': tables['floors.csv'].replace('visual-floor-basic', 'visual-missing') }), /引用未知视觉/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'floors.csv': tables['floors.csv'].replace('visual-floor-basic', 'visual-hull-starter') }), /视觉类型必须是 FLOOR/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'rooms.csv': tables['rooms.csv'].replace('visual-pss-room-elevator-83', 'visual-floor-basic') }), /视觉类型必须是 ROOM/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'crews.csv': tables['crews.csv'].replace('appearance-pss-engineer-bob-8', 'visual-hull-starter') }), /视觉类型必须是 CREW/);
});

test('全量保存先校验全部配置，再按 save→reimport 写入 BOM/CRLF', async () => {
  const assetDb = port();
  const original = loadTables();
  const content = original['game.csv'].replace('1000', '1200');
  const result = await saveCsvConfigBundle(assetDb, { ...original, 'game.csv': content });
  assert.equal(result.ok, true);
  assert.equal(assetDb.calls.filter((entry) => entry[0] === 'save').length, EDITOR_CSV_CONFIG_TABLES.length);
  assert.equal(assetDb.calls.filter((entry) => entry[0] === 'reimport').length, EDITOR_CSV_CONFIG_TABLES.length);
  assert.match(assetDb.values.get('db://assets/config/csv/game.csv'), /^\uFEFF/);
  assert.match(assetDb.values.get('db://assets/config/csv/game.csv'), /\r\n/);
  assert.match(normalizeCsvForExcel('id,displayName,value\na,"中文,名称",1\n'), /"中文,名称"/);
});

test('整批保存中途失败时逆序恢复已经写入的原内容', async () => {
  const original = loadTables();
  const assetDb = port(original);
  let failed = false;
  const realSave = assetDb.saveAsset;
  assetDb.saveAsset = async (url, content) => {
    if (!failed && url.endsWith('/rooms.csv')) { failed = true; throw new Error('write failed'); }
    return await realSave.call(assetDb, url, content);
  };
  const changed = Object.fromEntries(EDITOR_CSV_CONFIG_TABLES.map((name) => [name, original[name].replace('1000', '1001')]));
  const result = await saveCsvConfigBundle(assetDb, changed);
  assert.equal(result.ok, false);
  assert.match(result.message, /已恢复原配置/);
  assert.equal(assetDb.values.get('db://assets/config/csv/game.csv'), original['game.csv']);
});

test('读取九张运行时 CSV 与一张编辑器映射表后返回完整 bundle', async () => {
  const result = await loadCsvConfigBundle(port());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(Object.keys(result.bundle.tables).length, 10);
    assert.ok(result.bundle.tables[EDITOR_PREFABS_TABLE].includes('definitionKind'));
  }
});

test('编辑器 Prefab 映射严格校验定义引用和 Asset DB 路径', () => {
  const tables = loadTables();
  assert.equal(parseEditorPrefabCsv(tables[EDITOR_PREFABS_TABLE]).length, 13);
  assert.doesNotThrow(() => validateEditorCsvConfigTables(tables));
  assert.throws(
    () => validateEditorCsvConfigTables({ ...tables, [EDITOR_PREFABS_TABLE]: tables[EDITOR_PREFABS_TABLE].replace('room-reactor,db://assets/prefabs/ReactorRoom.prefab', 'room-missing,db://outside/ReactorRoom.prefab') }),
    /引用未知定义|安全 Prefab 路径/,
  );
});

test('编辑器 Prefab 映射必须覆盖四类全部定义且不能有孤立行', () => {
  const tables = loadTables();
  const withoutFloor = tables[EDITOR_PREFABS_TABLE]
    .replace(/editor-prefab-floor-basic,基础地板,FLOOR,floor-basic,db:\/\/assets\/prefabs\/FloorTile\.prefab\r?\n/, '');
  assert.throws(() => validateEditorCsvConfigTables({ ...tables, [EDITOR_PREFABS_TABLE]: withoutFloor }), /缺少 Prefab 定义映射：FLOOR:floor-basic/);
  const orphan = `${tables[EDITOR_PREFABS_TABLE]}editor-prefab-orphan,孤立映射,FLOOR,floor-missing,db://assets/prefabs/FloorTile.prefab\r\n`;
  assert.throws(() => validateEditorCsvConfigTables({ ...tables, [EDITOR_PREFABS_TABLE]: orphan }), /引用未知定义/);
});

test('hulls.csv 的 cellMask 使用声明尺寸和 V/B/W 严格校验', () => {
  const tables = loadTables();
  assert.doesNotThrow(() => validateCsvConfigTables(tables));
  assert.throws(() => validateCsvConfigTables({ ...tables, 'hulls.csv': tables['hulls.csv'].replace('/WBBBBBBBBBBBBBBBBBBW/', '/WBBBBBBBBBBBBBBBBBBX/') }), /cellMask/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'hulls.csv': tables['hulls.csv'].replace('20,10,WWWW', '20,10,WWWW/') }), /cellMask/);
});

test('视觉绑定读取复用严格 RFC4180 parser，不接受逗号列错位', () => {
  const tables = loadTables();
  const visual = parseVisualDefinition(tables['visuals.csv'], tables['visual-frames.csv'], 'visual-pss-room-reactor-808', 'ROOM');
  assert.equal(visual.frames.length, 5);
  assert.equal(visual.displayScalePermille, 1000);
  assert.equal(visual.gridOffsetX, 0);
  assert.equal(visual.gridOffsetY, 0);
  assert.throws(() => parseVisualDefinition(tables['visuals.csv'].replace('反应堆房间', '反应堆,房间'), tables['visual-frames.csv'], 'visual-pss-room-reactor-808', 'ROOM'), /列数|视觉/);
});

test('视觉几何字段严格校验缩放范围与整数网格偏移', () => {
  const tables = loadTables();
  const valid = tables['visuals.csv'].replace(/(visual-pss-room-reactor-808,[^\r\n]*),1000,0,0/, '$1,250,-3,4');
  const visual = parseVisualDefinition(valid, tables['visual-frames.csv'], 'visual-pss-room-reactor-808', 'ROOM');
  assert.equal(visual.displayScalePermille, 250);
  assert.equal(visual.gridOffsetX, -3);
  assert.equal(visual.gridOffsetY, 4);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'visuals.csv': tables['visuals.csv'].replace(',1000,0,0', ',0,0,0') }), /displayScalePermille/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'visuals.csv': tables['visuals.csv'].replace(',1000,0,0', ',10001,0,0') }), /displayScalePermille/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'visuals.csv': tables['visuals.csv'].replace(',1000,0,0', ',1000,1.5,0') }), /gridOffsetX/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'visuals.csv': tables['visuals.csv'].replace(',1000,0,0', ',1000,0,-2.5') }), /gridOffsetY/);
  assert.throws(() => validateCsvConfigTables({ ...tables, 'visuals.csv': tables['visuals.csv'].replace(',1000,0,0', ',1000,,0') }), /gridOffsetX/);
});
