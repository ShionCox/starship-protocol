const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('扩展清单保留资源菜单，并只提供公开创作面板入口', () => {
  const menu = packageJson.contributions?.menu ?? [];
  assert.equal(menu.length, 2);
  assert.ok(menu.every((item) => item.label === 'i18n:starship-editor-tools.open_authoring' && item.message === 'open-authoring-panel'));
  assert.equal(packageJson.panels.authoring.type, 'dockable');
  assert.equal(packageJson.panels.authoring.main, './dist/panels/authoring-panel');
  assert.equal(packageJson.description, 'i18n:starship-editor-tools.description');
  assert.equal(packageJson.contributions?.assets?.menu?.createMenu, 'onCreateMenu');
  assert.ok(packageJson.contributions?.messages?.['create-room-instance']);
  assert.ok(packageJson.contributions?.messages?.['update-room-definition']);
  assert.ok(packageJson.contributions?.messages?.['get-authoring-state']);
  assert.equal(JSON.stringify(packageJson).includes(['hierarchy', 'menu-adapter'].join('-')), false);
  assert.equal(JSON.stringify(packageJson).includes(['open', 'room', 'catalog'].join('-')), false);
});

test('扩展提供中英文菜单翻译，避免主菜单显示 i18n key', () => {
  const zh = require('../i18n/zh.js');
  const en = require('../i18n/en.js');
  for (const key of ['title', 'description', 'open_authoring']) {
    assert.equal(typeof zh[key], 'string');
    assert.equal(typeof en[key], 'string');
  }
  assert.equal(zh.title, '星舰协议');
  assert.equal(en.title, 'Starship Protocol');
});
