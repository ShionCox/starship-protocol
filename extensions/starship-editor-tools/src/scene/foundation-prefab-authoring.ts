import {
  BLANK_NODE_TEMPLATE_URL,
  CREW_TEMPLATE_URL,
  DEFAULT_TEMPLATE_URL,
  ROOM_TEMPLATE_URL,
  UI_PREFAB_DIRECTORY,
  UI_TEXTURE_DIRECTORY,
} from '../constants';
import { openEditorAsset, waitForImportedAsset, type AssetDbPort } from '../shared/editor-asset-db';
import { describeRollback, rollbackCreatedAssets } from '../shared/rollback-assets';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  getSceneComponentUuid,
  openEditorSceneAsset,
  readSceneReferenceUuid,
  saveAuthoringScene,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import { initializeSceneSkeleton, type SceneSkeletonKind } from './scene-skeleton';
import { bindCsvConfigSourceToNode } from '../csv/bind-csv-config-source';
import { bindRoomDefinitionToOpenPrefab } from '../rooms/bind-room-prefab';
import { bindCrewDefinitionToOpenPrefab } from '../crew/bind-crew-prefab';
import { loadCsvConfigBundle, loadVisualDefinition, parseCsv } from '../csv/config-csv';
import { ensureVisualFrameAssets } from '../pss/animation-asset-authoring';

export const SHIP_VIEW_PREFAB_URL = 'db://assets/prefabs/ShipView.prefab';
export const UI_ROOT_PREFAB_URL = `${UI_PREFAB_DIRECTORY}/UIRoot.prefab`;
export const MAIN_SCREEN_PREFAB_URL = `${UI_PREFAB_DIRECTORY}/MainScreen.prefab`;
export const BATTLE_HUD_PREFAB_URL = `${UI_PREFAB_DIRECTORY}/BattleHUD.prefab`;
export const MAIN_HUD_FRAME_TEXTURE_URL = `${UI_TEXTURE_DIRECTORY}/main-hud-frame-v2.png`;
const NAV_BUTTON_TEXTURE_URLS = [
  `${UI_TEXTURE_DIRECTORY}/buttons/nav-v2-normal.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/nav-v2-hover.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/nav-v2-pressed.png`,
] as const;
const BATTLE_BUTTON_TEXTURE_URLS = [
  `${UI_TEXTURE_DIRECTORY}/buttons/battle-v2-normal.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/battle-v2-hover.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/battle-v2-pressed.png`,
] as const;
const UTILITY_BUTTON_TEXTURE_URLS = [
  `${UI_TEXTURE_DIRECTORY}/buttons/utility-v2-normal.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/utility-v2-hover.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/utility-v2-pressed.png`,
] as const;
const BUILD_CARD_TEXTURE_URLS = [
  `${UI_TEXTURE_DIRECTORY}/buttons/build-card-v2-normal.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/build-card-v2-hover.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/build-card-v2-pressed.png`,
  `${UI_TEXTURE_DIRECTORY}/buttons/build-card-v2-disabled.png`,
] as const;
const NAV_BUTTON_ICON_TEXTURE_URLS = [
  ['主菜单按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-main.png`],
  ['星图按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-map.png`],
  ['飞船按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-ship.png`],
  ['建造按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-build.png`],
  ['船员按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-crew.png`],
  ['设置按钮', `${UI_TEXTURE_DIRECTORY}/icons/nav-settings.png`],
] as const;
export const FLOOR_PREFAB_URL = 'db://assets/prefabs/FloorTile.prefab';
export const CONSTRUCTION_GHOST_PREFAB_URL = 'db://assets/prefabs/ConstructionGhost.prefab';
export const BUILD_OPTION_CARD_PREFAB_URL = `${UI_PREFAB_DIRECTORY}/BuildOptionCard.prefab`;
export const STAIRS_PREFAB_URL = 'db://assets/prefabs/StairsRoom.prefab';
export const SOLDIER_PREFAB_URL = 'db://assets/prefabs/SoldierCrew.prefab';
const AUTHORING_SCENES = {
  BOOT: { url: 'db://assets/scenes/BootScene.scene', sceneName: 'BootScene', bootstrap: 'BootSceneBootstrap' },
  MAIN: { url: 'db://assets/scenes/MainScene.scene', sceneName: 'MainScene', bootstrap: 'MainSceneBootstrap' },
  BATTLE: { url: 'db://assets/scenes/BattleScene.scene', sceneName: 'BattleScene', bootstrap: 'BattleSceneBootstrap' },
} as const;
const POWER_ROOM_ROWS = [
  { name: '能源行-激光室', roomId: 'room-laser-1' },
  { name: '能源行-护盾室', roomId: 'room-shield-1' },
  { name: '能源行-医疗室', roomId: 'room-medbay-1' },
] as const;

export interface FoundationAuthoringResult { readonly ok: boolean; readonly message: string }

/**
 * P8.3 标准新手船的稳定布局契约。
 *
 * `medbayBuildTestTarget` 是施工回归使用的上层空位，不会被初始演示房间占用；
 * 它下方有连续上层地板支撑，并避开下层电梯与楼梯占用。
 */
export const P8_STANDARD_STARTER_SHIP = {
  hullDefinitionId: 'hull-starter',
  reactor: { instanceId: 'room-reactor-1', definitionId: 'room-reactor', x: 1, y: 2, width: 5, height: 3 },
  medbayBuildTestTarget: { instanceId: 'room-medbay-1', definitionId: 'room-medbay', x: 6, y: 6 },
} as const;

/** 兼容面板/测试使用的简短别名；值仍由上面的唯一布局契约提供。 */
export const P8_STANDARD_BUILD_TEST_TARGET = P8_STANDARD_STARTER_SHIP.medbayBuildTestTarget;

interface FoundationCreationContext {
  readonly createdAssetUrls: string[];
}

/** 场景动作必须先进入下拉框指定的真实 Scene，不能把 Prefab 编辑上下文当成场景。本方法只读切换上下文。 */
export async function openAuthoringSceneContext(scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<void> {
  const target = AUTHORING_SCENES[kind];
  await openEditorSceneAsset(target.url);
  const bootstrap = await waitForSceneContext(scene, target.sceneName, target.bootstrap);
  if (bootstrap === null) throw new Error(`${target.url} 未加载可编辑的 ${target.bootstrap}`);
}

const UI_PREFAB_PRECHECKS: readonly { readonly url: string; readonly component: string; readonly nodes: readonly string[] }[] = [
  { url: UI_ROOT_PREFAB_URL, component: 'UIRootController', nodes: ['主界面内容根', '战斗界面内容根', '弹窗层', '提示层', '加载层'] },
  { url: MAIN_SCREEN_PREFAB_URL, component: 'MainPageRouter', nodes: ['主导航栏', '页面层', '界面框架素材', '能源面板', '船员状态面板', '主菜单页面', '星图页面', '飞船页面', '建造页面', '船员页面', '主菜单按钮', '星图按钮', '飞船按钮', '建造按钮', '船员按钮', '设置按钮', '全屏按钮', '进入战斗按钮'] },
  { url: BUILD_OPTION_CARD_PREFAB_URL, component: 'BuildOptionCard', nodes: ['预览图', '名称', '详情', '状态'] },
  { url: BATTLE_HUD_PREFAB_URL, component: 'BattleHUD', nodes: ['我方飞船', '敌方飞船', '战斗状态', '返回主场景按钮'] },
  { url: `${UI_PREFAB_DIRECTORY}/PowerRoomRow.prefab`, component: 'PowerRoomRow', nodes: ['房间名称', '当前能源', '减少按钮', '增加按钮', '断电按钮'] },
];

const UI_TEXTURE_PRECHECKS = [
  MAIN_HUD_FRAME_TEXTURE_URL,
  ...NAV_BUTTON_TEXTURE_URLS,
  ...BATTLE_BUTTON_TEXTURE_URLS,
  ...UTILITY_BUTTON_TEXTURE_URLS,
  ...NAV_BUTTON_ICON_TEXTURE_URLS.map(([, url]) => url),
  ...BUILD_CARD_TEXTURE_URLS,
  `${UI_TEXTURE_DIRECTORY}/panel-rail-v2.png`,
  `${UI_TEXTURE_DIRECTORY}/modal-frame-v2.png`,
  `${UI_TEXTURE_DIRECTORY}/battle-hud-frame-v2.png`,
] as const;

/** 共享基础升级的唯一入口：只检查正式 UI 资产，不创建空 UI 节点或覆盖设计布局。 */
async function preflightUiFoundationPrefabs(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  // 纯单元测试端口没有 Creator 的组件注册表；真实 Creator 端口始终提供该公开 API，
  // 测试只验证领域资源回滚，不伪造一整棵 UI Prefab 树。
  if (scene.queryComponents === undefined) return;
  const requiredPrefabUrls = new Set<string>([
    UI_ROOT_PREFAB_URL,
    ...UI_PREFAB_PRECHECKS.map((item) => item.url),
  ]);
  for (const url of requiredPrefabUrls) {
    if (await assetDb.queryUuid(url) === '') throw new Error(`缺少 UI 模块 Prefab：${url}`);
  }
  for (const textureUrl of UI_TEXTURE_PRECHECKS) {
    if (await assetDb.queryUuid(textureUrl) === '') throw new Error(`缺少 UI 素材引用：${textureUrl}`);
  }
  for (const check of UI_PREFAB_PRECHECKS) {
    await openEditorAsset(check.url);
    const root = await waitForEditablePrefabRoot(scene, check.url);
    const component = await waitForComponent(scene, check.component);
    if (component === null) throw new Error(`${check.url} 缺少 ${check.component} 组件`);
    const names = new Set(flattenTree(root).map((node) => node.name).filter((name): name is string => typeof name === 'string'));
    for (const nodeName of check.nodes) if (!names.has(nodeName)) throw new Error(`${check.url} 缺少中文节点：${nodeName}`);
  }
  await ensureCanonicalUiRootModules(assetDb, scene);
}

/** 生成正式的共享 UI、页面和飞船表现 Prefab；所有写入均经 Asset DB 与 Scene 公共接口。 */
async function ensureFoundationAssets(assetDb: AssetDbPort, scene: SceneQueryPort, returnToKind?: SceneSkeletonKind): Promise<FoundationAuthoringResult> {
  const context: FoundationCreationContext = { createdAssetUrls: [] };
  let result: FoundationAuthoringResult;
  let phase = '预检五个正式 UI Prefab';
  const runPhase = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    phase = name;
    return await action();
  };
  try {
    // UI Prefab 是布局唯一权威。先完整预检，任何模块、中文节点或核心组件缺失都在
    // 写入前 fail-closed，避免创建一半的领域资源后才发现 UI 资产不可用。
    await runPhase('预检五个正式 UI Prefab', async () => await preflightUiFoundationPrefabs(assetDb, scene));
    await createBlankPrefab(assetDb, scene, BLANK_NODE_TEMPLATE_URL, context);
    await createBlankPrefab(assetDb, scene, ROOM_TEMPLATE_URL, context);
    await createBlankPrefab(assetDb, scene, CREW_TEMPLATE_URL, context);
    await createConvertedPrefab(assetDb, scene, FLOOR_PREFAB_URL, 'FloorView', 'ensureAuthoringPrefabStructure', context);
    await createConvertedPrefab(assetDb, scene, CONSTRUCTION_GHOST_PREFAB_URL, 'ConstructionGhostView', 'ensureAuthoringPrefabStructure', context);
    await createStairsPrefab(assetDb, scene, context);
    await createSoldierPrefab(assetDb, scene, context);
    await createConvertedPrefab(assetDb, scene, SHIP_VIEW_PREFAB_URL, 'ShipView', 'ensureAuthoringPrefabStructure', context);
    await runPhase('校验并保存 MainScreen 持久页面', async () => await configureMainScreenPrefab(scene));
    // 已存在的正式 Prefab 属于设计资产；这里只升级领域表现 Prefab，不重建任何 UI 层级。
    await ensureExistingDomainPrefabComponent(scene, FLOOR_PREFAB_URL, 'FloorView', 'ensureAuthoringPrefabStructure');
    await ensureExistingDomainPrefabComponent(scene, CONSTRUCTION_GHOST_PREFAB_URL, 'ConstructionGhostView', 'ensureAuthoringPrefabStructure');
    await runPhase('升级 ShipView 共享表现', async () => await ensureShipViewP8Components(assetDb, scene));
    await runPhase('校验并保存 UIRoot 三层组合', async () => await ensureUiRootP8Components(assetDb, scene));
    await runPhase('补齐 MainScreen 视觉与能源行', async () => await ensureMainScreenP8Components(assetDb, scene));
    result = { ok: true, message: '三层核心 UI Prefab、持久页面与 ShipView Prefab 已通过 Creator 公共接口创建或升级' };
  } catch (cause) {
    // UIRoot 会引用核心 UI Prefab；按创建逆序清理，且只清理本次确认不存在后创建的资源。
    const rollbackErrors = await rollbackCreatedAssets(assetDb, [...context.createdAssetUrls].reverse());
    result = { ok: false, message: `${phase}：${toMessage(cause)}；${describeRollback(rollbackErrors)}` };
  }
  if (returnToKind !== undefined) {
    try {
      await openAuthoringSceneContext(scene, returnToKind);
    } catch (cause) {
      return { ok: false, message: `${result.message}；无法返回所选场景：${toMessage(cause)}` };
    }
  }
  return result;
}

/**
 * 场景页唯一公开编排入口。每个场景分支都按固定顺序执行同一套可重复步骤；
 * 新功能必须追加到对应分支，不能再通过面板增加独立按钮或绕过统一队列。
 */
export async function createOrUpdateScene(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  kind: SceneSkeletonKind,
): Promise<FoundationAuthoringResult> {
  // 消息参数来自扩展边界，不能只依赖 TypeScript 联合类型；非法值必须在任何
  // 场景打开或资源写入前失败，避免把未定义分支误判为战斗界面。
  const requestedKind = kind as unknown as string;
  if (requestedKind !== 'BOOT' && requestedKind !== 'MAIN' && requestedKind !== 'BATTLE') {
    return { ok: false, message: `场景类型无效：${String(requestedKind)}；只允许 BOOT、MAIN、BATTLE` };
  }
  const sceneName = kind === 'BOOT' ? '启动界面' : kind === 'MAIN' ? '主界面' : '战斗界面';
  let stage = '准备';
  const completed: string[] = [];
  const run = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    stage = name;
    const result = await action();
    completed.push(name);
    return result;
  };
  try {
    await run('保存当前文档', async () => await saveAuthoringScene());
    await run('打开目标场景', async () => await openAuthoringSceneContext(scene, kind));
    const skeleton = await run('补齐中文场景骨架', async () => await initializeSceneSkeleton(scene, kind));
    if (!skeleton.ok) throw new Error(skeleton.message);
    await run('保存场景骨架', async () => await saveAuthoringScene());

    if (kind === 'BOOT') {
      const wired = await run('清理启动场景旧英文节点', async () => await connectSceneReferences(assetDb, scene, 'BOOT'));
      if (!wired.ok) throw new Error(wired.message);
    } else {
      const foundation = await run('校验并升级共享基础', async () => await ensureFoundationAssets(assetDb, scene, kind));
      if (!foundation.ok) throw new Error(foundation.message);
      await run('重新打开目标场景', async () => await openAuthoringSceneContext(scene, kind));
      const mounted = await run('补齐共享 UIRoot', async () => await ensureSharedUiMount(assetDb, scene, kind));
      if (!mounted.ok) throw new Error(mounted.message);
      await run('重新打开目标场景', async () => await openAuthoringSceneContext(scene, kind));
      if (kind === 'MAIN') {
        await run('补齐主场景飞船与标准演示内容', async () => {
          await ensureP8MainShipInstance(assetDb, scene);
          const demo = await ensureMainSceneContent(assetDb, scene);
          if (!demo.ok) throw new Error(demo.message);
        });
      } else {
        const battle = await run('补齐战斗双方飞船', async () => await ensureBattleSceneShips(assetDb, scene));
        if (!battle.ok) throw new Error(battle.message);
      }
      const wired = await run('连接场景持久引用', async () => await connectSceneReferences(assetDb, scene, kind));
      if (!wired.ok) throw new Error(wired.message);
    }
    await run('保存并重开验证', async () => {
      await saveAuthoringScene();
      await openAuthoringSceneContext(scene, kind);
      const reopened = flattenTree(await scene.queryNodeTree());
      const classes = await queryClasses(scene);
      const bootstrapType = kind === 'BOOT' ? 'BootSceneBootstrap' : kind === 'MAIN' ? 'MainSceneBootstrap' : 'BattleSceneBootstrap';
      if (findNodeWithComponent(await scene.queryNodeTree(), bootstrapType, classes) === null) {
        throw new Error(`重开后缺少 ${bootstrapType}`);
      }
      if (kind !== 'BOOT' && findAllNodesWithComponent(await scene.queryNodeTree(), 'UIRootController', classes).length !== 1) {
        throw new Error(`${sceneName}重开后必须且只能包含一个 UIRootController`);
      }
      if (reopened.length === 0) throw new Error('重开后场景层级为空');
    });
    return { ok: true, message: `${sceneName}创建/更新完成；已完成：${completed.join('、')}` };
  } catch (cause) {
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, message: `${sceneName}在“${stage}”阶段失败：${toMessage(cause)}；已完成：${completed.join('、') || '无'}；已保存阶段不会伪装成自动回滚` };
  }
}

/** MainScreen 只补齐卡片 Prefab 引用；分类、列表和队列布局必须来自持久建造页面节点。 */
async function ensureMainScreenP8Components(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await ensureBuildOptionCardPrefab(assetDb, scene);
  await openEditorAsset(MAIN_SCREEN_PREFAB_URL);
  await bindMainScreenVisualAssets(assetDb, scene);
  await ensureMainScreenPowerRoomRows(assetDb, scene);
  const tree = await scene.queryNodeTree();
  const buildPage = flattenTree(tree).find((node) => node.name === '建造页面');
  if (buildPage?.uuid === undefined) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 缺少持久建造页面节点`);
  const controller = await waitForComponentOnNode(scene, buildPage.uuid, 'BuildPageController');
  if (controller === null) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 的建造页面缺少 BuildPageController`);
  const cardUuid = await assetDb.queryUuid(BUILD_OPTION_CARD_PREFAB_URL);
  if (cardUuid === '') {
    throw new Error(`无法绑定建筑卡片模板：${BUILD_OPTION_CARD_PREFAB_URL}`);
  }
  await ensureReference(scene, controller, 'optionCardPrefab', 'cc.Prefab', cardUuid);
  await saveAuthoringScene();
}

/**
 * 建造卡片的结构和四态素材都必须持久化在独立 Prefab；运行时只实例化并绑定数据。
 * 这里通过 Creator 公共 Scene API 补齐缺失的表现组件，不生成任何卡片子节点或布局。
 */
async function ensureBuildOptionCardPrefab(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await openEditorAsset(BUILD_OPTION_CARD_PREFAB_URL);
  const root = await waitForEditablePrefabRoot(scene, BUILD_OPTION_CARD_PREFAB_URL);
  const card = await waitForComponentOnNode(scene, root.uuid as string, 'BuildOptionCard');
  if (card === null) throw new Error(`${BUILD_OPTION_CARD_PREFAB_URL} 缺少 BuildOptionCard`);
  const classes = await queryClasses(scene);
  const tree = await scene.queryNodeTree();
  const rootNode = flattenTree(tree).find((node) => node.uuid === root.uuid);
  if (rootNode === undefined) throw new Error(`${BUILD_OPTION_CARD_PREFAB_URL} 缺少可编辑根节点`);
  const legacyGraphics = getComponentTarget(rootNode, 'cc.Graphics', classes);
  if (legacyGraphics !== null) {
    await scene.removeComponent(legacyGraphics.uuid);
    await waitForSpecificComponentRemoval(scene, legacyGraphics.uuid);
  }
  const sprite = await ensureComponentOnNode(scene, root.uuid as string, 'cc.Sprite');
  const button = await ensureComponentOnNode(scene, root.uuid as string, 'cc.Button');
  const frames = await Promise.all(BUILD_CARD_TEXTURE_URLS.map(async (url) => await resolveDefaultSpriteFrame(assetDb, url)));
  const [normal, hover, pressed, disabled] = frames;
  if (normal === undefined || hover === undefined || pressed === undefined || disabled === undefined) {
    throw new Error('建筑卡片四态素材不完整');
  }
  if (!(await scene.setProperty(sprite, '_sizeMode', 0))) throw new Error('建筑卡片无法锁定自定义 Sprite 尺寸');
  if (!(await scene.setProperty(sprite, '_type', 0))) throw new Error('建筑卡片无法锁定简单 Sprite');
  if (await shouldFillReference(scene, sprite, 'spriteFrame', assetDb) && !(await scene.setProperty(sprite, 'spriteFrame', { type: 'cc.SpriteFrame', uuid: normal }))) throw new Error('建筑卡片无法绑定普通态素材');
  if (!(await scene.setProperty(button, '_transition', 2))) throw new Error('建筑卡片无法切换 Button 三态');
  if (!(await scene.setProperty(button, '_target', { type: 'cc.Node', uuid: root.uuid }))) throw new Error('建筑卡片无法绑定 Button 目标节点');
  for (const [property, uuid] of [['_normalSprite', normal], ['_hoverSprite', hover], ['_pressedSprite', pressed], ['_disabledSprite', disabled]] as const) {
    if (await shouldFillReference(scene, button, property, assetDb) && !(await scene.setProperty(button, property, { type: 'cc.SpriteFrame', uuid }))) throw new Error(`建筑卡片无法绑定 Button 状态：${property}`);
  }
  if (!(await scene.setProperty(card, 'button', { type: 'cc.Button', uuid: button.uuid }))) throw new Error('建筑卡片无法绑定 Button 引用');
  for (const [property, uuid] of [['normalSprite', normal], ['hoverSprite', hover], ['pressedSprite', pressed], ['disabledSprite', disabled]] as const) {
    if (await shouldFillReference(scene, card, property, assetDb) && !(await scene.setProperty(card, property, { type: 'cc.SpriteFrame', uuid }))) throw new Error(`建筑卡片无法绑定 ${property} 引用`);
  }
  await saveAuthoringScene();
}

async function createSoldierPrefab(assetDb: AssetDbPort, scene: SceneQueryPort, context: FoundationCreationContext): Promise<void> {
  if (await assetDb.queryUuid(SOLDIER_PREFAB_URL)) return;
  context.createdAssetUrls.push(SOLDIER_PREFAB_URL);
  if (await assetDb.copyAsset(CREW_TEMPLATE_URL, SOLDIER_PREFAB_URL) === null) throw new Error(`无法复制士兵 Prefab：${SOLDIER_PREFAB_URL}`);
  await openEditorAsset(SOLDIER_PREFAB_URL);
  // CrewTemplate 是纯 UI 空模板；复制后必须先通过公开 Scene API 挂载
  // CrewView，绑定器才能写入 definitionId/CSV/视觉引用。
  const root = await waitForEditablePrefabRoot(scene, SOLDIER_PREFAB_URL);
  await ensureComponentOnNode(scene, root.uuid as string, 'CrewView');
  const bound = await bindCrewDefinitionToOpenPrefab(scene, assetDb, 'crew-soldier', 'SOLDIER');
  if (!bound.ok) throw new Error(bound.message);
}

async function createStairsPrefab(assetDb: AssetDbPort, scene: SceneQueryPort, context: FoundationCreationContext): Promise<void> {
  if (await assetDb.queryUuid(STAIRS_PREFAB_URL)) return;
  context.createdAssetUrls.push(STAIRS_PREFAB_URL);
  if (await assetDb.copyAsset(ROOM_TEMPLATE_URL, STAIRS_PREFAB_URL) === null) throw new Error(`无法复制楼梯 Prefab：${STAIRS_PREFAB_URL}`);
  await openEditorAsset(STAIRS_PREFAB_URL);
  const bound = await bindRoomDefinitionToOpenPrefab(scene, assetDb, 'room-stairs');
  if (!bound.ok) throw new Error(bound.message);
}

async function ensureShipViewP8Components(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await openEditorAsset(SHIP_VIEW_PREFAB_URL);
  const ship = await waitForComponent(scene, 'ShipView');
  if (ship?.node.uuid === undefined) throw new Error('ShipView Prefab 根节点不可用');
  if (!isAuthoringMethodSuccess(await scene.executeComponentMethod(ship.target.uuid, 'ensureAuthoringPrefabStructure', []))) {
    throw new Error('ShipView Prefab 结构升级失败');
  }
  const catalog = await ensureComponentOnNode(scene, ship.node.uuid, 'BuildablePrefabCatalog');
  const sync = await ensureComponentOnNode(scene, ship.node.uuid, 'ShipContentViewSync');
  const prefabs = {
    floorBasic: FLOOR_PREFAB_URL,
    roomStairs: STAIRS_PREFAB_URL,
    roomElevator: 'db://assets/prefabs/ElevatorRoom.prefab',
    roomReactor: 'db://assets/prefabs/ReactorRoom.prefab',
    roomLaser: 'db://assets/prefabs/LaserRoom.prefab',
    roomShield: 'db://assets/prefabs/ShieldRoom.prefab',
    roomMedbay: 'db://assets/prefabs/MedicalRoom.prefab',
  } as const;
  for (const [property, url] of Object.entries(prefabs)) {
    const uuid = await assetDb.queryUuid(url);
    if (uuid === '' || !(await scene.setProperty(catalog, property, { type: 'cc.Prefab', uuid }))) throw new Error(`无法绑定可建造 Prefab：${url}`);
  }
  await bindBuildablePreviewFrames(assetDb, scene, catalog);
  const ghostUuid = await assetDb.queryUuid(CONSTRUCTION_GHOST_PREFAB_URL);
  if (ghostUuid === '' || !(await scene.setProperty(sync, 'constructionGhostPrefab', { type: 'cc.Prefab', uuid: ghostUuid }))) throw new Error('无法绑定施工幽灵 Prefab');
  if (!isAuthoringMethodSuccess(await scene.executeComponentMethod(sync.uuid, 'applyAuthoringReferences', []))) throw new Error('飞船动态内容引用连接失败');
  const validation = await scene.executeComponentMethod(catalog.uuid, 'validateAuthoringCatalog', []) as { readonly ok?: boolean; readonly message?: string };
  if (validation?.ok !== true) throw new Error(validation?.message ?? '可建造 Prefab 目录校验失败');
  await saveAuthoringScene();
}

/** 预览图只取权威 visuals.csv 的首帧子资源，不把图像路径或规则字段复制进目录。 */
async function bindBuildablePreviewFrames(assetDb: AssetDbPort, scene: SceneQueryPort, catalog: SceneComponentTarget): Promise<void> {
  const loaded = await loadCsvConfigBundle(assetDb);
  if (loaded.ok === false) throw new Error(`读取可建造预览配置失败：${loaded.message}`);
  const definitionVisuals = new Map<string, string>();
  for (const tableName of ['floors.csv', 'rooms.csv'] as const) {
    const rows = parseCsv(loaded.bundle.tables[tableName]);
    const header = rows[0] ?? [];
    for (const row of rows.slice(2)) {
      const values = Object.fromEntries(header.map((key, index) => [key, row[index] ?? '']));
      if (values.id?.trim() !== '' && values.visualId?.trim() !== '') definitionVisuals.set(values.id.trim(), values.visualId.trim());
    }
  }
  const bindings = [
    ['floorBasicPreview', 'floor-basic', 'FLOOR'],
    ['roomStairsPreview', 'room-stairs', 'ROOM'],
    ['roomElevatorPreview', 'room-elevator', 'ROOM'],
    ['roomReactorPreview', 'room-reactor', 'ROOM'],
    ['roomLaserPreview', 'room-laser', 'ROOM'],
    ['roomShieldPreview', 'room-shield', 'ROOM'],
    ['roomMedbayPreview', 'room-medbay', 'ROOM'],
  ] as const;
  for (const [property, definitionId, kind] of bindings) {
    const visualId = definitionVisuals.get(definitionId);
    if (visualId === undefined) throw new Error(`可建造定义缺少视觉标识：${definitionId}`);
    const visual = await loadVisualDefinition(assetDb, visualId, kind);
    const frameUuid = await resolveBuildPreviewFrame(assetDb, visual);
    if (!(await scene.setProperty(catalog, property, { type: 'cc.SpriteFrame', uuid: frameUuid }))) {
      throw new Error(`无法绑定建造预览图：${definitionId}`);
    }
  }
}

/**
 * 建造卡片必须使用动画图集的首帧，而不是 PNG 导入器生成的整张 SpriteFrame。
 * 多帧贴图若退回整图，会把整条动画带宽塞进 64px 预览，表现为卡片横向重叠。
 */
async function resolveBuildPreviewFrame(
  assetDb: AssetDbPort,
  visual: Awaited<ReturnType<typeof loadVisualDefinition>>,
): Promise<string> {
  const atlasUrl = visual.textureUrl.replace(/\.png$/i, '.plist');
  const atlasInfo = await assetDb.queryInfo(atlasUrl);
  const atlasFrames = Object.values(atlasInfo?.subAssets ?? {})
    .filter((entry) => entry.type === 'cc.SpriteFrame')
    .sort((left, right) => (left.name ?? left.uuid).localeCompare(right.name ?? right.uuid));
  const expectedName = `${visual.id}-frame-000`;
  const exact = atlasFrames.find((entry) => stripPng(entry.name ?? entry.displayName ?? '') === expectedName);
  const atlasFirst = atlasFrames[0];
  if (exact !== undefined && exact.uuid.trim() !== '') return exact.uuid;
  // 单帧定义可以复用同一张 PNG 的图集首帧（例如 elevator/floor 共用 83.png）；
  // 多帧定义必须确保图集按当前 visualId 生成，禁止静默退回整张动画条。
  if (visual.frameCount === 1 && atlasFirst !== undefined && atlasFirst.uuid.trim() !== '') return atlasFirst.uuid;
  if (visual.frameCount > 1) {
    const generated = await ensureVisualFrameAssets(
      assetDb,
      visual.id,
      visual.textureUrl,
      visual.imageWidth,
      visual.imageHeight,
      visual.frames,
    );
    const first = generated[0];
    if (first !== undefined && first.trim() !== '') return first;
  }
  if (visual.frameCount === 1) {
    const textureInfo = await assetDb.queryInfo(visual.textureUrl);
    const defaultFrame = Object.values(textureInfo?.subAssets ?? {})
      .filter((entry) => entry.type === 'cc.SpriteFrame')
      .sort((left, right) => (left.name ?? left.uuid).localeCompare(right.name ?? right.uuid))[0];
    if (defaultFrame?.uuid.trim() !== '') return defaultFrame.uuid;
  }
  throw new Error(`视觉 ${visual.id} 缺少可裁切的首帧 SpriteFrame`);
}

function stripPng(value: string): string {
  return value.replace(/\.png$/i, '');
}

/** UIRoot 只做模块、引用和按钮素材校验，不再调用运行时结构重建方法。 */
async function ensureUiRootP8Components(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await ensureCanonicalUiRootModules(assetDb, scene);
  await openEditorAsset(UI_ROOT_PREFAB_URL);
  const tree = await scene.queryNodeTree();
  const classes = await queryClasses(scene);
  const rootController = findNodeWithComponent(tree, 'UIRootController', classes);
  const interaction = findNodeWithComponent(tree, 'WorldInteractionController', classes);
  const battleHud = findNodeWithComponent(tree, 'BattleHUD', classes);
  const crewStatus = findNodeWithComponent(tree, 'CrewStatusPanel', classes);
  const pageRouter = findNodeWithComponent(tree, 'MainPageRouter', classes);
  if (rootController === null || interaction === null || battleHud === null || crewStatus === null || pageRouter === null) {
    throw new Error('UIRoot 模块缺少持久控制组件，请在 Creator 中补齐后重试');
  }
  const popupRoot = flattenTree(tree).find((node) => node.name === '弹窗层');
  const settingsPopupNode = popupRoot?.children?.find((node) => node.name === '设置弹窗');
  if (settingsPopupNode?.uuid === undefined) throw new Error('UIRoot 缺少持久设置节点');
  // MainPageRouter 的公共面板按持久中文节点解析，不再序列化跨 Prefab 的
  // 自定义组件引用；这会让 Creator 在本次保存时清除旧 TargetOverrideInfo，
  // 避免后续 set-property 进入 3.8.8 的 decodePatch 坏分支。
  await saveAuthoringScene();
}

/** 迁移完成后只接受规范的 UI 模块实例，不再运行旧版内嵌节点兼容迁移。 */
async function ensureCanonicalUiRootModules(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await openEditorAsset(UI_ROOT_PREFAB_URL);
  await waitForEditablePrefabRoot(scene, UI_ROOT_PREFAB_URL);
  const tree = await scene.queryNodeTree();
  const findNamed = (name: string): SceneNodeTree | undefined => flattenTree(tree).find((node) => node.name === name);
  const mainRoot = findNamed('主界面内容根');
  const battleRoot = findNamed('战斗界面内容根');
  const popupRoot = findNamed('弹窗层');
  if (mainRoot?.uuid === undefined || battleRoot?.uuid === undefined || popupRoot?.uuid === undefined) throw new Error('UIRoot 内容分层不完整，请先使用规范 UIRoot Prefab');
  const requiredModules = [
    [mainRoot, '主界面模块', MAIN_SCREEN_PREFAB_URL],
    [battleRoot, '战斗界面模块', BATTLE_HUD_PREFAB_URL],
  ] as const;
  for (const [parent, nodeName, url] of requiredModules) {
    const uuid = await assetDb.queryUuid(url);
    if (uuid === '') throw new Error(`缺少 UI 模块 Prefab：${url}`);
    const instanceUuids = new Set(await scene.queryNodesByAssetUuid(uuid));
    const matches = (parent.children ?? []).filter((candidate) => candidate.name === nodeName && candidate.uuid !== undefined && instanceUuids.has(candidate.uuid));
    if (matches.length !== 1) throw new Error(`UIRoot 缺少规范模块实例：${nodeName}`);
  }
  for (const nodeName of ['世界交互模块', '设置弹窗', '拆除确认弹窗', '离线结算弹窗']) {
    if ((popupRoot.children ?? []).filter((candidate) => candidate.name === nodeName).length !== 1) {
      throw new Error(`UIRoot 缺少唯一持久节点：${nodeName}`);
    }
  }
}

async function ensureComponentOnNode(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget> {
  const existing = await waitForComponentOnNode(scene, nodeUuid, type);
  if (existing !== null) return existing;
  await scene.createComponent(nodeUuid, type);
  const created = await waitForComponentOnNode(scene, nodeUuid, type);
  if (created === null) throw new Error(`无法挂载 ${type}`);
  return created;
}

/** 领域表现 Prefab 仍可执行自己的编辑器创作逻辑；UI 模块禁止走此入口。 */
async function ensureExistingDomainPrefabComponent(scene: SceneQueryPort, assetUrl: string, componentType: string, method: string): Promise<void> {
  await openEditorAsset(assetUrl);
  const component = await waitForComponent(scene, componentType);
  if (component === null) throw new Error(`${assetUrl} 缺少 ${componentType}`);
  if (!isAuthoringMethodSuccess(await scene.executeComponentMethod(component.target.uuid, method, []))) throw new Error(`${assetUrl} 的 ${componentType} 领域结构升级失败`);
  await saveAuthoringScene();
}

/** MainScreen 源 Prefab 持久保存能源行模板和代表实例，运行时只按数据增删。 */
async function ensureMainScreenPowerRoomRows(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  const tree = await scene.queryNodeTree();
  const classes = await queryClasses(scene);
  const powerNode = flattenTree(tree).find((node) => node.name === '能源面板');
  if (powerNode?.uuid === undefined) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 缺少能源面板`);
  const power = await waitForComponentOnNode(scene, powerNode.uuid, 'PowerPanel');
  const container = flattenTree(powerNode).find((node) => node.name === '能源行容器');
  if (power === null || container?.uuid === undefined) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 缺少能源行容器或 PowerPanel`);
  const rowUuid = await assetDb.queryUuid(`${UI_PREFAB_DIRECTORY}/PowerRoomRow.prefab`);
  if (rowUuid === '') throw new Error('PowerRoomRow.prefab 不存在');
  await ensureReference(scene, power, 'roomRowTemplate', 'cc.Prefab', rowUuid);

  const childRows = (container.children ?? []).flatMap((node) => {
    const target = getComponentTarget(node, 'PowerRoomRow', classes);
    return target === null ? [] : [{ node, target }];
  });
  const hadExistingRows = childRows.length > 0;
  const rowsByName = new Map<string, { readonly node: SceneNodeTree; readonly target: SceneComponentTarget }>();
  const rowsById = new Map<string, { readonly node: SceneNodeTree; readonly target: SceneComponentTarget }>();
  for (const found of childRows) {
    const name = found.node.name?.trim();
    if (name === undefined || name === '') throw new Error('能源行容器中存在未命名能源行');
    if (rowsByName.has(name)) throw new Error(`能源行容器中存在重复能源行：${name}`);
    rowsByName.set(name, found);
    const id = await readAuthoringProperty(scene, found.target, 'roomInstanceId');
    if (typeof id === 'string' && id.trim() !== '') {
      const normalizedId = id.trim();
      if (rowsById.has(normalizedId)) throw new Error(`能源行容器中存在重复房间实例标识：${normalizedId}`);
      rowsById.set(normalizedId, found);
    }
  }
  if (hadExistingRows && flattenTree(container).every((node) => getComponentTarget(node, 'cc.Layout', classes) === null)) {
    throw new Error('能源行容器已有子节点但没有 Layout；为保护手工布局，请先在 Creator 中明确选择布局方式');
  }

  const representativeRows: SceneComponentTarget[] = [];
  for (const row of POWER_ROOM_ROWS) {
    let found = rowsByName.get(row.name);
    const byId = rowsById.get(row.roomId);
    if (byId !== undefined && (found === undefined || byId.target.uuid !== found.target.uuid)) {
      if (found !== undefined) throw new Error(`${row.name} 与房间实例 ${row.roomId} 存在互相冲突的绑定`);
      found = byId;
    }
    let target = found?.target ?? null;
    if (target === null) {
      const created = await scene.createNode({ parent: container.uuid, name: row.name, assetUuid: rowUuid, type: 'cc.Prefab', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
      if (created?.uuid === undefined) throw new Error(`无法创建持久能源行：${row.name}`);
      target = await waitForComponentOnNode(scene, created.uuid, 'PowerRoomRow');
      if (target === null) throw new Error(`${row.name} 缺少 PowerRoomRow`);
    }
    const current = await readAuthoringProperty(scene, target, 'roomInstanceId');
    if (typeof current === 'string' && current.trim() !== '' && current.trim() !== row.roomId) {
      throw new Error(`${row.name} 已绑定到其他房间实例：${current}`);
    }
    if (current !== row.roomId && !(await scene.setProperty(target, 'roomInstanceId', row.roomId))) throw new Error(`${row.name} 无法绑定房间实例`);
    representativeRows.push(target);
  }

  const refreshedTree = await scene.queryNodeTree();
  const refreshedContainer = flattenTree(refreshedTree).find((candidate) => candidate.uuid === container.uuid);
  if (refreshedContainer === undefined) throw new Error('能源行容器更新后不可编辑');
  const refreshedClasses = await queryClasses(scene);
  if (flattenTree(refreshedContainer).every((candidate) => getComponentTarget(candidate, 'cc.Layout', refreshedClasses) === null)) {
    if (hadExistingRows) throw new Error('能源行容器已有内容但缺少 Layout，已停止以保护手工布局');
    await scene.createComponent(container.uuid, 'cc.UITransform');
    await scene.createComponent(container.uuid, 'cc.Layout');
    const withLayout = flattenTree(await scene.queryNodeTree()).find((candidate) => candidate.uuid === container.uuid);
    const uiTransform = withLayout === undefined ? null : getComponentTarget(withLayout, 'cc.UITransform', await queryClasses(scene));
    const layout = withLayout === undefined ? null : getComponentTarget(withLayout, 'cc.Layout', await queryClasses(scene));
    if (uiTransform === null || layout === null) throw new Error('能源行容器布局组件创建后不可编辑');
    if (!(await scene.setProperty(uiTransform, '_contentSize', { type: 'cc.Size', value: { width: 232, height: 122 } }))) throw new Error('无法设置能源行容器尺寸');
    for (const [path, value] of [['_resizeMode', 1], ['_layoutType', 2], ['_spacingY', 4], ['_paddingLeft', 0], ['_paddingRight', 0], ['_paddingTop', 0], ['_paddingBottom', 0]] as const) {
      if (!(await scene.setProperty(layout, path, value))) throw new Error(`无法设置能源行容器布局：${path}`);
    }
  }
  const finalTree = await scene.queryNodeTree();
  const finalContainer = flattenTree(finalTree).find((candidate) => candidate.uuid === container.uuid);
  const finalClasses = await queryClasses(scene);
  const finalRowUuids = new Set(flattenTree(finalContainer ?? {}).flatMap((candidate) => {
    const target = getComponentTarget(candidate, 'PowerRoomRow', finalClasses);
    return target === null ? [] : [target.uuid];
  }));
  if (representativeRows.length !== POWER_ROOM_ROWS.length || representativeRows.some((row) => !finalRowUuids.has(row.uuid))) {
    throw new Error('能源面板缺少三个持久代表能源行');
  }
}

/** 在当前 Main/Battle 场景的画布下实例化同一 UIRoot Prefab，并写入中文模式。 */
async function ensureSharedUiMount(assetDb: AssetDbPort, scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<FoundationAuthoringResult> {
  if (kind === 'BOOT') return { ok: false, message: '启动场景不挂载完整共享界面' };
  const prefabUuid = await assetDb.queryUuid(UI_ROOT_PREFAB_URL);
  if (prefabUuid === '') return { ok: false, message: '请先创建共享 UIRoot Prefab' };
  const classes = await queryClasses(scene);
  const tree = await scene.queryNodeTree();
  const existingRoots = findAllNodesWithComponent(tree, 'UIRootController', classes);
  if (existingRoots.length > 1) return { ok: false, message: `当前场景存在 ${existingRoots.length} 个 UIRootController，已停止以避免重复界面` };
  if (existingRoots.length === 1) {
    if (!(await scene.setProperty(existingRoots[0].target, 'mode', kind === 'MAIN' ? 0 : 1))) return { ok: false, message: '无法更新共享界面模式' };
    await saveAuthoringScene();
    return { ok: true, message: '当前场景已保留唯一共享 UIRoot，并刷新界面模式' };
  }
  const canvas = flattenTree(tree).find((node) => node.name === '画布');
  if (canvas?.uuid === undefined) return { ok: false, message: '当前场景缺少中文“画布”节点，请先补齐场景骨架' };
  const created = await scene.createNode({ parent: canvas.uuid, name: '界面根', assetUuid: prefabUuid, type: 'cc.Prefab', unlinkPrefab: false });
  if (created?.uuid === undefined) return { ok: false, message: '无法实例化共享 UIRoot Prefab' };
  try {
    const target = await waitForComponentOnNode(scene, created.uuid, 'UIRootController');
    if (target === null) throw new Error('UIRoot Prefab 缺少界面根控制组件');
    if (!(await scene.setProperty(target, 'mode', kind === 'MAIN' ? 0 : 1))) throw new Error('无法写入共享界面模式');
    await saveAuthoringScene();
    return { ok: true, message: `${kind === 'MAIN' ? '主场景' : '战斗场景'}已挂载共享 UIRoot Prefab` };
  } catch (cause) {
    await scene.removeNode(created.uuid).catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚界面实例` };
  }
}

/**
 * 通过公开 Scene set-property 持久化场景位置和 Bootstrap 引用。
 *
 * 运行时只读取这些序列化引用；这里不能再依赖 execute-component-method 内部扫描场景树，
 * 否则切场景或 Prefab 覆盖刷新后会把“当前恰好找到的组件”误当成正式绑定。
 */
async function connectSceneReferences(assetDb: AssetDbPort, scene: SceneQueryPort, kind: SceneSkeletonKind): Promise<FoundationAuthoringResult> {
  if (kind === 'BOOT') return await cleanLegacyBootNodes(scene);
  const classes = await queryClasses(scene);
  const tree = await scene.queryNodeTree();
  const nodes = flattenTree(tree);
  try {
    const worldRoot = requireUniqueNode(nodes, '世界根');

    if (kind === 'MAIN') {
      const bootstrap = requireComponent(nodes, 'MainSceneBootstrap', classes);
      const configSource = await bindCsvConfigSourceToNode(assetDb, scene, bootstrap.nodeUuid);
      const mainCamera = requireUniqueNode(nodes, '主相机');
      const camera = requireComponent([mainCamera], 'cc.Camera', classes);
      const mount = requireUniqueNode(nodes, '当前飞船挂载点');
      const shipView = requireUniqueDescendantComponent(mount, 'ShipView', classes, '当前飞船挂载点');
      const powerPanel = requireUniqueComponent(nodes, 'PowerPanel', classes);
      const crewStatusPanel = requireUniqueComponent(nodes, 'CrewStatusPanel', classes);
      const pageRouter = requireUniqueComponent(nodes, 'MainPageRouter', classes);
      const buildPageController = requireUniqueComponent(nodes, 'BuildPageController', classes);
      const cameraController = requireUniqueComponent(nodes, 'CameraController', classes);
      const contentViewSync = requireUniqueComponent(nodes, 'ShipContentViewSync', classes);
      const worldInteractionController = requireUniqueComponent(nodes, 'WorldInteractionController', classes);
      const demolitionConfirmDialog = requireUniqueComponent(nodes, 'DemolitionConfirmDialog', classes);
      const offlineSettlementDialog = requireUniqueComponent(nodes, 'OfflineSettlementDialog', classes);
      const mainContentRoot = requireUniqueNode(nodes, '主界面内容根');
      const battleContentRoot = requireUniqueNode(nodes, '战斗界面内容根');
      const popupRoot = requireUniqueNode(nodes, '弹窗层');
      await setNodeActive(scene, mainContentRoot.uuid as string, true);
      await setNodeActive(scene, battleContentRoot.uuid as string, false);
      for (const [path, type, target] of [
        ['shipView', 'ShipView', shipView],
        ['powerPanel', 'PowerPanel', powerPanel],
        ['crewStatusPanel', 'CrewStatusPanel', crewStatusPanel],
        ['mainPageRouter', 'MainPageRouter', pageRouter],
        ['buildPageController', 'BuildPageController', buildPageController],
        ['cameraController', 'CameraController', cameraController],
        ['contentViewSync', 'ShipContentViewSync', contentViewSync],
        ['worldInteractionController', 'WorldInteractionController', worldInteractionController],
        ['demolitionConfirmDialog', 'DemolitionConfirmDialog', demolitionConfirmDialog],
        ['offlineSettlementDialog', 'OfflineSettlementDialog', offlineSettlementDialog],
      ] as const) await setReference(scene, bootstrap, path, type, target);
      if (!(await scene.setProperty(bootstrap, 'configVersion', P8_CLOSE_CONFIG_VERSION))) {
        throw new Error('无法升级主场景配置版本');
      }
      await setReference(scene, cameraController, 'camera', 'cc.Camera', camera);
      await setReference(scene, shipView, 'configSource', 'GameConfigCsvSource', configSource);
    } else {
      const bootstrap = requireComponent(nodes, 'BattleSceneBootstrap', classes);
      const configSource = await bindCsvConfigSourceToNode(assetDb, scene, bootstrap.nodeUuid);
      const playerMount = requireUniqueNode(nodes, '我方飞船挂载点');
      const enemyMount = requireUniqueNode(nodes, '敌方飞船挂载点');
      const playerShips = findAllNodesWithComponent(playerMount, 'ShipView', classes);
      const enemyShips = findAllNodesWithComponent(enemyMount, 'ShipView', classes);
      if (playerShips.length !== 1) throw new Error(`我方挂载点必须且只能包含一个飞船视图，当前为 ${playerShips.length} 个`);
      if (enemyShips.length !== 1) throw new Error(`敌方挂载点必须且只能包含一个飞船视图，当前为 ${enemyShips.length} 个`);
      const battleHud = requireUniqueComponent(nodes, 'BattleHUD', classes);
      await setNodeActive(scene, requireUniqueNode(nodes, '主界面内容根').uuid as string, false);
      await setNodeActive(scene, requireUniqueNode(nodes, '战斗界面内容根').uuid as string, true);
      await setReference(scene, bootstrap, 'playerShipView', 'ShipView', playerShips[0].target);
      await setReference(scene, bootstrap, 'enemyShipView', 'ShipView', enemyShips[0].target);
      await setReference(scene, bootstrap, 'battleHud', 'BattleHUD', battleHud);
      await setReference(scene, playerShips[0].target, 'configSource', 'GameConfigCsvSource', configSource);
      await setReference(scene, enemyShips[0].target, 'configSource', 'GameConfigCsvSource', configSource);
    }
    await saveAuthoringScene();
    return { ok: true, message: `${kind === 'MAIN' ? '主场景' : '战斗场景'}引用已连接并保存` };
  } catch (cause) {
    return { ok: false, message: toMessage(cause) };
  }
}

const P8_DEMO_ROOMS = [
  { instanceId: P8_STANDARD_STARTER_SHIP.reactor.instanceId, definitionId: P8_STANDARD_STARTER_SHIP.reactor.definitionId, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', x: P8_STANDARD_STARTER_SHIP.reactor.x, y: P8_STANDARD_STARTER_SHIP.reactor.y, initialHp: -1 },
  { instanceId: 'room-elevator-1', definitionId: 'room-elevator', prefabUrl: 'db://assets/prefabs/ElevatorRoom.prefab', x: 8, y: 2, initialHp: -1 },
  { instanceId: 'room-stairs-1', definitionId: 'room-stairs', prefabUrl: STAIRS_PREFAB_URL, x: 11, y: 2, initialHp: -1 },
  { instanceId: 'room-laser-1', definitionId: 'room-laser', prefabUrl: 'db://assets/prefabs/LaserRoom.prefab', x: 14, y: 2, initialHp: 60 },
  { instanceId: 'room-shield-1', definitionId: 'room-shield', prefabUrl: 'db://assets/prefabs/ShieldRoom.prefab', x: 1, y: 6, initialHp: -1 },
  { instanceId: 'room-medbay-1', definitionId: 'room-medbay', prefabUrl: 'db://assets/prefabs/MedicalRoom.prefab', x: 14, y: 6, initialHp: -1 },
] as const;

/** 标准演示船地板范围；下层故意不覆盖 (18,1)，供建造/拆除回归使用。 */
export const P8_STANDARD_DEMO_FLOOR_X = { min: 1, max: 17 } as const;
export const P8_STANDARD_DEMO_FLOOR_ROWS = [1, 5] as const;
const P8_CLOSE_CONFIG_VERSION = 'r1-p8-close-1';

const P8_DEMO_CREWS = [
  { instanceId: 'crew-engineer-1', definitionId: 'crew-engineer', prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', roomId: 'room-reactor-1', station: 0, initialHp: -1, patrol: [] },
  { instanceId: 'crew-gunner-1', definitionId: 'crew-gunner', prefabUrl: 'db://assets/prefabs/GunnerCrew.prefab', roomId: 'room-reactor-1', station: 1, initialHp: 40, patrol: [] },
  { instanceId: 'crew-medic-1', definitionId: 'crew-medic', prefabUrl: 'db://assets/prefabs/MedicCrew.prefab', roomId: 'room-medbay-1', station: 0, initialHp: -1, patrol: [] },
  { instanceId: 'crew-soldier-1', definitionId: 'crew-soldier', prefabUrl: SOLDIER_PREFAB_URL, roomId: 'room-laser-1', station: 0, initialHp: -1, patrol: ['room-laser-1', 'room-medbay-1', 'room-shield-1', 'room-reactor-1'] },
  // 完整施工验收需要三名工程师；复用同一正式 Prefab，不复制职业定义或视觉资源。
  { instanceId: 'crew-engineer-2', definitionId: 'crew-engineer', prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', roomId: 'room-laser-1', station: 1, initialHp: -1, patrol: [] },
  { instanceId: 'crew-engineer-3', definitionId: 'crew-engineer', prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', roomId: 'room-shield-1', station: 0, initialHp: -1, patrol: [] },
] as const;

/**
 * 把当前 MainScene 收敛为 P8 固定演示布局。所有节点均来自 Prefab，整批操作只有一条 Undo，
 * 并在成功后保存当前场景；不会扫描或改写关闭的 Scene。
 */
async function ensureMainSceneContent(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<FoundationAuthoringResult> {
  const classes = await queryClasses(scene);
  let tree = await scene.queryNodeTree();
  const ships = findAllNodesWithComponent(tree, 'ShipView', classes);
  if (ships.length !== 1 || ships[0].node.uuid === undefined) return { ok: false, message: 'P8 演示布局要求当前场景恰好包含一艘 ShipView' };
  const ship = ships[0];
  const shipNodeUuid = ship.node.uuid as string;
  try {
    const shipState = await scene.executeComponentMethod(ship.target.uuid, 'getAuthoringInspectorState', []) as Record<string, unknown> | null;
    const hullId = shipState?.hullDefinitionId;
    if (typeof hullId === 'string' && hullId.trim() !== '' && hullId.trim() !== P8_STANDARD_STARTER_SHIP.hullDefinitionId) {
      return { ok: false, message: `标准新手船要求 ${P8_STANDARD_STARTER_SHIP.hullDefinitionId}，当前为 ${hullId}` };
    }
  } catch (cause) {
    return { ok: false, message: `无法读取标准新手船船体定义：${toMessage(cause)}` };
  }
  const floorRoot = flattenTree(ship.node).find((node) => node.name === '地板容器');
  const roomRoot = flattenTree(ship.node).find((node) => node.name === '房间容器');
  const crewRoot = flattenTree(ship.node).find((node) => node.name === '船员层');
  if (floorRoot?.uuid === undefined || roomRoot?.uuid === undefined || crewRoot?.uuid === undefined) {
    return { ok: false, message: 'ShipView 缺少地板容器、房间容器或船员层，请先创建/升级共享基础并重新连接引用' };
  }

  const requiredUrls = [FLOOR_PREFAB_URL, ...P8_DEMO_ROOMS.map((entry) => entry.prefabUrl), ...P8_DEMO_CREWS.map((entry) => entry.prefabUrl)];
  const assetUuids = new Map<string, string>();
  for (const url of [...new Set(requiredUrls)]) {
    const uuid = await assetDb.queryUuid(url);
    if (uuid === '') return { ok: false, message: `缺少 P8 演示 Prefab：${url}；请先点击“创建/升级共享基础”` };
    assetUuids.set(url, uuid);
  }

  const createdNodeUuids: string[] = [];
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(shipNodeUuid);
    tree = await scene.queryNodeTree();
    const floorTargets = await collectTargetsByStableId(scene, tree, classes, 'FloorView', 'floorInstanceId');
    for (const y of P8_STANDARD_DEMO_FLOOR_ROWS) {
      for (let x = P8_STANDARD_DEMO_FLOOR_X.min; x <= P8_STANDARD_DEMO_FLOOR_X.max; x += 1) {
        const instanceId = `floor-basic-${x}-${y}`;
        const existing = floorTargets.get(instanceId);
        const target = existing ?? await createPrefabComponent(scene, floorRoot.uuid, `地板-${x}-${y}`, assetUuids.get(FLOOR_PREFAB_URL) as string, 'FloorView', createdNodeUuids);
        await ensureStableProperty(scene, target, 'floorInstanceId', instanceId);
        await ensureStableProperty(scene, target, 'floorDefinitionId', 'floor-basic');
        if (existing === undefined && await scene.executeComponentMethod(target.uuid, 'applyAuthoringPlacement', [x, y]) !== true) throw new Error(`无法放置地板：${instanceId}`);
      }
    }

    tree = await scene.queryNodeTree();
    const roomTargets = await collectTargetsByStableId(scene, tree, classes, 'RoomView', 'roomInstanceId');
    for (const entry of P8_DEMO_ROOMS) {
      const existing = roomTargets.get(entry.instanceId);
      const target = existing ?? await createPrefabComponent(scene, roomRoot.uuid, `房间-${entry.instanceId}`, assetUuids.get(entry.prefabUrl) as string, 'RoomView', createdNodeUuids);
      await ensureStableProperty(scene, target, 'roomInstanceId', entry.instanceId);
      if (existing === undefined) await requireProperty(scene, target, 'initialHp', entry.initialHp);
      if (existing === undefined && await scene.executeComponentMethod(target.uuid, 'applyEditorPlacement', [{ x: entry.x, y: entry.y }]) !== true) throw new Error(`无法放置房间：${entry.instanceId}`);
    }

    tree = await scene.queryNodeTree();
    const crewTargets = await collectTargetsByStableId(scene, tree, classes, 'CrewView', 'crewInstanceId');
    for (const entry of P8_DEMO_CREWS) {
      const existing = crewTargets.get(entry.instanceId);
      const target = existing ?? await createPrefabComponent(scene, crewRoot.uuid, `船员-${entry.instanceId}`, assetUuids.get(entry.prefabUrl) as string, 'CrewView', createdNodeUuids);
      await ensureStableProperty(scene, target, 'crewInstanceId', entry.instanceId);
      if (existing === undefined) {
        await requireProperty(scene, target, 'initialRoomInstanceId', entry.roomId);
        await requireProperty(scene, target, 'initialStationIndex', entry.station);
        await requireProperty(scene, target, 'initialHp', entry.initialHp);
        await requireProperty(scene, target, 'patrolRoomInstanceIdsJson', JSON.stringify(entry.patrol));
      }
      if (existing === undefined && await scene.executeComponentMethod(target.uuid, 'applyAuthoringPatrolRoute', [JSON.stringify(entry.patrol)]) !== true) {
        throw new Error(`无法写入船员巡逻路线：${entry.instanceId}`);
      }
      if (existing === undefined && await scene.executeComponentMethod(target.uuid, 'applyEditorInitialPlacement', []) !== true) throw new Error(`无法放置船员：${entry.instanceId}`);
    }

    await scene.endRecording(undoId);
    undoId = null;
    await saveAuthoringScene();
    return {
      ok: true,
      message: `P8 双层地板、六个房间、楼梯/电梯和六名船员（三名工程师）已持久装配；${P8_STANDARD_STARTER_SHIP.reactor.definitionId} 为 ${P8_STANDARD_STARTER_SHIP.reactor.width}×${P8_STANDARD_STARTER_SHIP.reactor.height} 格；医疗室施工回归目标为 (${P8_STANDARD_BUILD_TEST_TARGET.x},${P8_STANDARD_BUILD_TEST_TARGET.y})；士兵巡逻路线已连接`,
    };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    // 先结束录制再删除临时节点，避免回滚本身制造第二条 Undo 或触发未配对的 snapshotAbort。
    for (const uuid of [...createdNodeUuids].reverse()) await scene.removeNode(uuid).catch(() => undefined);
    return { ok: false, message: `${toMessage(cause)}；已回滚本次 P8 场景装配` };
  }
}

/** 主场景没有旧实例时也要从共享 ShipView Prefab 建立唯一标准新手船根。 */
async function ensureP8MainShipInstance(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  await openAuthoringSceneContext(scene, 'MAIN');
  const tree = await scene.queryNodeTree();
  const classes = await queryClasses(scene);
  const mount = flattenTree(tree).find((node) => node.uuid !== undefined && node.name === '当前飞船挂载点');
  if (mount?.uuid === undefined) throw new Error('主场景缺少当前飞船挂载点');
  const existingShip = (mount.children ?? []).find((child) => getComponentTarget(child, 'ShipView', classes) !== null);
  if (existingShip !== undefined) {
    const existingTarget = getComponentTarget(existingShip, 'ShipView', classes);
    if (existingTarget === null) throw new Error('主场景现有飞船缺少 ShipView 组件');
    await ensureStableProperty(scene, existingTarget, 'shipId', 'ship-1');
    await ensureStableProperty(scene, existingTarget, 'hullDefinitionId', P8_STANDARD_STARTER_SHIP.hullDefinitionId);
    return;
  }
  const prefabUuid = await assetDb.queryUuid(SHIP_VIEW_PREFAB_URL);
  if (prefabUuid === '') throw new Error(`缺少 ShipView.prefab：${SHIP_VIEW_PREFAB_URL}`);
  const undoId = await scene.beginRecording(mount.uuid);
  try {
    const created = await scene.createNode({ parent: mount.uuid, name: '飞船视图', assetUuid: prefabUuid, type: 'cc.Prefab', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
    if (created?.uuid === undefined) throw new Error('无法创建标准新手船 ShipView 实例');
    const ship = await waitForComponentOnNode(scene, created.uuid, 'ShipView');
    if (ship === null) throw new Error('标准新手船 ShipView 组件未加载');
    if (!(await scene.setProperty(ship, 'shipId', 'ship-1', { record: false }))) throw new Error('无法写入标准新手船实例标识');
    if (!(await scene.setProperty(ship, 'hullDefinitionId', P8_STANDARD_STARTER_SHIP.hullDefinitionId, { record: false }))) throw new Error('无法写入标准新手船体定义标识');
    await scene.endRecording(undoId);
  } catch (cause) {
    await scene.cancelRecording(undoId).catch(() => undefined);
    throw cause;
  }
}

async function ensureBattleSceneShips(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<FoundationAuthoringResult> {
  try {
    await openAuthoringSceneContext(scene, 'BATTLE');
    const tree = await scene.queryNodeTree();
    const classes = await queryClasses(scene);
    const nodes = flattenTree(tree);
    const playerMount = requireUniqueNode(nodes, '我方飞船挂载点');
    const enemyMount = requireUniqueNode(nodes, '敌方飞船挂载点');
    if (playerMount.uuid === undefined || enemyMount.uuid === undefined) return { ok: false, message: '战斗场景缺少我方或敌方飞船挂载点' };
    const shipUuid = await assetDb.queryUuid(SHIP_VIEW_PREFAB_URL);
    if (shipUuid === '') return { ok: false, message: '缺少 ShipView.prefab' };
    const playerCandidates = findAllNodesWithComponent(playerMount, 'ShipView', classes);
    const enemyCandidates = findAllNodesWithComponent(enemyMount, 'ShipView', classes);
    if (playerCandidates.length > 1 || enemyCandidates.length > 1) {
      return { ok: false, message: `BattleScene 挂载点存在重复 ShipView：我方 ${playerCandidates.length} 个、敌方 ${enemyCandidates.length} 个；请先在层级中删除多余实例` };
    }
    const playerExisting = playerCandidates[0]?.node;
    const enemyExisting = enemyCandidates[0]?.node;
    const player = playerExisting?.uuid !== undefined ? { uuid: playerExisting.uuid } : await scene.createNode({ parent: playerMount.uuid, name: '玩家飞船', assetUuid: shipUuid, type: 'cc.Prefab', unlinkPrefab: false, snapshot: false });
    const enemy = enemyExisting?.uuid !== undefined ? { uuid: enemyExisting.uuid } : await scene.createNode({ parent: enemyMount.uuid, name: '敌方飞船', assetUuid: shipUuid, type: 'cc.Prefab', unlinkPrefab: false, snapshot: false });
    if (player?.uuid === undefined || enemy?.uuid === undefined) return { ok: false, message: '无法实例化 BattleScene 两艘 ShipView' };
    const playerTarget = await waitForComponentOnNode(scene, player.uuid, 'ShipView');
    const enemyTarget = await waitForComponentOnNode(scene, enemy.uuid, 'ShipView');
    if (playerTarget === null || enemyTarget === null) return { ok: false, message: 'BattleScene ShipView 组件未加载' };
    try {
      await ensureStableProperty(scene, playerTarget, 'shipId', 'ship-1');
      await ensureStableProperty(scene, playerTarget, 'hullDefinitionId', 'hull-starter');
      await ensureStableProperty(scene, enemyTarget, 'shipId', 'ship-enemy-1');
      await ensureStableProperty(scene, enemyTarget, 'hullDefinitionId', 'hull-raider');
    } catch (cause) {
      return { ok: false, message: `BattleScene 稳定引用冲突：${toMessage(cause)}` };
    }
    const wired = await connectSceneReferences(assetDb, scene, 'BATTLE');
    if (!wired.ok) return { ok: false, message: wired.message };
    await saveAuthoringScene();
    return { ok: true, message: 'BattleScene 已装配玩家 hull-starter 与敌方 hull-raider' };
  } catch (cause) {
    return { ok: false, message: toMessage(cause) };
  }
}

/**
 * 取消当前编辑器上下文的内存预览覆盖。
 *
 * 预览组件提供 clearAuthoringDefinitionPreview；这里只调用白名单方法，不做
 * Scene snapshot/save，因此不会把草稿值写入 Prefab 或场景，也不会产生 Undo。
 */
export async function cancelAuthoringPreview(scene: SceneQueryPort): Promise<FoundationAuthoringResult> {
  try {
    const tree = await scene.queryNodeTree();
    const classes = await queryClasses(scene);
    const methods: readonly [string, string][] = [
      ['ShipView', 'clearAuthoringDefinitionPreview'],
      ['RoomView', 'clearAuthoringDefinitionPreview'],
      ['CrewView', 'clearAuthoringDefinitionPreview'],
    ];
    let cleared = 0;
    const failures: string[] = [];
    for (const [type, method] of methods) {
      for (const found of findAllNodesWithComponent(tree, type, classes)) {
        try {
          const result = await scene.executeComponentMethod(found.target.uuid, method, []);
          if (!isAuthoringMethodSuccess(result)) failures.push(`${found.node.name ?? found.target.uuid}：${type} 预览清理失败`);
          else cleared += 1;
        } catch (cause) {
          failures.push(`${found.node.name ?? found.target.uuid}：${toMessage(cause)}`);
        }
      }
    }
    if (failures.length > 0) return { ok: false, message: `已清理 ${cleared} 个预览，但仍有失败：${failures.join('；')}` };
    return { ok: true, message: cleared === 0 ? '当前编辑上下文没有可取消的预览' : `已取消 ${cleared} 个内存预览，未写入场景` };
  } catch (cause) {
    return { ok: false, message: `取消编辑器预览失败：${toMessage(cause)}` };
  }
}

async function collectTargetsByStableId(
  scene: SceneQueryPort,
  tree: SceneNodeTree,
  classes: readonly SceneComponentClassInfo[],
  type: string,
  key: string,
): Promise<Map<string, SceneComponentTarget>> {
  const result = new Map<string, SceneComponentTarget>();
  for (const found of findAllNodesWithComponent(tree, type, classes)) {
    const state = await scene.executeComponentMethod(found.target.uuid, 'getAuthoringInspectorState', []) as Record<string, unknown> | null;
    const id = state?.[key];
    if (typeof id === 'string' && id.trim() !== '') {
      const normalizedId = id.trim();
      if (result.has(normalizedId)) throw new Error(`${type} 稳定实例标识重复：${normalizedId}`);
      result.set(normalizedId, found.target);
    }
  }
  return result;
}

async function createPrefabComponent(
  scene: SceneQueryPort,
  parent: string,
  name: string,
  assetUuid: string,
  type: string,
  created: string[],
): Promise<SceneComponentTarget> {
  const node = await scene.createNode({ parent, name, assetUuid, type: 'cc.Prefab', unlinkPrefab: false, snapshot: false });
  if (node?.uuid === undefined) throw new Error(`无法实例化 ${name}`);
  created.push(node.uuid);
  const target = await waitForComponentOnNode(scene, node.uuid, type);
  if (target === null) throw new Error(`${name} 缺少 ${type}`);
  return target;
}

async function requireProperty(scene: SceneQueryPort, target: SceneComponentTarget, path: string, value: unknown): Promise<void> {
  if (!(await scene.setProperty(target, path, value, { record: false }))) throw new Error(`无法写入 ${path}`);
}

async function ensureStableProperty(scene: SceneQueryPort, target: SceneComponentTarget, path: string, expected: string): Promise<void> {
  const current = await readAuthoringProperty(scene, target, path);
  if (typeof current === 'string' && current.trim() !== '' && current !== expected) {
    throw new Error(`${path} 冲突：已有“${current}”，期望“${expected}”`);
  }
  if (current !== expected && !(await scene.setProperty(target, path, expected, { record: false }))) throw new Error(`无法写入 ${path}`);
}

async function readAuthoringProperty(scene: SceneQueryPort, target: SceneComponentTarget, path: string): Promise<unknown> {
  const component = await scene.queryComponent(target.uuid);
  return component?.value?.[path];
}

async function createBlankPrefab(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  targetUrl: string,
  context: FoundationCreationContext,
): Promise<void> {
  if (await assetDb.queryUuid(targetUrl)) return;
  await createConvertedPrefab(assetDb, scene, targetUrl, null, null, context);
}

async function createConvertedPrefab(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  targetUrl: string,
  componentType: string | null,
  ensureMethod: string | null,
  context: FoundationCreationContext,
): Promise<void> {
  const existingUuid = await assetDb.queryUuid(targetUrl);
  if (existingUuid !== '') {
    if (componentType === null) return;
    await openEditorAsset(targetUrl);
    if (await waitForComponent(scene, componentType) !== null) return;
    const room = await waitForComponent(scene, 'RoomView');
    if (room !== null) {
      await scene.executeComponentMethod(room.target.uuid, 'removeForAuthoringTemplateConversion', []);
      await waitForComponentRemoval(scene, 'RoomView');
    }
    const editableRoot = await waitForEditablePrefabRoot(scene, targetUrl);
    await scene.createComponent(editableRoot.uuid as string, componentType);
    const target = await waitForComponentOnNode(scene, editableRoot.uuid as string, componentType);
    if (target === null) throw new Error(`无法挂载 ${componentType}`);
    if (ensureMethod !== null && !isAuthoringMethodSuccess(await scene.executeComponentMethod(target.uuid, ensureMethod, []))) throw new Error(`${componentType} 结构补齐失败`);
    await saveAuthoringScene();
    return;
  }
  // 复制请求一旦开始就登记目标；Creator 可能在抛错前已经写入资源，回滚必须保守清理。
  context.createdAssetUrls.push(targetUrl);
  const blankTemplateUrl = componentType === null
    ? (targetUrl === BLANK_NODE_TEMPLATE_URL ? DEFAULT_TEMPLATE_URL : BLANK_NODE_TEMPLATE_URL)
    : BLANK_NODE_TEMPLATE_URL;
  const sourceUrl = await assetDb.queryUuid(blankTemplateUrl) === '' ? DEFAULT_TEMPLATE_URL : blankTemplateUrl;
  if (await assetDb.copyAsset(sourceUrl, targetUrl) === null) throw new Error(`无法复制 Prefab 模板：${targetUrl}`);
  // copy-asset 返回成功只代表文件复制请求已接受；Creator 仍可能尚未完成
  // Prefab 导入和 UUID 注册。先等待 imported=true，避免随后 query-uuid 返回空值，
  // 尤其是刚创建的 BuildOptionCard 在同一批次内立即被 BuildPage 绑定时。
  if (typeof assetDb.queryInfo === 'function') await waitForImportedAsset(assetDb, targetUrl);
  await openEditorAsset(targetUrl);
  const room = await waitForComponent(scene, 'RoomView');
  if (room !== null) {
    await scene.executeComponentMethod(room.target.uuid, 'removeForAuthoringTemplateConversion', []);
    await waitForComponentRemoval(scene, 'RoomView');
  }
  if (componentType !== null) {
    const editableRoot = await waitForEditablePrefabRoot(scene, targetUrl);
    await scene.createComponent(editableRoot.uuid as string, componentType);
    const target = await waitForComponentOnNode(scene, editableRoot.uuid as string, componentType);
    if (target === null) throw new Error(`无法挂载 ${componentType}`);
    if (ensureMethod !== null && !isAuthoringMethodSuccess(await scene.executeComponentMethod(target.uuid, ensureMethod, []))) throw new Error(`${componentType} 结构补齐失败`);
  }
  await saveAuthoringScene();
}

async function configureMainScreenPrefab(scene: SceneQueryPort): Promise<void> {
  await openEditorAsset(MAIN_SCREEN_PREFAB_URL);
  const root = await waitForEditablePrefabRoot(scene, MAIN_SCREEN_PREFAB_URL);
  const router = await waitForComponentOnNode(scene, root.uuid as string, 'MainPageRouter');
  if (router === null) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 缺少 MainPageRouter`);
  const nodes = flattenTree(await scene.queryNodeTree());
  const required = (name: string): SceneNodeTree => {
    const matches = nodes.filter((node) => node.name === name);
    if (matches.length !== 1 || matches[0]?.uuid === undefined) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 缺少唯一中文节点：${name}`);
    return matches[0];
  };
  required('页面层');
  required('主导航栏');
  required('界面框架素材');
  const powerNode = required('能源面板');
  const crewNode = required('船员状态面板');
  const pageNodes = [
    ['mainMenuPage', '主菜单页面'], ['galaxyMapPage', '星图页面'], ['shipPage', '飞船页面'],
    ['buildPage', '建造页面'], ['crewPage', '船员页面'],
  ] as const;
  for (const [property, name] of pageNodes) {
    const page = required(name);
    if (page.uuid === undefined) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 无法绑定持久页面：${name}`);
    await ensureReference(scene, router, property, 'cc.Node', page.uuid);
  }
  const powerTarget = await waitForComponentOnNode(scene, powerNode.uuid as string, 'PowerPanel');
  const crewTarget = await waitForComponentOnNode(scene, crewNode.uuid as string, 'CrewStatusPanel');
  if (powerTarget === null || crewTarget === null) throw new Error(`${MAIN_SCREEN_PREFAB_URL} 公共面板缺少组件`);
  // 公共面板由 MainPageRouter 按持久中文节点解析。旧版本把自定义组件引用写进
  // Prefab targetOverrides，Creator 3.8.8 再次 set-property 时会在 decodePatch
  // 访问未定义类；这里只校验组件存在并保存，让脚本重载后清除旧覆盖。
  await saveAuthoringScene();
}

async function setReference(scene: SceneQueryPort, owner: SceneComponentTarget, path: string, type: string, value: SceneComponentTarget): Promise<void> {
  await ensureReference(scene, owner, path, type, value.uuid);
}

async function setNodeReference(scene: SceneQueryPort, owner: SceneComponentTarget, path: string, uuid: string): Promise<void> {
  await ensureReference(scene, owner, path, 'cc.Node', uuid);
}

async function ensureReference(scene: SceneQueryPort, owner: SceneComponentTarget, path: string, type: string, uuid: string): Promise<void> {
  const currentUuid = readSceneReferenceUuid(await readAuthoringProperty(scene, owner, path));
  if (currentUuid === uuid) return;
  if (!(await scene.setProperty(owner, path, { type, uuid }))) throw new Error(`无法绑定 ${path}`);
}

function requireComponent(nodes: readonly SceneNodeTree[], type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget {
  for (const node of nodes) {
    const target = getComponentTarget(node, type, classes);
    if (target !== null) return target;
  }
  throw new Error(`当前场景缺少 ${type}`);
}

function requireUniqueNode(nodes: readonly SceneNodeTree[], name: string): SceneNodeTree {
  const matches = nodes.filter((node) => node.name === name);
  if (matches.length !== 1) throw new Error(`场景必须且只能包含一个“${name}”，当前为 ${matches.length} 个`);
  return matches[0];
}

function requireUniqueComponent(nodes: readonly SceneNodeTree[], type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget {
  const matches = nodes.flatMap((node) => {
    const target = getComponentTarget(node, type, classes);
    return target === null ? [] : [{ node, target }];
  });
  if (matches.length !== 1) throw new Error(`场景必须且只能包含一个 ${type}，当前为 ${matches.length} 个`);
  return matches[0].target;
}

function requireUniqueDescendantComponent(
  root: SceneNodeTree,
  type: string,
  classes: readonly SceneComponentClassInfo[],
  scopeName: string,
): SceneComponentTarget {
  const matches = findAllNodesWithComponent(root, type, classes);
  if (matches.length !== 1) throw new Error(`“${scopeName}”下必须且只能包含一个 ${type}，当前为 ${matches.length} 个`);
  return matches[0].target;
}

async function resolveDefaultSpriteFrame(assetDb: AssetDbPort, textureUrl: string): Promise<string> {
  await waitForImportedAsset(assetDb, textureUrl);
  const textureInfo = await assetDb.queryInfo(textureUrl);
  const spriteFrame = Object.values(textureInfo?.subAssets ?? {})
    .find((entry) => entry.type === 'cc.SpriteFrame');
  if (spriteFrame?.uuid.trim() === '') throw new Error(`贴图缺少 SpriteFrame 子资源：${textureUrl}`);
  if (spriteFrame === undefined) throw new Error(`贴图缺少 SpriteFrame 子资源：${textureUrl}`);
  return spriteFrame.uuid;
}

export async function bindMainUiButtonStates(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  const navFrames = await Promise.all(NAV_BUTTON_TEXTURE_URLS.map(async (url) => await resolveDefaultSpriteFrame(assetDb, url)));
  const battleFrames = await Promise.all(BATTLE_BUTTON_TEXTURE_URLS.map(async (url) => await resolveDefaultSpriteFrame(assetDb, url)));
  const utilityFrames = await Promise.all(UTILITY_BUTTON_TEXTURE_URLS.map(async (url) => await resolveDefaultSpriteFrame(assetDb, url)));
  const iconFrames = await Promise.all(NAV_BUTTON_ICON_TEXTURE_URLS.map(async ([nodeName, url]) => [nodeName, await resolveDefaultSpriteFrame(assetDb, url)] as const));
  const tree = await scene.queryNodeTree();
  const classes = await queryClasses(scene);
  const nodes = flattenTree(tree);
  const bindings: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['主菜单按钮', navFrames], ['星图按钮', navFrames], ['飞船按钮', navFrames],
    ['建造按钮', navFrames], ['船员按钮', navFrames], ['设置按钮', navFrames],
    ['全屏按钮', utilityFrames], ['进入战斗按钮', battleFrames],
  ];
  for (const [nodeName, frames] of bindings) {
    const node = nodes.find((entry) => entry.name === nodeName);
    if (node?.uuid === undefined) throw new Error(`UIRoot 缺少按钮节点：${nodeName}`);
    const legacyGraphics = getComponentTarget(node, 'cc.Graphics', classes);
    if (legacyGraphics !== null) {
      await scene.removeComponent(legacyGraphics.uuid);
      await waitForSpecificComponentRemoval(scene, legacyGraphics.uuid);
    }
    const sprite = await ensureComponentOnNode(scene, node.uuid, 'cc.Sprite');
    const button = await waitForComponentOnNode(scene, node.uuid, 'cc.Button');
    if (button === null) throw new Error(`UIRoot 按钮缺少 cc.Button：${nodeName}`);
    const [normal, hover, pressed] = frames;
    if (normal === undefined || hover === undefined || pressed === undefined) throw new Error(`按钮三态素材不完整：${nodeName}`);
    // Sprite 默认 TRIMMED 会把按钮节点扩成原图像素尺寸；先锁定 CUSTOM，保留路由定义的点击热区与布局尺寸。
    if (!(await scene.setProperty(sprite, '_sizeMode', 0))) throw new Error(`无法锁定按钮自定义尺寸：${nodeName}`);
    if (!(await scene.setProperty(sprite, '_type', 0))) throw new Error(`无法锁定按钮简单 Sprite：${nodeName}`);
    if (await shouldFillReference(scene, sprite, 'spriteFrame') && !(await scene.setProperty(sprite, 'spriteFrame', { type: 'cc.SpriteFrame', uuid: normal }))) throw new Error(`无法绑定按钮普通态：${nodeName}`);
    for (const [property, uuid] of [['_normalSprite', normal], ['_hoverSprite', hover], ['_pressedSprite', pressed], ['_disabledSprite', normal]] as const) {
      if (await shouldFillReference(scene, button, property) && !(await scene.setProperty(button, property, { type: 'cc.SpriteFrame', uuid }))) throw new Error(`无法绑定按钮状态 ${property}：${nodeName}`);
    }
  }
  for (const [buttonName, frame] of iconFrames) {
    const buttonNode = nodes.find((entry) => entry.name === buttonName);
    const iconNode = buttonNode?.children?.find((entry) => entry.name === '图标');
    if (iconNode?.uuid === undefined) throw new Error(`UIRoot 导航按钮缺少图标节点：${buttonName}`);
    const iconSprite = await ensureComponentOnNode(scene, iconNode.uuid, 'cc.Sprite');
    if (!(await scene.setProperty(iconSprite, '_sizeMode', 0))) throw new Error(`无法锁定导航图标自定义尺寸：${buttonName}`);
    if (!(await scene.setProperty(iconSprite, '_type', 0))) throw new Error(`无法锁定导航图标简单 Sprite：${buttonName}`);
    if (await shouldFillReference(scene, iconSprite, 'spriteFrame') && !(await scene.setProperty(iconSprite, 'spriteFrame', { type: 'cc.SpriteFrame', uuid: frame }))) throw new Error(`无法绑定导航图标：${buttonName}`);
  }
}

/** 主界面背景和按钮素材必须写入 MainScreen 源 Prefab，禁止写成 UIRoot 的深层覆盖。 */
export async function bindMainScreenVisualAssets(assetDb: AssetDbPort, scene: SceneQueryPort): Promise<void> {
  // BuildOptionCard 等 Prefab 切换回来后，Creator 可能先返回 MainScreen 根节点，
  // 再异步展开其子树。必须等待公开查询树出现完整节点，不能把瞬时空树误判为
  // 设计资源缺失，也不能为了绕过等待而重建会破坏手工布局的节点。
  await waitForEditablePrefabRoot(scene, MAIN_SCREEN_PREFAB_URL);
  const hudFrameNode = await waitForUniqueNodeByName(scene, '界面框架素材', MAIN_SCREEN_PREFAB_URL);
  const classes = await queryClasses(scene);
  const hudFrameSprite = getComponentTarget(hudFrameNode, 'cc.Sprite', classes);
  if (hudFrameSprite === null) throw new Error('界面框架素材节点缺少 cc.Sprite');
  await assetDb.reimportAsset?.(MAIN_HUD_FRAME_TEXTURE_URL);
  const hudFrameUuid = await resolveDefaultSpriteFrame(assetDb, MAIN_HUD_FRAME_TEXTURE_URL);
  if (await shouldFillReference(scene, hudFrameSprite, 'spriteFrame') && !(await scene.setProperty(hudFrameSprite, 'spriteFrame', { type: 'cc.SpriteFrame', uuid: hudFrameUuid }))) {
    throw new Error(`无法绑定主界面框架素材：${MAIN_HUD_FRAME_TEXTURE_URL}`);
  }
  await bindMainUiButtonStates(assetDb, scene);
}

/** 只有引用为空时才补齐视觉资源，避免一键更新覆盖设计人员在 Inspector 中的有效替换。 */
async function shouldFillReference(scene: SceneQueryPort, target: SceneComponentTarget, path: string, assetDb?: AssetDbPort): Promise<boolean> {
  const current = await readAuthoringProperty(scene, target, path);
  if (current === undefined || current === null || current === '') return true;
  const uuid = readSceneReferenceUuid(current);
  if (uuid === undefined) return true;
  if (assetDb === undefined) return false;
  const info = await assetDb.queryInfo(uuid);
  return info === null || info.invalid === true;
}

async function setNodeActive(scene: SceneQueryPort, nodeUuid: string, active: boolean): Promise<void> {
  if (!(await scene.setProperty(nodeUuid, '_active', active))) {
    throw new Error(`无法持久化节点激活状态：${active ? '启用' : '停用'}`);
  }
}

/** BootScene 旧骨架可能遗留英文 Canvas/Camera；仅删除确认为空且无业务组件的骨架节点。 */
async function cleanLegacyBootNodes(scene: SceneQueryPort): Promise<FoundationAuthoringResult> {
  try {
    const tree = await scene.queryNodeTree();
    const legacy = flattenTree(tree).filter((node) => node.uuid !== undefined && (node.name === 'Canvas' || node.name === 'Camera'));
    if (legacy.length === 0) return { ok: true, message: '启动场景没有遗留英文 Canvas/Camera' };
    const unsafe = legacy.filter((node) => (node.children?.length ?? 0) > 0 || (node.components ?? []).some((component) => {
      const type = component.type ?? component.name ?? '';
      return !['cc.UITransform', 'cc.Canvas', 'cc.Camera', 'cc.Widget'].includes(type);
    }));
    if (unsafe.length > 0) {
      return { ok: false, message: `启动场景存在带内容的旧英文节点：${unsafe.map((node) => node.name ?? '未命名').join('、')}；请先在 Creator 中明确迁移或删除` };
    }
    const depths = new Map<string, number>();
    const markDepth = (node: SceneNodeTree, depth: number): void => {
      if (node.uuid !== undefined) depths.set(node.uuid, depth);
      for (const child of node.children ?? []) markDepth(child, depth + 1);
    };
    markDepth(tree, 0);
    for (const node of [...legacy].sort((left, right) => (depths.get(right.uuid as string) ?? 0) - (depths.get(left.uuid as string) ?? 0))) {
      await scene.removeNode(node.uuid as string);
    }
    await saveAuthoringScene();
    return { ok: true, message: `启动场景已清理 ${legacy.length} 个英文 Canvas/Camera 节点` };
  } catch (cause) {
    return { ok: false, message: `启动场景英文节点清理失败：${toMessage(cause)}` };
  }
}

async function queryClasses(scene: SceneQueryPort): Promise<readonly SceneComponentClassInfo[]> {
  return scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
}

async function waitForSceneContext(
  scene: SceneQueryPort,
  sceneName: string,
  componentType: string,
): Promise<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const tree = await scene.queryNodeTree();
    if (tree.name === sceneName) {
      const found = findNodeWithComponent(tree, componentType, await queryClasses(scene));
      if (found !== null) return found;
    }
    await delay();
  }
  return null;
}

async function waitForComponent(scene: SceneQueryPort, type: string): Promise<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = findNodeWithComponent(await scene.queryNodeTree(), type, await queryClasses(scene));
    if (found !== null) return found;
    await delay();
  }
  return null;
}

async function waitForComponentOnNode(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const node = flattenTree(await scene.queryNodeTree()).find((item) => item.uuid === nodeUuid);
    const target = node === undefined ? null : getComponentTarget(node, type, await queryClasses(scene));
    if (target !== null) return target;
    await delay();
  }
  return null;
}

async function waitForComponentRemoval(scene: SceneQueryPort, type: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (findNodeWithComponent(await scene.queryNodeTree(), type, await queryClasses(scene)) === null) return;
    await delay();
  }
  throw new Error(`${type} 未从模板中移除`);
}

async function waitForSpecificComponentRemoval(scene: SceneQueryPort, componentUuid: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tree = await scene.queryNodeTree();
    if (!flattenTree(tree).some((node) => (node.components ?? []).some((component) => getSceneComponentUuid(component) === componentUuid))) return;
    await delay();
  }
  throw new Error(`组件 ${componentUuid} 未从当前文档移除`);
}

function findNodeWithComponent(tree: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): { readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null {
  const target = getComponentTarget(tree, type, classes);
  if (target !== null) return { node: tree, target };
  for (const child of tree.children ?? []) {
    const found = findNodeWithComponent(child, type, classes);
    if (found !== null) return found;
  }
  return null;
}

function findAllNodesWithComponent(tree: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): Array<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget }> {
  const result: Array<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget }> = [];
  for (const node of flattenTree(tree)) {
    const target = getComponentTarget(node, type, classes);
    if (target !== null) result.push({ node, target });
  }
  return result;
}

function getComponentTarget(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentTarget | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate: SceneComponentInfo = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}

/** query-node-tree 在 Prefab 模式下外层仍可能返回不可挂组件的 cc.Scene 包装根。 */
export function resolveEditablePrefabRoot(tree: SceneNodeTree, assetUrl: string): SceneNodeTree {
  const expectedName = assetUrl.slice(assetUrl.lastIndexOf('/') + 1).replace(/\.prefab$/i, '');
  const named = flattenTree(tree).filter((node) => node.name === expectedName && node.uuid !== undefined);
  if (named.length === 1) return named[0];
  if (tree.name === expectedName && tree.uuid !== undefined) return tree;
  // Creator 3.8 某些状态只暴露通用 Scene/PrefabRoot 包装名。Prefab 编辑上下文始终
  // 只有一个直接可编辑子根；普通场景通常包含相机、画布等多个根，继续 fail closed。
  if (tree.name === 'Scene') {
    const editableChildren = (tree.children ?? []).filter((node) => node.uuid !== undefined);
    if (editableChildren.length === 1) return editableChildren[0];
  }
  throw new Error(`${assetUrl} 的可编辑 Prefab 根节点不可用`);
}

async function waitForEditablePrefabRoot(scene: SceneQueryPort, assetUrl: string): Promise<SceneNodeTree> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return resolveEditablePrefabRoot(await scene.queryNodeTree(), assetUrl);
    } catch (cause) {
      lastError = cause;
      await delay();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${assetUrl} 的可编辑 Prefab 根节点加载超时`);
}

/**
 * 等待 Prefab 子树完成公开展开，并拒绝重复语义节点。
 * Creator 切换资源后根节点和 children 不是同一时刻可见；只对“暂时没有”重试，
 * 一旦发现重复就立即失败，避免把手工冲突静默合并。
 */
async function waitForUniqueNodeByName(scene: SceneQueryPort, nodeName: string, assetUrl: string): Promise<SceneNodeTree> {
  let lastCount = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const matches = flattenTree(await scene.queryNodeTree()).filter((node) => node.name === nodeName && node.uuid !== undefined);
    lastCount = matches.length;
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`${assetUrl} 存在重复中文节点：${nodeName}`);
    await delay();
  }
  throw new Error(lastCount === 0 ? `${assetUrl} 缺少中文节点：${nodeName}` : `${assetUrl} 的中文节点不可编辑：${nodeName}`);
}

function delay(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 100)); }
function toMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }

/** Creator 3.8 的 execute-component-method 对成功的 void/boolean 方法可能返回空值或包装结果。 */
export function isAuthoringMethodSuccess(value: unknown): boolean {
  if (value === undefined || value === null || value === true) return true;
  return typeof value === 'object' && (value as { readonly ok?: unknown }).ok === true;
}
