import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import { CrewModel } from '../../assets/scripts/game-core/CrewModel.ts';
import { connectorStopNodeId, floorNodeId, NavigationGraph } from '../../assets/scripts/game-core/NavigationGraph.ts';
import { placement, roomDefinition } from './fixtures.ts';

const SOLDIER: CrewDefinition = {
  id: 'crew-soldier', displayName: '士兵', role: 'SOLDIER', rarity: 'COMMON', maxHp: 100,
  moveTicksPerEdge: 1, repairHpPerTick: 0, appearanceId: 'appearance-soldier', traitIds: Object.freeze([]),
};

function graph(): NavigationGraph {
  const definition = roomDefinition('room-type', 'SUPPORT', 2);
  const placements = [placement('room-a', definition.id, 0, 0), placement('room-b', definition.id, 2, 0), placement('room-c', definition.id, 4, 0)];
  return new NavigationGraph(placements, new Map(placements.map((entry) => [entry.instanceId, definition])));
}

test('士兵按实例路线巡逻，玩家移动立即打断并在十 Tick 后恢复', () => {
  const model = new CrewModel(graph(), [{ id: 'soldier-1', definition: SOLDIER, roomId: 'room-a', stationIndex: 0, patrolRoomIds: ['room-b', 'room-c'] }]);
  model.advanceOneTick();
  assert.equal(model.getReadStates()[0].state, 'PATROLLING');
  const interrupted = model.apply({ type: 'MOVE_CREW', crewId: 'soldier-1', targetRoomId: 'room-c' });
  assert.equal(interrupted.ok, true);
  assert.equal(model.getReadStates()[0].state, 'MOVING');
  for (let index = 0; index < 8; index += 1) model.advanceOneTick();
  assert.equal(model.getReadStates()[0].currentRoomId, 'room-c');
  assert.equal(model.getReadStates()[0].state, 'IDLE');
  let resumed = false;
  for (let index = 0; index < 20; index += 1) {
    model.advanceOneTick();
    resumed ||= model.getReadStates()[0].state === 'PATROLLING';
  }
  assert.equal(resumed, true);
});

test('普通船员不生成巡逻状态，工程师到场后进入施工并可释放', () => {
  const engineer: CrewDefinition = { ...SOLDIER, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', rarity: 'RARE', repairHpPerTick: 1, appearanceId: 'appearance-engineer', traitIds: Object.freeze(['trait-construction-speed-250']) };
  const model = new CrewModel(voxelGraph(), [{ id: 'engineer-1', definition: engineer, roomId: 'room-a', stationIndex: 0 }]);
  for (let index = 0; index < 20; index += 1) model.advanceOneTick();
  assert.equal(model.getReadStates()[0].state, 'IDLE');
  assert.equal(model.assignConstructionJob('engineer-1', 'job-1', floorNodeId(2, 1)).ok, true);
  for (let index = 0; index < 4; index += 1) model.advanceOneTick();
  assert.equal(model.getReadStates()[0].state, 'CONSTRUCTING');
  assert.equal(model.releaseConstructionJob('job-1'), true);
  assert.equal(model.getReadStates()[0].state, 'IDLE');
});

test('巡逻快照保存路线、游标和图版本，旧版本整份拒绝', () => {
  const navigation = graph();
  const initial = [{ id: 'soldier-1', definition: SOLDIER, roomId: 'room-a', stationIndex: 0, patrolRoomIds: ['room-b', 'room-c'] }] as const;
  const model = new CrewModel(navigation, initial);
  model.advanceOneTick();
  const snapshot = model.getSnapshot();
  assert.deepEqual(snapshot.crews[0].patrolRoomIds, ['room-b', 'room-c']);
  assert.equal(CrewModel.restore(navigation, initial, snapshot).ok, true);
  assert.equal(CrewModel.restore(navigation, initial, { ...snapshot, schemaVersion: 5 }).ok, false);
});

function voxelGraph(): NavigationGraph {
  const room = roomDefinition('room-voxel', 'SUPPORT', 2);
  const elevator = { ...room, id: 'room-elevator', category: 'MOVEMENT' as const, width: 1, height: 4, crewCapacity: 0, verticalConnectorKind: 'ELEVATOR' as const };
  const placements = [
    { instanceId: 'room-a', definitionId: room.id, x: 1, y: 2, width: 2, height: 2 },
    { instanceId: 'elevator-1', definitionId: elevator.id, x: 4, y: 2, width: 1, height: 4 },
  ];
  const floors = [1, 2, 3].flatMap((x) => [
    { instanceId: `floor-${x}-1`, x, y: 1, completed: true },
    { instanceId: `floor-${x}-5`, x, y: 5, completed: true },
  ]);
  return new NavigationGraph(placements, new Map([['room-a', room], ['elevator-1', elevator]]), {
    floors,
    connectors: [{
      roomInstanceId: 'elevator-1', definitionId: elevator.id, completed: true,
      ports: [
        { id: 'low', displayName: '下层', roomDefinitionId: elevator.id, stopY: 1, entrySide: 'LEFT', verticalMoveTicks: 5 },
        { id: 'high', displayName: '上层', roomDefinitionId: elevator.id, stopY: 5, entrySide: 'LEFT', verticalMoveTicks: 5 },
      ],
    }],
  });
}

test('玩家订单可逐格停在普通地板，地板预留唯一且连接器不能作为终点', () => {
  const walker: CrewDefinition = { ...SOLDIER, id: 'crew-walker', role: 'GUNNER', moveTicksPerEdge: 2, appearanceId: 'appearance-walker' };
  const model = new CrewModel(voxelGraph(), [
    { id: 'walker-a', definition: walker, roomId: 'room-a', stationIndex: 0 },
    { id: 'walker-b', definition: walker, roomId: 'room-a', stationIndex: 1 },
  ]);
  const issued = model.apply({ type: 'ISSUE_MOVE_ORDER', crewId: 'walker-a', targetNodeId: floorNodeId(3, 1) });
  assert.equal(issued.ok, true);
  assert.equal(model.apply({ type: 'ISSUE_MOVE_ORDER', crewId: 'walker-b', targetNodeId: floorNodeId(3, 1) }).ok, false);
  assert.equal(model.apply({ type: 'ISSUE_MOVE_ORDER', crewId: 'walker-b', targetNodeId: connectorStopNodeId('elevator-1', 'low') }).ok, false);
  for (let tick = 0; tick < 8; tick += 1) model.advanceOneTick();
  const arrived = model.getSnapshot().crews.find((crew) => crew.id === 'walker-a');
  assert.equal(arrived?.state, 'IDLE');
  assert.equal(arrived?.currentNodeId, floorNodeId(3, 1));
  assert.equal(arrived?.currentRoomId, null);
  assert.equal(arrived?.currentStationIndex, null);
});

test('中途停止移动回到最后完整节点，电梯纵向边按五 Tick 推进', () => {
  const walker: CrewDefinition = { ...SOLDIER, id: 'crew-walker', role: 'GUNNER', moveTicksPerEdge: 2, appearanceId: 'appearance-walker' };
  const model = new CrewModel(voxelGraph(), [{ id: 'walker-a', definition: walker, roomId: 'room-a', stationIndex: 0 }]);
  assert.equal(model.apply({ type: 'ISSUE_MOVE_ORDER', crewId: 'walker-a', targetNodeId: floorNodeId(3, 5) }).ok, true);
  for (let tick = 0; tick < 7; tick += 1) model.advanceOneTick();
  const beforeCancel = model.getSnapshot().crews[0];
  assert.equal(beforeCancel.ticksIntoEdge > 0, true);
  assert.equal(model.apply({ type: 'CANCEL_CREW_ORDER', crewId: 'walker-a' }).ok, true);
  const cancelled = model.getSnapshot().crews[0];
  assert.equal(cancelled.state, 'IDLE');
  assert.equal(cancelled.pathNodeIds.length, 1);
  assert.equal(cancelled.pathNodeIds[0], cancelled.currentNodeId);
  assert.equal(cancelled.ticksIntoEdge, 0);
});

test('逐格订单、跨层 Tick 与 schema 6 快照重复一百次结果一致', () => {
  const walker: CrewDefinition = { ...SOLDIER, id: 'crew-walker', role: 'GUNNER', moveTicksPerEdge: 2, appearanceId: 'appearance-walker' };
  const results = new Set<string>();
  for (let run = 0; run < 100; run += 1) {
    const navigation = voxelGraph();
    const initial = [{ id: 'walker-a', definition: walker, roomId: 'room-a', stationIndex: 0 }] as const;
    const model = new CrewModel(navigation, initial);
    assert.equal(model.apply({ type: 'ISSUE_MOVE_ORDER', crewId: 'walker-a', targetNodeId: floorNodeId(3, 5) }).ok, true);
    for (let tick = 0; tick < 20; tick += 1) model.advanceOneTick();
    const snapshot = model.getSnapshot();
    assert.equal(snapshot.schemaVersion, 6);
    assert.equal(CrewModel.restore(navigation, initial, snapshot).ok, true);
    results.add(JSON.stringify(snapshot));
  }
  assert.equal(results.size, 1);
});
