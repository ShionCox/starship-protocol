const assert = require('node:assert/strict');
const test = require('node:test');

const { createCrewInstance } = require('../dist/crew/crew-scene-authoring.js');

const entry = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', prefabUuid: 'crew-prefab' };

function portWithOccupied(occupied = [], placementSucceeds = true) {
  const crewChildren = occupied.map((stationIndex, index) => ({ uuid: `crew-${index}`, name: `船员-${index}`, parent: 'crew-root', components: [{ type: 'CrewView', uuid: `crew-view-${index}` }], children: [] }));
  const tree = { uuid: 'scene', name: 'MainScene', children: [{ uuid: 'ship', name: '飞船视图', parent: 'scene', components: [{ type: 'ShipView', uuid: 'ship-view' }], children: [
    { uuid: 'rooms', name: '房间容器', parent: 'ship', children: [{ uuid: 'room-node', name: '房间-反应堆', parent: 'rooms', components: [{ type: 'RoomView', uuid: 'room-view' }], children: [] }] },
    { uuid: 'crew-root', name: '船员层', parent: 'ship', children: crewChildren },
  ] }] };
  const calls = [];
  let created = false;
  return {
    calls,
    async queryNodeTree() {
      if (created && !tree.children[0].children[1].children.some((node) => node.uuid === 'crew-new')) tree.children[0].children[1].children.push({ uuid: 'crew-new', name: '船员-工程师', parent: 'crew-root', components: [{ type: 'CrewView', uuid: 'crew-view-new' }], children: [] });
      return tree;
    },
    async queryComponents() { return []; },
    async queryComponent(uuid) { const index = Number(uuid.split('-').at(-1)); return Number.isInteger(index) ? { value: { crewInstanceId: { value: `crew-engineer-${index + 1}` } } } : null; },
    async executeComponentMethod(uuid, method) {
      if (uuid === 'room-view') return { ok: true, message: '有效', roomInstanceId: 'room-reactor-1', crewCapacity: 2 };
      if (uuid === 'crew-view-new' && method === 'applyEditorInitialPlacement') return placementSucceeds;
      const index = Number(uuid.split('-').at(-1));
      if (Number.isInteger(index)) return { ok: true, message: '有效', crewInstanceId: `crew-engineer-${index + 1}`, initialRoomInstanceId: 'room-reactor-1', initialStationIndex: occupied[index] };
      return undefined;
    },
    async createNode() { created = true; calls.push(['create']); return { uuid: 'crew-new' }; },
    async queryNodesByAssetUuid() { return ['crew-new']; },
    async setProperty(target, path, value) { calls.push(['set', path, value]); return true; },
    async beginRecording() { calls.push(['begin']); return 'undo-crew'; },
    async endRecording() { calls.push(['end']); },
    async cancelRecording() { calls.push(['cancel']); },
    async removeNode() { calls.push(['remove']); },
    async snapshotAbort() { calls.push(['abort']); },
  };
}

test('所选房间所属飞船内连续创建船员分配最低空闲站位', async () => {
  global.Editor = { Selection: { select() {} } };
  const first = portWithOccupied([]);
  const firstResult = await createCrewInstance(first, { nodeUuid: 'room-node' }, entry);
  assert.equal(firstResult.ok, true);
  assert.equal(first.calls.some((call) => call[0] === 'set' && call[1] === 'initialStationIndex' && call[2] === 0), true);
  const second = portWithOccupied([0]);
  const secondResult = await createCrewInstance(second, { nodeUuid: 'room-node' }, entry);
  assert.equal(secondResult.ok, true);
  assert.equal(second.calls.some((call) => call[0] === 'set' && call[1] === 'initialStationIndex' && call[2] === 1), true);
  delete global.Editor;
});

test('目标房间满员时在 Undo 和节点创建前失败', async () => {
  const port = portWithOccupied([0, 1]);
  const result = await createCrewInstance(port, { nodeUuid: 'room-node' }, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /目标房间已满/);
  assert.equal(port.calls.length, 0);
});

test('未选择目标房间时返回中文错误且不创建', async () => {
  const port = portWithOccupied([]);
  const result = await createCrewInstance(port, {}, entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /选择目标房间/);
  assert.equal(port.calls.length, 0);
});

test('船员初始站位应用失败时删除临时节点并取消 Undo', async () => {
  global.Editor = { Selection: { select() {} } };
  const port = portWithOccupied([], false);
  const result = await createCrewInstance(port, { nodeUuid: 'room-node' }, entry);
  assert.equal(result.ok, false);
  assert.equal(port.calls.some(([name]) => name === 'remove'), true);
  assert.equal(port.calls.some(([name]) => name === 'cancel'), true);
  assert.equal(port.calls.some(([name]) => name === 'abort'), true);
  delete global.Editor;
});
