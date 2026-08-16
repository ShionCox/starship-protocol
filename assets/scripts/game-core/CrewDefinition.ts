export const CREW_DEFINITION_SCHEMA_VERSION = 4 as const;

export const CREW_ROLES = ['ENGINEER', 'GUNNER', 'MEDIC', 'SOLDIER'] as const;
export const CREW_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

export type CrewRole = (typeof CREW_ROLES)[number];
export type CrewRarity = (typeof CREW_RARITIES)[number];

export const CREW_ROLE_LABELS: Readonly<Record<CrewRole, string>> = {
  ENGINEER: '工程师',
  GUNNER: '武器操作员',
  MEDIC: '医务员',
  SOLDIER: '士兵',
};

export interface CrewDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly role: CrewRole;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
  readonly repairHpPerTick: number;
  readonly rarity: CrewRarity;
  readonly appearanceId: string;
  readonly traitIds: readonly string[];
}

export interface CrewDefinitionDocument extends CrewDefinition {
  readonly schemaVersion: typeof CREW_DEFINITION_SCHEMA_VERSION;
}

export type CrewDefinitionParseErrorCode =
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_ID'
  | 'INVALID_ROLE'
  | 'INVALID_NUMBER_RANGE';

export type CrewDefinitionParseResult =
  | { readonly ok: true; readonly definition: Readonly<CrewDefinition> }
  | {
    readonly ok: false;
    readonly code: CrewDefinitionParseErrorCode;
    readonly message: string;
  };

const CREW_ID_PATTERN = /^crew-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 将不可信配置数据转换为最小船员规则定义。 */
export function parseCrewDefinition(value: unknown): CrewDefinitionParseResult {
  if (!isRecord(value)) return failure('INVALID_DOCUMENT', '船员定义必须是 JSON 对象');
  if (value.schemaVersion !== CREW_DEFINITION_SCHEMA_VERSION) {
    return failure('UNSUPPORTED_SCHEMA', `不支持的船员定义版本：${String(value.schemaVersion)}`);
  }
  if (typeof value.id !== 'string' || !CREW_ID_PATTERN.test(value.id)) {
    return failure('INVALID_ID', '船员 ID 必须使用 crew- 开头的小写 kebab-case 稳定字符串');
  }
  if (typeof value.displayName !== 'string' || value.displayName.trim().length === 0) {
    return failure('INVALID_DOCUMENT', '船员中文名称不能为空');
  }
  if (typeof value.role !== 'string' || !isCrewRole(value.role)) {
    return failure('INVALID_ROLE', `未知船员职业：${String(value.role)}`);
  }
  if (typeof value.rarity !== 'string' || (CREW_RARITIES as readonly string[]).indexOf(value.rarity) < 0) {
    return failure('INVALID_DOCUMENT', '船员稀有度无效');
  }
  if (typeof value.appearanceId !== 'string' || value.appearanceId.trim().length === 0) {
    return failure('INVALID_DOCUMENT', '船员外观 ID 不能为空');
  }
  if (!Array.isArray(value.traitIds) || !value.traitIds.every((trait) => typeof trait === 'string' && /^trait-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trait))) {
    return failure('INVALID_DOCUMENT', '船员词条列表无效');
  }
  if (new Set(value.traitIds as string[]).size !== value.traitIds.length) return failure('INVALID_DOCUMENT', '船员词条不能重复');
  if (!isPositiveInteger(value.maxHp)) {
    return failure('INVALID_NUMBER_RANGE', '船员最大生命必须是正整数');
  }
  if (!isPositiveInteger(value.moveTicksPerEdge)) {
    return failure('INVALID_NUMBER_RANGE', '每段移动耗时必须是正整数 Tick');
  }
  if (!isNonNegativeInteger(value.repairHpPerTick)) {
    return failure('INVALID_NUMBER_RANGE', '每 Tick 维修量必须是非负整数');
  }
  if (value.role === 'ENGINEER' && value.repairHpPerTick === 0) {
    return failure('INVALID_NUMBER_RANGE', '工程师每 Tick 维修量必须大于 0');
  }
  if (value.role !== 'ENGINEER' && value.repairHpPerTick !== 0) {
    return failure('INVALID_NUMBER_RANGE', `${CREW_ROLE_LABELS[value.role]}每 Tick 维修量必须为 0`);
  }

  return {
    ok: true,
    definition: Object.freeze({
      id: value.id,
      displayName: value.displayName.trim(),
      role: value.role,
      maxHp: value.maxHp,
      moveTicksPerEdge: value.moveTicksPerEdge,
      repairHpPerTick: value.repairHpPerTick,
      rarity: value.rarity as CrewRarity,
      appearanceId: value.appearanceId.trim(),
      traitIds: Object.freeze([...(value.traitIds as string[])]),
    }),
  };
}

function isCrewRole(value: string): value is CrewRole {
  return (CREW_ROLES as readonly string[]).indexOf(value) !== -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function failure(
  code: CrewDefinitionParseErrorCode,
  message: string,
): { readonly ok: false; readonly code: CrewDefinitionParseErrorCode; readonly message: string } {
  return { ok: false, code, message };
}
