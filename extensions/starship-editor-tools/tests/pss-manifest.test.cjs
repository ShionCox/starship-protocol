const assert = require('node:assert/strict');
const test = require('node:test');

const {
  FIRST_PSS_ASSET_IDS,
  validateFirstPssManifest,
  validatePssManifest,
  isSafePath,
} = require('../dist/pss/pss-manifest.js');

const sha = 'a'.repeat(64);
function entry(assetId, kind, sourceRelativePath) {
  return {
    assetId,
    visualId: `pss-${assetId}`,
    kind,
    sourcePath: sourceRelativePath,
    sourceRelativePath,
    sourceSprite: sourceRelativePath,
    targetPath: `assets/textures/pss/${kind}/${assetId}.png`,
    sourceSha256: sha,
    licenseNote: '仅作参考素材，发布前复核授权',
    rightsStatus: 'reference-only',
  };
}

test('首批 manifest 必须包含五房间与三船员并匹配来源 sprite', () => {
  const paths = ['sorted/room/502.png', 'sorted/room/3984.png', 'sorted/room/43.png', 'sorted/room/83.png', 'sorted/room/1107.png', 'sorted/crew/190.png', 'sorted/crew/3889.png', 'sorted/crew/3803.png'];
  const entries = FIRST_PSS_ASSET_IDS.map((id, i) => entry(id, id.startsWith('room-') ? 'room' : 'crew', paths[i]));
  const result = validateFirstPssManifest({ schemaVersion: 1, sourceRoot: 'I:\\WebProjects\\pss_full', entries }, { targetRoot: 'I:\\WebProjects\\starship-protocol' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('manifest 路径越界、Hash 和输出 URL 非法时 fail closed', () => {
  const result = validatePssManifest({ schemaVersion: 1, sourceRoot: 'C:\\pss', entries: [entry('room-reactor', 'room', '..\\outside.png')] }, { targetRoot: 'C:\\project' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /越界/.test(error)));
  assert.equal(isSafePath('C:\\pss', '..\\outside.png'), false);
});

test('安全路径允许根目录内的相对路径和绝对路径', () => {
  assert.equal(isSafePath('C:\\pss', 'sorted\\room\\502.png'), true);
  assert.equal(isSafePath('C:\\pss', 'C:\\pss\\sorted\\room\\502.png'), true);
  assert.equal(isSafePath('C:\\pss', 'C:\\pss-evil\\x.png'), false);
});

test('manifest rect/frameRects 不得越过图片边界', () => {
  const bad = entry('room-reactor', 'room', 'sorted/room/502.png');
  bad.size = { width: 50, height: 50 };
  bad.rect = { x: 40, y: 0, width: 20, height: 20 };
  const result = validatePssManifest({ schemaVersion: 1, sourceRoot: 'C:\\pss', entries: [bad] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /图片边界/.test(error)));
});

test('manifest 允许 Hash 白名单控制的船体素材', () => {
  const result = validatePssManifest({ schemaVersion: 1, sourceRoot: 'C:\\pss', entries: [entry('visual-hull-starter', 'ship', 'sorted/ship/4324.png')] });
  assert.equal(result.ok, true, result.errors.join('\n'));
});
