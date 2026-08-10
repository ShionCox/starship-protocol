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
  let requestCount = 0;
  const updateRequests = [];
  const sentMessages = [];
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
          selection: { uuid: selected[0], name: 'RoomRoot' },
      roomTarget: { ok: true, uuid: 'room-root', path: 'PrototypeScene/RoomRoot', message: 'ok' },
          rooms: [{ id: 'room-reactor', displayName: '反应堆', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 0, crewCapacity: 0, prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', prefabUuid: 'prefab-reactor', configUrl: 'db://assets/config/rooms/room-reactor.json', configUuid: 'config-reactor' }],
          warnings: [],
        };
      },
      send(...args) { sentMessages.push(args); },
    },
  };

  delete require.cache[require.resolve('../dist/panels/authoring-panel.js')];
  require('../dist/panels/authoring-panel.js');
  assert.doesNotMatch(definition.template, /创作流程/);
  assert.doesNotMatch(definition.template, /navDevices|navNpcs|navRoomCount/);
  assert.match(definition.style, /\.room-workspace\s*\{[^}]*repeat\(auto-fit/);
  assert.doesNotMatch(definition.style, /minmax\(250px, \.9fr\)/);
  const panel = {
    $: {
      selection: element(), target: element(), sceneBadge: element(), roomCount: element(), sync: element(), newRoom: element(),
      initialize: element(), sceneRefresh: element(), refresh: element(), list: element(), status: element(),
      navWarningCount: element(), roomSearch: element(), roomCategories: element(), roomInspector: element(), roomEmpty: element(),
      editTitle: element(), editState: element(), editId: element(), editPath: element(), editDisplayName: element(), editCategory: element(), editWidth: element(), editHeight: element(), editMaxLevel: element(), editMaxHp: element(), editMinPower: element(), editMaxPower: element(), editCrewCapacity: element(), saveRoom: element(), createSelectedRoom: element(), openSelectedPrefab: element(), validationSummary: element(), validationList: element(),
      navScene: element(), navRooms: element(), navValidation: element(), pageScene: element(), pageRooms: element(), pageValidation: element(),
    },
  };
  definition.ready.call(panel);
  await Promise.resolve();
  assert.equal(requestCount, 1);
  const timerId = [...timers.keys()][0];
  await timers.get(timerId)();
  assert.equal(requestCount, 1);
  panel.$.navRooms.listeners.click();
  assert.equal(panel.$.pageRooms.hidden, false);
  assert.equal(panel.$.pageScene.hidden, true);
  selected = ['node-2'];
  await timers.get(timerId)();
  assert.equal(requestCount, 2);

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

  delete global.Editor;
  delete global.document;
});
