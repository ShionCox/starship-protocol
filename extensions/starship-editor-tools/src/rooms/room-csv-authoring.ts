import type { AssetDbPort } from '../shared/editor-asset-db';
import {
  ensureEditorPrefabMapping,
  loadCsvConfigBundle,
  saveCsvConfigBundle,
  type CsvConfigTableName,
} from '../csv/config-csv';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneQueryPort,
  type SceneNodeTree,
} from '../shared/editor-scene';

/** P8 房间 CSV 的稳定列顺序；编辑器不允许通过面板改动稳定 ID。 */
export const ROOM_CSV_HEADERS = [
  'id', 'displayName', 'category', 'width', 'height', 'maxLevel', 'maxHp', 'minPower', 'maxPower',
  'powerGeneration', 'crewCapacity', 'healingHpPerTick', 'verticalConnectorKind', 'visualId',
  'metalCost', 'buildDurationMs', 'demolishDurationMs', 'refundPermille',
] as const;

export const CONNECTOR_PORT_CSV_HEADERS = [
  'id', 'displayName', 'roomDefinitionId', 'stopY', 'entrySide', 'verticalMoveTicks',
] as const;

export type RoomCsvField = (typeof ROOM_CSV_HEADERS)[number];
export type ConnectorPortCsvField = (typeof CONNECTOR_PORT_CSV_HEADERS)[number];

export interface RoomCsvRow {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly width: string;
  readonly height: string;
  readonly maxLevel: string;
  readonly maxHp: string;
  readonly minPower: string;
  readonly maxPower: string;
  readonly powerGeneration: string;
  readonly crewCapacity: string;
  readonly healingHpPerTick: string;
  readonly verticalConnectorKind: string;
  readonly visualId: string;
  readonly metalCost: string;
  readonly buildDurationMs: string;
  readonly demolishDurationMs: string;
  readonly refundPermille: string;
}

export interface ConnectorPortCsvRow {
  readonly id: string;
  readonly displayName: string;
  readonly roomDefinitionId: string;
  readonly stopY: string;
  readonly entrySide: string;
  readonly verticalMoveTicks: string;
}

export interface RoomCsvDraft extends RoomCsvRow {
  readonly connectorPorts: readonly ConnectorPortCsvRow[];
}

export interface RoomPreviewDto {
  readonly schemaVersion: 3;
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly width: number;
  readonly height: number;
  readonly maxLevel: number;
  readonly maxHp: number;
  readonly minPower: number;
  readonly maxPower: number;
  readonly powerGeneration: number;
  readonly crewCapacity: number;
  readonly healingHpPerTick: number;
  readonly verticalConnectorKind: string;
  readonly visualId: string;
  readonly metalCost: number;
  readonly buildDurationMs: number;
  readonly demolishDurationMs: number;
  readonly refundPermille: number;
  readonly connectorPorts: readonly ConnectorPortCsvRow[];
}

export type RoomCsvValidationResult =
  | { readonly ok: true; readonly dto: RoomPreviewDto; readonly draft: RoomCsvDraft }
  | { readonly ok: false; readonly message: string };

export interface RoomCsvLoadResult {
  readonly ok: boolean;
  readonly message: string;
  readonly drafts?: readonly RoomCsvDraft[];
}

export interface SaveRoomCsvDraftRequest {
  readonly draft: RoomCsvDraft;
}

export type SaveRoomCsvDraftResult =
  | { readonly ok: true; readonly message: string; readonly draft: RoomCsvDraft; readonly dto: RoomPreviewDto }
  | { readonly ok: false; readonly message: string };

export interface RoomInstanceEditRequest {
  readonly nodeUuid: string;
  readonly x: number;
  readonly y: number;
  readonly initialHp: number;
}

export type RoomInstanceEditResult =
  | { readonly ok: true; readonly message: string; readonly x: number; readonly y: number; readonly initialHp: number }
  | { readonly ok: false; readonly message: string };

const ROOM_CATEGORIES = ['ENERGY', 'WEAPON', 'DEFENSE', 'MOBILITY', 'SUPPORT', 'MOVEMENT', 'TACTICAL', 'DRONE', 'ECONOMY', 'SPECIAL'] as const;
const CONNECTOR_KINDS = ['NONE', 'ELEVATOR', 'STAIRS'] as const;
const ENTRY_SIDES = ['LEFT', 'RIGHT'] as const;
const ROOM_ID_PATTERN = /^room-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PORT_ID_PATTERN = /^port-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_MARKER = '#稳定标识';

/** 从权威 CSV bundle 读取房间和连接器行；返回的草稿只包含白名单字段。 */
export function readRoomCsvDrafts(
  tables: Readonly<Record<CsvConfigTableName, string>>,
): readonly RoomCsvDraft[] {
  const rooms = readRows(tables['rooms.csv'], ROOM_CSV_HEADERS, 'rooms.csv').map((row) => toRoomRow(row));
  const ports = readRows(tables['connector-ports.csv'], CONNECTOR_PORT_CSV_HEADERS, 'connector-ports.csv').map((row) => toConnectorRow(row));
  const portsByRoom = new Map<string, ConnectorPortCsvRow[]>();
  for (const port of ports) {
    const list = portsByRoom.get(port.roomDefinitionId) ?? [];
    list.push(port);
    portsByRoom.set(port.roomDefinitionId, list);
  }
  return rooms.map((room) => ({
    ...room,
    connectorPorts: portsByRoom.get(room.id) ?? [],
  }));
}

/** 读取全部 CSV 并返回房间草稿；面板打开或刷新时调用。 */
export async function loadRoomCsvDrafts(assetDb: AssetDbPort): Promise<RoomCsvLoadResult> {
  const result = await loadCsvConfigBundle(assetDb);
  if (result.ok === false) return result;
  try {
    const drafts = readRoomCsvDrafts(result.bundle.tables);
    return { ok: true, message: `已读取 ${drafts.length} 条房间 CSV 行及连接器停靠口`, drafts };
  } catch (cause) {
    return { ok: false, message: toMessage(cause) };
  }
}

/**
 * 把面板草稿转换成 RoomView 可消费的预览 DTO。
 * DTO 是白名单且带 schemaVersion 3；连接器行只用于编辑器展示，不会穿透到 GameCore。
 */
export function toRoomPreviewDto(input: RoomCsvDraft): RoomCsvValidationResult {
  const normalized = normalizeDraft(input);
  const error = validateDraft(normalized);
  if (error !== null) return { ok: false, message: error };
  const dto: RoomPreviewDto = {
    schemaVersion: 3,
    id: normalized.id,
    displayName: normalized.displayName,
    category: normalized.category,
    width: integer(normalized.width),
    height: integer(normalized.height),
    maxLevel: integer(normalized.maxLevel),
    maxHp: integer(normalized.maxHp),
    minPower: integer(normalized.minPower),
    maxPower: integer(normalized.maxPower),
    powerGeneration: integer(normalized.powerGeneration),
    crewCapacity: integer(normalized.crewCapacity),
    healingHpPerTick: integer(normalized.healingHpPerTick),
    verticalConnectorKind: normalized.verticalConnectorKind,
    visualId: normalized.visualId,
    metalCost: integer(normalized.metalCost),
    buildDurationMs: integer(normalized.buildDurationMs),
    demolishDurationMs: integer(normalized.demolishDurationMs),
    refundPermille: integer(normalized.refundPermille),
    connectorPorts: normalized.connectorPorts,
  };
  return { ok: true, dto, draft: normalized };
}

/** 将连接器行转换成面板可编辑的无表头 CSV 文本。 */
export function connectorPortsToEditorText(ports: readonly ConnectorPortCsvRow[]): string {
  return ports.map((port) => CONNECTOR_PORT_CSV_HEADERS.map((field) => escapeCsvField(port[field])).join(',')).join('\n');
}

/** 解析面板连接器文本；允许空文本表示删除当前房间全部停靠口。 */
export function parseConnectorPortsEditorText(text: string, roomDefinitionId: string): readonly ConnectorPortCsvRow[] {
  const source = text.trim();
  if (source === '') return [];
  const rows = parseCsv(source);
  return rows.map((row, index) => {
    if (row.length !== CONNECTOR_PORT_CSV_HEADERS.length) throw new RangeError(`连接器第 ${index + 1} 行列数不一致`);
    const record = fromCells(row, CONNECTOR_PORT_CSV_HEADERS);
    return {
      id: record.id,
      displayName: record.displayName,
      roomDefinitionId,
      stopY: record.stopY,
      entrySide: record.entrySide,
      verticalMoveTicks: record.verticalMoveTicks,
    };
  });
}

/** 把一条合法草稿写回 rooms.csv 与 connector-ports.csv，其他行保持原顺序。 */
export function replaceRoomCsvDraft(
  tables: Readonly<Record<CsvConfigTableName, string>>,
  input: RoomCsvDraft,
): Readonly<Record<CsvConfigTableName, string>> {
  const checked = toRoomPreviewDto(input);
  if (checked.ok === false) throw new RangeError(checked.message);
  const draft = checked.draft;
  const roomTable = replaceRow(tables['rooms.csv'], ROOM_CSV_HEADERS, draft.id, draft as unknown as Record<string, string>, 'rooms.csv');
  const connectorTable = replaceConnectorRows(tables['connector-ports.csv'], draft.id, draft.connectorPorts);
  return { ...tables, 'rooms.csv': roomTable, 'connector-ports.csv': connectorTable };
}

/** 新建或覆盖房间及其连接器草稿；严格检查全表唯一 ID 后整批原子保存。 */
export async function saveOrCreateRoomCsvDraft(
  assetDb: AssetDbPort,
  request: SaveRoomCsvDraftRequest,
): Promise<SaveRoomCsvDraftResult> {
  const checked = toRoomPreviewDto(request.draft);
  if (!checked.ok) return checked;
  const loaded = await loadCsvConfigBundle(assetDb);
  if (!loaded.ok) return loaded;
  try {
    const roomRows = readRows(loaded.bundle.tables['rooms.csv'], ROOM_CSV_HEADERS, 'rooms.csv');
    const portRows = readRows(loaded.bundle.tables['connector-ports.csv'], CONNECTOR_PORT_CSV_HEADERS, 'connector-ports.csv');
    const roomMatches = roomRows.filter((row) => row.id === checked.draft.id);
    if (roomMatches.length > 1) return { ok: false, message: `rooms.csv 存在重复稳定标识：${checked.draft.id}` };
    const portIds = new Set(portRows.map((row) => row.id));
    for (const port of checked.draft.connectorPorts) {
      if (portIds.has(port.id) && !portRows.some((row) => row.id === port.id && row.roomDefinitionId === checked.draft.id)) return { ok: false, message: `connector-ports.csv 稳定标识已存在：${port.id}` };
    }
    const next = roomMatches.length === 0
      ? appendRoomCsvDraft(loaded.bundle.tables, checked.draft)
      : replaceRoomCsvDraft(loaded.bundle.tables, checked.draft);
    const prefabPath = checked.draft.verticalConnectorKind === 'ELEVATOR'
      ? 'db://assets/prefabs/ElevatorRoom.prefab'
      : checked.draft.verticalConnectorKind === 'STAIRS'
        ? 'db://assets/prefabs/StairsRoom.prefab'
        : 'db://assets/prefabs/ReactorRoom.prefab';
    const withMapping = ensureEditorPrefabMapping(next as Readonly<Record<import('../csv/config-csv').EditorCsvConfigTableName, string>>, {
      definitionKind: 'ROOM', definitionId: checked.draft.id, displayName: checked.draft.displayName, prefabPath,
    });
    const saved = await saveCsvConfigBundle(assetDb, withMapping);
    if (!saved.ok) return saved;
    return { ok: true, message: `${checked.draft.id} 已保存 rooms.csv 与 connector-ports.csv 并重新导入`, draft: checked.draft, dto: checked.dto };
  } catch (cause) {
    return { ok: false, message: `保存房间 CSV 失败：${toMessage(cause)}` };
  }
}

function appendRoomCsvDraft(tables: Readonly<Record<CsvConfigTableName, string>>, draft: RoomCsvDraft): Readonly<Record<CsvConfigTableName, string>> {
  const roomRows = parseCsv(tables['rooms.csv']);
  roomRows.push(ROOM_CSV_HEADERS.map((field) => draft[field]));
  const portRows = parseCsv(tables['connector-ports.csv']);
  for (const port of draft.connectorPorts) portRows.push(CONNECTOR_PORT_CSV_HEADERS.map((field) => port[field]));
  return { ...tables, 'rooms.csv': serializeCsv(roomRows), 'connector-ports.csv': serializeCsv(portRows) };
}

/**
 * 修改场景房间实例的 x/y/initialHp 白名单字段。
 * 所有写入都处于一次公开 recording 中；失败会取消 recording，不留下半条 Undo。
 */
export async function updateRoomInstance(
  scene: SceneQueryPort,
  request: RoomInstanceEditRequest,
): Promise<RoomInstanceEditResult> {
  if (typeof request.nodeUuid !== 'string' || request.nodeUuid.trim() === '') return { ok: false, message: '房间实例节点 UUID 不能为空' };
  if (!isNonNegativeInteger(request.x) || !isNonNegativeInteger(request.y)) return { ok: false, message: '房间逻辑坐标必须是非负整数' };
  if (!Number.isInteger(request.initialHp) || request.initialHp < -1) return { ok: false, message: '初始耐久必须是 -1 或非负整数' };

  const tree = await scene.queryNodeTree();
  const node = flattenTree(tree).find((entry) => entry.uuid === request.nodeUuid);
  if (node === undefined) return { ok: false, message: '房间实例节点不存在，请重新选择' };
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
  const roomTarget = findRoomViewTarget(node, classes);
  if (roomTarget === null) return { ok: false, message: '选中节点不是可编辑的房间实例' };
  const state = await scene.executeComponentMethod(roomTarget.uuid, 'getAuthoringInspectorState', []) as {
    readonly maxHp?: unknown;
  } | null;
  const maxHp = typeof state?.maxHp === 'number' && Number.isInteger(state.maxHp) ? state.maxHp : undefined;
  if (request.initialHp >= 0 && (maxHp === undefined || request.initialHp > maxHp)) return { ok: false, message: `初始耐久必须不超过房间最大耐久${maxHp === undefined ? '' : `（${maxHp}）`}` };

  let undoId: string | undefined;
  try {
    undoId = await scene.beginRecording(request.nodeUuid);
    if (!(await scene.setProperty(roomTarget, 'initialHp', request.initialHp, { record: false }))) throw new Error('无法写入房间初始耐久');
    const applied = await scene.executeComponentMethod(roomTarget.uuid, 'applyEditorPlacement', [{ x: request.x, y: request.y }]);
    if (applied !== true) throw new Error('房间逻辑坐标不合法或与其他内容冲突');
    await scene.endRecording(undoId);
    undoId = undefined;
    return { ok: true, message: `已保存房间实例位置（${request.x}, ${request.y}）和初始耐久`, x: request.x, y: request.y, initialHp: request.initialHp };
  } catch (cause) {
    if (undoId !== undefined) await scene.cancelRecording(undoId).catch(() => undefined);
    return { ok: false, message: `保存房间实例失败：${toMessage(cause)}` };
  }
}

function validateDraft(draft: RoomCsvDraft): string | null {
  if (!ROOM_ID_PATTERN.test(draft.id)) return '房间稳定标识必须使用 room- 开头的小写短横线格式';
  if (draft.displayName.trim() === '') return '房间中文名称不能为空';
  if (!(ROOM_CATEGORIES as readonly string[]).includes(draft.category)) return `未知房间分类：${draft.category}`;
  for (const field of ['width', 'height', 'maxLevel', 'maxHp'] as const) if (!isPositiveIntegerString(draft[field])) return `${field} 必须是正整数`;
  for (const field of ['minPower', 'maxPower', 'powerGeneration', 'crewCapacity', 'healingHpPerTick', 'metalCost', 'refundPermille'] as const) if (!isNonNegativeIntegerString(draft[field])) return `${field} 必须是非负整数`;
  if (integer(draft.minPower) > integer(draft.maxPower)) return '最低能源不能大于最高能源';
  if (draft.category !== 'ENERGY' && integer(draft.powerGeneration) > 0) return '非能源房间的能源产能必须为 0';
  if (draft.category !== 'SUPPORT' && integer(draft.healingHpPerTick) > 0) return '只有支援房间可以设置正治疗量';
  if (!(CONNECTOR_KINDS as readonly string[]).includes(draft.verticalConnectorKind)) return '纵向连接器类型无效';
  if (draft.verticalConnectorKind !== 'NONE' && draft.category !== 'MOVEMENT') return '楼梯和电梯必须属于移动分类';
  if (draft.verticalConnectorKind === 'NONE' && draft.connectorPorts.length > 0) return '无纵向连接器的房间不能填写停靠口';
  if (draft.visualId.trim() === '') return '房间视觉标识不能为空';
  for (const field of ['buildDurationMs', 'demolishDurationMs'] as const) if (!isPositiveIntegerString(draft[field])) return `${field} 必须是正整数`;
  if (integer(draft.refundPermille) > 1000) return '返还比例不能超过 1000‰';
  const ids = new Set<string>();
  for (const port of draft.connectorPorts) {
    if (!PORT_ID_PATTERN.test(port.id)) return `连接器稳定标识无效：${port.id}`;
    if (ids.has(port.id)) return `连接器稳定标识重复：${port.id}`;
    ids.add(port.id);
    if (port.displayName.trim() === '') return `连接器中文名称不能为空：${port.id}`;
    if (port.roomDefinitionId !== draft.id) return `连接器 ${port.id} 未指向当前房间`;
    if (!isNonNegativeIntegerString(port.stopY)) return `连接器停靠纵坐标无效：${port.id}`;
    if (!(ENTRY_SIDES as readonly string[]).includes(port.entrySide)) return `连接器进入侧无效：${port.id}`;
    if (!isPositiveIntegerString(port.verticalMoveTicks)) return `连接器纵向移动 Tick 无效：${port.id}`;
  }
  return null;
}

function normalizeDraft(input: RoomCsvDraft): RoomCsvDraft {
  return {
    id: String(input.id ?? '').trim(),
    displayName: String(input.displayName ?? '').trim(),
    category: String(input.category ?? '').trim(),
    width: String(input.width ?? '').trim(),
    height: String(input.height ?? '').trim(),
    maxLevel: String(input.maxLevel ?? '').trim(),
    maxHp: String(input.maxHp ?? '').trim(),
    minPower: String(input.minPower ?? '').trim(),
    maxPower: String(input.maxPower ?? '').trim(),
    powerGeneration: String(input.powerGeneration ?? '').trim(),
    crewCapacity: String(input.crewCapacity ?? '').trim(),
    healingHpPerTick: String(input.healingHpPerTick ?? '').trim(),
    verticalConnectorKind: String(input.verticalConnectorKind ?? '').trim(),
    visualId: String(input.visualId ?? '').trim(),
    metalCost: String(input.metalCost ?? '').trim(),
    buildDurationMs: String(input.buildDurationMs ?? '').trim(),
    demolishDurationMs: String(input.demolishDurationMs ?? '').trim(),
    refundPermille: String(input.refundPermille ?? '').trim(),
    connectorPorts: (input.connectorPorts ?? []).map((port) => ({
      id: String(port.id ?? '').trim(),
      displayName: String(port.displayName ?? '').trim(),
      roomDefinitionId: String(port.roomDefinitionId ?? '').trim(),
      stopY: String(port.stopY ?? '').trim(),
      entrySide: String(port.entrySide ?? '').trim(),
      verticalMoveTicks: String(port.verticalMoveTicks ?? '').trim(),
    })),
  };
}

function replaceRow(
  text: string,
  headers: readonly string[],
  id: string,
  replacement: Record<string, string>,
  tableName: string,
): string {
  const rows = parseCsv(text);
  const index = rows.findIndex((row, rowIndex) => rowIndex >= 2 && row[0] === id);
  if (index < 0) throw new RangeError(`${tableName} 中不存在稳定标识：${id}`);
  rows[index] = headers.map((header) => replacement[header] ?? '');
  return serializeCsv(rows);
}

function replaceConnectorRows(
  text: string,
  roomDefinitionId: string,
  replacements: readonly ConnectorPortCsvRow[],
): string {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const existing = rows.slice(2);
  const output: string[][] = [];
  let inserted = false;
  for (const row of existing) {
    if (row[2] !== roomDefinitionId) {
      output.push(row);
    } else if (!inserted) {
      for (const replacement of replacements) output.push(CONNECTOR_PORT_CSV_HEADERS.map((field) => replacement[field]));
      inserted = true;
    }
  }
  if (!inserted) for (const replacement of replacements) output.push(CONNECTOR_PORT_CSV_HEADERS.map((field) => replacement[field]));
  return serializeCsv([header, rows[1] ?? CONNECTOR_PORT_CSV_HEADERS.map(() => ''), ...output]);
}

function readRows(text: string, headers: readonly string[], tableName: string): readonly Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  if (header.length !== headers.length || header.some((value, index) => value !== headers[index])) throw new RangeError(`${tableName} 表头不匹配`);
  const description = rows[1] ?? [];
  if (description.length !== headers.length || description[0] !== DESCRIPTION_MARKER) throw new RangeError(`${tableName} 缺少中文说明行`);
  return rows.slice(2).map((row, index) => {
    if (row.length !== headers.length) throw new RangeError(`${tableName} 第 ${index + 3} 行列数不一致`);
    return fromCells(row, headers);
  });
}

function fromCells(row: readonly string[], headers: readonly string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])) as Record<string, string>;
}

function toRoomRow(row: Record<string, string>): RoomCsvRow {
  return Object.fromEntries(ROOM_CSV_HEADERS.map((field) => [field, row[field] ?? ''])) as unknown as RoomCsvRow;
}

function toConnectorRow(row: Record<string, string>): ConnectorPortCsvRow {
  return Object.fromEntries(CONNECTOR_PORT_CSV_HEADERS.map((field) => [field, row[field] ?? ''])) as unknown as ConnectorPortCsvRow;
}

function parseCsv(text: string): string[][] {
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

function serializeCsv(rows: readonly (readonly string[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function integer(value: string): number { return Number(value); }
function isPositiveIntegerString(value: string): boolean { return /^\d+$/.test(value) && Number(value) > 0; }
function isNonNegativeIntegerString(value: string): boolean { return /^\d+$/.test(value); }
function isNonNegativeInteger(value: number): boolean { return Number.isInteger(value) && value >= 0; }

function findRoomViewTarget(node: SceneNodeTree, classes: readonly SceneComponentClassInfo[]) {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, 'RoomView', classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): readonly SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}

function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
