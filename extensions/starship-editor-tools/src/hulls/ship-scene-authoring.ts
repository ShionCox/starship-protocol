import { DEFAULT_SHIP_VIEW_PREFAB_URL } from '../constants';
import type { SceneSelectionContext } from '../contracts';
import { isSceneNodeName } from '../scene/scene-names';
import type { AssetDbPort } from '../shared/editor-asset-db';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import type { HullCatalogEntry } from './hull-catalog';

/** 在明确选中的飞船挂载点创建 ShipView Prefab，并写入所属场景唯一的飞船实例 ID。 */
export async function createShipInstance(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  context: SceneSelectionContext,
  hull: HullCatalogEntry,
): Promise<{ readonly ok: boolean; readonly message: string; readonly nodeUuid?: string }> {
  const [tree, prefabUuid] = await Promise.all([scene.queryNodeTree(), assetDb.queryUuid(DEFAULT_SHIP_VIEW_PREFAB_URL)]);
  if (prefabUuid === '') return { ok: false, message: `飞船视图预制体不存在：${DEFAULT_SHIP_VIEW_PREFAB_URL}` };
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
  const target = resolveMount(tree, context);
  if (target.ok === false || target.node.uuid === undefined) return { ok: false, message: target.ok === false ? target.message : '飞船挂载点缺少 UUID' };
  const existingIds = await collectShipIds(scene, tree, classes);
  const shipId = nextShipInstanceId(existingIds);
  let createdUuid: string | undefined;
  let undoId: string | undefined;
  try {
    undoId = await scene.beginRecording(target.node.uuid);
    const created = await scene.createNode({
      parent: target.node.uuid,
      name: `飞船-${hull.displayName}`,
      assetUuid: prefabUuid,
      type: 'cc.Prefab',
      position: { x: 0, y: 0, z: 0 },
      unlinkPrefab: false,
    });
    createdUuid = created?.uuid;
    if (createdUuid === undefined) throw new Error('创建飞船视图 Prefab 失败');
    if (!(await scene.queryNodesByAssetUuid(prefabUuid)).includes(createdUuid)) throw new Error('创建结果未保留 ShipView Prefab 关联');
    // create-node 的 position 是世界坐标；飞船挂在 Canvas 体系内时必须显式归零局部坐标。
    if (!(await scene.setProperty(createdUuid, '_lpos', { type: 'cc.Vec3', value: { x: 0, y: 0, z: 0 } }, { record: false }))) {
      throw new Error('无法把飞船实例对齐到挂载点原点');
    }
    const createdNode = flattenTree(await scene.queryNodeTree()).find((node) => node.uuid === createdUuid);
    const component = createdNode === undefined ? null : findComponent(createdNode, 'ShipView', classes);
    const componentTarget = getSceneComponentTarget(component);
    if (componentTarget === undefined) throw new Error('ShipView Prefab 缺少飞船视图组件');
    if (!(await scene.setProperty(componentTarget, 'shipId', shipId, { record: false }))) throw new Error('无法写入飞船实例标识');
    if (!(await scene.setProperty(componentTarget, 'hullDefinitionId', hull.id, { record: false }))) throw new Error('无法写入船体定义标识');
    if (!(await scene.setProperty(componentTarget, 'hullDefinitionAsset', { type: 'cc.JsonAsset', uuid: hull.configUuid }, { record: false }))) throw new Error('无法绑定船体定义 JSON');
    await scene.endRecording(undoId);
    undoId = undefined;
    selectNode(createdUuid);
    return { ok: true, message: `已创建飞船实例：${shipId}（${hull.displayName}）`, nodeUuid: createdUuid };
  } catch (cause) {
    if (createdUuid !== undefined) await scene.removeNode(createdUuid).catch(() => undefined);
    if (undoId !== undefined) await scene.cancelRecording(undoId).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚临时飞船节点` };
  }
}

function resolveMount(
  tree: SceneNodeTree,
  context: SceneSelectionContext,
): { readonly ok: true; readonly node: SceneNodeTree } | { readonly ok: false; readonly message: string } {
  const nodes = flattenTree(tree);
  const selected = context.nodeUuid === undefined ? undefined : nodes.find((node) => node.uuid === context.nodeUuid);
  const isMount = (node: SceneNodeTree): boolean => isSceneNodeName(node.name, 'currentShipMount') || isSceneNodeName(node.name, 'playerShipMount') || isSceneNodeName(node.name, 'enemyShipMount');
  if (selected !== undefined && isMount(selected)) return { ok: true, node: selected };
  const mounts = nodes.filter(isMount);
  if (mounts.length === 1) return { ok: true, node: mounts[0] };
  return { ok: false, message: mounts.length === 0 ? '当前场景没有飞船挂载点，请先补齐场景骨架' : '当前场景有多个飞船挂载点，请先选择目标挂载点' };
}

async function collectShipIds(scene: SceneQueryPort, tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[]): Promise<string[]> {
  const ids: string[] = [];
  for (const node of flattenTree(tree)) {
    const component = findComponent(node, 'ShipView', classes);
    const uuid = getSceneComponentUuid(component);
    if (uuid === undefined) continue;
    try {
      const state = await scene.executeComponentMethod(uuid, 'getAuthoringInspectorState', []) as { readonly shipId?: unknown };
      if (typeof state?.shipId === 'string' && state.shipId.trim() !== '') ids.push(state.shipId.trim());
    } catch {
      // 新基线没有旧组件读取回退；无法读取的 ShipView 会在场景校验中单独报错。
    }
  }
  return ids;
}

export function nextShipInstanceId(existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let index = 1;
  while (used.has(`ship-${index}`)) index += 1;
  return `ship-${index}`;
}

function findComponent(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
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
