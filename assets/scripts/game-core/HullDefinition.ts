export const HULL_DEFINITION_SCHEMA_VERSION = 1 as const;

/** 船体规则定义；只描述逻辑网格和稳定资源标识，不保存 Cocos 资源对象。 */
export interface HullDefinition {
  readonly schemaVersion: typeof HULL_DEFINITION_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** 按行展开的 0/1 Mask，长度必须等于 gridWidth * gridHeight。 */
  readonly validCells: readonly number[];
  readonly maxCrew: number;
  readonly maxRooms: number;
  readonly visualId: string;
}

export type HullDefinitionErrorCode =
  | 'INVALID_DOCUMENT'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_ID'
  | 'INVALID_NAME'
  | 'INVALID_GRID'
  | 'INVALID_MASK'
  | 'INVALID_LIMIT'
  | 'INVALID_VISUAL_ID';

export type HullDefinitionParseResult =
  | { readonly ok: true; readonly definition: Readonly<HullDefinition> }
  | { readonly ok: false; readonly code: HullDefinitionErrorCode; readonly message: string };

/** 从不可信 JSON 文档解析船体定义，成功结果会冻结，避免运行期静默改规则。 */
export function parseHullDefinition(document: unknown): HullDefinitionParseResult {
  if (!isRecord(document)) return failure('INVALID_DOCUMENT', '船体定义根节点必须是对象');
  if (document.schemaVersion !== HULL_DEFINITION_SCHEMA_VERSION) {
    return failure('UNSUPPORTED_SCHEMA', '船体定义版本不受支持');
  }
  if (typeof document.id !== 'string' || !/^hull-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document.id)) {
    return failure('INVALID_ID', '船体定义 ID 必须使用 hull- 开头的小写短横线格式');
  }
  if (typeof document.displayName !== 'string' || document.displayName.trim().length === 0) {
    return failure('INVALID_NAME', '船体中文名称不能为空');
  }
  if (
    !Number.isInteger(document.level) || (document.level as number) <= 0 ||
    !Number.isInteger(document.gridWidth) || (document.gridWidth as number) <= 0 ||
    !Number.isInteger(document.gridHeight) || (document.gridHeight as number) <= 0
  ) {
    return failure('INVALID_GRID', '船体等级和网格宽高必须是正整数');
  }
  const expectedCellCount = (document.gridWidth as number) * (document.gridHeight as number);
  if (
    !Array.isArray(document.validCells) ||
    document.validCells.length !== expectedCellCount ||
    !document.validCells.every((cell) => cell === 0 || cell === 1)
  ) {
    return failure('INVALID_MASK', `船体有效格必须是长度为 ${expectedCellCount} 的 0/1 数组`);
  }
  if (
    !Number.isInteger(document.maxCrew) || (document.maxCrew as number) < 0 ||
    !Number.isInteger(document.maxRooms) || (document.maxRooms as number) <= 0
  ) {
    return failure('INVALID_LIMIT', '船员上限必须是非负整数，房间上限必须是正整数');
  }
  if (typeof document.visualId !== 'string' || document.visualId.trim().length === 0) {
    return failure('INVALID_VISUAL_ID', '船体外观 ID 不能为空');
  }

  const definition: HullDefinition = {
    schemaVersion: HULL_DEFINITION_SCHEMA_VERSION,
    id: document.id,
    displayName: document.displayName.trim(),
    level: document.level as number,
    gridWidth: document.gridWidth as number,
    gridHeight: document.gridHeight as number,
    validCells: Object.freeze([...(document.validCells as number[])]),
    maxCrew: document.maxCrew as number,
    maxRooms: document.maxRooms as number,
    visualId: document.visualId.trim(),
  };
  return { ok: true, definition: Object.freeze(definition) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: HullDefinitionErrorCode, message: string): HullDefinitionParseResult {
  return { ok: false, code, message };
}
