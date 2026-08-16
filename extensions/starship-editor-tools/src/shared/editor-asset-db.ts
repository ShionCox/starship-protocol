import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export interface CreatedAssetInfo {
  readonly uuid?: string;
  readonly url?: string;
}

export interface AssetInfo {
  readonly uuid: string;
  readonly url: string;
  readonly path?: string;
  readonly file?: string;
  readonly name?: string;
  readonly displayName?: string;
  readonly type?: string;
  readonly isDirectory?: boolean;
  readonly imported?: boolean;
  readonly invalid?: boolean;
  readonly subAssets?: Readonly<Record<string, AssetInfo>>;
}

export interface AssetDbPort {
  queryUuid(url: string): Promise<string>;
  createAsset(url: string, content: string): Promise<CreatedAssetInfo | null>;
  saveAsset(url: string, content: string): Promise<CreatedAssetInfo | null>;
  copyAsset(sourceUrl: string, targetUrl: string): Promise<CreatedAssetInfo | null>;
  deleteAsset(url: string): Promise<CreatedAssetInfo | null>;
  queryAssets(options?: { readonly extname?: string; readonly pattern?: string }): Promise<readonly AssetInfo[]>;
  queryDependencies(urlOrUuid: string): Promise<readonly string[]>;
  queryInfo(urlOrUuid: string): Promise<AssetInfo | null>;
  queryPath?(urlOrUuid: string): Promise<string | null>;
  readFile(urlOrUuid: string): Promise<string>;
  reimportAsset?(urlOrUuid: string): Promise<void>;
}

export type AssetSaveStage = 'save' | 'reimport' | 'refresh';
export class AssetSaveError extends Error {
  constructor(
    readonly stage: AssetSaveStage,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AssetSaveError';
  }
}

export const ASSET_OPERATION_QUIET_MS = 650;
const TRANSIENT_RETRY_MS = 1000;
let currentAuthoringAssetUrl: string | null = null;
let lastAuthoringAssetOperationAt = 0;
const lastAuthoringAssetOperationById = new Map<string, number>();

/** Asset DB 变更与公开打开/保存共用同一个静默时间戳。 */
export function noteAuthoringAssetOperation(urlOrUuid?: string | null, now = Date.now()): void {
  lastAuthoringAssetOperationAt = Math.max(lastAuthoringAssetOperationAt, now);
  const key = urlOrUuid?.trim();
  if (key !== undefined && key !== '') {
    lastAuthoringAssetOperationById.set(key, Math.max(lastAuthoringAssetOperationById.get(key) ?? 0, now));
  }
}

/** 记录公开编辑器当前文档，供统一保存入口等待对应 Asset DB 状态。 */
export function markCurrentAuthoringAsset(urlOrUuid: string): void {
  const value = urlOrUuid.trim();
  currentAuthoringAssetUrl = value === '' ? null : value;
  if (currentAuthoringAssetUrl !== null) noteAuthoringAssetOperation(currentAuthoringAssetUrl);
}

export function getCurrentAuthoringAsset(): string | null {
  return currentAuthoringAssetUrl;
}

/** Creator 文档切换与导入会短暂占用 Prefab；统一等待并只重试瞬态占用错误。 */
export async function retryTransientAssetOperation<T>(
  operation: () => Promise<T>,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? TRANSIENT_RETRY_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/UNKNOWN|EBUSY|EPERM|\bopen\b/i.test(message) || attempt === attempts - 1) break;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/** 公开 Asset DB 切换编辑文档；就绪资源不支付固定等待。 */
export async function openEditorAsset(urlOrUuid: string): Promise<void> {
  const requested = urlOrUuid.trim();
  if (requested === '') throw new Error('Creator Asset DB 资源地址不能为空');
  const previous = getCurrentAuthoringAsset();
  if (previous !== null) await waitForAuthoringAssetReady(editorAssetDb, previous);
  // 当前 Prefab 就绪不代表 Asset DB 中其它 SpriteFrame/Clip 已结束导入。
  // 切换 facade 前同时等待全局静默，避免后台导入占用即将保存的 Prefab。
  await waitForAuthoringQuiet();
  const uuid = requested.startsWith('db://')
    ? await retryTransientAssetOperation(async () => {
      return await Editor.Message.request('asset-db', 'query-uuid', requested) as string | null;
    })
    : requested;
  if (typeof uuid !== 'string' || uuid.trim() === '') throw new Error(`Creator Asset DB 找不到资源：${requested}`);
  await retryTransientAssetOperation(async () => {
    await Editor.Message.request('asset-db', 'open-asset', uuid);
  });
  markCurrentAuthoringAsset(requested);
}

/** 等待 Creator 自动完成 Prefab 导入；只观察状态，不再触发第二次 reimport。 */
export async function waitForImportedAsset(
  assetDb: AssetDbPort,
  urlOrUuid: string,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? 80;
  const delayMs = options.delayMs ?? 100;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await assetDb.queryInfo(urlOrUuid);
    if (info?.invalid === true) throw new Error(`Creator 导入资源失败：${urlOrUuid}`);
    // 旧测试端口或 Creator 精简返回不含 imported；存在资源且没有失败即可继续。
    if (info !== null && info.imported !== false) return;
    if (attempt < attempts - 1 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`等待 Creator 导入资源超时：${urlOrUuid}`);
}

/**
 * 统一资源安全屏障：invalid 立即失败，未导入按 100ms 轮询，只等待尚未满足的静默窗口。
 * `now`/`sleep` 仅用于确定性测试，不进入运行时接口。
 */
export async function waitForAuthoringAssetReady(
  assetDb: AssetDbPort,
  urlOrUuid: string,
  options: {
    readonly attempts?: number;
    readonly delayMs?: number;
    readonly quietMs?: number;
    readonly now?: () => number;
    readonly sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 80;
  const delayMs = options.delayMs ?? 100;
  const quietMs = options.quietMs ?? ASSET_OPERATION_QUIET_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (async (delay) => await new Promise((resolve) => setTimeout(resolve, delay)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await assetDb.queryInfo(urlOrUuid);
    if (info?.invalid === true) throw new Error(`Creator 导入资源失败：${urlOrUuid}`);
    if (info !== null && info.imported !== false) {
      const operationAt = lastAuthoringAssetOperationById.get(urlOrUuid.trim()) ?? 0;
      const remaining = Math.max(0, operationAt + quietMs - now());
      if (remaining === 0) return;
      await sleep(remaining);
      continue;
    }
    if (attempt < attempts - 1) await sleep(delayMs);
  }
  throw new Error(`等待 Creator 资源就绪超时：${urlOrUuid}`);
}

/** 批处理末尾只等待最后一次资源事件剩余的静默时间。 */
export async function waitForAuthoringQuiet(
  options: { readonly quietMs?: number; readonly now?: () => number; readonly sleep?: (delayMs: number) => Promise<void> } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const remaining = Math.max(0, lastAuthoringAssetOperationAt + (options.quietMs ?? ASSET_OPERATION_QUIET_MS) - now());
  if (remaining === 0) return;
  const sleep = options.sleep ?? (async (delay) => await new Promise((resolve) => setTimeout(resolve, delay)));
  await sleep(remaining);
}

/** 保存资源后重新导入，并刷新当前编辑上下文；不会保存 Scene/Prefab。 */
export async function saveAssetAndRefresh(
  assetDb: AssetDbPort,
  url: string,
  content: string,
  refreshCurrentContext: () => Promise<unknown>,
): Promise<CreatedAssetInfo> {
  let saved: CreatedAssetInfo | null;
  try {
    saved = await assetDb.saveAsset(url, content);
    noteAuthoringAssetOperation(url);
  } catch (cause) {
    throw new AssetSaveError('save', `保存资源失败：${url}`, cause);
  }
  if (saved === null) throw new AssetSaveError('save', `保存资源失败：${url}`);
  try {
    if (assetDb.reimportAsset !== undefined) await assetDb.reimportAsset(url);
  } catch (cause) {
    throw new AssetSaveError('reimport', `资源预览刷新失败（重新导入失败）：${url}`, cause);
  }
  try {
    await refreshCurrentContext();
  } catch (cause) {
    throw new AssetSaveError('refresh', `资源预览刷新失败（当前编辑上下文刷新失败）：${url}`, cause);
  }
  return saved;
}

/** 仅在编辑器进程使用；运行时客户端不依赖该适配器。 */
export const editorAssetDb: AssetDbPort = {
  async queryUuid(url) {
    if (url.trim() === '') return '';
    return (await Editor.Message.request('asset-db', 'query-uuid', url) as string | null) ?? '';
  },
  async createAsset(url, content) {
    const result = await Editor.Message.request(
      'asset-db',
      'create-asset',
      url,
      content,
      { overwrite: false, rename: false },
    ) as CreatedAssetInfo | null;
    if (result !== null) noteAuthoringAssetOperation(url);
    return result;
  },
  async saveAsset(url, content) {
    const result = await Editor.Message.request(
      'asset-db',
      'save-asset',
      url,
      content,
    ) as CreatedAssetInfo | null;
    if (result !== null) noteAuthoringAssetOperation(url);
    return result;
  },
  async reimportAsset(urlOrUuid) {
    await waitForAuthoringAssetReady(editorAssetDb, urlOrUuid);
    await retryTransientAssetOperation(async () => {
      await Editor.Message.request('asset-db', 'reimport-asset', urlOrUuid);
    });
    noteAuthoringAssetOperation(urlOrUuid);
    await waitForAuthoringAssetReady(editorAssetDb, urlOrUuid);
  },
  async copyAsset(sourceUrl, targetUrl) {
    const result = await Editor.Message.request(
      'asset-db',
      'copy-asset',
      sourceUrl,
      targetUrl,
      { overwrite: false, rename: false },
    ) as CreatedAssetInfo | null;
    if (result !== null) {
      noteAuthoringAssetOperation(targetUrl);
      // copy-asset 成功只表示复制请求已接受；目标 Prefab 仍需等待 Asset DB
      // 完成导入，后续 query-uuid/open-asset 才能稳定取得可编辑资源。
      await waitForImportedAsset(editorAssetDb, targetUrl);
    }
    return result;
  },
  async deleteAsset(url) {
    const result = await Editor.Message.request('asset-db', 'delete-asset', url) as CreatedAssetInfo | null;
    if (result !== null) noteAuthoringAssetOperation(url);
    return result;
  },
  async queryAssets(options) {
    return await Editor.Message.request('asset-db', 'query-assets', options) as readonly AssetInfo[];
  },
  async queryDependencies(urlOrUuid) {
    return await Editor.Message.request('asset-db', 'query-asset-dependencies', urlOrUuid, 'all') as readonly string[];
  },
  async queryInfo(urlOrUuid) {
    if (urlOrUuid.trim() === '') return null;
    return await Editor.Message.request('asset-db', 'query-asset-info', urlOrUuid) as AssetInfo | null;
  },
  async queryPath(urlOrUuid) {
    return await Editor.Message.request('asset-db', 'query-path', urlOrUuid) as string | null;
  },
  async readFile(urlOrUuid) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const info = await this.queryInfo(urlOrUuid);
        const queriedPath = info?.file === undefined ? await this.queryPath?.(urlOrUuid) : undefined;
        const filePath = info?.file ?? queriedPath;
        // AssetInfo.path 是 loader 地址，不是磁盘路径；只接受官方 file 或 query-path
        // 返回的绝对路径，避免把 db:// URL 交给 node:fs。
        if (typeof filePath === 'string' && isAbsolute(filePath)) return await readFile(filePath, 'utf8');
      } catch (cause) {
        lastError = cause;
      }
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (lastError !== undefined) throw lastError;
    throw new Error(`无法读取资源文件：${urlOrUuid}`);
  },
};
