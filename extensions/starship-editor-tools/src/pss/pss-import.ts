import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import type { PssManifest, PssManifestEntry } from './pss-types';
import { isSafePath, validatePssManifest } from './pss-manifest';

export interface PssImportFileSystem {
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly stat: (path: string) => Promise<{ readonly isFile: () => boolean }>;
  readonly mkdir: (path: string, options: { readonly recursive: true }) => Promise<unknown>;
  readonly copyFile: (source: string, target: string) => Promise<void>;
  readonly unlink: (path: string) => Promise<void>;
}

export interface PssImportOptions {
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly fileSystem?: PssImportFileSystem;
  readonly overwrite?: boolean;
  readonly rollbackOnFailure?: boolean;
}

export interface PssImportResult {
  readonly ok: boolean;
  readonly status: 'imported' | 'already-present' | 'rejected' | 'failed';
  readonly assetId: string;
  readonly sourcePath?: string;
  readonly targetPath?: string;
  readonly changed: boolean;
  readonly created?: boolean;
  readonly message: string;
}

const nodeFileSystem: PssImportFileSystem = {
  readFile: async (path) => await readFile(path),
  stat: async (path) => await stat(path),
  mkdir: async (path, options) => await mkdir(path, options),
  copyFile: async (source, target) => await copyFile(source, target),
  unlink: async (path) => await unlink(path),
};

/** 创建可注入的导入端口；它不依赖 Creator IPC，便于在单测中模拟复制和回滚。 */
export function createPssImportPort(options: PssImportOptions) {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  return {
    async importEntry(entry: PssManifestEntry): Promise<PssImportResult> {
      return await importPssEntry(entry, { ...options, fileSystem });
    },
    async importManifest(manifest: PssManifest): Promise<readonly PssImportResult[]> {
      const validation = validatePssManifest(manifest, { sourceRoot: options.sourceRoot, targetRoot: options.targetRoot });
      if (!validation.ok) {
        const rawEntries = Array.isArray((manifest as { readonly entries?: unknown }).entries)
          ? (manifest as { readonly entries: readonly { readonly assetId?: unknown }[] }).entries
          : [];
        return rawEntries.map((entry) => rejected(typeof entry.assetId === 'string' ? entry.assetId : 'unknown', validation.errors.join('；')));
      }
      const results: PssImportResult[] = [];
      const createdTargets: string[] = [];
      for (const entry of validation.entries) {
        const result = await importPssEntry(entry, { ...options, fileSystem });
        results.push(result);
        // 覆盖已有文件时不能把用户原文件当成“本次创建”而删除；只有新目标允许自动回滚。
        if (result.ok && result.changed && result.created === true && result.targetPath !== undefined) createdTargets.push(result.targetPath);
        if (!result.ok && (options.rollbackOnFailure ?? true)) {
          for (const path of createdTargets.reverse()) await fileSystem.unlink(path).catch(() => undefined);
          break;
        }
      }
      return results;
    },
  };
}

export async function importPssEntry(entry: PssManifestEntry, options: PssImportOptions & { readonly fileSystem?: PssImportFileSystem }): Promise<PssImportResult> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const sourceRelativePath = entry.sourceRelativePath ?? entry.sourceSprite ?? entry.sourcePath ?? entry.source;
  if (typeof sourceRelativePath !== 'string' || typeof entry.targetPath !== 'string' || typeof entry.sourceSha256 !== 'string') {
    return rejected(entry.assetId, 'manifest 条目缺少来源路径、目标路径或 sourceSha256');
  }
  if (!isSafePath(options.sourceRoot, sourceRelativePath)) return rejected(entry.assetId, '素材来源路径越界，已拒绝导入');
  if (!isSafePath(options.targetRoot, entry.targetPath)) return rejected(entry.assetId, '导入目标路径越界，已拒绝导入');
  const sourcePath = resolveImportPath(options.sourceRoot, sourceRelativePath);
  const targetPath = resolveImportPath(options.targetRoot, entry.targetPath);
  try {
    const sourceStat = await fileSystem.stat(sourcePath);
    if (!sourceStat.isFile()) return rejected(entry.assetId, '素材来源不是文件');
    const sourceHash = hash(await fileSystem.readFile(sourcePath));
    if (sourceHash !== entry.sourceSha256.toLowerCase()) return rejected(entry.assetId, '素材来源 Hash 与 manifest 不一致');
    const targetExists = await fileSystem.stat(targetPath).then(() => true).catch(() => false);
    if (targetExists) {
      const targetHash = hash(await fileSystem.readFile(targetPath));
      if (targetHash === sourceHash) return { ok: true, status: 'already-present', assetId: entry.assetId, sourcePath, targetPath, changed: false, created: false, message: '目标素材已存在且 Hash 一致，跳过复制' };
      if (options.overwrite !== true) return rejected(entry.assetId, '目标素材已存在且内容不同，未启用覆盖');
    }
    await fileSystem.mkdir(dirname(targetPath), { recursive: true });
    await fileSystem.copyFile(sourcePath, targetPath);
    return { ok: true, status: 'imported', assetId: entry.assetId, sourcePath, targetPath, changed: true, created: !targetExists, message: targetExists ? '素材已覆盖导入' : '素材已导入' };
  } catch (cause) {
    return { ok: false, status: 'failed', assetId: entry.assetId, sourcePath, targetPath, changed: false, created: false, message: `素材导入失败：${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function rejected(assetId: string, message: string): PssImportResult { return { ok: false, status: 'rejected', assetId, changed: false, created: false, message }; }
function resolveImportPath(root: string, candidate: string): string {
  return isAbsolute(candidate) || win32.isAbsolute(candidate) ? candidate : join(root, candidate);
}
