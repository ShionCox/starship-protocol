import assert from 'node:assert/strict';
import test from 'node:test';
import type { FloorDefinition } from '../../assets/scripts/game-core/CsvGameConfig.ts';
import { connectorStopNodeId, NavigationGraph, floorNodeId, stationNodeId } from '../../assets/scripts/game-core/NavigationGraph.ts';
import type { HullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import { VoxelLayoutModel } from '../../assets/scripts/game-core/VoxelLayoutModel.ts';

const hull: HullDefinition = {
  schemaVersion: 2, id: 'hull-test', displayName: '测试船体', level: 1, gridWidth: 8, gridHeight: 8,
  cellTypes: Object.freeze(Array.from({ length: 64 }, (_, index) => {
    const x = index % 8; const y = Math.floor(index / 8);
    return x === 0 || y === 0 || x === 7 || y === 7 ? 'FIXED_WALL' : 'BUILDABLE';
  })),
  baseConstructionSlots: 3, maxCrew: 6, maxRooms: 8, visualId: 'visual-test',
};
const floor: FloorDefinition = { id: 'floor-basic', displayName: '基础地板', metalCost: 5, buildDurationMs: 2000, demolishDurationMs: 1000, refundPermille: 500, visualId: 'visual-floor-basic' };
const room: RoomDefinition = {
  id: 'room-test', displayName: '测试房间', category: 'SUPPORT', width: 2, height: 2, maxLevel: 1, maxHp: 100,
  minPower: 0, maxPower: 0, powerGeneration: 0, crewCapacity: 1, healingHpPerTick: 0,
  verticalConnectorKind: 'NONE', visualId: 'visual-room-test', metalCost: 10, buildDurationMs: 1000, demolishDurationMs: 1000, refundPermille: 500,
};
const elevator: RoomDefinition = { ...room, id: 'room-elevator', displayName: '电梯', category: 'MOVEMENT', width: 1, height: 4, verticalConnectorKind: 'ELEVATOR' };
const stairs: RoomDefinition = { ...room, id: 'room-stairs', displayName: '楼梯', category: 'MOVEMENT', width: 1, height: 4, verticalConnectorKind: 'STAIRS' };

test('固定墙不可建，房间必须完整受地板支撑', () => {
  const layout = new VoxelLayoutModel(hull);
  assert.equal(layout.buildFloor('floor-wall', floor, 0, 1).ok, false);
  assert.equal(layout.placeInitialFloor('floor-1', floor, 1, 1).ok, true);
  assert.equal(layout.validateRoomBuild('room-1', room, 1, 2).ok, false);
  assert.equal(layout.buildFloor('floor-2', floor, 2, 1).ok, true);
  assert.equal(layout.buildRoom('room-1', room, 1, 2).ok, true);
  assert.equal(layout.validateFloorDemolition('floor-1').ok, false);
});

test('同层地板左右连通，上下相邻不连通，只有连接器建立跨层边', () => {
  const placements = [
    { instanceId: 'room-lower', definitionId: room.id, x: 1, y: 2, width: 2, height: 2 },
    { instanceId: 'room-upper', definitionId: room.id, x: 1, y: 6, width: 2, height: 1 },
    { instanceId: 'elevator-1', definitionId: elevator.id, x: 4, y: 2, width: 1, height: 4 },
  ];
  const definitions = new Map<string, Readonly<RoomDefinition>>([
    ['room-lower', room], ['room-upper', room], ['elevator-1', elevator],
  ]);
  const floors = [1, 2, 3, 5].flatMap((x) => [
    { instanceId: `floor-${x}-1`, x, y: 1, completed: true },
    { instanceId: `floor-${x}-5`, x, y: 5, completed: true },
  ]);
  const withoutConnector = new NavigationGraph(placements.slice(0, 2), new Map([['room-lower', room], ['room-upper', room]]), { floors, connectors: [] });
  assert.equal(withoutConnector.findPath(stationNodeId('room-lower', 0), stationNodeId('room-upper', 0)).ok, false);
  assert.equal(withoutConnector.areConnected(floorNodeId(1, 1), floorNodeId(2, 1)), true);
  assert.equal(withoutConnector.areConnected(floorNodeId(1, 1), floorNodeId(1, 5)), false);

  const withConnector = new NavigationGraph(placements, definitions, {
    floors,
    connectors: [{
      roomInstanceId: 'elevator-1', definitionId: elevator.id, completed: true,
      ports: [
        { id: 'port-low', displayName: '下层', roomDefinitionId: elevator.id, stopY: 1, entrySide: 'LEFT', verticalMoveTicks: 5 },
        { id: 'port-high', displayName: '上层', roomDefinitionId: elevator.id, stopY: 5, entrySide: 'LEFT', verticalMoveTicks: 5 },
      ],
    }],
  });
  assert.equal(withConnector.findPath(stationNodeId('room-lower', 0), stationNodeId('room-upper', 0)).ok, true);
  assert.deepEqual(withConnector.getNodeAnchor(floorNodeId(2, 1)), { x: 2, y: 1 });
  assert.deepEqual(withConnector.getNodeAnchor(connectorStopNodeId('elevator-1', 'port-low')), { x: 4, y: 1 });
  assert.deepEqual(withConnector.getNodeAnchor(connectorStopNodeId('elevator-1', 'port-high')), { x: 4, y: 5 });
  assert.equal(withConnector.getEdgeTravelTicks(
    connectorStopNodeId('elevator-1', 'port-low'),
    connectorStopNodeId('elevator-1', 'port-high'),
    2,
  ), 5);
  const path = withConnector.findPath(floorNodeId(3, 1), floorNodeId(3, 5), 2);
  assert.equal(path.ok, true);
  if (path.ok) assert.deepEqual(path.nodeIds, [
    floorNodeId(3, 1),
    connectorStopNodeId('elevator-1', 'port-low'),
    connectorStopNodeId('elevator-1', 'port-high'),
    floorNodeId(3, 5),
  ]);
  assert.notEqual(withConnector.version, withoutConnector.version);
});

test('楼梯和电梯可以穿过声明的上层地板，普通房间仍拒绝与地板重叠', () => {
  const layout = new VoxelLayoutModel(hull);
  for (const y of [1, 5]) {
    for (const x of [3, 4]) assert.equal(layout.placeInitialFloor(`floor-${x}-${y}`, floor, x, y).ok, true);
  }
  assert.equal(layout.validateRoomBuild('ordinary', room, 3, 4).ok, false);
  assert.equal(layout.buildRoom('elevator-1', elevator, 4, 2).ok, true);
});

test('加权最短路优先五 Tick 电梯，楼梯纵向边保持八 Tick', () => {
  const floors = [1, 2, 3, 4, 5, 6].flatMap((x) => [
    { instanceId: `floor-${x}-1`, x, y: 1, completed: true },
    { instanceId: `floor-${x}-5`, x, y: 5, completed: true },
  ]);
  const placements = [
    { instanceId: 'elevator-fast', definitionId: elevator.id, x: 3, y: 2, width: 1, height: 4 },
    { instanceId: 'stairs-slow', definitionId: stairs.id, x: 7, y: 2, width: 1, height: 4 },
  ];
  const definitions = new Map<string, Readonly<RoomDefinition>>([
    ['elevator-fast', elevator], ['stairs-slow', stairs],
  ]);
  const graph = new NavigationGraph(placements, definitions, {
    floors,
    connectors: [
      {
        roomInstanceId: 'elevator-fast', definitionId: elevator.id, completed: true,
        ports: [
          { id: 'low', displayName: '下层', roomDefinitionId: elevator.id, stopY: 1, entrySide: 'LEFT', verticalMoveTicks: 5 },
          { id: 'high', displayName: '上层', roomDefinitionId: elevator.id, stopY: 5, entrySide: 'LEFT', verticalMoveTicks: 5 },
        ],
      },
      {
        roomInstanceId: 'stairs-slow', definitionId: stairs.id, completed: true,
        ports: [
          { id: 'low', displayName: '下层', roomDefinitionId: stairs.id, stopY: 1, entrySide: 'LEFT', verticalMoveTicks: 8 },
          { id: 'high', displayName: '上层', roomDefinitionId: stairs.id, stopY: 5, entrySide: 'LEFT', verticalMoveTicks: 8 },
        ],
      },
    ],
  });
  assert.equal(graph.getEdgeTravelTicks(connectorStopNodeId('stairs-slow', 'low'), connectorStopNodeId('stairs-slow', 'high'), 2), 8);
  const path = graph.findPath(floorNodeId(4, 1), floorNodeId(4, 5), 2);
  assert.equal(path.ok, true);
  if (path.ok) {
    assert.equal(path.nodeIds.indexOf(connectorStopNodeId('elevator-fast', 'low')) >= 0, true);
    assert.equal(path.nodeIds.indexOf(connectorStopNodeId('stairs-slow', 'low')), -1);
  }
});
