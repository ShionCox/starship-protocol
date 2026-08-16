const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('扩展清单保留资源菜单，并只提供公开创作面板入口', () => {
  const menu = packageJson.contributions?.menu ?? [];
  assert.equal(menu.length, 2);
  assert.deepEqual(menu.map((item) => item.path), ['i18n:menu.project', 'i18n:menu.panel']);
  assert.ok(menu.every((item) => item.label === 'i18n:starship-editor-tools.open_authoring' && item.message === 'open-authoring-panel'));
  assert.equal(packageJson.panels.authoring.type, 'dockable');
  assert.equal(packageJson.panels.default, undefined);
  assert.equal(packageJson.panels.authoring.main, './dist/panels/authoring-panel');
  assert.equal(packageJson.description, 'i18n:starship-editor-tools.description');
  assert.equal(packageJson.contributions?.assets?.menu?.createMenu, 'onCreateMenu');
  assert.ok(packageJson.contributions?.messages?.['create-room-instance']);
  assert.ok(packageJson.contributions?.messages?.['preview-room-definition']);
  assert.ok(packageJson.contributions?.messages?.['save-room-csv-draft']);
  assert.ok(packageJson.contributions?.messages?.['get-authoring-state']);
  assert.ok(packageJson.contributions?.messages?.['create-crew-instance']);
  assert.ok(packageJson.contributions?.messages?.['save-crew-csv-draft']);
  assert.ok(packageJson.contributions?.messages?.['save-hull-csv-draft']);
  assert.ok(packageJson.contributions?.messages?.['create-foundation-prefabs']);
  assert.ok(packageJson.contributions?.messages?.['rebuild-p8-starter-ship']);
  assert.ok(packageJson.contributions?.messages?.['mount-shared-ui']);
  assert.ok(packageJson.contributions?.messages?.['wire-scene-foundation']);
  assert.ok(packageJson.contributions?.messages?.['bind-first-pss-room-appearances']);
  assert.ok(packageJson.contributions?.messages?.['bind-first-pss-crew-appearances']);
  assert.ok(packageJson.contributions?.messages?.['import-and-bind-first-pss-hull-appearances']);
  assert.ok(packageJson.contributions?.messages?.['get-csv-config-tables']);
  assert.ok(packageJson.contributions?.messages?.['import-csv-config-bundle']);
  assert.equal(packageJson.contributions?.messages?.['save-csv-config-table'], undefined);
  assert.equal(packageJson.contributions?.messages?.['delete-legacy-json-configs'], undefined);
  for (const message of ['get-crew-csv-drafts', 'get-hull-csv-drafts', 'save-csv-config-bundle', 'validate-pss-manifest', 'validate-first-pss-manifest', 'import-pss-manifest']) {
    assert.equal(packageJson.contributions?.messages?.[message], undefined, `旧消息不得重新注册：${message}`);
  }
  const registeredMethods = Object.values(packageJson.contributions?.messages ?? {}).flatMap((entry) => entry.methods ?? []);
  assert.equal(new Set(registeredMethods).size, registeredMethods.length, '清单中不得重复注册消息方法');
  assert.equal(packageJson.contributions?.messages?.['configure-r1-energy-scene'], undefined);
  assert.equal(packageJson.contributions?.messages?.['configure-r1-crew-scene'], undefined);
  assert.equal(packageJson.version, '2.0.0');
  assert.equal(packageJson.main, './dist/extension-bootstrap.js');
  assert.equal(JSON.stringify(packageJson).includes(['hierarchy', 'menu-adapter'].join('-')), false);
  assert.equal(JSON.stringify(packageJson).includes(['open', 'room', 'catalog'].join('-')), false);
});

test('轻量扩展入口在领域模块加载前即可提供面板消息方法', () => {
  const bootstrapPath = require.resolve('../dist/extension-bootstrap.js');
  const mainPath = require.resolve('../dist/main.js');
  delete require.cache[bootstrapPath];
  delete require.cache[mainPath];
  const bootstrap = require(bootstrapPath);
  assert.equal(typeof bootstrap.methods, 'object');
  assert.equal(typeof bootstrap.methods.openAuthoringPanel, 'function');
  assert.equal(require.cache[mainPath], undefined);
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
