const assert = require('node:assert/strict');
const test = require('node:test');

const { createCrewInstance } = require('../dist/crew/crew-scene-authoring.js');

const ENTRY = { schemaVersion: 1, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5, prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', prefabUuid: 'crew-prefab', configUrl: 'db://assets/config/crew/crew-engineer.json', configUuid: 'crew-config' };

function scene({ placed = true, capacity = 2, occupied = [], includeTargetRoom = true } = {}) {
  const calls = [];
  let created = false;
  const crewNodes = occupied.map((stationIndex, index) => ({
    uuid: `existing-crew-${index}`,
    name: `船员-已有${index + 1}`,
    components: [{ type: 'CrewView', uuid: `existing-crew-view-${index}`, nodeUuid: `existing-crew-${index}`, index: 0 }],
    children: [],
  }));
  return {
    calls,
    async queryNodeTree() {
      return {
        uuid: 'scene',
        name: 'PrototypeScene',
        children: [
          { uuid: 'crew-root', name: '船员层', children: created ? [...crewNodes, { uuid: 'crew-node', name: '船员-工程师', components: [{ type: 'CrewView', uuid: 'crew-view', nodeUuid: 'crew-node', index: 0 }], children: [] }] : crewNodes },
          ...(includeTargetRoom ? [{ uuid: 'room-node', name: '房间-反应堆', components: [{ type: 'RoomView', uuid: 'room-view', nodeUuid: 'room-node', index: 0 }], children: [] }] : []),
        ],
      };
    },
    async queryComponents() { return []; },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo'; },
    async createNode(options) { calls.push(['create', options]); created = true; return { uuid: 'crew-node' }; },
    async queryNodesByAssetUuid() { return ['crew-node']; },
    async queryComponent(uuid) {
      if (uuid === 'room-view') return { value: { roomInstanceId: 'room-reactor-1', crewCapacity: capacity } };
      const index = occupied[Number(uuid.split('-').at(-1))];
      return index === undefined ? { value: {} } : { value: { crewInstanceId: `existing-${index}`, initialRoomInstanceId: 'room-reactor-1', initialStationIndex: index } };
    },
    async setProperty(_target, path, value, options) { calls.push(['set', path, value, options]); return true; },
    async executeComponentMethod(uuid, name) {
      calls.push(['execute', uuid, name]);
      if (uuid === 'room-view' && name === 'getAuthoringInspectorState') return { ok: true, message: '有效', roomInstanceId: 'room-reactor-1', crewCapacity: capacity };
      if (name === 'getAuthoringInspectorState' && uuid.startsWith('existing-crew-view-')) {
        const index = occupied[Number(uuid.split('-').at(-1))];
        return { ok: true, message: '有效', crewInstanceId: `existing-${index}`, initialRoomInstanceId: 'room-reactor-1', initialStationIndex: index };
      }
      return placed;
    },
    async endRecording(id) { calls.push(['end', id]); },
    async cancelRecording(id) { calls.push(['cancel', id]); },
    async removeNode(uuid) { calls.push(['remove', uuid]); },
    async snapshotAbort() { calls.push(['abort']); },
  };
}

test('船员 Prefab 实例按目标房间最低空闲站位保留关联并形成一次 Undo', async () => {
  global.Editor = { Selection: { select() {} } };
  const port = scene({ occupied: [1] });
  const result = await createCrewInstance(port, {}, ENTRY);
  assert.equal(result.ok, true);
  assert.deepEqual(port.calls.filter(([name]) => name === 'begin' || name === 'end'), [['begin', 'crew-root'], ['end', 'undo']]);
  assert.deepEqual(port.calls.filter(([name]) => name === 'set').map((call) => [call[1], call[2]]), [['crewInstanceId', 'crew-engineer-1'], ['initialRoomInstanceId', 'room-reactor-1'], ['initialStationIndex', 0]]);
  delete global.Editor;
});

test('船员创建不按职业写死站位，而是选择最小空闲索引', async () => {
  const port = scene({ occupied: [0] });
  const result = await createCrewInstance(port, {}, { ...ENTRY, role: 'GUNNER', id: 'crew-gunner' });
  assert.equal(result.ok, true);
  assert.equal(port.calls.some(([name, path, value]) => name === 'set' && path === 'initialStationIndex' && value === 1), true);
});

test('目标房间满员时在 Undo 和 createNode 前失败', async () => {
  const port = scene({ capacity: 2, occupied: [0, 1] });
  const result = await createCrewInstance(port, {}, ENTRY);
  assert.equal(result.ok, false);
  assert.match(result.message, /目标房间已满/);
  assert.equal(port.calls.some(([name]) => name === 'begin'), false);
  assert.equal(port.calls.some(([name]) => name === 'create'), false);
});

test('目标房间不存在时在 Undo 和 createNode 前返回中文错误', async () => {
  const port = scene({ includeTargetRoom: false });
  const result = await createCrewInstance(port, {}, ENTRY);
  assert.equal(result.ok, false);
  assert.match(result.message, /目标房间不存在/);
  assert.equal(port.calls.some(([name]) => name === 'begin'), false);
  assert.equal(port.calls.some(([name]) => name === 'create'), false);
});

test('船员初始站位失败时删除临时节点并取消 Undo', async () => {
  const port = scene({ placed: false });
  const result = await createCrewInstance(port, {}, ENTRY);
  assert.equal(result.ok, false);
  assert.ok(port.calls.some(([name]) => name === 'remove'));
  assert.ok(port.calls.some(([name]) => name === 'cancel'));
});
