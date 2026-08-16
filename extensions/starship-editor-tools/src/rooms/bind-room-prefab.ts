import { saveAuthoringScene, type SceneComponentTarget, type SceneQueryPort } from '../shared/editor-scene';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { loadRoomCsvDrafts, toRoomPreviewDto } from './room-csv-authoring';
import { findRoomComponentTargets } from './validate-open-room-prefab';

export interface RoomPrefabBindingResult {
  readonly ok: boolean;
  readonly message: string;
}

/** 打开新 Prefab 后写入稳定定义 ID，并用权威 CSV 生成一次内存预览后保存代表性外观。 */
export async function bindRoomDefinitionToOpenPrefab(
  scene: SceneQueryPort,
  assetDb: AssetDbPort,
  roomDefinitionId: string,
  healingHpPerTick = 0,
): Promise<RoomPrefabBindingResult> {
  const componentTarget = await waitForRoomView(scene);
  if (componentTarget === null) {
    return { ok: false, message: '新 Prefab 中没有可绑定的 RoomView 组件' };
  }
  if (!(await scene.setProperty(componentTarget, 'roomDefinitionId', roomDefinitionId))) {
    return { ok: false, message: '无法同步 RoomView 的房间定义 ID' };
  }
  // 医疗房间使用白绿外观；规则仍只来自 CSV，颜色仅是可在 Inspector 调整的表现默认值。
  if (healingHpPerTick > 0) {
    const colors = [
      ['fillColor', { r: 45, g: 123, b: 88, a: 245 }],
      ['borderColor', { r: 218, g: 255, b: 230, a: 255 }],
      ['coreColor', { r: 244, g: 255, b: 248, a: 255 }],
    ] as const;
    for (const [property, value] of colors) {
      if (!(await scene.setProperty(componentTarget, property, { type: 'cc.Color', value }))) {
        return { ok: false, message: `无法写入医疗房间外观：${property}` };
      }
    }
  }
  const loaded = await loadRoomCsvDrafts(assetDb);
  if (!loaded.ok || loaded.drafts === undefined) return { ok: false, message: loaded.message };
  const draft = loaded.drafts.find((entry) => entry.id === roomDefinitionId);
  if (draft === undefined) return { ok: false, message: `权威 CSV 中不存在房间定义：${roomDefinitionId}` };
  const preview = toRoomPreviewDto(draft);
  if (!preview.ok) return { ok: false, message: preview.message };
  if (await scene.executeComponentMethod(componentTarget.uuid, 'applyAuthoringDefinitionPreview', [preview.dto]) !== true) {
    return { ok: false, message: `房间内存预览应用失败：${roomDefinitionId}` };
  }
  const validation = await scene.validateRoomComponent(componentTarget.uuid);
  if (!validation.ok) return validation;
  await saveAuthoringScene();
  return { ok: true, message: 'Prefab 已写入房间定义并保存权威 CSV 内存预览外观' };
}

async function waitForRoomView(scene: SceneQueryPort): Promise<SceneComponentTarget | null> {
  const componentClasses = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tree = await scene.queryNodeTree();
    const components = findRoomComponentTargets(tree, componentClasses);
    if (components.length === 1) return components[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
