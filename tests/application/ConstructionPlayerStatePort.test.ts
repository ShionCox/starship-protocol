import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LocalPlayerStatePort } from '../../assets/scripts/bootstrap/LocalPlayerStatePort.ts';
import { parseGameConfigCsvBundle } from '../../assets/scripts/game-core/CsvGameConfig.ts';
import type { ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';

class MemoryStorage {
  public value: string | null = null;
  public failWrite = false;
  getItem(): string | null { return this.value; }
  setItem(_key: string, value: string): void { if (this.failWrite) throw new Error('disk full'); this.value = value; }
}

const ROOT = new URL('../../assets/config/csv/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, ROOT), 'utf8');
const parsed = parseGameConfigCsvBundle({ game: read('game.csv'), hulls: read('hulls.csv'), rooms: read('rooms.csv'), connectorPorts: read('connector-ports.csv'), floors: read('floors.csv'), crews: read('crews.csv'), crewTraits: read('crew-traits.csv') });
if (parsed.ok === false) throw new Error(parsed.message);
const config = parsed.config;

function blueprint(): ShipModelBlueprint {
  const hull = config.hulls.find((entry) => entry.id === 'hull-starter')!;
  const reactor = config.rooms.find((entry) => entry.id === 'room-reactor')!;
  const engineer = config.crews.find((entry) => entry.id === 'crew-engineer')!;
  return {
    shipId: 'ship-1', hull, configVersion: config.configVersion,
    floors: Array.from({ length: 10 }, (_, index) => ({ instanceId: `floor-${index}`, definitionId: 'floor-basic', x: index + 1, y: 1 })),
    rooms: [{ instanceId: 'room-reactor-1', definition: reactor, x: 1, y: 2 }],
    crews: [{ instanceId: 'crew-engineer-1', definition: engineer, roomInstanceId: 'room-reactor-1', stationIndex: 0 }],
    construction: {
      initialMetal: 1000, floorDefinitions: config.floors, roomDefinitions: config.rooms, connectorPorts: config.connectorPorts,
      crewProfiles: [{ crewId: 'crew-engineer-1', role: 'ENGINEER', speedBonusPermille: 250, slotBonus: 1 }],
    },
  };
}

test('PlayerStatePort 保存施工队列并在刷新时只离线推进施工', async () => {
  const storage = new MemoryStorage();
  let now = 0;
  const create = () => new LocalPlayerStatePort({ storage, configVersion: config.configVersion, activeShipId: 'ship-1', ships: [blueprint()], initialMetal: 1000, now: () => now });
  const first = create();
  let state = (await first.bootstrap()).state;
  const started = await first.execute({ requestId: 'build', expectedRevision: state.revision, command: { type: 'START_BUILD_ROOM', shipId: 'ship-1', jobId: 'job-medbay', roomInstanceId: 'room-medbay-1', roomDefinitionId: 'room-medbay', x: 6, y: 2, nowUnixMs: now } });
  assert.equal(started.ok, true);
  state = started.state;
  const assigned = await first.execute({ requestId: 'builders', expectedRevision: state.revision, command: { type: 'ASSIGN_BUILDERS', shipId: 'ship-1', jobId: 'job-medbay', crewInstanceIds: ['crew-engineer-1'] } });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.state.metal, 900);
  assert.equal(assigned.state.ships[0].constructionJobs.length, 1);

  // 工地现在是施工区域附近的已完成地板；离线结算只推进施工时间，
  // 因此先用固定 Tick 完成一次真实到场，再验证刷新后的离线完成结果。
  for (let tick = 0; tick < 40; tick += 1) first.advanceOneTick('ship-1');

  now = 16000;
  const restoredResult = await create().bootstrap();
  const restored = restoredResult.state;
  assert.equal(restored.metal, 900);
  assert.equal(restored.ships[0].constructionJobs.length, 0);
  assert.equal(restored.ships[0].rooms.some((room) => room.instanceId === 'room-medbay-1'), true);
  assert.equal(restored.ships[0].crews.crews[0].state, 'IDLE');
  assert.deepEqual(restoredResult.offlineConstruction?.completedJobs.map((job) => job.jobId), ['job-medbay']);
});

test('施工结算写盘失败恢复完整旧 Envelope', async () => {
  const storage = new MemoryStorage();
  const port = new LocalPlayerStatePort({ storage, configVersion: config.configVersion, activeShipId: 'ship-1', ships: [blueprint()], now: () => 0 });
  let state = (await port.bootstrap()).state;
  const started = await port.execute({ requestId: 'floor', expectedRevision: state.revision, command: { type: 'START_BUILD_FLOOR', shipId: 'ship-1', jobId: 'job-floor', floorInstanceId: 'floor-11', floorDefinitionId: 'floor-basic', x: 11, y: 1, nowUnixMs: 0 } });
  assert.equal(started.ok, true);
  state = started.state;
  storage.failWrite = true;
  const failed = port.settleConstruction('ship-1', 2000);
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, 'SAVE_FAILED');
  assert.deepEqual(port.getSnapshot(), state);
});

test('离线施工未完成时只保存进度，时钟回拨返回一次摘要', async () => {
  const storage = new MemoryStorage();
  let now = 1000;
  const create = () => new LocalPlayerStatePort({ storage, configVersion: config.configVersion, activeShipId: 'ship-1', ships: [blueprint()], initialMetal: 1000, now: () => now });
  const first = create();
  const initial = (await first.bootstrap()).state;
  const started = await first.execute({ requestId: 'offline-floor', expectedRevision: initial.revision, command: { type: 'START_BUILD_FLOOR', shipId: 'ship-1', jobId: 'offline-floor', floorInstanceId: 'floor-11', floorDefinitionId: 'floor-basic', x: 11, y: 1, nowUnixMs: now } });
  assert.equal(started.ok, true);

  now = 1100;
  const incomplete = await create().bootstrap();
  assert.equal(incomplete.offlineConstruction, undefined);
  assert.equal(incomplete.state.ships[0].constructionJobs.length, 1);

  now = 500;
  const rollback = await create().bootstrap();
  assert.equal(rollback.offlineConstruction?.clockRollback, true);
  assert.deepEqual(rollback.offlineConstruction?.completedJobs, []);
  assert.equal(rollback.state.ships[0].constructionJobs.length, 1);
});
