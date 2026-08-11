import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOM_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort, AssetInfo } from '../shared/editor-asset-db';

const ROOM_VIEW_SCRIPT_URL = 'db://assets/scripts/presentation/RoomView.ts';
const ROOM_VIEW_SCRIPT_META_PATH = 'assets/scripts/presentation/RoomView.ts.meta';
const ROOM_ID_PATTERN = /^room-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES = new Set([
  'ENERGY',
  'WEAPON',
  'DEFENSE',
  'MOBILITY',
  'SUPPORT',
  'MOVEMENT',
  'TACTICAL',
  'DRONE',
  'ECONOMY',
  'SPECIAL',
]);

export interface RoomPrefabCatalogEntry {
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
  readonly prefabUrl: string;
  readonly prefabUuid: string;
  readonly configUrl: string;
  readonly configUuid: string;
}

export interface RoomDiscoveryResult {
  readonly entries: readonly RoomPrefabCatalogEntry[];
  readonly warnings: readonly string[];
}

export interface RoomDefinitionDocument {
  readonly schemaVersion: number;
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
}

/**
 * 从 Asset DB 的真实依赖关系发现可创建房间，避免维护第二份 Prefab 清单。
 * 这里是编辑器边界校验；Prefab 打开后仍由 RoomView.parseRoomDefinition 做最终校验。
 */
export async function discoverRoomPrefabs(assetDb: AssetDbPort): Promise<RoomDiscoveryResult> {
  const warnings: string[] = [];
  const [allAssets, roomViewUuid] = await Promise.all([
    assetDb.queryAssets(),
    resolveRoomViewScriptUuid(assetDb),
  ]);
  const configAssets = allAssets.filter((asset) =>
    asset.url.startsWith(`${ROOM_CONFIG_DIRECTORY}/`) && asset.url.endsWith('.json'));
  const prefabAssets = allAssets.filter((asset) =>
    asset.url.startsWith('db://assets/prefabs/') && asset.url.endsWith('.prefab'));
  if (roomViewUuid === '') {
    return {
      entries: [],
      warnings: ['无法定位 RoomView 脚本，已关闭房间建筑自动发现；请检查脚本导入状态'],
    };
  }
  const definitions = new Map<string, { asset: AssetInfo; document: RoomDefinitionDocument }>();

  for (const asset of configAssets) {
    if (asset.isDirectory === true || asset.uuid.length === 0) continue;
    try {
      const document = parseRoomDefinition(JSON.parse(await assetDb.readFile(asset.uuid)));
      if (document === null) {
        warnings.push(`忽略无效房间定义：${asset.url}`);
      } else if (definitions.has(document.id)) {
        warnings.push(`发现重复房间定义 ID：${document.id}`);
      } else {
        definitions.set(asset.uuid, { asset, document });
      }
    } catch (error) {
      warnings.push(`读取房间定义失败：${asset.url}（${toMessage(error)}）`);
    }
  }

  const entries: RoomPrefabCatalogEntry[] = [];
  for (const prefab of prefabAssets) {
    if (prefab.isDirectory === true || prefab.uuid.length === 0) continue;
    try {
      const dependencies = await assetDb.queryDependencies(prefab.uuid);
      if (!dependencies.includes(roomViewUuid)) continue;
      const matches = dependencies
        .map((uuid) => definitions.get(uuid))
        .filter((value): value is { asset: AssetInfo; document: RoomDefinitionDocument } => value !== undefined);
      if (matches.length !== 1) {
        if (matches.length > 1) warnings.push(`Prefab 绑定多个房间定义：${prefab.url}`);
        continue;
      }
      const { asset, document } = matches[0];
      entries.push({
        id: document.id,
        displayName: document.displayName,
        category: document.category,
        width: document.width,
        height: document.height,
        maxLevel: document.maxLevel,
        maxHp: document.maxHp,
        minPower: document.minPower,
        maxPower: document.maxPower,
        powerGeneration: document.powerGeneration,
        crewCapacity: document.crewCapacity,
        prefabUrl: prefab.url,
        prefabUuid: prefab.uuid,
        configUrl: asset.url,
        configUuid: asset.uuid,
      });
    } catch (error) {
      warnings.push(`读取房间 Prefab 依赖失败：${prefab.url}（${toMessage(error)}）`);
    }
  }

  entries.sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN') || left.id.localeCompare(right.id));
  return { entries, warnings };
}

async function resolveRoomViewScriptUuid(assetDb: AssetDbPort): Promise<string> {
  const directUuid = await assetDb.queryUuid(ROOM_VIEW_SCRIPT_URL);
  if (typeof directUuid === 'string' && directUuid !== '') return directUuid;

  const info = await assetDb.queryInfo(ROOM_VIEW_SCRIPT_URL);
  if (typeof info?.uuid === 'string' && info.uuid !== '') return info.uuid;

  // 某些 Creator 3.8.8 导入状态下 query-uuid 在脚本首次刷新期间会暂时返回空值；
  // 用公开 Asset DB 查询作为只读回退，避免把“尚未完成导入”误判为配置错误。
  const scriptAssets = await assetDb.queryAssets({ extname: '.ts', pattern: 'db://assets/**' });
  const roomView = scriptAssets.find((asset) => asset.url.endsWith('/RoomView.ts'));
  if (roomView?.uuid) return roomView.uuid;

  // 仅读取项目自身的 meta 作为导入状态回退；插件不改写任何序列化文件。
  const projectPath = (globalThis as {
    Editor?: { Project?: { path?: string } };
  }).Editor?.Project?.path;
  if (typeof projectPath !== 'string' || projectPath.length === 0) return '';
  try {
    const meta = JSON.parse(await readFile(join(projectPath, ROOM_VIEW_SCRIPT_META_PATH), 'utf8')) as { uuid?: unknown };
    return typeof meta.uuid === 'string' ? meta.uuid : '';
  } catch {
    return '';
  }
}

export function parseRoomDefinition(value: unknown): RoomDefinitionDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  if (
    typeof value.id !== 'string' ||
    !ROOM_ID_PATTERN.test(value.id) ||
    typeof value.displayName !== 'string' ||
    value.displayName.trim().length === 0 ||
    typeof value.category !== 'string' ||
    !CATEGORIES.has(value.category) ||
    !isPositiveInteger(value.width) ||
    !isPositiveInteger(value.height) ||
    !isPositiveInteger(value.maxLevel) ||
    !isPositiveInteger(value.maxHp) ||
    !isNonNegativeInteger(value.minPower) ||
    !isNonNegativeInteger(value.maxPower) ||
    value.minPower > value.maxPower ||
    (value.powerGeneration !== undefined && !isNonNegativeInteger(value.powerGeneration)) ||
    !isNonNegativeInteger(value.crewCapacity)
  ) {
    return null;
  }
  const powerGeneration = value.powerGeneration === undefined ? 0 : value.powerGeneration as number;
  if (value.category !== 'ENERGY' && powerGeneration > 0) return null;
  return {
    schemaVersion: 1,
    id: value.id,
    displayName: value.displayName.trim(),
    category: value.category,
    width: value.width,
    height: value.height,
    maxLevel: value.maxLevel,
    maxHp: value.maxHp,
    minPower: value.minPower,
    maxPower: value.maxPower,
    powerGeneration,
    crewCapacity: value.crewCapacity,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
