import type { CrewDefinition } from '../../assets/scripts/game-core/CrewDefinition.ts';
import type { HullCellType, HullDefinition } from '../../assets/scripts/game-core/HullDefinition.ts';
import type { RoomDefinition } from '../../assets/scripts/game-core/RoomDefinition.ts';
import type { RoomPlacement } from '../../assets/scripts/game-core/ShipGridModel.ts';

export function hull(id = 'hull-test', width = 20, height = 10, cellTypes?: readonly HullCellType[]): HullDefinition {
  return {
    schemaVersion: 2,
    id,
    displayName: '测试船体',
    level: 1,
    gridWidth: width,
    gridHeight: height,
    cellTypes: cellTypes ?? Array<HullCellType>(width * height).fill('BUILDABLE'),
    baseConstructionSlots: 3,
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
  healingHpPerTick = 0,
): RoomDefinition {
  return { id, displayName: id, category, width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower, maxPower, powerGeneration, crewCapacity, healingHpPerTick, verticalConnectorKind: 'NONE', visualId: `visual-${id}`, metalCost: 10, buildDurationMs: 1000, demolishDurationMs: 1000, refundPermille: 500 };
}

export function placement(instanceId: string, definitionId: string, x: number, y: number, width = 2, height = 2): RoomPlacement {
  return { instanceId, definitionId, x, y, width, height };
}

export const ENGINEER: CrewDefinition = { id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', rarity: 'RARE', maxHp: 100, moveTicksPerEdge: 5, repairHpPerTick: 1, appearanceId: 'appearance-engineer', traitIds: Object.freeze(['trait-construction-speed-250']) };
export const GUNNER: CrewDefinition = { id: 'crew-gunner', displayName: '武器操作员', role: 'GUNNER', rarity: 'COMMON', maxHp: 100, moveTicksPerEdge: 5, repairHpPerTick: 0, appearanceId: 'appearance-gunner', traitIds: Object.freeze([]) };
export const MEDIC: CrewDefinition = { id: 'crew-medic', displayName: '医务员', role: 'MEDIC', rarity: 'COMMON', maxHp: 100, moveTicksPerEdge: 5, repairHpPerTick: 0, appearanceId: 'appearance-medic', traitIds: Object.freeze([]) };
