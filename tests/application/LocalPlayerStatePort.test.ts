import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_PLAYER_STATE_KEY, LocalPlayerStatePort } from '../../assets/scripts/bootstrap/LocalPlayerStatePort.ts';
import type { KeyValueStorage } from '../../assets/scripts/application/PlayerStatePort.ts';
import type { ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';
import { stationNodeId } from '../../assets/scripts/game-core/NavigationGraph.ts';
import { ENGINEER, GUNNER, MEDIC, hull, roomDefinition } from '../game-core/fixtures.ts';

class MemoryStorage implements KeyValueStorage {
  public readonly data = new Map<string, string>();
  public failWrite = false;
  public getItem(key: string): string | null { return this.data.get(key) ?? null; }
  public setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('写入被拒绝');
    this.data.set(key, value);
  }
}

function blueprint(shipId = 'ship-player-1'): ShipModelBlueprint {
  const reactor = roomDefinition('room-reactor', 'ENERGY', 1, 10);
  const laser = roomDefinition('room-laser', 'WEAPON', 1, 0, 2, 6);
  return {
    shipId,
    hull: hull('hull-starter', 4, 2),
    rooms: [
      { instanceId: 'room-reactor-1', definition: reactor, x: 0, y: 0 },
      { instanceId: 'room-laser-1', definition: laser, x: 2, y: 0 },
    ],
    crews: [{ instanceId: 'crew-engineer-1', definition: ENGINEER, roomInstanceId: 'room-reactor-1', stationIndex: 0 }],
  };
}

function repairBlueprint(): ShipModelBlueprint {
  const value = blueprint();
  return { ...value, rooms: value.rooms.map((room) => room.instanceId === 'room-reactor-1' ? { ...room, hp: 60 } : room) };
}

function medicalBlueprint(): ShipModelBlueprint {
  const reactor = roomDefinition('room-reactor', 'ENERGY', 2, 10);
  const medbay = roomDefinition('room-medbay', 'SUPPORT', 2, 0, 2, 2, 1);
  return {
    shipId: 'ship-player-1',
    hull: hull('hull-starter', 4, 2),
    rooms: [
      { instanceId: 'room-reactor-1', definition: reactor, x: 0, y: 0 },
      { instanceId: 'room-medbay-1', definition: medbay, x: 2, y: 0 },
    ],
    crews: [
      { instanceId: 'crew-gunner-1', definition: GUNNER, roomInstanceId: 'room-medbay-1', stationIndex: 1, hp: 40 },
      { instanceId: 'crew-medic-1', definition: MEDIC, roomInstanceId: 'room-medbay-1', stationIndex: 0 },
    ],
  };
}

test('首次启动只写一个玩家状态Key，旧Key不会读取', async () => {
  const storage = new MemoryStorage();
  storage.data.set('starship-protocol:r0:ship-layout', '{"legacy":true}');
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()], now: () => 100 });
  const state = (await port.bootstrap()).state;
  assert.equal(state.revision, 0);
  assert.equal(storage.data.has(LOCAL_PLAYER_STATE_KEY), true);
  assert.equal(storage.data.size, 2);
});

test('合法Command整体保存，重复requestId幂等返回', async () => {
  const storage = new MemoryStorage();
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()], now: () => 200 });
  await port.bootstrap();
  const request = {
    requestId: 'request-1', expectedRevision: 0,
    command: { type: 'SET_ROOM_POWER' as const, shipId: 'ship-player-1', roomInstanceId: 'room-laser-1', power: 6 },
  };
  const first = await port.execute(request);
  const second = await port.execute(request);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(JSON.parse(storage.data.get(LOCAL_PLAYER_STATE_KEY) as string).revision, 1);
});

test('保存失败回滚Command前的完整状态', async () => {
  const storage = new MemoryStorage();
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()] });
  const before = (await port.bootstrap()).state;
  storage.failWrite = true;
  const result = await port.execute({
    requestId: 'request-fail', expectedRevision: 0,
    command: { type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-laser-1', power: 6 },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.state, before);
});

test('损坏存档可观察并回到默认状态', async () => {
  const storage = new MemoryStorage();
  storage.data.set(LOCAL_PLAYER_STATE_KEY, '{');
  const warnings: string[] = [];
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()], warn: (message) => warnings.push(message) });
  const state = (await port.bootstrap()).state;
  assert.equal(state.revision, 0);
  assert.equal(warnings.length, 1);
  assert.doesNotThrow(() => JSON.parse(storage.data.get(LOCAL_PLAYER_STATE_KEY) as string));
});

test('恢复存档拒绝重复或缺失飞船 ID', async () => {
  const storage = new MemoryStorage();
  const ships = [blueprint(), blueprint('ship-enemy-1')];
  const options = { storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships, now: () => 300 };
  const seed = new LocalPlayerStatePort(options);
  await seed.bootstrap();
  const saved = JSON.parse(storage.data.get(LOCAL_PLAYER_STATE_KEY) as string) as { ships: unknown[] };

  const duplicateWarnings: string[] = [];
  saved.ships = [saved.ships[0], saved.ships[0]];
  storage.data.set(LOCAL_PLAYER_STATE_KEY, JSON.stringify(saved));
  const duplicatePort = new LocalPlayerStatePort({ ...options, warn: (message) => duplicateWarnings.push(message) });
  const duplicateState = (await duplicatePort.bootstrap()).state;
  assert.deepEqual(duplicateState.ships.map((ship) => ship.shipId), ['ship-enemy-1', 'ship-player-1']);
  assert.equal(duplicateWarnings.length, 1);
  assert.match(duplicateWarnings[0], /重复飞船/);

  const missingWarnings: string[] = [];
  saved.ships = [saved.ships[0]];
  storage.data.set(LOCAL_PLAYER_STATE_KEY, JSON.stringify(saved));
  const missingPort = new LocalPlayerStatePort({ ...options, warn: (message) => missingWarnings.push(message) });
  const missingState = (await missingPort.bootstrap()).state;
  assert.deepEqual(missingState.ships.map((ship) => ship.shipId), ['ship-enemy-1', 'ship-player-1']);
  assert.equal(missingWarnings.length, 1);
  assert.match(missingWarnings[0], /数量不匹配/);
});

test('固定Tick保存完整Envelope，写入失败恢复Tick前状态', async () => {
  const storage = new MemoryStorage();
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()] });
  await port.bootstrap();
  const moving = await port.execute({
    requestId: 'move-crew', expectedRevision: 0,
    command: { type: 'MOVE_CREW', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', targetRoomInstanceId: 'room-laser-1' },
  });
  assert.equal(moving.ok, true);
  const tick = port.advanceOneTick('ship-player-1');
  assert.equal(tick.ok, true);
  assert.equal(tick.revision, 2);
  const beforeFailure = tick.state;
  storage.failWrite = true;
  const failed = port.advanceOneTick('ship-player-1');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.state, beforeFailure);
});

test('维修 Command 与 Tick 保存完整 Envelope，刷新恢复且写入失败回滚', async () => {
  const storage = new MemoryStorage();
  const options = { storage, configVersion: 'r1-repair-1', activeShipId: 'ship-player-1', ships: [repairBlueprint()], now: () => 500 };
  const port = new LocalPlayerStatePort(options);
  await port.bootstrap();
  const started = await port.execute({
    requestId: 'start-repair', expectedRevision: 0,
    command: { type: 'START_REPAIR', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-reactor-1' },
  });
  assert.equal(started.ok, true);
  const tick = port.advanceOneTick('ship-player-1');
  assert.equal(tick.ok, true);
  assert.equal(tick.state.ships[0].rooms.find((room) => room.instanceId === 'room-reactor-1')?.hp, 61);

  const restoredPort = new LocalPlayerStatePort(options);
  const restored = (await restoredPort.bootstrap()).state;
  assert.equal(restored.ships[0].crews.crews[0].state, 'REPAIRING');
  assert.equal(restored.ships[0].rooms.find((room) => room.instanceId === 'room-reactor-1')?.hp, 61);

  const beforeFailure = restoredPort.getSnapshot();
  storage.failWrite = true;
  const failed = restoredPort.advanceOneTick('ship-player-1');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.state, beforeFailure);
});

test('旧配置版本开发存档不迁移并回到维修版默认状态', async () => {
  const storage = new MemoryStorage();
  const oldPort = new LocalPlayerStatePort({ storage, configVersion: 'r1-dev-1', activeShipId: 'ship-player-1', ships: [repairBlueprint()] });
  await oldPort.bootstrap();
  const warnings: string[] = [];
  const repairPort = new LocalPlayerStatePort({ storage, configVersion: 'r1-repair-1', activeShipId: 'ship-player-1', ships: [repairBlueprint()], warn: (message) => warnings.push(message) });
  const state = (await repairPort.bootstrap()).state;
  assert.equal(state.configVersion, 'r1-repair-1');
  assert.equal(state.revision, 0);
  assert.equal(warnings.length, 1);
});

test('治疗 Command 与 Tick 原子保存，刷新恢复配对且写入失败回滚', async () => {
  const storage = new MemoryStorage();
  const options = { storage, configVersion: 'r1-medical-1', activeShipId: 'ship-player-1', ships: [medicalBlueprint()], now: () => 600 };
  const port = new LocalPlayerStatePort(options);
  await port.bootstrap();
  const powered = await port.execute({
    requestId: 'power-medbay', expectedRevision: 0,
    command: { type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-medbay-1', power: 2 },
  });
  const started = await port.execute({
    requestId: 'start-heal', expectedRevision: powered.revision,
    command: { type: 'START_HEAL', shipId: 'ship-player-1', patientCrewInstanceId: 'crew-gunner-1', medicCrewInstanceId: 'crew-medic-1', roomInstanceId: 'room-medbay-1' },
  });
  assert.equal(started.ok, true);
  const tick = port.advanceOneTick('ship-player-1');
  assert.equal(tick.ok, true);
  assert.equal(tick.state.ships[0].crews.crews.find((crew) => crew.id === 'crew-gunner-1')?.hp, 41);
  const restored = (await new LocalPlayerStatePort(options).bootstrap()).state;
  assert.equal(restored.ships[0].crews.crews.find((crew) => crew.id === 'crew-gunner-1')?.state, 'HEALING');
  assert.equal(restored.ships[0].crews.crews.find((crew) => crew.id === 'crew-medic-1')?.state, 'TREATING');
  const rollbackPort = new LocalPlayerStatePort(options);
  await rollbackPort.bootstrap();
  const beforeFailure = rollbackPort.getSnapshot();
  storage.failWrite = true;
  const failed = rollbackPort.advanceOneTick('ship-player-1');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.state, beforeFailure);
});

test('维修版开发存档不迁移并回到医疗版默认状态', async () => {
  const storage = new MemoryStorage();
  await new LocalPlayerStatePort({ storage, configVersion: 'r1-repair-1', activeShipId: 'ship-player-1', ships: [medicalBlueprint()] }).bootstrap();
  const warnings: string[] = [];
  const state = (await new LocalPlayerStatePort({ storage, configVersion: 'r1-medical-1', activeShipId: 'ship-player-1', ships: [medicalBlueprint()], warn: (message) => warnings.push(message) }).bootstrap()).state;
  assert.equal(state.configVersion, 'r1-medical-1');
  assert.equal(state.ships[0].crews.crews.find((crew) => crew.id === 'crew-gunner-1')?.hp, 40);
  assert.equal(warnings.length, 1);
});

test('schema 6 玩家移动订单保存、刷新恢复且取消写盘失败完整回滚', async () => {
  const storage = new MemoryStorage();
  const options = { storage, configVersion: 'r1-p8-close-1', activeShipId: 'ship-player-1', ships: [blueprint()], now: () => 700 };
  const port = new LocalPlayerStatePort(options);
  await port.bootstrap();
  const moved = await port.execute({
    requestId: 'move-order', expectedRevision: 0,
    command: { type: 'ISSUE_MOVE_ORDER', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', targetNodeId: stationNodeId('room-laser-1', 0) },
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.state.ships[0].schemaVersion, 6);
  assert.equal(moved.state.ships[0].crews.crews[0].activeOrder?.type, 'MOVE');

  const restoredPort = new LocalPlayerStatePort(options);
  const restored = (await restoredPort.bootstrap()).state;
  assert.equal(restored.ships[0].crews.crews[0].state, 'MOVING');
  assert.equal(restored.ships[0].crews.crews[0].activeOrder?.type, 'MOVE');
  storage.failWrite = true;
  const failed = await restoredPort.execute({
    requestId: 'cancel-order', expectedRevision: restored.revision,
    command: { type: 'CANCEL_CREW_ORDER', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1' },
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.state, restored);
});

test('体素施工版开发状态不迁移并重建交互版 schema 6 默认状态', async () => {
  const storage = new MemoryStorage();
  await new LocalPlayerStatePort({ storage, configVersion: 'r1-voxel-construction-1', activeShipId: 'ship-player-1', ships: [blueprint()] }).bootstrap();
  const warnings: string[] = [];
  const state = (await new LocalPlayerStatePort({
    storage,
    configVersion: 'r1-p8-close-1',
    activeShipId: 'ship-player-1',
    ships: [blueprint()],
    warn: (message) => warnings.push(message),
  }).bootstrap()).state;
  assert.equal(state.configVersion, 'r1-p8-close-1');
  assert.equal(state.revision, 0);
  assert.equal(state.ships[0].schemaVersion, 6);
  assert.equal(warnings.length, 1);
});
