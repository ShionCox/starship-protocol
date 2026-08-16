import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGameConfigCsvBundle } from '../../assets/scripts/game-core/CsvGameConfig.ts';

const appearanceSource = readFileSync(new URL('../../assets/scripts/presentation/RoomAppearance.ts', import.meta.url), 'utf8');
const authoringAssetsSource = readFileSync(new URL('../../assets/scripts/presentation/AuthoringAnimationAssets.ts', import.meta.url), 'utf8');
const roomViewSource = readFileSync(new URL('../../assets/scripts/presentation/RoomView.ts', import.meta.url), 'utf8');
const mainBootstrapSource = readFileSync(new URL('../../assets/scripts/bootstrap/MainSceneBootstrap.ts', import.meta.url), 'utf8');
const shipViewSource = readFileSync(new URL('../../assets/scripts/presentation/ShipView.ts', import.meta.url), 'utf8');
const csvRoot = new URL('../../assets/config/csv/', import.meta.url);
const readCsv = (name: string) => readFileSync(new URL(name, csvRoot), 'utf8');
const parsedConfig = parseGameConfigCsvBundle({
  game: readCsv('game.csv'), hulls: readCsv('hulls.csv'), rooms: readCsv('rooms.csv'),
  connectorPorts: readCsv('connector-ports.csv'), floors: readCsv('floors.csv'), crews: readCsv('crews.csv'), crewTraits: readCsv('crew-traits.csv'),
});
if (parsedConfig.ok === false) throw new Error(parsedConfig.message);
  const starterHull = parsedConfig.config.hulls.find((hull) => hull.id === 'hull-starter')!;
  const raiderHull = parsedConfig.config.hulls.find((hull) => hull.id === 'hull-raider')!;
const roomDefinitions = ['reactor', 'elevator', 'laser', 'shield', 'medbay'].map((id) => parsedConfig.config.rooms.find((room) => room.id === `room-${id}`)!);

test('房间原生外观声明稳定模式、最近邻与整数缩放', () => {
  assert.match(appearanceSource, /STATIC:\s*0/);
  assert.match(appearanceSource, /ALWAYS_LOOP:\s*1/);
  assert.match(appearanceSource, /POWERED_LOOP:\s*2/);
  assert.match(appearanceSource, /NEAREST:\s*0/);
  assert.match(appearanceSource, /整数缩放/);
  assert.match(appearanceSource, /bakeAuthoringVisualAssets\(value: unknown\)/);
  assert.match(authoringAssetsSource, /AnimationClip\.createWithSpriteFrames/);
  assert.match(appearanceSource, /固定画布宽度/);
  assert.match(appearanceSource, /显示缩放千分比/);
  assert.match(appearanceSource, /网格横向偏移/);
  assert.match(appearanceSource, /activeAnimationName !== name/);
  assert.match(appearanceSource, /animation\.play\(name\)/);
});

test('房间外观不运行时创建节点或组件，也不在 update 手工切帧', () => {
  assert.doesNotMatch(appearanceSource, /new\s+Node\s*\(/);
  assert.doesNotMatch(appearanceSource, /addComponent\s*\(/);
  const updateBody = appearanceSource.match(/protected update\(\): void \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.doesNotMatch(updateBody, /spriteFrame\s*=/);
  const runtimePath = appearanceSource.match(/protected onEnable\(\): void \{([\s\S]*?)public bakeAuthoringVisualAssets/)?.[1] ?? '';
  assert.doesNotMatch(runtimePath, /new\s+SpriteFrame\s*\(|AnimationClip\.createWithSpriteFrames/);
});

test('RoomView 保留 Graphics 回退并提供可选供电表现接线', () => {
  assert.match(roomViewSource, /type: RoomAppearance/);
  assert.match(roomViewSource, /refreshRuntimeState\(hp: number, repairing: boolean, powered\?: boolean\)/);
  assert.match(roomViewSource, /refreshPowered\(powered: boolean\)/);
  assert.match(appearanceSource, /Graphics 回退/);
});

test('主场景按权威能源分配刷新房间供电表现', () => {
  assert.match(mainBootstrapSource, /snapshot\.energy\.allocations\.find/);
  assert.match(mainBootstrapSource, /refreshRuntimeState\(room\.hp, repairingRoomIds\.has\(roomId\),/);
  assert.match(mainBootstrapSource, /allocation\?\.power/);
});

test('编辑器烘焙方法只加载 Asset DB 持久 SpriteFrame/AnimationClip', () => {
  assert.match(appearanceSource, /bakeAuthoringVisualAssets\(value: unknown\)/);
  assert.match(appearanceSource, /loadAuthoringSpriteFrames/);
  assert.match(appearanceSource, /loadAuthoringAnimationClip/);
  assert.match(authoringAssetsSource, /EditorExtends\.serialize\(clip\)/);
  assert.doesNotMatch(appearanceSource, /new SpriteFrame\(\)/);
  assert.match(appearanceSource, /裁切矩形必须使用非负整数坐标和正整数尺寸|至少需要一个裁切矩形/);
  assert.match(appearanceSource, /applyAuthoringPssConfiguration\(value: unknown\)/);
});

test('房间图片覆盖完整网格并隐藏旧占位背景，耐久条位于网格下方', () => {
  assert.match(appearanceSource, /setGridDisplaySize\(width: number, height: number\)/);
  assert.match(appearanceSource, /sprite\.sizeMode = Sprite\.SizeMode\.CUSTOM/);
  assert.match(roomViewSource, /appearance\?\.setGridDisplaySize\(width, height\)/);
  assert.match(roomViewSource, /if \(!hasImage\)/);
  assert.match(roomViewSource, /const hasImage = this\.getRoomAppearance\(\)\?\.hasRenderableVisual\(\) === true/);
  assert.match(roomViewSource, /const barInset = Math\.max\(4, Math\.min\(8, Math\.round\(cellSize \/ 8\)\)\)/);
  assert.match(roomViewSource, /const barY = -height \/ 2 - barHeight - 4/);
  assert.match(roomViewSource, /graphics\.roundRect\(barX, barY, barWidth, barHeight/);
});

test('编辑器网格吸附复用 update 下一帧，不创建跨 Prefab 的 Cocos Timer', () => {
  assert.match(roomViewSource, /if \(this\.editorSnapScheduled\) this\.flushEditorGridSnap\(\)/);
  assert.doesNotMatch(roomViewSource, /scheduleOnce\(this\.flushEditorGridSnap/);
  assert.doesNotMatch(roomViewSource, /unschedule\(this\.flushEditorGridSnap/);
});

test('P7 使用 24 像素细网格和 20×10 船体，同时保持房间物理尺寸', () => {
  assert.equal(starterHull.gridWidth, 20);
  assert.equal(starterHull.gridHeight, 10);
  assert.equal(starterHull.cellTypes.length, 200);
  assert.equal(starterHull.cellTypes.filter((cell) => cell === 'FIXED_WALL').length, 56);
  assert.deepEqual(roomDefinitions.map(({ width, height }) => ({ width, height })), [
    { width: 5, height: 3 }, // reactor
    { width: 2, height: 4 }, // elevator
    { width: 4, height: 3 }, // laser
    { width: 4, height: 3 }, // shield
    { width: 4, height: 3 }, // medbay
  ]);
  assert.match(shipViewSource, /public cellSize = 24/);
  assert.match(roomViewSource, /shipView\?\.cellSize \?\? 24/);
  assert.match(readCsv('game.csv'), /r1-p8-close-1/);
});

test('敌方掠袭舰使用独立 16×10 船体 Mask，不复用新手船网格', () => {
  assert.equal(raiderHull.gridWidth, 16);
  assert.equal(raiderHull.gridHeight, 10);
  assert.equal(raiderHull.cellTypes.length, 160);
  assert.notDeepEqual(raiderHull.cellTypes, starterHull.cellTypes);
  assert.match(shipViewSource, /逻辑内容根/);
  assert.match(shipViewSource, /containScale = Math\.min\(1, contentWidth \/ frameWidth, contentHeight \/ frameHeight\)/);
  assert.match(shipViewSource, /displayScalePermille \/ 1000/);
  assert.match(shipViewSource, /gridOffsetX, gridOffsetY/);
});
