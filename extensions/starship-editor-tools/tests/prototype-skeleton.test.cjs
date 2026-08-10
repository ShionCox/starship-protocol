const assert = require('node:assert/strict');
const test = require('node:test');

const { initializePrototypeScene } = require('../dist/scene/prototype-skeleton.js');

function fakeScene() {
  const root = { uuid: 'scene', name: 'PrototypeScene', children: [], components: [] };
  let sequence = 0;
  const calls = [];
  const componentClassIds = {
    CameraController: 'camera-controller-cid',
    PrototypeSceneSettings: 'scene-settings-cid',
    PrototypeBootstrap: 'prototype-bootstrap-cid',
  };
  function find(uuid, node = root) {
    if (node.uuid === uuid) return node;
    for (const child of node.children ?? []) {
      const result = find(uuid, child);
      if (result) return result;
    }
    return null;
  }
  function remove(uuid, node = root) {
    const index = (node.children ?? []).findIndex((child) => child.uuid === uuid);
    if (index >= 0) { node.children.splice(index, 1); return true; }
    return (node.children ?? []).some((child) => remove(uuid, child));
  }
  return {
    calls,
    async queryNodeTree() { return root; },
    async queryComponents() {
      return Object.entries(componentClassIds).map(([name, cid]) => ({ name, cid }));
    },
    async createNode(options) {
      const parent = find(options.parent);
      const node = { uuid: `node-${++sequence}`, name: options.name, children: [], components: [] };
      parent.children.push(node);
      calls.push(['node', options.name]);
      return node;
    },
    async createComponent(uuid, component) {
      const type = componentClassIds[component] ?? component;
      find(uuid).components.push({ type, value: `${uuid}-${component}` });
      calls.push(['component', component]);
    },
    async setProperty(uuid, path, value) { calls.push(['property', uuid, path, value]); return true; },
    async removeNode(uuid) { remove(uuid); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
}

test('初始化 Prototype 场景骨架创建完整语义树和组件', async () => {
  const scene = fakeScene();
  const result = await initializePrototypeScene(scene);
  assert.equal(result.ok, true);
  assert.equal(scene.calls.filter((call) => call[0] === 'node').length, 10);
  const createdNames = scene.calls.filter((call) => call[0] === 'node').map((call) => call[1]);
  for (const name of ['主相机', '画布', '应用根', '背景层', '世界根', '界面根', '飞船根', '网格根', '房间容器', '预览根']) {
    assert.equal(createdNames.includes(name), true, `应创建中文节点：${name}`);
  }
  assert.equal(scene.calls.some((call) => call[0] === 'component' && call[1] === 'PrototypeBootstrap'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'property' && call[2] === 'gridRoot'), true);
  assert.equal(scene.calls.filter((call) => call[0] === 'snapshot').length, 1);
});
