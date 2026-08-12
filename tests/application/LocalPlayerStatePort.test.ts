import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_PLAYER_STATE_KEY, LocalPlayerStatePort } from '../../assets/scripts/bootstrap/LocalPlayerStatePort.ts';
import type { KeyValueStorage } from '../../assets/scripts/application/PlayerStatePort.ts';
import type { ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';
import { ENGINEER, hull, roomDefinition } from '../game-core/fixtures.ts';

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

test('首次启动只写一个玩家状态Key，旧Key不会读取', async () => {
  const storage = new MemoryStorage();
  storage.data.set('starship-protocol:r0:ship-layout', '{"legacy":true}');
  const port = new LocalPlayerStatePort({ storage, configVersion: 'dev-1', activeShipId: 'ship-player-1', ships: [blueprint()], now: () => 100 });
  const state = await port.bootstrap();
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
  const before = await port.bootstrap();
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
  const state = await port.bootstrap();
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
  const duplicateState = await duplicatePort.bootstrap();
  assert.deepEqual(duplicateState.ships.map((ship) => ship.shipId), ['ship-enemy-1', 'ship-player-1']);
  assert.equal(duplicateWarnings.length, 1);
  assert.match(duplicateWarnings[0], /重复飞船/);

  const missingWarnings: string[] = [];
  saved.ships = [saved.ships[0]];
  storage.data.set(LOCAL_PLAYER_STATE_KEY, JSON.stringify(saved));
  const missingPort = new LocalPlayerStatePort({ ...options, warn: (message) => missingWarnings.push(message) });
  const missingState = await missingPort.bootstrap();
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
