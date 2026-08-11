import type { RoomPrefabCatalogEntry } from './rooms/discover-room-prefabs';
import type { CrewPrefabCatalogEntry } from './crew/discover-crew-prefabs';
import { isPrototypeSceneNodeName, type PrototypeSceneNodeKey } from './scene/prototype-scene-names';
import {
  componentTypeMatches,
  getSceneComponentUuid,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneNodeTree,
  type SceneQueryPort,
} from './shared/editor-scene';

export type AuthoringPageId = 'scene' | 'rooms' | 'crew' | 'validation';
export type AuthoringSelectionKind = 'none' | 'room-instance' | 'crew-instance' | 'scene-settings' | 'semantic-node' | 'node';

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

export interface SceneCoreParameters {
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly cellSize: number;
  readonly snapRoomsInEditor: boolean;
  readonly minScale: number;
  readonly maxScale: number;
  readonly zoomStep: number;
}

export interface SceneAppearanceSummary {
  readonly gridLineWidth?: number;
  readonly invalidHullCells: readonly { readonly x: number; readonly y: number }[];
  readonly gridBackgroundColor?: string;
  readonly gridLineColor?: string;
  readonly invalidHullCellColor?: string;
  readonly gridRootReferenced: boolean;
}

export interface AuthoringSceneSettingsSelection extends AuthoringNodeBase {
  readonly kind: 'scene-settings';
  readonly typeId: 'scene-settings';
  readonly page: 'scene';
  readonly core: SceneCoreParameters;
  readonly appearance: SceneAppearanceSummary;
  readonly componentStatus: { readonly sceneSettings: boolean; readonly cameraController: boolean };
}

export interface AuthoringSemanticSelection extends AuthoringNodeBase {
  readonly kind: 'semantic-node';
  readonly typeId: 'semantic-node';
  readonly page: 'scene';
  readonly semanticRole: PrototypeSceneNodeKey;
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
  | AuthoringSceneSettingsSelection
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
  { typeId: 'scene-settings', recognize: recognizeSceneSettings },
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
  let inspector: CrewInspectorResult | null = null;
  try {
    inspector = await context.scene.executeComponentMethod(componentUuid, 'getAuthoringInspectorState', []) as CrewInspectorResult | null;
  } catch {
    // 旧 CrewView 仍通过公开 query-component 读取白名单字段。
  }
  if (inspector === null || typeof inspector !== 'object') {
    try {
      const queried = await context.scene.queryComponent(componentUuid);
      inspector = {
        ok: false,
        message: '当前 CrewView 脚本未提供编辑器查询状态',
        crewInstanceId: readStringProperty(queried?.value?.crewInstanceId),
        crewDefinitionId: readStringProperty(queried?.value?.crewDefinitionId),
        initialRoomInstanceId: readStringProperty(queried?.value?.initialRoomInstanceId),
        initialStationIndex: readFiniteNumber(unwrapRecord(queried?.value), 'initialStationIndex'),
      };
    } catch {
      inspector = { ok: false, message: '无法读取 CrewView 实例状态' };
    }
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

  let inspector: RoomInspectorResult | null = null;
  try {
    inspector = await context.scene.executeComponentMethod(componentUuid, 'getAuthoringInspectorState', []) as RoomInspectorResult | null;
  } catch {
    // 旧脚本没有查询方法时仍显示实例基础信息，避免面板退化为空白。
  }
  if (inspector === null || typeof inspector !== 'object') {
    try {
      const queried = await context.scene.queryComponent(componentUuid);
      inspector = {
        ok: false,
        message: '当前 RoomView 脚本未提供编辑器查询状态',
        roomInstanceId: readStringProperty(queried?.value?.roomInstanceId),
        roomDefinitionId: readStringProperty(queried?.value?.roomDefinitionId),
      };
    } catch {
      inspector = { ok: false, message: '无法读取 RoomView 实例状态' };
    }
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

async function recognizeSceneSettings(context: AuthoringObjectRecognizerContext): Promise<AuthoringSceneSettingsSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const settings = findComponentInNode(node, 'PrototypeSceneSettings', context.componentClasses);
  const camera = findComponentInNode(node, 'CameraController', context.componentClasses);
  // AppRoot 的可编辑契约要求两个权威组件同时存在；缺一个时交给语义/普通节点回退，
  // 避免把半配置节点误显示成可以保存的场景设置。
  if (settings === null || camera === null) return null;

  const settingsValue = await queryComponentValue(context.scene, settings);
  const cameraValue = await queryComponentValue(context.scene, camera);
  const core = {
    gridColumns: readFiniteNumber(settingsValue, 'gridColumns'),
    gridRows: readFiniteNumber(settingsValue, 'gridRows'),
    cellSize: readFiniteNumber(settingsValue, 'cellSize'),
    snapRoomsInEditor: readBoolean(settingsValue, 'snapRoomsInEditor'),
    minScale: readFiniteNumber(cameraValue, 'minScale'),
    maxScale: readFiniteNumber(cameraValue, 'maxScale'),
    zoomStep: readFiniteNumber(cameraValue, 'zoomStep'),
  };
  const invalidHullCells = readGridPositions(settingsValue?.invalidHullCells);
  return {
    kind: 'scene-settings',
    typeId: 'scene-settings',
    page: 'scene',
    ...nodeInfo(node, context.tree),
    core,
    appearance: {
      gridLineWidth: readFiniteNumber(settingsValue, 'gridLineWidth'),
      invalidHullCells,
      gridBackgroundColor: readColor(settingsValue?.gridBackgroundColor),
      gridLineColor: readColor(settingsValue?.gridLineColor),
      invalidHullCellColor: readColor(settingsValue?.invalidHullCellColor),
      gridRootReferenced: hasReference(settingsValue?.gridRoot),
    },
    componentStatus: { sceneSettings: settings !== null, cameraController: camera !== null },
  };
}

async function recognizeSemanticNode(context: AuthoringObjectRecognizerContext): Promise<AuthoringSemanticSelection | null> {
  const node = context.selectedNode;
  if (node === undefined) return null;
  const keys: readonly PrototypeSceneNodeKey[] = [
    'mainCamera', 'canvas', 'background', 'worldRoot', 'shipRoot', 'gridRoot', 'roomRoot', 'crewRoot', 'previewRoot', 'uiRoot', 'hudLayer', 'appRoot',
  ];
  const semanticRole = keys.find((key) => isPrototypeSceneNodeName(node.name, key));
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

async function queryComponentValue(scene: SceneQueryPort, component: SceneComponentInfo | null): Promise<Record<string, unknown> | undefined> {
  const uuid = getSceneComponentUuid(component);
  if (uuid === undefined) return undefined;
  try {
    const property = await scene.queryComponent(uuid);
    return unwrapRecord(property?.value);
  } catch {
    return undefined;
  }
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

function unwrapRecord(value: unknown): Record<string, unknown> | undefined {
  const result = unwrap(value);
  return typeof result === 'object' && result !== null && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
}

function readProperty(record: Record<string, unknown> | undefined, key: string): unknown {
  return unwrap(record?.[key]);
}

function readFiniteNumber(record: Record<string, unknown> | undefined, key: string): number {
  const value = readProperty(record, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean {
  return readProperty(record, key) === true;
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

function readGridPositions(value: unknown): readonly { readonly x: number; readonly y: number }[] {
  const array = unwrap(value);
  if (!Array.isArray(array)) return [];
  return array.filter(isGridPosition).map((position) => ({ x: position.x, y: position.y }));
}

function readColor(value: unknown): string | undefined {
  const record = unwrapRecord(value);
  if (record === undefined) return undefined;
  const channels = ['r', 'g', 'b', 'a'].map((key) => {
    const channel = unwrap(record[key]);
    return typeof channel === 'number' && Number.isFinite(channel) ? Math.max(0, Math.min(255, Math.round(channel))) : undefined;
  });
  if (channels.some((channel) => channel === undefined)) return undefined;
  return `#${channels.map((channel) => (channel as number).toString(16).padStart(2, '0')).join('')}`;
}

function hasReference(value: unknown): boolean {
  const record = unwrapRecord(value);
  return typeof record?.uuid === 'string' && record.uuid !== '';
}
