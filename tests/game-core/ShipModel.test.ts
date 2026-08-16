import assert from 'node:assert/strict';
import test from 'node:test';

import { ShipModel, type ShipModelBlueprint } from '../../assets/scripts/game-core/ShipModel.ts';
import { ENGINEER, GUNNER, MEDIC, hull, roomDefinition } from './fixtures.ts';

const REACTOR = roomDefinition('room-reactor', 'ENERGY', 2, 10);
const ELEVATOR = roomDefinition('room-elevator', 'MOVEMENT', 1);
const LASER = roomDefinition('room-laser', 'WEAPON', 2, 0, 2, 6);
const SHIELD = roomDefinition('room-shield', 'DEFENSE', 2, 0, 2, 6);
const MEDBAY = roomDefinition('room-medbay', 'SUPPORT', 2, 0, 2, 2, 1);

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

test('医疗室供电后医务员治疗病员，断电立即停止且状态按舰隔离', () => {
  const base = blueprint();
  const medical: ShipModelBlueprint = {
    ...base,
    rooms: [...base.rooms, { instanceId: 'room-medbay-1', definition: MEDBAY, x: 0, y: 2 }],
    crews: [
      { instanceId: 'crew-engineer-1', definition: ENGINEER, roomInstanceId: 'room-reactor-1', stationIndex: 0 },
      { instanceId: 'crew-gunner-1', definition: GUNNER, roomInstanceId: 'room-reactor-1', stationIndex: 1, hp: 40 },
      { instanceId: 'crew-medic-1', definition: MEDIC, roomInstanceId: 'room-medbay-1', stationIndex: 0 },
    ],
  };
  const model = new ShipModel(medical);
  assert.equal(model.apply({ type: 'START_HEAL', shipId: medical.shipId, patientCrewInstanceId: 'crew-gunner-1', medicCrewInstanceId: 'crew-medic-1', roomInstanceId: 'room-medbay-1' }).ok, false);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', shipId: medical.shipId, roomInstanceId: 'room-medbay-1', power: 2 }).ok, true);
  assert.equal(model.apply({ type: 'MOVE_CREW', shipId: medical.shipId, crewInstanceId: 'crew-gunner-1', targetRoomInstanceId: 'room-medbay-1' }).ok, true);
  for (let tick = 0; tick < 30; tick += 1) model.advanceOneTick();
  assert.equal(model.apply({ type: 'START_HEAL', shipId: medical.shipId, patientCrewInstanceId: 'crew-gunner-1', medicCrewInstanceId: 'crew-medic-1', roomInstanceId: 'room-medbay-1' }).ok, true);
  const beforeTickRevision = model.getSnapshot().revision;
  model.advanceOneTick();
  let snapshot = model.getSnapshot();
  assert.equal(snapshot.crews.crews.find((crew) => crew.id === 'crew-gunner-1')?.hp, 41);
  assert.equal(snapshot.revision, beforeTickRevision + 1);
  assert.equal(model.apply({ type: 'MOVE_ROOM', shipId: medical.shipId, roomInstanceId: 'room-shield-1', x: 6, y: 2 }).ok, false);
  assert.equal(model.apply({ type: 'RESET_ROOM_POWER', shipId: medical.shipId, roomInstanceId: 'room-medbay-1' }).ok, true);
  snapshot = model.getSnapshot();
  assert.deepEqual(snapshot.crews.crews.filter((crew) => crew.id !== 'crew-engineer-1').map((crew) => crew.state), ['IDLE', 'IDLE']);
  assert.equal(snapshot.crews.crews.find((crew) => crew.id === 'crew-gunner-1')?.hp, 41);
});

test('活动治疗快照原子恢复并在100次相同序列中保持确定', () => {
  let expected = '';
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const base = blueprint();
    const medical: ShipModelBlueprint = {
      ...base,
      rooms: [...base.rooms, { instanceId: 'room-medbay-1', definition: MEDBAY, x: 0, y: 2 }],
      crews: [
        { instanceId: 'crew-gunner-1', definition: GUNNER, roomInstanceId: 'room-medbay-1', stationIndex: 1, hp: 40 },
        { instanceId: 'crew-medic-1', definition: MEDIC, roomInstanceId: 'room-medbay-1', stationIndex: 0 },
      ],
    };
    const model = new ShipModel(medical);
    model.apply({ type: 'SET_ROOM_POWER', shipId: medical.shipId, roomInstanceId: 'room-medbay-1', power: 2 });
    model.apply({ type: 'START_HEAL', shipId: medical.shipId, patientCrewInstanceId: 'crew-gunner-1', medicCrewInstanceId: 'crew-medic-1', roomInstanceId: 'room-medbay-1' });
    for (let tick = 0; tick < 10; tick += 1) model.advanceOneTick();
    const snapshot = model.getSnapshot();
    const restored = ShipModel.restore(medical, snapshot);
    assert.equal(restored.ok, true);
    if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), snapshot);
    const hash = JSON.stringify(snapshot);
    if (iteration === 0) expected = hash;
    else assert.equal(hash, expected);
  }
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

test('工程师到达受损房间后按 Tick 维修，支持停止、自动完成和布局锁定', () => {
  const base = blueprint();
  const damaged: ShipModelBlueprint = { ...base, rooms: base.rooms.map((room) => room.instanceId === 'room-laser-1' ? { ...room, hp: 60 } : room) };
  const model = new ShipModel(damaged);
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-laser-1' }).ok, false);
  assert.equal(model.apply({ type: 'MOVE_CREW', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1', targetRoomInstanceId: 'room-laser-1' }).ok, true);
  for (let tick = 0; tick < 30; tick += 1) model.advanceOneTick();
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-gunner-1', roomInstanceId: 'room-laser-1' }).ok, false);
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-laser-1' }).ok, true);
  assert.equal(model.apply({ type: 'MOVE_ROOM', shipId: damaged.shipId, roomInstanceId: 'room-shield-1', x: 6, y: 2 }).ok, false);
  model.advanceOneTick();
  assert.equal(model.getSnapshot().rooms.find((room) => room.instanceId === 'room-laser-1')?.hp, 61);
  assert.equal(model.apply({ type: 'STOP_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1' }).ok, true);
  assert.equal(model.getSnapshot().crews.crews.find((crew) => crew.id === 'crew-engineer-1')?.state, 'IDLE');
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-laser-1' }).ok, true);
  for (let tick = 0; tick < 50; tick += 1) model.advanceOneTick();
  const completed = model.getSnapshot();
  assert.equal(completed.rooms.find((room) => room.instanceId === 'room-laser-1')?.hp, 100);
  assert.equal(completed.crews.crews.find((crew) => crew.id === 'crew-engineer-1')?.state, 'IDLE');
  assert.equal(model.apply({ type: 'MOVE_ROOM', shipId: damaged.shipId, roomInstanceId: 'room-shield-1', x: 6, y: 2 }).ok, true);
});

test('多名工程师按稳定顺序叠加维修并在同一 Tick 自动完成', () => {
  const base = blueprint();
  const damaged: ShipModelBlueprint = {
    ...base,
    rooms: base.rooms.map((room) => room.instanceId === 'room-laser-1' ? { ...room, hp: 98 } : room),
    crews: [
      { instanceId: 'crew-engineer-2', definition: ENGINEER, roomInstanceId: 'room-laser-1', stationIndex: 1 },
      { instanceId: 'crew-engineer-1', definition: ENGINEER, roomInstanceId: 'room-laser-1', stationIndex: 0 },
    ],
  };
  const model = new ShipModel(damaged);
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-2', roomInstanceId: 'room-laser-1' }).ok, true);
  assert.equal(model.apply({ type: 'START_REPAIR', shipId: damaged.shipId, crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-laser-1' }).ok, true);
  model.advanceOneTick();
  const snapshot = model.getSnapshot();
  assert.equal(snapshot.rooms.find((room) => room.instanceId === 'room-laser-1')?.hp, 100);
  assert.deepEqual(snapshot.crews.crews.map((crew) => crew.state), ['IDLE', 'IDLE']);
});

test('活动维修快照原子恢复且两舰同短 ID 互不影响', () => {
  const playerBase = blueprint('ship-player-1');
  const playerBlueprint: ShipModelBlueprint = { ...playerBase, rooms: playerBase.rooms.map((room) => room.instanceId === 'room-reactor-1' ? { ...room, hp: 90 } : room) };
  const enemyBase = blueprint('ship-enemy-1');
  const enemyBlueprint: ShipModelBlueprint = { ...enemyBase, rooms: enemyBase.rooms.map((room) => room.instanceId === 'room-reactor-1' ? { ...room, hp: 80 } : room) };
  const player = new ShipModel(playerBlueprint);
  const enemy = new ShipModel(enemyBlueprint);
  assert.equal(player.apply({ type: 'START_REPAIR', shipId: 'ship-player-1', crewInstanceId: 'crew-engineer-1', roomInstanceId: 'room-reactor-1' }).ok, true);
  player.advanceOneTick();
  const snapshot = player.getSnapshot();
  const restored = ShipModel.restore(playerBlueprint, snapshot);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.model.getSnapshot(), snapshot);
  assert.equal(enemy.getSnapshot().rooms.find((room) => room.instanceId === 'room-reactor-1')?.hp, 80);
  const invalid = { ...snapshot, crews: { ...snapshot.crews, crews: snapshot.crews.crews.map((crew) => crew.id === 'crew-engineer-1' ? { ...crew, targetRoomId: 'room-missing-1' } : crew) } };
  assert.equal(ShipModel.restore(playerBlueprint, invalid).ok, false);
});
