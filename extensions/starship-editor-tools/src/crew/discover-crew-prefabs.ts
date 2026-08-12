import { CREW_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort, AssetInfo } from '../shared/editor-asset-db';

const CREW_VIEW_SCRIPT_URL = 'db://assets/scripts/presentation/CrewView.ts';
const CREW_ID_PATTERN = /^crew-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CREW_ROLES = new Set(['ENGINEER', 'GUNNER']);

export interface CrewDefinitionDocument {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
}

export interface CrewPrefabCatalogEntry extends CrewDefinitionDocument {
  readonly prefabUrl: string;
  readonly prefabUuid: string;
  readonly configUrl: string;
  readonly configUuid: string;
}

export interface CrewDiscoveryResult {
  readonly entries: readonly CrewPrefabCatalogEntry[];
  readonly warnings: readonly string[];
}

/** 只依据船员 JSON、CrewView 与 Prefab 的真实 Asset DB 依赖建立目录。 */
export async function discoverCrewPrefabs(assetDb: AssetDbPort): Promise<CrewDiscoveryResult> {
  const warnings: string[] = [];
  const [allAssets, crewViewUuid] = await Promise.all([assetDb.queryAssets(), resolveCrewViewScriptUuid(assetDb)]);
  if (crewViewUuid === '') return { entries: [], warnings: ['无法定位 CrewView 脚本，已关闭船员自动发现'] };
  const definitions = new Map<string, { asset: AssetInfo; document: CrewDefinitionDocument }>();
  for (const asset of allAssets.filter((item) => item.url.startsWith(`${CREW_CONFIG_DIRECTORY}/`) && item.url.endsWith('.json'))) {
    if (asset.isDirectory === true || asset.uuid.length === 0) continue;
    try {
      const document = parseCrewDefinition(JSON.parse(await assetDb.readFile(asset.uuid)));
      if (document === null) warnings.push(`忽略无效船员定义：${asset.url}`);
      else if ([...definitions.values()].some((entry) => entry.document.id === document.id)) warnings.push(`发现重复船员定义 ID：${document.id}`);
      else definitions.set(asset.uuid, { asset, document });
    } catch (cause) {
      warnings.push(`读取船员定义失败：${asset.url}（${toMessage(cause)}）`);
    }
  }
  const entries: CrewPrefabCatalogEntry[] = [];
  for (const prefab of allAssets.filter((item) => item.url.startsWith('db://assets/prefabs/') && item.url.endsWith('.prefab'))) {
    if (prefab.isDirectory === true || prefab.uuid.length === 0) continue;
    try {
      const dependencies = await assetDb.queryDependencies(prefab.uuid);
      if (dependencies.indexOf(crewViewUuid) === -1) continue;
      const matches = dependencies.map((uuid) => definitions.get(uuid)).filter((value): value is { asset: AssetInfo; document: CrewDefinitionDocument } => value !== undefined);
      if (matches.length !== 1) {
        if (matches.length > 1) warnings.push(`Prefab 绑定多个船员定义：${prefab.url}`);
        continue;
      }
      const { asset, document } = matches[0];
      entries.push({ ...document, prefabUrl: prefab.url, prefabUuid: prefab.uuid, configUrl: asset.url, configUuid: asset.uuid });
    } catch (cause) {
      warnings.push(`读取船员 Prefab 依赖失败：${prefab.url}（${toMessage(cause)}）`);
    }
  }
  entries.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN') || left.id.localeCompare(right.id));
  return { entries, warnings };
}

export function parseCrewDefinition(value: unknown): CrewDefinitionDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (
    typeof value.id !== 'string' || !CREW_ID_PATTERN.test(value.id) ||
    typeof value.displayName !== 'string' || value.displayName.trim().length === 0 ||
    typeof value.role !== 'string' || !CREW_ROLES.has(value.role) ||
    !isPositiveInteger(value.maxHp) || !isPositiveInteger(value.moveTicksPerEdge)
  ) return null;
  return {
    schemaVersion: 1,
    id: value.id,
    displayName: value.displayName.trim(),
    role: value.role,
    maxHp: value.maxHp,
    moveTicksPerEdge: value.moveTicksPerEdge,
  };
}

async function resolveCrewViewScriptUuid(assetDb: AssetDbPort): Promise<string> {
  const direct = await assetDb.queryUuid(CREW_VIEW_SCRIPT_URL);
  if (direct) return direct;
  const info = await assetDb.queryInfo(CREW_VIEW_SCRIPT_URL);
  if (info?.uuid) return info.uuid;
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
