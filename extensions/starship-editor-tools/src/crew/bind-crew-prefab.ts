import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

/** 打开新船员 Prefab 后通过公开 Scene API 绑定 JSON、稳定 ID 并保存。 */
export async function bindCrewDefinitionToOpenPrefab(
  scene: SceneQueryPort,
  configUuid: string,
  definitionId: string,
  role: 'ENGINEER' | 'GUNNER' = 'ENGINEER',
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const target = await waitForCrewView(scene);
  if (target === null) return { ok: false, message: '新 Prefab 中没有可绑定的 CrewView 组件' };
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(target.nodeUuid);
    if (!(await scene.setProperty(target, 'definitionAsset', { type: 'cc.JsonAsset', uuid: configUuid }, { record: false }))) throw new Error('无法写入船员定义 JSON');
    if (!(await scene.setProperty(target, 'crewDefinitionId', definitionId, { record: false }))) throw new Error('无法同步船员定义 ID');
    if (!(await scene.setProperty(target, 'crewInstanceId', `${definitionId}-1`, { record: false }))) throw new Error('无法同步默认船员实例 ID');
    const colors = role === 'GUNNER'
      ? { body: { r: 224, g: 82, b: 55, a: 255 }, border: { r: 255, g: 174, b: 122, a: 255 } }
      : { body: { r: 36, g: 184, b: 155, a: 255 }, border: { r: 175, g: 255, b: 235, a: 255 } };
    if (!(await scene.setProperty(target, 'bodyColor', { type: 'cc.Color', value: colors.body }, { record: false }))) throw new Error('无法写入船员主体颜色');
    if (!(await scene.setProperty(target, 'borderColor', { type: 'cc.Color', value: colors.border }, { record: false }))) throw new Error('无法写入船员边框颜色');
    if (!(await scene.setProperty(target, 'selectedOutlineColor', { type: 'cc.Color', value: { r: 255, g: 220, b: 70, a: 255 } }, { record: false }))) throw new Error('无法写入选中描边颜色');
    const validation = await scene.executeComponentMethod(target.uuid, 'validateAuthoringDefinition', []) as { readonly ok?: boolean; readonly message?: string };
    if (validation?.ok !== true) throw new Error(validation?.message ?? '船员预制体校验失败');
    await scene.endRecording(undoId);
    undoId = null;
    await Editor.Message.request('scene', 'save-scene');
    return { ok: true, message: '预制体已自动绑定船员定义并保存' };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；已取消船员预制体绑定` };
  }
}

async function waitForCrewView(scene: SceneQueryPort): Promise<SceneComponentTarget | null> {
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const target = findCrewViewTarget(await scene.queryNodeTree(), classes);
    if (target !== null) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function findCrewViewTarget(tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget | null {
  for (const [index, component] of (tree.components ?? []).entries()) {
    const candidate: SceneComponentInfo = { ...component, nodeUuid: component.nodeUuid ?? tree.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, 'CrewView', classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  for (const child of tree.children ?? []) {
    const found = findCrewViewTarget(child, classes);
    if (found !== null) return found;
  }
  return null;
}
