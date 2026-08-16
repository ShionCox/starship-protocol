import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  PssAssetKind,
  PssIndexEntry,
  PssLanguage,
  PssLibraryIndex,
  PssSearchPage,
  PssSearchQuery,
  PssSpriteRef,
} from './pss-types';

export const DEFAULT_PSS_SOURCE_ROOT = 'I:\\WebProjects\\pss_full';
export const PSS_SOURCE_ROOT_ENV = 'STARSHIP_PSS_SOURCE_ROOT';
export const DEFAULT_PSS_PAGE_SIZE = 24;
export const MAX_PSS_PAGE_SIZE = 200;

interface PssDataSource {
  readonly file: string;
  readonly kind: PssAssetKind;
  readonly language: PssLanguage;
}

interface PssSpriteMappingEntry {
  readonly cats?: readonly unknown[];
  readonly names?: readonly unknown[];
}

const DATA_SOURCES: readonly PssDataSource[] = [
  { file: 'CN_ships.json', kind: 'ship', language: 'CN' },
  { file: 'EN_ships.json', kind: 'ship', language: 'EN' },
  { file: 'CN_rooms.json', kind: 'room', language: 'CN' },
  { file: 'EN_rooms.json', kind: 'room', language: 'EN' },
  { file: 'CN_crews.json', kind: 'crew', language: 'CN' },
  { file: 'EN_crews.json', kind: 'crew', language: 'EN' },
  { file: 'CN_items.json', kind: 'item', language: 'CN' },
  { file: 'EN_items.json', kind: 'item', language: 'EN' },
  { file: 'CN_missiles.json', kind: 'missile', language: 'CN' },
  { file: 'EN_missiles.json', kind: 'missile', language: 'EN' },
  { file: 'items.json', kind: 'item', language: 'NEUTRAL' },
  { file: 'rooms.json', kind: 'room', language: 'NEUTRAL' },
];

export function getPssSourceRoot(): string {
  const fromEnvironment = typeof process !== 'undefined' ? process.env[PSS_SOURCE_ROOT_ENV] : undefined;
  return fromEnvironment?.trim() === '' || fromEnvironment === undefined
    ? DEFAULT_PSS_SOURCE_ROOT
    : fromEnvironment.trim();
}

/**
 * 扫描外部素材库的 JSON 数据层。缺失文件只产生中文 warning，索引仍返回可用条目，
 * 这样外部库不完整时面板可以继续显示诊断信息，而不是伪造“导入成功”。
 */
export async function buildPssIndex(sourceRoot: string = getPssSourceRoot()): Promise<PssLibraryIndex> {
  const entries: PssIndexEntry[] = [];
  const warnings: string[] = [];
  const spriteAliases = await readSpriteAliases(sourceRoot, warnings);
  for (const source of DATA_SOURCES) {
    const filePath = join(sourceRoot, 'data', source.file);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (cause) {
      warnings.push(`无法读取 PSS 数据文件 ${source.file}：${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }
    const records = readRecords(raw);
    if (records.length === 0) {
      warnings.push(`PSS 数据文件 ${source.file} 没有可索引记录`);
      continue;
    }
    for (const record of records) {
      const entry = toIndexEntry(record, source, spriteAliases);
      if (entry === null) {
        warnings.push(`PSS 数据文件 ${source.file} 存在缺少稳定 id 的记录`);
      } else {
        entries.push(entry);
      }
    }
  }
  entries.sort(compareEntries);
  return { schemaVersion: 1, sourceRoot, entries, warnings };
}

export async function writePssIndex(index: PssLibraryIndex, outputPath: string): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export async function readPssIndex(indexPath: string): Promise<PssLibraryIndex> {
  const parsed = JSON.parse(await readFile(indexPath, 'utf8')) as unknown;
  if (!isPssLibraryIndex(parsed)) throw new Error('PSS 索引文件 schemaVersion 或 entries 无效');
  return parsed;
}

/** 搜索只访问白名单 DTO，并以稳定字段排序，保证分页在刷新后不会跳动。 */
export function searchPssAssets(index: PssLibraryIndex, query: PssSearchQuery = {}): PssSearchPage {
  const term = query.query?.trim().toLocaleLowerCase() ?? '';
  const pageSize = clampInteger(query.pageSize ?? DEFAULT_PSS_PAGE_SIZE, 1, MAX_PSS_PAGE_SIZE);
  const page = Math.max(1, clampInteger(query.page ?? 1, 1, Number.MAX_SAFE_INTEGER));
  const filtered = index.entries.filter((entry) => {
    if (query.kind !== undefined && entry.kind !== query.kind) return false;
    if (query.language !== undefined && entry.language !== query.language) return false;
    if (term === '') return true;
    return [entry.assetId, entry.sourceId, entry.displayName, ...(entry.aliases ?? []), entry.description ?? '', entry.sourcePath, ...(entry.spriteRefs ?? []).flatMap((sprite) => [sprite.sourceId, sprite.path ?? ''])]
      .some((field) => field.toLocaleLowerCase().includes(term));
  });
  const totalPages = filtered.length === 0 ? 0 : Math.ceil(filtered.length / pageSize);
  const effectivePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
  const start = (effectivePage - 1) * pageSize;
  return {
    entries: filtered.slice(start, start + pageSize),
    page: effectivePage,
    pageSize,
    total: filtered.length,
    totalPages,
    hasPrevious: effectivePage > 1,
    hasNext: totalPages > 0 && effectivePage < totalPages,
    warnings: index.warnings,
  };
}

function readRecords(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    const nested = records.flatMap((record) => {
      if (Array.isArray(record.data)) return record.data.filter(isRecord);
      if (isRecord(record.data)) return Object.values(record.data).filter(isRecord);
      return [];
    });
    return nested.length > 0 ? nested : records;
  }
  if (!isRecord(value)) return [];
  const data = value.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return Object.values(data).filter(isRecord);
  return Object.values(value).filter(isRecord);
}

function toIndexEntry(
  record: Record<string, unknown>,
  source: PssDataSource,
  spriteAliases: ReadonlyMap<string, readonly string[]>,
): PssIndexEntry | null {
  const sourceId = readString(record.id);
  if (sourceId === undefined) return null;
  const displayName = readString(record.name) ?? readString(record.displayName) ?? `${source.kind} ${sourceId}`;
  const spriteRefs = collectSpriteRefs(record, source.kind, source.file);
  const aliases = [...new Set(spriteRefs.flatMap((sprite) => spriteAliases.get(sprite.sourceId) ?? []))].sort((left, right) => left.localeCompare(right));
  return {
    assetId: `${source.kind}:${source.language.toLocaleLowerCase()}:${sourceId}`,
    sourceId,
    kind: source.kind,
    language: source.language,
    displayName,
    aliases,
    description: readString(record.description),
    sourcePath: `data/${source.file}`,
    sourceSprite: spriteRefs[0],
    spriteRefs,
  };
}

async function readSpriteAliases(sourceRoot: string, warnings: string[]): Promise<ReadonlyMap<string, readonly string[]>> {
  const filePath = join(sourceRoot, 'data', '_sprite_mapping.json');
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('顶层不是对象');
    const aliases = new Map<string, readonly string[]>();
    for (const [sourceId, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const names = Array.isArray(value.names)
        ? value.names.filter((name): name is string => typeof name === 'string' && name.trim() !== '').map((name) => name.trim())
        : [];
      if (names.length > 0) aliases.set(sourceId, [...new Set(names)]);
    }
    return aliases;
  } catch (cause) {
    warnings.push(`无法读取 PSS 素材别名映射：${cause instanceof Error ? cause.message : String(cause)}`);
    return new Map();
  }
}

function collectSpriteRefs(record: Record<string, unknown>, kind: PssAssetKind, file: string): PssSpriteRef[] {
  const refs: PssSpriteRef[] = [];
  const fields = kind === 'crew'
    ? ['body_sprite', 'sprite', 'head_sprite', 'leg_sprite', 'ability_sprite']
    : kind === 'ship'
      ? ['exterior_sprite', 'interior_sprite', 'sprite']
      : ['construction_sprite', 'sprite'];
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string') {
      const sourceId = /(?:^|\/)(\d+)\.png(?:$|\?)/i.exec(value)?.[1];
      if (sourceId !== undefined) refs.push({ sourceId, path: `sorted/${kind}/${sourceId}.png` });
      continue;
    }
    if (!isRecord(value)) continue;
    const sourceId = readString(value.source) ?? readString(value.id);
    if (sourceId === undefined) continue;
    const ref: PssSpriteRef = {
      sourceId,
      path: `sorted/${kind}/${sourceId}.png`,
      x: readNumber(value.x),
      y: readNumber(value.y),
      width: readNumber(value.width),
      height: readNumber(value.height),
    };
    refs.push(ref);
  }
  // 仅对真正存在的字段生成候选路径；索引不声明文件已下载。
  return refs.length === 0 && file.length > 0 ? [] : refs;
}

function compareEntries(left: PssIndexEntry, right: PssIndexEntry): number {
  return left.kind.localeCompare(right.kind)
    || left.displayName.localeCompare(right.displayName)
    || left.sourceId.localeCompare(right.sourceId, undefined, { numeric: true })
    || left.language.localeCompare(right.language);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPssLibraryIndex(value: unknown): value is PssLibraryIndex {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.sourceRoot === 'string'
    && Array.isArray(value.entries) && Array.isArray(value.warnings);
}

export function getPssDataSources(): readonly string[] {
  return DATA_SOURCES.map((source) => source.file);
}

export function resolvePssSpritePath(sourceRoot: string, sprite: PssSpriteRef): string {
  return join(sourceRoot, sprite.path ?? `sorted/${sprite.sourceId}.png`);
}

export function toPssRelativePath(sourceRoot: string, absolutePath: string): string {
  return relative(sourceRoot, absolutePath).replace(/\\/g, '/');
}
