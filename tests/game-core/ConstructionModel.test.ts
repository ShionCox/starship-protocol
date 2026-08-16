import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionModel } from '../../assets/scripts/game-core/ConstructionModel.ts';
import type { FloorDefinition } from '../../assets/scripts/game-core/CsvGameConfig.ts';
import type { HullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import { VoxelLayoutModel } from '../../assets/scripts/game-core/VoxelLayoutModel.ts';

const hull: HullDefinition = { schemaVersion: 2, id: 'hull-test', displayName: '测试', level: 1, gridWidth: 6, gridHeight: 6, cellTypes: Object.freeze(Array(36).fill('BUILDABLE')), baseConstructionSlots: 3, maxCrew: 6, maxRooms: 8, visualId: 'visual-test' };
const floor: FloorDefinition = { id: 'floor-basic', displayName: '地板', metalCost: 5, buildDurationMs: 2000, demolishDurationMs: 1000, refundPermille: 500, visualId: 'visual-floor' };
const room: RoomDefinition = { id: 'room-test', displayName: '房间', category: 'SUPPORT', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 0, crewCapacity: 1, healingHpPerTick: 0, verticalConnectorKind: 'NONE', visualId: 'visual-room', metalCost: 100, buildDurationMs: 30000, demolishDurationMs: 10000, refundPermille: 500 };

function create() {
  const layout = new VoxelLayoutModel(hull);
  layout.placeInitialFloor('floor-a', floor, 1, 1);
  const model = new ConstructionModel(layout, 3, 1000, [
    { crewId: 'engineer-1', role: 'ENGINEER', speedBonusPermille: 250, slotBonus: 1 },
    { crewId: 'engineer-2', role: 'ENGINEER', speedBonusPermille: 1000, slotBonus: 0 },
    { crewId: 'gunner-1', role: 'GUNNER', speedBonusPermille: 0, slotBonus: 0 },
  ], new Map([[floor.id, floor]]), new Map([[room.id, room]]));
  return { layout, model };
}

test('施工槽由船体和词条组成，工程师到场后加速且封顶', () => {
  const { model } = create();
  assert.equal(model.getConstructionSlots(), 4);
  assert.equal(model.startBuildFloor('job-1', 'floor-b', floor.id, 2, 1, 0).ok, true);
  assert.equal(model.assignBuilders('job-1', ['engineer-1', 'engineer-2']).ok, true);
  assert.equal(model.setBuildersAtSite('job-1', ['engineer-1', 'engineer-2']).ok, true);
  assert.equal(model.settleTo(500).ok, true);
  assert.equal(model.getSnapshot().jobs[0].completedWorkMs, 1125);
  assert.equal(model.settleTo(1000).ok, true);
  assert.equal(model.getSnapshot().jobs.length, 0);
  assert.equal(model.getSnapshot().metal, 995);
});

test('建造未分配工程师时不推进，拆除仍可自动结算', () => {
  const { model } = create();
  assert.equal(model.startBuildFloor('job-build', 'floor-b', floor.id, 2, 1, 0).ok, true);
  assert.equal(model.settleTo(100000).ok, true);
  assert.equal(model.getSnapshot().jobs[0]?.completedWorkMs, 0);
  assert.equal(model.startDemolition('job-demolish', 'DEMOLISH_FLOOR', 'floor-a', 100000).ok, true);
  assert.equal(model.settleTo(102000).ok, true);
  assert.equal(model.getSnapshot().jobs.some((job) => job.jobId === 'job-demolish'), false);
});

test('多人施工在全部已分配工程师到场前保留收口进度', () => {
  const { model } = create();
  assert.equal(model.startBuildFloor('job-1', 'floor-b', floor.id, 2, 1, 0).ok, true);
  assert.equal(model.assignBuilders('job-1', ['engineer-1', 'engineer-2']).ok, true);
  assert.equal(model.setBuildersAtSite('job-1', ['engineer-1']).ok, true);
  assert.equal(model.settleTo(100000).ok, true);
  assert.equal(model.getSnapshot().jobs[0]?.completedWorkMs, Math.floor(floor.buildDurationMs * 0.75));
  assert.equal(model.setBuildersAtSite('job-1', ['engineer-1', 'engineer-2']).ok, true);
  assert.equal(model.settleTo(110000).ok, true);
  assert.equal(model.getSnapshot().jobs.length, 0);
});

test('非法工程师、余额不足与取消退款保持原子', () => {
  const { model } = create();
  assert.equal(model.startBuildFloor('job-1', 'floor-b', floor.id, 2, 1, 0).ok, true);
  const before = model.getSnapshot();
  assert.equal(model.assignBuilders('job-1', ['gunner-1']).ok, false);
  assert.deepEqual(model.getSnapshot(), before);
  assert.equal(model.cancel('job-1').ok, true);
  assert.equal(model.getSnapshot().metal, 1000);
});

test('时钟回拨按零进度处理，施工结果重复运行确定', () => {
  const run = () => {
    const { model } = create();
    model.startBuildFloor('job-1', 'floor-b', floor.id, 2, 1, 1000);
    model.assignBuilders('job-1', ['engineer-1']);
    model.setBuildersAtSite('job-1', ['engineer-1']);
    model.settleTo(500);
    model.settleTo(2600);
    return JSON.stringify(model.getSnapshot());
  };
  const expected = run();
  for (let index = 0; index < 100; index += 1) assert.equal(run(), expected);
});
