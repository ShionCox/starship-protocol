const assert = require('node:assert/strict');
const test = require('node:test');

const { updateSceneCoreSettings, validateSceneCoreSettings } = require('../dist/scene/scene-core-authoring.js');

function sceneHarness({ failPath } = {}) {
  const calls = [];
  const tree = { uuid: 'scene', name: 'PrototypeScene', children: [{ uuid: 'app', name: 'AppRoot', parent: 'scene', children: [], components: [{ type: 'PrototypeSceneSettings', uuid: 'settings', index: 0 }, { type: 'CameraController', uuid: 'camera', index: 1 }] }] };
  const values = {
    settings: { gridColumns: 20, gridRows: 10, cellSize: 48, snapRoomsInEditor: true },
    camera: { minScale: 0.5, maxScale: 1.8, zoomStep: 0.1 },
  };
  return {
    calls,
    values,
    async queryNodeTree() { return tree; },
    async queryComponents() { return []; },
    async queryComponent(uuid) { return { value: values[uuid === 'settings' ? 'settings' : 'camera'] }; },
    async setProperty(target, path, value) {
      calls.push(['set', target.uuid, path, value]);
      if (path === failPath) return false;
      values[target.uuid === 'settings' ? 'settings' : 'camera'][path] = value;
      return true;
    },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
}

const request = { gridColumns: 22, gridRows: 11, cellSize: 40, snapRoomsInEditor: false, minScale: 0.6, maxScale: 2, zoomStep: 0.2 };

test('场景核心参数合法写入且只生成一次 Undo 快照', async () => {
  const scene = sceneHarness();
  const result = await updateSceneCoreSettings(scene, 'app', request);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(scene.calls.filter((call) => call[0] === 'snapshot').length, 1);
  assert.equal(scene.calls.filter((call) => call[0] === 'snapshot-abort').length, 0);
  assert.equal(scene.values.settings.gridColumns, 22);
  assert.equal(scene.values.camera.maxScale, 2);
});

test('非法网格或缩放范围在写入前拒绝', async () => {
  assert.equal(validateSceneCoreSettings({ ...request, gridColumns: 0 }).ok, false);
  assert.equal(validateSceneCoreSettings({ ...request, maxScale: 0.1, minScale: 0.2 }).ok, false);
  const scene = sceneHarness();
  const result = await updateSceneCoreSettings(scene, 'app', { ...request, cellSize: 0 });
  assert.equal(result.ok, false);
  assert.equal(scene.calls.length, 0);
});

test('公开 set-property 失败时回滚已写入属性并放弃快照', async () => {
  const scene = sceneHarness({ failPath: 'gridRows' });
  const result = await updateSceneCoreSettings(scene, 'app', request);
  assert.equal(result.ok, false);
  assert.equal(scene.values.settings.gridColumns, 20);
  assert.equal(scene.calls.filter((call) => call[0] === 'snapshot').length, 0);
  assert.equal(scene.calls.filter((call) => call[0] === 'snapshot-abort').length, 1);
});

test('普通节点即使误挂同名组件也不能写入场景核心参数', async () => {
  const scene = sceneHarness();
  const tree = await scene.queryNodeTree();
  tree.children[0].name = '普通节点';
  const result = await updateSceneCoreSettings(scene, 'app', request);
  assert.equal(result.ok, false);
  assert.equal(scene.calls.length, 0);
});

test('读取 Scene API 失败时返回可观察错误而不是 rejected promise', async () => {
  const scene = sceneHarness();
  scene.queryNodeTree = async () => { throw new Error('scene unavailable'); };
  const result = await updateSceneCoreSettings(scene, 'app', request);
  assert.equal(result.ok, false);
  assert.match(result.message, /scene unavailable/);
});
