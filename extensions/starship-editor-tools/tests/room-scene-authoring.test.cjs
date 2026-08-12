const assert = require('node:assert/strict');
const test = require('node:test');

const { createRoomInstance, resolveRoomRoot } = require('../dist/rooms/room-scene-authoring.js');

const entry = { id: 'room-laser', displayName: '激光室', category: 'WEAPON', width: 2, height: 2, prefabUrl: 'db://assets/prefabs/LaserRoom.prefab', prefabUuid: 'prefab-laser', configUrl: 'db://assets/config/rooms/room-laser.json', configUuid: 'config-laser' };

function tree() {
  return { uuid: 'scene', name: 'MainScene', children: [{ uuid: 'world', name: '世界根', parent: 'scene', children: [{ uuid: 'mount', name: '当前飞船挂载点', parent: 'world', children: [{
    uuid: 'ship', name: '飞船视图', parent: 'mount', components: [{ type: 'ShipView', uuid: 'ship-view' }], children: [
      { uuid: 'grid', name: '网格根', parent: 'ship', children: [] },
      { uuid: 'rooms', name: '房间容器', parent: 'ship', children: [] },
      { uuid: 'crew', name: '船员层', parent: 'ship', children: [] },
    ],
  }] }] }] };
}

function scenePort(options = {}) {
  const sceneTree = tree();
  const calls = [];
  let created = false;
  return {
    calls,
    async queryNodeTree() {
      if (created && !sceneTree.children[0].children[0].children[0].children[1].children.some((node) => node.uuid === 'room-new')) {
        sceneTree.children[0].children[0].children[0].children[1].children.push({ uuid: 'room-new', name: '房间-激光室', parent: 'rooms', components: options.missingRoomView ? [] : [{ type: 'RoomView', uuid: 'room-view-new' }], children: [] });
      }
      return sceneTree;
    },
    async queryComponents() { return []; },
    async queryComponent() { return null; },
    async executeComponentMethod(uuid, name) { calls.push(['execute', uuid, name]); return name === 'findFirstAvailableRoomPlacement' ? { x: 2, y: 1 } : true; },
    async createNode(config) { created = true; calls.push(['create', config.parent, config.assetUuid, config.unlinkPrefab]); return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return options.missingLink ? [] : ['room-new']; },
    async setProperty(target, path, value, settings) { calls.push(['set', target, path, value, settings]); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording(uuid) { calls.push(['begin-recording', uuid]); return 'undo-room'; },
    async endRecording(id) { calls.push(['end-recording', id]); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
}

function twoShipTree() {
  const roomA = { uuid: 'room-a', name: '房间-激光室', parent: 'rooms-a', components: [{ type: 'RoomView', uuid: 'room-view-a' }], children: [] };
  const roomB = { uuid: 'room-b', name: '房间-反应堆', parent: 'rooms-b', components: [{ type: 'RoomView', uuid: 'room-view-b' }], children: [] };
  return {
    uuid: 'scene',
    name: 'BattleScene',
    children: [{
      uuid: 'world',
      name: '世界根',
      parent: 'scene',
      children: [
        {
          uuid: 'mount-a',
          name: '我方飞船挂载点',
          parent: 'world',
          children: [{
            uuid: 'ship-a',
            name: '飞船视图',
            parent: 'mount-a',
            components: [{ type: 'ShipView', uuid: 'ship-view-a' }],
            children: [{ uuid: 'rooms-a', name: '房间容器', parent: 'ship-a', children: [roomA] }],
          }],
        },
        {
          uuid: 'mount-b',
          name: '敌方飞船挂载点',
          parent: 'world',
          children: [{
            uuid: 'ship-b',
            name: '飞船视图',
            parent: 'mount-b',
            components: [{ type: 'ShipView', uuid: 'ship-view-b' }],
            children: [{ uuid: 'rooms-b', name: '房间容器', parent: 'ship-b', children: [roomB] }],
          }],
        },
      ],
    }],
  };
}

test('语义路由只解析所选 ShipView 内的中文房间容器', () => {
  const result = resolveRoomRoot(tree(), { nodeUuid: 'ship' });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.node.name, '房间容器');
});

test('创建房间调用所属 ShipView 寻找合法空位并提交一次 Undo', async () => {
  const port = scenePort();
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(port, { nodeUuid: 'ship' }, entry);
  assert.equal(result.ok, true);
  assert.equal(port.calls.some((call) => call[0] === 'execute' && call[2] === 'findFirstAvailableRoomPlacement'), true);
  assert.equal(port.calls.some((call) => call[0] === 'set' && call[2] === 'roomInstanceId'), true);
  assert.deepEqual(port.calls.filter((call) => call[0] === 'end-recording'), [['end-recording', 'undo-room']]);
  delete global.Editor;
});

test('没有明确 ShipView 时拒绝创建，不回退到 Canvas 或场景根', async () => {
  const port = scenePort();
  port.queryNodeTree = async () => ({ uuid: 'scene', name: '空场景', children: [{ uuid: 'canvas', name: '画布', parent: 'scene', children: [] }] });
  const result = await createRoomInstance(port, {}, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /没有“房间容器”/);
  assert.equal(port.calls.some((call) => call[0] === 'begin-recording' || call[0] === 'create'), false);
});

test('创建结果缺少 RoomView 或 Prefab 关联时完整回滚', async () => {
  for (const options of [{ missingRoomView: true }, { missingLink: true }]) {
    const port = scenePort(options);
    global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
    const result = await createRoomInstance(port, { nodeUuid: 'ship' }, entry);
    assert.equal(result.ok, false);
    assert.equal(port.calls.some((call) => call[0] === 'remove'), true);
    assert.equal(port.calls.some((call) => call[0] === 'cancel-recording'), true);
    assert.equal(port.calls.some((call) => call[0] === 'snapshot-abort'), true);
    delete global.Editor;
  }
});

test('房间实例 ID 只在目标飞船的房间容器内递增，允许其他飞船复用短 ID', async () => {
  const sceneTree = twoShipTree();
  let created = false;
  const calls = [];
  const port = {
    calls,
    async queryNodeTree() {
      if (created) {
        sceneTree.children[0].children[1].children[0].children[0].children.push({
          uuid: 'room-new', name: '房间-激光室', parent: 'rooms-b', components: [{ type: 'RoomView', uuid: 'room-view-new' }], children: [],
        });
      }
      return sceneTree;
    },
    async queryComponents() { return []; },
    async queryComponent(uuid) {
      return { value: { roomInstanceId: uuid === 'room-view-a' ? 'room-laser-1' : 'room-reactor-1' } };
    },
    async executeComponentMethod(uuid, name) {
      calls.push(['execute', uuid, name]);
      return name === 'findFirstAvailableRoomPlacement' ? { x: 0, y: 0 } : true;
    },
    async createNode(config) { created = true; calls.push(['create', config.parent]); return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty(target, path, value) { calls.push(['set', target, path, value]); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording(uuid) { calls.push(['begin-recording', uuid]); return 'undo-room'; },
    async endRecording(id) { calls.push(['end-recording', id]); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(port, { nodeUuid: 'ship-b' }, entry);
  assert.equal(result.ok, true, result.message);
  assert.equal(calls.some((call) => call[0] === 'create' && call[1] === 'rooms-b'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[3] === 'room-laser-1'), true);
  delete global.Editor;
});

test('读取目标房间已有实例 ID 失败时 fail-closed，不开始 Undo', async () => {
  const sceneTree = twoShipTree();
  const calls = [];
  const port = {
    calls,
    async queryNodeTree() { return sceneTree; },
    async queryComponents() { return []; },
    async queryComponent() { throw new Error('组件读取失败'); },
    async executeComponentMethod() { calls.push(['execute']); return { x: 0, y: 0 }; },
    async beginRecording() { calls.push(['begin-recording']); return 'undo-room'; },
  };
  const result = await createRoomInstance(port, { nodeUuid: 'ship-b' }, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /无法读取已有房间实例标识/);
  assert.equal(calls.some((call) => call[0] === 'begin-recording'), false);
});

test('所属 ShipView 计算空位抛错时 fail-closed，不创建临时节点', async () => {
  const port = scenePort();
  const originalExecute = port.executeComponentMethod;
  port.executeComponentMethod = async (uuid, name) => {
    if (name === 'findFirstAvailableRoomPlacement') throw new Error('网格定义重载失败');
    return originalExecute(uuid, name);
  };
  const result = await createRoomInstance(port, { nodeUuid: 'ship' }, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /无法计算.*合法空位/);
  assert.equal(port.calls.some((call) => call[0] === 'begin-recording' || call[0] === 'create'), false);
});
