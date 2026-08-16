const assert = require('node:assert/strict');
const test = require('node:test');

const { createPssImportPort } = require('../dist/pss/pss-import.js');

const sha = 'a'.repeat(64);
function makeEntry() {
  return {
    assetId: 'room-reactor', visualId: 'pss-room-reactor', kind: 'room', sourcePath: 'sorted/room/502.png', sourceRelativePath: 'sorted/room/502.png', targetPath: 'assets/textures/pss/room-reactor.png', sourceSha256: sha, licenseNote: 'reference', rightsStatus: 'reference-only',
  };
}

function fakeFs() {
  const files = new Map([['C:/pss/sorted/room/502.png', Buffer.from('source')]]);
  const normalize = (file) => file.replace(/\\/g, '/');
  return {
    files,
    async readFile(file) { file = normalize(file); if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    async stat(file) { file = normalize(file); if (!files.has(file)) throw new Error('ENOENT'); return { isFile: () => true }; },
    async mkdir() {},
    async copyFile(source, target) { files.set(normalize(target), files.get(normalize(source))); },
    async unlink(file) { files.delete(normalize(file)); },
  };
}

test('导入端口校验来源 Hash、目标范围并保持幂等', async () => {
  const fs = fakeFs();
  const crypto = require('node:crypto');
  const entry = makeEntry();
  entry.sourceSha256 = crypto.createHash('sha256').update('source').digest('hex');
  const port = createPssImportPort({ sourceRoot: 'C:/pss', targetRoot: 'C:/project', fileSystem: fs });
  const first = await port.importEntry(entry);
  assert.equal(first.ok, true);
  assert.equal(first.status, 'imported');
  const second = await port.importEntry(entry);
  assert.equal(second.status, 'already-present');
});

test('目标已有不同内容且未启用覆盖时不写入', async () => {
  const fs = fakeFs();
  const crypto = require('node:crypto');
  const entry = makeEntry();
  entry.sourceSha256 = crypto.createHash('sha256').update('source').digest('hex');
  fs.files.set('C:/project/assets/textures/pss/room-reactor.png', Buffer.from('old'));
  const result = await createPssImportPort({ sourceRoot: 'C:/pss', targetRoot: 'C:/project', fileSystem: fs }).importEntry(entry);
  assert.equal(result.ok, false);
  assert.match(result.message, /未启用覆盖/);
  assert.equal(fs.files.get('C:/project/assets/textures/pss/room-reactor.png').toString(), 'old');
});

test('清单使用来源/目标绝对路径时不会重复拼接根目录', async () => {
  const fs = fakeFs();
  const crypto = require('node:crypto');
  const entry = makeEntry();
  entry.sourceRelativePath = undefined;
  entry.sourcePath = 'C:/pss/sorted/room/502.png';
  entry.targetPath = 'C:/project/assets/textures/pss/room-reactor.png';
  entry.sourceSha256 = crypto.createHash('sha256').update('source').digest('hex');
  const result = await createPssImportPort({ sourceRoot: 'C:/pss', targetRoot: 'C:/project', fileSystem: fs }).importEntry(entry);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'imported');
});
