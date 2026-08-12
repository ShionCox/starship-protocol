import assert from 'node:assert/strict';
import test from 'node:test';

import type { CrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import { CrewModel, type CrewInitialState } from '../../assets/scripts/game-core/CrewModel.ts';
import { NavigationGraph, stationNodeId } from '../../assets/scripts/game-core/NavigationGraph.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import type { RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';

const ENGINEER: CrewDefinition = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 };
const GUNNER: CrewDefinition = { id: 'crew-gunner', displayName: '武器操作员', role: 'GUNNER', maxHp: 100, moveTicksPerEdge: 5 };

function room(id: string, category: RoomDefinition['category'], crewCapacity: number): RoomDefinition {
  return { id: id.replace(/-1$/, ''), displayName: id, category, width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 0, crewCapacity };
}

const PLACEMENTS: readonly RoomPlacement[] = [
  { instanceId: 'room-reactor-1', definitionId: 'room-reactor', x: 0, y: 0, width: 2, height: 2 },
  { instanceId: 'room-elevator-1', definitionId: 'room-elevator', x: 2, y: 0, width: 2, height: 2 },
  { instanceId: 'room-laser-1', definitionId: 'room-laser', x: 4, y: 0, width: 2, height: 2 },
  { instanceId: 'room-shield-1', definitionId: 'room-shield', x: 6, y: 0, width: 2, height: 2 },
];
const DEFINITIONS = new Map<string, RoomDefinition>([
  ['room-reactor-1', room('room-reactor-1', 'ENERGY', 2)],
  ['room-elevator-1', room('room-elevator-1', 'MOVEMENT', 1)],
  ['room-laser-1', room('room-laser-1', 'WEAPON', 2)],
  ['room-shield-1', room('room-shield-1', 'DEFENSE', 2)],
]);
const INITIAL: readonly CrewInitialState[] = [
  { id: 'crew-engineer-1', definition: ENGINEER, roomId: 'room-reactor-1', stationIndex: 0 },
  { id: 'crew-gunner-1', definition: GUNNER, roomId: 'room-reactor-1', stationIndex: 1 },
];

function createModel(): { graph: NavigationGraph; model: CrewModel } {
  const graph = new NavigationGraph(PLACEMENTS, DEFINITIONS);
  return { graph, model: new CrewModel(graph, INITIAL) };
}

function advanceUntilIdle(model: CrewModel, crewId: string): void {
  for (let tick = 0; tick < 100 && model.getReadStates().find((crew) => crew.id === crewId)?.state === 'MOVING'; tick += 1) {
    model.advanceOneTick();
  }
}

test('最低站位预留、房间满员与失败原子性', () => {
  const { model } = createModel();
  assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-elevator-1' }).ok, true);
  advanceUntilIdle(model, 'crew-engineer-1');
  const before = model.getSnapshot();
  const full = model.apply({ type: 'MOVE_CREW', crewId: 'crew-gunner-1', targetRoomId: 'room-elevator-1' });
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.code, 'ROOM_FULL');
  assert.deepEqual(model.getSnapshot(), before);
  assert.equal(model.getReadStates().find((crew) => crew.id === 'crew-engineer-1')?.currentStationIndex, 0);
});

test('固定 Tick 移动、忙碌拒绝与两名船员独立移动', () => {
  const { model } = createModel();
  assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-laser-1' }).ok, true);
  const busy = model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-shield-1' });
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.code, 'CREW_BUSY');
  assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-gunner-1', targetRoomId: 'room-shield-1' }).ok, true);
  advanceUntilIdle(model, 'crew-engineer-1');
  advanceUntilIdle(model, 'crew-gunner-1');
  const states = model.getReadStates();
  assert.equal(states.find((crew) => crew.id === 'crew-engineer-1')?.currentRoomId, 'room-laser-1');
  assert.equal(states.find((crew) => crew.id === 'crew-gunner-1')?.currentRoomId, 'room-shield-1');
});

test('点击当前房间成功但不产生状态变化，RESET 等价由到达自然完成', () => {
  const { model } = createModel();
  const before = model.getSnapshot();
  const result = model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-reactor-1' });
  assert.equal(result.ok, true);
  assert.deepEqual(model.getSnapshot(), before);
});

test('快照恢复活动路径、新船员补默认，非法旧实例整份失败', () => {
  const { graph, model } = createModel();
  assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-laser-1' }).ok, true);
  for (let index = 0; index < 7; index += 1) model.advanceOneTick();
  const restored = CrewModel.restore(graph, INITIAL, model.getSnapshot());
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), model.getSnapshot());

  const missingGunner = { ...model.getSnapshot(), crews: model.getSnapshot().crews.filter((crew) => crew.id !== 'crew-gunner-1') };
  const withDefault = CrewModel.restore(graph, INITIAL, missingGunner);
  assert.equal(withDefault.ok, true);
  if (withDefault.ok) assert.equal(withDefault.model.getReadStates().find((crew) => crew.id === 'crew-gunner-1')?.currentRoomId, 'room-reactor-1');

  const oldCrew = { schemaVersion: 1, crews: [{ ...model.getSnapshot().crews[0], id: 'crew-old-1' }] };
  assert.equal(CrewModel.restore(graph, INITIAL, oldCrew).ok, false);
});

test('快照恢复拒绝当前位置、路径进度和状态互相矛盾的数据', () => {
  const { graph, model } = createModel();
  const idle = model.getSnapshot();
  const idlePathMismatch = {
    ...idle,
    crews: idle.crews.map((crew) => crew.id === 'crew-engineer-1'
      ? { ...crew, pathNodeIds: [stationNodeId('room-laser-1', 0)] }
      : crew),
  };
  assert.equal(CrewModel.restore(graph, INITIAL, idlePathMismatch).ok, false);

  assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-laser-1' }).ok, true);
  const moving = model.getSnapshot();
  const movingRoomMismatch = {
    ...moving,
    crews: moving.crews.map((crew) => crew.id === 'crew-engineer-1'
      ? { ...crew, currentRoomId: 'room-laser-1' }
      : crew),
  };
  assert.equal(CrewModel.restore(graph, INITIAL, movingRoomMismatch).ok, false);

  const movingAtEnd = {
    ...moving,
    crews: moving.crews.map((crew) => crew.id === 'crew-engineer-1'
      ? { ...crew, pathIndex: crew.pathNodeIds.length - 1 }
      : crew),
  };
  assert.equal(CrewModel.restore(graph, INITIAL, movingAtEnd).ok, false);

  const movingWithoutEdge = {
    ...moving,
    crews: moving.crews.map((crew) => crew.id === 'crew-engineer-1'
      ? { ...crew, pathNodeIds: [stationNodeId('room-laser-1', 0)], pathIndex: 0 }
      : crew),
  };
  assert.equal(CrewModel.restore(graph, INITIAL, movingWithoutEdge).ok, false);
});

test('相同初始状态、Command 与 Tick 序列重复 100 次结果一致', () => {
  let expected = '';
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const { model } = createModel();
    assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-laser-1' }).ok, true);
    assert.equal(model.apply({ type: 'MOVE_CREW', crewId: 'crew-gunner-1', targetRoomId: 'room-shield-1' }).ok, true);
    for (let tick = 0; tick < 30; tick += 1) model.advanceOneTick();
    const hash = JSON.stringify(model.getSnapshot());
    if (iteration === 0) expected = hash;
    else assert.equal(hash, expected);
  }
});
