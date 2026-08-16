import assert from 'node:assert/strict';
import test from 'node:test';

import { SHIP_LAYOUT_SCHEMA_VERSION, ShipGridModel, restoreShipLayout, serializeShipLayout } from '../../assets/scripts/game-core/ShipGridModel.ts';
import { hull, placement } from './fixtures.ts';

test('布局快照保存船体、定义ID、实例ID和逻辑坐标并可恢复', () => {
  const definition = hull();
  const grid = new ShipGridModel(definition);
  grid.placeRoom(placement('room-reactor-1', 'room-reactor', 3, 4));
  const json = serializeShipLayout(grid);
  const raw = JSON.parse(json) as Record<string, unknown>;
  assert.equal(raw.schemaVersion, SHIP_LAYOUT_SCHEMA_VERSION);
  assert.equal(raw.hullId, definition.id);
  assert.equal('worldPosition' in raw, false);
  const restored = restoreShipLayout(json, definition);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.grid.getRooms(), grid.getRooms());
});

test('损坏、版本不兼容、船体不匹配、重叠和重复实例安全失败', () => {
  const definition = hull();
  assert.equal(restoreShipLayout('{', definition).ok, false);
  assert.equal(restoreShipLayout(JSON.stringify({ schemaVersion: 2 }), definition).ok, false);
  assert.equal(restoreShipLayout(JSON.stringify({ schemaVersion: 1, hullId: 'hull-other', rooms: [] }), definition).ok, false);
  const invalidSnapshots = [
    [placement('room-a-1', 'room-a', 0, 0), placement('room-b-1', 'room-b', 1, 1)],
    [placement('room-a-1', 'room-a', 0, 0, 1, 1), placement('room-a-1', 'room-a', 2, 0, 1, 1)],
    [{ ...placement('room-a-1', 'room-a', 0, 0, 1, 1), x: 0.5 }],
  ];
  for (const rooms of invalidSnapshots) {
    assert.equal(restoreShipLayout(JSON.stringify({ schemaVersion: 1, hullId: definition.id, rooms }), definition).ok, false);
  }
});

test('恢复时按当前船体Mask重新校验', () => {
  const mask = Array<'BUILDABLE' | 'VOID'>(20 * 10).fill('BUILDABLE');
  for (let y = 8; y < 10; y += 1) for (let x = 0; x < 2; x += 1) mask[y * 20 + x] = 'VOID';
  const definition = hull('hull-mask', 20, 10, mask);
  const json = JSON.stringify({ schemaVersion: 1, hullId: definition.id, rooms: [placement('room-reactor-1', 'room-reactor', 0, 8)] });
  assert.equal(restoreShipLayout(json, definition).ok, false);
});
