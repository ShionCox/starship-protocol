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
      components: [{ type: 'PrototypeSceneSettings', uuid: 'settings' }], children: [],
    }],
  };
}

test('语义路由优先选择当前选择节点所在的 RoomRoot', () => {
  const result = resolveRoomRoot(tree(), { nodeUuid: 'ship' });
  assert.equal(result.ok, true);
  assert.equal(result.node.name, 'RoomRoot');
});

test('创建房间使用首个合法空位并在成功后生成一次快照', async () => {
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
    async createNode(options) { created = true; calls.push(['create', options.parent, options.assetUuid]); return { uuid: 'room-new' }; },
    async setProperty(uuid, path, value) { calls.push(['set', uuid, path, value]); return true; },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async snapshot() { calls.push(['snapshot']); },
    async snapshotAbort() { calls.push(['snapshot-abort']); },
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'create' && call[2] === 'prefab-laser'), true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'roomInstanceId'), true);
  assert.equal(calls.filter((call) => call[0] === 'snapshot').length, 1);
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
    async setProperty(uuid, path, value) { calls.push(['set', uuid, path, value]); return true; },
    async removeNode() {},
    async snapshot() {},
    async snapshotAbort() {},
  };
  global.Editor = { Selection: { select() {} }, Message: { async request() {} } };
  const result = await createRoomInstance(scene, {}, entry);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call[0] === 'set' && call[3] === 'room-laser-2'), true);
  delete global.Editor;
});
