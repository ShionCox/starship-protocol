import type { SceneSelectionContext } from '../contracts';
import type {
  SceneComponentClassInfo,
  SceneComponentInfo,
  SceneComponentTarget,
  SceneNodeTree,
  SceneQueryPort,
} from '../shared/editor-scene';
import { componentTypeMatches, getSceneComponentTarget, getSceneComponentUuid } from '../shared/editor-scene';
import type { RoomPrefabCatalogEntry } from './discover-room-prefabs';
import { isPrototypeSceneNodeName } from '../scene/prototype-scene-names';

export interface RoomSceneAuthoringResult {
  readonly ok: boolean;
  readonly message: string;
  readonly nodeUuid?: string;
}

export type RoomPlacementTarget =
  | {
    readonly ok: true;
    readonly mode: 'grid';
    readonly node: SceneNodeTree;
    readonly settings: SceneComponentTarget;
    readonly message: string;
  }
  | {
    readonly ok: true;
    readonly mode: 'canvas' | 'scene-root';
    readonly node: SceneNodeTree;
    readonly message: string;
  }
  | {
    readonly ok: false;
    readonly mode: 'blocked';
    readonly message: string;
  };

/**
 * 根据面板当前选择解析语义 RoomRoot。
 * 层级管理器只提供选择上下文，真正的创建始终由公开 Scene 消息完成。
 */
export function resolveRoomRoot(
  tree: SceneNodeTree,
  context: SceneSelectionContext,
): { readonly ok: true; readonly node: SceneNodeTree } | { readonly ok: false; readonly message: string } {
  const nodes = flattenTree(tree);
  const byUuid = new Map(nodes.filter((node) => typeof node.uuid === 'string').map((node) => [node.uuid as string, node]));
  const selected = context.nodeUuid === undefined ? undefined : byUuid.get(context.nodeUuid);
  if (selected !== undefined && isPrototypeSceneNodeName(selected.name, 'roomRoot')) {
    return { ok: true, node: selected };
  }

  let cursor = selected;
  while (cursor?.parent !== undefined) {
    cursor = byUuid.get(cursor.parent);
    if (cursor !== undefined && isPrototypeSceneNodeName(cursor.name, 'roomRoot')) {
      return { ok: true, node: cursor };
    }
  }

  if (selected !== undefined && isPrototypeSceneNodeName(selected.name, 'shipRoot')) {
    const children = (selected.children ?? []).filter((node) => isPrototypeSceneNodeName(node.name, 'roomRoot'));
    if (children.length === 1) return { ok: true, node: children[0] };
    return { ok: false, message: 'ShipRoot 下缺少唯一 RoomRoot，请先初始化 Prototype 场景骨架' };
  }

  const roomRoots = nodes.filter((node) => isPrototypeSceneNodeName(node.name, 'roomRoot'));
  if (roomRoots.length === 1) return { ok: true, node: roomRoots[0] };
  if (roomRoots.length === 0) return { ok: false, message: '场景中没有 RoomRoot，请先初始化 Prototype 场景骨架' };
  return { ok: false, message: '场景中存在多个 RoomRoot，无法安全决定房间父节点' };
}

/**
 * 解析房间实例的当前场景放置目标。
 * 房间目录是项目级资源；只有存在完整网格入口时才把创建动作绑定到 RoomRoot。
 * 没有标准骨架时优先挂到 Canvas，避免把资源库错误地限制为某个场景。
 */
export function resolveRoomPlacementTarget(
  tree: SceneNodeTree,
  context: SceneSelectionContext,
  componentClasses: readonly SceneComponentClassInfo[] = [],
): RoomPlacementTarget {
  const roomRootResult = resolveRoomRoot(tree, context);
  const appRoot = flattenTree(tree).find((node) => isPrototypeSceneNodeName(node.name, 'appRoot'));
  const settings = appRoot === undefined ? null : findComponentInNode(appRoot, 'PrototypeSceneSettings', componentClasses);
  const camera = appRoot === undefined ? null : findComponentInNode(appRoot, 'CameraController', componentClasses);
  const settingsTarget = getSceneComponentTarget(settings);
  if (roomRootResult.ok && roomRootResult.node.uuid !== undefined && settingsTarget !== undefined && camera !== null) {
    return {
      ok: true,
      mode: 'grid',
      node: roomRootResult.node,
      settings: settingsTarget,
      message: '已解析标准 RoomRoot，可按逻辑网格创建房间建筑',
    };
  }

  // 多个 RoomRoot 表示场景结构冲突；已有选择无法安全消除歧义时不静默改挂到别处。
  if (!roomRootResult.ok && roomRootResult.message.includes('多个 RoomRoot')) {
    return { ok: false, mode: 'blocked', message: roomRootResult.message };
  }

  const canvas = resolveCanvasNode(tree, context, componentClasses);
  if (canvas?.uuid !== undefined) {
    return {
      ok: true,
      mode: 'canvas',
      node: canvas,
      message: '未发现完整标准骨架，将创建到 Canvas 顶层',
    };
  }
  if (tree.uuid !== undefined) {
    return {
      ok: true,
      mode: 'scene-root',
      node: tree,
      message: '未发现完整骨架和 Canvas，将创建到场景顶层；请在编辑器中确认 2D 可见性',
    };
  }
  return { ok: false, mode: 'blocked', message: '当前场景缺少可用根节点，无法创建房间建筑' };
}

export function nextRoomInstanceId(
  tree: SceneNodeTree,
  definitionId: string,
  existingIds: readonly string[] = [],
): string {
  const used = new Set(existingIds.filter((id) => id.length > 0));
  for (const node of flattenTree(tree)) {
    for (const component of node.components ?? []) {
      if (component.type === 'RoomView') used.add(node.name ?? '');
    }
  }
  let index = 1;
  while (used.has(`${definitionId}-${index}`) || used.has(`Room-${definitionId}-${index}`)) index += 1;
  return `${definitionId}-${index}`;
}

/** 面板创建房间实例的原子操作：失败不留下节点，成功只生成一条 Undo 记录。 */
export async function createRoomInstance(
  scene: SceneQueryPort,
  context: SceneSelectionContext,
  entry: RoomPrefabCatalogEntry,
): Promise<RoomSceneAuthoringResult> {
  const tree = await scene.queryNodeTree();
  // 组件注册表只是 CID 兼容层；查询失败时仍可按节点名选择 Canvas/场景根。
  const componentClasses = scene.queryComponents === undefined
    ? []
    : await scene.queryComponents().catch(() => []);
  const placementTarget = resolveRoomPlacementTarget(tree, context, componentClasses);
  if (!placementTarget.ok) return { ok: false, message: placementTarget.message };
  if (placementTarget.node.uuid === undefined) return { ok: false, message: '放置目标缺少 UUID，无法创建房间' };

  let position: { readonly x: number; readonly y: number } | undefined;
  if (placementTarget.mode === 'grid') {
    const candidate = await scene.executeComponentMethod(
      placementTarget.settings.uuid,
      'findFirstAvailableRoomPlacement',
      [entry.width, entry.height],
    ) as { readonly x?: number; readonly y?: number } | null;
    if (candidate === null || !Number.isInteger(candidate?.x) || !Number.isInteger(candidate?.y)) {
      return { ok: false, message: `没有可放置 ${entry.displayName} 的合法空位` };
    }
    position = { x: candidate.x as number, y: candidate.y as number };
  }
  const existingIds = await collectRoomInstanceIds(scene, tree, componentClasses);
  let createdUuid: string | undefined;
  let undoId: string | undefined;
  try {
    undoId = await scene.beginRecording(placementTarget.node.uuid);
    const created = await scene.createNode({
      parent: placementTarget.node.uuid,
      name: `房间-${entry.displayName}`,
      assetUuid: entry.prefabUuid,
      type: 'cc.Prefab',
      position: { x: 0, y: 0, z: 0 },
      unlinkPrefab: false,
    });
    createdUuid = created?.uuid;
    if (createdUuid === undefined) throw new Error(`创建房间 Prefab 失败：${entry.prefabUrl}`);

    const linkedNodes = await scene.queryNodesByAssetUuid(entry.prefabUuid);
    if (!linkedNodes.includes(createdUuid)) {
      throw new Error(`创建结果未保留 Prefab 关联：${entry.prefabUrl}`);
    }

    const createdTree = await scene.queryNodeTree();
    const createdNode = findNode(createdTree, createdUuid);
    const roomViewComponent = createdNode === null ? null : findComponentInNode(createdNode, 'RoomView', componentClasses);
    const roomViewUuid = getSceneComponentUuid(roomViewComponent);
    if (roomViewUuid === undefined) throw new Error('生成的 Prefab 缺少 RoomView 组件');

    const instanceId = nextRoomInstanceId(createdTree, entry.id, existingIds);
    const roomViewTarget = getSceneComponentTarget(roomViewComponent);
    if (roomViewTarget === undefined) throw new Error('生成的 Prefab 缺少可编辑的 RoomView 组件定位');
    if (!(await scene.setProperty(roomViewTarget, 'roomInstanceId', instanceId, { record: false }))) {
      throw new Error('无法写入房间实例 ID');
    }
    if (placementTarget.mode === 'grid') {
      const applied = await scene.executeComponentMethod(
        roomViewUuid,
        'applyEditorPlacement',
        [{ x: position?.x, y: position?.y }],
      );
      if (applied !== true) throw new Error('无法把房间吸附到合法逻辑格');
    }

    await scene.endRecording(undoId);
    undoId = undefined;
    selectNode(createdUuid);
    // 聚焦只是编辑器体验增强；Undo 已提交后，聚焦失败不能反向删除已成功创建的房间。
    await focusNode(createdUuid).catch(() => undefined);
    const placementMessage = placementTarget.mode === 'grid'
      ? '已按逻辑网格放置'
      : placementTarget.mode === 'canvas' ? '已放到 Canvas 顶层' : '已放到场景顶层';
    return { ok: true, message: `已创建 ${entry.displayName}，${placementMessage}，实例 ID：${instanceId}`, nodeUuid: createdUuid };
  } catch (error) {
    if (createdUuid !== undefined) await scene.removeNode(createdUuid).catch(() => undefined);
    if (undoId !== undefined) await scene.cancelRecording(undoId).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(error)}；已回滚临时房间节点` };
  }
}

function resolveCanvasNode(
  tree: SceneNodeTree,
  context: SceneSelectionContext,
  componentClasses: readonly SceneComponentClassInfo[],
): SceneNodeTree | undefined {
  const nodes = flattenTree(tree);
  const byUuid = new Map(nodes.filter((node) => typeof node.uuid === 'string').map((node) => [node.uuid as string, node]));
  let cursor = context.nodeUuid === undefined ? undefined : byUuid.get(context.nodeUuid);
  while (cursor !== undefined) {
    if (isCanvasNode(cursor, componentClasses)) return cursor;
    cursor = cursor.parent === undefined ? undefined : byUuid.get(cursor.parent);
  }
  return nodes.find((node) => isCanvasNode(node, componentClasses));
}

function isCanvasNode(node: SceneNodeTree, componentClasses: readonly SceneComponentClassInfo[]): boolean {
  return isPrototypeSceneNodeName(node.name, 'canvas')
    || (node.components ?? []).some((component) => componentTypeMatches(component, 'Canvas', componentClasses));
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree, parentUuid?: string): void => {
    result.push(parentUuid === undefined || node.parent !== undefined ? node : { ...node, parent: parentUuid });
    for (const child of node.children ?? []) visit(child, node.uuid);
  };
  visit(tree);
  return result;
}

function findNode(tree: SceneNodeTree, uuid: string): SceneNodeTree | null {
  return flattenTree(tree).find((node) => node.uuid === uuid) ?? null;
}

function findComponentInNode(
  node: SceneNodeTree,
  type: string,
  componentClasses: readonly SceneComponentClassInfo[],
): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = {
      ...component,
      nodeUuid: component.nodeUuid ?? node.uuid,
      index: component.index ?? index,
    };
    if (componentTypeMatches(candidate, type, componentClasses)) return candidate;
  }
  return null;
}

async function collectRoomInstanceIds(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  componentClasses: readonly SceneComponentClassInfo[],
): Promise<string[]> {
  const result: string[] = [];
  for (const node of flattenTree(tree)) {
    for (const component of node.components ?? []) {
      if (!componentTypeMatches(component, 'RoomView', componentClasses)) continue;
      const componentUuid = getSceneComponentUuid(component);
      if (componentUuid === undefined) continue;
      try {
        const queried = await scene.queryComponent(componentUuid);
        const id = readStringProperty(queried?.value?.roomInstanceId);
        if (id !== undefined) result.push(id);
      } catch {
        // 旧 Prefab 的单组件查询失败不应阻断创建，最终唯一性仍由运行时校验。
      }
    }
  }
  return result;
}

function readStringProperty(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const nested = (value as { value?: unknown }).value;
  return typeof nested === 'string' && nested.length > 0 ? nested : undefined;
}

function selectNode(uuid: string): void {
  const selection = (globalThis as { Editor?: { Selection?: { select?: (type: string, uuid: string) => void } } }).Editor?.Selection;
  selection?.select?.('node', uuid);
}

async function focusNode(uuid: string): Promise<void> {
  await (globalThis as { Editor?: { Message?: { request?: (...args: unknown[]) => Promise<unknown> } } }).Editor?.Message?.request?.(
    'scene',
    'focus-camera',
    [uuid],
  );
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
