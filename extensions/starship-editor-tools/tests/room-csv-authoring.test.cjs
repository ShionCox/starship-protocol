const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseConnectorPortsEditorText,
  toRoomPreviewDto,
  replaceRoomCsvDraft,
  updateRoomInstance,
} = require('../dist/rooms/room-csv-authoring.js');

function draft(overrides = {}) {
  return {
    id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: '4', height: '3', maxLevel: '1', maxHp: '100',
    minPower: '0', maxPower: '0', powerGeneration: '10', crewCapacity: '2', healingHpPerTick: '0',
    verticalConnectorKind: 'NONE', visualId: 'visual-reactor', metalCost: '150', buildDurationMs: '30000',
    demolishDurationMs: '10000', refundPermille: '500', connectorPorts: [], ...overrides,
  };
}

test('房间草稿只生成白名单 schema3 预览 DTO，非法枚举在预览前拒绝', () => {
  const result = toRoomPreviewDto(draft());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.dto.schemaVersion, 3);
    assert.equal(result.dto.width, 4);
    assert.equal(result.dto.powerGeneration, 10);
    assert.equal('configUrl' in result.dto, false);
  }
  assert.equal(toRoomPreviewDto(draft({ category: 'INVALID' })).ok, false);
  assert.equal(toRoomPreviewDto(draft({ verticalConnectorKind: 'ELEVATOR' })).ok, false);
});

test('连接器文本按六列白名单解析并强制当前房间定义 ID', () => {
  const result = parseConnectorPortsEditorText('port-elevator-lower,下层停靠口,room-other,1,RIGHT,5', 'room-reactor');
  assert.deepEqual(result, [{ id: 'port-elevator-lower', displayName: '下层停靠口', roomDefinitionId: 'room-reactor', stopY: '1', entrySide: 'RIGHT', verticalMoveTicks: '5' }]);
  assert.deepEqual(parseConnectorPortsEditorText('', 'room-reactor'), []);
});

test('替换房间 CSV 行保留表头、中文说明和其他行，并同步连接器行', () => {
  const tables = {
    'rooms.csv': 'id,displayName,category,width,height,maxLevel,maxHp,minPower,maxPower,powerGeneration,crewCapacity,healingHpPerTick,verticalConnectorKind,visualId,metalCost,buildDurationMs,demolishDurationMs,refundPermille\n#稳定标识,中文名称,分类,宽度,高度,最大等级,最大生命,最小耗能,最大耗能,发电量,船员容量,每Tick治疗,垂直连接器类型,视觉标识,金属成本,建造时长毫秒,拆除时长毫秒,返还千分比\nroom-reactor,旧名,ENERGY,4,3,1,100,0,0,10,2,0,NONE,visual-reactor,150,30000,10000,500\nroom-laser,激光室,WEAPON,4,3,1,100,2,6,0,2,0,NONE,visual-laser,120,25000,8000,500\n',
    'connector-ports.csv': 'id,displayName,roomDefinitionId,stopY,entrySide,verticalMoveTicks\n#稳定标识,中文名称,房间定义标识,停靠纵坐标,进入侧,垂直移动Tick数\nport-old,旧口,room-reactor,1,RIGHT,5\nport-laser,激光口,room-laser,1,LEFT,4\n',
  };
  const replaced = replaceRoomCsvDraft(tables, draft({ displayName: '新反应堆', category: 'MOVEMENT', powerGeneration: '0', verticalConnectorKind: 'ELEVATOR', connectorPorts: [{ id: 'port-new', displayName: '新口', roomDefinitionId: 'room-reactor', stopY: '2', entrySide: 'RIGHT', verticalMoveTicks: '5' }] }));
  assert.match(replaced['rooms.csv'], /room-reactor,新反应堆/);
  assert.match(replaced['rooms.csv'], /room-laser,激光室/);
  assert.doesNotMatch(replaced['connector-ports.csv'], /port-old/);
  assert.match(replaced['connector-ports.csv'], /port-new,新口,room-reactor/);
  assert.match(replaced['connector-ports.csv'], /port-laser,激光口,room-laser/);
});

test('实例编辑只写 x/y/initialHp，并在一次 recording 中提交；失败取消 recording', async () => {
  const calls = [];
  const scene = {
    async queryNodeTree() { return { uuid: 'root', children: [{ uuid: 'room-node', components: [{ value: 'room-view', type: 'RoomView' }] }] }; },
    async queryComponents() { return []; },
    async executeComponentMethod(uuid, name, args) { calls.push(['method', uuid, name, args]); if (name === 'getAuthoringInspectorState') return { maxHp: 100 }; return true; },
    async beginRecording(uuid) { calls.push(['begin', uuid]); return 'undo-room'; },
    async endRecording(uuid) { calls.push(['end', uuid]); },
    async cancelRecording(uuid) { calls.push(['cancel', uuid]); },
    async setProperty(target, path, value, options) { calls.push(['set', target.uuid, path, value, options]); return true; },
    async snapshotAbort() { calls.push(['abort']); },
  };
  const ok = await updateRoomInstance(scene, { nodeUuid: 'room-node', x: 2, y: 3, initialHp: 60 });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls.filter((call) => call[0] === 'begin' || call[0] === 'end'), [['begin', 'room-node'], ['end', 'undo-room']]);
  assert.equal(calls.some((call) => call[0] === 'set' && call[2] === 'initialHp' && call[4].record === false), true);
  assert.equal(calls.some((call) => call[0] === 'method' && call[2] === 'applyEditorPlacement'), true);
  const failed = await updateRoomInstance({ ...scene, async executeComponentMethod(uuid, name) { if (name === 'getAuthoringInspectorState') return { maxHp: 100 }; return false; } }, { nodeUuid: 'room-node', x: 2, y: 3, initialHp: 60 });
  assert.equal(failed.ok, false);
  assert.equal(calls.some((call) => call[0] === 'cancel'), true);
});
