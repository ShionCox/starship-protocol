export const ROOM_DEFINITION_SCHEMA_VERSION = 1 as const;

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
  readonly crewCapacity: number;
}

/**
 * 房间定义的版本化 JSON 文档。
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

/** 将不可信 JSON 数据转换为经过校验的房间规则。 */
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
  if (!isNonNegativeInteger(value.crewCapacity)) {
    return failure('INVALID_NUMBER_RANGE', '船员容量必须是非负整数');
  }

  return {
    ok: true,
    definition: Object.freeze({
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
    }),
  };
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
