const assert = require('node:assert/strict');
const test = require('node:test');

const { initializeSceneSkeleton } = require('../dist/scene/scene-skeleton.js');

function fakeScene() {
  const root = { uuid: 'scene', name: '空场景', children: [], components: [] };
  let sequence = 0;
  const calls = [];
  const classIds = { BootSceneBootstrap: 'boot-cid', CameraController: 'camera-cid', MainSceneBootstrap: 'main-cid', BattleSceneBootstrap: 'battle-cid', ShipView: 'ship-cid' };
  const find = (uuid, node = root) => {
    if (node.uuid === uuid) return node;
    for (const child of node.children ?? []) { const result = find(uuid, child); if (result) return result; }
    return null;
  };
  const remove = (uuid, node = root) => {
    const index = (node.children ?? []).findIndex((child) => child.uuid === uuid);
    if (index >= 0) { node.children.splice(index, 1); return true; }
    return (node.children ?? []).some((child) => remove(uuid, child));
  };
  return {
    calls,
    root,
    async queryNodeTree() { return root; },
    async queryComponents() { return Object.entries(classIds).map(([name, cid]) => ({ name, cid })); },
    async createNode(options) {
      const node = { uuid: `node-${++sequence}`, name: options.name, children: [], components: [{ type: 'cc.UITransform' }] };
      find(options.parent).children.push(node); calls.push(['node', options.name]); return node;
    },
    async createComponent(uuid, type) { find(uuid).components.push({ type: classIds[type] ?? type, value: `${uuid}-${type}` }); calls.push(['component', type]); },
    async setProperty(target, path, value) { calls.push(['property', target, path, value]); return true; },
    async executeComponentMethod(uuid, name, args) { calls.push(['execute', uuid, name, args]); return { ok: true, message: '相机已校正' }; },
    async removeNode(uuid) { remove(uuid); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
}

function installSceneScriptMock() {
  const previousEditor = globalThis.Editor;
  globalThis.Editor = { Message: { async request(channel, message, options) {
    assert.equal(channel, 'scene');
    assert.equal(message, 'execute-scene-script');
    assert.equal(options.method, 'setCameraTransform');
    return true;
  } } };
  return () => { globalThis.Editor = previousEditor; };
}

test('启动场景骨架保持最小并只挂载启动装配组件', async () => {
  const restoreEditor = installSceneScriptMock();
  const scene = fakeScene();
  const result = await initializeSceneSkeleton(scene, 'BOOT');
  restoreEditor();
  assert.equal(result.ok, true, result.message);
  const names = scene.calls.filter(([kind]) => kind === 'node').map(([, name]) => name);
  assert.deepEqual(names, ['主相机', '画布', '应用根']);
  assert.equal(scene.calls.some((call) => call[0] === 'component' && call[1] === 'BootSceneBootstrap'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'component' && call[1] === 'CameraController'), false);
});

test('主场景骨架只创建持久中文节点并绑定镜头引用', async () => {
  const restoreEditor = installSceneScriptMock();
  const scene = fakeScene();
  const result = await initializeSceneSkeleton(scene, 'MAIN');
  restoreEditor();
  assert.equal(result.ok, true, result.message);
  const names = scene.calls.filter(([kind]) => kind === 'node').map(([, name]) => name);
  assert.deepEqual(names, ['主相机', '画布', '应用根', '世界根', '当前飞船挂载点']);
  assert.equal(scene.calls.some((call) => call[0] === 'component' && call[1] === 'MainSceneBootstrap'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'worldRoot'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'canvasRoot'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'orthoHeight' && call[3] === 360), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'visibility' && call[3] === 1_107_296_256), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'clearFlags' && call[3] === 7), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'cameraComponent' && call[3]?.type === 'cc.Camera'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === '_layer' && call[3] === 33_554_432), true);
  assert.equal(scene.calls.filter((call) => call[0] === 'property' && call[2] === '_layer' && call[3] === 33_554_432).length, 3);
  assert.equal(scene.calls.some((call) => call[0] === 'execute' && call[2] === 'applyEditorCameraDefaults'), true);
  const canvas = scene.root.children.find((node) => node.name === '画布');
  assert.equal(canvas.children.some((node) => node.name === '世界根'), true);
  assert.equal(scene.root.children.some((node) => node.name === '世界根'), false);
  assert.equal(scene.calls.filter(([kind]) => kind === 'snapshot').length, 1);
});

test('战斗场景骨架创建双方独立挂载点和战斗分层', async () => {
  const restoreEditor = installSceneScriptMock();
  const scene = fakeScene();
  const result = await initializeSceneSkeleton(scene, 'BATTLE');
  restoreEditor();
  assert.equal(result.ok, true);
  const names = scene.calls.filter(([kind]) => kind === 'node').map(([, name]) => name);
  for (const name of ['战斗环境', '我方飞船挂载点', '敌方飞船挂载点', '弹道层', '特效层']) assert.equal(names.includes(name), true);
  const canvas = scene.root.children.find((node) => node.name === '画布');
  assert.equal(canvas.children.some((node) => node.name === '世界根'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'component' && call[1] === 'BattleSceneBootstrap'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'execute' && call[2] === 'applyEditorCameraDefaults'), true);
});
