import { DEFAULT_TEMPLATE_URL } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { describeRollback, rollbackCreatedAssets } from '../shared/rollback-assets';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import type { SceneSkeletonKind } from './scene-skeleton';

export const SHIP_VIEW_PREFAB_URL = 'db://assets/prefabs/ShipView.prefab';
export const UI_ROOT_PREFAB_URL = 'db://assets/prefabs/UIRoot.prefab';
export const PAGE_PREFABS = [
  ['MainMenuPage', '主菜单页面'],
  ['GalaxyMapPage', '星图页面'],
  ['ShipMainPage', '飞船页面'],
  ['BuildPage', '建造页面'],
  ['CrewPage', '船员页面'],
  ['SettingsPopup', '设置弹窗'],
] as const;

export interface FoundationAuthoringResult { readonly ok: boolean; readonly message: string }

interface FoundationCreationContext {
  readonly createdAssetUrls: string[];
}

/** 生成正式的共享 UI、页面和飞船表现 Prefab；所有写入均经 Asset DB 与 Scene 公共接口。 */
export async function createFoundationPrefabs(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<FoundationAuthoringResult> {
  const context: FoundationCreationContext = { createdAssetUrls: [] };
  try {
    for (const [assetName] of PAGE_PREFABS) await createBlankPrefab(assetDb, scene, `db://assets/prefabs/${assetName}.prefab`, context);
    await createConvertedPrefab(assetDb, scene, SHIP_VIEW_PREFAB_URL, 'ShipView', 'ensureAuthoringPrefabStructure', context);
    await createUiRootPrefab(assetDb, scene, context);
    // 已存在的正式 Prefab 属于设计资产，创作工具只校验，不覆盖设计师调整的位置与尺寸。
    await validateExistingPrefab(scene, SHIP_VIEW_PREFAB_URL, 'ShipView');
    await validateExistingPrefab(scene, UI_ROOT_PREFAB_URL, 'UIRootController');
    return { ok: true, message: '共享 UIRoot、页面与 ShipView Prefab 已通过 Creator 公共接口创建' };
  } catch (cause) {
    // UIRoot 引用了页面 Prefab，按创建逆序清理，且只清理本次确认不存在后创建的资源。
    const rollbackErrors = await rollbackCreatedAssets(assetDb, [...context.createdAssetUrls].reverse());
    return { ok: false, message: `${toMessage(cause)}；${describeRollback(rollbackErrors)}` };
  }
}

/** 已存在 Prefab 只检查关键组件；结构补齐仅用于首次创建，避免覆盖 Creator 中的人工布局。 */
async function validateExistingPrefab(scene: SceneQueryPort, assetUrl: string, componentType: string): Promise<void> {
  await Editor.Message.request('asset-db', 'open-asset', assetUrl);
  const component = await waitForComponent(scene, componentType);
  if (component === null) throw new Error(`${assetUrl} 缺少 ${componentType}`);
}

/** 在当前 Main/Battle 场景的画布下实例化同一 UIRoot Prefab，并写入中文模式。 */
export async function mountSharedUi(assetDb: AssetDbPort, scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<FoundationAuthoringResult> {
  if (kind === 'BOOT') return { ok: false, message: '启动场景不挂载完整共享界面' };
  const prefabUuid = await assetDb.queryUuid(UI_ROOT_PREFAB_URL);
  if (prefabUuid === '') return { ok: false, message: '请先创建共享 UIRoot Prefab' };
  const classes = await queryClasses(scene);
  const tree = await scene.queryNodeTree();
  if (findNodeWithComponent(tree, 'UIRootController', classes) !== null) return { ok: true, message: '当前场景已挂载共享 UIRoot Prefab' };
  const canvas = flattenTree(tree).find((node) => node.name === '画布');
  if (canvas?.uuid === undefined) return { ok: false, message: '当前场景缺少中文“画布”节点，请先补齐场景骨架' };
  const created = await scene.createNode({ parent: canvas.uuid, name: '界面根', assetUuid: prefabUuid, type: 'cc.Prefab', unlinkPrefab: false });
  if (created?.uuid === undefined) return { ok: false, message: '无法实例化共享 UIRoot Prefab' };
  try {
    const target = await waitForComponentOnNode(scene, created.uuid, 'UIRootController');
    if (target === null) throw new Error('UIRoot Prefab 缺少界面根控制组件');
    if (!(await scene.setProperty(target, 'mode', kind === 'MAIN' ? 0 : 1))) throw new Error('无法写入共享界面模式');
    await scene.snapshot();
    await Editor.Message.request('scene', 'save-scene');
    return { ok: true, message: `${kind === 'MAIN' ? '主场景' : '战斗场景'}已挂载共享 UIRoot Prefab` };
  } catch (cause) {
    await scene.removeNode(created.uuid).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚界面实例` };
  }
}

/** 自动连接当前场景中已持久保存的 ShipView、UI 和装配组件引用。 */
export async function wireSceneFoundation(scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<FoundationAuthoringResult> {
  if (kind === 'BOOT') return { ok: true, message: '启动场景无需连接飞船与共享界面引用' };
  const classes = await queryClasses(scene);
  const tree = await scene.queryNodeTree();
  const nodes = flattenTree(tree);
  try {
    if (kind === 'MAIN') {
      const bootstrap = requireComponent(nodes, 'MainSceneBootstrap', classes);
      const result = await scene.executeComponentMethod(bootstrap.uuid, 'applyEditorSceneReferences', []) as { readonly ok?: boolean; readonly message?: string };
      if (result?.ok !== true) throw new Error(result?.message ?? '主场景引用连接失败');
    } else {
      const bootstrap = requireComponent(nodes, 'BattleSceneBootstrap', classes);
      const result = await scene.executeComponentMethod(bootstrap.uuid, 'applyEditorSceneReferences', []) as { readonly ok?: boolean; readonly message?: string };
      if (result?.ok !== true) throw new Error(result?.message ?? '战斗场景引用连接失败');
    }
    await scene.snapshot();
    await Editor.Message.request('scene', 'save-scene');
    return { ok: true, message: `${kind === 'MAIN' ? '主场景' : '战斗场景'}引用已连接并保存` };
  } catch (cause) {
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: toMessage(cause) };
  }
}

async function createBlankPrefab(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  targetUrl: string,
  context: FoundationCreationContext,
): Promise<void> {
  if (await assetDb.queryUuid(targetUrl)) return;
  await createConvertedPrefab(assetDb, scene, targetUrl, null, null, context);
}

async function createConvertedPrefab(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  targetUrl: string,
  componentType: string | null,
  ensureMethod: string | null,
  context: FoundationCreationContext,
): Promise<void> {
  if (await assetDb.queryUuid(targetUrl)) return;
  // 复制请求一旦开始就登记目标；Creator 可能在抛错前已经写入资源，回滚必须保守清理。
  context.createdAssetUrls.push(targetUrl);
  if (await assetDb.copyAsset(DEFAULT_TEMPLATE_URL, targetUrl) === null) throw new Error(`无法复制 Prefab 模板：${targetUrl}`);
  await Editor.Message.request('asset-db', 'open-asset', targetUrl);
  const room = await waitForComponent(scene, 'RoomView');
  if (room === null) throw new Error('复制出的 Prefab 中没有 RoomView，无法安全转换');
  await scene.executeComponentMethod(room.target.uuid, 'removeForAuthoringTemplateConversion', []);
  await waitForComponentRemoval(scene, 'RoomView');
  if (componentType !== null) {
    if (room.node.uuid === undefined) throw new Error('Prefab 根节点缺少 UUID');
    await scene.createComponent(room.node.uuid, componentType);
    const target = await waitForComponentOnNode(scene, room.node.uuid, componentType);
    if (target === null) throw new Error(`无法挂载 ${componentType}`);
    if (ensureMethod !== null && !isAuthoringMethodSuccess(await scene.executeComponentMethod(target.uuid, ensureMethod, []))) throw new Error(`${componentType} 结构补齐失败`);
  }
  await Editor.Message.request('scene', 'save-scene');
}

async function createUiRootPrefab(assetDb: AssetDbPort, scene: SceneQueryPort, context: FoundationCreationContext): Promise<void> {
  if (await assetDb.queryUuid(UI_ROOT_PREFAB_URL)) return;
  await createConvertedPrefab(assetDb, scene, UI_ROOT_PREFAB_URL, 'UIRootController', 'ensureAuthoringPrefabStructure', context);
  await Editor.Message.request('asset-db', 'open-asset', UI_ROOT_PREFAB_URL);
  const classes = await queryClasses(scene);
  let tree = await scene.queryNodeTree();
  const rootController = findNodeWithComponent(tree, 'UIRootController', classes);
  if (rootController?.node.uuid === undefined) throw new Error('UIRoot Prefab 根组件不可用');
  const mainRoot = flattenTree(tree).find((node) => node.name === '主界面内容根');
  const battleRoot = flattenTree(tree).find((node) => node.name === '战斗界面内容根');
  const popupRoot = flattenTree(tree).find((node) => node.name === '弹窗层');
  if (mainRoot?.uuid === undefined || battleRoot?.uuid === undefined || popupRoot?.uuid === undefined) throw new Error('UIRoot 内容分层不完整');

  const pageNodes: Record<string, string> = {};
  for (const [assetName, nodeName] of PAGE_PREFABS) {
    const parent = assetName === 'SettingsPopup' ? popupRoot.uuid : mainRoot.uuid;
    const assetUuid = await assetDb.queryUuid(`db://assets/prefabs/${assetName}.prefab`);
    const created = await scene.createNode({ parent, name: nodeName, assetUuid, type: 'cc.Prefab', unlinkPrefab: false });
    if (created?.uuid === undefined) throw new Error(`无法实例化页面 Prefab：${assetName}`);
    pageNodes[assetName] = created.uuid;
  }
  await scene.createComponent(mainRoot.uuid, 'MainPageRouter');
  const router = await waitForComponentOnNode(scene, mainRoot.uuid, 'MainPageRouter');
  if (router === null) throw new Error('无法挂载主界面页面路由');
  for (const [path, assetName] of [
    ['mainMenuPage', 'MainMenuPage'], ['galaxyMapPage', 'GalaxyMapPage'], ['shipPage', 'ShipMainPage'],
    ['buildPage', 'BuildPage'], ['crewPage', 'CrewPage'], ['settingsPopup', 'SettingsPopup'],
  ] as const) await setNodeReference(scene, router, path, pageNodes[assetName]);

  const power = await createComponentNode(scene, mainRoot.uuid, '能源面板', 'PowerPanel', 'ensureAuthoringPrefabStructure');
  const rowUuid = await assetDb.queryUuid('db://assets/prefabs/PowerRoomRow.prefab');
  if (rowUuid === '') throw new Error('PowerRoomRow.prefab 不存在');
  for (const row of [
    { name: '能源行-激光室', roomId: 'room-laser-1', y: 12 },
    { name: '能源行-护盾室', roomId: 'room-shield-1', y: -31 },
  ]) {
    const created = await scene.createNode({ parent: power.nodeUuid, name: row.name, assetUuid: rowUuid, type: 'cc.Prefab', unlinkPrefab: false });
    if (created?.uuid === undefined) throw new Error(`无法实例化 ${row.name}`);
    const rowTarget = await waitForComponentOnNode(scene, created.uuid, 'PowerRoomRow');
    if (rowTarget === null) throw new Error(`${row.name} 缺少 PowerRoomRow`);
    await scene.setProperty(rowTarget, 'roomInstanceId', row.roomId);
    if (await scene.executeComponentMethod(rowTarget.uuid, 'applyAuthoringLocalPosition', [0, row.y]) !== true) throw new Error(`${row.name} 无法设置局部位置`);
  }
  await scene.executeComponentMethod(power.target.uuid, 'refreshAuthoringReferences', []);
  await createComponentNode(scene, mainRoot.uuid, '船员状态面板', 'CrewStatusPanel', 'ensureAuthoringPrefabStructure');
  await scene.createComponent(battleRoot.uuid, 'BattleHUD');
  const hud = await waitForComponentOnNode(scene, battleRoot.uuid, 'BattleHUD');
  if (hud === null || !isAuthoringMethodSuccess(await scene.executeComponentMethod(hud.uuid, 'ensureAuthoringPrefabStructure', []))) throw new Error('战斗界面结构补齐失败');
  await Editor.Message.request('scene', 'save-scene');
  tree = await scene.queryNodeTree();
  if (findNodeWithComponent(tree, 'PowerPanel', await queryClasses(scene)) === null) throw new Error('UIRoot Prefab 保存后校验失败');
}

async function createComponentNode(scene: SceneQueryPort, parent: string, name: string, type: string, ensureMethod: string): Promise<{ readonly nodeUuid: string; readonly target: SceneComponentTarget }> {
  const created = await scene.createNode({ parent, name });
  if (created?.uuid === undefined) throw new Error(`无法创建${name}`);
  await scene.createComponent(created.uuid, type);
  const target = await waitForComponentOnNode(scene, created.uuid, type);
  if (target === null || !isAuthoringMethodSuccess(await scene.executeComponentMethod(target.uuid, ensureMethod, []))) throw new Error(`${name}结构补齐失败`);
  return { nodeUuid: created.uuid, target };
}

async function setReference(scene: SceneQueryPort, owner: SceneComponentTarget, path: string, type: string, value: SceneComponentTarget): Promise<void> {
  if (!(await scene.setProperty(owner, path, { type, uuid: value.uuid }))) throw new Error(`无法绑定 ${path}`);
}

async function setNodeReference(scene: SceneQueryPort, owner: SceneComponentTarget, path: string, uuid: string): Promise<void> {
  if (!(await scene.setProperty(owner, path, { type: 'cc.Node', uuid }))) throw new Error(`无法绑定 ${path}`);
}

function requireComponent(nodes: readonly SceneNodeTree[], type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget {
  for (const node of nodes) {
    const target = getComponentTarget(node, type, classes);
    if (target !== null) return target;
  }
  throw new Error(`当前场景缺少 ${type}`);
}

function requireDescendantComponent(root: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget {
  const found = findNodeWithComponent(root, type, classes);
  if (found === null) throw new Error(`${root.name ?? '挂载点'}下缺少 ${type}`);
  return found.target;
}

async function queryClasses(scene: SceneQueryPort): Promise<readonly SceneComponentClassInfo[]> {
  return scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
}

async function waitForComponent(scene: SceneQueryPort, type: string): Promise<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = findNodeWithComponent(await scene.queryNodeTree(), type, await queryClasses(scene));
    if (found !== null) return found;
    await delay();
  }
  return null;
}

async function waitForComponentOnNode(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const node = flattenTree(await scene.queryNodeTree()).find((item) => item.uuid === nodeUuid);
    const target = node === undefined ? null : getComponentTarget(node, type, await queryClasses(scene));
    if (target !== null) return target;
    await delay();
  }
  return null;
}

async function waitForComponentRemoval(scene: SceneQueryPort, type: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (findNodeWithComponent(await scene.queryNodeTree(), type, await queryClasses(scene)) === null) return;
    await delay();
  }
  throw new Error(`${type} 未从模板中移除`);
}

function findNodeWithComponent(tree: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): { readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null {
  const target = getComponentTarget(tree, type, classes);
  if (target !== null) return { node: tree, target };
  for (const child of tree.children ?? []) {
    const found = findNodeWithComponent(child, type, classes);
    if (found !== null) return found;
  }
  return null;
}

function getComponentTarget(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate: SceneComponentInfo = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}

function delay(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 100)); }
function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }

/** Creator 3.8 的 execute-component-method 对成功的 void/boolean 方法可能返回空值或包装结果。 */
export function isAuthoringMethodSuccess(value: unknown): boolean {
  if (value === undefined || value === null || value === true) return true;
  return typeof value === 'object' && (value as { readonly ok?: unknown }).ok === true;
}
