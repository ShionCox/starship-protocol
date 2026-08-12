/** 写入 Asset DB 的版本化船体规则文档。 */
export interface HullDefinitionDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly validCells: readonly number[];
  readonly maxCrew: number;
  readonly maxRooms: number;
  readonly visualId: string;
}

/** 创作面板提交给船体领域校验器的白名单字段。 */
export interface HullDefinitionInput {
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly validCells: readonly number[];
  readonly maxCrew: number;
  readonly maxRooms: number;
  readonly visualId: string;
}

const HULL_ID_PATTERN = /^hull-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 船体领域唯一校验器；创建、发现和编辑均调用这里。 */
export function validateHullDefinition(input: HullDefinitionInput): string | null {
  if (!HULL_ID_PATTERN.test(input.id)) return '船体标识必须使用 hull- 开头的小写短横线格式';
  if (input.displayName.trim() === '') return '船体中文名称不能为空';
  if (!isPositiveInteger(input.level) || !isPositiveInteger(input.gridWidth) || !isPositiveInteger(input.gridHeight)) {
    return '船体等级和网格宽高必须是正整数';
  }
  const expected = input.gridWidth * input.gridHeight;
  if (!Array.isArray(input.validCells) || input.validCells.length !== expected || input.validCells.some((cell) => cell !== 0 && cell !== 1)) {
    return `船体有效格必须是长度为 ${expected} 的 0/1 数组`;
  }
  if (!Number.isInteger(input.maxCrew) || input.maxCrew < 0 || !isPositiveInteger(input.maxRooms)) {
    return '船员上限必须是非负整数，房间上限必须是正整数';
  }
  if (!/^visual-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.visualId)) {
    return '船体外观标识必须使用 visual- 开头的小写短横线格式';
  }
  return null;
}

/** 校验并生成可保存的船体规则文档。 */
export function createHullDocument(input: HullDefinitionInput): HullDefinitionDocument {
  const message = validateHullDefinition(input);
  if (message !== null) throw new RangeError(message);
  return {
    schemaVersion: 1,
    id: input.id,
    displayName: input.displayName.trim(),
    level: input.level,
    gridWidth: input.gridWidth,
    gridHeight: input.gridHeight,
    validCells: [...input.validCells],
    maxCrew: input.maxCrew,
    maxRooms: input.maxRooms,
    visualId: input.visualId,
  };
}

/** 解析 Asset DB 中的不可信 JSON，非法文档返回 null 供目录诊断。 */
export function parseHullDefinition(value: unknown): HullDefinitionDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const input: HullDefinitionInput = {
    id: typeof value.id === 'string' ? value.id : '',
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    level: typeof value.level === 'number' ? value.level : Number.NaN,
    gridWidth: typeof value.gridWidth === 'number' ? value.gridWidth : Number.NaN,
    gridHeight: typeof value.gridHeight === 'number' ? value.gridHeight : Number.NaN,
    validCells: Array.isArray(value.validCells) ? value.validCells as number[] : [],
    maxCrew: typeof value.maxCrew === 'number' ? value.maxCrew : Number.NaN,
    maxRooms: typeof value.maxRooms === 'number' ? value.maxRooms : Number.NaN,
    visualId: typeof value.visualId === 'string' ? value.visualId : '',
  };
  return validateHullDefinition(input) === null ? createHullDocument(input) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
