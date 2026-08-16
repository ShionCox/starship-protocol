const assert = require('node:assert/strict');
const test = require('node:test');

test('资源菜单按领域聚合并打开统一 CSV 创作面板', () => {
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
  assert.equal(menu[0].submenu[0].label, '打开房间 CSV 创作页');
  assert.equal(menu[0].submenu[1].label, '打开船员 CSV 创作页');
  menu[0].submenu[0].click();
  assert.deepEqual(sent, ['starship-editor-tools', 'open-authoring-panel', { page: 'rooms' }]);
  delete global.Editor;
});

test('船员菜单打开同一个创作面板的船员分页', () => {
  let sent = null;
  global.Editor = { Message: { send(...args) { sent = args; } } };
  const { onCreateMenu } = require('../dist/assets-menu.js');
  onCreateMenu({ isDirectory: true, url: 'db://assets/prefabs' })[0].submenu[1].click();
  assert.deepEqual(sent, ['starship-editor-tools', 'open-authoring-panel', { page: 'crew' }]);
  delete global.Editor;
});

test('非 Prefab 目录也使用统一创作面板', () => {
  let context = null;
  global.Editor = { Message: { send(...args) { context = args; } } };
  const { onCreateMenu } = require('../dist/assets-menu.js');
  onCreateMenu({ isDirectory: true, url: 'db://assets/scenes' })[0].submenu[0].click();
  assert.deepEqual(context, ['starship-editor-tools', 'open-authoring-panel', { page: 'rooms' }]);
  delete global.Editor;
});
