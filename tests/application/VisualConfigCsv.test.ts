import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseVisualConfigCsv } from '../../assets/scripts/presentation/VisualConfigCsv.ts';

const root = new URL('../../assets/config/csv/', import.meta.url);
const visuals = readFileSync(new URL('visuals.csv', root), 'utf8');
const frames = readFileSync(new URL('visual-frames.csv', root), 'utf8');

test('视觉 CSV 使用中文说明行并解析四类视觉帧', () => {
  const parsed = parseVisualConfigCsv(visuals, frames);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.visuals.length, 13);
    assert.equal(parsed.frames.length, 32);
    assert.deepEqual(new Set(parsed.visuals.map((visual) => visual.kind)), new Set(['ROOM', 'CREW', 'HULL', 'FLOOR']));
    assert.deepEqual(parsed.visuals.find((visual) => visual.visualId === 'visual-hull-starter'), {
      visualId: 'visual-hull-starter', displayName: '初始护卫舰船体', kind: 'HULL', assetPath: 'assets/textures/pss/ship/hull-starter-4324.png', imageWidth: 500, imageHeight: 250, frameCount: 1, pivot: 'CENTER', filter: 'NEAREST', playbackMode: 'STATIC', fps: 1, taskFps: 1, idleFrameIndex: 0, displayScalePermille: 1000, gridOffsetX: 0, gridOffsetY: 0,
    });
    assert.deepEqual(parsed.frames.find((frame) => frame.visualId === 'visual-pss-room-reactor-808' && frame.frameIndex === 4), {
      id: 'frame-visual-pss-room-reactor-808-4', displayName: '反应堆帧5', visualId: 'visual-pss-room-reactor-808', frameIndex: 4, x: 0, y: 102, width: 100, height: 50,
    });
  }
});

test('视觉 CSV 拒绝缺失中文说明、帧越界和帧数不匹配', () => {
  assert.equal(parseVisualConfigCsv(visuals.replace('#稳定标识', '说明'), frames).ok, false);
  assert.equal(parseVisualConfigCsv(visuals, frames.replace(',0,0,32,32', ',0,0,320,320')).ok, false);
  assert.equal(parseVisualConfigCsv(visuals.replace(',2,BOTTOM_CENTER', ',3,BOTTOM_CENTER'), frames).ok, false);
});

test('视觉几何字段严格校验缩放范围与整数网格偏移', () => {
  const valid = parseVisualConfigCsv(visuals.replace(',1000,0,0', ',250,-3,4'), frames);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    const visual = valid.visuals[0];
    assert.equal(visual.displayScalePermille, 250);
    assert.equal(visual.gridOffsetX, -3);
    assert.equal(visual.gridOffsetY, 4);
  }
  assert.equal(parseVisualConfigCsv(visuals.replace(',1000,0,0', ',0,0,0'), frames).ok, false);
  assert.equal(parseVisualConfigCsv(visuals.replace(',1000,0,0', ',10001,0,0'), frames).ok, false);
  assert.equal(parseVisualConfigCsv(visuals.replace(',1000,0,0', ',1000,1.5,0'), frames).ok, false);
  assert.equal(parseVisualConfigCsv(visuals.replace(',1000,0,0', ',1000,0,-2.5'), frames).ok, false);
  assert.equal(parseVisualConfigCsv(visuals.replace(',1000,0,0', ',1000,,0'), frames).ok, false);
});
