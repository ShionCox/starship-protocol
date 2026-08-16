import {
  componentTypeMatches,
  getSceneComponentTarget,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

export interface RoomAuthoringValidation { readonly ok: boolean; readonly message: string; }

/** 使用公开 Scene 查询消息校验当前编辑上下文中的 RoomView。 */
export async function validateOpenRoomPrefab(scene: SceneQueryPort): Promise<RoomAuthoringValidation> {
  const tree = await scene.queryNodeTree();
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  const uuids = findRoomComponentUuids(tree, classes);
  if (uuids.length === 0) return { ok: false, message: '当前编辑内容中没有 RoomView；请先打开要校验的房间 Prefab' };
  const results = await Promise.all(uuids.map((uuid) => scene.validateRoomComponent(uuid)));
  const failures = results.filter((result) => !result.ok);
  return failures.length === 0
    ? { ok: true, message: `校验通过：${results.map((result) => result.message).join('；')}` }
    : { ok: false, message: failures.map((result) => result.message).join('；') };
}

export function findRoomComponentUuids(tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[] = []): string[] {
  const result: string[] = [];
  visit(tree, result, classes);
  return result;
}

export function findRoomComponentTargets(tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[] = []): SceneComponentTarget[] {
  const result: SceneComponentTarget[] = [];
  visitTargets(tree, result, classes);
  return result;
}

function visitTargets(node: SceneNodeTree, result: SceneComponentTarget[], classes: readonly SceneComponentClassInfo[]): void {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (!componentTypeMatches(candidate, 'RoomView', classes)) continue;
    const target = getSceneComponentTarget(candidate);
    if (target !== undefined) result.push(target);
  }
  for (const child of node.children ?? []) visitTargets(child, result, classes);
}

function visit(node: SceneNodeTree, result: string[], classes: readonly SceneComponentClassInfo[]): void {
  for (const [index, component] of (node.components ?? []).entries()) {
    const uuid = getSceneComponentUuid(component);
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, 'RoomView', classes) && uuid !== undefined) result.push(uuid);
  }
  for (const child of node.children ?? []) visit(child, result, classes);
}
