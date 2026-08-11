import {
  CrewModel,
  type CrewCommand,
  type CrewInitialState,
} from '../game-core/CrewModel.ts';
import type { NavigationGraph } from '../game-core/NavigationGraph.ts';
import type { KeyValueStorage } from './PrototypeLayoutStorage.ts';

export const PROTOTYPE_CREW_STORAGE_KEY = 'starship-protocol:r1:crew';

export type PrototypeCrewLoadResult =
  | { readonly status: 'empty' }
  | { readonly status: 'loaded'; readonly model: CrewModel }
  | { readonly status: 'error'; readonly message: string };

export type PrototypeCrewMutationResult = {
  readonly ok: boolean;
  readonly model: CrewModel;
  readonly message: string;
  readonly paused: boolean;
};

/** 船员状态使用独立 key，不修改 R0 布局或 R1 能源快照。 */
export function loadPrototypeCrew(
  navigation: NavigationGraph,
  initialStates: readonly CrewInitialState[],
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeCrewLoadResult {
  if (storage === null) return { status: 'error', message: '当前平台不提供 localStorage' };
  let json: string | null;
  try {
    json = storage.getItem(PROTOTYPE_CREW_STORAGE_KEY);
  } catch (cause) {
    return { status: 'error', message: `读取船员存档失败：${describeCause(cause)}` };
  }
  if (json === null) return { status: 'empty' };
  try {
    const restored = CrewModel.restore(navigation, initialStates, JSON.parse(json) as unknown);
    if (restored.ok === false) return { status: 'error', message: `${restored.code}：${restored.message}` };
    return { status: 'loaded', model: restored.model };
  } catch (cause) {
    return { status: 'error', message: `船员存档格式无效：${describeCause(cause)}` };
  }
}

export function savePrototypeCrew(
  model: CrewModel,
  storage: KeyValueStorage | null = getBrowserStorage(),
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (storage === null) return { ok: false, message: '当前平台不提供 localStorage' };
  try {
    storage.setItem(PROTOTYPE_CREW_STORAGE_KEY, JSON.stringify(model.getSnapshot()));
    return { ok: true };
  } catch (cause) {
    return { ok: false, message: `写入船员存档失败：${describeCause(cause)}` };
  }
}

export function applyPrototypeCrewCommand(
  model: CrewModel,
  navigation: NavigationGraph,
  initialStates: readonly CrewInitialState[],
  command: CrewCommand,
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeCrewMutationResult {
  const before = model.getSnapshot();
  const applied = model.apply(command);
  if (applied.ok === false) return { ok: false, model, message: applied.message, paused: false };
  const saved = savePrototypeCrew(model, storage);
  if (saved.ok === true) return { ok: true, model, message: applied.message, paused: false };
  const restored = CrewModel.restore(navigation, initialStates, before);
  return {
    ok: false,
    model: restored.ok ? restored.model : model,
    message: `船员命令保存失败：${saved.message}`,
    paused: false,
  };
}

/** 只有跨过导航边时写盘；失败后恢复旧状态并暂停时钟，避免显示未持久化位置。 */
export function advancePrototypeCrewTick(
  model: CrewModel,
  navigation: NavigationGraph,
  initialStates: readonly CrewInitialState[],
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeCrewMutationResult {
  const before = model.getSnapshot();
  const advanced = model.advanceOneTick();
  if (!advanced.crossedEdge) return { ok: true, model, message: '', paused: false };
  const saved = savePrototypeCrew(model, storage);
  if (saved.ok === true) return { ok: true, model, message: '', paused: false };
  const restored = CrewModel.restore(navigation, initialStates, before);
  return {
    ok: false,
    model: restored.ok ? restored.model : model,
    message: `船员状态保存失败，请刷新重试：${saved.message}`,
    paused: true,
  };
}

function getBrowserStorage(): KeyValueStorage | null {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
