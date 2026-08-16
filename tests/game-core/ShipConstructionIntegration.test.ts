import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseGameConfigCsvBundle } from '../../assets/scripts/game-core/CsvGameConfig.ts';
import { ShipModel, type ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';

const ROOT = new URL('../../assets/config/csv/', import.meta.url);
const parsed = parseGameConfigCsvBundle({
  game: read('game.csv'), hulls: read('hulls.csv'), rooms: read('rooms.csv'),
  connectorPorts: read('connector-ports.csv'), floors: read('floors.csv'), crews: read('crews.csv'), crewTraits: read('crew-traits.csv'),
});
if (parsed.ok === false) throw new Error(parsed.message);
const CONFIG = parsed.config;

function read(name: string): string { return readFileSync(new URL(name, ROOT), 'utf8'); }

function blueprint(): ShipModelBlueprint {
  const hull = CONFIG.hulls.find((entry) => entry.id === 'hull-starter')!;
  const reactor = CONFIG.rooms.find((entry) => entry.id === 'room-reactor')!;
  const engineer = CONFIG.crews.find((entry) => entry.id === 'crew-engineer')!;
  const traits = new Map(CONFIG.crewTraits.map((entry) => [entry.id, entry]));
  return {
    shipId: 'ship-1', configVersion: CONFIG.configVersion, hull,
    floors: Array.from({ length: 10 }, (_, index) => ({ instanceId: `floor-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 1 })),
    rooms: [{ instanceId: 'room-reactor-1', definition: reactor, x: 1, y: 2 }],
    crews: [{ instanceId: 'crew-engineer-1', definition: engineer, roomInstanceId: 'room-reactor-1', stationIndex: 0 }],
    construction: {
      initialMetal: CONFIG.initialMetal,
      floorDefinitions: CONFIG.floors,
      roomDefinitions: CONFIG.rooms,
      connectorPorts: CONFIG.connectorPorts,
      crewProfiles: [{
        crewId: 'crew-engineer-1', role: engineer.role,
        speedBonusPermille: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SPEED_PERMILLE' ? traits.get(id)!.effectValue : 0), 0),
        slotBonus: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SLOT_BONUS' ? traits.get(id)!.effectValue : 0), 0),
      }],
    },
  };
}

test('ShipModel 建造 Command 扣金属、分配工程师并按外部时间完成房间', () => {
  const model = new ShipModel(blueprint());
  const started = model.apply({ type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'job-medbay', roomInstanceId: 'room-medbay-1', roomDefinitionId: 'room-medbay', x: 6, y: 2, nowUnixMs: 1000 });
  assert.equal(started.ok, true);
  assert.equal(model.getConstructionMetal(), 900);
  const assigned = model.apply({ type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-medbay', crewInstanceIds: ['crew-engineer-1'] });
  assert.equal(assigned.ok, true);
  assert.equal(['MOVING', 'CONSTRUCTING'].includes(model.getSnapshot().crews.crews[0].state), true);
  for (let tick = 0; tick < 40 && model.getSnapshot().crews.crews[0].state !== 'CONSTRUCTING'; tick += 1) model.advanceOneTick();
  assert.equal(model.getSnapshot().crews.crews[0].state, 'CONSTRUCTING');
  assert.deepEqual(model.getSnapshot().constructionJobs[0]?.buildersAtSite, ['crew-engineer-1']);
  const settled = model.settleConstruction(17000);
  assert.equal(settled.ok, true);
  assert.equal(settled.snapshot.constructionJobs.length, 0);
  assert.equal(settled.snapshot.rooms.some((room) => room.instanceId === 'room-medbay-1'), true);
  assert.equal(settled.snapshot.crews.crews[0].state, 'IDLE');
});

test('建造预览只读复用正式占地校验并拒绝已预留矩形', () => {
  const model = new ShipModel(blueprint());
  const before = model.getSnapshot();
  const preview = model.previewConstruction('ROOM', 'room-medbay', 6, 2);
  assert.equal(preview.ok, true);
  assert.equal(preview.width, 4);
  assert.equal(preview.height, 3);
  assert.deepEqual(model.getSnapshot(), before);
  const metalBeforeStart = model.getConstructionMetal();
  assert.equal(model.apply({ type: 'START_BUILD_FLOOR', shipId: 'ship-1', jobId: 'preview-reserve', floorInstanceId: 'floor-11', floorDefinitionId: 'floor-basic', x: 11, y: 1, nowUnixMs: 0 }).ok, true);
  const reserved = model.previewConstruction('FLOOR', 'floor-basic', 11, 1);
  assert.equal(reserved.ok, false);
  assert.equal(reserved.code, 'TARGET_RESERVED');
  assert.equal(model.getConstructionMetal(), (metalBeforeStart ?? 0) - 5);
});

test('施工快照恢复队列，旧定义、重复工程师与无支撑开工失败保持原子', () => {
  const model = new ShipModel(blueprint());
  const before = model.getSnapshot();
  const unsupported = model.apply({ type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'bad', roomInstanceId: 'room-medbay-1', roomDefinitionId: 'room-medbay', x: 12, y: 2, nowUnixMs: 0 });
  assert.equal(unsupported.ok, false);
  assert.deepEqual(model.getSnapshot(), before);
  assert.equal(model.apply({ type: 'START_BUILD_FLOOR', shipId: 'ship-1', jobId: 'floor-job', floorInstanceId: 'floor-11', floorDefinitionId: 'floor-basic', x: 11, y: 1, nowUnixMs: 10 }).ok, true);
  const snapshot = model.getSnapshot();
  const restored = ShipModel.restore(blueprint(), snapshot);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), snapshot);
});

test('施工快照拒绝队列与船员后台任务不一致的永久 1/N 状态', () => {
  const model = new ShipModel(blueprint());
  assert.equal(model.apply({ type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'job-medbay', roomInstanceId: 'room-medbay-1', roomDefinitionId: 'room-medbay', x: 6, y: 2, nowUnixMs: 0 }).ok, true);
  assert.equal(model.apply({ type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-medbay', crewInstanceIds: ['crew-engineer-1'] }).ok, true);
  const snapshot = model.getSnapshot();
  const inconsistent = {
    ...snapshot,
    constructionJobs: snapshot.constructionJobs.map((job) => ({ ...job, assignedCrewIds: [], buildersAtSite: [] })),
  };
  const restored = ShipModel.restore(blueprint(), inconsistent);
  assert.equal(restored.ok, false);
  if (restored.ok === false) assert.match(restored.message, /施工项目与工程师任务不一致|工程师施工分配未写入船员任务|船员未被当前施工项目分配/);
});

test('拆除地板完成后退款，取消拆除保持目标与金属不变', () => {
  const model = new ShipModel(blueprint());
  const beforeMetal = model.getConstructionMetal();
  const start = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'demolish-floor',
    targetInstanceId: 'floor-10', targetType: 'FLOOR', nowUnixMs: 1000,
  });
  assert.equal(start.ok, true);
  assert.equal(model.getSnapshot().floors.some((floor) => floor.instanceId === 'floor-10'), true);
  const cancelled = model.apply({ type: 'CANCEL_CONSTRUCTION', shipId: 'ship-1', jobId: 'demolish-floor' });
  assert.equal(cancelled.ok, true);
  assert.equal(model.getConstructionMetal(), beforeMetal);
  assert.equal(model.getSnapshot().floors.some((floor) => floor.instanceId === 'floor-10'), true);

  const restart = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'demolish-floor-again',
    targetInstanceId: 'floor-10', targetType: 'FLOOR', nowUnixMs: 2000,
  });
  assert.equal(restart.ok, true);
  const floorDefinition = CONFIG.floors.find((entry) => entry.id === 'floor-basic')!;
  const settled = model.settleConstruction(2000 + floorDefinition.demolishDurationMs);
  assert.equal(settled.ok, true);
  assert.equal(model.getSnapshot().floors.some((floor) => floor.instanceId === 'floor-10'), false);
  assert.equal(model.getConstructionMetal(), beforeMetal + Math.floor(floorDefinition.metalCost * floorDefinition.refundPermille / 1000));
});

test('拆除校验拒绝支撑房间、占员房间和重复预留', () => {
  const model = new ShipModel(blueprint());
  const before = model.getSnapshot();
  const supportingFloor = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'supporting-floor',
    targetInstanceId: 'floor-1', targetType: 'FLOOR', nowUnixMs: 0,
  });
  assert.equal(supportingFloor.ok, false);
  assert.deepEqual(model.getSnapshot(), before);

  const occupiedRoom = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'occupied-room',
    targetInstanceId: 'room-reactor-1', targetType: 'ROOM', nowUnixMs: 0,
  });
  assert.equal(occupiedRoom.ok, false);
  assert.deepEqual(model.getSnapshot(), before);

  const reserved = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'reserved-floor',
    targetInstanceId: 'floor-10', targetType: 'FLOOR', nowUnixMs: 0,
  });
  assert.equal(reserved.ok, true);
  const duplicate = model.apply({
    type: 'START_DEMOLITION', shipId: 'ship-1', jobId: 'duplicate-floor',
    targetInstanceId: 'floor-10', targetType: 'FLOOR', nowUnixMs: 0,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(model.getSnapshot().constructionJobs.length, 1);
});

test('三名工程师在首选工地房间满员时分散到其他稳定工位', () => {
  const base = blueprint();
  const engineer = CONFIG.crews.find((entry) => entry.id === 'crew-engineer')!;
  const shield = CONFIG.rooms.find((entry) => entry.id === 'room-shield')!;
  const medbay = CONFIG.rooms.find((entry) => entry.id === 'room-medbay')!;
  const traits = new Map(CONFIG.crewTraits.map((entry) => [entry.id, entry]));
  const crewIds = ['crew-engineer-1', 'crew-engineer-2', 'crew-engineer-3'];
  const model = new ShipModel({
    ...base,
    floors: Array.from({ length: 18 }, (_, index) => ({ instanceId: `floor-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 1 })),
    rooms: [
      ...base.rooms,
      { instanceId: 'room-shield-1', definition: shield, x: 6, y: 2 },
      { instanceId: 'room-medbay-1', definition: medbay, x: 10, y: 2 },
    ],
    crews: crewIds.map((instanceId, index) => ({
      instanceId,
      definition: engineer,
      roomInstanceId: ['room-reactor-1', 'room-shield-1', 'room-medbay-1'][index],
      stationIndex: 0,
    })),
    construction: {
      ...base.construction!,
      crewProfiles: crewIds.map((crewId) => ({
        crewId,
        role: engineer.role,
        speedBonusPermille: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SPEED_PERMILLE' ? traits.get(id)!.effectValue : 0), 0),
        slotBonus: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SLOT_BONUS' ? traits.get(id)!.effectValue : 0), 0),
      })),
    },
  });
  assert.equal(model.apply({ type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'job-laser', roomInstanceId: 'room-laser-1', roomDefinitionId: 'room-laser', x: 14, y: 2, nowUnixMs: 0 }).ok, true);
  const assigned = model.apply({ type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-laser', crewInstanceIds: crewIds });
  assert.equal(assigned.ok, true);
  const worksites = model.getSnapshot().crews.crews.map((crew) => crew.constructionWorksiteNodeId);
  assert.equal(new Set(worksites).size, 3);
  assert.equal(worksites.every((nodeId) => nodeId !== null), true);
  for (let tick = 0; tick < 200; tick += 1) model.advanceOneTick();
  assert.equal(model.settleConstruction(0).ok, true);
  assert.deepEqual(model.getSnapshot().constructionJobs[0]?.buildersAtSite, crewIds);
});

test('P8 标准双层演示三名工程师最终都能到达施工工位', () => {
  const base = blueprint();
  const engineer = CONFIG.crews.find((entry) => entry.id === 'crew-engineer')!;
  const gunner = CONFIG.crews.find((entry) => entry.id === 'crew-gunner')!;
  const medic = CONFIG.crews.find((entry) => entry.id === 'crew-medic')!;
  const soldier = CONFIG.crews.find((entry) => entry.id === 'crew-soldier')!;
  const roomIds = ['room-reactor-1', 'room-elevator-1', 'room-stairs-1', 'room-laser-1', 'room-shield-1', 'room-medbay-1'];
  const roomDefinitions = new Map(CONFIG.rooms.map((entry) => [entry.id, entry]));
  const rooms = [
    ['room-reactor-1', 'room-reactor', 1, 2], ['room-elevator-1', 'room-elevator', 8, 2],
    ['room-stairs-1', 'room-stairs', 11, 2], ['room-laser-1', 'room-laser', 14, 2],
    ['room-shield-1', 'room-shield', 1, 6], ['room-medbay-1', 'room-medbay', 14, 6],
  ].map(([instanceId, definitionId, x, y]) => ({ instanceId: instanceId as string, definition: roomDefinitions.get(definitionId as string)!, x: x as number, y: y as number }));
  const traits = new Map(CONFIG.crewTraits.map((entry) => [entry.id, entry]));
  const profiles = ['crew-engineer-1', 'crew-engineer-2', 'crew-engineer-3'].map((crewId) => ({
    crewId,
    role: engineer.role,
    speedBonusPermille: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SPEED_PERMILLE' ? traits.get(id)!.effectValue : 0), 0),
    slotBonus: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SLOT_BONUS' ? traits.get(id)!.effectValue : 0), 0),
  }));
  const model = new ShipModel({
    ...base,
    floors: [...Array.from({ length: 17 }, (_, index) => ({ instanceId: `floor-lower-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 1 })), ...Array.from({ length: 17 }, (_, index) => ({ instanceId: `floor-upper-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 5 }))],
    rooms,
    crews: [
      { instanceId: 'crew-engineer-1', definition: engineer, roomInstanceId: 'room-reactor-1', stationIndex: 0 },
      { instanceId: 'crew-gunner-1', definition: gunner, roomInstanceId: 'room-reactor-1', stationIndex: 1, hp: 40 },
      { instanceId: 'crew-medic-1', definition: medic, roomInstanceId: 'room-medbay-1', stationIndex: 0 },
      { instanceId: 'crew-soldier-1', definition: soldier, roomInstanceId: 'room-laser-1', stationIndex: 0, patrolRoomIds: roomIds },
      { instanceId: 'crew-engineer-2', definition: engineer, roomInstanceId: 'room-laser-1', stationIndex: 1 },
      { instanceId: 'crew-engineer-3', definition: engineer, roomInstanceId: 'room-shield-1', stationIndex: 0 },
    ],
    construction: { ...base.construction!, crewProfiles: profiles },
  });
  assert.equal(model.apply({ type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'job-standard', roomInstanceId: 'room-new', roomDefinitionId: 'room-shield', x: 6, y: 6, nowUnixMs: 0 }).ok, true);
  assert.equal(model.apply({ type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-standard', crewInstanceIds: profiles.map((entry) => entry.crewId) }).ok, true);
  for (let tick = 0; tick < 600; tick += 1) model.advanceOneTick();
  const settled = model.settleConstruction(0);
  assert.equal(settled.ok, true);
  assert.deepEqual(model.getSnapshot().constructionJobs[0]?.buildersAtSite, profiles.map((entry) => entry.crewId));
});

test('P8 下层第 18 格施工目标三名工程师最终都能到场', () => {
  const base = blueprint();
  const engineer = CONFIG.crews.find((entry) => entry.id === 'crew-engineer')!;
  const roomDefinitions = new Map(CONFIG.rooms.map((entry) => [entry.id, entry]));
  const rooms = [
    ['room-reactor-1', 'room-reactor', 1, 2], ['room-elevator-1', 'room-elevator', 8, 2],
    ['room-stairs-1', 'room-stairs', 11, 2], ['room-laser-1', 'room-laser', 14, 2],
    ['room-shield-1', 'room-shield', 1, 6], ['room-medbay-1', 'room-medbay', 14, 6],
  ].map(([instanceId, definitionId, x, y]) => ({ instanceId: instanceId as string, definition: roomDefinitions.get(definitionId as string)!, x: x as number, y: y as number }));
  const traits = new Map(CONFIG.crewTraits.map((entry) => [entry.id, entry]));
  const crewIds = ['crew-engineer-1', 'crew-engineer-2', 'crew-engineer-3'];
  const profiles = crewIds.map((crewId) => ({
    crewId,
    role: engineer.role,
    speedBonusPermille: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SPEED_PERMILLE' ? traits.get(id)!.effectValue : 0), 0),
    slotBonus: engineer.traitIds.reduce((sum, id) => sum + (traits.get(id)?.effectType === 'CONSTRUCTION_SLOT_BONUS' ? traits.get(id)!.effectValue : 0), 0),
  }));
  const model = new ShipModel({
    ...base,
    floors: [...Array.from({ length: 17 }, (_, index) => ({ instanceId: `floor-lower-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 1 })), ...Array.from({ length: 17 }, (_, index) => ({ instanceId: `floor-upper-${index + 1}`, definitionId: 'floor-basic', x: index + 1, y: 5 }))],
    rooms,
    crews: crewIds.map((instanceId, index) => ({ instanceId, definition: engineer, roomInstanceId: ['room-reactor-1', 'room-laser-1', 'room-shield-1'][index], stationIndex: 0 })),
    construction: { ...base.construction!, crewProfiles: profiles },
  });
  assert.equal(model.apply({ type: 'START_BUILD_FLOOR', shipId: 'ship-1', jobId: 'job-floor-18', floorInstanceId: 'floor-18-1', floorDefinitionId: 'floor-basic', x: 18, y: 1, nowUnixMs: 0 }).ok, true);
  assert.equal(model.apply({ type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-floor-18', crewInstanceIds: crewIds }).ok, true);
  for (let tick = 0; tick < 400; tick += 1) model.advanceOneTick();
  assert.deepEqual(model.getSnapshot().constructionJobs[0]?.buildersAtSite, crewIds);
});
