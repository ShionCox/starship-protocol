const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { FIRST_PSS_ROOM_BINDINGS } = require('../dist/pss/pss-appearance-authoring.js');
const { createAtlasPlist } = require('../dist/pss/animation-asset-authoring.js');

test('首批五个房间外观使用 CSV visualId、播放模式和显式帧矩形', () => {
  assert.equal(FIRST_PSS_ROOM_BINDINGS.length, 5);
  assert.deepEqual(FIRST_PSS_ROOM_BINDINGS.map((entry) => entry.visualId), [
    'visual-pss-room-elevator-83',
    'visual-pss-room-reactor-808',
    'visual-pss-room-laser-8285',
    'visual-pss-room-shield-8041',
    'visual-pss-room-medbay-1107',
  ]);
  assert.deepEqual(FIRST_PSS_ROOM_BINDINGS.map((entry) => entry.mode), [0, 1, 2, 2, 0]);
  const visuals = fs.readFileSync(require('node:path').join(__dirname, '../../../assets/config/csv/visuals.csv'), 'utf8');
  const frames = fs.readFileSync(require('node:path').join(__dirname, '../../../assets/config/csv/visual-frames.csv'), 'utf8');
  assert.match(visuals, /visual-pss-room-reactor-808,反应堆房间,ROOM/);
  assert.match(frames, /frame-visual-pss-room-reactor-808-4,反应堆帧5,visual-pss-room-reactor-808,4,0,102,100,50/);
});

test('房间原生外观不会把 Sprite 挂到 Graphics 房间根，而是使用独立图像子节点', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/pss/pss-appearance-authoring.ts'), 'utf8');
  assert.match(source, /createNode\(\{ parent: room\.nodeUuid, name: '房间图像'/);
  assert.doesNotMatch(source, /ensureComponent\(scene, room\.nodeUuid, 'cc\.Sprite'\)/);
  assert.match(source, /setProperty\(roomTarget, 'roomAppearance'/);
});

test('房间贴图绑定使用 Texture2D 子资源并由组件构造 Rect 数组', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/pss/pss-appearance-authoring.ts'), 'utf8');
  assert.match(source, /visual\.textureUrl}\/texture/);
  assert.match(source, /applyAuthoringPssConfiguration/);
  assert.match(source, /ensureVisualFrameAssets/);
  assert.match(source, /ensureAnimationClipAsset/);
  assert.match(source, /frameUuids/);
  assert.doesNotMatch(source, /setProperty\(appearance, 'sourceFrameRects'/);
});

test('视觉裁切矩形生成 Creator 可导入的 SpriteAtlas plist', () => {
  const plist = createAtlasPlist('visual.png', 64, 32, ['visual-frame-000.png', 'visual-frame-001.png'], [
    { x: 0, y: 0, width: 32, height: 32 },
    { x: 32, y: 0, width: 32, height: 32 },
  ]);
  assert.match(plist, /<key>metadata<\/key>/);
  assert.match(plist, /<key>format<\/key><integer>2<\/integer>/);
  assert.match(plist, /<key>textureFileName<\/key><string>visual\.png<\/string>/);
  assert.match(plist, /<key>visual-frame-001\.png<\/key>/);
  assert.match(plist, /<key>frame<\/key><string>\{\{32,0\},\{32,32\}\}<\/string>/);
  assert.match(plist, /<key>sourceSize<\/key><string>\{32,32\}<\/string>/);
});

test('Creator Scene 方法同步启动异步烘焙并由扩展轮询结果', () => {
  const room = fs.readFileSync(require('node:path').join(__dirname, '../../../assets/scripts/presentation/RoomAppearance.ts'), 'utf8');
  const crew = fs.readFileSync(require('node:path').join(__dirname, '../../../assets/scripts/presentation/CrewAppearance.ts'), 'utf8');
  const authoring = fs.readFileSync(require('node:path').join(__dirname, '../src/pss/animation-asset-authoring.ts'), 'utf8');
  for (const source of [room, crew]) {
    assert.match(source, /public applyAuthoringPssConfiguration\(value: unknown\): AuthoringResult/);
    assert.doesNotMatch(source, /public async applyAuthoringPssConfiguration/);
    assert.match(source, /getAuthoringPssConfigurationResult/);
    assert.match(source, /getAuthoringAnimationClipAssetResult/);
  }
  assert.match(authoring, /waitForAuthoringMethod/);
  assert.match(authoring, /getAuthoringPssConfigurationResult/);
  assert.match(authoring, /primeAuthoringSpriteFrames/);
  assert.match(authoring, /captureAuthoringSpriteFrame/);
});
