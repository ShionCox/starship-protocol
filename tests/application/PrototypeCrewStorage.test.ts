import assert from 'node:assert/strict';
import test from 'node:test';

import type { CrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import { CrewModel, type CrewInitialState } from '../../assets/scripts/game-core/CrewModel.ts';
import { NavigationGraph } from '../../assets/scripts/game-core/NavigationGraph.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import type { RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';
import {
  PROTOTYPE_CREW_STORAGE_KEY,
  advancePrototypeCrewTick,
  applyPrototypeCrewCommand,
  loadPrototypeCrew,
  savePrototypeCrew,
} from '../../assets/scripts/bootstrap/PrototypeCrewStorage.ts';
import type { KeyValueStorage } from '../../assets/scripts/bootstrap/PrototypeLayoutStorage.ts';

const ENGINEER: CrewDefinition = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 1 };
const placements: readonly RoomPlacement[] = [
  { id: 'room-reactor-1', x: 0, y: 0, width: 2, height: 2 },
  { id: 'room-elevator-1', x: 2, y: 0, width: 2, height: 2 },
];
const room = (id: string, capacity: number): RoomDefinition => ({ id: id.replace(/-1$/, ''), displayName: id, category: id.includes('elevator') ? 'MOVEMENT' : 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: id.includes('reactor') ? 10 : 0, crewCapacity: capacity });
const definitions = new Map<string, RoomDefinition>([
  ['room-reactor-1', room('room-reactor-1', 1)],
  ['room-elevator-1', room('room-elevator-1', 1)],
]);
const graph = new NavigationGraph(placements, definitions);
const initial: readonly CrewInitialState[] = [{ id: 'crew-engineer-1', definition: ENGINEER, roomId: 'room-reactor-1', stationIndex: 0 }];

function storage(value: string | null = null): KeyValueStorage & { value: string | null } {
  return {
    value,
    getItem(key) { assert.equal(key, PROTOTYPE_CREW_STORAGE_KEY); return this.value; },
    setItem(key, next) { assert.equal(key, PROTOTYPE_CREW_STORAGE_KEY); this.value = next; },
  };
}

test('船员存档使用独立 key 保存和恢复', () => {
  const model = new CrewModel(graph, initial);
  const target = storage();
  assert.deepEqual(savePrototypeCrew(model, target), { ok: true });
  const loaded = loadPrototypeCrew(graph, initial, target);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.deepEqual(loaded.model.getSnapshot(), model.getSnapshot());
});

test('localStorage 读写异常可观察，非法旧快照整份失败', () => {
  const failing = { getItem() { throw new Error('读取失败'); }, setItem() { throw new Error('写入失败'); } };
  const loaded = loadPrototypeCrew(graph, initial, failing);
  assert.equal(loaded.status, 'error');
  if (loaded.status === 'error') assert.match(loaded.message, /读取失败/);
  const saved = savePrototypeCrew(new CrewModel(graph, initial), failing);
  assert.equal(saved.ok, false);
  if (!saved.ok) assert.match(saved.message, /写入失败/);
  assert.equal(loadPrototypeCrew(graph, initial, storage(JSON.stringify({ schemaVersion: 2, crews: [] }))).status, 'error');
  const corrupted = new CrewModel(graph, initial).getSnapshot();
  const corruptedIdle = {
    ...corrupted,
    crews: corrupted.crews.map((crew) => ({ ...crew, pathNodeIds: ['room:room-laser-1:station:0'] })),
  };
  assert.equal(loadPrototypeCrew(graph, initial, storage(JSON.stringify(corruptedIdle))).status, 'error');
});

test('Command 保存失败回滚，跨边保存失败回滚并暂停', () => {
  const failing = { getItem() { return null; }, setItem() { throw new Error('磁盘只读'); } };
  const source = new CrewModel(graph, initial);
  const command = applyPrototypeCrewCommand(source, graph, initial, { type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-elevator-1' }, failing);
  assert.equal(command.ok, false);
  assert.equal(command.model.getReadStates()[0].state, 'IDLE');

  const moving = new CrewModel(graph, initial);
  assert.equal(moving.apply({ type: 'MOVE_CREW', crewId: 'crew-engineer-1', targetRoomId: 'room-elevator-1' }).ok, true);
  const tick = advancePrototypeCrewTick(moving, graph, initial, failing);
  assert.equal(tick.ok, false);
  assert.equal(tick.paused, true);
  assert.equal(tick.model.getReadStates()[0].ticksIntoEdge, 0);
});
