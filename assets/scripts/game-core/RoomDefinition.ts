export const ROOM_DEFINITION_SCHEMA_VERSION = 3 as const;

export const VERTICAL_CONNECTOR_KINDS = ['NONE', 'ELEVATOR', 'STAIRS'] as const;
export type VerticalConnectorKind = (typeof VERTICAL_CONNECTOR_KINDS)[number];

export const ROOM_CATEGORIES = [
  'ENERGY',
  'WEAPON',
  'DEFENSE',
  'MOBILITY',
  'SUPPORT',
  'MOVEMENT',
  'TACTICAL',
  'DRONE',
  'ECONOMY',
  'SPECIAL',
] as const;

export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

export interface RoomDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly category: RoomCategory;
  readonly width: number;
  readonly height: number;
  readonly maxLevel: number;
  readonly maxHp: number;
  readonly minPower: number;
  readonly maxPower: number;
  /** R1 能源纵切：能源房间每个实例提供的基础产能；旧配置缺省为 0。 */
  readonly powerGeneration: number;
  readonly crewCapacity: number;
  /** 医疗室每个固定 Tick 恢复的船员生命；0 表示不具备医疗能力。 */
  readonly healingHpPerTick: number;
  readonly verticalConnectorKind: VerticalConnectorKind;
  readonly visualId: string;
  readonly metalCost: number;
  readonly buildDurationMs: number;
  readonly demolishDurationMs: number;
  readonly refundPermille: number;
}

/**
 * 房间定义的版本化配置文档；P8 的权威来源是 CSV 行。
 *
 * Prefab 只保存表现；规则字段统一从该文档读取，避免编辑器预览和 GameCore
 * 各自保存一份尺寸或数值配置。
 */
export interface RoomDefinitionDocument extends RoomDefinition {
  readonly schemaVersion: typeof ROOM_DEFINITION_SCHEMA_VERSION;
}

export type RoomDefinitionParseErrorCode =
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_ID'
  | 'INVALID_CATEGORY'
  | 'INVALID_GRID_SIZE'
  | 'INVALID_NUMBER_RANGE';

export type RoomDefinitionParseResult =
  | { readonly ok: true; readonly definition: Readonly<RoomDefinition> }
  | {
    readonly ok: false;
    readonly code: RoomDefinitionParseErrorCode;
    readonly message: string;
  };

const ROOM_ID_PATTERN = /^room-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOM_CATEGORY_LABELS: Readonly<Record<RoomCategory, string>> = {
  ENERGY: '能源',
  WEAPON: '武器',
  DEFENSE: '防御',
  MOBILITY: '机动',
  SUPPORT: '支援',
  MOVEMENT: '移动',
  TACTICAL: '战术',
  DRONE: '无人机',
  ECONOMY: '经济',
  SPECIAL: '特殊',
};

/** 将不可信配置数据转换为经过校验的房间规则。 */
export function parseRoomDefinition(value: unknown): RoomDefinitionParseResult {
  if (!isRecord(value)) {
    return failure('INVALID_DOCUMENT', '房间定义必须是 JSON 对象');
  }
  if (value.schemaVersion !== ROOM_DEFINITION_SCHEMA_VERSION) {
    return failure('UNSUPPORTED_SCHEMA', `不支持的房间定义版本：${String(value.schemaVersion)}`);
  }
  if (typeof value.id !== 'string' || !ROOM_ID_PATTERN.test(value.id)) {
    return failure('INVALID_ID', '房间 ID 必须使用 room- 开头的小写 kebab-case 稳定字符串');
  }
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0) {
    return failure('INVALID_DOCUMENT', '房间中文名称不能为空');
  }
  if (typeof value.category !== 'string' || !isRoomCategory(value.category)) {
    return failure('INVALID_CATEGORY', `未知房间分类：${String(value.category)}`);
  }
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    return failure('INVALID_GRID_SIZE', '房间宽度和高度必须是正整数');
  }
  if (!isPositiveInteger(value.maxLevel) || !isPositiveInteger(value.maxHp)) {
    return failure('INVALID_NUMBER_RANGE', '最高等级和最大耐久必须是正整数');
  }
  if (
    !isNonNegativeInteger(value.minPower) ||
    !isNonNegativeInteger(value.maxPower) ||
    value.minPower > value.maxPower
  ) {
    return failure('INVALID_NUMBER_RANGE', '能源范围必须是非负整数，且最低能源不能大于最高能源');
  }
  const powerGeneration = value.powerGeneration;
  let normalizedPowerGeneration = 0;
  if (powerGeneration !== undefined) {
    if (!isNonNegativeInteger(powerGeneration)) {
      return failure('INVALID_NUMBER_RANGE', '能源产能必须是非负整数');
    }
    normalizedPowerGeneration = powerGeneration;
  }
  if (value.category !== 'ENERGY' && normalizedPowerGeneration > 0) {
    return failure(
      'INVALID_NUMBER_RANGE',
      `“${ROOM_CATEGORY_LABELS[value.category]}”房间的能源产能必须为 0`,
    );
  }
  if (!isNonNegativeInteger(value.crewCapacity)) {
    return failure('INVALID_NUMBER_RANGE', '船员容量必须是非负整数');
  }
  if (!isNonNegativeInteger(value.healingHpPerTick)) {
    return failure('INVALID_NUMBER_RANGE', '每 Tick 治疗量必须是非负整数');
  }
  if (value.category !== 'SUPPORT' && value.healingHpPerTick > 0) {
    return failure('INVALID_NUMBER_RANGE', `“${ROOM_CATEGORY_LABELS[value.category]}”房间的每 Tick 治疗量必须为 0`);
  }
  if (typeof value.verticalConnectorKind !== 'string' || (VERTICAL_CONNECTOR_KINDS as readonly string[]).indexOf(value.verticalConnectorKind) < 0) {
    return failure('INVALID_DOCUMENT', '房间纵向连接器类型无效');
  }
  if (value.verticalConnectorKind !== 'NONE' && value.category !== 'MOVEMENT') {
    return failure('INVALID_DOCUMENT', '楼梯和电梯必须属于移动分类');
  }
  if (typeof value.visualId !== 'string' || value.visualId.trim().length === 0) {
    return failure('INVALID_DOCUMENT', '房间外观 ID 不能为空');
  }
  if (!isNonNegativeInteger(value.metalCost) || !isPositiveInteger(value.buildDurationMs) ||
    !isPositiveInteger(value.demolishDurationMs) || !isNonNegativeInteger(value.refundPermille) || value.refundPermille > 1000) {
    return failure('INVALID_NUMBER_RANGE', '房间施工成本、时长或返还比例无效');
  }

  const definition: RoomDefinition = {
    id: value.id,
    displayName: value.displayName.trim(),
    category: value.category,
    width: value.width,
    height: value.height,
    maxLevel: value.maxLevel,
    maxHp: value.maxHp,
    minPower: value.minPower,
    maxPower: value.maxPower,
    crewCapacity: value.crewCapacity,
    powerGeneration: normalizedPowerGeneration,
    healingHpPerTick: value.healingHpPerTick,
    verticalConnectorKind: value.verticalConnectorKind as VerticalConnectorKind,
    visualId: value.visualId.trim(),
    metalCost: value.metalCost,
    buildDurationMs: value.buildDurationMs,
    demolishDurationMs: value.demolishDurationMs,
    refundPermille: value.refundPermille,
  };
  return { ok: true, definition: Object.freeze(definition) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRoomCategory(value: string): value is RoomCategory {
  return (ROOM_CATEGORIES as readonly string[]).indexOf(value) !== -1;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function failure(code: RoomDefinitionParseErrorCode, message: string): RoomDefinitionParseResult {
  return { ok: false, code, message };
}
