import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import {
  isPrototypeSceneNodeName,
  prototypeSceneNodeName,
  type PrototypeSceneNodeKey,
} from './prototype-scene-names';

export interface SkeletonResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * 创建或补齐 R0 PrototypeScene 的语义节点。
 * 只添加缺失内容，发现冲突时停止，不删除或移动设计人员已有节点。
 */
export async function initializePrototypeScene(scene: SceneQueryPort): Promise<SkeletonResult> {
  const initialTree = await scene.queryNodeTree();
  if (typeof initialTree.uuid !== 'string') {
    return { ok: false, message: '无法获取当前场景根节点 UUID' };
  }

  const root = cloneNode(initialTree);
  const createdNodes: string[] = [];
  try {
    const componentClasses = scene.queryComponents === undefined
      ? []
      : await scene.queryComponents();
    const mainCamera = await ensureChild(scene, root, 'mainCamera', createdNodes);
    const canvas = await ensureChild(scene, root, 'canvas', createdNodes);
    const appRoot = await ensureChild(scene, root, 'appRoot', createdNodes);
    await ensureComponent(scene, mainCamera.node, 'cc.Camera', componentClasses);
    await ensureComponents(scene, canvas.node, ['cc.Canvas', 'cc.UITransform', 'cc.Widget'], componentClasses);

    const background = await ensureChild(scene, canvas.node, 'background', createdNodes);
    const worldRoot = await ensureChild(scene, canvas.node, 'worldRoot', createdNodes);
    const uiRoot = await ensureChild(scene, canvas.node, 'uiRoot', createdNodes);
    void background;
    void uiRoot;
    const shipRoot = await ensureChild(scene, worldRoot.node, 'shipRoot', createdNodes);
    const gridRoot = await ensureChild(scene, shipRoot.node, 'gridRoot', createdNodes);
    await ensureChild(scene, shipRoot.node, 'roomRoot', createdNodes);
    await ensureChild(scene, shipRoot.node, 'previewRoot', createdNodes);
    await ensureComponents(scene, gridRoot.node, ['cc.UITransform', 'cc.Graphics'], componentClasses);
    await ensureComponents(scene, appRoot.node, ['CameraController', 'PrototypeSceneSettings', 'PrototypeBootstrap'], componentClasses);

    const refreshed = await waitForSkeletonState(scene, componentClasses);
    const refreshedGridRoot = findNodeByName(refreshed, 'gridRoot');
    const settingsComponent = findComponentByType(refreshed, 'PrototypeSceneSettings', componentClasses);
    const settingsTarget = getSceneComponentTarget(settingsComponent);
    if (refreshedGridRoot?.uuid === undefined || settingsTarget === undefined) {
      throw new Error('标准场景组件创建后无法获取 GridRoot 或 SceneSettings UUID');
    }
    if (!(await scene.setProperty(settingsTarget, 'gridRoot', { type: 'cc.Node', uuid: refreshedGridRoot.uuid }))) {
      throw new Error('无法把 GridRoot 写入 SceneSettings 的节点引用');
    }

    await scene.snapshot();
    selectNode(refreshed.uuid ?? root.uuid ?? '');
    await focusNode(refreshed.uuid ?? root.uuid ?? '');
    return { ok: true, message: 'Prototype 场景骨架已创建或补齐' };
  } catch (error) {
    for (const uuid of createdNodes.reverse()) {
      await scene.removeNode(uuid).catch(() => undefined);
    }
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(error)}；已回滚本次创建的场景节点` };
  }
}

interface MutableNode extends SceneNodeTree {
  children: MutableNode[];
}

async function ensureChild(
  scene: SceneQueryPort,
  parent: MutableNode,
  key: PrototypeSceneNodeKey,
  createdNodes: string[],
): Promise<{ readonly uuid: string; readonly node: MutableNode }> {
  const displayName = prototypeSceneNodeName(key);
  const matches = parent.children.filter((child) => isPrototypeSceneNodeName(child.name, key));
  if (matches.length > 1) throw new Error(`节点 ${displayName} 在同一父节点下重复，无法安全修复`);
  if (matches.length === 1) {
    if (matches[0].uuid === undefined) throw new Error(`节点 ${displayName} 缺少 UUID，无法安全复用`);
    return { uuid: matches[0].uuid, node: matches[0] };
  }
  if (parent.uuid === undefined) throw new Error(`父节点缺少 UUID，无法创建 ${displayName}`);
  const created = await scene.createNode({ parent: parent.uuid, name: displayName });
  if (created?.uuid === undefined) throw new Error(`创建节点失败：${displayName}`);
  // Cocos 的 scene/create-node 会为 2D 节点自动挂载 UITransform；本地镜像也要
  // 记录这个公开创建副作用，否则后续 ensureComponents 会重复调用
  // create-component，并让 Creator 报错后回滚整个骨架操作。
  const node: MutableNode = {
    uuid: created.uuid,
    name: displayName,
    children: [],
    components: [{ type: 'cc.UITransform', nodeUuid: created.uuid, index: 0 }],
  };
  parent.children.push(node);
  createdNodes.push(created.uuid);
  return { uuid: created.uuid, node };
}

async function ensureComponents(
  scene: SceneQueryPort,
  node: string | MutableNode,
  components: readonly string[],
  componentClasses: readonly SceneComponentClassInfo[],
): Promise<void> {
  for (const component of components) await ensureComponent(scene, node, component, componentClasses);
}

async function ensureComponent(
  scene: SceneQueryPort,
  node: string | MutableNode,
  component: string,
  componentClasses: readonly SceneComponentClassInfo[],
): Promise<void> {
  const nodeUuid = typeof node === 'string' ? node : node.uuid;
  if (nodeUuid === undefined) throw new Error(`节点缺少 UUID，无法挂载 ${component}`);
  if (typeof node !== 'string') {
    const existing = node.components?.some((item) => componentTypeMatches(item, component, componentClasses));
    if (existing) return;
  }
  await scene.createComponent(nodeUuid, component);
}

function cloneNode(node: SceneNodeTree): MutableNode {
  const nodeUuid = node.uuid;
  return {
    ...node,
    children: (node.children ?? []).map(cloneNode),
    components: (node.components ?? []).map((component, index) => ({
      ...component,
      nodeUuid: component.nodeUuid ?? nodeUuid,
      index: component.index ?? index,
    })),
  };
}

function findNodeByName(tree: SceneNodeTree, key: PrototypeSceneNodeKey): SceneNodeTree | null {
  if (isPrototypeSceneNodeName(tree.name, key)) return tree;
  for (const child of tree.children ?? []) {
    const match = findNodeByName(child, key);
    if (match !== null) return match;
  }
  return null;
}

function findComponentByType(
  tree: SceneNodeTree,
  type: string,
  componentClasses: readonly SceneComponentClassInfo[],
): SceneComponentInfo | null {
  for (const [index, component] of (tree.components ?? []).entries()) {
    const candidate = {
      ...component,
      nodeUuid: component.nodeUuid ?? tree.uuid,
      index: component.index ?? index,
    };
    if (componentTypeMatches(candidate, type, componentClasses)) return candidate;
  }
  for (const child of tree.children ?? []) {
    const match = findComponentByType(child, type, componentClasses);
    if (match !== null) return match;
  }
  return null;
}

/** 脚本首次挂载后需要等 Creator 完成一次场景树刷新，再读取组件 cid。 */
async function waitForSkeletonState(
  scene: SceneQueryPort,
  componentClasses: readonly SceneComponentClassInfo[],
): Promise<SceneNodeTree> {
  let latest = await scene.queryNodeTree();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (
      findNodeByName(latest, 'gridRoot')?.uuid !== undefined &&
      getSceneComponentTarget(findComponentByType(latest, 'PrototypeSceneSettings', componentClasses)) !== undefined
    ) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    latest = await scene.queryNodeTree();
  }
  return latest;
}

function selectNode(uuid: string): void {
  if (uuid.length === 0) return;
  const selection = (globalThis as { Editor?: { Selection?: { select?: (type: string, uuid: string) => void } } }).Editor?.Selection;
  selection?.select?.('node', uuid);
}

async function focusNode(uuid: string): Promise<void> {
  if (uuid.length === 0) return;
  await (globalThis as { Editor?: { Message?: { request?: (...args: unknown[]) => Promise<unknown> } } }).Editor?.Message?.request?.(
    'scene',
    'focus-camera',
    [uuid],
  );
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
