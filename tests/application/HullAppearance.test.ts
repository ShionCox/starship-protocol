import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('新手船外观由持久 HullAppearance 显示且不在运行时创建节点', () => {
  const appearance = readFileSync('assets/scripts/presentation/HullAppearance.ts', 'utf8');
  const ship = readFileSync('assets/scripts/presentation/ShipView.ts', 'utf8');
  assert.match(appearance, /@requireComponent\(Sprite\)/);
  assert.match(appearance, /Sprite\.SizeMode\.CUSTOM/);
  assert.match(appearance, /bakeAuthoringVisualAssets\(value: unknown\)/);
  assert.match(appearance, /持久船体帧/);
  assert.match(appearance, /固定画布宽度/);
  assert.match(appearance, /显示缩放千分比/);
  assert.match(appearance, /网格横向偏移/);
  assert.match(appearance, /new SpriteFrame\(\)/);
  assert.doesNotMatch(appearance, /assetManager\.loadAny/);
  assert.doesNotMatch(appearance, /spriteFrameUuid/);
  const runtimePath = appearance.match(/protected onEnable\(\): void \{([\s\S]*?)public bakeAuthoringVisualAssets/)?.[1] ?? '';
  assert.doesNotMatch(runtimePath, /new\s+SpriteFrame\s*\(/);
  assert.doesNotMatch(appearance, /new Node\(|addComponent\(/);
  assert.match(ship, /hullAppearanceRoot/);
  assert.match(ship, /getVisualDefinition\(hull\.visualId\)/);
  assert.match(ship, /node\.getComponent\(HullAppearance\)/);
  assert.match(ship, /applyVisualContain/);
  assert.match(ship, /displayScalePermille \/ 1000/);
  assert.match(ship, /gridOffsetX, gridOffsetY/);
  assert.match(ship, /逻辑内容根/);
});
