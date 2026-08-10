import type { SceneComponentTarget, SceneQueryPort } from '../shared/editor-scene';
import { findRoomComponentTargets } from './validate-open-room-prefab';

export interface RoomPrefabBindingResult {
  readonly ok: boolean;
  readonly message: string;
}

/** 打开新 Prefab 后用公开 Scene 消息绑定定义资产，并保存 Prefab。 */
export async function bindRoomDefinitionToOpenPrefab(
  scene: SceneQueryPort,
  configUuid: string,
  roomDefinitionId: string,
): Promise<RoomPrefabBindingResult> {
  const componentTarget = await waitForRoomView(scene);
  if (componentTarget === null) {
    return { ok: false, message: '新 Prefab 中没有可绑定的 RoomView 组件' };
  }
  if (!(await scene.setProperty(componentTarget, 'definitionAsset', { type: 'cc.JsonAsset', uuid: configUuid }))) {
    return { ok: false, message: '无法把房间定义 JSON 写入 RoomView' };
  }
  if (!(await scene.setProperty(componentTarget, 'roomDefinitionId', roomDefinitionId))) {
    return { ok: false, message: '无法同步 RoomView 的房间定义 ID' };
  }
  const validation = await scene.validateRoomComponent(componentTarget.uuid);
  if (!validation.ok) return validation;
  await Editor.Message.request('scene', 'save-scene');
  return { ok: true, message: 'Prefab 已自动绑定房间定义并保存' };
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
