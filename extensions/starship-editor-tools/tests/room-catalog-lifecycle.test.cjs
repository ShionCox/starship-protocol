const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('房间与船员目录监听只对创作资源去抖刷新，并在卸载时注销', async () => {
  const listeners = new Map();
  const removed = [];
  let queryAssetsCount = 0;
  let catalogVersion = 0;
  const broadcasts = [];
  const roomDefinitionFile = path.resolve(__dirname, '..', '..', '..', 'assets/config/rooms/room-reactor.json');
  const previousEditor = global.Editor;
  global.Editor = {
    Message: {
      addBroadcastListener(name, callback) { listeners.set(name, callback); },
      removeBroadcastListener(name, callback) { removed.push([name, callback]); listeners.delete(name); },
      broadcast(name) { broadcasts.push(name); },
      async request(domain, message, value) {
        assert.equal(domain, 'asset-db');
        if (message === 'query-assets') {
          queryAssetsCount += 1;
          return catalogVersion === 0 ? [] : [
            { uuid: 'config-room', url: 'db://assets/config/rooms/room-new.json', isDirectory: false },
            { uuid: 'prefab-room', url: 'db://assets/prefabs/NewRoom.prefab', isDirectory: false },
          ];
        }
        if (message === 'query-uuid') return 'room-view-script';
        if (message === 'query-asset-info') {
          if (value === 'config-room') return { uuid: value, url: 'db://assets/config/rooms/room-new.json', file: roomDefinitionFile };
          if (value === 'room-config') return { uuid: value, url: 'db://assets/config/rooms/room-new.json' };
          return { uuid: value, url: 'db://assets/textures/other.png' };
        }
        if (message === 'read-file') return JSON.stringify({ schemaVersion: 1, id: 'room-new', displayName: '新房间', category: 'ENERGY', width: 2, height: 2, maxLevel: 1, maxHp: 100, minPower: 0, maxPower: 1, crewCapacity: 0 });
        if (message === 'query-asset-dependencies') return ['room-view-script', 'config-room'];
        return null;
      },
    },
    Selection: { getSelected() { return []; } },
  };

  try {
    delete require.cache[require.resolve('../dist/main.js')];
    const main = require('../dist/main.js');
    main.load();
    await wait(20);
    assert.equal(listeners.has('asset-db:asset-change'), true);
    const initialQueries = queryAssetsCount;

    listeners.get('asset-db:asset-change')('unrelated');
    await wait(240);
    assert.equal(queryAssetsCount, initialQueries);

    catalogVersion = 1;
    listeners.get('asset-db:asset-change')('room-config');
    await wait(240);
    assert.equal(queryAssetsCount, initialQueries + 2);
    assert.equal(broadcasts.length, 3);

    main.unload();
    assert.equal(removed.length, 1);
    assert.equal(removed[0][0], 'asset-db:asset-change');
  } finally {
    if (previousEditor === undefined) delete global.Editor;
    else global.Editor = previousEditor;
  }
});
