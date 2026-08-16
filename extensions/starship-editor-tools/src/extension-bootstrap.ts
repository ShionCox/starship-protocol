import { PACKAGE_NAME } from './constants';

type MainModule = typeof import('./main');
type MessageMethod = (...args: unknown[]) => unknown;

let mainModulePromise: Promise<MainModule> | undefined;
let authoringOperationTail: Promise<void> = Promise.resolve();

/**
 * Creator 只有一个可见的 Scene/Prefab 编辑上下文。
 * 所有会打开资源、保存资源或调用 Scene API 的消息必须排队，
 * 否则面板轮询/连续点击会在前一个 facade 尚未稳定时切换到下一个资源。
 */
const CONTEXT_MUTATING_METHODS = new Set([
  'openCreatedPrefab',
  'importPssManifest',
  'bindFirstPssRoomAppearances',
  'bindFirstPssCrewAppearances',
  'importAndBindFirstPssHullAppearances',
  'importCsvConfigBundle',
  'saveCsvConfigBundle',
  'createRoomCsvDraft',
  'createCrewCsvDraft',
  'createHullCsvDraft',
  'previewRoomDefinition',
  'cancelAuthoringPreview',
  'saveRoomCsvDraft',
  'saveCrewCsvDraft',
  'previewCrewDefinition',
  'saveHullCsvDraft',
  'previewHullDefinition',
  'updateRoomInstance',
  'createRoomInstance',
  'createCrewInstance',
  'createShipInstance',
  'createOrUpdateScene',
]);

async function enqueueAuthoringOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = authoringOperationTail;
  let release!: () => void;
  authoringOperationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function getMainModule(): Promise<MainModule> {
  mainModulePromise ??= import('./main');
  return mainModulePromise;
}

/**
 * Creator 可在扩展的重型领域模块仍加载时响应菜单。面板入口保持轻量同步，
 * 其余消息按需转发到同一个 main 模块，避免首次点击出现 methods undefined。
 */
export const methods = new Proxy<Record<string, MessageMethod>>({
  openAuthoringPanel() {
    return Editor.Panel.open(`${PACKAGE_NAME}.authoring`);
  },
}, {
  get(target, property, receiver) {
    if (typeof property !== 'string' || property === 'then') return Reflect.get(target, property, receiver);
    const existing = Reflect.get(target, property, receiver) as MessageMethod | undefined;
    if (existing !== undefined) return existing;
    const delegated: MessageMethod = async (...args) => {
      const main = await getMainModule();
      const method = (main.methods as Record<string, MessageMethod>)[property];
      if (typeof method !== 'function') throw new Error(`扩展消息方法不存在：${property}`);
      if (!CONTEXT_MUTATING_METHODS.has(property)) return await method(...args);
      return await enqueueAuthoringOperation(async () => await method(...args));
    };
    Object.defineProperty(target, property, { value: delegated, enumerable: true, configurable: false });
    return delegated;
  },
});

export async function load(): Promise<void> {
  const main = await getMainModule();
  main.load();
}

export async function unload(): Promise<void> {
  const main = await getMainModule();
  main.unload();
}
