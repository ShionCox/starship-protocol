const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

const {
  createFoundationPrefabs,
  cancelAuthoringPreview,
  isAuthoringMethodSuccess,
  openAuthoringSceneContext,
  preflightP8StarterShip,
  P8_STANDARD_BUILD_TEST_TARGET,
  P8_STANDARD_DEMO_FLOOR_X,
  P8_STANDARD_DEMO_FLOOR_ROWS,
  P8_STANDARD_STARTER_SHIP,
  rebuildP8StarterShip,
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

test('共享基础升级先预检 UI Prefab，再处理 ShipView 与领域表现', () => {
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.match(source, /ensureShipViewP8Components\(assetDb, scene\)/);
  assert.match(source, /ensureUiRootP8Components\(assetDb, scene\)/);
  assert.match(source, /preflightUiFoundationPrefabs\(assetDb, scene\)/);
  assert.match(source, /ensureExistingDomainPrefabComponent/);
  assert.doesNotMatch(source, /ensureSharedCsvBindings/);
  assert.doesNotMatch(source, /EDITOR_PREFABS_TABLE/);
  assert.match(source, /wireSceneFoundation\(assetDb: AssetDbPort, scene: SceneQueryPort/);
  assert.equal(source.match(/bindCsvConfigSourceToNode\(assetDb, scene, bootstrap\.nodeUuid\)/g)?.length, 2);
  assert.equal(source.match(/'configSource', 'GameConfigCsvSource', configSource/g)?.length, 3);
  assert.match(source, /缺少 UI 模块 Prefab/);
  assert.doesNotMatch(source, /validateExistingPrefab\(scene, UI_ROOT_PREFAB_URL, 'UIRootController'\)/);
  assert.equal(source.match(/setNodeLocalPosition\(scene, worldRoot\.uuid as string, 0, 0, 0\)/g)?.length, 2);
  assert.match(source, /ensureCanonicalUiRootModules\(assetDb, scene\)/);
  assert.doesNotMatch(source, /ensureUiRootModuleInstances/);
  assert.match(source, /MAIN_SCREEN_PREFAB_URL/);
  assert.doesNotMatch(source, /setNodeActive\(scene, settingsPopupNode\.uuid/);
  assert.doesNotMatch(source, /executeComponentMethod\(crewStatusPanel\.uuid, 'ensureAuthoringPrefabStructure'/);
  assert.match(source, /const editableRoot = await waitForEditablePrefabRoot\(scene, buildPageUrl\)/);
  assert.match(source, /scene\.setProperty\(controller, 'optionCardPrefab'/);
  assert.doesNotMatch(source, /ensureAuthoringPrefabStructure.*BuildPage/);
  assert.ok(source.includes("const atlasUrl = visual.textureUrl.replace(/\\.png$/i, '.plist');"));
  assert.match(source, /多帧定义必须确保图集按当前 visualId 生成/);
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

function foundationRollbackFixture(options = {}) {
  const existing = new Set();
  const calls = [];
  let copyCount = 0;
  let roomViewVisible = false;
  let mainSceneVisible = false;
  const deleteFailures = options.deleteFailures ?? new Set();
  const scene = {
    openPrefab() { roomViewVisible = true; },
    calls,
    async queryNodeTree() {
      if (mainSceneVisible) {
        return { uuid: 'main-scene', name: 'MainScene', components: [{ type: 'MainSceneBootstrap', uuid: 'bootstrap', nodeUuid: 'main-scene', index: 0 }], children: [] };
      }
      return {
        uuid: 'prefab-root',
        name: 'PrefabRoot',
        children: roomViewVisible
          ? [{ uuid: 'room-node', name: '房间', components: [{ type: 'RoomView', uuid: 'room-view', nodeUuid: 'room-node', index: 0 }], children: [] }]
          : [],
      };
    },
    async executeComponentMethod(_uuid, name) {
      calls.push(['executeComponentMethod', name]);
      if (name === 'removeForAuthoringTemplateConversion') roomViewVisible = false;
      return undefined;
    },
  };
  const editor = {
    Message: {
      async request(domain, message, ...args) {
        calls.push([domain, message, ...args]);
        if (domain === 'asset-db' && message === 'query-uuid') return `uuid:${args[0]}`;
        if (domain === 'scene' && message === 'open-scene') {
          if (args[0] === 'uuid:db://assets/scenes/MainScene.scene') mainSceneVisible = true;
          return true;
        }
        if (domain === 'asset-db' && message === 'open-asset') {
          scene.openPrefab();
        }
        return true;
      },
    },
  };
  const assetDb = {
    calls,
    async queryUuid(url) {
      calls.push(['queryUuid', url]);
      return existing.has(url) ? `uuid:${url}` : '';
    },
    async copyAsset(sourceUrl, targetUrl) {
      calls.push(['copyAsset', sourceUrl, targetUrl]);
      copyCount += 1;
      if (copyCount === options.failCopyAt) return null;
      existing.add(targetUrl);
      return { uuid: `uuid:${targetUrl}`, url: targetUrl };
    },
    async deleteAsset(url) {
      calls.push(['deleteAsset', url]);
      if (deleteFailures.has(url)) throw new Error(`模拟删除失败：${url}`);
      existing.delete(url);
      return { uuid: `uuid:${url}`, url };
    },
  };
  return { assetDb, scene, editor, calls };
}

test('Foundation Prefab 创建失败会按逆序清理新资源并显示每个删除错误，不虚报已回滚', async () => {
  const previousEditor = global.Editor;
  const failedCreateUrl = 'db://assets/prefabs/CrewTemplate.prefab';
  const firstUrl = 'db://assets/prefabs/BlankNodeTemplate.prefab';
  const secondUrl = 'db://assets/prefabs/RoomTemplate.prefab';
  const fixture = foundationRollbackFixture({
    failCopyAt: 3,
    deleteFailures: new Set([firstUrl, secondUrl]),
  });
  global.Editor = fixture.editor;
  try {
    const result = await createFoundationPrefabs(fixture.assetDb, fixture.scene);
    assert.equal(result.ok, false);
    assert.ok(result.message.includes(`无法复制 Prefab 模板：${failedCreateUrl}`));
    assert.ok(result.message.includes(`${firstUrl}：模拟删除失败`));
    assert.ok(result.message.includes(`${secondUrl}：模拟删除失败`));
    assert.doesNotMatch(result.message, /已回滚新资源/);
    assert.deepEqual(fixture.calls.filter(([name]) => name === 'deleteAsset').map(([, url]) => url), [failedCreateUrl, secondUrl, firstUrl]);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});

test('共享 Prefab 批处理失败回滚后仍返回下拉框对应场景', async () => {
  const previousEditor = global.Editor;
  const fixture = foundationRollbackFixture({ failCopyAt: 1 });
  global.Editor = fixture.editor;
  try {
    const result = await createFoundationPrefabs(fixture.assetDb, fixture.scene, 'MAIN');
    assert.equal(result.ok, false);
    const openedAssets = fixture.calls
      .filter(([domain, message]) => domain === 'scene' && message === 'open-scene')
      .map(([, , url]) => url);
    assert.equal(openedAssets.at(-1), 'uuid:db://assets/scenes/MainScene.scene');
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
  assert.match(source, /expectedFloorIds/);
  assert.match(source, /removeNode\(target\.nodeUuid\)/);
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

test('P8.3 编排器会全新重建 BootScene，再执行 Prefab 与 Main/Battle 场景重建', async () => {
  const source = readFileSync('src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.match(source, /export async function rebuildP8StarterShip/);
  assert.match(source, /export async function preflightP8StarterShip/);
  assert.match(source, /const P8_REBUILD_CLEAN_TARGETS/);
  assert.match(source, /const preflight = await preflightP8StarterShip\(assetDb, scene\)/);
  assert.match(source, /await openAuthoringSceneContext\(scene, 'BOOT'\)/);
  assert.match(source, /const boot = await rebuildP8BootScene\(scene\)/);
  assert.match(source, /recordFoundationPhase\(journal, 'boot-scene'/);
  assert.match(source, /initializeSceneSkeleton\(scene, 'BOOT'\)/);
  assert.match(source, /BootScene 已全新重建/);
  assert.match(source, /assetDb\.queryUuid\(LEGACY_CREW_PREFAB_URL\)/);
  assert.match(source, /await waitForNodeRemoval\(scene, child\.uuid\)/);
  assert.match(source, /await scene\.endRecording\(undoId\);\s+undoId = null;\s+await saveAuthoringScene\(\)/);
  assert.match(source, /阶段记录：/);
  assert.match(source, /失败恢复完成/);
  assert.match(source, /await openAuthoringSceneContext\(scene, 'MAIN'\)/);
  assert.match(source, /bindRoomAppearances/);
  assert.match(source, /bindCrewAppearances/);
  assert.match(source, /bindHullAppearances/);
  assert.match(source, /BattleScene 重开后持久引用校验失败/);
  assert.match(source, /BattleScene 双方飞船与战斗界面引用已通过重开验证/);
  assert.match(source, /executeComponentMethod\(reopenedBattleBootstrap\.uuid, 'applyEditorSceneReferences'/);
  assert.match(source, /tree\.name === sceneName/);
  assert.match(source, /openEditorSceneAsset\(target\.url\)/);
  assert.match(source, /P8_STANDARD_STARTER_SHIP\.reactor/);
  assert.match(source, /P8_STANDARD_STARTER_SHIP\.medbayBuildTestTarget/);
  assert.match(source, /export async function cancelAuthoringPreview/);
});

test('P8.3 预检在缺失资源时 fail-closed，且不会进入场景清理', async () => {
  const calls = [];
  const previousEditor = global.Editor;
  global.Editor = { Message: { async request(domain, message, ...args) { calls.push([domain, message, ...args]); return true; } } };
  const scene = {
    async queryNodeTree() { throw new Error('预检不应读取场景'); },
  };
  const assetDb = {
    async queryUuid(url) { calls.push(['queryUuid', url]); return url.endsWith('MedicalRoom.prefab') ? '' : `uuid:${url}`; },
  };
  try {
    const result = await preflightP8StarterShip(assetDb, scene);
    assert.equal(result.ok, false);
    assert.match(result.message, /MedicalRoom\.prefab/);
    assert.equal(calls.some(([domain, message]) => domain === 'scene' && message === 'remove-node'), false);
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});
