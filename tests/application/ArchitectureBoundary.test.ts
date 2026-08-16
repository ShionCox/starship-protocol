import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const runtimeFiles = [
  'assets/scripts/bootstrap/configureGameDisplay.ts',
  'assets/scripts/bootstrap/BootSceneBootstrap.ts',
  'assets/scripts/bootstrap/MainSceneBootstrap.ts',
  'assets/scripts/bootstrap/BattleSceneBootstrap.ts',
  'assets/scripts/presentation/UIRootController.ts',
  'assets/scripts/presentation/MainPageRouter.ts',
  'assets/scripts/presentation/PowerPanel.ts',
  'assets/scripts/presentation/CrewStatusPanel.ts',
];

test('场景与界面源码不直接访问存储，也不保留 Prototype 运行时兜底', () => {
  for (const file of runtimeFiles) {
    const source = readFileSync(file, 'utf8');
    assert.equal(/localStorage|sessionStorage/.test(source), false, `${file} 不得直接访问浏览器存储`);
    assert.equal(/createRuntimeFallback|ensureRuntimeConsumer|Prototype/.test(source), false, `${file} 不得保留 Prototype 兜底`);
  }
});

test('Main 与 Battle 都通过持久引用绑定共享界面组件', () => {
  const main = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const battle = readFileSync('assets/scripts/bootstrap/BattleSceneBootstrap.ts', 'utf8');
  assert.match(main, /type: PowerPanel/);
  assert.match(main, /type: CrewStatusPanel/);
  assert.match(main, /LocalPlayerStatePort/);
  assert.match(battle, /type: BattleHUD/);
  assert.doesNotMatch(battle, /getComponentsInChildren\(RoomView\)/);
});

test('UI Prefab 目标白名单与 Creator 迁移门槛统一位于 assets/ui', () => {
  const uiPrefabs = [
    'UIRoot', 'MainScreen', 'BattleHUD', 'BuildOptionCard', 'PowerRoomRow',
  ];
  for (const name of uiPrefabs) assert.equal(existsSync(`assets/ui/prefabs/${name}.prefab`), true, `${name} 未迁移到 UI Prefab 目录`);
  assert.equal(existsSync('extensions/starship-editor-tools/src/scene/ui-prefab-migration.ts'), false);
  for (const name of ['MainMenuPage', 'GalaxyMapPage', 'ShipMainPage', 'BuildPage', 'CrewPage', 'PowerPanel', 'CrewStatusPanel', 'WorldContextMenu', 'DemolitionConfirmDialog', 'OfflineSettlementDialog', 'SettingsPopup']) {
    assert.equal(existsSync(`assets/ui/prefabs/${name}.prefab`), false, `${name} 旧 Prefab 未删除`);
  }
  assert.equal(existsSync('assets/prefabs/UIRoot.prefab'), false);
  assert.equal(existsSync('assets/textures/ui'), false);
  assert.equal(existsSync('assets/ui/textures/buttons'), true);
  assert.equal(existsSync('assets/ui/textures/icons'), true);
});

test('主场景和战斗场景由编辑器公开 set-property 持久定位世界内容根', () => {
  const main = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const battle = readFileSync('assets/scripts/bootstrap/BattleSceneBootstrap.ts', 'utf8');
  const foundation = readFileSync('extensions/starship-editor-tools/src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.doesNotMatch(foundation, /setNodeLocalPosition|setNodeLocalScale/);
  assert.match(foundation, /MAIN_SCREEN_PREFAB_URL/);
  assert.match(foundation, /ensureCanonicalUiRootModules/);
  assert.doesNotMatch(foundation, /ensureUiRootModuleInstances/);
  assert.match(foundation, /ensureBuildOptionCardPrefab/);
  assert.match(foundation, /ensureExistingDomainPrefabComponent/);
  assert.doesNotMatch(foundation, /executeComponentMethod\((?:pageRouter|powerPanel)\.uuid, 'ensureAuthoringPrefabStructure'/);
  assert.match(foundation, /export async function createOrUpdateScene/);
  assert.match(foundation, /MAIN_HUD_FRAME_TEXTURE_URL = `\$\{UI_TEXTURE_DIRECTORY\}\/main-hud-frame-v2\.png`/);
  assert.doesNotMatch(foundation, /db:\/\/assets\/prefabs\/\$\{assetName\}\.prefab/);
  assert.match(foundation, /reimportAsset\?\.\(MAIN_HUD_FRAME_TEXTURE_URL\)/);
  assert.match(foundation, /scene\.setProperty\(hudFrameSprite, 'spriteFrame', \{ type: 'cc\.SpriteFrame'/);
  assert.match(foundation, /NAV_BUTTON_TEXTURE_URLS/);
  assert.match(foundation, /BATTLE_BUTTON_TEXTURE_URLS/);
  assert.match(foundation, /NAV_BUTTON_ICON_TEXTURE_URLS/);
  assert.match(foundation, /UIRoot 导航按钮缺少图标节点/);
  assert.match(foundation, /'_hoverSprite', hover/);
  assert.match(foundation, /'_pressedSprite', pressed/);
  assert.match(foundation, /'_sizeMode', 0/);
  assert.doesNotMatch(main, /worldRoot\.setPosition\(/);
  assert.doesNotMatch(battle, /worldRoot\.setPosition\(/);
});

test('共享 UIRoot 提供主页面切换和 Battle 往返入口', () => {
  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  const battleHud = readFileSync('assets/scripts/presentation/BattleHUD.ts', 'utf8');
  const uiRoot = readFileSync('assets/scripts/presentation/UIRootController.ts', 'utf8');
  assert.match(router, /进入战斗按钮/);
  assert.match(router, /director\.loadScene\('BattleScene'/);
  assert.match(battleHud, /返回主场景按钮/);
  assert.match(battleHud, /director\.loadScene\('MainScene'/);
  assert.match(readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8'), /director\.preloadScene\('BattleScene'/);
  assert.match(uiRoot, /this\.node\.setSiblingIndex\(Math\.max\(0, parent\.children\.length - 1\)\)/);
  assert.match(router, /type: Node/);
  assert.match(router, /executeInEditMode/);
  assert.match(router, /编辑器预览页面/);
  assert.doesNotMatch(router, /instantiate\(|\.destroy\(\)|bindPageMount|getActivePageRoot/);
  assert.match(router, /refreshSerializedReferences/);
  assert.doesNotMatch(router, /ensureAuthoringPrefabStructure|new Node\(|addComponent\(/);
  assert.doesNotMatch(battleHud, /ensureAuthoringPrefabStructure|new Node\(|addComponent\(/);
  assert.match(router, /this\.powerPanel\.node\.active = pageId === 'MAIN_MENU' \|\| pageId === 'SHIP'/);
  assert.match(router, /this\.crewStatusPanel\.node\.active = pageId === 'MAIN_MENU' \|\| pageId === 'SHIP' \|\| pageId === 'CREW'/);
  assert.match(router, /pageBeforeSettings/);
  const foundation = readFileSync('extensions/starship-editor-tools/src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.doesNotMatch(foundation, /SettingsPopup\.prefab|WorldContextMenu\.prefab|DemolitionConfirmDialog\.prefab|OfflineSettlementDialog\.prefab/);
  assert.doesNotMatch(foundation, /setNodeReference\(scene, pageRouter\.target, 'settingsPopup'/);
  assert.match(foundation, /MainPageRouter 的公共面板按持久中文节点解析/);
  assert.doesNotMatch(router, /@property\(\{ type: (?:PowerPanel|CrewStatusPanel).*\n\s*public (?:powerPanel|crewStatusPanel)/);
});

test('主页面只保存五个持久节点引用，切页只切换 active', () => {
  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  const bootstrap = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const uiRoot = readFileSync('assets/scripts/presentation/UIRootController.ts', 'utf8');
  for (const field of ['mainMenuPage', 'galaxyMapPage', 'shipPage', 'buildPage', 'crewPage']) assert.match(router, new RegExp(`public ${field}: Node \\| null`));
  assert.match(router, /for \(const \[id, node\] of this\.pageNodes\(\)\) node\.active = id === pageId/);
  assert.doesNotMatch(router, /public (mainMenuPage|galaxyMapPage|shipPage|buildPage|crewPage)Prefab/);
  assert.match(bootstrap, /public buildPageController: BuildPageController \| null/);
  assert.doesNotMatch(bootstrap, /bindPageMount|handlePageMount|pageRoot\.getComponent/);
  assert.match(uiRoot, /mainContentRoot\.active = this\.mode === 0/);
  assert.match(uiRoot, /battleContentRoot\.active = this\.mode === 1/);
  assert.match(uiRoot, /executeInEditMode/);
  assert.doesNotMatch(uiRoot, /ensureAuthoringPrefabStructure|new Node\(|addComponent\(/);
});

test('能源面板从持久容器重建运行时行缓存，不序列化自定义组件数组', () => {
  const panel = readFileSync('assets/scripts/presentation/PowerPanel.ts', 'utf8');
  const foundation = readFileSync('extensions/starship-editor-tools/src/scene/foundation-prefab-authoring.ts', 'utf8');
  assert.doesNotMatch(panel, /@property\(\{ type: \[PowerRoomRow\]/);
  assert.match(panel, /this\.roomRows = this\.getAttachedRoomRows\(\)/);
  assert.doesNotMatch(foundation, /setProperty\(power, 'roomRows'/);
});

test('主导航文字统一使用清晰的屏幕空间样式', () => {
  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  assert.match(router, /refreshNavigationChrome/);
  assert.match(router, /refreshNavigationFrame/);
  assert.match(router, /selected \? new Color\(126, 235, 255, 255\)/);
  assert.doesNotMatch(router, /ensureHudFrame|ensureButtonIcon|refreshAuthoringTextureChrome/);
  assert.doesNotMatch(router, /new Node\(|addComponent\(|getComponent\(Graphics\)/);
  assert.match(router, /battle\.active = this\.activePage !== 'BUILD' && !settingsOpen/);
});

test('镜头和主页面路由精确管理全局与页面输入监听', () => {
  const camera = readFileSync('assets/scripts/input/CameraController.ts', 'utf8');
  assert.match(camera, /input\.on\(Input\.EventType\.MOUSE_UP, this\.onMouseUp, this\)/);
  assert.match(camera, /input\.off\(Input\.EventType\.MOUSE_UP, this\.onMouseUp, this\)/);

  const router = readFileSync('assets/scripts/presentation/MainPageRouter.ts', 'utf8');
  assert.match(router, /navigationHandlers/);
  assert.match(router, /button\.off\(Node\.EventType\.TOUCH_END, handler, this\)/);
  assert.doesNotMatch(router, /off\(Node\.EventType\.TOUCH_END\);/);
});

test('场景往返时只使用持久引用，不运行时扫描或覆盖 UI 布局', () => {
  const mainBootstrap = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const battleBootstrap = readFileSync('assets/scripts/bootstrap/BattleSceneBootstrap.ts', 'utf8');
  assert.doesNotMatch(mainBootstrap, /resolvePersistedSceneReferences/);
  assert.doesNotMatch(battleBootstrap, /resolvePersistedSceneReferences/);
  assert.match(mainBootstrap, /Bootstrap 引用未持久绑定/);
  assert.match(battleBootstrap, /Bootstrap 引用未持久绑定/);
  assert.match(battleBootstrap, /protected start\(\): void \{\s*if \(EDITOR_NOT_IN_PREVIEW\) return;/);
  assert.doesNotMatch(mainBootstrap, /new Node\(|addComponent\(/);
  assert.doesNotMatch(battleBootstrap, /new Node\(|addComponent\(/);
});

test('船员固定 Tick 只更新一次表现位置并使用 Cocos Tween 插值', () => {
  const crewView = readFileSync('assets/scripts/presentation/CrewView.ts', 'utf8');
  assert.doesNotMatch(crewView, /this\.selectHandler = selectHandler;\s*this\.refresh\(state, false\)/);
  assert.match(crewView, /movementTweenSeconds = 0\.1/);
  assert.match(crewView, /tween\(this\.node\)\.to\(Math\.min\(0\.1, this\.movementTweenSeconds\)/);
});

test('世界交互精确注销空白、右键和 Esc 监听且不把选择写入存档', () => {
  const interaction = readFileSync('assets/scripts/presentation/WorldInteractionController.ts', 'utf8');
  assert.match(interaction, /canvas\.on\(Node\.EventType\.MOUSE_DOWN, this\.handleCanvasMouseDown, this\)/);
  assert.match(interaction, /canvas\?\.off\(Node\.EventType\.MOUSE_DOWN, this\.handleCanvasMouseDown, this\)/);
  assert.match(interaction, /input\.on\(Input\.EventType\.KEY_DOWN, this\.handleKeyDown, this\)/);
  assert.match(interaction, /input\.off\(Input\.EventType\.KEY_DOWN, this\.handleKeyDown, this\)/);
  assert.match(interaction, /KeyCode\.ESCAPE/);
  assert.doesNotMatch(interaction, /PlayerStatePort|localStorage|sessionStorage/);
  assert.match(interaction, /'DEMOLISH'/);
});

test('Web Desktop 使用占满视口的 16:9 正式模板', () => {
  const html = readFileSync('build-templates/web-desktop/index.ejs', 'utf8');
  const css = readFileSync('build-templates/web-desktop/style.css', 'utf8');
  const display = readFileSync('assets/scripts/bootstrap/configureGameDisplay.ts', 'utf8');
  assert.match(html, /cc_exact_fit_screen="true"/);
  assert.match(html, /cssUrl %>\?v=5/);
  assert.match(html, /screen-orientation" content="landscape"/);
  assert.doesNotMatch(html, /class="header"|class="footer"/);
  assert.match(css, /#GameDiv[\s\S]*#GameCanvas/);
  assert.match(css, /width:\s*min\(100vw, 177\.7777778vh\)\s*!important/);
  assert.match(css, /height:\s*min\(100vh, 56\.25vw\)\s*!important/);
  assert.doesNotMatch(css, /transform:/);
  assert.match(css, /background:\s*#000/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(display, /view\.resizeWithBrowserSize\(true\)/);
  assert.match(display, /view\.setDesignResolutionSize\(GAME_DESIGN_WIDTH, GAME_DESIGN_HEIGHT, ResolutionPolicy\.SHOW_ALL\)/);
  assert.match(display, /if \(isConfigured\)/);
  for (const bootstrapFile of runtimeFiles.slice(1, 4)) {
    assert.match(readFileSync(bootstrapFile, 'utf8'), /configureGameDisplay\(\)/);
  }
});

test('P8 收口保留离线摘要、拆除确认并提供 UI 三层入口', () => {
  const port = readFileSync('assets/scripts/application/PlayerStatePort.ts', 'utf8');
  const localPort = readFileSync('assets/scripts/bootstrap/LocalPlayerStatePort.ts', 'utf8');
  const bootstrap = readFileSync('assets/scripts/bootstrap/MainSceneBootstrap.ts', 'utf8');
  const offlineDialog = readFileSync('assets/scripts/presentation/OfflineSettlementDialog.ts', 'utf8');
  const foundation = readFileSync('extensions/starship-editor-tools/src/scene/foundation-prefab-authoring.ts', 'utf8');
  const main = readFileSync('extensions/starship-editor-tools/src/main.ts', 'utf8');
  assert.match(port, /interface PlayerBootstrapResult/);
  assert.match(port, /offlineConstruction\?: OfflineConstructionSummary/);
  assert.match(localPort, /clockRollback/);
  assert.match(bootstrap, /START_DEMOLITION/);
  assert.match(bootstrap, /DemolitionConfirmDialog/);
  assert.match(bootstrap, /OfflineSettlementDialog/);
  assert.match(bootstrap, /view\.node\.active = false/);
  assert.doesNotMatch(offlineDialog, /ensureAuthoringPrefabStructure|getComponent\(Graphics\)|addComponent\(Graphics\)/);
  assert.match(offlineDialog, /建造地板.*建造房间.*拆除地板.*拆除房间/s);
  assert.match(foundation, /preflightUiFoundationPrefabs/);
  assert.doesNotMatch(foundation, /SettingsPopup\.prefab|WorldContextMenu\.prefab|DemolitionConfirmDialog\.prefab|OfflineSettlementDialog\.prefab/);
  assert.equal(existsSync('extensions/starship-editor-tools/src/scene/ui-prefab-migration.ts'), false);
  assert.match(main, /async createOrUpdateScene\(kind: SceneSkeletonKind\)/);
  assert.doesNotMatch(main, /previewPage|migrateUiPrefabs|rebuildP8StarterShip/);
});

test('Creator 编译兼容施工到场工程师集合', () => {
  const construction = readFileSync('assets/scripts/game-core/ConstructionModel.ts', 'utf8');
  assert.match(construction, /Array\.from\(new Set\(crewIds\)\)/);
  assert.doesNotMatch(construction, /\[\.\.\.new Set\(crewIds\)\]/);
});

test('P8 建造页使用分类卡片和矩形拖拽预览，不保留旧坐标按钮链', () => {
  const page = readFileSync('assets/scripts/presentation/BuildPageController.ts', 'utf8');
  const card = readFileSync('assets/scripts/presentation/BuildOptionCard.ts', 'utf8');
  const interaction = readFileSync('assets/scripts/presentation/WorldInteractionController.ts', 'utf8');
  const shipView = readFileSync('assets/scripts/presentation/ShipView.ts', 'utf8');
  assert.match(page, /建造侧栏/);
  assert.match(page, /categoryForRoom/);
  assert.match(page, /optionCardPrefab/);
  assert.match(page, /layout\?\.updateLayout\(true\)/);
  assert.match(page, /建造页面 Prefab 缺少持久布局引用/);
  assert.doesNotMatch(page, /ensureAuthoringPrefabStructure|new Node\(|addComponent\(/);
  assert.match(card, /Button\.Transition\.SPRITE/);
  assert.match(card, /normalSprite/);
  assert.doesNotMatch(page, /上一项|下一项|目标左移|目标右移|目标上移|目标下移|分配工程师/);
  assert.match(card, /startDrag/);
  assert.match(interaction, /beginBuildDrag/);
  assert.match(interaction, /previewBuild/);
  assert.match(interaction, /cancelBuildDrag/);
  assert.match(shipView, /refreshInteractionRect/);
  assert.match(shipView, /worldCenterToGridCandidate/);
});
