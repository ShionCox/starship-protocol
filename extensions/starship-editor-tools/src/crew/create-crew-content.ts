import { CREW_CONFIG_DIRECTORY, DEFAULT_PREFAB_DIRECTORY } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';

export interface CrewCreationRequest {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  readonly maxHp: number;
  readonly moveTicksPerEdge: number;
  readonly prefabName: string;
  readonly templateUrl: string;
  readonly targetDirectory: string;
}

export type CrewCreationResult =
  | { readonly ok: true; readonly configUrl: string; readonly prefabUrl: string; readonly message: string }
  | { readonly ok: false; readonly message: string };

/**
 * 按资源逐项清理一次创建事务的产物。
 *
 * 删除一个资源失败时仍继续删除其他资源；否则前一个失败会把后续资源留在
 * Asset DB 中，调用方也无法知道实际残留了哪一个路径。
 */
export async function rollbackCrewAssets(
  assetDb: Pick<AssetDbPort, 'deleteAsset'>,
  urls: readonly string[],
): Promise<readonly string[]> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const deleted = await assetDb.deleteAsset(url);
      if (deleted === null || deleted === undefined) {
        errors.push(`${url}：Asset DB 未确认删除资源`);
      }
    } catch (cause) {
      errors.push(`${url}：${toMessage(cause)}`);
    }
  }
  return errors;
}

const CREW_ID_PATTERN = /^crew-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PREFAB_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const ROLES = new Set(['ENGINEER', 'GUNNER']);

/** 使用 Asset DB 原子创建船员 JSON 与 Prefab 副本，失败时清理本次事务产物。 */
export async function createCrewContent(request: CrewCreationRequest, assetDb: AssetDbPort): Promise<CrewCreationResult> {
  const validation = validateCrewCreation(request);
  if (validation !== null) return { ok: false, message: validation };
  const targetDirectory = request.targetDirectory.replace(/\/$/, '');
  const configUrl = `${CREW_CONFIG_DIRECTORY}/${request.id}.json`;
  const prefabUrl = `${targetDirectory}/${request.prefabName}.prefab`;
  try {
    if (!(await assetDb.queryUuid(request.templateUrl))) return { ok: false, message: `船员模板预制体不存在：${request.templateUrl}` };
    if (await assetDb.queryUuid(configUrl)) return { ok: false, message: `船员定义已存在：${configUrl}` };
    if (await assetDb.queryUuid(prefabUrl)) return { ok: false, message: `目标预制体已存在：${prefabUrl}` };
    const document = { schemaVersion: 1, id: request.id, displayName: request.displayName.trim(), role: request.role, maxHp: request.maxHp, moveTicksPerEdge: request.moveTicksPerEdge };
    if (await assetDb.createAsset(configUrl, `${JSON.stringify(document, null, 2)}\n`) === null) return { ok: false, message: `创建船员定义失败：${configUrl}` };
    try {
      if (await assetDb.copyAsset(request.templateUrl, prefabUrl) === null) throw new Error(`复制船员预制体失败：${prefabUrl}`);
    } catch (cause) {
      const rollbackErrors = await rollbackCrewAssets(assetDb, [prefabUrl, configUrl]);
      const rollbackMessage = rollbackErrors.length === 0
        ? '已回滚新资源'
        : `回滚失败，资源清理未完成，无法确认以下资源已删除：${rollbackErrors.join('；')}`;
      return { ok: false, message: `${toMessage(cause)}；${rollbackMessage}` };
    }
    return { ok: true, configUrl, prefabUrl, message: '船员定义 JSON 和 Prefab 已创建，正在自动绑定船员定义。' };
  } catch (cause) {
    return { ok: false, message: `创建船员资源失败：${toMessage(cause)}` };
  }
}

function validateCrewCreation(request: CrewCreationRequest): string | null {
  if (!CREW_ID_PATTERN.test(request.id)) return '船员标识必须使用 crew- 开头的小写短横线格式';
  if (request.displayName.trim() === '') return '船员中文名称不能为空';
  if (!ROLES.has(request.role)) return `未知船员职业：${request.role}`;
  if (!Number.isInteger(request.maxHp) || request.maxHp <= 0) return '最大生命必须是正整数';
  if (!Number.isInteger(request.moveTicksPerEdge) || request.moveTicksPerEdge <= 0) return '每段移动耗时必须是正整数 Tick';
  if (!PREFAB_NAME_PATTERN.test(request.prefabName)) return '船员预制体名称必须大写开头且只包含英文字母和数字';
  if (!request.templateUrl.startsWith(`${DEFAULT_PREFAB_DIRECTORY}/`) || !request.templateUrl.endsWith('.prefab') || request.templateUrl.includes('..')) return '船员模板必须位于 assets/prefabs';
  if (!(request.targetDirectory === DEFAULT_PREFAB_DIRECTORY || request.targetDirectory.startsWith(`${DEFAULT_PREFAB_DIRECTORY}/`)) || request.targetDirectory.includes('..')) return '目标目录必须位于 assets/prefabs';
  return null;
}
function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
