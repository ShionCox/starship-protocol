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

/** 面板创建房间实例的原子操作：失败不留下节点，成功只生成一个 Undo 快照。 */
export async function createRoomInstance(
  scene: SceneQueryPort,
  context: SceneSelectionContext,
  entry: RoomPrefabCatalogEntry,
): Promise<RoomSceneAuthoringResult> {
  const tree = await scene.queryNodeTree();
  const roomRootResult = resolveRoomRoot(tree, context);
  if (!roomRootResult.ok) return { ok: false, message: roomRootResult.message };
  if (roomRootResult.node.uuid === undefined) return { ok: false, message: 'RoomRoot 缺少 UUID，无法创建房间' };

  const componentClasses = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  const settingsTarget = findComponent(tree, 'PrototypeSceneSettings', componentClasses);
  if (settingsTarget === null) {
    return { ok: false, message: '场景缺少 PrototypeSceneSettings，请先初始化 Prototype 场景骨架' };
  }
  const position = await scene.executeComponentMethod(
    settingsTarget.uuid,
    'findFirstAvailableRoomPlacement',
    [entry.width, entry.height],
  ) as { readonly x?: number; readonly y?: number } | null;
  if (position === null || !Number.isInteger(position?.x) || !Number.isInteger(position?.y)) {
    return { ok: false, message: `没有可放置 ${entry.displayName} 的合法空位` };
  }
  const existingIds = await collectRoomInstanceIds(scene, tree, componentClasses);
  let createdUuid: string | undefined;
  try {
    const created = await scene.createNode({
      parent: roomRootResult.node.uuid,
      name: `房间-${entry.displayName}`,
      assetUuid: entry.prefabUuid,
      position: { x: 0, y: 0, z: 0 },
    });
    createdUuid = created?.uuid;
    if (createdUuid === undefined) throw new Error(`创建房间 Prefab 失败：${entry.prefabUrl}`);

    const createdTree = await scene.queryNodeTree();
    const createdNode = findNode(createdTree, createdUuid);
    const roomViewComponent = createdNode === null ? null : findComponentInNode(createdNode, 'RoomView', componentClasses);
    const roomViewUuid = getSceneComponentUuid(roomViewComponent);
    if (roomViewUuid === undefined) throw new Error('生成的 Prefab 缺少 RoomView 组件');

    const instanceId = nextRoomInstanceId(createdTree, entry.id, existingIds);
    const roomViewTarget = getSceneComponentTarget(roomViewComponent);
    if (roomViewTarget === undefined) throw new Error('生成的 Prefab 缺少可编辑的 RoomView 组件定位');
    if (!(await scene.setProperty(roomViewTarget, 'roomInstanceId', instanceId))) {
      throw new Error('无法写入房间实例 ID');
    }
    const applied = await scene.executeComponentMethod(
      roomViewUuid,
      'applyEditorPlacement',
      [{ x: position.x, y: position.y }],
    );
    if (applied !== true) throw new Error('无法把房间吸附到合法逻辑格');

    await scene.snapshot();
    selectNode(createdUuid);
    await focusNode(createdUuid);
    return { ok: true, message: `已创建 ${entry.displayName}，实例 ID：${instanceId}`, nodeUuid: createdUuid };
  } catch (error) {
    if (createdUuid !== undefined) await scene.removeNode(createdUuid).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${toMessage(error)}；已回滚临时房间节点` };
  }
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

function findComponent(
  tree: SceneNodeTree,
  type: string,
  componentClasses: readonly SceneComponentClassInfo[],
): SceneComponentTarget | null {
  for (const node of flattenTree(tree)) {
    const component = findComponentInNode(node, type, componentClasses);
    const componentTarget = getSceneComponentTarget(component);
    if (componentTarget !== undefined) return componentTarget;
  }
  return null;
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
