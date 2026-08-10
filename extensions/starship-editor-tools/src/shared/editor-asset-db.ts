import { readFile } from 'node:fs/promises';

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
  readFile(urlOrUuid: string): Promise<string>;
}

/** 仅在编辑器进程使用；运行时客户端不依赖该适配器。 */
export const editorAssetDb: AssetDbPort = {
  async queryUuid(url) {
    return await Editor.Message.request('asset-db', 'query-uuid', url) as string;
  },
  async createAsset(url, content) {
    return await Editor.Message.request(
      'asset-db',
      'create-asset',
      url,
      content,
      { overwrite: false, rename: false },
    ) as CreatedAssetInfo | null;
  },
  async saveAsset(url, content) {
    return await Editor.Message.request(
      'asset-db',
      'save-asset',
      url,
      content,
    ) as CreatedAssetInfo | null;
  },
  async copyAsset(sourceUrl, targetUrl) {
    return await Editor.Message.request(
      'asset-db',
      'copy-asset',
      sourceUrl,
      targetUrl,
      { overwrite: false, rename: false },
    ) as CreatedAssetInfo | null;
  },
  async deleteAsset(url) {
    return await Editor.Message.request('asset-db', 'delete-asset', url) as CreatedAssetInfo | null;
  },
  async queryAssets(options) {
    return await Editor.Message.request('asset-db', 'query-assets', options) as readonly AssetInfo[];
  },
  async queryDependencies(urlOrUuid) {
    return await Editor.Message.request('asset-db', 'query-asset-dependencies', urlOrUuid, 'all') as readonly string[];
  },
  async queryInfo(urlOrUuid) {
    return await Editor.Message.request('asset-db', 'query-asset-info', urlOrUuid) as AssetInfo | null;
  },
  async readFile(urlOrUuid) {
    const info = await this.queryInfo(urlOrUuid);
    if (info?.file === undefined) {
      throw new Error(`无法读取资源文件：${urlOrUuid}`);
    }
    return await readFile(info.file, 'utf8');
  },
};
