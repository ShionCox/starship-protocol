import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHIP_LAYOUT_SCHEMA_VERSION,
  ShipGridModel,
  restoreShipLayout,
  serializeShipLayout,
} from '../../assets/scripts/game-core/ShipGridModel.ts';

test('布局快照只保存版本、逻辑网格和稳定房间 ID，并可完整恢复', () => {
  const grid = new ShipGridModel();
  assert.equal(grid.placeRoom({ id: 'room-reactor-1', x: 3, y: 4, width: 2, height: 2 }).ok, true);

  const json = serializeShipLayout(grid);
  const raw = JSON.parse(json) as Record<string, unknown>;
  assert.equal(raw.schemaVersion, SHIP_LAYOUT_SCHEMA_VERSION);
  assert.equal('worldPosition' in raw, false);
  assert.deepEqual(raw.rooms, [{ id: 'room-reactor-1', x: 3, y: 4, width: 2, height: 2 }]);

  const restored = restoreShipLayout(json, 20, 10);
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.deepEqual(restored.grid.getRooms(), grid.getRooms());
  }
});

test('损坏、版本不兼容、网格不匹配和重叠存档会安全失败', () => {
  assert.deepEqual(restoreShipLayout('{', 20, 10).ok, false);
  assert.deepEqual(restoreShipLayout(JSON.stringify({ schemaVersion: 2 }), 20, 10).ok, false);
  assert.deepEqual(
    restoreShipLayout(JSON.stringify({ schemaVersion: 1, gridWidth: 10, gridHeight: 10, rooms: [] }), 20, 10).ok,
    false,
  );
  const overlapping = JSON.stringify({
    schemaVersion: 1,
    gridWidth: 20,
    gridHeight: 10,
    rooms: [
      { id: 'room-a', x: 0, y: 0, width: 2, height: 2 },
      { id: 'room-b', x: 1, y: 1, width: 2, height: 2 },
    ],
  });
  assert.deepEqual(restoreShipLayout(overlapping, 20, 10).ok, false);

  const duplicateId = JSON.stringify({
    schemaVersion: 1,
    gridWidth: 20,
    gridHeight: 10,
    rooms: [
      { id: 'room-a', x: 0, y: 0, width: 1, height: 1 },
      { id: 'room-a', x: 2, y: 0, width: 1, height: 1 },
    ],
  });
  assert.deepEqual(restoreShipLayout(duplicateId, 20, 10).ok, false);

  const fractionalPosition = JSON.stringify({
    schemaVersion: 1,
    gridWidth: 20,
    gridHeight: 10,
    rooms: [{ id: 'room-a', x: 0.5, y: 0, width: 1, height: 1 }],
  });
  assert.deepEqual(restoreShipLayout(fractionalPosition, 20, 10).ok, false);
});

test('恢复布局时使用当前场景的有效船体格重新校验房间', () => {
  const validCells = [];
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      if (x > 1 || y < 8) {
        validCells.push({ x, y });
      }
    }
  }

  const roomOnInvalidHull = JSON.stringify({
    schemaVersion: 1,
    gridWidth: 20,
    gridHeight: 10,
    rooms: [{ id: 'room-reactor-1', x: 0, y: 8, width: 2, height: 2 }],
  });
  assert.equal(restoreShipLayout(roomOnInvalidHull, 20, 10, validCells).ok, false);
});
