import {
  editorAssetDb,
  getCurrentAuthoringAsset,
  markCurrentAuthoringAsset,
  noteAuthoringAssetOperation,
  retryTransientAssetOperation,
  waitForAuthoringAssetReady,
  waitForAuthoringQuiet,
} from './editor-asset-db';

export interface RoomAuthoringValidation { readonly ok: boolean; readonly message: string; }

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

/** Cocos 公开 set-property 所需的有类型属性 dump，例如 cc.Color。 */
export interface SceneTypedValue {
  readonly type: string;
  readonly value: unknown;
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
  /** Creator query-node-tree 在不同 3.8 小版本中可能返回 scale 或 _lscale。 */
  readonly scale?: { readonly x?: number; readonly y?: number; readonly z?: number };
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
    /** Creator 从资源创建节点时使用的公开资源类型。 */
    readonly type?: string;
    readonly position?: { readonly x: number; readonly y: number; readonly z: number };
    /** 明确保留 Prefab 关联；房间实例不得退化为复制出来的普通节点。 */
    readonly unlinkPrefab?: boolean;
    /** 是否由 Creator 为本次节点创建立即生成快照；批量操作由调用方统一录制或快照。 */
    readonly snapshot?: boolean;
  }): Promise<SceneNodeCreation | null>;
  queryNodesByAssetUuid(assetUuid: string): Promise<readonly string[]>;
  createComponent(nodeUuid: string, component: string): Promise<void>;
  /** Cocos 3.8 公开 remove-component，用于全新重建时移除旧脚本实例。 */
  removeComponent(componentUuid: string): Promise<void>;
  removeNode(nodeUuid: string): Promise<void>;
  setProperty(
    target: SceneComponentTarget | string,
    path: string,
    value: unknown,
    options?: { readonly record?: boolean },
  ): Promise<boolean>;
  queryComponent(componentUuid: string): Promise<SceneComponentProperty | null>;
  /** Cocos 公开组件注册表，用于把压缩 cid 还原为稳定类名。 */
  queryComponents?(): Promise<readonly SceneComponentClassInfo[]>;
  executeComponentMethod(componentUuid: string, name: string, args: readonly unknown[]): Promise<unknown>;
  /** 在已有父节点上开始一次公开 Scene 原子记录，新建子节点也会进入同一 Undo。 */
  beginRecording(nodeUuid: string): Promise<string>;
  /** 提交 beginRecording 创建的单次 Undo 记录。 */
  endRecording(undoId: string): Promise<void>;
  /** 失败时取消 beginRecording 创建的 Undo 记录。 */
  cancelRecording(undoId: string): Promise<void>;
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
      type: options.type,
      position: options.position,
      unlinkPrefab: options.unlinkPrefab ?? false,
      nameIncrease: true,
      snapshot: options.snapshot ?? false,
    });
    if (typeof result === 'string') return { uuid: result };
    return result as SceneNodeCreation | null;
  },
  async queryNodesByAssetUuid(assetUuid) {
    return await Editor.Message.request('scene', 'query-nodes-by-asset-uuid', assetUuid) as readonly string[];
  },
  async createComponent(nodeUuid, component) {
    let componentId = component;
    let matchedClass: SceneComponentClassInfo | undefined;
    let classes: readonly SceneComponentClassInfo[] = [];
    if (!component.startsWith('cc.')) {
      classes = await Editor.Message.request('scene', 'query-components') as readonly SceneComponentClassInfo[];
      matchedClass = classes.find((entry) => entry.name === component || entry.path === component);
      if (matchedClass === undefined) throw new Error(`Creator 尚未注册自定义组件：${component}`);
      componentId = matchedClass.cid ?? matchedClass.name ?? component;
    }
    await Editor.Message.request('scene', 'create-component', { uuid: nodeUuid, component: componentId });
    if (await nodeHasComponent(nodeUuid, component, classes)) return;

    // Creator 3.8 文档允许 cid 或 className；部分脚本刚重载时旧 cid 会留在搜索器缓存，
    // Scene 只写 Console 而不会 reject Message。用 className 重试并查询节点，避免虚报成功。
    if (matchedClass?.name !== undefined && matchedClass.name !== componentId) {
      await Editor.Message.request('scene', 'create-component', { uuid: nodeUuid, component: matchedClass.name });
      if (await nodeHasComponent(nodeUuid, component, classes)) return;
    }
    const registration = matchedClass === undefined ? componentId : JSON.stringify(matchedClass);
    throw new Error(`无法给节点 ${nodeUuid} 挂载 ${component}（注册信息：${registration}）`);
  },
  async removeComponent(componentUuid) {
    await Editor.Message.request('scene', 'remove-component', { uuid: componentUuid });
  },
  async removeNode(nodeUuid) {
    await Editor.Message.request('scene', 'remove-node', { uuid: nodeUuid });
  },
  async setProperty(target, path, value, options = {}) {
    const targetInfo = typeof target === 'string' ? undefined : target;
    const uuid = targetInfo?.nodeUuid ?? (typeof target === 'string' ? target : target.uuid);
    const propertyPath = targetInfo === undefined ? path : `__comps__.${targetInfo.index}.${path}`;
    const dump = isSceneReferenceValue(value)
      ? { type: value.type, value: { uuid: value.uuid } }
      : isSceneTypedValue(value) ? value : { value };
    try {
      return await Editor.Message.request('scene', 'set-property', {
        uuid,
        path: propertyPath,
        dump: dump as never,
        // 普通写入进入 Creator Undo；显式 begin-recording 内由调用方传 record:false，避免拆成多条记录。
        record: options.record ?? true,
      }) as boolean;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Creator 写入属性失败（${propertyPath}）：${message}`);
    }
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
  async beginRecording(nodeUuid) {
    return await Editor.Message.request('scene', 'begin-recording', nodeUuid) as string;
  },
  async endRecording(undoId) {
    await Editor.Message.request('scene', 'end-recording', undoId);
  },
  async cancelRecording(undoId) {
    await Editor.Message.request('scene', 'cancel-recording', undoId);
  },
  async snapshot() {
    await Editor.Message.request('scene', 'snapshot');
  },
  async snapshotAbort() {
    await Editor.Message.request('scene', 'snapshot-abort');
  },
};

/** `.scene` 必须使用 Scene 进程的公开 open-scene；Asset DB open-asset 只用于 Prefab/普通资源。 */
export async function openEditorSceneAsset(url: string): Promise<void> {
  const previous = getCurrentAuthoringAsset();
  if (previous !== null) await waitForAuthoringAssetReady(editorAssetDb, previous);
  await waitForAuthoringQuiet();
  const uuid = await Editor.Message.request('asset-db', 'query-uuid', url) as string | null;
  if (typeof uuid !== 'string' || uuid.trim() === '') throw new Error(`Creator Asset DB 找不到场景：${url}`);
  await retryTransientAssetOperation(async () => {
    await Editor.Message.request('scene', 'open-scene', uuid);
  });
  markCurrentAuthoringAsset(url);
}

/**
 * Creator 3.8.8 切换 Prefab 后可能仍在完成 Asset DB 导入，紧接着保存会短暂报
 * `UNKNOWN: unknown error, open ...prefab`。保存是幂等操作，统一在公开 Scene
 * 入口做有限重试，避免每个创作链各自复制等待逻辑。
 */
export async function saveAuthoringScene(
  options: { readonly quietMs?: number; readonly retryDelayMs?: number } = {},
): Promise<void> {
  const assetUrl = getCurrentAuthoringAsset();
  const retryDelayMs = options.retryDelayMs ?? 1000;
  if (assetUrl !== null) await waitForAuthoringAssetReady(editorAssetDb, assetUrl, { quietMs: options.quietMs });
  // Scene/Prefab 保存最终会进入 asset-db/save-asset。当前文档 imported=true
  // 仍可能与其它图集、Clip 的后台导入重叠，因此保存前必须经过同一全局屏障。
  await waitForAuthoringQuiet({ quietMs: options.quietMs });
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await Editor.Message.request('scene', 'save-scene');
      noteAuthoringAssetOperation(assetUrl);
      if (assetUrl !== null) await waitForAuthoringAssetReady(editorAssetDb, assetUrl, { quietMs: options.quietMs });
      return;
    } catch (cause) {
      lastError = cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/UNKNOWN|EBUSY|EPERM|\bopen\b/i.test(message) || attempt === 19) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

async function nodeHasComponent(nodeUuid: string, component: string, classes: readonly SceneComponentClassInfo[]): Promise<boolean> {
  const raw = await Editor.Message.request('scene', 'query-node', nodeUuid);
  const normalized = normalizeSceneNodeTree(raw);
  if ((normalized.components ?? []).some((entry) => componentTypeMatches(entry, component, classes))) return true;
  // Creator 某些版本只在 query-node-tree 返回完整组件注册信息，
  // query-node 的压缩 dump 可能只有 UUID；再读一次公开树，避免把已挂载组件误判为缺失。
  const tree = await Editor.Message.request('scene', 'query-node-tree');
  return flattenSceneTree(normalizeSceneNodeTree(tree)).some((node) => node.uuid === nodeUuid
    && (node.components ?? []).some((entry) => componentTypeMatches(entry, component, classes)));
}

function flattenSceneTree(tree: SceneNodeTree): readonly SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return result;
}

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

/** 从 Creator query-component 的多层 dump 中提取资源、节点或组件引用 UUID。 */
export function readSceneReferenceUuid(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  const record = asRecord(value);
  if (record === undefined) return undefined;
  for (const key of ['uuid', '__uuid__'] as const) {
    const uuid = readString(record[key]);
    if (uuid !== undefined && uuid.trim() !== '') return uuid;
  }
  return 'value' in record ? readSceneReferenceUuid(record.value, depth + 1) : undefined;
}

function isSceneReferenceValue(value: unknown): value is SceneReferenceValue {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { uuid?: unknown }).uuid === 'string';
}

function isSceneTypedValue(value: unknown): value is SceneTypedValue {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && 'value' in value;
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
  const positionValue = readValue(source.position ?? source._lpos);
  const positionRecord = asRecord(positionValue);
  const scaleValue = readValue(source.scale ?? source._lscale);
  const scaleRecord = asRecord(scaleValue);
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
    scale: scaleRecord === undefined ? undefined : {
      x: readNumber(scaleRecord.x),
      y: readNumber(scaleRecord.y),
      z: readNumber(scaleRecord.z),
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
