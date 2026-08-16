const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const panelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'panels', 'authoring-panel.ts'), 'utf8');

test('PSS 素材页通过同一个创作面板提供搜索、分页和重建索引入口', () => {
  assert.match(panelSource, /PageId = .*pss/);
  assert.match(panelSource, /id="navPss"/);
  assert.match(panelSource, /id="pagePss"/);
  assert.match(panelSource, /search-pss-assets/);
  assert.match(panelSource, /build-pss-index/);
  assert.match(panelSource, /pssPrevious/);
  assert.match(panelSource, /pssNext/);
});

test('扩展只注册 PSS 索引与正式外观绑定消息，manifest 校验留在内部端口', () => {
  const messages = packageJson.contributions?.messages ?? {};
  for (const name of ['build-pss-index', 'search-pss-assets', 'bind-first-pss-room-appearances', 'bind-first-pss-crew-appearances', 'import-and-bind-first-pss-hull-appearances']) {
    assert.ok(messages[name], `缺少 ${name}`);
  }
  for (const name of ['validate-pss-manifest', 'validate-first-pss-manifest', 'import-pss-manifest']) assert.equal(messages[name], undefined, `旧消息不得重新注册：${name}`);
  assert.equal(packageJson.version, '2.0.0');
});

test('项目内首批 PSS manifest 可通过首批来源与 rect 边界校验', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'textures', 'pss', 'manifest.json'), 'utf8'));
  const { validateFirstPssManifest } = require('../dist/pss/pss-manifest.js');
  const result = validateFirstPssManifest(manifest, {
    sourceRoot: 'I:/WebProjects/pss_full',
    targetRoot: 'I:/WebProjects/starship-protocol',
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
});
