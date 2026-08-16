const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { bindCrewDefinitionToOpenPrefab, bindFirstPssCrewAppearances } = require('../dist/crew/bind-crew-prefab.js');

function assetDb() {
  return {
    async queryUuid(url) { return `uuid:${url}`; },
    async createAsset(url) { return { uuid: `uuid:${url}`, url }; },
    async saveAsset(url) { return { uuid: `uuid:${url}`, url }; },
    async reimportAsset() {},
    async queryInfo(url) {
      if (!url.endsWith('.plist')) return { uuid: `uuid:${url}`, url };
      const visualId = path.basename(url, '.plist');
      return {
        uuid: `uuid:${url}`,
        url,
        subAssets: {
          first: { uuid: `uuid:${visualId}:0`, url: `${url}/0`, name: `${visualId}-frame-000`, type: 'cc.SpriteFrame' },
          second: { uuid: `uuid:${visualId}:1`, url: `${url}/1`, name: `${visualId}-frame-001`, type: 'cc.SpriteFrame' },
        },
      };
    },
    async readFile(url) {
      const file = url.replace('db://assets/', 'assets/');
      return fs.readFileSync(path.join(__dirname, '..', '..', '..', file), 'utf8');
    },
  };
}

function crewSceneFixture({ calls = [], currentDefinitionId = 'crew-engineer', getDefinitionId = null, initialImage = false } = {}) {
  const nodes = new Map();
  let nextNode = 1;
  let nextComponent = 1;
  const root = { uuid: 'prefab-root', name: 'prefab-root', parent: null, children: [], components: [
    { type: 'CrewView', value: 'crew-view', uuid: 'crew-view', nodeUuid: 'prefab-root', index: 0 },
  ] };
  nodes.set(root.uuid, root);
  if (initialImage) {
    const image = { uuid: 'old-image', name: '船员图像', parent: root.uuid, children: [], components: [
      { type: 'cc.UITransform', value: 'old-transform', nodeUuid: 'old-image', index: 0 },
      { type: 'cc.Sprite', value: 'old-sprite', nodeUuid: 'old-image', index: 1 },
      { type: 'cc.Animation', value: 'old-animation', nodeUuid: 'old-image', index: 2 },
      { type: 'CrewAppearance', value: 'old-appearance', nodeUuid: 'old-image', index: 3 },
    ] };
    const label = { uuid: 'old-label', name: '船员名称', parent: image.uuid, children: [], components: [
      { type: 'cc.UITransform', value: 'old-label-transform', nodeUuid: 'old-label', index: 0 },
      { type: 'cc.Label', value: 'old-label-component', nodeUuid: 'old-label', index: 1 },
    ] };
    image.children.push(label.uuid);
    nodes.set(image.uuid, image); nodes.set(label.uuid, label); root.children.push(image.uuid);
  }
  const clone = (uuid) => {
    const node = nodes.get(uuid);
    return {
      uuid: node.uuid,
      name: node.name,
      parent: node.parent,
      components: node.components.map((component) => ({ ...component })),
      children: node.children.map((child) => clone(child)),
    };
  };
  const scene = {
    async queryNodeTree() { return clone(root.uuid); },
    async queryComponents() { return [{ name: 'CrewAppearance', cid: 'crew-appearance' }]; },
    async createNode(options) {
      const uuid = options.name === '船员图像' ? 'image-node' : options.name === '船员精灵' ? 'sprite-node' : 'label-node';
      const node = { uuid: `${uuid}-${nextNode++}`, name: options.name, parent: options.parent, children: [], components: [] };
      nodes.set(node.uuid, node);
      nodes.get(options.parent).children.push(node.uuid);
      return { uuid: node.uuid };
    },
    async removeNode(uuid) {
      const node = nodes.get(uuid);
      if (node === undefined) return;
      const parent = nodes.get(node.parent);
      if (parent !== undefined) parent.children = parent.children.filter((child) => child !== uuid);
      const remove = (id) => { for (const child of nodes.get(id)?.children ?? []) remove(child); nodes.delete(id); };
      remove(uuid);
      calls.push(['remove-node', uuid]);
    },
    async createComponent(nodeUuid, type) {
      const node = nodes.get(nodeUuid);
      node.components.push({ type, value: `component-${type}-${nextComponent++}`, nodeUuid, index: node.components.length });
      calls.push(['create-component', nodeUuid, type]);
    },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async setProperty(...args) { calls.push(['set', ...args]); return true; },
    async executeComponentMethod(uuid, name, args) {
      if (name === 'applyAuthoringDefinitionPreview') return true;
      if (name === 'getAuthoringInspectorState') return { crewDefinitionId: getDefinitionId === null ? currentDefinitionId : getDefinitionId() };
      if (name === 'createAuthoringAnimationClipAsset') return { ok: true, message: '有效', content: '{}' };
      if (name === 'applyAuthoringPssConfiguration') { calls.push(['method', uuid, name, args[0]]); return { ok: true, message: '有效' }; }
      return { ok: true, message: '有效' };
    },
    async endRecording(id) { calls.push(['end', id]); },
    async cancelRecording(id) { calls.push(['cancel', id]); },
  };
  return scene;
}

test('船员 Prefab 重建标准视觉子树、同步定义和职业颜色后保存', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(['scene', ...args]); return true; } } };
  try {
    const result = await bindCrewDefinitionToOpenPrefab(crewSceneFixture({ calls, initialImage: true }), assetDb(), 'crew-gunner', 'GUNNER');
    assert.equal(result.ok, true);
    assert.equal(calls.some((call) => call[0] === 'remove-node' && call[1] === 'old-image'), true);
    assert.equal(calls.some((call) => call[0] === 'create-component' && call[2] === 'cc.Graphics'), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'crewDefinitionId' && call[3] === 'crew-gunner'), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'bodyColor' && call[3].value.r === 224), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'crewAppearance'), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'configSource'), false);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'fontFamily' && call[3] === 'Microsoft YaHei'), true);
    assert.deepEqual(calls.filter((call) => call[0] === 'begin' || call[0] === 'end'), [['begin', 'prefab-root'], ['end', 'undo']]);
    assert.equal(calls.filter((call) => call[0] === 'set').every((call) => call[4]?.record === false), true);
    assert.equal(calls.some((call) => call[0] === 'scene' && call[2] === 'save-scene'), true);
  } finally {
    delete global.Editor;
  }
});

test('医务员 Prefab 使用白绿配色且不保存可重复实例 ID', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(['scene', ...args]); return true; } } };
  try {
    const result = await bindCrewDefinitionToOpenPrefab(crewSceneFixture({ calls }), assetDb(), 'crew-medic', 'MEDIC');
    assert.equal(result.ok, true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'crewInstanceId' && call[3] === ''), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'bodyColor' && call[3].value.r === 232 && call[3].value.g === 248), true);
    assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'borderColor' && call[3].value.g === 218), true);
  } finally {
    delete global.Editor;
  }
});

test('四套外观等待目标 Prefab 切换完成并统一使用恒定屏幕字号名称', async () => {
  const definitionsByUrl = new Map([
    ['db://assets/prefabs/EngineerCrew.prefab', 'crew-engineer'],
    ['db://assets/prefabs/GunnerCrew.prefab', 'crew-gunner'],
    ['db://assets/prefabs/MedicCrew.prefab', 'crew-medic'],
    ['db://assets/prefabs/SoldierCrew.prefab', 'crew-soldier'],
  ]);
  let currentDefinitionId = 'crew-engineer';
  const methodCalls = [];
  const propertyCalls = [];
  const reimported = [];
  global.Editor = { Message: { request: async () => true } };
  const sceneCalls = [];
  const scene = crewSceneFixture({ calls: sceneCalls, getDefinitionId: () => currentDefinitionId });
  const originalSetProperty = scene.setProperty;
  scene.setProperty = async (...args) => { propertyCalls.push(args); return await originalSetProperty(...args); };
  const originalExecute = scene.executeComponentMethod;
  scene.executeComponentMethod = async (uuid, name, args) => {
    const result = await originalExecute(uuid, name, args);
    if (name === 'applyAuthoringPssConfiguration') methodCalls.push(args[0]);
    return result;
  };
  try {
    const result = await bindFirstPssCrewAppearances(
      { ...assetDb(), async reimportAsset(url) { reimported.push(url); } },
      scene,
      async (url) => { setTimeout(() => { currentDefinitionId = definitionsByUrl.get(url); }, 5); },
      async () => undefined,
    );
    assert.equal(result.ok, true);
    assert.equal(result.bound.length, 4);
    assert.deepEqual(reimported.filter((url) => url.endsWith('.prefab')), []);
    assert.equal(methodCalls.every((call) => call.frameRate === 6 && call.frameRects.length === 2), true);
    assert.equal(methodCalls.every((call) => call.frameUuids.length === 2), true);
    assert.equal(methodCalls.every((call) => call.displayName === undefined), true);
    assert.equal(propertyCalls.filter((call) => ['idleClip', 'movingClip', 'taskClip'].includes(call[1])).length, 12);
    assert.equal(propertyCalls.some((call) => call[1] === 'fontSize' && call[2] === 14), true);
  } finally {
    delete global.Editor;
  }
});
