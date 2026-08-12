import { HULL_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { createHullDocument, parseHullDefinition, type HullDefinitionDocument, type HullDefinitionInput } from './hull-definition';

export interface HullCatalogEntry extends HullDefinitionDocument {
  readonly configUrl: string;
  readonly configUuid: string;
}

export interface HullCatalogResult {
  readonly entries: readonly HullCatalogEntry[];
  readonly warnings: readonly string[];
}

let catalog: readonly HullCatalogEntry[] = [];

export function getHullCatalog(): readonly HullCatalogEntry[] { return catalog; }
export function setHullCatalog(entries: readonly HullCatalogEntry[]): void { catalog = [...entries]; }

export async function discoverHullDefinitions(assetDb: AssetDbPort): Promise<HullCatalogResult> {
  const entries: HullCatalogEntry[] = [];
  const warnings: string[] = [];
  const assets = await assetDb.queryAssets();
  for (const asset of assets.filter((item) => item.url.startsWith(`${HULL_CONFIG_DIRECTORY}/`) && item.url.endsWith('.json'))) {
    if (asset.isDirectory || asset.uuid === '') continue;
    try {
      const document = parseHullDefinition(JSON.parse(await assetDb.readFile(asset.uuid)));
      if (document === null) warnings.push(`忽略无效船体定义：${asset.url}`);
      else if (entries.some((entry) => entry.id === document.id)) warnings.push(`发现重复船体定义 ID：${document.id}`);
      else entries.push({ ...document, configUrl: asset.url, configUuid: asset.uuid });
    } catch (cause) {
      warnings.push(`读取船体定义失败：${asset.url}（${toMessage(cause)}）`);
    }
  }
  entries.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN') || left.id.localeCompare(right.id));
  return { entries, warnings };
}

export async function createHullDefinition(input: HullDefinitionInput, assetDb: AssetDbPort): Promise<{ readonly ok: boolean; readonly message: string }> {
  let document: HullDefinitionDocument;
  try { document = createHullDocument(input); } catch (cause) { return { ok: false, message: toMessage(cause) }; }
  const configUrl = `${HULL_CONFIG_DIRECTORY}/${input.id}.json`;
  if (await assetDb.queryUuid(configUrl)) return { ok: false, message: `船体定义已存在：${configUrl}` };
  const created = await assetDb.createAsset(configUrl, `${JSON.stringify(document, null, 2)}\n`);
  return created === null
    ? { ok: false, message: `创建船体定义失败：${configUrl}` }
    : { ok: true, message: `已创建船体定义：${input.displayName}` };
}

export async function updateHullDefinition(
  input: HullDefinitionInput & { readonly configUrl: string },
  assetDb: AssetDbPort,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  if (input.configUrl !== `${HULL_CONFIG_DIRECTORY}/${input.id}.json`) return { ok: false, message: '船体定义路径与稳定标识不一致' };
  let document: HullDefinitionDocument;
  try { document = createHullDocument(input); } catch (cause) { return { ok: false, message: toMessage(cause) }; }
  const saved = await assetDb.saveAsset(input.configUrl, `${JSON.stringify(document, null, 2)}\n`);
  return saved === null
    ? { ok: false, message: `保存船体定义失败：${input.configUrl}` }
    : { ok: true, message: `已保存船体定义：${document.displayName}` };
}

function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
