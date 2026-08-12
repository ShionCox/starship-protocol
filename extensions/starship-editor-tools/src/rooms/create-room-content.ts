import { ROOM_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { describeRollback, rollbackCreatedAssets } from '../shared/rollback-assets';

export const ROOM_CATEGORIES = [
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
] as const;

export interface RoomCreationRequest {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly width: number;
  readonly height: number;
  readonly maxLevel: number;
  readonly maxHp: number;
  readonly minPower: number;
  readonly maxPower: number;
  readonly powerGeneration?: number;
  readonly crewCapacity: number;
  readonly prefabName: string;
  readonly templateUrl: string;
  readonly targetDirectory: string;
}

export type RoomCreationResult =
  | {
    readonly ok: true;
    readonly configUrl: string;
    readonly prefabUrl: string;
    readonly message: string;
  }
  | { readonly ok: false; readonly message: string };

const ROOM_ID_PATTERN = /^room-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PREFAB_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const PREFAB_ROOT = 'db://assets/prefabs';
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  ENERGY: '能源',
  WEAPON: '武器',
  DEFENSE: '防御',
  MOBILITY: '机动',
  SUPPORT: '支援',
  MOVEMENT: '移动',
  TACTICAL: '战术',
  DRONE: '无人机',
  ECONOMY: '经济',
  SPECIAL: '特殊',
};

/**
 * 创建房间 JSON 与 Prefab 副本。
 *
 * 资源写入只通过 Asset DB；第二步失败会删除第一步产物，避免留下半套内容。
 */
export async function createRoomContent(
  request: RoomCreationRequest,
  assetDb: AssetDbPort,
): Promise<RoomCreationResult> {
  const validationMessage = validateRequest(request);
  if (validationMessage !== null) {
    return { ok: false, message: validationMessage };
  }

  const targetDirectory = request.targetDirectory.replace(/\/$/, '');
  const powerGeneration = request.powerGeneration ?? 0;
  const configUrl = `${ROOM_CONFIG_DIRECTORY}/${request.id}.json`;
  const prefabUrl = `${targetDirectory}/${request.prefabName}.prefab`;

  try {
    if (!(await assetDb.queryUuid(request.templateUrl))) {
      return { ok: false, message: `模板预制体不存在：${request.templateUrl}` };
    }
    if (await assetDb.queryUuid(configUrl)) {
      return { ok: false, message: `房间定义已存在：${configUrl}` };
    }
    if (await assetDb.queryUuid(prefabUrl)) {
      return { ok: false, message: `目标预制体已存在：${prefabUrl}` };
    }

    const document = {
      schemaVersion: 1,
      id: request.id,
      displayName: request.displayName.trim(),
      category: request.category,
      width: request.width,
      height: request.height,
      maxLevel: request.maxLevel,
      maxHp: request.maxHp,
      minPower: request.minPower,
      maxPower: request.maxPower,
      powerGeneration,
      crewCapacity: request.crewCapacity,
    };
    const createdConfig = await assetDb.createAsset(configUrl, `${JSON.stringify(document, null, 2)}\n`);
    if (createdConfig === null) {
      return { ok: false, message: `创建房间定义失败：${configUrl}` };
    }

    try {
      const createdPrefab = await assetDb.copyAsset(request.templateUrl, prefabUrl);
      if (createdPrefab === null) {
        throw new Error(`复制预制体失败：${prefabUrl}`);
      }
    } catch (copyError) {
      const rollbackErrors = await rollbackCreatedAssets(assetDb, [prefabUrl, configUrl]);
      return { ok: false, message: `${toMessage(copyError)}；${describeRollback(rollbackErrors)}` };
    }

    return {
      ok: true,
      configUrl,
      prefabUrl,
      message: '房间定义 JSON 和 Prefab 已创建，正在自动绑定房间定义。',
    };
  } catch (cause) {
    return { ok: false, message: `创建房间建筑失败：${toMessage(cause)}` };
  }
}

function validateRequest(request: RoomCreationRequest): string | null {
  if (!ROOM_ID_PATTERN.test(request.id)) {
    return '房间标识必须使用 room- 开头的小写短横线格式';
  }
  if (request.displayName.trim().length === 0) {
    return '中文名称不能为空';
  }
  if (!(ROOM_CATEGORIES as readonly string[]).includes(request.category)) {
    return `未知房间分类：${CATEGORY_LABELS[request.category] ?? request.category}`;
  }
  if (!PREFAB_NAME_PATTERN.test(request.prefabName)) {
    return '预制体名称必须使用大写开头格式，且只能包含英文字母和数字';
  }
  if (!isPrefabUrl(request.templateUrl)) {
    return '模板必须是 assets/prefabs 下的预制体';
  }
  if (!isPrefabDirectory(request.targetDirectory)) {
    return '目标目录必须位于 assets/prefabs 下';
  }
  if (!isPositiveInteger(request.width) || !isPositiveInteger(request.height)) {
    return '网格宽度和高度必须是正整数';
  }
  if (!isPositiveInteger(request.maxLevel) || !isPositiveInteger(request.maxHp)) {
    return '最高等级和最大耐久必须是正整数';
  }
  if (
    !isNonNegativeInteger(request.minPower) ||
    !isNonNegativeInteger(request.maxPower) ||
    request.minPower > request.maxPower
  ) {
    return '能源范围必须是非负整数，且最低能源不能大于最高能源';
  }
  if (request.powerGeneration !== undefined && !isNonNegativeInteger(request.powerGeneration)) {
    return '能源产能必须是非负整数';
  }
  if (request.category !== 'ENERGY' && (request.powerGeneration ?? 0) > 0) {
    return `“${CATEGORY_LABELS[request.category] ?? request.category}”房间的能源产能必须为 0`;
  }
  if (!isNonNegativeInteger(request.crewCapacity)) {
    return '船员容量必须是非负整数';
  }
  return null;
}

function isPrefabDirectory(url: string): boolean {
  return !url.includes('..') && (url === PREFAB_ROOT || url.startsWith(`${PREFAB_ROOT}/`));
}

function isPrefabUrl(url: string): boolean {
  return isPrefabDirectory(url.slice(0, url.lastIndexOf('/'))) && url.endsWith('.prefab');
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
