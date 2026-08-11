import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type ColorDump = { readonly r: number; readonly g: number; readonly b: number; readonly a: number };

test('激光室和护盾室 Prefab 保存各自默认外观颜色', () => {
  assert.deepEqual(readRoomViewColor('LaserRoom.prefab', 'room-laser').fillColor, { r: 170, g: 45, b: 55, a: 245 });
  assert.deepEqual(readRoomViewColor('LaserRoom.prefab', 'room-laser').borderColor, { r: 255, g: 105, b: 115, a: 255 });
  assert.deepEqual(readRoomViewColor('LaserRoom.prefab', 'room-laser').coreColor, { r: 255, g: 190, b: 195, a: 255 });
  assert.deepEqual(readRoomViewColor('ShieldRoom.prefab', 'room-shield').fillColor, { r: 25, g: 120, b: 145, a: 245 });
  assert.deepEqual(readRoomViewColor('ShieldRoom.prefab', 'room-shield').borderColor, { r: 92, g: 225, b: 240, a: 255 });
  assert.deepEqual(readRoomViewColor('ShieldRoom.prefab', 'room-shield').coreColor, { r: 180, g: 250, b: 255, a: 255 });
});

function readRoomViewColor(fileName: string, definitionId: string): Record<string, ColorDump> {
  const document = JSON.parse(readFileSync(new URL(`../../assets/prefabs/${fileName}`, import.meta.url), 'utf8')) as unknown;
  const roomView = findRoomView(document, definitionId);
  assert.ok(roomView, `${fileName} 缺少 ${definitionId} 的 RoomView 数据`);
  return {
    fillColor: readColor(roomView.fillColor, `${fileName}.fillColor`),
    borderColor: readColor(roomView.borderColor, `${fileName}.borderColor`),
    coreColor: readColor(roomView.coreColor, `${fileName}.coreColor`),
  };
}

function findRoomView(value: unknown, definitionId: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findRoomView(child, definitionId);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.roomDefinitionId === definitionId) return record;
  for (const child of Object.values(record)) {
    const found = findRoomView(child, definitionId);
    if (found !== null) return found;
  }
  return null;
}

function readColor(value: unknown, label: string): ColorDump {
  assert.ok(typeof value === 'object' && value !== null, `${label} 不是颜色对象`);
  const color = value as Record<string, unknown>;
  for (const channel of ['r', 'g', 'b', 'a']) assert.equal(typeof color[channel], 'number', `${label}.${channel} 不是数字`);
  return {
    r: color.r as number,
    g: color.g as number,
    b: color.b as number,
    a: color.a as number,
  };
}
