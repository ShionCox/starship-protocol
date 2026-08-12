const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createFoundationPrefabs,
  isAuthoringMethodSuccess,
} = require('../dist/scene/foundation-prefab-authoring.js');

test('Creator 场景方法的空成功返回不会被误判为结构刷新失败', () => {
  assert.equal(isAuthoringMethodSuccess(undefined), true);
  assert.equal(isAuthoringMethodSuccess(null), true);
  assert.equal(isAuthoringMethodSuccess(true), true);
  assert.equal(isAuthoringMethodSuccess({ ok: true }), true);
  assert.equal(isAuthoringMethodSuccess(false), false);
  assert.equal(isAuthoringMethodSuccess({ ok: false }), false);
});

function foundationRollbackFixture(options = {}) {
  const existing = new Set();
  const calls = [];
  let copyCount = 0;
  let roomViewVisible = false;
  const deleteFailures = options.deleteFailures ?? new Set();
  const scene = {
    openPrefab() { roomViewVisible = true; },
    calls,
    async queryNodeTree() {
      return {
        uuid: 'prefab-root',
        name: 'PrefabRoot',
        children: roomViewVisible
          ? [{ uuid: 'room-node', name: '房间', components: [{ type: 'RoomView', uuid: 'room-view', nodeUuid: 'room-node', index: 0 }], children: [] }]
          : [],
      };
    },
    async executeComponentMethod(_uuid, name) {
      calls.push(['executeComponentMethod', name]);
      if (name === 'removeForAuthoringTemplateConversion') roomViewVisible = false;
      return undefined;
    },
  };
  const editor = {
    Message: {
      async request(domain, message, ...args) {
        calls.push([domain, message, ...args]);
        if (domain === 'asset-db' && message === 'open-asset') scene.openPrefab();
        return true;
      },
    },
  };
  const assetDb = {
    calls,
    async queryUuid(url) {
      calls.push(['queryUuid', url]);
      return existing.has(url) ? `uuid:${url}` : '';
    },
    async copyAsset(sourceUrl, targetUrl) {
      calls.push(['copyAsset', sourceUrl, targetUrl]);
      copyCount += 1;
      if (copyCount === options.failCopyAt) return null;
      existing.add(targetUrl);
      return { uuid: `uuid:${targetUrl}`, url: targetUrl };
    },
    async deleteAsset(url) {
      calls.push(['deleteAsset', url]);
      if (deleteFailures.has(url)) throw new Error(`模拟删除失败：${url}`);
      existing.delete(url);
      return { uuid: `uuid:${url}`, url };
    },
  };
  return { assetDb, scene, editor, calls };
}

test('Foundation Prefab 创建失败会按逆序清理新资源并显示每个删除错误，不虚报已回滚', async () => {
  const previousEditor = global.Editor;
  const failedCreateUrl = 'db://assets/prefabs/ShipMainPage.prefab';
  const firstUrl = 'db://assets/prefabs/MainMenuPage.prefab';
  const secondUrl = 'db://assets/prefabs/GalaxyMapPage.prefab';
  const fixture = foundationRollbackFixture({
    failCopyAt: 3,
    deleteFailures: new Set([firstUrl, secondUrl]),
  });
  global.Editor = fixture.editor;
  try {
    const result = await createFoundationPrefabs(fixture.assetDb, fixture.scene);
    assert.equal(result.ok, false);
    assert.ok(result.message.includes(`无法复制 Prefab 模板：${failedCreateUrl}`));
    assert.ok(result.message.includes(`${firstUrl}：模拟删除失败`));
    assert.ok(result.message.includes(`${secondUrl}：模拟删除失败`));
    assert.doesNotMatch(result.message, /已回滚新资源/);
    assert.deepEqual(fixture.calls.filter(([name]) => name === 'deleteAsset').map(([, url]) => url), [failedCreateUrl, secondUrl, firstUrl]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});
