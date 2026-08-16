import { HULL_DEFINITION_SCHEMA_VERSION, parseHullDefinition, type HullDefinition } from './HullDefinition.ts';
import { ROOM_DEFINITION_SCHEMA_VERSION, parseRoomDefinition, type RoomDefinition } from './RoomDefinition.ts';
import { CREW_DEFINITION_SCHEMA_VERSION, parseCrewDefinition, type CrewDefinition } from './CrewDefinition.ts';

export type CrewTraitEffectType = 'CONSTRUCTION_SPEED_PERMILLE' | 'CONSTRUCTION_SLOT_BONUS';
export type ConnectorEntrySide = 'LEFT' | 'RIGHT';

export interface FloorDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly metalCost: number;
  readonly buildDurationMs: number;
  readonly demolishDurationMs: number;
  readonly refundPermille: number;
  readonly visualId: string;
}

export interface ConnectorPortDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly roomDefinitionId: string;
  readonly stopY: number;
  readonly entrySide: ConnectorEntrySide;
  readonly verticalMoveTicks: number;
}

export interface CrewTraitDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly effectType: CrewTraitEffectType;
  readonly effectValue: number;
}

export interface GameConfigCsvSources {
  readonly game: string;
  readonly hulls: string;
  readonly rooms: string;
  readonly connectorPorts: string;
  readonly floors: string;
  readonly crews: string;
  readonly crewTraits: string;
}

export interface ParsedGameConfig {
  readonly configVersion: string;
  readonly initialMetal: number;
  readonly hulls: readonly Readonly<HullDefinition>[];
  readonly rooms: readonly Readonly<RoomDefinition>[];
  readonly floors: readonly Readonly<FloorDefinition>[];
  readonly crews: readonly Readonly<CrewDefinition>[];
  readonly connectorPorts: readonly Readonly<ConnectorPortDefinition>[];
  readonly crewTraits: readonly Readonly<CrewTraitDefinition>[];
}

export type CsvGameConfigResult =
  | { readonly ok: true; readonly config: Readonly<ParsedGameConfig> }
  | { readonly ok: false; readonly message: string };

const HEADERS = {
  game: ['id', 'displayName', 'value'],
  hulls: ['id', 'displayName', 'level', 'gridWidth', 'gridHeight', 'cellMask', 'maxCrew', 'maxRooms', 'baseConstructionSlots', 'visualId'],
  rooms: ['id', 'displayName', 'category', 'width', 'height', 'maxLevel', 'maxHp', 'minPower', 'maxPower', 'powerGeneration', 'crewCapacity', 'healingHpPerTick', 'verticalConnectorKind', 'visualId', 'metalCost', 'buildDurationMs', 'demolishDurationMs', 'refundPermille'],
  connectorPorts: ['id', 'displayName', 'roomDefinitionId', 'stopY', 'entrySide', 'verticalMoveTicks'],
  floors: ['id', 'displayName', 'metalCost', 'buildDurationMs', 'demolishDurationMs', 'refundPermille', 'visualId'],
  crews: ['id', 'displayName', 'role', 'rarity', 'maxHp', 'moveTicksPerEdge', 'repairHpPerTick', 'appearanceId', 'traitIds'],
  crewTraits: ['id', 'displayName', 'effectType', 'effectValue'],
} as const;
const DESCRIPTION_MARKER = '#稳定标识';

/**
 * RFC4180 CSV 解析器。只负责文本边界；玩法字段和跨表关系由 parseGameConfigCsvBundle 统一校验。
 */
export function parseCsv(text: string): readonly (readonly string[])[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      field = '';
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
    } else if (char !== '\r') field += char;
  }
  if (quoted) throw new RangeError('CSV 引号未闭合');
  row.push(field);
  if (!(row.length === 1 && row[0] === '')) rows.push(row);
  return Object.freeze(rows.map((value) => Object.freeze(value)));
}

/** 一次解析全部权威表；任何一张表无效都不会返回半份配置。 */
export function parseGameConfigCsvBundle(sources: GameConfigCsvSources): CsvGameConfigResult {
  try {
    const game = readTable(sources.game, HEADERS.game, 'game.csv');
    const hullRows = readTable(sources.hulls, HEADERS.hulls, 'hulls.csv');
    const roomRows = readTable(sources.rooms, HEADERS.rooms, 'rooms.csv');
    const connectorRows = readTable(sources.connectorPorts, HEADERS.connectorPorts, 'connector-ports.csv');
    const floorRows = readTable(sources.floors, HEADERS.floors, 'floors.csv');
    const crewRows = readTable(sources.crews, HEADERS.crews, 'crews.csv');
    const traitRows = readTable(sources.crewTraits, HEADERS.crewTraits, 'crew-traits.csv');

    const gameValues = uniqueById(game, 'game.csv');
    const configVersion = requireText(gameValues.get('config-version')?.value, 'game.csv 缺少 config-version');
    const initialMetal = integer(gameValues.get('initial-metal')?.value, 'game.csv initial-metal', 0);

    const hulls = Array.from(uniqueById(hullRows, 'hulls.csv').values(), (row) => {
      const gridWidth = integer(row.gridWidth, `${row.id}.gridWidth`, 1);
      const gridHeight = integer(row.gridHeight, `${row.id}.gridHeight`, 1);
      const parsed = parseHullDefinition({
        schemaVersion: HULL_DEFINITION_SCHEMA_VERSION,
        id: row.id,
        displayName: row.displayName,
        level: integer(row.level, `${row.id}.level`, 1),
        gridWidth,
        gridHeight,
        cellMask: row.cellMask,
        maxCrew: integer(row.maxCrew, `${row.id}.maxCrew`, 0),
        maxRooms: integer(row.maxRooms, `${row.id}.maxRooms`, 1),
        baseConstructionSlots: integer(row.baseConstructionSlots, `${row.id}.baseConstructionSlots`, 0),
        visualId: row.visualId,
      });
      if (parsed.ok === false) throw new RangeError(`${row.id}: ${parsed.message}`);
      return parsed.definition;
    });
    const rooms = Array.from(uniqueById(roomRows, 'rooms.csv').values(), (row) => {
      const parsed = parseRoomDefinition({
        schemaVersion: ROOM_DEFINITION_SCHEMA_VERSION,
        ...row,
        width: integer(row.width, `${row.id}.width`, 1),
        height: integer(row.height, `${row.id}.height`, 1),
        maxLevel: integer(row.maxLevel, `${row.id}.maxLevel`, 1),
        maxHp: integer(row.maxHp, `${row.id}.maxHp`, 1),
        minPower: integer(row.minPower, `${row.id}.minPower`, 0),
        maxPower: integer(row.maxPower, `${row.id}.maxPower`, 0),
        powerGeneration: integer(row.powerGeneration, `${row.id}.powerGeneration`, 0),
        crewCapacity: integer(row.crewCapacity, `${row.id}.crewCapacity`, 0),
        healingHpPerTick: integer(row.healingHpPerTick, `${row.id}.healingHpPerTick`, 0),
        metalCost: integer(row.metalCost, `${row.id}.metalCost`, 0),
        buildDurationMs: integer(row.buildDurationMs, `${row.id}.buildDurationMs`, 1),
        demolishDurationMs: integer(row.demolishDurationMs, `${row.id}.demolishDurationMs`, 1),
        refundPermille: integer(row.refundPermille, `${row.id}.refundPermille`, 0, 1000),
      });
      if (parsed.ok === false) throw new RangeError(`${row.id}: ${parsed.message}`);
      return parsed.definition;
    });
    const roomIds = new Set(rooms.map((entry) => entry.id));

    const floors = Array.from(uniqueById(floorRows, 'floors.csv').values(), (row) => Object.freeze({
      id: stableId(row.id, 'floor-'),
      displayName: requireText(row.displayName, `${row.id}.displayName`),
      metalCost: integer(row.metalCost, `${row.id}.metalCost`, 0),
      buildDurationMs: integer(row.buildDurationMs, `${row.id}.buildDurationMs`, 1),
      demolishDurationMs: integer(row.demolishDurationMs, `${row.id}.demolishDurationMs`, 1),
      refundPermille: integer(row.refundPermille, `${row.id}.refundPermille`, 0, 1000),
      visualId: requireText(row.visualId, `${row.id}.visualId`),
    }));

    const traits = Array.from(uniqueById(traitRows, 'crew-traits.csv').values(), (row) => {
      if (['CONSTRUCTION_SPEED_PERMILLE', 'CONSTRUCTION_SLOT_BONUS'].indexOf(row.effectType) < 0) throw new RangeError(`${row.id}.effectType 无效`);
      return Object.freeze({
        id: stableId(row.id, 'trait-'),
        displayName: requireText(row.displayName, `${row.id}.displayName`),
        effectType: row.effectType as CrewTraitEffectType,
        effectValue: integer(row.effectValue, `${row.id}.effectValue`, 0),
      });
    });
    const traitIds = new Set(traits.map((entry) => entry.id));

    const crews = Array.from(uniqueById(crewRows, 'crews.csv').values(), (row) => {
      const rowTraitIds = splitIds(row.traitIds);
      for (const traitId of rowTraitIds) if (!traitIds.has(traitId)) throw new RangeError(`${row.id} 引用未知词条：${traitId}`);
      const parsed = parseCrewDefinition({
        schemaVersion: CREW_DEFINITION_SCHEMA_VERSION,
        ...row,
        maxHp: integer(row.maxHp, `${row.id}.maxHp`, 1),
        moveTicksPerEdge: integer(row.moveTicksPerEdge, `${row.id}.moveTicksPerEdge`, 1),
        repairHpPerTick: integer(row.repairHpPerTick, `${row.id}.repairHpPerTick`, 0),
        traitIds: rowTraitIds,
      });
      if (parsed.ok === false) throw new RangeError(`${row.id}: ${parsed.message}`);
      return parsed.definition;
    });

    const connectorPorts = Array.from(uniqueById(connectorRows, 'connector-ports.csv').values(), (row) => {
      if (!roomIds.has(row.roomDefinitionId)) throw new RangeError(`${row.id} 引用未知连接器房间：${row.roomDefinitionId}`);
      const room = rooms.find((entry) => entry.id === row.roomDefinitionId) as Readonly<RoomDefinition>;
      if (room.verticalConnectorKind === 'NONE') throw new RangeError(`${row.id} 引用的房间不是连接器`);
      if (['LEFT', 'RIGHT'].indexOf(row.entrySide) < 0) throw new RangeError(`${row.id}.entrySide 无效`);
      return Object.freeze({
        id: stableId(row.id, 'port-'),
        displayName: requireText(row.displayName, `${row.id}.displayName`),
        roomDefinitionId: row.roomDefinitionId,
        stopY: integer(row.stopY, `${row.id}.stopY`, 0),
        entrySide: row.entrySide as ConnectorEntrySide,
        verticalMoveTicks: integer(row.verticalMoveTicks, `${row.id}.verticalMoveTicks`, 1),
      });
    });

    return {
      ok: true,
      config: Object.freeze({
        configVersion,
        initialMetal,
        hulls: freezeSorted(hulls),
        rooms: freezeSorted(rooms),
        floors: freezeSorted(floors),
        crews: freezeSorted(crews),
        connectorPorts: freezeSorted(connectorPorts),
        crewTraits: freezeSorted(traits),
      }),
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

type CsvRecord = Readonly<Record<string, string>>;

function readTable(text: string, expectedHeaders: readonly string[], filename: string): readonly CsvRecord[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new RangeError(`${filename} 不能为空`);
  const headers = rows[0];
  if (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) {
    throw new RangeError(`${filename} 表头必须严格为：${expectedHeaders.join(',')}`);
  }
  const descriptions = rows[1];
  if (descriptions === undefined || descriptions.length !== headers.length || descriptions[0] !== DESCRIPTION_MARKER || descriptions.slice(1).some((value) => value.trim() === '')) {
    throw new RangeError(`${filename} 第二行必须是“${DESCRIPTION_MARKER}”开头且逐列填写中文说明`);
  }
  return Object.freeze(rows.slice(2).map((row, rowIndex) => {
    if (row.length !== headers.length) throw new RangeError(`${filename} 第 ${rowIndex + 3} 行列数不一致`);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = row[index]; });
    if (record.id.trim() === '' || record.displayName.trim() === '') throw new RangeError(`${filename} 第 ${rowIndex + 3} 行 ID 或中文名称为空`);
    return Object.freeze(record);
  }));
}

function uniqueById(rows: readonly CsvRecord[], filename: string): ReadonlyMap<string, CsvRecord> {
  const result = new Map<string, CsvRecord>();
  for (const row of rows) {
    if (result.has(row.id)) throw new RangeError(`${filename} 稳定 ID 重复：${row.id}`);
    result.set(row.id, row);
  }
  return result;
}

function integer(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new RangeError(`${label} 必须是 ${minimum} 到 ${maximum} 的整数`);
  return parsed;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new RangeError(label);
  return value.trim();
}

function stableId(value: string, prefix: string): string {
  if (!new RegExp(`^${prefix}[a-z0-9]+(?:-[a-z0-9]+)*$`).test(value)) throw new RangeError(`稳定 ID 格式无效：${value}`);
  return value;
}

function splitIds(value: string): readonly string[] {
  if (value.trim() === '') return Object.freeze([]);
  const ids = value.split('|').map((entry) => entry.trim());
  if (new Set(ids).size !== ids.length) throw new RangeError(`词条 ID 重复：${value}`);
  return Object.freeze(ids);
}

function freezeSorted<T extends { readonly id: string }>(values: readonly T[]): readonly Readonly<T>[] {
  return Object.freeze([...values].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => Object.freeze(entry)));
}
