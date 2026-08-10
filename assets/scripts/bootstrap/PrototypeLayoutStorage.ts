import {
  restoreShipLayout,
  serializeShipLayout,
  type GridPosition,
  type ShipGridModel,
} from '../game-core/ShipGridModel';

export const PROTOTYPE_LAYOUT_STORAGE_KEY = 'starship-protocol:r0:ship-layout';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PrototypeLayoutLoadResult =
  | { readonly status: 'empty' }
  | { readonly status: 'loaded'; readonly grid: ShipGridModel }
  | { readonly status: 'error'; readonly message: string };

export type PrototypeLayoutSaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** localStorage 只存在于 Web 适配层，GameCore 不感知浏览器 API。 */
export function loadPrototypeLayout(
  width: number,
  height: number,
  validCells?: readonly GridPosition[],
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeLayoutLoadResult {
  if (storage === null) {
    return { status: 'error', message: '当前平台不提供 localStorage' };
  }

  let json: string | null;
  try {
    json = storage.getItem(PROTOTYPE_LAYOUT_STORAGE_KEY);
  } catch (cause) {
    return { status: 'error', message: `读取 localStorage 失败：${describeCause(cause)}` };
  }
  if (json === null) {
    return { status: 'empty' };
  }

  const restored = restoreShipLayout(json, width, height, validCells);
  if (restored.ok === false) {
    return { status: 'error', message: `${restored.code}：${restored.message}` };
  }
  return { status: 'loaded', grid: restored.grid };
}

export function savePrototypeLayout(
  grid: ShipGridModel,
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeLayoutSaveResult {
  if (storage === null) {
    return { ok: false, message: '当前平台不提供 localStorage' };
  }

  try {
    storage.setItem(PROTOTYPE_LAYOUT_STORAGE_KEY, serializeShipLayout(grid));
    return { ok: true };
  } catch (cause) {
    return { ok: false, message: `写入 localStorage 失败：${describeCause(cause)}` };
  }
}

function getBrowserStorage(): KeyValueStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return candidate ?? null;
  } catch {
    // 某些隐私模式会在读取 localStorage 属性本身时抛出 SecurityError。
    return null;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
