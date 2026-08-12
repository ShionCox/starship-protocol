import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipModel, type ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';
import { ENGINEER, GUNNER, hull, roomDefinition } from './fixtures.ts';

const REACTOR = roomDefinition('room-reactor', 'ENERGY', 2, 10);
const ELEVATOR = roomDefinition('room-elevator', 'MOVEMENT', 1);
const LASER = roomDefinition('room-laser', 'WEAPON', 2, 0, 2, 6);
const SHIELD = roomDefinition('room-shield', 'DEFENSE', 2, 0, 2, 6);

function blueprint(shipId = 'ship-player-1'): ShipModelBlueprint {
  return {
    shipId,
    hull: hull('hull-starter', 8, 4),
    rooms: [
      { instanceId: 'room-reactor-1', definition: REACTOR, x: 0, y: 0 },
      { instanceId: 'room-elevator-1', definition: ELEVATOR, x: 2, y: 0 },
      { instanceId: 'room-laser-1', definition: LASER, x: 4, y: 0 },
      { instanceId: 'room-shield-1', definition: SHIELD, x: 6, y: 0 },
    ],
    crews: [
      { instanceId: 'crew-engineer-1', definition: ENGINEER, roomInstanceId: 'room-reactor-1', stationIndex: 0 },
      { instanceId: 'crew-gunner-1', definition: GUNNER, roomInstanceId: 'room-reactor-1', stationIndex: 1 },
    ],
  };
}

test('单舰聚合快照明确船体、实例和定义ID', () => {
  const model = new ShipModel(blueprint());
  const snapshot = model.getSnapshot();
  assert.equal(snapshot.shipId, 'ship-player-1');
  assert.equal(snapshot.hullId, 'hull-starter');
  assert.deepEqual(snapshot.rooms.map((room) => [room.instanceId, room.definitionId]), [
    ['room-elevator-1', 'room-elevator'],
    ['room-laser-1', 'room-laser'],
    ['room-reactor-1', 'room-reactor'],
    ['room-shield-1', 'room-shield'],
  ]);
});

test('能源与船员Command必须带正确shipId', () => {
  const model = new ShipModel(blueprint());
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', shipId: 'ship-other', roomInstanceId: 'room-laser-1', power: 2 }).ok, false);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-laser-1', power: 6 }).ok, true);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-shield-1', power: 5 }).ok, false);
  assert.equal(model.apply({ type: 'MOVE_CREW', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', targetRoomInstanceId: 'room-laser-1' }).ok, true);
});

test('两艘飞船可复用相同房间短ID且状态互不影响', () => {
  const player = new ShipModel(blueprint('ship-player-1'));
  const enemy = new ShipModel(blueprint('ship-enemy-1'));
  player.apply({ type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-laser-1', power: 6 });
  assert.equal(player.getSnapshot().energy.allocations.find((allocation) => allocation.roomId === 'room-laser-1')?.power, 6);
  assert.equal(enemy.getSnapshot().energy.allocations.find((allocation) => allocation.roomId === 'room-laser-1')?.power, 0);
});

test('船员移动期间拒绝房间移动，到达后可移动并重建导航', () => {
  const model = new ShipModel(blueprint());
  model.apply({ type: 'MOVE_CREW', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', targetRoomInstanceId: 'room-laser-1' });
  assert.equal(model.apply({ type: 'MOVE_ROOM', shipId: 'ship-player-1', roomInstanceId: 'room-shield-1', x: 6, y: 2 }).ok, false);
  for (let tick = 0; tick < 30; tick += 1) model.advanceOneTick();
  assert.equal(model.apply({ type: 'MOVE_ROOM', shipId: 'ship-player-1', roomInstanceId: 'room-shield-1', x: 6, y: 2 }).ok, true);
});

test('快照完整恢复且100次同序列结果一致', () => {
  let expected = '';
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const model = new ShipModel(blueprint());
    model.apply({ type: 'SET_ROOM_POWER', shipId: 'ship-player-1', roomInstanceId: 'room-laser-1', power: 6 });
    model.apply({ type: 'MOVE_CREW', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', targetRoomInstanceId: 'room-laser-1' });
    for (let tick = 0; tick < 30; tick += 1) model.advanceOneTick();
    const snapshot = model.getSnapshot();
    const restored = ShipModel.restore(blueprint(), snapshot);
    assert.equal(restored.ok, true);
    if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), snapshot);
    const hash = JSON.stringify(snapshot);
    if (iteration === 0) expected = hash;
    else assert.equal(hash, expected);
  }
});
