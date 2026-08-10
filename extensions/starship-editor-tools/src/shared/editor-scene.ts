import type { RoomAuthoringValidation } from '../rooms/validate-open-room-prefab';

export interface SceneComponentInfo {
  readonly uuid?: string;
  readonly type?: string;
  readonly name?: string;
  readonly cid?: string;
  readonly value?: string;
  readonly extends?: readonly string[];
  /** 所属节点与组件在 __comps__ 中的索引，供公开 set-property 组成路径。 */
  readonly nodeUuid?: string;
  readonly index?: number;
}

export interface SceneComponentTarget {
  readonly uuid: string;
  readonly nodeUuid: string;
  readonly index: number;
}

export interface SceneReferenceValue {
  readonly type: string;
  readonly uuid: string;
}

export interface SceneComponentClassInfo {
  readonly name?: string;
  readonly cid?: string;
  readonly path?: string;
  readonly assetUuid?: string;
}

export interface SceneNodeTree {
  readonly uuid?: string;
  readonly name?: string;
  readonly parent?: string;
  readonly position?: { readonly x?: number; readonly y?: number; readonly z?: number };
  readonly children?: readonly SceneNodeTree[];
  readonly components?: readonly SceneComponentInfo[];
  /** Cocos INode 的原始字段；适配器会优先归一化为 components。 */
  readonly __comps__?: readonly unknown[];
}

export interface SceneNodeCreation {
  readonly uuid?: string;
  readonly name?: string;
}

export interface SceneComponentProperty {
  readonly uuid?: string;
  readonly type?: string;
  readonly value?: Record<string, unknown>;
}

export interface SceneQueryPort {
  queryNodeTree(): Promise<SceneNodeTree>;
  validateRoomComponent(componentUuid: string): Promise<RoomAuthoringValidation>;
  createNode(options: {
    readonly parent: string;
    readonly name: string;
    readonly assetUuid?: string;
    readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  }): Promise<SceneNodeCreation | null>;
  createComponent(nodeUuid: string, component: string): Promise<void>;
  removeNode(nodeUuid: string): Promise<void>;
  setProperty(target: SceneComponentTarget | string, path: string, value: unknown): Promise<boolean>;
  queryComponent(componentUuid: string): Promise<SceneComponentProperty | null>;
  /** Cocos 公开组件注册表，用于把压缩 cid 还原为稳定类名。 */
  queryComponents?(): Promise<readonly SceneComponentClassInfo[]>;
  executeComponentMethod(componentUuid: string, name: string, args: readonly unknown[]): Promise<unknown>;
  /** 将一次面板操作收敛为一个公开 Scene 快照，供 Undo/Redo 使用。 */
  snapshot(): Promise<void>;
  /** 失败时丢弃当前公开 Scene 快照。 */
  snapshotAbort(): Promise<void>;
}

export const editorSceneQuery: SceneQueryPort = {
  async queryNodeTree() {
    const result = await Editor.Message.request('scene', 'query-node-tree');
    return normalizeSceneNodeTree(result);
  },
  async validateRoomComponent(componentUuid) {
    return await Editor.Message.request('scene', 'execute-component-method', {
      uuid: componentUuid,
      name: 'validateAuthoringDefinition',
      args: [],
    }) as RoomAuthoringValidation;
  },
  async createNode(options) {
    const result = await Editor.Message.request('scene', 'create-node', {
      parent: options.parent,
      name: options.name,
      assetUuid: options.assetUuid,
      position: options.position,
      nameIncrease: true,
      snapshot: false,
    });
    if (typeof result === 'string') return { uuid: result };
    return result as SceneNodeCreation | null;
  },
  async createComponent(nodeUuid, component) {
    await Editor.Message.request('scene', 'create-component', {
      uuid: nodeUuid,
      component,
    });
  },
  async removeNode(nodeUuid) {
    await Editor.Message.request('scene', 'remove-node', { uuid: nodeUuid });
  },
  async setProperty(target, path, value) {
    const targetInfo = typeof target === 'string' ? undefined : target;
    const uuid = targetInfo?.nodeUuid ?? (typeof target === 'string' ? target : target.uuid);
    const propertyPath = targetInfo === undefined ? path : `__comps__.${targetInfo.index}.${path}`;
    const dump = isSceneReferenceValue(value)
      ? { type: value.type, value: { uuid: value.uuid } }
      : { value };
    return await Editor.Message.request('scene', 'set-property', {
      uuid,
      path: propertyPath,
      dump: dump as never,
      record: false,
    }) as boolean;
  },
  async queryComponent(componentUuid) {
    return await Editor.Message.request('scene', 'query-component', componentUuid) as SceneComponentProperty | null;
  },
  async queryComponents() {
    return await Editor.Message.request('scene', 'query-components') as readonly SceneComponentClassInfo[];
  },
  async executeComponentMethod(componentUuid, name, args) {
    return await Editor.Message.request('scene', 'execute-component-method', {
      uuid: componentUuid,
      name,
      args,
    });
  },
  async snapshot() {
    await Editor.Message.request('scene', 'snapshot');
  },
  async snapshotAbort() {
    await Editor.Message.request('scene', 'snapshot-abort');
  },
};

/**
 * 判断 query-node-tree 返回的组件是否属于指定类。
 * Creator 3.8.8 有时返回脚本压缩 cid，有时返回类名；两种形式都必须支持，
 * 否则编辑器补齐会误判为缺组件并重复挂载。
 */
export function componentTypeMatches(
  component: SceneComponentInfo,
  requestedType: string,
  classes: readonly SceneComponentClassInfo[] = [],
): boolean {
  const normalizedRequested = requestedType.replace(/^cc\./, '');
  const candidates = [component.type, component.name, component.cid].filter((value): value is string => typeof value === 'string');
  if (candidates.some((candidate) => candidate === requestedType || candidate === normalizedRequested || candidate.replace(/^cc\./, '') === normalizedRequested)) return true;
  const matched = classes.find((entry) => (
    entry.name === requestedType || entry.name === normalizedRequested
  ));
  if (matched !== undefined && candidates.some((candidate) => candidate === matched.cid || candidate === matched.name || candidate === matched.path)) return true;
  return component.extends?.some((name) => name === requestedType || name === normalizedRequested) === true;
}

/** Cocos query-node-tree 使用 value 返回组件实例 UUID，测试桩和旧版本可能使用 uuid。 */
export function getSceneComponentUuid(component: SceneComponentInfo | null | undefined): string | undefined {
  if (typeof component?.value === 'string' && component.value.length > 0) return component.value;
  return typeof component?.uuid === 'string' && component.uuid.length > 0 ? component.uuid : undefined;
}

export function getSceneComponentTarget(component: SceneComponentInfo | null | undefined): SceneComponentTarget | undefined {
  const uuid = getSceneComponentUuid(component);
  if (uuid === undefined || typeof component?.nodeUuid !== 'string' || !Number.isInteger(component.index)) return undefined;
  return { uuid, nodeUuid: component.nodeUuid, index: component.index as number };
}

function isSceneReferenceValue(value: unknown): value is SceneReferenceValue {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { uuid?: unknown }).uuid === 'string';
}

/**
 * Cocos 3.8.8 的 query-node-tree 文档返回 components，但 INode 类型和部分构建仍返回 __comps__。
 * 统一成插件内部的小 DTO，避免把 IProperty dump 泄漏到场景创作逻辑。
 */
export function normalizeSceneNodeTree(raw: unknown, parentUuid?: string): SceneNodeTree {
  const source = asRecord(raw) ?? {};
  const uuid = readString(source.uuid);
  const name = readString(source.name);
  const parent = readString(source.parent) ?? parentUuid;
  const positionValue = readValue(source.position);
  const positionRecord = asRecord(positionValue);
  const componentSource = Array.isArray(source.components)
    ? source.components
    : Array.isArray(source.__comps__) ? source.__comps__ : [];
  const components = componentSource.map((item, index) => normalizeComponent(item, uuid, index));
  const children = Array.isArray(source.children)
    ? source.children.map((child) => normalizeSceneNodeTree(child, uuid))
    : [];
  return {
    uuid,
    name,
    parent,
    position: positionRecord === undefined ? undefined : {
      x: readNumber(positionRecord.x),
      y: readNumber(positionRecord.y),
      z: readNumber(positionRecord.z),
    },
    children,
    components,
  };
}

function normalizeComponent(raw: unknown, nodeUuid: string | undefined, index: number): SceneComponentInfo {
  const source = asRecord(raw) ?? {};
  const valueSource = asRecord(source.value);
  const uuid = readString(source.uuid) ?? readComponentUuid(valueSource);
  const value = typeof source.value === 'string' ? source.value : uuid;
  const extendsValue = Array.isArray(source.extends)
    ? source.extends.map(readString).filter((item): item is string => item !== undefined)
    : [];
  return {
    uuid,
    value,
    type: readString(source.type),
    name: readString(source.name),
    cid: readString(source.cid),
    extends: extendsValue,
    nodeUuid,
    index,
  };
}

function readComponentUuid(value: Record<string, unknown> | undefined): string | undefined {
  if (value === undefined) return undefined;
  return readString(value.uuid) ?? readString(value.value);
}

function readValue(value: unknown): unknown {
  const record = asRecord(value);
  return record !== undefined && 'value' in record ? record.value : value;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (record !== undefined && 'value' in record) return readString(record.value);
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, any> : undefined;
}
