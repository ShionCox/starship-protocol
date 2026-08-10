const assert = require('node:assert/strict');
const test = require('node:test');

const { recognizeAuthoringSelection } = require('../dist/authoring-selection.js');

function baseTree(selected) {
  return { uuid: 'scene', name: 'PrototypeScene', children: [selected] };
}

const rooms = [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, crewCapacity: 0, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', prefabUuid: 'prefab', configUrl: 'db://assets/config/rooms/room-reactor.json', configUuid: 'config' }];

test('按 RoomView 类名或压缩 CID 识别房间实例，并只返回白名单状态', async () => {
  const selected = { uuid: 'room-node', name: '房间-反应堆', parent: 'scene', position: { x: 10, y: 20, z: 0 }, components: [{ type: 'cid-room', value: 'room-view', index: 0 }], children: [] };
  const state = await recognizeAuthoringSelection({
    selectedNode: selected,
    tree: baseTree(selected),
    componentClasses: [{ name: 'RoomView', cid: 'cid-room' }],
    rooms,
    scene: {
      async executeComponentMethod() { return { ok: true, message: '有效', roomInstanceId: 'room-reactor-1', roomDefinitionId: 'room-reactor', gridPosition: { x: 2, y: 3 }, raw: { secret: true } }; },
      async queryComponent() { return null; },
    },
  });
  assert.equal(state.kind, 'room-instance');
  assert.equal(state.instanceId, 'room-reactor-1');
  assert.deepEqual(state.gridPosition, { x: 2, y: 3 });
  assert.equal(state.raw, undefined);
  assert.equal(state.definitionFound, true);
});

test('AppRoot 识别读取网格和镜头白名单字段', async () => {
  const selected = { uuid: 'app', name: '应用根', parent: 'scene', components: [{ type: 'PrototypeSceneSettings', uuid: 'settings', index: 0 }, { type: 'CameraController', uuid: 'camera', index: 1 }], children: [] };
  const state = await recognizeAuthoringSelection({
    selectedNode: selected,
    tree: baseTree(selected),
    componentClasses: [],
    rooms,
    scene: {
      async queryComponent(uuid) {
        return uuid === 'settings' ? { value: { gridColumns: { value: 20 }, gridRows: { value: 10 }, cellSize: { value: 48 }, snapRoomsInEditor: { value: true }, invalidHullCells: { value: [{ x: 0, y: 9 }] }, gridRoot: { value: { uuid: 'grid' } } } } : { value: { minScale: { value: 0.5 }, maxScale: { value: 1.8 }, zoomStep: { value: 0.1 } } };
      },
    },
  });
  assert.equal(state.kind, 'scene-settings');
  assert.equal(state.core.gridColumns, 20);
  assert.equal(state.core.maxScale, 1.8);
  assert.deepEqual(state.appearance.invalidHullCells, [{ x: 0, y: 9 }]);
  assert.equal(state.appearance.gridRootReferenced, true);
});

test('标准骨架支持中文和英文别名，普通节点回退基础信息', async () => {
  const semantic = { uuid: 'canvas', name: 'Canvas', parent: 'scene', position: { x: 1, y: 2, z: 0 }, children: [], components: [] };
  const semanticState = await recognizeAuthoringSelection({ selectedNode: semantic, tree: baseTree(semantic), componentClasses: [], rooms, scene: {} });
  assert.equal(semanticState.kind, 'semantic-node');
  assert.equal(semanticState.semanticRole, 'canvas');

  const ordinary = { uuid: 'ordinary', name: '装饰节点', parent: 'scene', children: [], components: [{ type: 'SomeInternalComponent', uuid: 'private' }] };
  const ordinaryState = await recognizeAuthoringSelection({ selectedNode: ordinary, tree: baseTree(ordinary), componentClasses: [], rooms, scene: {} });
  assert.equal(ordinaryState.kind, 'node');
  assert.equal(ordinaryState.uuid, 'ordinary');
  assert.equal(ordinaryState.components, undefined);
});

test('定义缺失和无选择不会显示空白识别结果', async () => {
  const selected = { uuid: 'room-node', name: '孤立房间', parent: 'scene', components: [{ type: 'RoomView', uuid: 'room-view' }], children: [] };
  const missing = await recognizeAuthoringSelection({ selectedNode: selected, tree: baseTree(selected), componentClasses: [], rooms: [], scene: { async executeComponentMethod() { return { ok: false, message: '定义缺失', roomInstanceId: 'room-x', roomDefinitionId: 'room-missing' }; } } });
  assert.equal(missing.kind, 'room-instance');
  assert.equal(missing.definitionFound, false);
  assert.equal(missing.validation.message, '定义缺失');
  const none = await recognizeAuthoringSelection({ selectedNode: undefined, tree: { uuid: 'scene', name: 'PrototypeScene', children: [] }, componentClasses: [], rooms, scene: {} });
  assert.equal(none.kind, 'none');
});

test('缺少一个权威场景组件时不进入可编辑场景设置', async () => {
  const selected = { uuid: 'partial', name: '应用根', parent: 'scene', components: [{ type: 'PrototypeSceneSettings', uuid: 'settings' }], children: [] };
  const state = await recognizeAuthoringSelection({ selectedNode: selected, tree: baseTree(selected), componentClasses: [], rooms, scene: { async queryComponent() { return { value: { gridColumns: { value: 20 } } }; } } });
  assert.notEqual(state.kind, 'scene-settings');
});
