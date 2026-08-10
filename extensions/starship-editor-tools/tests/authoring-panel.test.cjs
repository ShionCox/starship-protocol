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
  const updateRequests = [];
  const sentMessages = [];
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
    Selection: { getSelected() { return selected; } },
    Message: {
      async request(_packageName, message) {
        if (message === 'update-room-definition') {
          updateRequests.push(arguments[2]);
          return { ok: true, message: '已保存房间属性' };
        }
        requestCount += 1;
        assert.ok(message === 'get-authoring-state' || message === 'refresh-authoring-state');
        return {
          selection: { kind: selected[0] === 'node-1' ? 'room-instance' : 'scene-settings', typeId: selected[0] === 'node-1' ? 'room-instance' : 'scene-settings', page: selected[0] === 'node-1' ? 'rooms' : 'scene', uuid: selected[0], name: selected[0] === 'node-1' ? '反应堆实例' : 'AppRoot', path: `PrototypeScene/${selected[0]}`, instanceId: 'room-reactor-1', definitionId: 'room-reactor', gridPosition: { x: 2, y: 1 }, validation: { ok: true, message: 'ok' }, definitionFound: true, core: { gridColumns: 20, gridRows: 10, cellSize: 48, snapRoomsInEditor: true, minScale: 0.5, maxScale: 1.8, zoomStep: 0.1 }, appearance: { invalidHullCells: [], gridRootReferenced: true }, componentStatus: { sceneSettings: true, cameraController: true } },
      roomTarget: { ok: true, uuid: 'room-root', path: 'PrototypeScene/RoomRoot', message: 'ok' },
          rooms: [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, crewCapacity: 0, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', prefabUuid: 'prefab-reactor', configUrl: 'db://assets/config/rooms/room-reactor.json', configUuid: 'config-reactor' }, ...(catalogChanged ? [{ id: 'room-shield', displayName: '护盾室', category: 'DEFENSE', width: 2, height: 2, maxLevel: 1, maxHp: 120, minPower: 0, maxPower: 2, crewCapacity: 0, prefabUrl: 'db://assets/prefabs/ShieldRoom.prefab', prefabUuid: 'prefab-shield', configUrl: 'db://assets/config/rooms/room-shield.json', configUuid: 'config-shield' }] : [])],
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
  assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('../dist/panels/authoring-panel.js'), 'utf8'), /节点 UUID/);
  assert.match(definition.style, /\.room-workspace\s*\{[^}]*repeat\(auto-fit/);
  assert.doesNotMatch(definition.style, /minmax\(250px, \.9fr\)/);
  const panel = {
    $: {
      selection: element(), target: element(), sceneBadge: element(), roomCount: element(), sync: element(), newRoom: element(),
      initialize: element(), sceneRefresh: element(), refresh: element(), list: element(), status: element(),
      navWarningCount: element(), roomSearch: element(), roomCategories: element(), roomInspector: element(), roomEmpty: element(),
      editTitle: element(), editState: element(), editId: element(), editPath: element(), editDisplayName: element(), editCategory: element(), editWidth: element(), editHeight: element(), editMaxLevel: element(), editMaxHp: element(), editMinPower: element(), editMaxPower: element(), editCrewCapacity: element(), saveRoom: element(), createSelectedRoom: element(), openSelectedPrefab: element(), validationSummary: element(), validationList: element(),
      navScene: element(), navRooms: element(), navValidation: element(), pageScene: element(), pageRooms: element(), pageValidation: element(),
      sceneInspector: element(), sceneSelectionTitle: element(), sceneSelectionBadge: element(), sceneNodePath: element(), sceneSemanticRole: element(), sceneBaseInfo: element(), sceneCoreForm: element(), sceneReadOnly: element(), sceneGridColumns: element(), sceneGridRows: element(), sceneCellSize: element(), sceneSnapRooms: element(), sceneMinScale: element(), sceneMaxScale: element(), sceneZoomStep: element(), saveSceneCore: element(), roomInstanceInfo: element(),
    },
  };
  definition.ready.call(panel);
  await Promise.resolve();
  assert.equal(requestCount, 1);
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.pageScene.hidden, true);
  assert.equal(panel.$.roomInstanceInfo.hidden, false);
  assert.equal(broadcastListeners.has('starship-editor-tools:room-catalog-change'), true);
  catalogChanged = true;
  broadcastListeners.get('starship-editor-tools:room-catalog-change')();
  await Promise.resolve();
  assert.equal(requestCount, 2);
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.roomCount.textContent, '2 个');
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
  assert.equal(panel.$.sceneCoreForm.hidden, false);

  panel.$.list.children[0].listeners.click();
  panel.$.editDisplayName.value = '反应堆新名';
  panel.$.saveRoom.listeners.confirm();
  await Promise.resolve();
  assert.equal(updateRequests[0].displayName, '反应堆新名');

  panel.$.newRoom.listeners.confirm();
  assert.deepEqual(sentMessages, [[
    'starship-editor-tools',
    'open-room-create',
    {
      targetDirectory: 'db://assets/prefabs',
      templateUrl: 'db://assets/prefabs/ReactorRoom.prefab',
    },
  ]]);

  definition.listeners.hide();
  assert.deepEqual(cleared, [timerId]);
  definition.listeners.show();
  assert.equal(timers.size, 1);
  definition.close();
  assert.equal(cleared.length, 2);
  assert.equal(removedBroadcastListeners.length, 1);

  delete global.Editor;
  delete global.document;
});
