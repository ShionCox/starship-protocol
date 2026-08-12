import type { CrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import type { HullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import type { RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';

export function hull(id = 'hull-test', width = 20, height = 10, validCells?: readonly number[]): HullDefinition {
  return {
    schemaVersion: 1,
    id,
    displayName: '测试船体',
    level: 1,
    gridWidth: width,
    gridHeight: height,
    validCells: validCells ?? Array<number>(width * height).fill(1),
    maxCrew: 10,
    maxRooms: width * height,
    visualId: 'visual-test-hull',
  };
}

export function roomDefinition(
  id: string,
  category: RoomDefinition['category'] = 'SUPPORT',
  crewCapacity = 1,
  powerGeneration = 0,
  minPower = 0,
  maxPower = 0,
): RoomDefinition {
  return { id, displayName: id, category, width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower, maxPower, powerGeneration, crewCapacity };
}

export function placement(instanceId: string, definitionId: string, x: number, y: number, width = 2, height = 2): RoomPlacement {
  return { instanceId, definitionId, x, y, width, height };
}

export const ENGINEER: CrewDefinition = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5 };
export const GUNNER: CrewDefinition = { id: 'crew-gunner', displayName: '武器操作员', role: 'GUNNER', maxHp: 100, moveTicksPerEdge: 5 };
