const assert = require('node:assert/strict');
const test = require('node:test');

test('资源菜单按领域聚合，并把合法目标目录传给房间创建面板', () => {
  let sent = null;
  global.Editor = {
    Message: {
      send(...args) {
        sent = args;
      },
    },
  };
  const { onCreateMenu } = require('../dist/assets-menu.js');
  const menu = onCreateMenu({
    isDirectory: true,
    readonly: false,
    url: 'db://assets/prefabs/rooms',
  });
  assert.equal(menu[0].label, '星舰协议');
  assert.equal(menu[0].submenu[0].label, '新建房间建筑…');
  assert.equal(menu[0].submenu[1].label, '新建船员…');
  menu[0].submenu[0].click();
  assert.deepEqual(sent, [
    'starship-editor-tools',
    'open-room-create',
    {
      targetDirectory: 'db://assets/prefabs/rooms',
      templateUrl: 'db://assets/prefabs/ReactorRoom.prefab',
    },
  ]);
  delete global.Editor;
});

test('船员菜单打开同一个创作面板的船员分页', () => {
  let sent = null;
  global.Editor = { Message: { send(...args) { sent = args; } } };
  const { onCreateMenu } = require('../dist/assets-menu.js');
  onCreateMenu({ isDirectory: true, url: 'db://assets/prefabs' })[0].submenu[1].click();
  assert.deepEqual(sent, ['starship-editor-tools', 'open-authoring-panel', { page: 'crew', targetDirectory: 'db://assets/prefabs', templateUrl: 'db://assets/prefabs/CrewMember.prefab' }]);
  delete global.Editor;
});

test('非 Prefab 目录回退到标准目录', () => {
  let context = null;
  global.Editor = {
    Message: {
      send(_packageName, _message, value) {
        context = value;
      },
    },
  };
  const { onCreateMenu } = require('../dist/assets-menu.js');
  onCreateMenu({ isDirectory: true, url: 'db://assets/scenes' })[0].submenu[0].click();
  assert.equal(context.targetDirectory, 'db://assets/prefabs');
  delete global.Editor;
});
