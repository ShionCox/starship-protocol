import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import { NavigationGraph, stationNodeId } from '../../assets/scripts/game-core/NavigationGraph.ts';
import type { RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';

function room(id: string, category: RoomDefinition['category'], crewCapacity: number): RoomDefinition {
  return { id: id.replace(/-1$/, ''), displayName: id, category, width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 0, crewCapacity };
}

const PLACEMENTS: readonly RoomPlacement[] = [
  { id: 'room-reactor-1', x: 0, y: 0, width: 2, height: 2 },
  { id: 'room-elevator-1', x: 2, y: 0, width: 2, height: 2 },
  { id: 'room-laser-1', x: 4, y: 0, width: 2, height: 2 },
  { id: 'room-shield-1', x: 6, y: 0, width: 2, height: 2 },
];

const DEFINITIONS = new Map<string, RoomDefinition>([
  ['room-reactor-1', room('room-reactor-1', 'ENERGY', 2)],
  ['room-elevator-1', room('room-elevator-1', 'MOVEMENT', 1)],
  ['room-laser-1', room('room-laser-1', 'WEAPON', 2)],
  ['room-shield-1', room('room-shield-1', 'DEFENSE', 2)],
]);

test('导航图由共享边连接，固定路径经过电梯', () => {
  const graph = new NavigationGraph(PLACEMENTS, DEFINITIONS);
  const result = graph.findPath(stationNodeId('room-reactor-1', 0), stationNodeId('room-laser-1', 0));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.nodeIds, [
      'room:room-reactor-1:station:0',
      'room:room-reactor-1:exit',
      'room:room-elevator-1:exit',
      'room:room-laser-1:exit',
      'room:room-laser-1:station:0',
    ]);
  }
});

test('角点接触不连通，非相邻房间不会直接连接', () => {
  const placements: readonly RoomPlacement[] = [
    { id: 'room-reactor-1', x: 0, y: 0, width: 2, height: 2 },
    { id: 'room-elevator-1', x: 2, y: 2, width: 2, height: 2 },
  ];
  const definitions = new Map([...DEFINITIONS].filter(([id]) => id !== 'room-laser-1' && id !== 'room-shield-1'));
  const graph = new NavigationGraph(placements, definitions);
  assert.equal(graph.findPath(stationNodeId('room-reactor-1', 0), stationNodeId('room-elevator-1', 0)).ok, false);
});

test('同代价路径按稳定节点 ID 决定并命中缓存，布局变化会改变图版本', () => {
  const graph = new NavigationGraph(PLACEMENTS, DEFINITIONS);
  const first = graph.findPath(stationNodeId('room-reactor-1', 0), stationNodeId('room-shield-1', 0));
  const second = graph.findPath(stationNodeId('room-reactor-1', 0), stationNodeId('room-shield-1', 0));
  assert.deepEqual(second, first);
  const moved = PLACEMENTS.map((placement) => placement.id === 'room-shield-1' ? { ...placement, x: 8 } : placement);
  assert.notEqual(new NavigationGraph(moved, DEFINITIONS).version, graph.version);
});
