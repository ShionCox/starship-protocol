import {
  componentTypeMatches,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import { isPrototypeSceneNodeName } from './prototype-scene-names';

/** 用公开 Scene API 补齐持久“船员层”和中文船员状态面板。 */
export async function configureR1CrewScene(scene: SceneQueryPort): Promise<{ readonly ok: boolean; readonly message: string }> {
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
  let tree = await scene.queryNodeTree();
  const shipRoot = findUnique(tree, (node) => isPrototypeSceneNodeName(node.name, 'shipRoot'));
  const uiRoot = findUnique(tree, (node) => isPrototypeSceneNodeName(node.name, 'uiRoot'));
  if (tree.uuid === undefined || shipRoot?.uuid === undefined || uiRoot?.uuid === undefined) return { ok: false, message: '场景缺少唯一飞船根或界面根，请先补齐标准场景骨架' };
  const createdNodes: string[] = [];
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(tree.uuid);
    await ensureChild(scene, shipRoot, '船员层', createdNodes);
    const hud = await ensureChild(scene, uiRoot, 'HUD层', createdNodes);
    const panelNode = await ensureChild(scene, hud, '船员状态面板', createdNodes);
    let component = findComponent(panelNode, 'CrewStatusPanel', classes);
    if (component === null) {
      await scene.createComponent(panelNode.uuid as string, 'CrewStatusPanel');
      tree = await waitForComponent(scene, panelNode.uuid as string, 'CrewStatusPanel', classes);
      component = findComponent(findNode(tree, panelNode.uuid as string), 'CrewStatusPanel', classes);
    }
    const componentUuid = getSceneComponentUuid(component);
    if (componentUuid === undefined) throw new Error('船员状态面板缺少可调用组件');
    if (await scene.executeComponentMethod(componentUuid, 'ensureAuthoringStructure', []) !== true) throw new Error('船员状态面板未能创建持久中文控件');
    await scene.endRecording(undoId);
    undoId = null;
    return { ok: true, message: '已持久化船员层、HUD层和船员状态面板' };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    for (const uuid of createdNodes.reverse()) await scene.removeNode(uuid).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；已回滚本次船员场景节点` };
  }
}

async function ensureChild(scene: SceneQueryPort, parent: SceneNodeTree, name: string, created: string[]): Promise<SceneNodeTree> {
  const matches = (parent.children ?? []).filter((child) => child.name === name);
  if (matches.length > 1) throw new Error(`${name} 节点重复，无法安全补齐`);
  if (matches.length === 1) return matches[0];
  if (parent.uuid === undefined) throw new Error(`${name} 的父节点缺少 UUID`);
  const node = await scene.createNode({ parent: parent.uuid, name, position: { x: 0, y: 0, z: 0 } });
  if (node?.uuid === undefined) throw new Error(`创建 ${name} 失败`);
  created.push(node.uuid);
  return { uuid: node.uuid, name, parent: parent.uuid, children: [], components: [] };
}
async function waitForComponent(scene: SceneQueryPort, nodeUuid: string, type: string, classes: readonly SceneComponentClassInfo[]): Promise<SceneNodeTree> {
  let tree = await scene.queryNodeTree();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (findComponent(findNode(tree, nodeUuid), type, classes) !== null) return tree;
    await new Promise((resolve) => setTimeout(resolve, 50));
    tree = await scene.queryNodeTree();
  }
  return tree;
}
function findComponent(node: SceneNodeTree | null, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentInfo | null {
  if (node === null) return null;
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
}
function flatten(tree: SceneNodeTree): SceneNodeTree[] { return [tree, ...(tree.children ?? []).flatMap(flatten)]; }
function findUnique(tree: SceneNodeTree, predicate: (node: SceneNodeTree) => boolean): SceneNodeTree | null { const matches = flatten(tree).filter(predicate); return matches.length === 1 ? matches[0] : null; }
function findNode(tree: SceneNodeTree, uuid: string): SceneNodeTree | null { return flatten(tree).find((node) => node.uuid === uuid) ?? null; }
