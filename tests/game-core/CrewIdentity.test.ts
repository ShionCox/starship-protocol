import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREW_CALL_SIGN_WORDS,
  generateCrewCallSign,
  resolveCrewIdentities,
  resolveFixedCrewIdentity,
  stableCrewIdentityHash,
} from '../../assets/scripts/game-core/CrewIdentity.ts';
import { CrewModel } from '../../assets/scripts/game-core/CrewModel.ts';
import { NavigationGraph } from '../../assets/scripts/game-core/NavigationGraph.ts';
import { ShipModel } from '../../assets/scripts/game-core/ShipModel.ts';
import { ENGINEER, GUNNER, hull, placement, roomDefinition } from './fixtures.ts';

const CONTEXT = { shipId: 'ship-identity-test', configVersion: 'r1-identity-1' } as const;

test('GENERATED 代号由稳定 hash 决定且不依赖 Math.random', () => {
  const first = generateCrewCallSign(CONTEXT.shipId, 'crew-a-1', CONTEXT.configVersion);
  const second = generateCrewCallSign(CONTEXT.shipId, 'crew-a-1', CONTEXT.configVersion);
  assert.equal(first, second);
  assert.equal(CREW_CALL_SIGN_WORDS.includes(first as (typeof CREW_CALL_SIGN_WORDS)[number]), true);
  assert.equal(stableCrewIdentityHash('中文船员') >>> 0, stableCrewIdentityHash('中文船员') >>> 0);
  assert.notEqual(generateCrewCallSign(CONTEXT.shipId, 'crew-a-1', 'r1-identity-2'), first);
});

test('FIXED 代号会 trim，拒绝空值、控制字符和超长值', () => {
  const fixed = resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: '  赤霄  ' });
  assert.deepEqual(fixed, { ok: true, identity: { nameMode: 'FIXED', callSign: '赤霄' } });
  assert.equal(resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: '' }).ok, false);
  assert.equal(resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: 'a'.repeat(17) }).ok, false);
  assert.equal(resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: '好\n名' }).ok, false);
});

test('同舰固定重名被拒绝，GENERATED 按稳定 crewId 排序并避让固定代号', () => {
  assert.throws(() => resolveCrewIdentities([
    { crewId: 'crew-a', identity: { nameMode: 'FIXED', callSign: '赤霄' } },
    { crewId: 'crew-b', identity: { nameMode: 'FIXED', callSign: '赤霄' } },
  ], CONTEXT), /同舰船员代号重复/);
  const entries = [
    { crewId: 'crew-z' },
    { crewId: 'crew-a' },
    { crewId: 'crew-fixed', identity: { nameMode: 'FIXED' as const, callSign: generateCrewCallSign(CONTEXT.shipId, 'crew-z', CONTEXT.configVersion) } },
  ];
  const identities = resolveCrewIdentities(entries, CONTEXT);
  assert.equal(identities.size, 3);
  assert.equal(identities.get('crew-fixed')?.nameMode, 'FIXED');
  assert.equal(identities.get('crew-z')?.callSign === identities.get('crew-fixed')?.callSign, false);
  assert.equal(new Set(Array.from(identities.values(), (identity) => identity.callSign)).size, 3);
  const reordered = resolveCrewIdentities([...entries].reverse(), CONTEXT);
  assert.deepEqual(Array.from(reordered.entries()), Array.from(identities.entries()));
});

test('CrewModel schema 6 快照持久化代号并校验代号不匹配', () => {
  const placements = [placement('room-a-1', 'room-a', 0, 0)];
  const definitions = new Map([['room-a-1', roomDefinition('room-a', 'SUPPORT', 2)]]);
  const navigation = new NavigationGraph(placements, definitions);
  const initial = [
    { id: 'crew-engineer-1', definition: ENGINEER, roomId: 'room-a-1', stationIndex: 0, identity: { nameMode: 'FIXED' as const, callSign: '赤霄' } },
    { id: 'crew-gunner-1', definition: GUNNER, roomId: 'room-a-1', stationIndex: 1 },
  ];
  const model = new CrewModel(navigation, initial, CONTEXT);
  const snapshot = model.getSnapshot();
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.crews.find((crew) => crew.id === 'crew-engineer-1')?.callSign, '赤霄');
  assert.equal(CrewModel.restore(navigation, initial, snapshot, CONTEXT).ok, true);
  const mismatched = {
    ...snapshot,
    crews: snapshot.crews.map((crew) => crew.id === 'crew-engineer-1' ? { ...crew, callSign: '晨星' } : crew),
  };
  assert.equal(CrewModel.restore(navigation, initial, mismatched, CONTEXT).ok, false);
});

test('ShipModel schema 6 包含船员代号，并按 configVersion 恢复同一身份', () => {
  const model = new ShipModel({
    shipId: CONTEXT.shipId,
    configVersion: CONTEXT.configVersion,
    hull: hull('hull-identity', 2, 2),
    rooms: [{ instanceId: 'room-a-1', definition: roomDefinition('room-a', 'SUPPORT', 1), x: 0, y: 0 }],
    crews: [{
      instanceId: 'crew-a-1',
      definition: ENGINEER,
      roomInstanceId: 'room-a-1',
      stationIndex: 0,
      identity: { nameMode: 'FIXED', callSign: '赤霄' },
    }],
  });
  const snapshot = model.getSnapshot();
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.crews.crews[0].callSign, '赤霄');
  const restored = ShipModel.restore({
    shipId: CONTEXT.shipId,
    configVersion: CONTEXT.configVersion,
    hull: hull('hull-identity', 2, 2),
    rooms: [{ instanceId: 'room-a-1', definition: roomDefinition('room-a', 'SUPPORT', 1), x: 0, y: 0 }],
    crews: [{
      instanceId: 'crew-a-1',
      definition: ENGINEER,
      roomInstanceId: 'room-a-1',
      stationIndex: 0,
      identity: { nameMode: 'FIXED', callSign: '赤霄' },
    }],
  }, snapshot);
  assert.equal(restored.ok, true);
});
