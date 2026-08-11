import assert from 'node:assert/strict';
import test from 'node:test';

import { EnergyModel, type EnergyRoom } from '../../assets/scripts/game-core/EnergyModel.ts';
import {
  PROTOTYPE_ENERGY_STORAGE_KEY,
  applyPrototypeEnergyCommand,
  loadPrototypeEnergy,
  savePrototypeEnergy,
} from '../../assets/scripts/bootstrap/PrototypeEnergyStorage.ts';
import type { KeyValueStorage } from '../../assets/scripts/bootstrap/PrototypeLayoutStorage.ts';

const ROOMS: readonly EnergyRoom[] = [
  { id: 'room-reactor-1', powerGeneration: 10, minPower: 0, maxPower: 0 },
  { id: 'room-laser-1', minPower: 2, maxPower: 6 },
  { id: 'room-shield-1', minPower: 2, maxPower: 6 },
];

function storage(initial: string | null = null): KeyValueStorage & { value: string | null } {
  return {
    value: initial,
    getItem(key) { assert.equal(key, PROTOTYPE_ENERGY_STORAGE_KEY); return this.value; },
    setItem(key, value) { assert.equal(key, PROTOTYPE_ENERGY_STORAGE_KEY); this.value = value; },
  };
}

test('能源存档使用独立 key 保存和恢复', () => {
  const model = new EnergyModel(ROOMS);
  assert.equal(model.apply({ type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 6 }).ok, true);
  const target = storage();
  assert.deepEqual(savePrototypeEnergy(model, target), { ok: true });
  const loaded = loadPrototypeEnergy(ROOMS, target);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.deepEqual(loaded.model.getSnapshot(), model.getSnapshot());
});

test('缺失新房间时默认 0，未知旧房间或损坏快照整份失败', () => {
  const target = storage(JSON.stringify({ schemaVersion: 1, allocations: [{ roomId: 'room-laser-1', power: 6 }] }));
  const loaded = loadPrototypeEnergy(ROOMS, target);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.equal(loaded.model.getRoomPower('room-shield-1'), 0);

  target.value = JSON.stringify({ schemaVersion: 1, allocations: [{ roomId: 'room-old', power: 1 }] });
  assert.equal(loadPrototypeEnergy(ROOMS, target).status, 'error');
  target.value = '{bad json';
  assert.equal(loadPrototypeEnergy(ROOMS, target).status, 'error');
});

test('localStorage 读取和写入失败返回可观察错误', () => {
  const failing = {
    getItem() { throw new Error('读取失败'); },
    setItem() { throw new Error('写入失败'); },
  };
  assert.match(loadPrototypeEnergy(ROOMS, failing).status === 'error' ? loadPrototypeEnergy(ROOMS, failing).message : '', /读取失败/);
  const saveResult = savePrototypeEnergy(new EnergyModel(ROOMS), failing);
  assert.equal(saveResult.ok, false);
  if (!saveResult.ok) assert.match(saveResult.message, /写入失败/);
});

test('能源 Command 保存失败时恢复旧快照', () => {
  const model = new EnergyModel(ROOMS);
  const failing = { getItem() { return null; }, setItem() { throw new Error('磁盘只读'); } };
  const result = applyPrototypeEnergyCommand(
    model,
    ROOMS,
    { type: 'SET_ROOM_POWER', roomId: 'room-laser-1', power: 2 },
    failing,
  );
  assert.equal(result.ok, false);
  assert.equal(result.model.getRoomPower('room-laser-1'), 0);
  assert.match(result.message, /能源分配保存失败/);
});
