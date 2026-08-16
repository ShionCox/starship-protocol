const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AssetSaveError,
  editorAssetDb,
  openEditorAsset,
  noteAuthoringAssetOperation,
  retryTransientAssetOperation,
  saveAssetAndRefresh,
  waitForImportedAsset,
  waitForAuthoringAssetReady,
  waitForAuthoringQuiet,
} = require('../dist/shared/editor-asset-db.js');

function port(log, options = {}) {
  return {
    async saveAsset(url, content) {
      log.push(['save-asset', url, content]);
      if (options.saveError) throw new Error('disk unavailable');
      if (options.saveNull) return null;
      return { url, uuid: 'asset-1' };
    },
    async reimportAsset(url) {
      log.push(['reimport-asset', url]);
      if (options.reimportError) throw new Error('import failed');
    },
  };
}

test('保存资源后按 save-asset -> reimport-asset -> 当前组件刷新顺序执行，且不保存场景', async () => {
  const log = [];
  const result = await saveAssetAndRefresh(
    port(log),
    'db://assets/config/csv/rooms.csv',
    'id,displayName\n#稳定标识,中文名称\n',
    async () => { log.push(['component-refresh']); },
  );
  assert.equal(result.uuid, 'asset-1');
  assert.deepEqual(log, [
    ['save-asset', 'db://assets/config/csv/rooms.csv', 'id,displayName\n#稳定标识,中文名称\n'],
    ['reimport-asset', 'db://assets/config/csv/rooms.csv'],
    ['component-refresh'],
  ]);
  assert.equal(log.some(([name]) => name === 'save-scene'), false);
});

test('保存失败、重新导入失败、组件刷新失败分别保留错误阶段', async () => {
  await assert.rejects(
    () => saveAssetAndRefresh(port([], { saveError: true }), 'db://x', '{}', async () => {}),
    (error) => error instanceof AssetSaveError && error.stage === 'save' && /保存资源失败/.test(error.message),
  );
  await assert.rejects(
    () => saveAssetAndRefresh(port([], { reimportError: true }), 'db://x', '{}', async () => {}),
    (error) => error instanceof AssetSaveError && error.stage === 'reimport' && /重新导入失败/.test(error.message),
  );
  await assert.rejects(
    () => saveAssetAndRefresh(port([]), 'db://x', '{}', async () => { throw new Error('component missing'); }),
    (error) => error instanceof AssetSaveError && error.stage === 'refresh' && /当前编辑上下文刷新失败/.test(error.message),
  );
});

test('资源保存返回空值时在 save 阶段失败，不触发后续刷新', async () => {
  const log = [];
  await assert.rejects(
    () => saveAssetAndRefresh(port(log, { saveNull: true }), 'db://x', '{}', async () => { log.push(['component-refresh']); }),
    (error) => error instanceof AssetSaveError && error.stage === 'save',
  );
  assert.deepEqual(log, [['save-asset', 'db://x', '{}']]);
});

test('无 reimport 能力的测试端口仍只执行一次组件刷新', async () => {
  const log = [];
  await saveAssetAndRefresh({
    async saveAsset(url) { log.push(['save-asset', url]); return { url }; },
  }, 'db://x', '{}', async () => { log.push(['component-refresh']); });
  assert.deepEqual(log, [['save-asset', 'db://x'], ['component-refresh']]);
});

test('资源切换只重试 Creator 瞬态占用错误', async () => {
  let attempts = 0;
  const result = await retryTransientAssetOperation(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('UNKNOWN: unknown error, open LaserRoom.prefab');
    return 'ready';
  }, { attempts: 3, delayMs: 0 });
  assert.equal(result, 'ready');
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(
    () => retryTransientAssetOperation(async () => {
      attempts += 1;
      throw new Error('invalid asset url');
    }, { attempts: 3, delayMs: 0 }),
    /invalid asset url/,
  );
  assert.equal(attempts, 1);
});

test('Creator 打开资源先把 db URL 解析为 UUID', async () => {
  const previousEditor = global.Editor;
  const calls = [];
  global.Editor = {
    Message: { async request(domain, message, value) {
      calls.push([domain, message, value]);
      if (message === 'query-uuid') return 'asset-uuid';
      if (message === 'open-asset') return undefined;
      throw new Error(`unexpected message ${message}`);
    } },
  };
  try {
    await openEditorAsset('db://assets/prefabs/LaserRoom.prefab');
    assert.deepEqual(calls, [
      ['asset-db', 'query-uuid', 'db://assets/prefabs/LaserRoom.prefab'],
      ['asset-db', 'open-asset', 'asset-uuid'],
    ]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('空资源标识不会发送 query-asset-info 参数错误', async () => {
  const previousEditor = global.Editor;
  let requests = 0;
  global.Editor = { Message: { async request() { requests += 1; throw new Error('unexpected request'); } } };
  try {
    assert.equal(await editorAssetDb.queryInfo(''), null);
    assert.equal(requests, 0);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('Prefab 保存后只等待自动导入完成，不触发第二次 reimport', async () => {
  let reads = 0;
  let reimports = 0;
  const assetDb = {
    async queryInfo(url) {
      reads += 1;
      return { uuid: 'prefab-1', url, imported: reads >= 3, invalid: false };
    },
    async reimportAsset() { reimports += 1; },
  };
  await waitForImportedAsset(assetDb, 'db://assets/prefabs/MedicCrew.prefab', { attempts: 3, delayMs: 0 });
  assert.equal(reads, 3);
  assert.equal(reimports, 0);
});

test('复制 Prefab 后等待 Asset DB 导入完成再允许后续 UUID 查询', async () => {
  const previousEditor = global.Editor;
  let infoReads = 0;
  const calls = [];
  global.Editor = {
    Message: {
      async request(domain, message, ...args) {
        calls.push([domain, message, ...args]);
        assert.equal(domain, 'asset-db');
        if (message === 'copy-asset') return { uuid: 'build-option-card-uuid', url: args[1] };
        if (message === 'query-asset-info') {
          infoReads += 1;
          return { uuid: 'build-option-card-uuid', url: args[0], imported: infoReads >= 3, invalid: false };
        }
        throw new Error(`unexpected message ${message}`);
      },
    },
  };
  try {
    const result = await editorAssetDb.copyAsset(
      'db://assets/prefabs/BlankNodeTemplate.prefab',
      'db://assets/ui/prefabs/BuildOptionCard.prefab',
    );
    assert.equal(result?.uuid, 'build-option-card-uuid');
    assert.equal(infoReads, 3);
    assert.deepEqual(calls.map(([, message]) => message), ['copy-asset', 'query-asset-info', 'query-asset-info', 'query-asset-info']);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('资源安全屏障对热缓存零等待，并轮询未导入资源与立即拒绝 invalid', async () => {
  const base = Date.now() + 1_000;
  noteAuthoringAssetOperation('db://ready', base);
  const sleeps = [];
  await waitForAuthoringAssetReady(
    { async queryInfo(url) { return { uuid: 'ready', url, imported: true, invalid: false }; } },
    'db://ready',
    { now: () => base + 1_000, sleep: async (delay) => { sleeps.push(delay); } },
  );
  assert.deepEqual(sleeps, []);

  let reads = 0;
  await waitForAuthoringAssetReady(
    { async queryInfo(url) { reads += 1; return { uuid: 'poll', url, imported: reads >= 3, invalid: false }; } },
    'db://poll',
    { quietMs: 0, delayMs: 100, now: () => base + 1_000, sleep: async (delay) => { sleeps.push(delay); } },
  );
  assert.equal(reads, 3);
  assert.deepEqual(sleeps, [100, 100]);
  await assert.rejects(
    waitForAuthoringAssetReady(
      { async queryInfo(url) { return { uuid: 'bad', url, imported: false, invalid: true }; } },
      'db://bad',
      { sleep: async () => {} },
    ),
    /导入资源失败/,
  );
});

test('650ms 静默窗口只等待连续资源操作后的剩余时间', async () => {
  const base = Date.now() + 2_000;
  noteAuthoringAssetOperation('db://quiet', base);
  const sleeps = [];
  await waitForAuthoringQuiet({ now: () => base + 250, sleep: async (delay) => { sleeps.push(delay); } });
  assert.deepEqual(sleeps, [400]);
});

test('Asset DB 启动索引未就绪时等待官方绝对 file 路径', async () => {
  const previousEditor = global.Editor;
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'p83-asset-'));
  const tempFile = path.join(tempDirectory, 'game.csv');
  await fs.writeFile(tempFile, 'game-csv');
  let infoReads = 0;
  global.Editor = {
    Message: { async request(domain, message) {
      assert.equal(domain, 'asset-db');
      if (message === 'query-asset-info') {
        infoReads += 1;
        return infoReads === 1 ? null : { uuid: 'csv-1', url: 'db://assets/config/csv/game.csv', file: tempFile };
      }
      if (message === 'query-path') return null;
      throw new Error(`unexpected message ${message}`);
    } },
  };
  try {
    assert.equal(await editorAssetDb.readFile('db://assets/config/csv/game.csv'), 'game-csv');
    assert.equal(infoReads, 2);
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('当前 Scene 只刷新匹配定义并在位置变化后创建一次快照，不保存场景', async () => {
  const calls = [];
  let treeReads = 0;
  const previousEditor = global.Editor;
  global.Editor = {
    Selection: { getSelected() { return []; } },
    Message: {
      async request(domain, message, value) {
        calls.push([domain, message]);
        assert.equal(domain, 'scene');
        if (message === 'query-components') return [];
        if (message === 'query-node-tree') {
          treeReads += 1;
          return {
            uuid: 'scene',
            name: 'MainScene',
            children: [{
              uuid: 'room-node',
              name: '房间-反应堆',
              position: treeReads > 1 ? { x: 24, y: 0, z: 0 } : { x: 0, y: 0, z: 0 },
              components: [{ type: 'RoomView', value: 'room-component' }],
              children: [],
            }, {
              uuid: 'other-room-node',
              name: '房间-旧布局',
              position: { x: 96, y: 0, z: 0 },
              components: [{ type: 'RoomView', value: 'other-room-component' }],
              children: [],
            }],
          };
        }
        if (message === 'execute-component-method') {
          const options = value;
          if (options.name === 'getAuthoringInspectorState') {
            return options.uuid === 'other-room-component'
              ? { roomDefinitionId: 'room-old', roomInstanceId: 'room-old-1' }
              : { roomDefinitionId: 'room-reactor', roomInstanceId: 'room-reactor-1' };
          }
          if (options.name === 'applyAuthoringDefinitionPreview') return true;
          if (options.name === 'refreshAuthoringLayoutPreview') return options.uuid !== 'other-room-component';
          throw new Error(`unexpected method ${options.name}`);
        }
        if (message === 'snapshot') return undefined;
        if (message === 'save-scene') throw new Error('save-scene must not be called');
        throw new Error(`unexpected scene message ${message}`);
      },
    },
  };
  try {
    delete require.cache[require.resolve('../dist/main.js')];
    const { refreshCurrentAuthoringContext } = require('../dist/main.js');
    const result = await refreshCurrentAuthoringContext('room', 'room-reactor', { schemaVersion: 2, id: 'room-reactor', width: 3, height: 2 });
    assert.equal(result.matched, 1);
    assert.equal(result.moved, 1);
    assert.equal(calls.filter(([, message]) => message === 'snapshot').length, 0);
    assert.equal(calls.some(([, message]) => message === 'save-scene'), false);

    // Asset DB 广播可能重复到达；同一上下文和同一文档不应再次执行组件刷新。
    const callCountAfterFirst = calls.length;
    const duplicate = await refreshCurrentAuthoringContext('room', 'room-reactor', { schemaVersion: 2, id: 'room-reactor', width: 3, height: 2 });
    assert.deepEqual(duplicate, { matched: 0, moved: 0, invalid: [] });
    assert.deepEqual(calls.slice(callCountAfterFirst), [['scene', 'query-node-tree']]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});
