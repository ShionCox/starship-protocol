import type { AssetDbPort } from '../shared/editor-asset-db';
import { loadVisualDefinition } from '../csv/config-csv';
import { isAuthoringMethodSuccess, resolveEditablePrefabRoot } from '../scene/foundation-prefab-authoring';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

export const FIRST_HULL_VISUALS = [
  { visualId: 'visual-hull-starter', source: 'sorted/ship/4324.png', target: 'assets/textures/pss/ship/hull-starter-4324.png' },
  { visualId: 'visual-hull-raider', source: 'sorted/ship/261.png', target: 'assets/textures/pss/ship/hull-raider-261.png' },
] as const;

/** 在已经打开的 ShipView Prefab 中全新建立两个持久船体外观节点。 */
export async function bindFirstHullAppearances(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
): Promise<{ readonly ok: boolean; readonly message: string; readonly bound: readonly string[] }> {
  const bound: string[] = [];
  try {
    let tree = await waitForShipViewPrefab(scene);
    const classes = await scene.queryComponents?.() ?? [];
    const ship = findComponent(tree, 'ShipView', classes);
    const shipTarget = getSceneComponentTarget(ship);
    if (shipTarget === undefined || ship?.nodeUuid === undefined) throw new Error('ShipView Prefab 根组件不可用');
    if (!isAuthoringMethodSuccess(await scene.executeComponentMethod(shipTarget.uuid, 'ensureAuthoringPrefabStructure', []))) {
      throw new Error('ShipView Prefab 持久层级升级失败');
    }
    // 规范层级为 ShipView/逻辑内容根/船体外观层，不能只查 ShipView 的一级子节点。
    // execute-component-method 返回时 Creator 的 query-node-tree 仍可能是旧快照，需等到
    // 新节点真实出现在公开 Scene 树后再继续绑定。
    const appearanceRoot = await waitForDescendant(scene, ship.nodeUuid, '船体外观层');
    if (appearanceRoot?.uuid === undefined) {
      tree = await scene.queryNodeTree();
      const names = findNode(tree, ship.nodeUuid) === null
        ? 'ShipView 根节点未出现在当前文档'
        : flattenTree(findNode(tree, ship.nodeUuid) as SceneNodeTree).map((node) => node.name ?? '(未命名)').join(' / ');
      throw new Error(`ShipView Prefab 缺少船体外观层；当前层级：${names}`);
    }
    const undoId = await scene.beginRecording(ship.nodeUuid);
    let recording = true;
    try {
      for (const binding of FIRST_HULL_VISUALS) {
        const visual = await loadVisualDefinition(assetDb, binding.visualId, 'HULL');
        const textureUuid = await assetDb.queryUuid(`${visual.textureUrl}/texture`);
        if (textureUuid === '') throw new Error(`找不到船体 Texture2D：${visual.textureUrl}/texture`);
        // Hull 采用完整 PNG，直接绑定 Creator 导入生成的持久 SpriteFrame
        // 子资源。不能把 new SpriteFrame() 只放在 Prefab 内存对象上，那样
        // save-scene 后会丢失引用，重开 Prefab 时 staticFrame 会恢复为 null。
        const spriteFrameUuid = await assetDb.queryUuid(`${visual.textureUrl}/spriteFrame`);
        if (spriteFrameUuid === '') throw new Error(`找不到船体 SpriteFrame：${visual.textureUrl}/spriteFrame`);
        const old = findChild(await scene.queryNodeTree(), appearanceRoot.uuid, binding.visualId);
        if (old?.uuid !== undefined) await scene.removeNode(old.uuid);
        const image = await scene.createNode({ parent: appearanceRoot.uuid, name: binding.visualId, type: 'cc.Node', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
        if (image?.uuid === undefined) throw new Error(`无法创建船体外观节点：${binding.visualId}`);
        await ensureComponent(scene, image.uuid, 'cc.UITransform');
        const sprite = await ensureComponent(scene, image.uuid, 'cc.Sprite');
        const appearance = await ensureComponent(scene, image.uuid, 'HullAppearance');
        if (!(await scene.setProperty(appearance, 'sprite', { type: 'cc.Sprite', uuid: sprite.uuid }, { record: false }))) throw new Error(`无法绑定船体 Sprite：${binding.visualId}`);
        if (!(await scene.setProperty(appearance, 'sourceTexture', { type: 'cc.Texture2D', uuid: textureUuid }, { record: false }))) throw new Error(`无法绑定船体贴图：${binding.visualId}`);
        if (!(await scene.setProperty(appearance, 'staticFrame', { type: 'cc.SpriteFrame', uuid: spriteFrameUuid }, { record: false }))) throw new Error(`无法绑定持久船体帧：${binding.visualId}`);
        const frame = visual.frames[visual.idleFrameIndex] ?? visual.frames[0];
        if (frame === undefined) throw new Error(`${binding.visualId} 缺少第 0 帧`);
        const configured = await scene.executeComponentMethod(appearance.uuid, 'applyAuthoringVisualConfiguration', [{
          visualId: binding.visualId,
          frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          canvasWidth: visual.imageWidth,
          canvasHeight: visual.imageHeight,
          displayScalePermille: visual.displayScalePermille,
          gridOffsetX: visual.gridOffsetX,
          gridOffsetY: visual.gridOffsetY,
          filter: visual.filter,
          pivot: visual.pivot,
        }]) as { readonly ok?: boolean; readonly message?: string } | boolean | undefined;
        if (typeof configured === 'object' && configured !== null && configured.ok === false) throw new Error(configured.message ?? `${binding.visualId} 配置失败`);
        bound.push(binding.visualId);
      }
      await scene.endRecording(undoId);
      recording = false;
      return { ok: true, message: `已从视觉 CSV 绑定 ${bound.length} 个船体外观`, bound };
    } catch (cause) {
      if (recording) await scene.cancelRecording(undoId).catch(() => undefined);
      throw cause;
    }
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause), bound };
  }
}

async function waitForShipViewPrefab(scene: SceneQueryPort): Promise<SceneNodeTree> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const tree = await scene.queryNodeTree();
      const root = resolveEditablePrefabRoot(tree, 'db://assets/prefabs/ShipView.prefab');
      if (root.uuid !== undefined) return tree;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error('ShipView Prefab 加载超时');
}

async function ensureComponent(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget> {
  const classes = await scene.queryComponents?.() ?? [];
  let target = getSceneComponentTarget(findComponent(await scene.queryNodeTree(), type, classes, nodeUuid));
  if (target !== undefined) return target;
  await scene.createComponent(nodeUuid, type);
  target = getSceneComponentTarget(findComponent(await scene.queryNodeTree(), type, await scene.queryComponents?.() ?? [], nodeUuid));
  if (target === undefined) throw new Error(`节点 ${nodeUuid} 无法挂载 ${type}`);
  return target;
}

function findComponent(tree: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[], nodeUuid?: string): SceneComponentInfo | null {
  for (const node of flattenTree(tree)) {
    if (nodeUuid !== undefined && node.uuid !== nodeUuid) continue;
    for (const [index, component] of (node.components ?? []).entries()) {
      const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
      if (componentTypeMatches(candidate, type, classes)) return candidate;
    }
  }
  return null;
}

function findChild(tree: SceneNodeTree, parentUuid: string, name: string): SceneNodeTree | null {
  return flattenTree(tree).find((node) => node.uuid === parentUuid)?.children?.find((child) => child.name === name) ?? null;
}

function findDescendant(tree: SceneNodeTree, parentUuid: string, name: string): SceneNodeTree | null {
  const parent = findNode(tree, parentUuid);
  return parent === null ? null : flattenTree(parent).find((node) => node.uuid !== parentUuid && node.name === name) ?? null;
}

function findNode(tree: SceneNodeTree, uuid: string): SceneNodeTree | null {
  return flattenTree(tree).find((node) => node.uuid === uuid) ?? null;
}

async function waitForDescendant(scene: SceneQueryPort, parentUuid: string, name: string): Promise<SceneNodeTree | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = findDescendant(await scene.queryNodeTree(), parentUuid, name);
    if (found !== null) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): readonly SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}
