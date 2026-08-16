export const HULL_DEFINITION_SCHEMA_VERSION = 2 as const;

export const HULL_CELL_TYPES = ['VOID', 'BUILDABLE', 'FIXED_WALL'] as const;
export type HullCellType = (typeof HULL_CELL_TYPES)[number];
export const HULL_CELL_MASK_CODES = ['V', 'B', 'W'] as const;
export type HullCellMaskCode = (typeof HULL_CELL_MASK_CODES)[number];

/** 船体规则定义；只描述逻辑网格和稳定资源标识，不保存 Cocos 资源对象。 */
export interface HullDefinition {
  readonly schemaVersion: typeof HULL_DEFINITION_SCHEMA_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  /** 按行展开的船体格类型，长度必须等于 gridWidth * gridHeight。 */
  readonly cellTypes: readonly HullCellType[];
  /** 施工队列的船体基础槽位。 */
  readonly baseConstructionSlots: number;
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

export type HullCellMaskParseResult =
  | { readonly ok: true; readonly cellTypes: readonly HullCellType[] }
  | { readonly ok: false; readonly message: string };

/**
 * 将 CSV 的紧凑船体 Mask 展开为运行时格类型。
 * Mask 使用 `/` 分隔行、`V/B/W` 表示三种格型；严格按声明尺寸校验，避免编辑器或运行时悄悄错位。
 */
export function parseHullCellMask(cellMask: unknown, gridWidth: number, gridHeight: number): HullCellMaskParseResult {
  if (typeof cellMask !== 'string' || cellMask.length === 0) return { ok: false, message: '船体 cellMask 不能为空' };
  if (!Number.isInteger(gridWidth) || gridWidth <= 0 || !Number.isInteger(gridHeight) || gridHeight <= 0) {
    return { ok: false, message: '船体 cellMask 的网格尺寸必须是正整数' };
  }
  const rows = cellMask.split('/');
  if (rows.length !== gridHeight) return { ok: false, message: `船体 cellMask 必须包含 ${gridHeight} 行` };
  const cellTypes: HullCellType[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== gridWidth) return { ok: false, message: `船体 cellMask 第 ${rowIndex + 1} 行必须包含 ${gridWidth} 个格` };
    for (const code of row) {
      if (code === 'V') cellTypes.push('VOID');
      else if (code === 'B') cellTypes.push('BUILDABLE');
      else if (code === 'W') cellTypes.push('FIXED_WALL');
      else return { ok: false, message: `船体 cellMask 包含无效字符：${code}` };
    }
  }
  return { ok: true, cellTypes: Object.freeze(cellTypes) };
}

/** 从不可信配置行解析船体定义，成功结果会冻结，避免运行期静默改规则。 */
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
  let cellTypes: readonly HullCellType[];
  if (document.cellMask !== undefined) {
    const mask = parseHullCellMask(document.cellMask, document.gridWidth as number, document.gridHeight as number);
    if (mask.ok === false) return failure('INVALID_MASK', mask.message);
    if (document.cellTypes !== undefined && (
      !Array.isArray(document.cellTypes) ||
      document.cellTypes.length !== expectedCellCount ||
      !document.cellTypes.every((cell) => typeof cell === 'string' && (HULL_CELL_TYPES as readonly string[]).indexOf(cell) >= 0) ||
      document.cellTypes.some((cell, index) => cell !== mask.cellTypes[index])
    )) {
      return failure('INVALID_MASK', '船体 cellMask 与 cellTypes 不一致');
    }
    cellTypes = mask.cellTypes;
  } else {
    if (
      !Array.isArray(document.cellTypes) ||
      document.cellTypes.length !== expectedCellCount ||
      !document.cellTypes.every((cell) => typeof cell === 'string' && (HULL_CELL_TYPES as readonly string[]).indexOf(cell) >= 0)
    ) {
      return failure('INVALID_MASK', `船体格类型必须是长度为 ${expectedCellCount} 的合法数组`);
    }
    cellTypes = document.cellTypes as HullCellType[];
  }
  if (
    !Number.isInteger(document.maxCrew) || (document.maxCrew as number) < 0 ||
    !Number.isInteger(document.maxRooms) || (document.maxRooms as number) <= 0 ||
    !Number.isInteger(document.baseConstructionSlots) || (document.baseConstructionSlots as number) < 0 ||
    (document.baseConstructionSlots as number) > 8
  ) {
    return failure('INVALID_LIMIT', '船员、房间和施工槽位限制无效');
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
    cellTypes: Object.freeze([...cellTypes]),
    baseConstructionSlots: document.baseConstructionSlots as number,
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
