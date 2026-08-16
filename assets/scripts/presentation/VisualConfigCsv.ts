/** 视觉定义的四个业务来源；定义表与 visualId 必须一一按类型匹配。 */
export type VisualKind = 'ROOM' | 'CREW' | 'HULL' | 'FLOOR';
export type VisualPlaybackMode = 'STATIC' | 'ALWAYS_LOOP' | 'POWERED_LOOP' | 'STATE_DRIVEN';
export type VisualPivot = 'CENTER' | 'BOTTOM_CENTER';
export type VisualFilter = 'NEAREST' | 'LINEAR';

export interface VisualDefinition {
  readonly visualId: string;
  readonly displayName: string;
  readonly kind: VisualKind;
  readonly assetPath: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frameCount: number;
  readonly pivot: VisualPivot;
  readonly filter: VisualFilter;
  readonly playbackMode: VisualPlaybackMode;
  readonly fps: number;
  readonly taskFps: number;
  readonly idleFrameIndex: number;
  /** 以千分比表达的显示缩放；1000 表示原始尺寸。 */
  readonly displayScalePermille: number;
  /** 相对逻辑网格锚点的像素偏移，可为负数。 */
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
}

export interface VisualFrameDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly visualId: string;
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type VisualConfigResult =
  | { readonly ok: true; readonly visuals: readonly VisualDefinition[]; readonly frames: readonly VisualFrameDefinition[] }
  | { readonly ok: false; readonly message: string };

const VISUAL_HEADERS = ['id', 'displayName', 'kind', 'assetPath', 'imageWidth', 'imageHeight', 'frameCount', 'pivot', 'filter', 'playbackMode', 'fps', 'taskFps', 'idleFrameIndex', 'displayScalePermille', 'gridOffsetX', 'gridOffsetY'] as const;
const FRAME_HEADERS = ['id', 'displayName', 'visualId', 'frameIndex', 'x', 'y', 'width', 'height'] as const;
const DESCRIPTION_MARKER = '#稳定标识';

/**
 * 解析表现层 CSV。第二行是给策划/Excel 使用的中文说明，不是数据；
 * 它必须存在且位置固定，避免编辑器和运行时各自容忍不同格式。
 */
export function parseVisualConfigCsv(visualsText: string, framesText: string): VisualConfigResult {
  try {
    const visualRows = readTable(visualsText, VISUAL_HEADERS, 'visuals.csv');
    const frameRows = readTable(framesText, FRAME_HEADERS, 'visual-frames.csv');
    const visuals = visualRows.map((row, index) => parseVisual(row, index + 3));
    const visualIds = new Set(visuals.map((visual) => visual.visualId));
    const frames = frameRows.map((row, index) => parseFrame(row, index + 3, visualIds));
    const framesByVisual = new Map<string, VisualFrameDefinition[]>();
    for (const frame of frames) {
      const list = framesByVisual.get(frame.visualId) ?? [];
      list.push(frame);
      framesByVisual.set(frame.visualId, list);
    }
    for (const visual of visuals) {
      const list = framesByVisual.get(visual.visualId) ?? [];
      if (list.length !== visual.frameCount) throw new RangeError(`${visual.visualId} 帧数应为 ${visual.frameCount}，实际为 ${list.length}`);
      list.sort((left, right) => left.frameIndex - right.frameIndex);
      list.forEach((frame, expected) => {
        if (frame.frameIndex !== expected) throw new RangeError(`${visual.visualId} 帧索引必须从 0 连续排列`);
        if (frame.x + frame.width > visual.imageWidth || frame.y + frame.height > visual.imageHeight) {
          throw new RangeError(`${visual.visualId} 第 ${frame.frameIndex} 帧超出图片边界`);
        }
      });
    }
    return { ok: true, visuals: Object.freeze(visuals), frames: Object.freeze(frames) };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

function parseVisual(row: Record<string, string>, line: number): VisualDefinition {
  const visualId = text(row.id, `visuals.csv 第 ${line} 行 id`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(visualId)) throw new RangeError(`visualId 无效：${visualId}`);
  const kind = enumValue(row.kind, ['ROOM', 'CREW', 'HULL', 'FLOOR'] as const, `${visualId}.kind`);
  const playbackMode = enumValue(row.playbackMode, ['STATIC', 'ALWAYS_LOOP', 'POWERED_LOOP', 'STATE_DRIVEN'] as const, `${visualId}.playbackMode`);
  const pivot = enumValue(row.pivot, ['CENTER', 'BOTTOM_CENTER'] as const, `${visualId}.pivot`);
  const filter = enumValue(row.filter, ['NEAREST', 'LINEAR'] as const, `${visualId}.filter`);
  const imageWidth = integer(row.imageWidth, `${visualId}.imageWidth`, 1);
  const imageHeight = integer(row.imageHeight, `${visualId}.imageHeight`, 1);
  const frameCount = integer(row.frameCount, `${visualId}.frameCount`, 1);
  const fps = integer(row.fps, `${visualId}.fps`, 1);
  const taskFps = integer(row.taskFps, `${visualId}.taskFps`, 1);
  const idleFrameIndex = integer(row.idleFrameIndex, `${visualId}.idleFrameIndex`, 0);
  const displayScalePermille = integer(row.displayScalePermille, `${visualId}.displayScalePermille`, 1, 10000);
  const gridOffsetX = integer(row.gridOffsetX, `${visualId}.gridOffsetX`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const gridOffsetY = integer(row.gridOffsetY, `${visualId}.gridOffsetY`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  if (idleFrameIndex >= frameCount) throw new RangeError(`${visualId}.idleFrameIndex 超出帧数`);
  const assetPath = text(row.assetPath, `${visualId}.assetPath`);
  if (!assetPath.startsWith('assets/') || assetPath.includes('..') || assetPath.startsWith('/') || assetPath.includes('\\')) {
    throw new RangeError(`${visualId}.assetPath 必须是 assets/ 下的相对路径`);
  }
  return { visualId, displayName: text(row.displayName, `${visualId}.displayName`), kind, assetPath, imageWidth, imageHeight, frameCount, pivot, filter, playbackMode, fps, taskFps, idleFrameIndex, displayScalePermille, gridOffsetX, gridOffsetY };
}

function parseFrame(row: Record<string, string>, line: number, visualIds: ReadonlySet<string>): VisualFrameDefinition {
  const visualId = text(row.visualId, `visual-frames.csv 第 ${line} 行 visualId`);
  if (!visualIds.has(visualId)) throw new RangeError(`帧引用未知 visualId：${visualId}`);
  const id = text(row.id, `visual-frames.csv 第 ${line} 行 id`);
  const frameIndex = integer(row.frameIndex, `${id}.frameIndex`, 0);
  const x = integer(row.x, `${id}.x`, 0);
  const y = integer(row.y, `${id}.y`, 0);
  const width = integer(row.width, `${id}.width`, 1);
  const height = integer(row.height, `${id}.height`, 1);
  return { id, displayName: text(row.displayName, `${id}.displayName`), visualId, frameIndex, x, y, width, height };
}

function readTable(source: string, expected: readonly string[], name: string): readonly Record<string, string>[] {
  const rows = parseCsv(source);
  if (rows.length < 2 || rows[0].length !== expected.length || rows[0].some((value, index) => value !== expected[index])) {
    throw new RangeError(`${name} 表头必须严格为：${expected.join(',')}`);
  }
  const descriptions = rows[1];
  if (descriptions.length !== expected.length || descriptions[0] !== DESCRIPTION_MARKER || descriptions.slice(1).some((value) => value.trim() === '')) {
    throw new RangeError(`${name} 第二行必须是“${DESCRIPTION_MARKER}”开头且逐列填写中文说明`);
  }
  const seen = new Set<string>();
  return rows.slice(2).map((row, index) => {
    if (row.length !== expected.length) throw new RangeError(`${name} 第 ${index + 3} 行列数不一致`);
    const record: Record<string, string> = {};
    expected.forEach((header, column) => { record[header] = row[column].trim(); });
    const key = name === 'visual-frames.csv' ? `${record.id}:${record.visualId}:${record.frameIndex}` : record.id;
    if (seen.has(key)) throw new RangeError(`${name} 稳定 ID 重复：${key}`);
    seen.add(key);
    return record;
  });
}

function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (quoted) throw new RangeError('CSV 引号未闭合');
  row.push(field);
  if (!(row.length === 1 && row[0] === '')) rows.push(row);
  return rows;
}

function text(value: string | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (normalized === '') throw new RangeError(`${label} 不能为空`);
  return normalized;
}

function integer(value: string | undefined, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = value === undefined || value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER ? `不小于 ${minimum}` : `${minimum} 到 ${maximum}`;
    throw new RangeError(`${label} 必须是${range}的整数`);
  }
  return parsed;
}

function enumValue<T extends readonly string[]>(value: string | undefined, choices: T, label: string): T[number] {
  if (value !== undefined && (choices as readonly string[]).indexOf(value) >= 0) return value as T[number];
  throw new RangeError(`${label} 值无效：${value ?? ''}`);
}
