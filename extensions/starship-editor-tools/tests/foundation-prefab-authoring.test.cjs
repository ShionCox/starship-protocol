const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const {
  createOrUpdateScene,
  cancelAuthoringPreview,
  isAuthoringMethodSuccess,
  openAuthoringSceneContext,
  P8_STANDARD_BUILD_TEST_TARGET,
  P8_STANDARD_DEMO_FLOOR_X,
  P8_STANDARD_DEMO_FLOOR_ROWS,
  P8_STANDARD_STARTER_SHIP,
  resolveEditablePrefabRoot,
} = require('../dist/scene/foundation-prefab-authoring.js');

test('Creator 场景方法的空成功返回不会被误判为结构刷新失败', () => {
  assert.equal(isAuthoringMethodSuccess(undefined), true);
  assert.equal(isAuthoringMethodSuccess(null), true);
  assert.equal(isAuthoringMethodSuccess(true), true);
  assert.equal(isAuthoringMethodSuccess({ ok: true }), true);
  assert.equal(isAuthoringMethodSuccess(false), false);
  assert.equal(isAuthoringMethodSuccess({ ok: false }), false);
});

test('Prefab 编辑模式跳过不可挂组件的 Scene 包装根', () => {
  const prefabRoot = { uuid: 'floor-root', name: 'FloorTile', children: [] };
  const sceneWrapper = { uuid: 'scene-root', name: 'Scene', children: [prefabRoot] };
  assert.equal(resolveEditablePrefabRoot(sceneWrapper, 'db://assets/prefabs/FloorTile.prefab'), prefabRoot);
  const anonymousPrefabRoot = { uuid: 'build-root', name: 'PrefabRoot', children: [] };
  assert.equal(
    resolveEditablePrefabRoot({ uuid: 'scene-root', name: 'Scene', children: [anonymousPrefabRoot] }, 'db://assets/ui/prefabs/BuildPage.prefab'),
    anonymousPrefabRoot,
  );
  assert.throws(
    () => resolveEditablePrefabRoot({ uuid: 'old-scene', name: 'Scene', children: [{ uuid: 'camera', name: '主相机', children: [] }, { uuid: 'canvas', name: '画布', children: [] }] }, 'db://assets/ui/prefabs/BuildPage.prefab'),
    /可编辑 Prefab 根节点不可用/,
  );
});

test('场景更新分支复用五个核心 UI Prefab，并保持 MainScreen 为视觉源', () => {
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.match(source, /ensureShipViewP8Components\(assetDb, scene\)/);
  assert.match(source, /ensureUiRootP8Components\(assetDb, scene\)/);
  assert.match(source, /preflightUiFoundationPrefabs\(assetDb, scene\)/);
  assert.match(source, /ensureExistingDomainPrefabComponent/);
  assert.doesNotMatch(source, /ensureSharedCsvBindings/);
  assert.doesNotMatch(source, /EDITOR_PREFABS_TABLE/);
  assert.match(source, /connectSceneReferences\(assetDb: AssetDbPort, scene: SceneQueryPort/);
  assert.equal(source.match(/bindCsvConfigSourceToNode\(assetDb, scene, bootstrap\.nodeUuid\)/g)?.length, 2);
  assert.equal(source.match(/'configSource', 'GameConfigCsvSource', configSource/g)?.length, 3);
  assert.match(source, /缺少 UI 模块 Prefab/);
  assert.doesNotMatch(source, /validateExistingPrefab\(scene, UI_ROOT_PREFAB_URL, 'UIRootController'\)/);
  assert.doesNotMatch(source, /setNodeLocalPosition/);
  assert.match(source, /ensureCanonicalUiRootModules\(assetDb, scene\)/);
  assert.doesNotMatch(source, /ensureUiRootModuleInstances/);
  assert.match(source, /MAIN_SCREEN_PREFAB_URL/);
  assert.doesNotMatch(source, /setNodeActive\(scene, settingsPopupNode\.uuid/);
  assert.doesNotMatch(source, /executeComponentMethod\(crewStatusPanel\.uuid, 'ensureAuthoringPrefabStructure'/);
  assert.match(source, /const tree = await scene\.queryNodeTree\(\)/);
  assert.match(source, /缺少持久建造页面节点/);
  assert.match(source, /ensureReference\(scene, controller, 'optionCardPrefab', 'cc\.Prefab', cardUuid\)/);
  assert.match(source, /ensureMainScreenP8Components/);
  assert.match(source, /openEditorAsset\(MAIN_SCREEN_PREFAB_URL\);\n  await bindMainScreenVisualAssets\(assetDb, scene\)/);
  assert.match(source, /await waitForEditablePrefabRoot\(scene, MAIN_SCREEN_PREFAB_URL\);\n  const hudFrameNode = await waitForUniqueNodeByName/);
  assert.match(source, /主界面背景和按钮素材必须写入 MainScreen 源 Prefab/);
  const uiRootUpgrade = source.slice(source.indexOf('async function ensureUiRootP8Components'), source.indexOf('async function ensureCanonicalUiRootModules'));
  assert.doesNotMatch(uiRootUpgrade, /bindMainUiButtonStates|MAIN_HUD_FRAME_TEXTURE_URL/);
  assert.doesNotMatch(uiRootUpgrade, /setNodeReference\(scene, pageRouter\.target, 'settingsPopup'/);
  assert.doesNotMatch(source, /setReference\(scene, pageRouter, '(?:powerPanel|crewStatusPanel)'/);
  assert.match(source, /await ensureReference\(scene, router, property, 'cc\.Node', page\.uuid\)/);
  assert.match(source, /Creator 3\.8\.8 再次 set-property 时会在 decodePatch/);
  assert.doesNotMatch(source, /setProperty\(power, 'roomRows'/);
  assert.match(source, /能源面板缺少三个持久代表能源行/);
  assert.doesNotMatch(source, /BuildPage\.prefab|PowerPanel\.prefab|CrewStatusPanel\.prefab/);
  assert.ok(source.includes("const atlasUrl = visual.textureUrl.replace(/\\.png$/i, '.plist');"));
  assert.match(source, /多帧定义必须确保图集按当前 visualId 生成/);
  assert.match(source, /export async function createOrUpdateScene/);
  assert.match(source, /补齐中文场景骨架/);
  assert.match(source, /保存并重开验证/);
  for (const legacy of ['rebuildP8StarterShip', 'preflightP8StarterShip', 'P8_REBUILD_CLEAN_TARGETS', 'LEGACY_CREW_PREFAB_URL', 'mountSharedUi', 'wireSceneFoundation']) {
    assert.doesNotMatch(source, new RegExp(legacy));
  }
});

test('船体外观绑定从逻辑内容根递归定位持久外观层', () => {
  const source = readFileSync('src/hulls/hull-appearance-authoring.ts', 'utf8');
  assert.match(source, /executeComponentMethod\(shipTarget\.uuid, 'ensureAuthoringPrefabStructure'/);
  assert.match(source, /waitForDescendant\(scene, ship\.nodeUuid, '船体外观层'\)/);
  assert.doesNotMatch(source, /findChild\(tree, ship\.nodeUuid, '船体外观层'\)/);
  assert.match(source, /queryUuid\(`\$\{visual\.textureUrl\}\/spriteFrame`\)/);
  assert.match(source, /setProperty\(appearance, 'staticFrame', \{ type: 'cc\.SpriteFrame', uuid: spriteFrameUuid \}/);
  const componentSource = readFileSync('../../assets/scripts/presentation/HullAppearance.ts', 'utf8');
  assert.doesNotMatch(componentSource, /assetManager\.loadAny/);
});

test('连接场景前主动打开下拉框指定 Scene 并等待 Bootstrap', async () => {
  const calls = [];
  let sceneOpened = false;
  const previousEditor = global.Editor;
  global.Editor = {
    Message: {
      async request(domain, message, url) {
        calls.push([domain, message, url]);
        if (domain === 'asset-db' && message === 'query-uuid') return `uuid:${url}`;
        if (domain === 'scene' && message === 'open-scene' && url === 'uuid:db://assets/scenes/MainScene.scene') sceneOpened = true;
        return true;
      },
    },
  };
  const scene = {
    async queryNodeTree() {
      return sceneOpened
        ? { uuid: 'main-scene', name: 'MainScene', components: [{ type: 'MainSceneBootstrap', uuid: 'bootstrap', nodeUuid: 'main-scene', index: 0 }], children: [] }
        : { uuid: 'prefab-root', name: 'UIRoot', children: [] };
    },
  };
  try {
    await openAuthoringSceneContext(scene, 'MAIN');
    assert.deepEqual(calls, [
      ['asset-db', 'query-uuid', 'db://assets/scenes/MainScene.scene'],
      ['scene', 'open-scene', 'uuid:db://assets/scenes/MainScene.scene'],
    ]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('P8.3 标准新手船布局固定反应堆尺寸并保留医疗施工测试目标', () => {
  assert.equal(P8_STANDARD_STARTER_SHIP.hullDefinitionId, 'hull-starter');
  assert.deepEqual(P8_STANDARD_STARTER_SHIP.reactor, {
    instanceId: 'room-reactor-1', definitionId: 'room-reactor', x: 1, y: 2, width: 5, height: 3,
  });
  assert.deepEqual(P8_STANDARD_BUILD_TEST_TARGET, {
    instanceId: 'room-medbay-1', definitionId: 'room-medbay', x: 6, y: 6,
  });
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.match(source, /crew-engineer-1/);
  assert.match(source, /crew-engineer-2/);
  assert.match(source, /crew-engineer-3/);
  assert.match(source, /六名船员（三名工程师）已持久装配/);
});

test('P8.3 标准演示地板为 x=1..17，并保留下层 (18,1) 施工回归空位', () => {
  assert.deepEqual(P8_STANDARD_DEMO_FLOOR_X, { min: 1, max: 17 });
  assert.deepEqual(P8_STANDARD_DEMO_FLOOR_ROWS, [1, 5]);
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.match(source, /for \(let x = P8_STANDARD_DEMO_FLOOR_X\.min; x <= P8_STANDARD_DEMO_FLOOR_X\.max; x \+= 1\)/);
  assert.match(source, /P8_STANDARD_DEMO_FLOOR_ROWS/);
  assert.match(source, /collectTargetsByStableId/);
  assert.doesNotMatch(source, /removeNode\(target\.nodeUuid\)/);
});

test('取消编辑器预览只调用白名单清理方法，不保存 Scene', async () => {
  const calls = [];
  const scene = {
    async queryNodeTree() {
      return {
        uuid: 'scene',
        name: 'MainScene',
        children: [
          { uuid: 'ship-node', name: '飞船', components: [{ type: 'ShipView', uuid: 'ship', nodeUuid: 'ship-node', index: 0 }], children: [] },
          { uuid: 'room-node', name: '房间', components: [{ type: 'RoomView', uuid: 'room', nodeUuid: 'room-node', index: 0 }], children: [] },
        ],
      };
    },
    async queryComponents() { return []; },
    async executeComponentMethod(uuid, name) { calls.push([uuid, name]); return undefined; },
  };
  const result = await cancelAuthoringPreview(scene);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['ship', 'clearAuthoringDefinitionPreview'], ['room', 'clearAuthoringDefinitionPreview']]);
});

test('场景创作只保留一个公开入口和三个固定分支，不再保留旧破坏式链路', () => {
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.equal((source.match(/export async function createOrUpdateScene/g) ?? []).length, 1);
  assert.match(source, /kind === 'BOOT'/);
  assert.match(source, /kind === 'MAIN'/);
  assert.match(source, /ensureBattleSceneShips/);
  assert.match(source, /清理启动场景旧英文节点/);
  assert.match(source, /补齐主场景飞船与标准演示内容/);
  assert.match(source, /补齐战斗双方飞船/);
  for (const legacy of ['rebuildP8StarterShip', 'preflightP8StarterShip', 'P8_REBUILD_CLEAN_TARGETS', 'resetP8SceneShipInstances', 'cleanP8DefinitionComponents', 'rebuildP8DomainBindings', 'LEGACY_CREW_PREFAB_URL']) {
    assert.doesNotMatch(source, new RegExp(legacy));
  }
});

test('场景消息收到未知类型时在写入前失败', async () => {
  const result = await createOrUpdateScene({}, {}, 'UNKNOWN');
  assert.equal(result.ok, false);
  assert.match(result.message, /场景类型无效/);
});
