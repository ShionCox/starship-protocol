import { ROOM_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import {
  parseRoomDefinition,
  type RoomDefinitionDocument,
} from './discover-room-prefabs';

/** 面板可直接编辑的规则字段；稳定 ID 和资源路径只读。 */
export interface RoomDefinitionEditRequest {
  readonly configUrl: string;
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
}

export type RoomDefinitionEditResult =
  | { readonly ok: true; readonly document: RoomDefinitionDocument; readonly message: string }
  | { readonly ok: false; readonly message: string };

/**
 * 通过公开 Asset DB 保存面板编辑结果。
 *
 * 先读取并校验当前资源，再保存完整文档，避免面板缓存覆盖设计人员刚刚在
 * Inspector 或其他窗口做的修改。ID 与路径不能在这里改名，改名必须走资源创建流程。
 */
export async function updateRoomDefinition(
  request: RoomDefinitionEditRequest,
  assetDb: AssetDbPort,
): Promise<RoomDefinitionEditResult> {
  const pathError = validateConfigPath(request.configUrl, request.id);
  if (pathError !== null) return { ok: false, message: pathError };

  let current: RoomDefinitionDocument;
  try {
    const parsedCurrent = parseRoomDefinition(JSON.parse(await assetDb.readFile(request.configUrl)));
    if (parsedCurrent === null) return { ok: false, message: '房间定义已失效或 JSON 校验失败，请先修复资源' };
    current = parsedCurrent;
  } catch (cause) {
    return { ok: false, message: `无法读取房间定义：${toMessage(cause)}` };
  }
  if (current.id !== request.id) {
    return { ok: false, message: '房间定义已失效或稳定 ID 不匹配，请刷新房间列表' };
  }

  const parsed = parseRoomDefinition({
    schemaVersion: current.schemaVersion,
    id: request.id,
    displayName: request.displayName,
    category: request.category,
    width: request.width,
    height: request.height,
    maxLevel: request.maxLevel,
    maxHp: request.maxHp,
    minPower: request.minPower,
    maxPower: request.maxPower,
    powerGeneration: request.powerGeneration ?? current.powerGeneration,
    crewCapacity: request.crewCapacity,
  });
  if (parsed === null) return { ok: false, message: '房间属性不合法，请检查名称、分类、尺寸和数值范围' };

  const document = {
    schemaVersion: parsed.schemaVersion,
    id: parsed.id,
    displayName: parsed.displayName,
    category: parsed.category,
    width: parsed.width,
    height: parsed.height,
    maxLevel: parsed.maxLevel,
    maxHp: parsed.maxHp,
    minPower: parsed.minPower,
    maxPower: parsed.maxPower,
    powerGeneration: parsed.powerGeneration,
    crewCapacity: parsed.crewCapacity,
  } satisfies RoomDefinitionDocument;

  try {
    const saved = await assetDb.saveAsset(request.configUrl, `${JSON.stringify(document, null, 2)}\n`);
    if (saved == null) return { ok: false, message: `保存房间定义失败：${request.configUrl}` };
  } catch (cause) {
    return { ok: false, message: `保存房间定义失败：${toMessage(cause)}` };
  }
  return { ok: true, document, message: `已保存 ${document.displayName} 的房间属性` };
}

function validateConfigPath(configUrl: string, id: string): string | null {
  if (
    typeof configUrl !== 'string' ||
    !configUrl.startsWith(`${ROOM_CONFIG_DIRECTORY}/`) ||
    configUrl.includes('..') ||
    !configUrl.endsWith(`/${id}.json`)
  ) {
    return '只能编辑 assets/config/rooms 下与稳定 ID 对应的 JSON';
  }
  return null;
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
