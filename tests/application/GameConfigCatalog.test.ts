import assert from 'node:assert/strict';
import test from 'node:test';

import { GameConfigCatalog } from '../../assets/scripts/application/GameConfigCatalog.ts';
import { parseCrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import { parseHullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';
import { parseRoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';

test('规则目录只接收已解析定义并按稳定 ID 查询', () => {
  const hull = parseHullDefinition({ schemaVersion: 1, id: 'hull-test', displayName: '测试船体', level: 1, gridWidth: 2, gridHeight: 2, validCells: [1, 1, 1, 1], maxCrew: 2, maxRooms: 1, visualId: 'visual-test' });
  const room = parseRoomDefinition({ schemaVersion: 1, id: 'room-test', displayName: '测试房间', category: 'SUPPORT', width: 1, height: 1, maxLevel: 1, maxHp: 10, minPower: 0, maxPower: 0, powerGeneration: 0, crewCapacity: 1 });
  const crew = parseCrewDefinition({ schemaVersion: 1, id: 'crew-test', displayName: '测试船员', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 });
  assert.equal(hull.ok && room.ok && crew.ok, true);
  if (!hull.ok || !room.ok || !crew.ok) return;
  const catalog = new GameConfigCatalog({ configVersion: 'dev-test', hulls: [hull.definition], rooms: [room.definition], crews: [crew.definition] });
  assert.equal(catalog.getHull('hull-test')?.displayName, '测试船体');
  assert.equal(catalog.getRoom('room-test')?.displayName, '测试房间');
  assert.equal(catalog.getCrew('crew-test')?.displayName, '测试船员');
});

test('规则目录拒绝空版本和重复定义 ID', () => {
  const definition = { schemaVersion: 1 as const, id: 'hull-test', displayName: '测试船体', level: 1, gridWidth: 1, gridHeight: 1, validCells: [1] as const, maxCrew: 0, maxRooms: 1, visualId: 'visual-test' };
  assert.throws(() => new GameConfigCatalog({ configVersion: '', hulls: [], rooms: [], crews: [] }), /配置版本不能为空/);
  assert.throws(() => new GameConfigCatalog({ configVersion: 'dev-test', hulls: [definition, definition], rooms: [], crews: [] }), /船体定义 ID 重复/);
});
