import type { RoomPrefabCatalogEntry } from './rooms/discover-room-prefabs';
import type { CrewPrefabCatalogEntry } from './crew/discover-crew-prefabs';
import { isSceneNodeName, type SceneNodeKey } from './scene/scene-names';
import {
  componentTypeMatches,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from './shared/editor-scene';

export type AuthoringPageId = 'scene' | 'hulls' | 'rooms' | 'crew' | 'validation';
export type AuthoringSelectionKind = 'none' | 'room-instance' | 'crew-instance' | 'ship-instance' | 'semantic-node' | 'node';

export interface AuthoringNodeBase {
  readonly uuid?: string;
  readonly name?: string;
  readonly path?: string;
  readonly position?: { readonly x?: number; readonly y?: number; readonly z?: number };
}

export interface AuthoringNoneSelection extends AuthoringNodeBase {
  readonly kind: 'none';
  readonly typeId: 'none';
  readonly page: 'scene';
}

export interface AuthoringRoomSelection extends AuthoringNodeBase {
  readonly kind: 'room-instance';
  readonly typeId: 'room-instance';
  readonly page: 'rooms';
  readonly instanceId?: string;
  readonly definitionId?: string;
  readonly gridPosition?: { readonly x: number; readonly y: number };
  readonly validation: { readonly ok: boolean; readonly message: string };
  readonly definitionFound: boolean;
}

export interface AuthoringCrewSelection extends AuthoringNodeBase {
  readonly kind: 'crew-instance';
  readonly typeId: 'crew-instance';
  readonly page: 'crew';
  readonly instanceId?: string;
  readonly definitionId?: string;
  readonly initialRoomInstanceId?: string;
  readonly initialStationIndex?: number;
  readonly validation: { readonly ok: boolean; readonly message: string };
  readonly definitionFound: boolean;
}

export interface AuthoringShipSelection extends AuthoringNodeBase {
  readonly kind: 'ship-instance';
  readonly typeId: 'ship-instance';
  readonly page: 'hulls';
  readonly shipId?: string;
  readonly hullDefinitionId?: string;
  readonly validation: { readonly ok: boolean; readonly message: string };
}

export interface AuthoringSemanticSelection extends AuthoringNodeBase {
  readonly kind: 'semantic-node';
  readonly typeId: 'semantic-node';
  readonly page: 'scene';
  readonly semanticRole: SceneNodeKey;
}

export interface AuthoringNodeSelection extends AuthoringNodeBase {
  readonly kind: 'node';
  readonly typeId: 'node';
  readonly page: 'scene';
}

export type AuthoringSelection =
  | AuthoringNoneSelection
  | AuthoringRoomSelection
  | AuthoringCrewSelection
  | AuthoringShipSelection
  | AuthoringSemanticSelection
  | AuthoringNodeSelection;

export interface AuthoringObjectRecognizerContext {
  readonly selectedNode?: SceneNodeTree;
  readonly tree: SceneNodeTree;
  readonly componentClasses: readonly SceneComponentClassInfo[];
  readonly scene: SceneQueryPort;
  readonly rooms: readonly RoomPrefabCatalogEntry[];
  readonly crews: readonly CrewPrefabCatalogEntry[];
}

export interface AuthoringObjectRecognizer {
  readonly typeId: AuthoringSelectionKind;
  recognize(context: AuthoringObjectRecognizerContext): Promise<AuthoringSelection | null>;
}

/**
 * 识别顺序是稳定契约：组件类型优先，标准骨架别名只用于语义节点，普通节点最后回退。
 * 后续领域必须显式注册识别器，不得通过扫描所有组件自动暴露属性。
 */
export const authoringObjectRecognizers: readonly AuthoringObjectRecognizer[] = [
  { typeId: 'room-instance', recognize: recognizeRoomInstance },
  { typeId: 'crew-instance', recognize: recognizeCrewInstance },
  { typeId: 'ship-instance', recognize: recognizeShipInstance },
  { typeId: 'semantic-node', recognize: recognizeSemanticNode },
  { typeId: 'node', recognize: recognizeNode },
];

export async function recognizeAuthoringSelection(context: AuthoringObjectRecognizerContext): Promise<AuthoringSelection> {
  if (context.selectedNode === undefined) {
    return { kind: 'none', typeId: 'none', page: 'scene' };
  }
  for (const recognizer of authoringObjectRecognizers) {
    const selection = await recognizer.recognize(context);
    if (selection !== null) return selection;
  }
  return { kind: 'node', typeId: 'node', page: 'scene', ...nodeInfo(context.selectedNode, context.tree) };
}

async function recognizeCrewInstance(context: AuthoringObjectRecognizerContext): Promise<AuthoringCrewSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const component = findComponentInNode(node, 'CrewView', context.componentClasses);
  const componentUuid = getSceneComponentUuid(component);
  if (componentUuid === undefined) return null;
  let inspector: CrewInspectorResult;
  try {
    inspector = await context.scene.executeComponentMethod(componentUuid, 'getAuthoringInspectorState', []) as CrewInspectorResult;
  } catch {
    inspector = { ok: false, message: '无法读取船员视图白名单状态' };
  }
  const definitionId = normalizeOptionalString(inspector.crewDefinitionId);
  return {
    kind: 'crew-instance',
    typeId: 'crew-instance',
    page: 'crew',
    ...nodeInfo(node, context.tree),
    instanceId: normalizeOptionalString(inspector.crewInstanceId),
    definitionId,
    initialRoomInstanceId: normalizeOptionalString(inspector.initialRoomInstanceId),
    initialStationIndex: typeof inspector.initialStationIndex === 'number' && Number.isInteger(inspector.initialStationIndex) ? inspector.initialStationIndex : undefined,
    validation: { ok: inspector.ok === true, message: typeof inspector.message === 'string' && inspector.message !== '' ? inspector.message : '未返回船员校验状态' },
    definitionFound: definitionId !== undefined && context.crews.some((entry) => entry.id === definitionId),
  };
}

async function recognizeRoomInstance(context: AuthoringObjectRecognizerContext): Promise<AuthoringRoomSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const component = findComponentInNode(node, 'RoomView', context.componentClasses);
  const componentUuid = getSceneComponentUuid(component);
  if (componentUuid === undefined) return null;

  let inspector: RoomInspectorResult;
  try {
    inspector = await context.scene.executeComponentMethod(componentUuid, 'getAuthoringInspectorState', []) as RoomInspectorResult;
  } catch {
    inspector = { ok: false, message: '无法读取房间视图白名单状态' };
  }
  const definitionId = normalizeOptionalString(inspector.roomDefinitionId);
  return {
    kind: 'room-instance',
    typeId: 'room-instance',
    page: 'rooms',
    ...nodeInfo(node, context.tree),
    instanceId: normalizeOptionalString(inspector.roomInstanceId),
    definitionId,
    gridPosition: isGridPosition(inspector.gridPosition) ? inspector.gridPosition : undefined,
    validation: {
      ok: inspector.ok === true,
      message: typeof inspector.message === 'string' && inspector.message !== '' ? inspector.message : '未返回房间校验状态',
    },
    definitionFound: definitionId !== undefined && context.rooms.some((entry) => entry.id === definitionId),
  };
}

async function recognizeShipInstance(context: AuthoringObjectRecognizerContext): Promise<AuthoringShipSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const component = findComponentInNode(node, 'ShipView', context.componentClasses);
  const componentUuid = getSceneComponentUuid(component);
  if (componentUuid === undefined) return null;
  let inspector: ShipInspectorResult;
  try {
    inspector = await context.scene.executeComponentMethod(componentUuid, 'getAuthoringInspectorState', []) as ShipInspectorResult;
  } catch {
    inspector = { ok: false, message: '无法读取飞船视图白名单状态' };
  }
  return {
    kind: 'ship-instance',
    typeId: 'ship-instance',
    page: 'hulls',
    ...nodeInfo(node, context.tree),
    shipId: normalizeOptionalString(inspector.shipId),
    hullDefinitionId: normalizeOptionalString(inspector.hullDefinitionId),
    validation: { ok: inspector.ok === true, message: typeof inspector.message === 'string' ? inspector.message : '未返回飞船校验状态' },
  };
}

async function recognizeSemanticNode(context: AuthoringObjectRecognizerContext): Promise<AuthoringSemanticSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const keys: readonly SceneNodeKey[] = [
    'mainCamera', 'canvas', 'worldRoot', 'currentShipMount', 'playerShipMount', 'enemyShipMount', 'shipView', 'gridRoot', 'roomRoot', 'crewRoot', 'effectRoot', 'projectileRoot', 'battleEnvironment', 'uiRoot', 'appRoot',
  ];
  const semanticRole = keys.find((key) => isSceneNodeName(node.name, key));
  if (semanticRole === undefined) return null;
  return { kind: 'semantic-node', typeId: 'semantic-node', page: 'scene', semanticRole, ...nodeInfo(node, context.tree) };
}

async function recognizeNode(context: AuthoringObjectRecognizerContext): Promise<AuthoringNodeSelection | null> {
  const node = context.selectedNode;
  return node === undefined ? null : { kind: 'node', typeId: 'node', page: 'scene', ...nodeInfo(node, context.tree) };
}

interface RoomInspectorResult {
  readonly ok?: boolean;
  readonly message?: string;
  readonly roomInstanceId?: unknown;
  readonly roomDefinitionId?: unknown;
  readonly gridPosition?: unknown;
}

interface CrewInspectorResult {
  readonly ok?: boolean;
  readonly message?: string;
  readonly crewInstanceId?: unknown;
  readonly crewDefinitionId?: unknown;
  readonly initialRoomInstanceId?: unknown;
  readonly initialStationIndex?: unknown;
}

interface ShipInspectorResult {
  readonly ok?: boolean;
  readonly message?: string;
  readonly shipId?: unknown;
  readonly hullDefinitionId?: unknown;
}

function findComponentInNode(
  node: SceneNodeTree,
  requestedType: string,
  classes: readonly SceneComponentClassInfo[],
): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, requestedType, classes)) return candidate;
  }
  return null;
}

function nodeInfo(node: SceneNodeTree, tree: SceneNodeTree): AuthoringNodeBase {
  return { uuid: node.uuid, name: node.name, path: getNodePath(tree, node.uuid), position: node.position };
}

function getNodePath(tree: SceneNodeTree, uuid: string | undefined): string | undefined {
  if (uuid === undefined) return undefined;
  const nodes = flattenTree(tree);
  const byUuid = new Map(nodes.filter((node) => typeof node.uuid === 'string').map((node) => [node.uuid as string, node]));
  const names: string[] = [];
  let cursor = byUuid.get(uuid);
  while (cursor !== undefined) {
    if (cursor.name !== undefined) names.unshift(cursor.name);
    cursor = cursor.parent === undefined ? undefined : byUuid.get(cursor.parent);
  }
  return names.join('/');
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

function unwrap(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !('value' in current)) return current;
    current = (current as { value: unknown }).value;
  }
  return current;
}

function readStringProperty(value: unknown): string | undefined {
  const result = unwrap(value);
  return typeof result === 'string' && result.trim() !== '' ? result.trim() : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return readStringProperty(value);
}

function isGridPosition(value: unknown): value is { readonly x: number; readonly y: number } {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
  return typeof record?.x === 'number' && Number.isInteger(record.x) && typeof record.y === 'number' && Number.isInteger(record.y);
}
