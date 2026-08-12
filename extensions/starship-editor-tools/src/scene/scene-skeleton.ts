import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import { sceneNodeName, type SceneNodeKey } from './scene-names';

export type SceneSkeletonKind = 'BOOT' | 'MAIN' | 'BATTLE';

export interface SkeletonResult { readonly ok: boolean; readonly message: string }

/** 为当前空场景补齐 BootScene、MainScene 或 BattleScene 的持久中文骨架。 */
export async function initializeSceneSkeleton(scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<SkeletonResult> {
  const tree = cloneNode(await scene.queryNodeTree());
  if (tree.uuid === undefined) return { ok: false, message: '无法获取当前场景根节点 UUID' };
  const createdNodes: string[] = [];
  try {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
    const camera = await ensureChild(scene, tree, 'mainCamera', createdNodes);
    const canvas = await ensureChild(scene, tree, 'canvas', createdNodes);
    const app = await ensureChild(scene, tree, 'appRoot', createdNodes);
    // Cocos 2D 渲染根必须位于 UI_2D 层；子世界节点可继续使用 DEFAULT 层。
    if (!(await scene.setProperty(canvas.uuid as string, '_layer', 33_554_432))) throw new Error('无法设置画布 UI_2D 层');
    await ensureComponent(scene, camera, 'cc.Camera', classes);
    const refreshedCamera = await waitForNodeComponent(scene, camera.uuid as string, 'cc.Camera', classes);
    if (refreshedCamera === undefined) throw new Error('主相机组件创建后不可编辑');
    if (!(await scene.setProperty(refreshedCamera, 'orthoHeight', 360))) throw new Error('无法设置主相机正交高度');
    if (!(await scene.setProperty(refreshedCamera, 'far', 2000))) throw new Error('无法设置主相机远裁剪面');
    if (!(await scene.setProperty(refreshedCamera, 'clearFlags', 7))) throw new Error('无法设置主相机清屏模式');
    // 正式相机同时渲染 DEFAULT 世界层和 UI_2D 层。
    if (!(await scene.setProperty(refreshedCamera, 'visibility', 1_107_296_256))) throw new Error('无法设置主相机可见层');
    await ensureComponents(scene, canvas, ['cc.Canvas', 'cc.UITransform', 'cc.Widget'], classes);
    const refreshedCanvas = await waitForNodeComponent(scene, canvas.uuid as string, 'cc.Canvas', classes);
    if (refreshedCanvas === undefined) throw new Error('画布组件创建后不可编辑');
    if (!(await scene.setProperty(refreshedCanvas, 'cameraComponent', { type: 'cc.Camera', uuid: refreshedCamera.uuid }))) {
      throw new Error('无法把画布绑定到主相机');
    }
    if (kind === 'BOOT') {
      await ensureComponent(scene, app, 'BootSceneBootstrap', classes);
    } else {
      // 世界表现和共享 UI 必须处于同一个主 Canvas 下；否则 Cocos 会为 ShipView 自动补出
      // 每船一套 Canvas/Camera，破坏场景级 UI 与多舰视图的隔离边界。
      const world = await ensureChild(scene, canvas, 'worldRoot', createdNodes);
      if (!(await scene.setProperty(world.uuid as string, '_layer', 33_554_432))) throw new Error('无法设置世界根 UI_2D 层');
      if (kind === 'MAIN') {
        const mount = await ensureChild(scene, world, 'currentShipMount', createdNodes);
        if (!(await scene.setProperty(mount.uuid as string, '_layer', 33_554_432))) throw new Error('无法设置当前飞船挂载点 UI_2D 层');
        await ensureComponents(scene, app, ['CameraController', 'MainSceneBootstrap'], classes);
      } else {
        for (const key of ['battleEnvironment', 'playerShipMount', 'enemyShipMount', 'projectileRoot', 'effectRoot'] as const) {
          const layer = await ensureChild(scene, world, key, createdNodes);
          if (!(await scene.setProperty(layer.uuid as string, '_layer', 33_554_432))) throw new Error(`无法设置“${layer.name}”UI_2D 层`);
        }
        // 战斗场景不允许残留主场景组件；组件删除由设计人员在 Inspector 中明确完成。
        if ((app.components ?? []).some((component) => componentTypeMatches(component, 'MainSceneBootstrap', classes))) {
          throw new Error('战斗场景“应用根”不能挂载主场景装配组件，请先在 Inspector 中删除');
        }
        if ((app.components ?? []).some((component) => componentTypeMatches(component, 'CameraController', classes))) {
          throw new Error('战斗场景“应用根”不能挂载镜头控制组件，请先在 Inspector 中删除');
        }
        await ensureComponent(scene, app, 'BattleSceneBootstrap', classes);
      }
    }
    const refreshed = await waitForComponents(scene, kind, classes);
    if (kind === 'MAIN') {
      const world = flattenTree(refreshed).find((node) => node.name === sceneNodeName('worldRoot'));
      if (world?.uuid === undefined) throw new Error('主场景缺少世界根节点');
      await wireCameraController(scene, refreshed, world.uuid, canvas.uuid as string, classes);
      const appNode = flattenTree(refreshed).find((node) => node.name === sceneNodeName('appRoot'));
      const bootstrap = appNode === undefined ? null : findComponent(appNode, 'MainSceneBootstrap', classes);
      const bootstrapUuid = bootstrap?.value ?? bootstrap?.uuid;
      if (bootstrapUuid === undefined) throw new Error('主场景装配组件创建后不可调用');
      const cameraResult = await scene.executeComponentMethod(bootstrapUuid, 'applyEditorCameraDefaults', []) as { readonly ok?: boolean; readonly message?: string };
      if (cameraResult?.ok !== true) throw new Error(cameraResult?.message ?? '无法校正主场景相机');
    } else if (kind === 'BATTLE') {
      const appNode = flattenTree(refreshed).find((node) => node.name === sceneNodeName('appRoot'));
      const bootstrap = appNode === undefined ? null : findComponent(appNode, 'BattleSceneBootstrap', classes);
      const bootstrapUuid = bootstrap?.value ?? bootstrap?.uuid;
      if (bootstrapUuid === undefined) throw new Error('战斗场景装配组件创建后不可调用');
      const cameraResult = await scene.executeComponentMethod(bootstrapUuid, 'applyEditorCameraDefaults', []) as { readonly ok?: boolean; readonly message?: string };
      if (cameraResult?.ok !== true) throw new Error(cameraResult?.message ?? '无法校正战斗场景相机');
    }
    await scene.snapshot();
    selectNode(tree.uuid);
    const kindName = kind === 'BOOT' ? '启动场景' : kind === 'MAIN' ? '主场景' : '战斗场景';
    return { ok: true, message: `${kindName}中文骨架已创建或补齐` };
  } catch (cause) {
    for (const uuid of createdNodes.reverse()) await scene.removeNode(uuid).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚本次创建的场景节点` };
  }
}

interface MutableNode extends SceneNodeTree { children: MutableNode[] }

async function ensureChild(scene: SceneQueryPort, parent: MutableNode, key: SceneNodeKey, created: string[]): Promise<MutableNode> {
  const name = sceneNodeName(key);
  const matches = parent.children.filter((child) => child.name === name);
  if (matches.length > 1) throw new Error(`节点“${name}”在同一父节点下重复`);
  if (matches.length === 1) return matches[0];
  if (parent.uuid === undefined) throw new Error(`父节点缺少 UUID，无法创建“${name}”`);
  const result = await scene.createNode({ parent: parent.uuid, name });
  if (result?.uuid === undefined) throw new Error(`创建节点失败：“${name}”`);
  const node: MutableNode = {
    uuid: result.uuid,
    name,
    children: [],
    components: [{ type: 'cc.UITransform', nodeUuid: result.uuid, index: 0 }],
  };
  parent.children.push(node);
  created.push(result.uuid);
  return node;
}

async function ensureComponents(scene: SceneQueryPort, node: MutableNode, types: readonly string[], classes: readonly SceneComponentClassInfo[]): Promise<void> {
  for (const type of types) await ensureComponent(scene, node, type, classes);
}

async function ensureComponent(scene: SceneQueryPort, node: MutableNode, type: string, classes: readonly SceneComponentClassInfo[]): Promise<void> {
  if (node.uuid === undefined) throw new Error(`节点缺少 UUID，无法挂载 ${type}`);
  if ((node.components ?? []).some((component) => componentTypeMatches(component, type, classes))) return;
  await scene.createComponent(node.uuid, type);
}

async function wireCameraController(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  worldUuid: string,
  canvasUuid: string,
  classes: readonly SceneComponentClassInfo[],
): Promise<void> {
  const app = flattenTree(tree).find((node) => node.name === sceneNodeName('appRoot'));
  const component = app === undefined ? null : findComponent(app, 'CameraController', classes);
  const target = getSceneComponentTarget(component);
  if (target === undefined) throw new Error('主场景镜头控制组件创建后不可编辑');
  if (!(await scene.setProperty(target, 'worldRoot', { type: 'cc.Node', uuid: worldUuid }))) throw new Error('无法绑定世界根节点');
  if (!(await scene.setProperty(target, 'canvasRoot', { type: 'cc.Node', uuid: canvasUuid }))) throw new Error('无法绑定画布根节点');
}

async function waitForComponents(scene: SceneQueryPort, kind: SceneSkeletonKind, classes: readonly SceneComponentClassInfo[]): Promise<SceneNodeTree> {
  const expected = kind === 'BOOT' ? 'BootSceneBootstrap' : kind === 'MAIN' ? 'MainSceneBootstrap' : 'BattleSceneBootstrap';
  let tree = await scene.queryNodeTree();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (flattenTree(tree).some((node) => findComponent(node, expected, classes) !== null)) return tree;
    await new Promise((resolve) => setTimeout(resolve, 50));
    tree = await scene.queryNodeTree();
  }
  return tree;
}

async function waitForNodeComponent(
  scene: SceneQueryPort,
  nodeUuid: string,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): Promise<ReturnType<typeof getSceneComponentTarget>> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const node = flattenTree(await scene.queryNodeTree()).find((candidate) => candidate.uuid === nodeUuid);
    const target = getSceneComponentTarget(node === undefined ? null : findComponent(node, type, classes));
    if (target !== undefined) return target;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

function findComponent(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
}

function cloneNode(node: SceneNodeTree): MutableNode {
  const uuid = node.uuid;
  return {
    ...node,
    children: (node.children ?? []).map(cloneNode),
    components: (node.components ?? []).map((component, index) => ({ ...component, nodeUuid: component.nodeUuid ?? uuid, index: component.index ?? index })),
  };
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree, parent?: string): void => {
    result.push(node.parent === undefined && parent !== undefined ? { ...node, parent } : node);
    for (const child of node.children ?? []) visit(child, node.uuid);
  };
  visit(tree);
  return result;
}

function selectNode(uuid: string): void {
  (globalThis as { Editor?: { Selection?: { select?: (type: string, uuid: string) => void } } }).Editor?.Selection?.select?.('node', uuid);
}

function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
