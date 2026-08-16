import type { AssetDbPort } from '../shared/editor-asset-db';

export const CSV_CONFIG_DIRECTORY = 'db://assets/config/csv';
export const CSV_CONFIG_TABLES = [
  'game.csv', 'hulls.csv', 'rooms.csv', 'connector-ports.csv', 'floors.csv', 'crews.csv', 'crew-traits.csv', 'visuals.csv', 'visual-frames.csv',
] as const;
export type CsvConfigTableName = (typeof CSV_CONFIG_TABLES)[number];
/** 编辑器目录额外维护 Prefab 到稳定定义 ID 的白名单映射；它不进入 GameConfigCsvSource。 */
export const EDITOR_PREFABS_TABLE = 'editor-prefabs.csv' as const;
export const EDITOR_CSV_CONFIG_TABLES = [...CSV_CONFIG_TABLES, EDITOR_PREFABS_TABLE] as const;
export type EditorCsvConfigTableName = (typeof EDITOR_CSV_CONFIG_TABLES)[number];

const HEADERS: Readonly<Record<CsvConfigTableName, readonly string[]>> = {
  'game.csv': ['id', 'displayName', 'value'],
  'hulls.csv': ['id', 'displayName', 'level', 'gridWidth', 'gridHeight', 'cellMask', 'maxCrew', 'maxRooms', 'baseConstructionSlots', 'visualId'],
  'rooms.csv': ['id', 'displayName', 'category', 'width', 'height', 'maxLevel', 'maxHp', 'minPower', 'maxPower', 'powerGeneration', 'crewCapacity', 'healingHpPerTick', 'verticalConnectorKind', 'visualId', 'metalCost', 'buildDurationMs', 'demolishDurationMs', 'refundPermille'],
  'connector-ports.csv': ['id', 'displayName', 'roomDefinitionId', 'stopY', 'entrySide', 'verticalMoveTicks'],
  'floors.csv': ['id', 'displayName', 'metalCost', 'buildDurationMs', 'demolishDurationMs', 'refundPermille', 'visualId'],
  'crews.csv': ['id', 'displayName', 'role', 'rarity', 'maxHp', 'moveTicksPerEdge', 'repairHpPerTick', 'appearanceId', 'traitIds'],
  'crew-traits.csv': ['id', 'displayName', 'effectType', 'effectValue'],
  'visuals.csv': ['id', 'displayName', 'kind', 'assetPath', 'imageWidth', 'imageHeight', 'frameCount', 'pivot', 'filter', 'playbackMode', 'fps', 'taskFps', 'idleFrameIndex', 'displayScalePermille', 'gridOffsetX', 'gridOffsetY'],
  'visual-frames.csv': ['id', 'displayName', 'visualId', 'frameIndex', 'x', 'y', 'width', 'height'],
};
const EDITOR_PREFAB_HEADERS = ['id', 'displayName', 'definitionKind', 'definitionId', 'prefabPath'] as const;
export const EDITOR_PREFAB_CSV_HEADERS = EDITOR_PREFAB_HEADERS;
const DESCRIPTION_MARKER = '#稳定标识';

export interface CsvConfigBundle {
  readonly tables: Readonly<Record<EditorCsvConfigTableName, string>>;
}

export interface EditorPrefabBinding {
  readonly id: string;
  readonly displayName: string;
  readonly definitionKind: 'ROOM' | 'CREW' | 'HULL' | 'FLOOR';
  readonly definitionId: string;
  readonly prefabPath: string;
}

/** 供运行时/编辑器模块共享的最小输入类型；运行时模块可只提交九张表，编辑器会保留当前 editor-prefabs.csv。 */
export type CsvConfigInputTables =
  | Readonly<Record<CsvConfigTableName, string>>
  | Readonly<Record<EditorCsvConfigTableName, string>>;

export type CsvConfigResult =
  | { readonly ok: true; readonly message: string; readonly bundle: CsvConfigBundle }
  | { readonly ok: false; readonly message: string };

export async function loadCsvConfigBundle(assetDb: AssetDbPort): Promise<CsvConfigResult> {
  try {
    const entries = await Promise.all(EDITOR_CSV_CONFIG_TABLES.map(async (name) => [name, await assetDb.readFile(`${CSV_CONFIG_DIRECTORY}/${name}`)] as const));
    const tables = Object.fromEntries(entries) as Record<EditorCsvConfigTableName, string>;
    validateEditorCsvConfigTables(tables);
    return { ok: true, message: `已读取 ${EDITOR_CSV_CONFIG_TABLES.length} 张编辑器配置表`, bundle: { tables } };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** 全表导入失败时按逆序恢复原内容；每个未确认恢复的路径都会进入错误信息。 */
export async function saveCsvConfigBundle(
  assetDb: AssetDbPort,
  input: Readonly<Record<CsvConfigTableName, string>> | Readonly<Record<EditorCsvConfigTableName, string>>,
): Promise<CsvConfigResult> {
  const loaded = await loadCsvConfigBundle(assetDb);
  if (loaded.ok === false) return loaded;
  const supplied = input as Partial<Record<EditorCsvConfigTableName, string>>;
  const next = Object.fromEntries(EDITOR_CSV_CONFIG_TABLES.map((name) => [
    name,
    normalizeCsvForExcel(supplied[name] ?? loaded.bundle.tables[name]),
  ])) as Record<EditorCsvConfigTableName, string>;
  try {
    validateEditorCsvConfigTables(next);
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
  const written: EditorCsvConfigTableName[] = [];
  try {
    for (const name of EDITOR_CSV_CONFIG_TABLES) {
      const url = `${CSV_CONFIG_DIRECTORY}/${name}`;
      if (await assetDb.saveAsset(url, next[name]) === null) throw new Error(`保存配置表失败：${name}`);
      written.push(name);
      await assetDb.reimportAsset?.(url);
    }
    return { ok: true, message: '全部权威 CSV 已保存并重新导入', bundle: { tables: next } };
  } catch (cause) {
    const rollbackErrors: string[] = [];
    for (const name of [...written].reverse()) {
      try {
        const url = `${CSV_CONFIG_DIRECTORY}/${name}`;
        if (await assetDb.saveAsset(url, loaded.bundle.tables[name]) === null) rollbackErrors.push(`${name}：恢复请求未确认`);
        else await assetDb.reimportAsset?.(url);
      } catch (rollbackCause) {
        rollbackErrors.push(`${name}：${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`);
      }
    }
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；${rollbackErrors.length === 0 ? '已恢复原配置' : `以下配置恢复失败：${rollbackErrors.join('；')}`}` };
  }
}

export function normalizeCsvForExcel(content: string): string {
  const rows = parseCsv(content);
  return `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

export interface CsvVisualFrame {
  readonly id: string;
  readonly displayName: string;
  readonly visualId: string;
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CsvVisualDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'ROOM' | 'CREW' | 'HULL' | 'FLOOR';
  readonly assetPath: string;
  readonly textureUrl: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frameCount: number;
  readonly pivot: 'CENTER' | 'BOTTOM_CENTER';
  readonly filter: 'NEAREST' | 'LINEAR';
  readonly playbackMode: 'STATIC' | 'ALWAYS_LOOP' | 'POWERED_LOOP' | 'STATE_DRIVEN';
  readonly fps: number;
  readonly taskFps: number;
  readonly idleFrameIndex: number;
  /** 以千分比表达的显示缩放；1000 表示原始尺寸。 */
  readonly displayScalePermille: number;
  /** 相对逻辑网格锚点的像素偏移，可为负数。 */
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
  readonly frames: readonly CsvVisualFrame[];
}

/** 从已严格校验的视觉两表读取单个定义，供四类编辑器绑定器共同使用。 */
export function parseVisualDefinition(
  visualsText: string,
  framesText: string,
  visualId: string,
  expectedKind?: CsvVisualDefinition['kind'],
): CsvVisualDefinition {
  const visuals = readTable(visualsText, HEADERS['visuals.csv'], 'visuals.csv');
  const frames = readTable(framesText, HEADERS['visual-frames.csv'], 'visual-frames.csv');
  validateVisualTables(visuals, frames);
  const row = visuals.find((entry) => entry.id === visualId);
  if (row === undefined) throw new RangeError(`视觉定义不存在：${visualId}`);
  if (expectedKind !== undefined && row.kind !== expectedKind) throw new RangeError(`${visualId} 视觉类型不是 ${expectedKind}`);
  const parsedFrames = frames
    .filter((entry) => entry.visualId === visualId)
    .sort((left, right) => Number(left.frameIndex) - Number(right.frameIndex))
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      visualId: entry.visualId,
      frameIndex: integerField(entry.frameIndex, `${entry.id}.frameIndex`, 0),
      x: integerField(entry.x, `${entry.id}.x`, 0),
      y: integerField(entry.y, `${entry.id}.y`, 0),
      width: integerField(entry.width, `${entry.id}.width`, 1),
      height: integerField(entry.height, `${entry.id}.height`, 1),
    }));
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind as CsvVisualDefinition['kind'],
    assetPath: row.assetPath,
    textureUrl: `db://${row.assetPath.replace(/^\/+/, '')}`,
    imageWidth: integerField(row.imageWidth, `${row.id}.imageWidth`, 1),
    imageHeight: integerField(row.imageHeight, `${row.id}.imageHeight`, 1),
    frameCount: integerField(row.frameCount, `${row.id}.frameCount`, 1),
    pivot: row.pivot as CsvVisualDefinition['pivot'],
    filter: row.filter as CsvVisualDefinition['filter'],
    playbackMode: row.playbackMode as CsvVisualDefinition['playbackMode'],
    fps: integerField(row.fps, `${row.id}.fps`, 1),
    taskFps: integerField(row.taskFps, `${row.id}.taskFps`, 1),
    idleFrameIndex: integerField(row.idleFrameIndex, `${row.id}.idleFrameIndex`, 0),
    displayScalePermille: integerField(row.displayScalePermille, `${row.id}.displayScalePermille`, 1, 10000),
    gridOffsetX: integerField(row.gridOffsetX, `${row.id}.gridOffsetX`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    gridOffsetY: integerField(row.gridOffsetY, `${row.id}.gridOffsetY`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    frames: parsedFrames,
  };
}

export async function loadVisualDefinition(
  assetDb: AssetDbPort,
  visualId: string,
  expectedKind?: CsvVisualDefinition['kind'],
): Promise<CsvVisualDefinition> {
  return parseVisualDefinition(
    await assetDb.readFile(`${CSV_CONFIG_DIRECTORY}/visuals.csv`),
    await assetDb.readFile(`${CSV_CONFIG_DIRECTORY}/visual-frames.csv`),
    visualId,
    expectedKind,
  );
}

export function validateCsvConfigTables(tables: Readonly<Record<CsvConfigTableName, string>>): void {
  const records = new Map<CsvConfigTableName, readonly Readonly<Record<string, string>>[]>();
  for (const name of CSV_CONFIG_TABLES) records.set(name, readTable(tables[name], HEADERS[name], name));
  const ids = new Map<CsvConfigTableName, Set<string>>();
  for (const name of CSV_CONFIG_TABLES) ids.set(name, new Set((records.get(name) ?? []).map((row) => row.id)));
  for (const row of records.get('hulls.csv') ?? []) validateHullCsvRow(row);
  const visualsById = new Map((records.get('visuals.csv') ?? []).map((row) => [row.id, row]));
  // 四类定义各自只能绑定同名视觉类型；这样错误的 Sprite 不会等到
  // Creator 预览或运行时才静默回退，编辑器目录也不会产生跨领域映射。
  const visualReferences: readonly [CsvConfigTableName, string, 'ROOM' | 'CREW' | 'HULL' | 'FLOOR'][] = [
    ['hulls.csv', 'visualId', 'HULL'],
    ['rooms.csv', 'visualId', 'ROOM'],
    ['floors.csv', 'visualId', 'FLOOR'],
    ['crews.csv', 'appearanceId', 'CREW'],
  ];
  for (const [tableName, field, expectedKind] of visualReferences) {
    for (const row of records.get(tableName) ?? []) {
      const visualId = row[field];
      const visual = visualsById.get(visualId);
      if (visual === undefined) throw new RangeError(`${row.id} 引用未知视觉：${visualId}`);
      if (visual.kind !== expectedKind) throw new RangeError(`${row.id} 视觉类型必须是 ${expectedKind}：${visualId}`);
    }
  }
  for (const row of records.get('connector-ports.csv') ?? []) if (!ids.get('rooms.csv')?.has(row.roomDefinitionId)) throw new RangeError(`${row.id} 引用未知房间：${row.roomDefinitionId}`);
  for (const row of records.get('crews.csv') ?? []) {
    for (const traitId of row.traitIds.split('|').filter(Boolean)) if (!ids.get('crew-traits.csv')?.has(traitId)) throw new RangeError(`${row.id} 引用未知词条：${traitId}`);
  }
  validateVisualTables(records.get('visuals.csv') ?? [], records.get('visual-frames.csv') ?? []);
}

/** 编辑器先拒绝明显错位的紧凑 Mask；运行时仍由 GameCore 的同 schema parser 展开三态格。 */
function validateHullCsvRow(row: Readonly<Record<string, string>>): void {
  const width = integerField(row.gridWidth, `${row.id}.gridWidth`, 1);
  const height = integerField(row.gridHeight, `${row.id}.gridHeight`, 1);
  const mask = row.cellMask ?? '';
  const rows = mask.split('/');
  if (mask === '' || rows.length !== height) throw new RangeError(`${row.id}.cellMask 必须包含 ${height} 行`);
  for (const [index, line] of rows.entries()) {
    if (line.length !== width) throw new RangeError(`${row.id}.cellMask 第 ${index + 1} 行必须包含 ${width} 个格`);
    if (![...line].every((code) => code === 'V' || code === 'B' || code === 'W')) throw new RangeError(`${row.id}.cellMask 只能使用 V/B/W`);
  }
  const slots = integerField(row.baseConstructionSlots, `${row.id}.baseConstructionSlots`, 0);
  if (slots > 8) throw new RangeError(`${row.id}.baseConstructionSlots 不能超过 8`);
}

/** 校验编辑器专属 Prefab 映射，并复用九张运行时表的同一严格 parser。 */
export function validateEditorCsvConfigTables(tables: Readonly<Record<EditorCsvConfigTableName, string>>): void {
  const runtimeTables = Object.fromEntries(CSV_CONFIG_TABLES.map((name) => [name, tables[name]])) as Record<CsvConfigTableName, string>;
  validateCsvConfigTables(runtimeTables);
  const prefabRows = parseEditorPrefabCsv(tables[EDITOR_PREFABS_TABLE]);
  const ids = new Map<string, Set<string>>([
    ['ROOM', new Set(readTable(tables['rooms.csv'], HEADERS['rooms.csv'], 'rooms.csv').map((row) => row.id))],
    ['CREW', new Set(readTable(tables['crews.csv'], HEADERS['crews.csv'], 'crews.csv').map((row) => row.id))],
    ['HULL', new Set(readTable(tables['hulls.csv'], HEADERS['hulls.csv'], 'hulls.csv').map((row) => row.id))],
    ['FLOOR', new Set(readTable(tables['floors.csv'], HEADERS['floors.csv'], 'floors.csv').map((row) => row.id))],
  ]);
  const definitions = new Set<string>();
  for (const row of prefabRows) {
    if (!ids.has(row.definitionKind)) throw new RangeError(`${row.id}.definitionKind 无效：${row.definitionKind}`);
    if (!ids.get(row.definitionKind)?.has(row.definitionId)) throw new RangeError(`${row.id} 引用未知定义：${row.definitionKind}/${row.definitionId}`);
    if (!/^db:\/\/assets\/prefabs\/[A-Za-z0-9][A-Za-z0-9_-]*\.prefab$/.test(row.prefabPath) || row.prefabPath.includes('..')) {
      throw new RangeError(`${row.id}.prefabPath 必须是 db://assets/prefabs/ 下的安全 Prefab 路径`);
    }
    const key = `${row.definitionKind}:${row.definitionId}`;
    if (definitions.has(key)) throw new RangeError(`Prefab 定义映射重复：${key}`);
    definitions.add(key);
  }
  // editor-prefabs.csv 是编辑器目录的唯一白名单：每个运行时定义都必须有且仅有
  // 一个映射。只校验“映射指向的定义存在”会让新增定义静默消失，也会让面板目录
  // 看似合法但无法创建 Prefab，因此这里同时拒绝缺失和多余映射。
  const expectedDefinitions = new Set<string>();
  for (const [kind, definitionIds] of ids) {
    for (const definitionId of definitionIds) expectedDefinitions.add(`${kind}:${definitionId}`);
  }
  for (const key of expectedDefinitions) {
    if (!definitions.has(key)) throw new RangeError(`缺少 Prefab 定义映射：${key}`);
  }
  for (const key of definitions) {
    if (!expectedDefinitions.has(key)) throw new RangeError(`存在多余 Prefab 定义映射：${key}`);
  }
}

/** 解析编辑器 Prefab 映射表；跨表定义存在性由 validateEditorCsvConfigTables 负责。 */
export function parseEditorPrefabCsv(text: string): readonly EditorPrefabBinding[] {
  return readTable(text, EDITOR_PREFAB_HEADERS, EDITOR_PREFABS_TABLE).map((row) => {
    if (!['ROOM', 'CREW', 'HULL', 'FLOOR'].includes(row.definitionKind)) throw new RangeError(`${row.id}.definitionKind 无效：${row.definitionKind}`);
    return {
      id: row.id,
      displayName: row.displayName,
      definitionKind: row.definitionKind as EditorPrefabBinding['definitionKind'],
      definitionId: row.definitionId,
      prefabPath: row.prefabPath,
    };
  });
}

/** 新定义保存时补齐编辑器专属映射；运行时 GameConfigCsvSource 不会读取该表。 */
export function ensureEditorPrefabMapping(
  tables: Readonly<Record<EditorCsvConfigTableName, string>>,
  mapping: Pick<EditorPrefabBinding, 'definitionKind' | 'definitionId' | 'displayName' | 'prefabPath'>,
): Readonly<Record<EditorCsvConfigTableName, string>> {
  const rows = parseCsv(tables[EDITOR_PREFABS_TABLE]);
  const existing = rows.slice(2).find((row) => row[2] === mapping.definitionKind && row[3] === mapping.definitionId);
  if (existing !== undefined) return tables;
  const id = `editor-prefab-${mapping.definitionKind.toLowerCase()}-${mapping.definitionId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  if (rows.slice(2).some((row) => row[0] === id)) throw new RangeError(`editor-prefabs.csv 稳定标识重复：${id}`);
  rows.push([id, mapping.displayName, mapping.definitionKind, mapping.definitionId, mapping.prefabPath]);
  const normalized = `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
  return { ...tables, [EDITOR_PREFABS_TABLE]: normalized };
}

function validateVisualTables(visuals: readonly Readonly<Record<string, string>>[], frames: readonly Readonly<Record<string, string>>[]): void {
  const byId = new Map<string, Readonly<Record<string, string>>>();
  for (const row of visuals) {
    if (!['ROOM', 'CREW', 'HULL', 'FLOOR'].includes(row.kind)) throw new RangeError(`${row.id} 视觉类型无效`);
    if (!row.assetPath.startsWith('assets/') || row.assetPath.includes('..') || row.assetPath.includes('\\')) throw new RangeError(`${row.id} 资源路径必须位于 assets/ 下`);
    for (const field of ['imageWidth', 'imageHeight', 'frameCount', 'fps', 'taskFps', 'idleFrameIndex', 'displayScalePermille', 'gridOffsetX', 'gridOffsetY']) {
      const raw = row[field];
      const value = raw.trim() === '' ? Number.NaN : Number(raw);
      const minimum = field === 'gridOffsetX' || field === 'gridOffsetY' ? Number.MIN_SAFE_INTEGER : field === 'idleFrameIndex' ? 0 : 1;
      const maximum = field === 'displayScalePermille' ? 10000 : Number.MAX_SAFE_INTEGER;
      if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${row.id}.${field} 必须是 ${minimum} 到 ${maximum} 的整数`);
    }
    if (!['CENTER', 'BOTTOM_CENTER'].includes(row.pivot) || !['NEAREST', 'LINEAR'].includes(row.filter) || !['STATIC', 'ALWAYS_LOOP', 'POWERED_LOOP', 'STATE_DRIVEN'].includes(row.playbackMode)) throw new RangeError(`${row.id} 视觉枚举无效`);
    if (Number(row.idleFrameIndex) >= Number(row.frameCount)) throw new RangeError(`${row.id} 静置帧索引越界`);
    byId.set(row.id, row);
  }
  const grouped = new Map<string, Readonly<Record<string, string>>[]>();
  for (const frame of frames) {
    const visual = byId.get(frame.visualId);
    if (visual === undefined) throw new RangeError(`${frame.id} 引用未知视觉：${frame.visualId}`);
    const index = Number(frame.frameIndex);
    const x = Number(frame.x); const y = Number(frame.y); const width = Number(frame.width); const height = Number(frame.height);
    if (![index, x, y, width, height].every(Number.isInteger) || index < 0 || x < 0 || y < 0 || width <= 0 || height <= 0) throw new RangeError(`${frame.id} 帧矩形无效`);
    if (x + width > Number(visual.imageWidth) || y + height > Number(visual.imageHeight)) throw new RangeError(`${frame.id} 超出图片边界`);
    const list = grouped.get(frame.visualId) ?? []; list.push(frame); grouped.set(frame.visualId, list);
  }
  for (const visual of visuals) {
    const list = (grouped.get(visual.id) ?? []).sort((a, b) => Number(a.frameIndex) - Number(b.frameIndex));
    if (list.length !== Number(visual.frameCount) || list.some((frame, index) => Number(frame.frameIndex) !== index)) throw new RangeError(`${visual.id} 帧数或索引不连续`);
  }
}

export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); field = ''; if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; }
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new RangeError('CSV 引号未闭合');
  row.push(field);
  if (!(row.length === 1 && row[0] === '')) rows.push(row);
  return rows;
}

function integerField(value: string, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER ? `不小于 ${minimum}` : `${minimum} 到 ${maximum}`;
    throw new RangeError(`${label} 必须是${range}的整数`);
  }
  return parsed;
}

function readTable(text: string, expected: readonly string[], name: string): readonly Readonly<Record<string, string>>[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  if (header.length !== expected.length || header.some((value, index) => value !== expected[index])) throw new RangeError(`${name} 表头必须严格为：${expected.join(',')}`);
  const descriptions = rows[1];
  if (descriptions === undefined || descriptions.length !== header.length || descriptions[0] !== DESCRIPTION_MARKER || descriptions.slice(1).some((value) => value.trim() === '')) throw new RangeError(`${name} 第二行必须是“${DESCRIPTION_MARKER}”开头且逐列填写中文说明`);
  const seen = new Set<string>();
  return rows.slice(2).map((row, index) => {
    if (row.length !== header.length) throw new RangeError(`${name} 第 ${index + 3} 行列数不一致`);
    const record = Object.fromEntries(header.map((key, column) => [key, row[column]])) as Record<string, string>;
    const identity = record.id ?? record.visualId;
    if (identity === undefined || identity.trim() === '') throw new RangeError(`${name} 第 ${index + 3} 行稳定标识为空`);
    if (name !== 'visual-frames.csv' && (record.displayName ?? '').trim() === '') throw new RangeError(`${name} 第 ${index + 3} 行中文名称为空`);
    const key = name === 'visual-frames.csv' ? `${identity}:${record.frameIndex}` : identity;
    if (seen.has(key)) throw new RangeError(`${name} 稳定 ID 重复：${key}`);
    seen.add(key);
    return record;
  });
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
