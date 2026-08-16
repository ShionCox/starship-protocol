const assert = require('node:assert/strict');
const test = require('node:test');

const { createShipInstance, nextShipInstanceId } = require('../dist/hulls/ship-scene-authoring.js');

const hull = { id: 'hull-starter', displayName: '初始护卫舰', prefabUrl: 'db://assets/prefabs/ShipView.prefab', prefabUuid: 'ship-prefab', visualId: 'visual-hull-starter', gridWidth: 20, gridHeight: 10, validCells: [], level: 1, maxCrew: 12, maxRooms: 24 };

test('飞船实例 ID 按当前场景最低空闲序号生成', () => {
  assert.equal(nextShipInstanceId(['ship-1', 'ship-3']), 'ship-2');
});

test('在明确挂载点创建 ShipView Prefab，写入飞船和船体作用域并保留一次 Undo', async () => {
  const tree = { uuid: 'scene', name: 'MainScene', children: [{ uuid: 'mount', name: '当前飞船挂载点', parent: 'scene', children: [] }] };
  const calls = [];
  let created = false;
  const scene = {
    async queryNodeTree() { if (created && tree.children[0].children.length === 0) tree.children[0].children.push({ uuid: 'ship-new', name: '飞船-初始护卫舰', parent: 'mount', components: [{ type: 'ShipView', uuid: 'ship-view-new' }], children: [] }); return tree; },
    async queryComponents() { return []; },
    async executeComponentMethod() { return {}; },
    async createNode(options) { created = true; calls.push(['create', options]); return { uuid: 'ship-new' }; },
    async queryNodesByAssetUuid() { return ['ship-new']; },
    async setProperty(target, path, value) { calls.push(['set', path, value]); return true; },
    async beginRecording() { calls.push(['begin']); return 'undo-ship'; },
    async endRecording() { calls.push(['end']); },
    async cancelRecording() { calls.push(['cancel']); },
    async removeNode() { calls.push(['remove']); },
    async snapshotAbort() { calls.push(['abort']); },
  };
  const assetDb = { async queryUuid() { return 'ship-prefab'; } };
  global.Editor = { Selection: { select() {} } };
  const result = await createShipInstance(assetDb, scene, { nodeUuid: 'mount' }, hull);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[1] === 'shipId' && call[2] === 'ship-1'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[1] === '_lpos' && call[2]?.type === 'cc.Vec3' && call[2]?.value?.x === 0), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[1] === 'hullDefinitionId' && call[2] === 'hull-starter'), true);
  assert.deepEqual(calls.filter(([name]) => name === 'end'), [['end']]);
  delete global.Editor;
});
