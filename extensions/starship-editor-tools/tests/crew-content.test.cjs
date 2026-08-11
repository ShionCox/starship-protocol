const assert = require('node:assert/strict');
const test = require('node:test');

const { createCrewContent } = require('../dist/crew/create-crew-content.js');
const { updateCrewDefinition } = require('../dist/crew/edit-crew-definition.js');

function assetDb(options = {}) {
  const files = new Map();
  const calls = [];
  return {
    files,
    calls,
    async queryUuid(url) { calls.push(['queryUuid', url]); return url === 'db://assets/prefabs/CrewMember.prefab' ? 'template' : files.has(url) ? url : ''; },
    async createAsset(url, content) { calls.push(['createAsset', url]); files.set(url, content); return { url }; },
    async copyAsset(_source, target) {
      calls.push(['copyAsset', target]);
      if (options.copyThrows) throw new Error('模拟复制失败');
      if (options.copyReturnsNull) return null;
      files.set(target, 'prefab');
      return { url: target };
    },
    async deleteAsset(url) {
      calls.push(['deleteAsset', url]);
      if (options.deleteThrows === true || options.deleteThrows?.has?.(url)) throw new Error(`模拟清理失败：${url}`);
      files.delete(url);
      return { url };
    },
    async saveAsset(url, content) { files.set(url, content); return { url }; },
    async readFile(url) { return files.get(url); },
  };
}

const REQUEST = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5, prefabName: 'EngineerCrew', templateUrl: 'db://assets/prefabs/CrewMember.prefab', targetDirectory: 'db://assets/prefabs' };

test('船员创建表单写入版本化 JSON，职业保留英文稳定枚举', async () => {
  const db = assetDb();
  const result = await createCrewContent(REQUEST, db);
  assert.equal(result.ok, true);
  const document = JSON.parse(db.files.get('db://assets/config/crew/crew-engineer.json'));
  assert.deepEqual(document, { schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 });
});

test('未知职业、非整数生命或移动耗时在写入前失败', async () => {
  for (const request of [{ ...REQUEST, role: 'CAPTAIN' }, { ...REQUEST, maxHp: 2.5 }, { ...REQUEST, moveTicksPerEdge: 0 }]) {
    const db = assetDb();
    assert.equal((await createCrewContent(request, db)).ok, false);
    assert.equal(db.files.size, 0);
  }
});

test('Prefab 复制失败会独立清理 Prefab 和 JSON，全部成功才报告已回滚', async () => {
  const db = assetDb({ copyThrows: true });
  const result = await createCrewContent(REQUEST, db);
  assert.equal(result.ok, false);
  assert.deepEqual(db.calls.filter((call) => call[0] === 'deleteAsset').map((call) => call[1]), [
    'db://assets/prefabs/EngineerCrew.prefab',
    'db://assets/config/crew/crew-engineer.json',
  ]);
  assert.equal(db.files.size, 0);
  assert.match(result.message, /已回滚新资源/);
  assert.doesNotMatch(result.message, /资源清理未完成/);
});

test('多资源清理互不短路并报告具体残留路径，不虚报已回滚', async () => {
  const db = assetDb({
    copyReturnsNull: true,
    deleteThrows: new Set([
      'db://assets/prefabs/EngineerCrew.prefab',
      'db://assets/config/crew/crew-engineer.json',
    ]),
  });
  const result = await createCrewContent(REQUEST, db);
  assert.equal(result.ok, false);
  assert.deepEqual(db.calls.filter((call) => call[0] === 'deleteAsset').map((call) => call[1]), [
    'db://assets/prefabs/EngineerCrew.prefab',
    'db://assets/config/crew/crew-engineer.json',
  ]);
  assert.match(result.message, /db:\/\/assets\/prefabs\/EngineerCrew\.prefab：模拟清理失败/);
  assert.match(result.message, /db:\/\/assets\/config\/crew\/crew-engineer\.json：模拟清理失败/);
  assert.doesNotMatch(result.message, /已回滚新资源/);
});

test('创作入口绑定前置资源丢失时独立清理并显示清理错误', async () => {
  const previousEditor = global.Editor;
  const files = new Set();
  const calls = [];
  const failedUrl = 'db://assets/config/crew/crew-engineer.json';
  global.Editor = {
    Message: {
      async request(domain, message, ...args) {
        calls.push([domain, message, ...args]);
        if (domain !== 'asset-db') return true;
        if (message === 'query-uuid') {
          return args[0] === REQUEST.templateUrl ? 'template' : '';
        }
        if (message === 'create-asset') {
          files.add(args[0]);
          return { url: args[0] };
        }
        if (message === 'copy-asset') {
          files.add(args[1]);
          return { url: args[1] };
        }
        if (message === 'delete-asset') {
          if (args[0] === failedUrl) throw new Error('模拟入口清理失败');
          files.delete(args[0]);
          return { url: args[0] };
        }
        throw new Error(`未预期的 Asset DB 消息：${message}`);
      },
    },
  };

  try {
    delete require.cache[require.resolve('../dist/main.js')];
    const { methods } = require('../dist/main.js');
    const result = await methods.createCrewContent(REQUEST);
    assert.equal(result.ok, false);
    assert.deepEqual(calls.filter((call) => call[1] === 'delete-asset').map((call) => call[2]), [
      'db://assets/prefabs/EngineerCrew.prefab',
      failedUrl,
    ]);
    assert.match(result.message, /模拟入口清理失败/);
    assert.doesNotMatch(result.message, /已回滚新资源/);
    assert.deepEqual([...files], [failedUrl]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('编辑船员其他属性保存完整字段，非法职业不会写入', async () => {
  const db = assetDb();
  db.files.set('db://assets/config/crew/crew-engineer.json', JSON.stringify({ schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 }));
  const saved = await updateCrewDefinition({ configUrl: 'db://assets/config/crew/crew-engineer.json', id: 'crew-engineer', displayName: '高级工程师', role: 'ENGINEER', maxHp: 120, moveTicksPerEdge: 5 }, db);
  assert.equal(saved.ok, true);
  assert.equal(JSON.parse(db.files.get('db://assets/config/crew/crew-engineer.json')).role, 'ENGINEER');
  const before = db.files.get('db://assets/config/crew/crew-engineer.json');
  assert.equal((await updateCrewDefinition({ configUrl: 'db://assets/config/crew/crew-engineer.json', id: 'crew-engineer', displayName: '坏数据', role: 'CAPTAIN', maxHp: 100, moveTicksPerEdge: 5 }, db)).ok, false);
  assert.equal(db.files.get('db://assets/config/crew/crew-engineer.json'), before);
});
