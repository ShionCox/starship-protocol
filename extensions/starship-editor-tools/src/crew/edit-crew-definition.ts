import { CREW_CONFIG_DIRECTORY } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { parseCrewDefinition, type CrewDefinitionDocument } from './discover-crew-prefabs';

export interface CrewDefinitionEditRequest {
  readonly configUrl: string;
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
}

export async function updateCrewDefinition(
  request: CrewDefinitionEditRequest,
  assetDb: AssetDbPort,
): Promise<{ readonly ok: boolean; readonly message: string; readonly document?: CrewDefinitionDocument }> {
  if (!request.configUrl.startsWith(`${CREW_CONFIG_DIRECTORY}/`) || request.configUrl.includes('..') || !request.configUrl.endsWith(`/${request.id}.json`)) {
    return { ok: false, message: '只能编辑 assets/config/crew 下与稳定 ID 对应的 JSON' };
  }
  try {
    const current = parseCrewDefinition(JSON.parse(await assetDb.readFile(request.configUrl)));
    if (current === null || current.id !== request.id) return { ok: false, message: '船员定义已失效或稳定 ID 不匹配，请刷新列表' };
    const document = parseCrewDefinition({ schemaVersion: 1, id: request.id, displayName: request.displayName, role: request.role, maxHp: request.maxHp, moveTicksPerEdge: request.moveTicksPerEdge });
    if (document === null) return { ok: false, message: '船员属性不合法，请检查中文名称、职业、生命和移动耗时' };
    if (await assetDb.saveAsset(request.configUrl, `${JSON.stringify(document, null, 2)}\n`) === null) return { ok: false, message: '保存船员定义失败' };
    return { ok: true, document, message: `已保存 ${document.displayName} 的船员属性` };
  } catch (cause) {
    return { ok: false, message: `保存船员定义失败：${cause instanceof Error ? cause.message : String(cause)}` };
  }
}
