const assert = require('node:assert/strict');
const test = require('node:test');

const { configureR1EnergyScene } = require('../dist/scene/r1-energy-authoring.js');

function fakeScene(failPath = null) {
  const uiRoot = { uuid: 'ui-root', name: 'UIRoot', children: [], components: [{ type: 'cc.UITransform', uuid: 'ui-transform' }] };
  const root = {
    uuid: 'scene', name: 'PrototypeScene', components: [], children: [
      { uuid: 'canvas', name: 'Canvas', children: [uiRoot], components: [{ type: 'cc.Canvas', uuid: 'canvas-component' }] },
      { uuid: 'room-root', name: '房间容器', components: [], children: [
        { uuid: 'laser', name: '房间-激光室', children: [], components: [{ type: 'RoomView', uuid: 'laser-view' }] },
        { uuid: 'shield', name: '房间-护盾室', children: [], components: [{ type: 'RoomView', uuid: 'shield-view' }] },
      ] },
    ],
  };
  const definitions = { 'laser-view': 'room-laser', 'shield-view': 'room-shield' };
  const calls = [];
  let sequence = 0;
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
    async queryNodeTree() { return root; },
    async queryComponents() { return [{ name: 'RoomView', cid: 'RoomView' }, { name: 'PowerPanel', cid: 'PowerPanel' }]; },
    async queryComponent(uuid) { return { value: { roomDefinitionId: { value: definitions[uuid] } } }; },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async createNode(options) {
      const node = { uuid: `created-${++sequence}`, name: options.name, parent: options.parent, children: [], components: [{ type: 'cc.UITransform', uuid: `transform-${sequence}` }] };
      find(options.parent).children.push(node);
      calls.push(['create-node', options.name]);
      return node;
    },
    async createComponent(uuid, type) { find(uuid).components.push({ type, uuid: `${uuid}-${type}` }); calls.push(['create-component', type]); },
    async executeComponentMethod(uuid, name, args) { calls.push(['execute', uuid, name, args]); return true; },
    async setProperty(target, path, value, options) { calls.push(['set', target, path, value, options]); return path !== failPath; },
    async removeNode(uuid) { remove(uuid); },
    async endRecording(uuid) { calls.push(['end', uuid]); },
    async cancelRecording(uuid) { calls.push(['cancel', uuid]); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
}

test('持久化 R1 能源面板、两条房间行入口与中文房间外观', async () => {
  const scene = fakeScene();
  const result = await configureR1EnergyScene(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(scene.calls.filter((call) => call[0] === 'create-node').map((call) => call[1]), ['HUD层', '能源面板']);
  assert.equal(scene.calls.some((call) => call[0] === 'create-component' && call[1] === 'PowerPanel'), true);
  assert.equal(scene.calls.some((call) => call[0] === 'execute' && call[2] === 'ensureAuthoringStructure'), true);
  const appearanceCalls = scene.calls.filter((call) => call[0] === 'set');
  assert.equal(appearanceCalls.length, 6);
  assert.deepEqual(appearanceCalls.find((call) => call[1].uuid === 'laser-view' && call[2] === 'fillColor')[3], { type: 'cc.Color', value: { r: 170, g: 45, b: 55, a: 245 } });
  assert.deepEqual(appearanceCalls.find((call) => call[1].uuid === 'shield-view' && call[2] === 'fillColor')[3], { type: 'cc.Color', value: { r: 25, g: 120, b: 145, a: 245 } });
  assert.deepEqual(scene.calls.filter((call) => call[0] === 'begin' || call[0] === 'end'), [['begin', 'scene'], ['end', 'undo']]);
  assert.equal(appearanceCalls.every((call) => call[4]?.record === false), true);
});

test('消费者房间不完整时拒绝创建半份能源界面', async () => {
  const scene = fakeScene();
  scene.queryComponent = async (uuid) => ({ value: { roomDefinitionId: { value: uuid === 'laser-view' ? 'room-laser' : 'room-reactor' } } });
  const result = await configureR1EnergyScene(scene);
  assert.equal(result.ok, false);
  assert.match(result.message, /room-shield/);
  assert.equal(scene.calls.length, 0);
});

test('能源外观中途写入失败时取消单次 Undo 并清理新增节点', async () => {
  const scene = fakeScene('borderColor');
  const result = await configureR1EnergyScene(scene);
  assert.equal(result.ok, false);
  assert.deepEqual(scene.calls.filter((call) => call[0] === 'begin' || call[0] === 'end' || call[0] === 'cancel'), [['begin', 'scene'], ['cancel', 'undo']]);
  assert.equal(scene.calls.some((call) => call[0] === 'snapshot-abort'), true);
});
