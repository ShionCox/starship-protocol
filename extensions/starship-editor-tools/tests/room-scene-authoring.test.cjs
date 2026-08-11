const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createRoomInstance,
  resolveRoomRoot,
} = require('../dist/rooms/room-scene-authoring.js');

const entry = {
  id: 'room-laser',
  displayName: '激光室',
  category: 'WEAPON',
  width: 2,
  height: 2,
  prefabUrl: 'db://assets/prefabs/LaserRoom.prefab',
  prefabUuid: 'prefab-laser',
  configUrl: 'db://assets/config/rooms/room-laser.json',
  configUuid: 'config-laser',
};

function tree() {
  return {
    uuid: 'scene',
    name: 'PrototypeScene',
    children: [{
      uuid: 'canvas', name: 'Canvas', parent: 'scene', children: [{
        uuid: 'world', name: 'WorldRoot', parent: 'canvas', children: [{
          uuid: 'ship', name: 'ShipRoot', parent: 'world', children: [
            { uuid: 'grid', name: 'GridRoot', parent: 'ship', children: [] },
            { uuid: 'rooms', name: 'RoomRoot', parent: 'ship', children: [] },
          ],
        }],
      }],
    }, {
      uuid: 'app', name: 'AppRoot', parent: 'scene',
      components: [{ type: 'PrototypeSceneSettings', uuid: 'settings' }, { type: 'CameraController', uuid: 'camera-controller' }], children: [],
    }],
  };
}

test('语义路由优先选择当前选择节点所在的 RoomRoot', () => {
  const result = resolveRoomRoot(tree(), { nodeUuid: 'ship' });
  assert.equal(result.ok, true);
  assert.equal(result.node.name, 'RoomRoot');
});

test('创建房间使用首个合法空位并在成功后提交一次原子 Undo', async () => {
  const sceneTree = tree();
  const calls = [];
  let created = false;
  const scene = {
    async queryNodeTree() {
      if (created) sceneTree.children[0].children[0].children[0].children[1].children.push({
        uuid: 'room-new', name: 'Room-room-laser', parent: 'rooms',
        components: [{ type: 'RoomView', uuid: 'room-view-new' }], children: [],
      });
      return sceneTree;
    },
    async queryComponent() { return null; },
    async executeComponentMethod(uuid, name) {
      calls.push(['execute', uuid, name]);
      return name === 'findFirstAvailableRoomPlacement' ? { x: 2, y: 1 } : true;
    },
    async createNode(options) { created = true; calls.push(['create', options.parent, options.assetUuid, options.unlinkPrefab, options.type]); return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty(uuid, path, value, options) { calls.push(['set', uuid, path, value, options]); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording(uuid) { calls.push(['begin-recording', uuid]); return 'undo-room'; },
    async endRecording(id) { calls.push(['end-recording', id]); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() { throw new Error('focus failed'); } } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'create' && call[2] === 'prefab-laser'), true);
  assert.equal(calls.some((call) => call[0] === 'create' && call[3] === false), true);
  assert.equal(calls.some((call) => call[0] === 'create' && call[4] === 'cc.Prefab'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'roomInstanceId'), true);
  assert.deepEqual(calls.find((call) => call[0] === 'set')[4], { record: false });
  assert.equal(calls.findIndex((call) => call[0] === 'begin-recording') < calls.findIndex((call) => call[0] === 'create'), true);
  assert.deepEqual(calls.filter((call) => call[0] === 'end-recording'), [['end-recording', 'undo-room']]);
  assert.equal(calls.some((call) => call[0] === 'snapshot'), false);
  delete global.Editor;
});

test('创建房间会跳过已有的稳定实例 ID', async () => {
  const sceneTree = tree();
  sceneTree.children[0].children[0].children[0].children[1].children.push({
    uuid: 'room-old', name: 'ReactorRoom', parent: 'rooms',
    components: [{ type: 'RoomView', uuid: 'room-view-old' }], children: [],
  });
  const calls = [];
  const scene = {
    async queryNodeTree() { return sceneTree; },
    async queryComponent(uuid) {
      return uuid === 'room-view-old' ? { value: { roomInstanceId: { value: 'room-laser-1' } } } : null;
    },
    async executeComponentMethod(uuid, name) { return name === 'findFirstAvailableRoomPlacement' ? { x: 2, y: 1 } : true; },
    async createNode(options) {
      calls.push(['create', options.name]);
      sceneTree.children[0].children[0].children[0].children[1].children.push({
        uuid: 'room-new', name: options.name, parent: 'rooms', components: [{ type: 'RoomView', uuid: 'room-view-new' }], children: [],
      });
      return { uuid: 'room-new' };
    },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty(uuid, path, value) { calls.push(['set', uuid, path, value]); return true; },
    async removeNode() {},
    async beginRecording() { return 'undo-room'; },
    async endRecording() {},
    async cancelRecording() {},
    async snapshot() {},
    async snapshotAbort() {},
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[3] === 'room-laser-2'), true);
  delete global.Editor;
});

test('没有标准骨架但存在 Canvas 时创建到 Canvas 顶层且不执行网格方法', async () => {
  const sceneTree = {
    uuid: 'scene', name: 'EmptyScene', children: [{ uuid: 'canvas', name: 'Canvas', parent: 'scene', children: [] }],
  };
  const calls = [];
  let created = false;
  const scene = {
    async queryNodeTree() {
      if (created) sceneTree.children[0].children.push({ uuid: 'room-new', name: 'Room-激光室', parent: 'canvas', components: [{ type: 'RoomView', uuid: 'room-view-new' }], children: [] });
      return sceneTree;
    },
    async queryComponent() { return null; },
    async executeComponentMethod() { throw new Error('非网格放置不应调用组件方法'); },
    async createNode(options) { created = true; calls.push(['create', options.parent, options.position]); return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty(uuid, path, value) { calls.push(['set', uuid, path, value]); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording(uuid) { calls.push(['begin-recording', uuid]); return 'undo-room'; },
    async endRecording(id) { calls.push(['end-recording', id]); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.match(result.message, /Canvas 顶层/);
  assert.deepEqual(calls[0], ['begin-recording', 'canvas']);
  assert.deepEqual(calls[1], ['create', 'canvas', { x: 0, y: 0, z: 0 }]);
  assert.deepEqual(calls.filter((call) => call[0] === 'end-recording'), [['end-recording', 'undo-room']]);
  assert.equal(calls.some((call) => call[0] === 'snapshot'), false);
  assert.equal(calls.some((call) => call[0] === 'execute'), false);
  delete global.Editor;
});

test('没有标准骨架和 Canvas 时创建到场景根节点', async () => {
  const sceneTree = { uuid: 'scene', name: 'EmptyScene', children: [] };
  const calls = [];
  let created = false;
  const scene = {
    async queryNodeTree() {
      if (created) sceneTree.children.push({ uuid: 'room-new', name: 'Room-激光室', parent: 'scene', components: [{ type: 'RoomView', uuid: 'room-view-new' }], children: [] });
      return sceneTree;
    },
    async queryComponent() { return null; },
    async executeComponentMethod() { throw new Error('非网格放置不应调用组件方法'); },
    async createNode(options) { created = true; calls.push(['create', options.parent]); return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty() { return true; },
    async removeNode() {},
    async beginRecording(uuid) { calls.push(['begin-recording', uuid]); return 'undo-room'; },
    async endRecording(id) { calls.push(['end-recording', id]); },
    async cancelRecording() {},
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() {},
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.match(result.message, /场景顶层/);
  assert.deepEqual(calls[0], ['begin-recording', 'scene']);
  assert.deepEqual(calls[1], ['create', 'scene']);
  assert.deepEqual(calls.filter((call) => call[0] === 'end-recording'), [['end-recording', 'undo-room']]);
  assert.equal(calls.some((call) => call[0] === 'snapshot'), false);
  delete global.Editor;
});

test('创建结果缺少 RoomView 时删除临时节点并放弃快照', async () => {
  const sceneTree = tree();
  const calls = [];
  let created = false;
  const scene = {
    async queryNodeTree() {
      if (created) sceneTree.children[0].children[0].children[0].children[1].children.push({ uuid: 'room-new', name: 'Room-激光室', parent: 'rooms', components: [], children: [] });
      return sceneTree;
    },
    async queryComponents() { return []; },
    async queryComponent() { return null; },
    async executeComponentMethod(_uuid, name) { return name === 'findFirstAvailableRoomPlacement' ? { x: 2, y: 1 } : true; },
    async createNode() { created = true; return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return ['room-new']; },
    async setProperty() { calls.push(['set']); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording() { calls.push(['begin-recording']); return 'undo-room'; },
    async endRecording() { calls.push(['end-recording']); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [['begin-recording'], ['remove', 'room-new'], ['cancel-recording', 'undo-room'], ['snapshot-abort']]);
  delete global.Editor;
});

test('创建结果丢失 Prefab 关联时删除临时节点并放弃快照', async () => {
  const sceneTree = tree();
  const calls = [];
  const scene = {
    async queryNodeTree() { return sceneTree; },
    async queryComponent() { return null; },
    async executeComponentMethod(_uuid, name) { return name === 'findFirstAvailableRoomPlacement' ? { x: 2, y: 1 } : true; },
    async createNode() { return { uuid: 'room-new' }; },
    async queryNodesByAssetUuid() { return []; },
    async setProperty() { calls.push(['set']); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async beginRecording() { calls.push(['begin-recording']); return 'undo-room'; },
    async endRecording() { calls.push(['end-recording']); },
    async cancelRecording(id) { calls.push(['cancel-recording', id]); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /未保留 Prefab 关联/);
  assert.deepEqual(calls, [['begin-recording'], ['remove', 'room-new'], ['cancel-recording', 'undo-room'], ['snapshot-abort']]);
  delete global.Editor;
});
