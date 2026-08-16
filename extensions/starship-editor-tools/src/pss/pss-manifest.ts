import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import type { PssImageSize, PssManifest, PssManifestEntry, PssRect } from './pss-types';

export const FIRST_PSS_ASSET_IDS = [
  'room-reactor',
  'room-laser',
  'room-shield',
  'room-elevator',
  'room-medbay',
  'crew-engineer',
  'crew-gunner',
  'crew-medic',
] as const;

export const FIRST_PSS_MANIFEST_EXPECTATIONS = [
  { assetId: 'room-reactor', kind: 'room', sourceId: '5', sourceSprite: 'sorted/room/502.png', acceptedSources: ['sprites/808.png', 'sorted/room/808.png'] },
  { assetId: 'room-laser', kind: 'room', sourceId: '444', sourceSprite: 'sorted/room/3984.png', acceptedSources: ['sprites/8285.png', 'sorted/room/8285.png'] },
  { assetId: 'room-shield', kind: 'room', sourceId: '8', sourceSprite: 'sorted/room/43.png', acceptedSources: ['sprites/8041.png', 'sorted/room/8041.png'] },
  { assetId: 'room-elevator', kind: 'room', sourceId: '3', sourceSprite: 'sorted/room/83.png', acceptedSources: ['sprites/83.png', 'sorted/room/83.png'] },
  { assetId: 'room-medbay', kind: 'room', sourceId: '204', sourceSprite: 'sorted/room/1107.png', acceptedSources: ['sprites/1107.png', 'sorted/room/1107.png'] },
  { assetId: 'crew-engineer', kind: 'crew', sourceId: '8', sourceSprite: 'sorted/crew/190.png', acceptedSources: ['sprites/190.png', 'sorted/crew/190.png'] },
  { assetId: 'crew-gunner', kind: 'crew', sourceId: '240', sourceSprite: 'sorted/crew/3889.png', acceptedSources: ['sprites/3779.png', 'sorted/crew/3779.png'] },
  { assetId: 'crew-medic', kind: 'crew', sourceId: '257', sourceSprite: 'sorted/crew/3803.png', acceptedSources: ['sprites/1645.png', 'sorted/crew/1645.png', 'sprites/3803.png', 'sorted/crew/3803.png'] },
] as const;

/** 素材准备流水线写入的稳定视觉 ID；与旧的实体 ID 清单分开，避免把来源实体误当成导入资源。 */
const FIRST_PSS_VISUAL_EXPECTATIONS = [
  { visualId: 'visual-pss-room-elevator-83', kind: 'room', source: 'sprites/83.png' },
  { visualId: 'visual-pss-room-reactor-808', kind: 'room', source: 'sprites/808.png' },
  { visualId: 'visual-pss-room-laser-8285', kind: 'room', source: 'sprites/8285.png' },
  { visualId: 'visual-pss-room-shield-8041', kind: 'room', source: 'sprites/8041.png' },
  { visualId: 'visual-pss-room-medbay-1107', kind: 'room', source: 'sprites/1107.png' },
  { visualId: 'appearance-pss-engineer-bob-8', kind: 'crew-part', source: 'sprites/190.png' },
  { visualId: 'appearance-pss-gunner-bobby-240', kind: 'crew-part', source: 'sprites/3779.png' },
  { visualId: 'appearance-pss-medic-doctor-dong-153', kind: 'crew-part', source: 'sprites/1645.png' },
  { visualId: 'appearance-pss-soldier-government-45', kind: 'crew-part', source: 'sprites/724.png' },
] as const;

export interface PssManifestValidationOptions {
  readonly sourceRoot?: string;
  readonly targetRoot?: string;
  readonly requireFirstBatch?: boolean;
}

export interface PssManifestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly entries: readonly PssManifestEntry[];
}

export async function readPssManifest(manifestPath: string): Promise<PssManifest> {
  const value = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;
  if (!isRecord(value)) throw new Error('PSS manifest 必须是对象');
  return value as unknown as PssManifest;
}

/**
 * 清单是跨机器协作的边界：来源只能落在只读素材库内，目标只能落在项目目标根内。
 * 任何一条不满足都 fail closed，避免清单意外覆盖用户文件或把规则源写回外部库。
 */
export function validatePssManifest(
  manifest: unknown,
  options: PssManifestValidationOptions = {},
): PssManifestValidationResult {
  const errors: string[] = [];
  if (!isRecord(manifest)) return { ok: false, errors: ['PSS manifest 必须是对象'], entries: [] };
  if (manifest.schemaVersion !== 1) errors.push('PSS manifest schemaVersion 必须为 1');
  if (typeof manifest.sourceRoot !== 'string' || manifest.sourceRoot.trim() === '') errors.push('PSS manifest 缺少 sourceRoot');
  if (!Array.isArray(manifest.entries)) return { ok: false, errors: [...errors, 'PSS manifest entries 必须是数组'], entries: [] };
  const entries: PssManifestEntry[] = [];
  const seen = new Set<string>();
  for (const [index, value] of manifest.entries.entries()) {
    const result = validateManifestEntry(value, index, options, typeof manifest.sourceRoot === 'string' ? manifest.sourceRoot : undefined);
    errors.push(...result.errors);
    if (result.entry !== undefined) {
      if (seen.has(result.entry.assetId)) errors.push(`manifest entries[${index}] assetId 重复：${result.entry.assetId}`);
      seen.add(result.entry.assetId);
      entries.push(result.entry);
    }
  }
  if (options.requireFirstBatch === true) {
    const hasCanonicalIds = FIRST_PSS_ASSET_IDS.every((id) => seen.has(id));
    if (!hasCanonicalIds) {
      // 资产准备流水线以 visual-* / appearance-* 为稳定 ID；此时按来源 sprite 校验首批范围。
      const sources = new Set(entries.flatMap((entry) => [entry.sourcePath, ...(entry.referencePaths ?? [])]));
      for (const expected of FIRST_PSS_MANIFEST_EXPECTATIONS) {
        if (!expected.acceptedSources.some((source) => sources.has(source))) errors.push(`manifest 缺少首批素材来源：${expected.sourceSprite}`);
      }
    } else {
      for (const id of FIRST_PSS_ASSET_IDS) if (!seen.has(id)) errors.push(`manifest 缺少首批素材：${id}`);
    }
  }
  return { ok: errors.length === 0, errors, entries };
}

/** 校验 P7 约定的首批五个房间与三套船员，防止清单错配素材而仍被当作成功。 */
export function validateFirstPssManifest(
  manifest: unknown,
  options: PssManifestValidationOptions = {},
): PssManifestValidationResult {
  const result = validatePssManifest(manifest, { ...options, requireFirstBatch: true });
  const errors = [...result.errors];
  const usesPreparedVisualIds = result.entries.some((entry) => entry.visualId.startsWith('visual-pss-') || entry.visualId.startsWith('appearance-pss-'));
  if (usesPreparedVisualIds) {
    for (const expected of FIRST_PSS_VISUAL_EXPECTATIONS) {
      const candidates = result.entries.filter((entry) => entry.visualId === expected.visualId);
      if (candidates.length === 0) {
        errors.push(`manifest 缺少首批视觉 ID：${expected.visualId}`);
        continue;
      }
      if (!candidates.some((entry) => entry.kind === expected.kind && [entry.sourcePath, ...(entry.referencePaths ?? [])]
        .map((source) => source.replace(/\\/g, '/')).some((source) => source.endsWith(expected.source)))) {
        errors.push(`首批视觉 ID ${expected.visualId} 未绑定来源：${expected.source}`);
      }
    }
  }
  for (const expected of FIRST_PSS_MANIFEST_EXPECTATIONS) {
    const entry = result.entries.find((candidate) => candidate.assetId === expected.assetId);
    if (entry === undefined) continue;
    if (entry.kind !== expected.kind) errors.push(`首批素材 ${expected.assetId} kind 不匹配`);
    const source = (entry.sourceRelativePath ?? entry.sourceSprite ?? entry.sourcePath).replace(/\\/g, '/');
    if (!source.endsWith(expected.sourceSprite)) errors.push(`首批素材 ${expected.assetId} sourceSprite 应为 ${expected.sourceSprite}`);
  }
  return { ok: errors.length === 0, errors, entries: result.entries };
}

export function validateManifestEntry(
  value: unknown,
  index = 0,
  options: PssManifestValidationOptions = {},
  manifestSourceRoot?: string,
): { readonly entry?: PssManifestEntry; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { errors: [`manifest entries[${index}] 必须是对象`] };
  const entry = value as Partial<PssManifestEntry>;
  const assetId = readId(entry.assetId);
  const visualId = readId(entry.visualId);
  if (assetId === undefined) errors.push(`manifest entries[${index}] assetId 无效`);
  if (visualId === undefined) errors.push(`manifest entries[${index}] visualId 无效`);
  if (entry.kind !== 'ship' && entry.kind !== 'room' && entry.kind !== 'crew' && entry.kind !== 'crew-part') errors.push(`manifest entries[${index}] kind 必须为 ship、room、crew 或 crew-part`);
  const sourcePath = readPath(entry.sourcePath) ?? readPath(entry.source);
  const targetPath = readPath(entry.targetPath);
  if (sourcePath === undefined) errors.push(`manifest entries[${index}] sourcePath 无效`);
  if (targetPath === undefined) errors.push(`manifest entries[${index}] targetPath 无效`);
  const sourceRoot = options.sourceRoot ?? manifestSourceRoot;
  if (sourcePath !== undefined && sourceRoot !== undefined && !isSafePath(sourceRoot, sourcePath)) errors.push(`manifest entries[${index}] sourcePath 越界`);
  if (targetPath !== undefined && options.targetRoot !== undefined && !isSafePath(options.targetRoot, targetPath)) errors.push(`manifest entries[${index}] targetPath 越界`);
  const sourceSha256 = typeof entry.sourceSha256 === 'string' && /^[0-9a-f]{64}$/i.test(entry.sourceSha256) ? entry.sourceSha256.toLowerCase() : undefined;
  if (sourceSha256 === undefined) errors.push(`manifest entries[${index}] sourceSha256 必须是 64 位十六进制`);
  if ((typeof entry.licenseNote !== 'string' || entry.licenseNote.trim() === '') && (typeof entry.rightsStatus !== 'string' || entry.rightsStatus.trim() === '')) errors.push(`manifest entries[${index}] 缺少 licenseNote/rightsStatus`);
  if (entry.sourceRelativePath !== undefined && readPath(entry.sourceRelativePath) === undefined) errors.push(`manifest entries[${index}] sourceRelativePath 无效`);
  if (entry.sourceSprite !== undefined && readPath(entry.sourceSprite) === undefined) errors.push(`manifest entries[${index}] sourceSprite 无效`);
  if (entry.referencePaths !== undefined && (!Array.isArray(entry.referencePaths) || entry.referencePaths.some((source) => readPath(source) === undefined))) errors.push(`manifest entries[${index}] referencePaths 无效`);
  if (entry.outputAssetUrls !== undefined && (!Array.isArray(entry.outputAssetUrls) || entry.outputAssetUrls.some((url) => typeof url !== 'string' || !isSafeAssetUrl(url)))) errors.push(`manifest entries[${index}] outputAssetUrls 必须是 db://assets/ 下的 URL`);
  if (entry.size !== undefined && !isImageSize(entry.size)) errors.push(`manifest entries[${index}] size 无效`);
  if (entry.rect !== undefined && (!isRect(entry.rect) || (isImageSize(entry.size) && !isRectInside(entry.rect, entry.size)))) errors.push(`manifest entries[${index}] rect 越出 source 图片边界`);
  if (entry.frameRects !== undefined && (!Array.isArray(entry.frameRects) || entry.frameRects.some((rect) => !isRect(rect) || (isImageSize(entry.size) && !isRectInside(rect, entry.size))))) errors.push(`manifest entries[${index}] frameRects 越出 source 图片边界`);
  if (entry.fps !== undefined && (typeof entry.fps !== 'number' || !Number.isFinite(entry.fps) || entry.fps < 0)) errors.push(`manifest entries[${index}] fps 不能为负数`);
  if (entry.crewCompositionOffsets !== undefined && (!Array.isArray(entry.crewCompositionOffsets) || entry.crewCompositionOffsets.some((offset) => !isRecord(offset) || !isFiniteNumber(offset.x) || !isFiniteNumber(offset.y)))) errors.push(`manifest entries[${index}] crewCompositionOffsets 无效`);
  if (errors.length > 0) return { errors };
  return {
    errors,
    entry: {
      assetId: assetId as string,
      visualId: visualId as string,
      kind: entry.kind as 'ship' | 'room' | 'crew' | 'crew-part',
      source: typeof entry.source === 'string' ? entry.source : undefined,
      referencePaths: Array.isArray(entry.referencePaths) ? entry.referencePaths : undefined,
      sourcePath: sourcePath as string,
      sourceRelativePath: optionalPath(entry.sourceRelativePath),
      sourceSprite: optionalPath(entry.sourceSprite),
      targetPath: targetPath as string,
      outputAssetUrls: Array.isArray(entry.outputAssetUrls) ? entry.outputAssetUrls : undefined,
      sourceSha256: sourceSha256 as string,
      licenseNote: typeof entry.licenseNote === 'string' ? entry.licenseNote.trim() : (entry.rightsStatus as string).trim(),
      rightsStatus: typeof entry.rightsStatus === 'string' ? entry.rightsStatus.trim() : 'UNSPECIFIED',
      targetSha256: typeof entry.targetSha256 === 'string' ? entry.targetSha256.toLowerCase() : undefined,
      byteLength: typeof entry.byteLength === 'number' ? entry.byteLength : undefined,
      size: isImageSize(entry.size) ? entry.size : undefined,
      frameRects: Array.isArray(entry.frameRects) && entry.frameRects.every(isRect) ? entry.frameRects : undefined,
      filter: typeof entry.filter === 'string' ? entry.filter : undefined,
      rect: isRect(entry.rect) ? entry.rect : undefined,
      mode: typeof entry.mode === 'string' && entry.mode.trim() !== '' ? entry.mode.trim() : undefined,
      fps: typeof entry.fps === 'number' ? entry.fps : undefined,
      crewCompositionOffsets: Array.isArray(entry.crewCompositionOffsets) ? entry.crewCompositionOffsets as PssManifestEntry['crewCompositionOffsets'] : undefined,
    },
  };
}

export function isSafePath(root: string, candidate: string): boolean {
  if (root.trim() === '' || candidate.trim() === '' || candidate.includes('\0')) return false;
  const rootIsWindows = /^[a-z]:[\\/]/i.test(root) || root.includes('\\');
  // 在 POSIX 单测/工具进程中也拒绝 Windows 绝对路径，避免把 `C:\\...` 当作普通文件名。
  if (!rootIsWindows && win32.isAbsolute(candidate)) return false;
  const resolver = rootIsWindows ? win32 : { resolve, relative, isAbsolute };
  const absoluteRoot = resolver.resolve(root);
  const absoluteCandidate = resolver.isAbsolute(candidate) ? resolver.resolve(candidate) : resolver.resolve(root, candidate);
  const remainder = resolver.relative(absoluteRoot, absoluteCandidate);
  return remainder === '' || (!remainder.startsWith('..') && !resolver.isAbsolute(remainder));
}

function readId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:-]*$/i.test(value.trim()) ? value.trim() : undefined;
}
function readPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('\0') && !value.startsWith('db://') ? value.trim() : undefined;
}
function optionalPath(value: unknown): string | undefined { return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined; }
function isSafeAssetUrl(value: string): boolean { return /^db:\/\/assets(?:\/|$)/.test(value) && !value.includes('..'); }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isRect(value: unknown): value is PssRect { return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.width) && isFiniteNumber(value.height) && value.width > 0 && value.height > 0; }
function isImageSize(value: unknown): value is PssImageSize { return isRecord(value) && isFiniteNumber(value.width) && isFiniteNumber(value.height) && value.width > 0 && value.height > 0; }
function isRectInside(rect: PssRect, size: PssImageSize): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= size.width && rect.y + rect.height <= size.height;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
