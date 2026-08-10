import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  auditWindowsNativeRelease,
  canonicalJson,
  createFileManifest,
  decryptConfigPackage,
  packConfigDirectory,
  signManifest,
  stripRoomDefinitionsFromCocosBuild,
  verifyReleaseDirectory,
  verifySignedManifest,
} from './release-security.mjs';

function createSigningKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

test('canonicalJson 对对象键排序并保留数组顺序', () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 4, b: 2 }, list: [3, 1] }), '{"a":{"b":2,"d":4},"list":[3,1],"z":1}');
});

test('AES-256-GCM 配置包可解密，篡改后必须失败', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-config-'));
  const source = join(root, 'source');
  const output = join(root, 'room-config.spcfg');
  await mkdir(source);
  await writeFile(join(source, 'room-reactor.json'), JSON.stringify({ schemaVersion: 1, id: 'room-reactor', maxHp: 100 }));
  const key = randomBytes(32);
  await packConfigDirectory({
    inputDirectory: source,
    outputFile: output,
    buildId: 'windows-2026.08.09.1',
    configVersion: 'config-1',
    keyId: 'config-key-1',
    key,
    iv: Buffer.alloc(12, 7),
  });
  const envelope = JSON.parse(await readFile(output, 'utf8'));
  const payload = decryptConfigPackage(envelope, key);
  assert.equal(payload.documents[0].document.id, 'room-reactor');
  assert.equal(payload.documents[0].document.maxHp, 100);

  const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString('base64url');
  assert.throws(() => decryptConfigPackage(envelope, key));
  assert.throws(() => decryptConfigPackage(envelope, randomBytes(32)));
});

test('RSA-PSS 清单签名拒绝篡改和错误公钥', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-manifest-'));
  await writeFile(join(root, 'StarshipProtocol.exe'), 'signed-binary');
  await writeFile(join(root, 'texture.png'), 'visual');
  const manifest = await createFileManifest({
    rootDirectory: root,
    buildId: 'windows-1',
    configVersion: 'config-1',
    minimumLauncherVersion: '1.0.0',
    launchTicketUrl: 'https://api.example.test/api/v1/client/launch-ticket',
    reinstallUrl: 'https://download.example.test/starship-protocol.exe',
  });
  assert.equal(manifest.files.find((entry) => entry.path.endsWith('.exe')).verification, 'CORE');
  assert.equal(manifest.files.find((entry) => entry.path.endsWith('.png')).verification, 'BULK');
  const keys = createSigningKeys();
  const signed = signManifest(manifest, keys.privateKey);
  assert.equal(verifySignedManifest(signed, keys.publicKey).buildId, 'windows-1');

  const signature = Buffer.from(signed.signature, 'base64');
  signature[0] ^= 1;
  assert.throws(() => verifySignedManifest({ ...signed, signature: signature.toString('base64') }, keys.publicKey));
  assert.throws(() => verifySignedManifest(signed, createSigningKeys().publicKey));
});

test('发布目录校验拒绝文件篡改、缺失和额外文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-release-'));
  await writeFile(join(root, 'StarshipProtocol.exe'), 'binary-v1');
  await writeFile(join(root, 'game.jsc'), 'encrypted-script');
  const manifest = await createFileManifest({
    rootDirectory: root,
    buildId: 'windows-1',
    configVersion: 'config-1',
    minimumLauncherVersion: '1.0.0',
    launchTicketUrl: 'https://api.example.test/api/v1/client/launch-ticket',
    reinstallUrl: 'https://download.example.test/starship-protocol.exe',
  });
  const keys = createSigningKeys();
  const signed = signManifest(manifest, keys.privateKey);
  assert.equal((await verifyReleaseDirectory({ rootDirectory: root, signedManifest: signed, publicKeyPem: keys.publicKey })).ok, true);

  await writeFile(join(root, 'game.jsc'), 'tampered');
  await writeFile(join(root, 'unexpected.dll'), 'extra');
  const result = await verifyReleaseDirectory({ rootDirectory: root, signedManifest: signed, publicKeyPem: keys.publicKey });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.path === 'game.jsc'));
  assert.ok(result.failures.some((failure) => failure.path === 'unexpected.dll' && failure.code === 'UNEXPECTED_FILE'));
});

test('加密配置包和脚本进入 CORE，任一文件篡改都会阻止发布校验', async () => {
  const base = await mkdtemp(join(tmpdir(), 'starship-core-release-'));
  const root = join(base, 'release');
  const source = join(base, 'authoring-source');
  const configPackage = join(root, 'Resources', 'config', 'rules.spcfg');
  await mkdir(source, { recursive: true });
  await mkdir(root);
  await writeFile(join(source, 'room-reactor.json'), JSON.stringify({ schemaVersion: 1, id: 'room-reactor' }));
  await writeFile(join(root, 'game.jsc'), 'encrypted-script');
  await packConfigDirectory({
    inputDirectory: source,
    outputFile: configPackage,
    buildId: 'windows-1',
    configVersion: 'config-1',
    keyId: 'content-key-1',
    key: randomBytes(32),
  });

  const manifest = await createFileManifest({
    rootDirectory: root,
    buildId: 'windows-1',
    configVersion: 'config-1',
    minimumLauncherVersion: '1.0.0',
    launchTicketUrl: 'https://api.example.test/api/v1/client/launch-ticket',
    reinstallUrl: 'https://download.example.test/starship-protocol-installer.exe',
  });
  assert.equal(manifest.files.find((entry) => entry.path === 'game.jsc')?.verification, 'CORE');
  assert.equal(manifest.files.find((entry) => entry.path === 'Resources/config/rules.spcfg')?.verification, 'CORE');

  const keys = createSigningKeys();
  const signed = signManifest(manifest, keys.privateKey);
  assert.equal((await verifyReleaseDirectory({
    rootDirectory: root,
    signedManifest: signed,
    publicKeyPem: keys.publicKey,
  })).ok, true);

  await writeFile(configPackage, 'tampered-config-package');
  const tampered = await verifyReleaseDirectory({
    rootDirectory: root,
    signedManifest: signed,
    publicKeyPem: keys.publicKey,
  });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.failures.some((failure) =>
    failure.path === 'Resources/config/rules.spcfg' &&
    (failure.code === 'SIZE_MISMATCH' || failure.code === 'HASH_MISMATCH')));
});

test('发布清单拒绝路径穿越', () => {
  const keys = createSigningKeys();
  const manifest = {
    schemaVersion: 1,
    platform: 'windows',
    channel: 'stable',
    buildId: 'windows-1',
    configVersion: 'config-1',
    minimumLauncherVersion: '1.0.0',
    publishedAt: new Date(0).toISOString(),
    launchTicketUrl: 'https://api.example.test/ticket',
    reinstallUrl: 'https://download.example.test/installer.exe',
    files: [{ path: '../outside.dll', size: 1, sha256: '0'.repeat(64), verification: 'CORE' }],
  };
  assert.throws(() => signManifest(manifest, keys.privateKey), /路径/);
});

test('Windows Native 发行审计接受加密项目脚本且不误判加载脚本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-native-audit-'));
  await mkdir(join(root, 'Resources', 'assets', 'main'), { recursive: true });
  await mkdir(join(root, 'Resources', 'src', 'chunks'), { recursive: true });
  await writeFile(join(root, 'Resources', 'assets', 'main', 'index.jsc'), 'encrypted-project-script');
  await writeFile(join(root, 'Resources', 'assets', 'main', 'cc.config.json'), JSON.stringify({ encrypted: true, debug: false }));
  await writeFile(join(root, 'Resources', 'src', 'chunks', 'bundle.js'), 'small-runtime-loader');

  assert.deepEqual(await auditWindowsNativeRelease({ rootDirectory: root }), {
    ok: true,
    failures: [],
  });
});

test('Windows Native 发行审计拒绝调试配置、明文脚本、Source Map、备份和源房间规则', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-native-audit-'));
  const chunks = join(root, 'Resources', 'src', 'chunks');
  const mainAssets = join(root, 'Resources', 'assets', 'main');
  await mkdir(chunks, { recursive: true });
  await mkdir(mainAssets, { recursive: true });
  await mkdir(join(root, 'script-backup'), { recursive: true });
  await mkdir(join(root, 'Resources', 'assets'), { recursive: true });
  await writeFile(join(mainAssets, 'cc.config.json'), JSON.stringify({ encrypted: true, debug: true }));
  await writeFile(join(mainAssets, 'index.js'), 'plaintext-project-script');
  await writeFile(join(chunks, 'bundle.js.map'), '{}');
  await writeFile(join(root, 'script-backup', 'bundle.js'), 'backup');
  await writeFile(join(root, 'Resources', 'assets', 'room.json'), JSON.stringify({
    maxLevel: 1,
    maxHp: 100,
    minPower: 0,
    maxPower: 4,
    crewCapacity: 2,
  }));

  const result = await auditWindowsNativeRelease({ rootDirectory: root });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure) => failure.code === 'MISSING_ENCRYPTED_PROJECT_SCRIPT'));
  assert.ok(result.failures.some((failure) => failure.code === 'DEBUG_BUNDLE_CONFIG_PRESENT'));
  assert.ok(result.failures.some((failure) => failure.code === 'PLAINTEXT_PROJECT_SCRIPT'));
  assert.ok(result.failures.some((failure) => failure.code === 'SOURCE_MAP_PRESENT'));
  assert.ok(result.failures.some((failure) => failure.code === 'SCRIPT_BACKUP_PRESENT'));
  assert.ok(result.failures.some((failure) => failure.code === 'PLAINTEXT_ROOM_RULE_PRESENT'));
});

test('Windows Native 构建清理只移除生成目录中的已知房间规则', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starship-native-strip-'));
  const definitions = join(root, 'definitions');
  const staging = join(root, 'staging');
  await mkdir(definitions);
  await mkdir(staging);
  const room = {
    schemaVersion: 1,
    id: 'room-reactor',
    displayName: '反应堆',
    category: 'ENERGY',
    width: 2,
    height: 2,
    maxLevel: 1,
    maxHp: 100,
    minPower: 0,
    maxPower: 4,
    crewCapacity: 2,
  };
  await writeFile(join(definitions, 'room-reactor.json'), JSON.stringify(room));
  await writeFile(join(staging, 'packed.json'), JSON.stringify([room, { id: 'visual-only', maxHp: 1 }]));

  assert.equal(await stripRoomDefinitionsFromCocosBuild({
    rootDirectory: staging,
    definitionDirectory: definitions,
  }), 1);
  assert.deepEqual(JSON.parse(await readFile(join(staging, 'packed.json'), 'utf8')), [
    {},
    { id: 'visual-only', maxHp: 1 },
  ]);
});
