export const CREW_DEFINITION_SCHEMA_VERSION = 1 as const;

export const CREW_ROLES = ['ENGINEER', 'GUNNER'] as const;

export type CrewRole = (typeof CREW_ROLES)[number];

export const CREW_ROLE_LABELS: Readonly<Record<CrewRole, string>> = {
  ENGINEER: '工程师',
  GUNNER: '武器操作员',
};

export interface CrewDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly role: CrewRole;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
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

/** 将不可信 JSON 转换为最小船员规则定义。 */
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
  if (!isPositiveInteger(value.maxHp)) {
    return failure('INVALID_NUMBER_RANGE', '船员最大生命必须是正整数');
  }
  if (!isPositiveInteger(value.moveTicksPerEdge)) {
    return failure('INVALID_NUMBER_RANGE', '每段移动耗时必须是正整数 Tick');
  }

  return {
    ok: true,
    definition: Object.freeze({
      id: value.id,
      displayName: value.displayName.trim(),
      role: value.role,
      maxHp: value.maxHp,
      moveTicksPerEdge: value.moveTicksPerEdge,
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

function failure(
  code: CrewDefinitionParseErrorCode,
  message: string,
): { readonly ok: false; readonly code: CrewDefinitionParseErrorCode; readonly message: string } {
  return { ok: false, code, message };
}
