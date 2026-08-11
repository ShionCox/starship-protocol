import {
  componentTypeMatches,
  getSceneComponentTarget,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import { isPrototypeSceneNodeName } from './prototype-scene-names';

export interface R1EnergyAuthoringResult {
  readonly ok: boolean;
  readonly message: string;
}

const APPEARANCES = {
  'room-laser': {
    fillColor: { r: 170, g: 45, b: 55, a: 245 },
    borderColor: { r: 255, g: 105, b: 115, a: 255 },
    coreColor: { r: 255, g: 190, b: 195, a: 255 },
  },
  'room-shield': {
    fillColor: { r: 25, g: 120, b: 145, a: 245 },
    borderColor: { r: 92, g: 225, b: 240, a: 255 },
    coreColor: { r: 180, g: 250, b: 255, a: 255 },
  },
} as const;

/** 用公开 Scene API 把 R1 能源 HUD 和消费者房间外观写入当前场景。 */
export async function configureR1EnergyScene(scene: SceneQueryPort): Promise<R1EnergyAuthoringResult> {
  const componentClasses = scene.queryComponents === undefined
    ? []
    : await scene.queryComponents().catch(() => []);
  let tree = await scene.queryNodeTree();
  const uiRoot = findUniqueNode(tree, (node) => isPrototypeSceneNodeName(node.name, 'uiRoot'));
  if (tree.uuid === undefined || uiRoot === null || uiRoot.uuid === undefined) {
    return { ok: false, message: '场景缺少唯一界面根，请先补齐标准场景骨架' };
  }

  const roomViews = await collectRoomViews(scene, tree, componentClasses);
  for (const definitionId of Object.keys(APPEARANCES) as (keyof typeof APPEARANCES)[]) {
    const matches = roomViews.filter((room) => room.definitionId === definitionId);
    if (matches.length !== 1) {
      return { ok: false, message: `场景必须恰好包含一个 ${definitionId} 实例，当前为 ${matches.length} 个` };
    }
  }

  const createdNodes: string[] = [];
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(tree.uuid);
    const hud = await ensureChild(scene, uiRoot, 'HUD层', createdNodes);
    const panelNode = await ensureChild(scene, hud, '能源面板', createdNodes);
    let panelComponent = findComponent(panelNode, 'PowerPanel', componentClasses);
    if (panelComponent === null) {
      await scene.createComponent(panelNode.uuid as string, 'PowerPanel');
      tree = await waitForComponent(scene, panelNode.uuid as string, 'PowerPanel', componentClasses);
      panelComponent = findComponent(findNode(tree, panelNode.uuid as string), 'PowerPanel', componentClasses);
    }
    const panelUuid = getSceneComponentUuid(panelComponent);
    if (panelUuid === undefined) throw new Error('能源面板缺少可调用的 PowerPanel 组件');
    if (await scene.executeComponentMethod(panelUuid, 'ensureAuthoringStructure', []) !== true) {
      throw new Error('PowerPanel 未能创建持久化能源控件');
    }

    for (const [definitionId, appearance] of Object.entries(APPEARANCES)) {
      const room = roomViews.find((item) => item.definitionId === definitionId);
      if (room === undefined) {
        throw new Error(`无法写入 ${definitionId} 的房间外观`);
      }
      for (const [propertyName, color] of Object.entries(appearance)) {
        if (!(await scene.setProperty(room.target, propertyName, { type: 'cc.Color', value: color }, { record: false }))) {
          throw new Error(`无法写入 ${definitionId} 的${propertyName}`);
        }
      }
    }
    await scene.endRecording(undoId);
    undoId = null;
    return { ok: true, message: '已持久化能源面板、两条房间能源行，并应用激光红色与护盾青蓝色外观' };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    for (const uuid of createdNodes.reverse()) await scene.removeNode(uuid).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚本次新建的能源界面节点` };
  }
}

async function collectRoomViews(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  classes: readonly SceneComponentClassInfo[],
): Promise<readonly { readonly componentUuid: string; readonly target: SceneComponentTarget; readonly definitionId: string }[]> {
  const result: { componentUuid: string; target: SceneComponentTarget; definitionId: string }[] = [];
  for (const node of flattenTree(tree)) {
    const component = findComponent(node, 'RoomView', classes);
    const componentUuid = getSceneComponentUuid(component);
    const target = getSceneComponentTarget(component);
    if (componentUuid === undefined || target === undefined) continue;
    const dump = await scene.queryComponent(componentUuid);
    const definitionId = readString(dump?.value?.roomDefinitionId);
    if (definitionId !== undefined) result.push({ componentUuid, target, definitionId });
  }
  return result;
}

async function ensureChild(
  scene: SceneQueryPort,
  parent: SceneNodeTree,
  name: string,
  createdNodes: string[],
): Promise<SceneNodeTree> {
  const matches = (parent.children ?? []).filter((child) => child.name === name);
  if (matches.length > 1) throw new Error(`${name} 节点重复，无法安全补齐`);
  if (matches.length === 1) return matches[0];
  if (parent.uuid === undefined) throw new Error(`${name} 的父节点缺少 UUID`);
  const created = await scene.createNode({ parent: parent.uuid, name, position: { x: 0, y: 0, z: 0 } });
  if (created?.uuid === undefined) throw new Error(`创建 ${name} 失败`);
  createdNodes.push(created.uuid);
  const node = { uuid: created.uuid, name, parent: parent.uuid, children: [], components: [] };
  return node;
}

async function waitForComponent(
  scene: SceneQueryPort,
  nodeUuid: string,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): Promise<SceneNodeTree> {
  let tree = await scene.queryNodeTree();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (findComponent(findNode(tree, nodeUuid), type, classes) !== null) return tree;
    await new Promise((resolve) => setTimeout(resolve, 50));
    tree = await scene.queryNodeTree();
  }
  return tree;
}

function findComponent(
  node: SceneNodeTree | null,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): SceneComponentInfo | null {
  if (node === null) return null;
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
}

function findUniqueNode(tree: SceneNodeTree, predicate: (node: SceneNodeTree) => boolean): SceneNodeTree | null {
  const matches = flattenTree(tree).filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function findNode(tree: SceneNodeTree, uuid: string): SceneNodeTree | null {
  return flattenTree(tree).find((node) => node.uuid === uuid) ?? null;
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  return [tree, ...(tree.children ?? []).flatMap(flattenTree)];
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value !== 'object' || value === null) return undefined;
  return readString((value as { value?: unknown }).value);
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
