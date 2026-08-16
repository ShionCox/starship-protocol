const assert = require('node:assert/strict');
const test = require('node:test');

const { recognizeAuthoringSelection } = require('../dist/authoring-selection.js');

function baseTree(selected) {
  return { uuid: 'scene', name: 'MainScene', children: [selected] };
}

const rooms = [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, crewCapacity: 0, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', prefabUuid: 'prefab' }];
const crews = [{ id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', rarity: 'RARE', maxHp: 100, moveTicksPerEdge: 5, repairHpPerTick: 1, appearanceId: 'appearance-pss-engineer-bob-8', traitIds: [], prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', prefabUuid: 'crew-prefab' }];

test('按 RoomView 类名或压缩 CID 识别房间实例，并只返回白名单状态', async () => {
  const selected = { uuid: 'room-node', name: '房间-反应堆', parent: 'scene', position: { x: 10, y: 20, z: 0 }, components: [{ type: 'cid-room', value: 'room-view', index: 0 }], children: [] };
  const state = await recognizeAuthoringSelection({
    selectedNode: selected,
    tree: baseTree(selected),
    componentClasses: [{ name: 'RoomView', cid: 'cid-room' }],
    rooms,
    scene: {
      async executeComponentMethod() { return { ok: true, message: '有效', roomInstanceId: 'room-reactor-1', roomDefinitionId: 'room-reactor', gridPosition: { x: 2, y: 3 }, initialHp: 60, raw: { secret: true } }; },
      async queryComponent() { return null; },
    },
  });
  assert.equal(state.kind, 'room-instance');
  assert.equal(state.instanceId, 'room-reactor-1');
  assert.deepEqual(state.gridPosition, { x: 2, y: 3 });
  assert.equal(state.initialHp, 60);
  assert.equal(state.raw, undefined);
  assert.equal(state.definitionFound, true);
});

test('识别顺序在房间后识别 CrewView 压缩 CID，并只返回船员白名单字段', async () => {
  const selected = { uuid: 'crew-node', name: '船员-工程师', parent: 'scene', components: [{ type: 'cid-crew', value: 'crew-view', index: 0 }], children: [] };
  const state = await recognizeAuthoringSelection({ selectedNode: selected, tree: baseTree(selected), componentClasses: [{ name: 'CrewView', cid: 'cid-crew' }], rooms, crews, scene: { async executeComponentMethod() { return { ok: true, message: '有效', crewInstanceId: 'crew-engineer-1', crewDefinitionId: 'crew-engineer', initialRoomInstanceId: 'room-reactor-1', initialStationIndex: 0, raw: 'secret' }; } } });
  assert.equal(state.kind, 'crew-instance');
  assert.equal(state.page, 'crew');
  assert.equal(state.instanceId, 'crew-engineer-1');
  assert.equal(state.initialRoomInstanceId, 'room-reactor-1');
  assert.equal(state.definitionFound, true);
  assert.equal(state.raw, undefined);
});

test('ShipView 识别只返回飞船实例和船体白名单字段', async () => {
  const selected = { uuid: 'ship', name: '飞船视图', parent: 'scene', components: [{ type: 'cid-ship', uuid: 'ship-view', index: 0 }], children: [] };
  const state = await recognizeAuthoringSelection({
    selectedNode: selected,
    tree: baseTree(selected),
    componentClasses: [{ name: 'ShipView', cid: 'cid-ship' }],
    rooms,
    crews,
    scene: {
      async executeComponentMethod() { return { ok: true, message: '飞船有效', shipId: 'ship-1', hullDefinitionId: 'hull-starter', raw: 'secret' }; },
    },
  });
  assert.equal(state.kind, 'ship-instance');
  assert.equal(state.page, 'hulls');
  assert.equal(state.shipId, 'ship-1');
  assert.equal(state.hullDefinitionId, 'hull-starter');
  assert.equal(state.raw, undefined);
});

test('新场景骨架只识别中文语义名，旧英文名按普通节点处理', async () => {
  const semantic = { uuid: 'canvas', name: '画布', parent: 'scene', position: { x: 1, y: 2, z: 0 }, children: [], components: [] };
  const semanticState = await recognizeAuthoringSelection({ selectedNode: semantic, tree: baseTree(semantic), componentClasses: [], rooms, scene: {} });
  assert.equal(semanticState.kind, 'semantic-node');
  assert.equal(semanticState.semanticRole, 'canvas');

  const legacy = { uuid: 'legacy', name: 'Canvas', parent: 'scene', children: [], components: [] };
  const legacyState = await recognizeAuthoringSelection({ selectedNode: legacy, tree: baseTree(legacy), componentClasses: [], rooms, crews, scene: {} });
  assert.equal(legacyState.kind, 'node');

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

test('无法执行 ShipView 白名单方法时仍返回可观察的飞船校验错误', async () => {
  const selected = { uuid: 'partial', name: '飞船视图', parent: 'scene', components: [{ type: 'ShipView', uuid: 'ship-view' }], children: [] };
  const state = await recognizeAuthoringSelection({ selectedNode: selected, tree: baseTree(selected), componentClasses: [], rooms, crews, scene: { async executeComponentMethod() { throw new Error('失败'); } } });
  assert.equal(state.kind, 'ship-instance');
  assert.equal(state.validation.ok, false);
  assert.match(state.validation.message, /无法读取/);
});
