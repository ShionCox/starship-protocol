const assert = require('node:assert/strict');
const test = require('node:test');

function element() {
  return {
    textContent: '',
    innerHTML: '',
    title: '',
    className: '',
    hidden: false,
    value: '',
    children: [],
    listeners: {},
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    removeAttribute() {},
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}

test('创作面板只在可见期间轮询选择，选择未变化时不重复请求', async () => {
  let definition;
  let selected = ['node-1'];
  let catalogChanged = false;
  let requestCount = 0;
  const csvDraftRequests = [];
  const saveDraftRequests = [];
  const updateRequests = [];
  const sentMessages = [];
  const notices = [];
  const broadcastListeners = new Map();
  const removedBroadcastListeners = [];
  let nextTimer = 1;
  const timers = new Map();
  const cleared = [];
  global.setInterval = (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  };
  global.clearInterval = (id) => {
    cleared.push(id);
    timers.delete(id);
  };
  global.document = { createElement: () => element() };
  global.Editor = {
    Panel: { define(value) { definition = value; return value; } },
    Task: {
      addNotice(options) { notices.push(options); return notices.length; },
      removeNotice() {},
    },
    Dialog: {
      warn: async () => ({ response: 0 }),
      select: async () => ({ canceled: true, filePaths: [] }),
    },
    Project: { path: 'G:/WebProjects/starship-protocol' },
    Selection: { getSelected() { return selected; } },
    Message: {
      async request(_packageName, message) {
        if (message === 'get-room-csv-drafts') {
          csvDraftRequests.push(message);
          return { ok: true, message: '已读取房间 CSV', drafts: [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: '2', height: '2', maxLevel: '1', maxHp: '100', minPower: '0', maxPower: '0', powerGeneration: '10', crewCapacity: '0', healingHpPerTick: '0', verticalConnectorKind: 'NONE', visualId: 'visual-reactor', metalCost: '100', buildDurationMs: '1000', demolishDurationMs: '1000', refundPermille: '500', connectorPorts: [] }, ...(catalogChanged ? [{ id: 'room-shield', displayName: '护盾室', category: 'DEFENSE', width: '2', height: '2', maxLevel: '1', maxHp: '120', minPower: '0', maxPower: '2', powerGeneration: '0', crewCapacity: '0', healingHpPerTick: '0', verticalConnectorKind: 'NONE', visualId: 'visual-shield', metalCost: '100', buildDurationMs: '1000', demolishDurationMs: '1000', refundPermille: '500', connectorPorts: [] }] : [])] };
        }
        if (message === 'save-room-csv-draft') {
          saveDraftRequests.push(arguments[2]);
          return { ok: true, message: '已保存房间 CSV', draft: arguments[2].draft };
        }
        if (message === 'preview-room-definition') return { ok: true, message: '预览已刷新' };
        if (message === 'update-room-instance') return { ok: true, message: '实例已保存' };
        if (message === 'search-pss-assets') return { entries: [], page: 1, total: 0, totalPages: 1, hasPrevious: false, hasNext: false, warnings: [] };
        requestCount += 1;
        assert.ok(message === 'get-authoring-state' || message === 'refresh-authoring-state');
        return {
      selection: { kind: selected[0] === 'node-1' ? 'room-instance' : 'semantic-node', typeId: selected[0] === 'node-1' ? 'room-instance' : 'semantic-node', page: selected[0] === 'node-1' ? 'rooms' : 'scene', uuid: selected[0], name: selected[0] === 'node-1' ? '反应堆实例' : '应用根', path: `MainScene/${selected[0]}`, semanticRole: 'appRoot', instanceId: 'room-reactor-1', definitionId: 'room-reactor', gridPosition: { x: 2, y: 1 }, validation: { ok: true, message: 'ok' }, definitionFound: true },
      roomTarget: { ok: true, uuid: 'room-root', path: 'PrototypeScene/RoomRoot', message: 'ok' },
          rooms: catalogChanged ? [{ id: 'room-shield', displayName: '护盾室', category: 'DEFENSE', width: 2, height: 2, maxLevel: 1, maxHp: 120, minPower: 0, maxPower: 2, powerGeneration: 0, crewCapacity: 0, healingHpPerTick: 0, prefabUrl: 'db://assets/prefabs/ShieldRoom.prefab', prefabUuid: 'prefab-shield' }] : [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, powerGeneration: 10, crewCapacity: 0, healingHpPerTick: 0, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', prefabUuid: 'prefab-reactor' }],
          crews: [{ schemaVersion: 3, id: 'crew-engineer', displayName: '工程师', role: 'ENGINEER', maxHp: 100, moveTicksPerEdge: 5, repairHpPerTick: 1, prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', prefabUuid: 'crew-prefab' }],
          hulls: [],
          warnings: [],
        };
      },
      send(...args) { sentMessages.push(args); },
      addBroadcastListener(name, callback) { broadcastListeners.set(name, callback); },
      removeBroadcastListener(name, callback) { removedBroadcastListeners.push([name, callback]); broadcastListeners.delete(name); },
    },
  };

  delete require.cache[require.resolve('../dist/panels/authoring-panel.js')];
  require('../dist/panels/authoring-panel.js');
  assert.doesNotMatch(definition.template, /创作流程/);
  assert.doesNotMatch(definition.template, /navDevices|navNpcs|navRoomCount/);
  assert.doesNotMatch(definition.template, /configUrl/);
  assert.match(definition.template, /<option value="ENERGY">能源<\/option>/);
  assert.match(definition.template, /<option value="DEFENSE">防御<\/option>/);
  assert.match(definition.template, /<option value="ENGINEER">工程师<\/option>/);
  assert.match(definition.template, /<option value="GUNNER">武器操作员<\/option>/);
  assert.match(definition.template, /<option value="MEDIC">医务员<\/option>/);
  assert.match(definition.template, /每 Tick 治疗量/);
  assert.match(definition.template, /每 Tick 维修量/);
  assert.match(definition.template, /权威 CSV 配置表/);
  assert.match(definition.template, /id="csvImport"/);
  assert.match(definition.template, /readonly aria-label="CSV 配置审计内容"/);
  assert.match(definition.template, /crew-traits\.csv/);
  for (const [value, label] of [
    ['WEAPON', '武器'], ['MOBILITY', '机动'], ['SUPPORT', '支援'], ['MOVEMENT', '移动'],
    ['TACTICAL', '战术'], ['DRONE', '无人机'], ['ECONOMY', '经济'], ['SPECIAL', '特殊'],
  ]) {
    assert.match(definition.template, new RegExp(`<option value="${value}">${label}<\\/option>`));
  }
  assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('../dist/panels/authoring-panel.js'), 'utf8'), /节点 UUID/);
  assert.match(definition.style, /\.room-workspace\s*\{[^}]*repeat\(auto-fit/);
  assert.doesNotMatch(definition.style, /minmax\(250px, \.9fr\)/);
  const panel = {
    $: {
      selection: element(), target: element(), sceneBadge: element(), roomCount: element(), sync: element(), newRoom: element(),
      createOrUpdateBoot: element(), createOrUpdateMain: element(), createOrUpdateBattle: element(), sceneRefresh: element(), refresh: element(), list: element(), status: element(), selectionDirtyBanner: element(),
      navWarningCount: element(), roomSearch: element(), roomCategories: element(), roomInspector: element(), roomEmpty: element(),
      editTitle: element(), editState: element(), editId: element(), editPath: element(), editDisplayName: element(), editCategory: element(), editWidth: element(), editHeight: element(), editMaxLevel: element(), editMaxHp: element(), editMinPower: element(), editMaxPower: element(), editPowerGeneration: element(), editCrewCapacity: element(), editHealingHp: element(), saveRoom: element(), createSelectedRoom: element(), openSelectedPrefab: element(), validationSummary: element(), validationList: element(),
      editVerticalConnectorKind: element(), editVisualId: element(), editMetalCost: element(), editBuildDurationMs: element(), editDemolishDurationMs: element(), editRefundPermille: element(), editConnectorPorts: element(), cancelRoom: element(), roomInstanceEditor: element(), editInstanceX: element(), editInstanceY: element(), editInstanceHp: element(), saveRoomInstance: element(), cancelRoomInstance: element(),
      navScene: element(), navHulls: element(), navRooms: element(), navValidation: element(), navCrew: element(), navConfig: element(), navPss: element(), pageScene: element(), pageHulls: element(), pageRooms: element(), pageValidation: element(), pageCrew: element(), pageConfig: element(), pagePss: element(),
      crewCount: element(), crewList: element(), crewInspector: element(), crewEmpty: element(), crewInstanceInfo: element(), crewInstanceNameMode: element(), crewInstanceCallSign: element(), crewEditTitle: element(), crewEditState: element(), crewEditId: element(), crewEditPath: element(), crewEditDisplayName: element(), crewEditRole: element(), crewEditRarity: element(), crewEditAppearanceId: element(), crewEditTraitIds: element(), crewEditMaxHp: element(), crewEditMoveTicks: element(), crewEditRepairHp: element(), saveCrew: element(), newCrew: element(), cancelCrew: element(), createSelectedCrew: element(), openSelectedCrewPrefab: element(),
      hullCount: element(), hullList: element(), hullId: element(), hullDisplayName: element(), hullLevel: element(), hullGridWidth: element(), hullGridHeight: element(), hullMaxCrew: element(), hullMaxRooms: element(), hullVisualId: element(), hullCellMask: element(), newHull: element(), cancelHull: element(), createHull: element(), saveHull: element(), createShip: element(),
      sceneInspector: element(), sceneSelectionTitle: element(), sceneSelectionBadge: element(), sceneNodePath: element(), sceneSemanticRole: element(), sceneBaseInfo: element(), roomInstanceInfo: element(),
      pssSearch: element(), pssKind: element(), pssLanguage: element(), pssRefresh: element(), pssBindRooms: element(), pssBindCrews: element(), pssBindHulls: element(), pssStatus: element(), pssList: element(), pssPrevious: element(), pssNext: element(), pssPage: element(), pssCount: element(),
      csvTableName: element(), csvEditor: element(), csvReload: element(), csvImport: element(), csvStatus: element(), csvState: element(),
    },
  };
  definition.ready.call(panel);
  await Promise.resolve();
  assert.equal(requestCount, 1);
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.pageScene.hidden, true);
  assert.equal(panel.$.roomInstanceInfo.hidden, false);
  panel.$.cancelRoomInstance.listeners.confirm();
  assert.equal(notices.at(-1).type, 'success');
  assert.equal(notices.at(-1).source, '星舰创作工具');
  assert.equal(notices.at(-1).timeout, 3000);
  assert.match(notices.at(-1).title, /房间实例/);
  assert.equal(broadcastListeners.has('starship-editor-tools:room-catalog-change'), true);
  assert.equal(broadcastListeners.has('starship-editor-tools:authoring-batch-start'), true);
  assert.equal(broadcastListeners.has('starship-editor-tools:authoring-batch-end'), true);
  catalogChanged = true;
  broadcastListeners.get('starship-editor-tools:room-catalog-change')();
  await Promise.resolve();
  assert.equal(requestCount, 2);
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.roomCount.textContent, '2 个');
  assert.equal(csvDraftRequests.length >= 1, true);
  const timerId = [...timers.keys()][0];
  await timers.get(timerId)();
  assert.equal(requestCount, 2);
  panel.$.navRooms.listeners.click();
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.pageScene.hidden, true);
  selected = ['node-2'];
  await timers.get(timerId)();
  assert.equal(requestCount, 3);
  assert.equal(panel.$.pageScene.hidden, false);

  broadcastListeners.get('starship-editor-tools:authoring-batch-start')();
  assert.equal(timers.size, 1);
  catalogChanged = false;
  broadcastListeners.get('starship-editor-tools:room-catalog-change')();
  await timers.get(timerId)();
  await Promise.resolve();
  assert.equal(requestCount, 3);
  broadcastListeners.get('starship-editor-tools:authoring-batch-end')();
  assert.equal(timers.size, 1);
  assert.equal(requestCount, 3);

  panel.$.list.children[0].listeners.click();
  panel.$.editDisplayName.value = '反应堆新名';
  panel.$.saveRoom.listeners.confirm();
  await Promise.resolve();
  assert.equal(saveDraftRequests[0].draft.displayName, '反应堆新名');
  panel.$.editConnectorPorts.value = 'invalid-row';
  panel.$.saveRoom.listeners.confirm();
  assert.equal(notices.at(-1).type, 'error');
  assert.equal(notices.at(-1).timeout, 8000);
  const noticeCountAfterError = notices.length;
  panel.$.saveRoom.listeners.confirm();
  assert.equal(notices.length, noticeCountAfterError);
  assert.deepEqual(sentMessages, []);

  definition.listeners.hide();
  assert.deepEqual(cleared, [timerId]);
  definition.listeners.show();
  assert.equal(timers.size, 1);
  definition.close();
  assert.equal(cleared.length, 2);
  assert.equal(removedBroadcastListeners.length, 7);

  delete global.Editor;
  delete global.document;
});

test('场景页只提供三个一键场景入口，并保留领域预览清理消息', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');
  assert.match(source, /id="createOrUpdateBoot"/);
  assert.match(source, /id="createOrUpdateMain"/);
  assert.match(source, /id="createOrUpdateBattle"/);
  assert.equal((source.match(/id="createOrUpdate(?:Boot|Main|Battle)"/g) ?? []).length, 3);
  assert.match(source, /'create-or-update-scene'/);
  assert.doesNotMatch(source, /rebuildP8StarterShip|rebuild-p8-starter-ship|createFoundation|mountSharedUi|wireFoundation/);
});

test('场景页不再提供独立页面预览或 Prefab 打开按钮', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');
  assert.doesNotMatch(source, /id="pagePreviewKind"|id="previewPage"|id="openPagePrefab"/);
  assert.doesNotMatch(source, /'preview-page'|'open-page-prefab'/);
});

test('PSS 船体外观按钮完成 Panel 映射并注册公开绑定消息', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');
  assert.match(source, /pssBindHulls: '#pssBindHulls'/);
  assert.match(source, /field\('pssBindHulls'\)\.addEventListener\('confirm'/);
  assert.match(source, /import-and-bind-first-pss-hull-appearances/);
});

test('主入口保留统一场景编排方法，页面预览由 MainScreen Inspector 承担', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.ts'), 'utf8');
  assert.match(source, /createOrUpdateScene\(kind/);
  assert.doesNotMatch(source, /previewPage\(page|openPagePrefab\(page/);
  const router = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', '..', 'assets', 'scripts', 'presentation', 'MainPageRouter.ts'), 'utf8');
  assert.match(router, /showMainMenu/);
});

test('创作工具统一使用 Cocos 原生通知并保留就地详情策略', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');
  assert.match(source, /addNotice/);
  assert.match(source, /source: '星舰创作工具'/);
  assert.match(source, /NOTICE_TIMEOUTS/);
  assert.match(source, /summarizeNotice/);
  assert.match(source, /setInlineDetail\(fullMessage, kind, scope\)/);
  assert.doesNotMatch(source, /showStatus\s*\(/);
});

test('CSV 文件导入使用公开 Dialog.select，并将取消标记为正常取消', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.ts'), 'utf8');
  assert.match(source, /select\?:/);
  assert.match(source, /type: 'file'/);
  assert.match(source, /multi: true/);
  assert.match(source, /cancelled: true/);
  assert.doesNotMatch(source, /openFile/);
});

test('领域草稿统一使用 DraftSession，并让 crew/hull 预览具备防迟到序列', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');
  assert.match(source, /interface DraftSession/);
  assert.match(source, /const crewDraftSession = createDraftSession\(\)/);
  assert.match(source, /const hullDraftSession = createDraftSession\(\)/);
  assert.match(source, /const queueCrewPreview =/);
  assert.match(source, /const queueHullPreview =/);
  assert.match(source, /sequence === crewDraftSession\.sequence/);
  assert.match(source, /sequence === hullDraftSession\.sequence/);
  assert.match(source, /roomDraftLoadPending/);
  assert.doesNotMatch(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'csv', 'domain-csv-authoring.ts'), 'utf8'), /saveDraft|saveCrewCsvDraft|saveHullCsvDraft/);
  assert.doesNotMatch(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'rooms', 'room-csv-authoring.ts'), 'utf8'), /export async function saveRoomCsvDraft/);
});
