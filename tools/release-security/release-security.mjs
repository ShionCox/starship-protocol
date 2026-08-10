import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_PACKAGE_SCHEMA_VERSION = 1;
export const FILE_MANIFEST_SCHEMA_VERSION = 1;
export const SIGNED_MANIFEST_SCHEMA_VERSION = 1;

const AES_ALGORITHM = 'AES-256-GCM';
const MANIFEST_SIGNATURE_ALGORITHM = 'RSA-PSS-SHA256';
const RSA_PSS_SALT_LENGTH = 32;
const CORE_EXTENSIONS = new Set(['.dll', '.exe', '.jsc', '.spcfg']);

/**
 * 生成跨平台稳定 JSON。签名只能覆盖确定字节序列，不能依赖对象插入顺序。
 */
export function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

export async function packConfigDirectory({
  inputDirectory,
  outputFile,
  buildId,
  configVersion,
  keyId,
  key,
  iv = randomBytes(12),
}) {
  validateStableToken(buildId, 'buildId');
  validateStableToken(configVersion, 'configVersion');
  validateStableToken(keyId, 'keyId');
  validateAesKey(key);
  if (!Buffer.isBuffer(iv) || iv.length !== 12) {
    throw new Error('AES-GCM IV 必须是 12 字节 Buffer');
  }

  const documents = await readJsonDocuments(inputDirectory);
  if (documents.length === 0) {
    throw new Error(`配置目录没有 JSON：${inputDirectory}`);
  }

  const payload = {
    schemaVersion: CONFIG_PACKAGE_SCHEMA_VERSION,
    buildId,
    configVersion,
    documents,
  };
  const aadValue = {
    schemaVersion: CONFIG_PACKAGE_SCHEMA_VERSION,
    algorithm: AES_ALGORITHM,
    buildId,
    configVersion,
    keyId,
  };
  const aad = Buffer.from(canonicalJson(aadValue), 'utf8');
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(canonicalJson(payload), 'utf8')),
    cipher.final(),
  ]);
  const envelope = {
    ...aadValue,
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };

  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${canonicalJson(envelope)}\n`, { flag: 'wx' });
  return envelope;
}

/** 只用于构建验证和测试；正式客户端由平台安全适配层在内存中解密。 */
export function decryptConfigPackage(envelopeValue, key) {
  validateAesKey(key);
  const envelope = validateConfigEnvelope(envelopeValue);
  const aad = Buffer.from(canonicalJson({
    schemaVersion: envelope.schemaVersion,
    algorithm: envelope.algorithm,
    buildId: envelope.buildId,
    configVersion: envelope.configVersion,
    keyId: envelope.keyId,
  }), 'utf8');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64url'),
    { authTagLength: 16 },
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

export async function createFileManifest({
  rootDirectory,
  buildId,
  configVersion,
  minimumLauncherVersion,
  channel = 'stable',
  launchTicketUrl,
  reinstallUrl,
  excludedPaths = [],
}) {
  validateStableToken(buildId, 'buildId');
  validateStableToken(configVersion, 'configVersion');
  validateVersion(minimumLauncherVersion);
  validateHttpsUrl(launchTicketUrl, 'launchTicketUrl');
  validateHttpsUrl(reinstallUrl, 'reinstallUrl');

  const root = await realpath(rootDirectory);
  const exclusions = new Set(excludedPaths.map(normalizeRelativePath));
  const relativePaths = await listRegularFiles(root);
  const files = [];
  for (const relativePath of relativePaths) {
    if (exclusions.has(relativePath)) {
      continue;
    }
    const absolutePath = resolveUnderRoot(root, relativePath);
    const fileStat = await stat(absolutePath);
    files.push({
      path: relativePath,
      size: fileStat.size,
      sha256: await hashFile(absolutePath),
      verification: isCoreFile(relativePath) ? 'CORE' : 'BULK',
    });
  }
  if (files.length === 0) {
    throw new Error(`安装目录没有可发布文件：${rootDirectory}`);
  }
  return {
    schemaVersion: FILE_MANIFEST_SCHEMA_VERSION,
    platform: 'windows',
    channel,
    buildId,
    configVersion,
    minimumLauncherVersion,
    publishedAt: new Date().toISOString(),
    launchTicketUrl,
    reinstallUrl,
    files,
  };
}

/**
 * 外层只签名 payload 原始字节，原生启动器无需重新实现 JSON 规范化算法。
 */
export function signManifest(manifest, privateKeyPem) {
  validateManifest(manifest);
  const payload = Buffer.from(canonicalJson(manifest), 'utf8');
  const signature = sign('sha256', payload, {
    key: createPrivateKey(privateKeyPem),
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: RSA_PSS_SALT_LENGTH,
  });
  return {
    schemaVersion: SIGNED_MANIFEST_SCHEMA_VERSION,
    algorithm: MANIFEST_SIGNATURE_ALGORITHM,
    saltLength: RSA_PSS_SALT_LENGTH,
    payload: payload.toString('base64'),
    signature: signature.toString('base64'),
  };
}

export function verifySignedManifest(envelopeValue, publicKeyPem) {
  const envelope = validateSignedManifestEnvelope(envelopeValue);
  const payload = Buffer.from(envelope.payload, 'base64');
  const signature = Buffer.from(envelope.signature, 'base64');
  const verified = verify('sha256', payload, {
    key: createPublicKey(publicKeyPem),
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: envelope.saltLength,
  }, signature);
  if (!verified) {
    throw new Error('发布清单签名无效');
  }
  const manifest = JSON.parse(payload.toString('utf8'));
  validateManifest(manifest);
  return manifest;
}

export async function verifyReleaseDirectory({ rootDirectory, signedManifest, publicKeyPem }) {
  const manifest = verifySignedManifest(signedManifest, publicKeyPem);
  const root = await realpath(rootDirectory);
  const failures = [];
  const expected = new Set();
  for (const entry of manifest.files) {
    expected.add(entry.path);
    try {
      const absolutePath = resolveUnderRoot(root, entry.path);
      const fileInfo = await lstat(absolutePath);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        failures.push({ path: entry.path, code: 'NOT_REGULAR_FILE' });
        continue;
      }
      if (fileInfo.size !== entry.size) {
        failures.push({ path: entry.path, code: 'SIZE_MISMATCH' });
        continue;
      }
      if (await hashFile(absolutePath) !== entry.sha256) {
        failures.push({ path: entry.path, code: 'HASH_MISMATCH' });
      }
    } catch (cause) {
      failures.push({
        path: entry.path,
        code: cause?.code === 'ENOENT' ? 'MISSING_FILE' : 'READ_ERROR',
      });
    }
  }

  const actualFiles = await listRegularFiles(root);
  for (const actualPath of actualFiles) {
    if (!expected.has(actualPath)) {
      failures.push({ path: actualPath, code: 'UNEXPECTED_FILE' });
    }
  }
  return { ok: failures.length === 0, manifest, failures };
}

/**
 * 审计 Creator Windows Release 的静态发行边界。
 *
 * XXTEA 只提高脚本静态提取成本；这里检查的是构建配置确实生效，以及源规则没有被
 * JsonAsset 引用重新带入 staging。服务端权威和配置 AES-GCM 仍由其他安全步骤负责。
 */
export async function auditWindowsNativeRelease({ rootDirectory }) {
  const root = await realpath(rootDirectory);
  const paths = await listRegularFiles(root);
  const failures = [];
  const lowerPaths = paths.map((path) => path.toLowerCase());

  const encryptedProjectScript = lowerPaths.some((path) => path.endsWith('/assets/main/index.jsc'));
  if (!encryptedProjectScript) {
    failures.push({ path: 'Resources/assets/main/index.jsc', code: 'MISSING_ENCRYPTED_PROJECT_SCRIPT' });
  }
  const mainConfigIndex = lowerPaths.findIndex((path) => path.endsWith('/assets/main/cc.config.json'));
  if (mainConfigIndex < 0) {
    failures.push({ path: 'Resources/assets/main/cc.config.json', code: 'MISSING_MAIN_BUNDLE_CONFIG' });
  } else {
    const mainConfig = JSON.parse(await readFile(resolveUnderRoot(root, paths[mainConfigIndex]), 'utf8'));
    if (mainConfig.encrypted !== true) {
      failures.push({ path: paths[mainConfigIndex], code: 'MAIN_BUNDLE_NOT_MARKED_ENCRYPTED' });
    }
    if (mainConfig.debug !== false) {
      failures.push({ path: paths[mainConfigIndex], code: 'DEBUG_BUNDLE_CONFIG_PRESENT' });
    }
  }

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const lowerPath = lowerPaths[index];
    if (lowerPath.endsWith('/assets/main/index.js')) {
      failures.push({ path, code: 'PLAINTEXT_PROJECT_SCRIPT' });
    }
    if (lowerPath.endsWith('.map')) {
      failures.push({ path, code: 'SOURCE_MAP_PRESENT' });
    }
    if (lowerPath.split('/').includes('script-backup')) {
      failures.push({ path, code: 'SCRIPT_BACKUP_PRESENT' });
    }
    if (/\.(pem|pfx|p12|key)$/i.test(path)) {
      failures.push({ path, code: 'PRIVATE_KEY_MATERIAL_PRESENT' });
    }

    if (/\.(json|js)$/i.test(path)) {
      const content = await readFile(resolveUnderRoot(root, path), 'utf8');
      const roomRuleMarkers = ['"maxLevel"', '"maxHp"', '"minPower"', '"maxPower"', '"crewCapacity"'];
      if (roomRuleMarkers.every((marker) => content.includes(marker))) {
        failures.push({ path, code: 'PLAINTEXT_ROOM_RULE_PRESENT' });
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * 从 Creator 生成目录移除编辑器 JsonAsset 携带的源房间规则。
 * 只改 build 产物，不触碰 Scene、Prefab 或 meta；正式 Native 改由 Secure ConfigRegistry 提供规则。
 */
export async function stripRoomDefinitionsFromCocosBuild({ rootDirectory, definitionDirectory }) {
  const definitions = await readJsonDocuments(definitionDirectory);
  const definitionIds = new Set(definitions.map(({ document }) => document?.id).filter((id) => typeof id === 'string'));
  if (definitionIds.size !== definitions.length || definitionIds.size === 0) {
    throw new Error('源房间定义必须包含唯一稳定 ID');
  }

  const root = await realpath(rootDirectory);
  const jsonPaths = (await listRegularFiles(root)).filter((path) => path.endsWith('.json'));
  let strippedCount = 0;
  for (const path of jsonPaths) {
    const absolutePath = resolveUnderRoot(root, path);
    const value = JSON.parse(await readFile(absolutePath, 'utf8'));
    const result = stripRoomDefinitionValue(value, definitionIds);
    if (result.changed) {
      strippedCount += result.count;
      await writeFile(absolutePath, JSON.stringify(result.value), 'utf8');
    }
  }
  return strippedCount;
}

function stripRoomDefinitionValue(value, definitionIds) {
  if (Array.isArray(value)) {
    let changed = false;
    let count = 0;
    const next = value.map((entry) => {
      const result = stripRoomDefinitionValue(entry, definitionIds);
      changed ||= result.changed;
      count += result.count;
      return result.value;
    });
    return { value: changed ? next : value, changed, count };
  }
  if (!isRecord(value)) {
    return { value, changed: false, count: 0 };
  }
  const markers = ['maxLevel', 'maxHp', 'minPower', 'maxPower', 'crewCapacity'];
  if (definitionIds.has(value.id) && markers.every((name) => Object.hasOwn(value, name))) {
    return { value: {}, changed: true, count: 1 };
  }

  let changed = false;
  let count = 0;
  const next = {};
  for (const [name, entry] of Object.entries(value)) {
    const result = stripRoomDefinitionValue(entry, definitionIds);
    next[name] = result.value;
    changed ||= result.changed;
    count += result.count;
  }
  return { value: changed ? next : value, changed, count };
}

export function publicKeyDerFromPem(publicKeyPem) {
  return createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
}

async function readJsonDocuments(inputDirectory) {
  const root = await realpath(inputDirectory);
  const paths = (await listRegularFiles(root)).filter((path) => path.endsWith('.json'));
  const documents = [];
  for (const path of paths) {
    const absolutePath = resolveUnderRoot(root, path);
    documents.push({ path, document: JSON.parse(await readFile(absolutePath, 'utf8')) });
  }
  return documents;
}

async function listRegularFiles(rootDirectory) {
  const result = [];
  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolutePath = resolve(currentDirectory, entry.name);
      const relativePath = normalizeRelativePath(relative(rootDirectory, absolutePath));
      if (entry.isSymbolicLink()) {
        throw new Error(`发布目录禁止符号链接：${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        result.push(relativePath);
      }
    }
  }
  await visit(rootDirectory);
  return result;
}

async function hashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== FILE_MANIFEST_SCHEMA_VERSION) {
    throw new Error('发布清单版本无效');
  }
  if (manifest.platform !== 'windows' || typeof manifest.channel !== 'string') {
    throw new Error('发布清单平台或渠道无效');
  }
  validateStableToken(manifest.buildId, 'buildId');
  validateStableToken(manifest.configVersion, 'configVersion');
  validateVersion(manifest.minimumLauncherVersion);
  validateHttpsUrl(manifest.launchTicketUrl, 'launchTicketUrl');
  validateHttpsUrl(manifest.reinstallUrl, 'reinstallUrl');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('发布清单必须包含文件');
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!isRecord(entry)) {
      throw new Error('发布清单文件项必须是对象');
    }
    const normalized = normalizeRelativePath(entry.path);
    if (normalized !== entry.path || seen.has(normalized)) {
      throw new Error(`发布清单包含重复或非规范路径：${String(entry.path)}`);
    }
    seen.add(normalized);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`发布文件大小无效：${entry.path}`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`发布文件 Hash 无效：${entry.path}`);
    }
    if (entry.verification !== 'CORE' && entry.verification !== 'BULK') {
      throw new Error(`发布文件校验级别无效：${entry.path}`);
    }
  }
}

function validateConfigEnvelope(value) {
  if (!isRecord(value) || value.schemaVersion !== CONFIG_PACKAGE_SCHEMA_VERSION || value.algorithm !== AES_ALGORITHM) {
    throw new Error('加密配置包格式或算法无效');
  }
  validateStableToken(value.buildId, 'buildId');
  validateStableToken(value.configVersion, 'configVersion');
  validateStableToken(value.keyId, 'keyId');
  for (const field of ['iv', 'authTag', 'ciphertext']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`加密配置包缺少 ${field}`);
    }
  }
  if (Buffer.from(value.iv, 'base64url').length !== 12 || Buffer.from(value.authTag, 'base64url').length !== 16) {
    throw new Error('加密配置包 IV 或认证标签长度无效');
  }
  return value;
}

function validateSignedManifestEnvelope(value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SIGNED_MANIFEST_SCHEMA_VERSION ||
    value.algorithm !== MANIFEST_SIGNATURE_ALGORITHM ||
    value.saltLength !== RSA_PSS_SALT_LENGTH ||
    typeof value.payload !== 'string' ||
    typeof value.signature !== 'string'
  ) {
    throw new Error('签名清单封装格式无效');
  }
  return value;
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`发布路径必须是非空相对路径：${String(value)}`);
  }
  const normalized = value.split(sep).join('/');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..') || normalized.includes(':')) {
    throw new Error(`发布路径越界或不规范：${value}`);
  }
  return normalized;
}

function resolveUnderRoot(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const absolutePath = resolve(root, ...normalized.split('/'));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (absolutePath !== root && !absolutePath.startsWith(prefix)) {
    throw new Error(`发布路径越过安装目录：${relativePath}`);
  }
  return absolutePath;
}

function isCoreFile(path) {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex >= 0 && CORE_EXTENSIONS.has(path.slice(dotIndex).toLowerCase());
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key])]),
    );
  }
  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAesKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('AES-256-GCM 密钥必须是 32 字节 Buffer');
  }
}

function validateStableToken(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${name} 必须是稳定的 ASCII 标识符`);
  }
}

function validateVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`版本必须使用 major.minor.patch：${String(value)}`);
  }
}

function validateHttpsUrl(value, name) {
  if (typeof value !== 'string') {
    throw new Error(`${name} 必须是 HTTPS URL`);
  }
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error(`${name} 必须使用 HTTPS`);
  }
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`参数必须使用 --name value：${name ?? ''}`);
    }
    result[name.slice(2)] = value;
  }
  return result;
}

function requireArgument(args, name) {
  const value = args[name];
  if (!value) {
    throw new Error(`缺少参数 --${name}`);
  }
  return value;
}

async function runCli() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArguments(rest);
  if (command === 'pack-config') {
    const keyText = process.env.STARSHIP_CONFIG_AES_KEY_BASE64;
    if (!keyText) {
      throw new Error('缺少环境变量 STARSHIP_CONFIG_AES_KEY_BASE64');
    }
    await packConfigDirectory({
      inputDirectory: requireArgument(args, 'input'),
      outputFile: requireArgument(args, 'output'),
      buildId: requireArgument(args, 'build-id'),
      configVersion: requireArgument(args, 'config-version'),
      keyId: requireArgument(args, 'key-id'),
      key: Buffer.from(keyText, 'base64'),
    });
    return;
  }
  if (command === 'create-manifest') {
    const privateKeyPath = process.env.STARSHIP_MANIFEST_PRIVATE_KEY_FILE;
    if (!privateKeyPath) {
      throw new Error('缺少环境变量 STARSHIP_MANIFEST_PRIVATE_KEY_FILE');
    }
    const output = requireArgument(args, 'output');
    const root = requireArgument(args, 'root');
    const relativeOutput = relative(root, output);
    const outputIsInsideRoot = relativeOutput !== '' && !relativeOutput.startsWith(`..${sep}`) && !isAbsolute(relativeOutput);
    const manifest = await createFileManifest({
      rootDirectory: root,
      buildId: requireArgument(args, 'build-id'),
      configVersion: requireArgument(args, 'config-version'),
      minimumLauncherVersion: requireArgument(args, 'minimum-launcher-version'),
      launchTicketUrl: requireArgument(args, 'launch-ticket-url'),
      reinstallUrl: requireArgument(args, 'reinstall-url'),
      excludedPaths: outputIsInsideRoot ? [normalizeRelativePath(relativeOutput)] : [],
    });
    const signed = signManifest(manifest, await readFile(privateKeyPath, 'utf8'));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${canonicalJson(signed)}\n`, { flag: 'wx' });
    return;
  }
  if (command === 'verify-release') {
    const signedManifest = JSON.parse(await readFile(requireArgument(args, 'manifest'), 'utf8'));
    const result = await verifyReleaseDirectory({
      rootDirectory: requireArgument(args, 'root'),
      signedManifest,
      publicKeyPem: await readFile(requireArgument(args, 'public-key'), 'utf8'),
    });
    if (!result.ok) {
      throw new Error(`发布目录校验失败：${JSON.stringify(result.failures)}`);
    }
    return;
  }
  if (command === 'audit-windows-native') {
    const result = await auditWindowsNativeRelease({
      rootDirectory: requireArgument(args, 'root'),
    });
    if (!result.ok) {
      throw new Error(`Windows Native 发行审计失败：${JSON.stringify(result.failures)}`);
    }
    return;
  }
  if (command === 'export-public-key') {
    const output = requireArgument(args, 'output');
    const publicKeyPem = await readFile(requireArgument(args, 'public-key'), 'utf8');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, publicKeyDerFromPem(publicKeyPem), { flag: 'wx' });
    return;
  }
  throw new Error('命令必须是 pack-config、create-manifest、verify-release、audit-windows-native 或 export-public-key');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((cause) => {
    console.error(`[SECURITY] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
