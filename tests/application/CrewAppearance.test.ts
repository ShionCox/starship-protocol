import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appearanceSource = readFileSync(new URL('../../assets/scripts/presentation/CrewAppearance.ts', import.meta.url), 'utf8');
const authoringAssetsSource = readFileSync(new URL('../../assets/scripts/presentation/AuthoringAnimationAssets.ts', import.meta.url), 'utf8');
const crewViewSource = readFileSync(new URL('../../assets/scripts/presentation/CrewView.ts', import.meta.url), 'utf8');

test('船员原生外观声明三种两帧状态、最近邻与整数缩放', () => {
  assert.match(appearanceSource, /IDLE:\s*0/);
  assert.match(appearanceSource, /MOVING:\s*1/);
  assert.match(appearanceSource, /TASK:\s*2/);
  assert.match(appearanceSource, /NEAREST:\s*0/);
  assert.match(appearanceSource, /整数缩放/);
  assert.match(appearanceSource, /bakeAuthoringVisualAssets\(value: unknown\)/);
  assert.match(authoringAssetsSource, /AnimationClip\.createWithSpriteFrames/);
  assert.match(appearanceSource, /固定画布宽度/);
  assert.match(appearanceSource, /显示缩放千分比/);
  assert.match(appearanceSource, /网格横向偏移/);
  assert.match(appearanceSource, /idleFrames/);
  assert.match(appearanceSource, /movingFrames/);
  assert.match(appearanceSource, /taskFrames/);
});

test('船员外观不运行时创建节点或组件，也不在 update 手工切帧', () => {
  assert.doesNotMatch(appearanceSource, /new\s+Node\s*\(/);
  assert.doesNotMatch(appearanceSource, /addComponent\s*\(/);
  const updateBody = appearanceSource.match(/protected update\(\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.doesNotMatch(updateBody, /spriteFrame\s*=/);
  const runtimePath = appearanceSource.match(/protected onEnable\(\): void \{([\s\S]*?)public bakeAuthoringVisualAssets/)?.[1] ?? '';
  assert.doesNotMatch(runtimePath, /new\s+SpriteFrame\s*\(|AnimationClip\.createWithSpriteFrames/);
});

test('船员 Prefab 只消费持久动画资产，运行时不覆盖单格显示尺寸', () => {
  assert.match(appearanceSource, /loadAuthoringSpriteFrames/);
  assert.match(appearanceSource, /loadAuthoringAnimationClip/);
  assert.match(authoringAssetsSource, /EditorExtends\.serialize\(clip\)/);
  assert.doesNotMatch(appearanceSource, /new SpriteFrame\(\)/);
  assert.doesNotMatch(appearanceSource, /setContentSize\(this\.sourceCanvasWidth, this\.sourceCanvasHeight\)/);
});

test('静置状态停止原生动画并固定显示第零帧', () => {
  assert.match(appearanceSource, /state === 'IDLE'/);
  assert.match(appearanceSource, /getFrames\('IDLE'\)/);
  assert.match(appearanceSource, /this\.animation\?\.stop\(\)/);
  assert.match(appearanceSource, /this\.sprite\.spriteFrame = firstFrame/);
});

test('船员名称由 CrewView 统一持久样式化且不参与精灵翻转', () => {
  assert.doesNotMatch(appearanceSource, /candidate\.displayName|applyDisplayName|fallbackGraphics|setFallbackVisible/);
  assert.match(crewViewSource, /fontFamily = 'Microsoft YaHei'/);
  assert.match(crewViewSource, /fontSize = 14/);
  assert.match(crewViewSource, /lineHeight = 18/);
  assert.match(crewViewSource, /isBold = true/);
  assert.match(crewViewSource, /cacheMode = Label\.CacheMode\.NONE/);
  assert.match(crewViewSource, /enableShadow = false/);
  assert.match(crewViewSource, /enableOutline = true/);
  assert.match(crewViewSource, /outlineColor = Color\.BLACK/);
  assert.match(crewViewSource, /labelTransform|transform\?\.setContentSize\(128, 22\)/);
  assert.match(crewViewSource, /labelNode\.setPosition\(0, height \+ 8, 1\)/);
  assert.match(crewViewSource, /label\.node\.setScale\(facingCorrection \/ scaleX, 1 \/ scaleY, 1\)/);
  assert.match(appearanceSource, /bakeAuthoringVisualAssets\(value: unknown\)/);
});

test('CrewView 通过持久外观组件映射移动与任务状态', () => {
  assert.match(crewViewSource, /type: CrewAppearance/);
  assert.match(crewViewSource, /playState\(appearanceState\)/);
  assert.match(crewViewSource, /setFacingByDelta/);
  assert.match(crewViewSource, /visualRoot/);
  assert.match(crewViewSource, /getVisualMotionTarget/);
  assert.match(crewViewSource, /resetVisualMotion/);
  assert.doesNotMatch(crewViewSource, /setNavigation\(/);
  assert.match(crewViewSource, /const graphics = visualGraphics \?\? rootGraphics/);
  assert.match(crewViewSource, /y: Math\.min\(range\.maxY, Math\.max\(range\.minY, previous\.y\)\)/);
  assert.match(crewViewSource, /const stationY = room\.y - 0\.5/);
  assert.doesNotMatch(crewViewSource, /draw\(\): void \{[\s\S]*?visualRoot\.setPosition\(0, 0, 0\)/);
  assert.match(appearanceSource, /Graphics 表现|Graphics 回退/);
  assert.match(appearanceSource, /hasRenderableVisual/);
});
