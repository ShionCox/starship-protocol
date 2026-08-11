import {
  EnergyModel,
  type EnergyCommand,
  type EnergyRoom,
} from '../game-core/EnergyModel.ts';
import type { KeyValueStorage } from './PrototypeLayoutStorage.ts';

export const PROTOTYPE_ENERGY_STORAGE_KEY = 'starship-protocol:r1:energy';

export type PrototypeEnergyLoadResult =
  | { readonly status: 'empty' }
  | { readonly status: 'loaded'; readonly model: EnergyModel }
  | { readonly status: 'error'; readonly message: string };

export type PrototypeEnergySaveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export type PrototypeEnergyCommandResult =
  | { readonly ok: true; readonly model: EnergyModel; readonly message: string }
  | { readonly ok: false; readonly model: EnergyModel; readonly message: string };

/** R1 能源独立存档；不把动态分配混入 R0 的 ShipLayoutSnapshot。 */
export function loadPrototypeEnergy(
  rooms: readonly EnergyRoom[],
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeEnergyLoadResult {
  if (storage === null) return { status: 'error', message: '当前平台不提供 localStorage' };

  let json: string | null;
  try {
    json = storage.getItem(PROTOTYPE_ENERGY_STORAGE_KEY);
  } catch (cause) {
    return { status: 'error', message: `读取能源存档失败：${describeCause(cause)}` };
  }
  if (json === null) return { status: 'empty' };

  try {
    const restored = EnergyModel.restore(rooms, JSON.parse(json) as unknown);
    if (restored.ok === false) return { status: 'error', message: `${restored.code}：${restored.message}` };
    return { status: 'loaded', model: restored.model };
  } catch (cause) {
    return { status: 'error', message: `能源存档格式无效：${describeCause(cause)}` };
  }
}

export function savePrototypeEnergy(
  model: EnergyModel,
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeEnergySaveResult {
  if (storage === null) return { ok: false, message: '当前平台不提供 localStorage' };
  try {
    storage.setItem(PROTOTYPE_ENERGY_STORAGE_KEY, JSON.stringify(model.getSnapshot()));
    return { ok: true };
  } catch (cause) {
    return { ok: false, message: `写入能源存档失败：${describeCause(cause)}` };
  }
}

/**
 * 统一执行“Command → 保存”事务；保存失败时返回恢复前快照的临时模型，调用方不得展示未持久化状态。
 */
export function applyPrototypeEnergyCommand(
  model: EnergyModel,
  rooms: readonly EnergyRoom[],
  command: EnergyCommand,
  storage: KeyValueStorage | null = getBrowserStorage(),
): PrototypeEnergyCommandResult {
  const before = model.getSnapshot();
  const applied = model.apply(command);
  if (applied.ok === false) {
    return { ok: false, model, message: applied.message };
  }
  const saved = savePrototypeEnergy(model, storage);
  if (saved.ok === true) {
    return { ok: true, model, message: '能源分配已保存' };
  }
  const restored = EnergyModel.restore(rooms, before);
  return {
    ok: false,
    model: restored.ok ? restored.model : model,
    message: `能源分配保存失败：${saved.message}`,
  };
}

function getBrowserStorage(): KeyValueStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
