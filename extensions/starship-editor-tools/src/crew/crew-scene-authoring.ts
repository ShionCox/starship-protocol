import type { SceneSelectionContext } from '../contracts';
import { isPrototypeSceneNodeName } from '../scene/prototype-scene-names';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import type { CrewPrefabCatalogEntry } from './discover-crew-prefabs';

const TARGET_ROOM_INSTANCE_ID = 'room-reactor-1';

/** 船员场景实例化只允许进入唯一“船员层”，并保持 Prefab 关联和单次 Undo。 */
export async function createCrewInstance(
  scene: SceneQueryPort,
  _context: SceneSelectionContext,
  entry: CrewPrefabCatalogEntry,
): Promise<{ readonly ok: boolean; readonly message: string; readonly nodeUuid?: string }> {
  const tree = await scene.queryNodeTree();
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
  const roots = flattenTree(tree).filter((node) => isPrototypeSceneNodeName(node.name, 'crewRoot'));
  if (roots.length !== 1 || roots[0].uuid === undefined) return { ok: false, message: roots.length === 0 ? '场景缺少“船员层”，请先补齐 R1 船员场景' : '场景存在多个“船员层”，无法安全创建' };
  const targetRoom = await resolveTargetRoom(scene, tree, classes);
  if (targetRoom.ok === false) return targetRoom;
  const occupiedStations = await collectCrewStations(scene, tree, classes, targetRoom.roomInstanceId, targetRoom.crewCapacity);
  if (occupiedStations.ok === false) return occupiedStations;
  const stationIndex = findFirstFreeStation(targetRoom.crewCapacity, occupiedStations.stationIndexes);
  if (stationIndex === null) return { ok: false, message: `目标房间已满：${targetRoom.roomInstanceId}` };
  const existingIds = await collectCrewInstanceIds(scene, tree, classes);
  const instanceId = nextCrewInstanceId(entry.id, existingIds);
  let createdUuid: string | undefined;
  let undoId: string | undefined;
  try {
    undoId = await scene.beginRecording(roots[0].uuid);
    const created = await scene.createNode({ parent: roots[0].uuid, name: `船员-${entry.displayName}`, assetUuid: entry.prefabUuid, type: 'cc.Prefab', position: { x: 0, y: 0, z: 20 }, unlinkPrefab: false });
    createdUuid = created?.uuid;
    if (createdUuid === undefined) throw new Error(`创建船员 Prefab 失败：${entry.prefabUrl}`);
    if ((await scene.queryNodesByAssetUuid(entry.prefabUuid)).indexOf(createdUuid) === -1) throw new Error('创建结果未保留船员 Prefab 关联');
    const createdNode = flattenTree(await scene.queryNodeTree()).find((node) => node.uuid === createdUuid);
    const component = createdNode === undefined ? null : findComponent(createdNode, 'CrewView', classes);
    const target = getSceneComponentTarget(component);
    if (target === undefined) throw new Error('生成的船员 Prefab 缺少 CrewView');
    if (!(await scene.setProperty(target, 'crewInstanceId', instanceId, { record: false }))) throw new Error('无法写入船员实例 ID');
    if (!(await scene.setProperty(target, 'initialRoomInstanceId', targetRoom.roomInstanceId, { record: false }))) throw new Error('无法写入船员初始房间');
    if (!(await scene.setProperty(target, 'initialStationIndex', stationIndex, { record: false }))) throw new Error('无法写入船员初始站位');
    const placed = await scene.executeComponentMethod(target.uuid, 'applyEditorInitialPlacement', []);
    if (placed !== true) throw new Error('无法把船员放到编辑器初始站位');
    await scene.endRecording(undoId);
    undoId = undefined;
    selectNode(createdUuid);
    return { ok: true, message: `已创建 ${entry.displayName}，实例 ID：${instanceId}`, nodeUuid: createdUuid };
  } catch (cause) {
    if (createdUuid !== undefined) await scene.removeNode(createdUuid).catch(() => undefined);
    if (undoId !== undefined) await scene.cancelRecording(undoId).catch(() => undefined);
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；已回滚临时船员节点` };
  }
}

interface TargetRoom {
  readonly ok: true;
  readonly roomInstanceId: string;
  readonly crewCapacity: number;
}

interface TargetRoomFailure {
  readonly ok: false;
  readonly message: string;
}

interface CrewStations {
  readonly ok: true;
  readonly stationIndexes: readonly number[];
}

interface CrewStationsFailure {
  readonly ok: false;
  readonly message: string;
}

async function resolveTargetRoom(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  classes: readonly SceneComponentClassInfo[],
): Promise<TargetRoom | TargetRoomFailure> {
  for (const node of flattenTree(tree)) {
    const component = findComponent(node, 'RoomView', classes);
    const componentUuid = getSceneComponentUuid(component);
    if (componentUuid === undefined) continue;
    let state = await readComponentState(scene, componentUuid, 'getAuthoringInspectorState');
    if (readString(state, 'roomInstanceId') === undefined) {
      state = await readComponentState(scene, componentUuid, 'query-component');
    }
    const roomInstanceId = readString(state, 'roomInstanceId');
    if (roomInstanceId !== TARGET_ROOM_INSTANCE_ID) continue;
    if (state !== undefined && readBoolean(state, 'ok') === false) {
      return { ok: false, message: `目标房间校验失败：${readString(state, 'message') ?? '房间实例无效'}` };
    }
    const crewCapacity = readInteger(state, 'crewCapacity');
    if (crewCapacity === undefined || crewCapacity < 0) {
      return { ok: false, message: `目标房间容量无效：${TARGET_ROOM_INSTANCE_ID}` };
    }
    return { ok: true, roomInstanceId, crewCapacity };
  }
  return { ok: false, message: `目标房间不存在：${TARGET_ROOM_INSTANCE_ID}` };
}

async function collectCrewStations(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  classes: readonly SceneComponentClassInfo[],
  targetRoomInstanceId: string,
  crewCapacity: number,
): Promise<CrewStations | CrewStationsFailure> {
  const stationIndexes: number[] = [];
  for (const node of flattenTree(tree)) {
    const component = findComponent(node, 'CrewView', classes);
    const componentUuid = getSceneComponentUuid(component);
    if (componentUuid === undefined) continue;
    let state = await readComponentState(scene, componentUuid, 'getAuthoringInspectorState');
    if (state === undefined) {
      state = await readComponentState(scene, componentUuid, 'query-component');
    }
    if (state !== undefined && readBoolean(state, 'ok') === false) {
      return { ok: false, message: `已有船员校验失败：${readString(state, 'message') ?? '船员实例无效'}` };
    }
    const roomInstanceId = readString(state, 'initialRoomInstanceId');
    if (roomInstanceId !== targetRoomInstanceId) continue;
    const stationIndex = readInteger(state, 'initialStationIndex');
    if (stationIndex === undefined || stationIndex < 0) {
      return { ok: false, message: `已有船员初始站位无效：${roomInstanceId}` };
    }
    if (stationIndex >= crewCapacity) {
      return { ok: false, message: `已有船员初始站位超出目标房间容量：${stationIndex}（容量 ${crewCapacity}）` };
    }
    stationIndexes.push(stationIndex);
  }
  return { ok: true, stationIndexes };
}

function findFirstFreeStation(capacity: number, occupied: readonly number[]): number | null {
  const used = new Set(occupied);
  for (let stationIndex = 0; stationIndex < capacity; stationIndex += 1) {
    if (!used.has(stationIndex)) return stationIndex;
  }
  return null;
}

async function readComponentState(
  scene: SceneQueryPort,
  componentUuid: string,
  method: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    if (method === 'query-component') {
      const queried = await scene.queryComponent(componentUuid);
      return unwrapRecord(queried?.value);
    }
    const result = await scene.executeComponentMethod(componentUuid, method, []);
    return unwrapRecord(result);
  } catch {
    return undefined;
  }
}

export function nextCrewInstanceId(definitionId: string, existingIds: readonly string[]): string {
  const used = new Set(existingIds);
  let index = 1;
  while (used.has(`${definitionId}-${index}`)) index += 1;
  return `${definitionId}-${index}`;
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
function findComponent(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
}
async function collectCrewInstanceIds(scene: SceneQueryPort, tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[]): Promise<string[]> {
  const ids: string[] = [];
  for (const node of flattenTree(tree)) {
    const component = findComponent(node, 'CrewView', classes);
    const componentUuid = getSceneComponentUuid(component);
    if (componentUuid === undefined) continue;
    const queried = scene.queryComponent === undefined ? null : await scene.queryComponent(componentUuid).catch(() => null);
    const value = queried?.value?.crewInstanceId;
    const id = typeof value === 'string' ? value : typeof value === 'object' && value !== null ? (value as { value?: unknown }).value : undefined;
    if (typeof id === 'string' && id !== '') ids.push(id);
  }
  return ids;
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !('value' in current)) return current;
    current = (current as { readonly value: unknown }).value;
  }
  return current;
}

function unwrapRecord(value: unknown): Record<string, unknown> | undefined {
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = unwrap(record?.[key]);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readInteger(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = unwrap(record?.[key]);
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = unwrap(record?.[key]);
  return typeof value === 'boolean' ? value : undefined;
}
function selectNode(uuid: string): void {
  (globalThis as { Editor?: { Selection?: { select?: (type: string, uuid: string) => void } } }).Editor?.Selection?.select?.('node', uuid);
}
