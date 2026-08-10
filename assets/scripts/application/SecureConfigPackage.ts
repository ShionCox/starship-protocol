export const SECURE_CONFIG_SCHEMA_VERSION = 1 as const;
export const SECURE_CONFIG_ALGORITHM = 'AES-256-GCM' as const;

const STABLE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SecureConfigEnvelope {
  readonly schemaVersion: typeof SECURE_CONFIG_SCHEMA_VERSION;
  readonly algorithm: typeof SECURE_CONFIG_ALGORITHM;
  readonly buildId: string;
  readonly configVersion: string;
  readonly keyId: string;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

export interface SecureConfigDocument {
  readonly path: string;
  readonly document: unknown;
}

export interface SecureConfigPayload {
  readonly schemaVersion: typeof SECURE_CONFIG_SCHEMA_VERSION;
  readonly buildId: string;
  readonly configVersion: string;
  readonly documents: readonly SecureConfigDocument[];
}

export interface AesGcmDecryptRequest {
  readonly keyBase64Url: string;
  readonly nonceBase64Url: string;
  readonly authTagBase64Url: string;
  readonly ciphertextBase64Url: string;
  readonly aadUtf8: string;
}

/** 平台密码适配器；GameCore 和配置解析层不依赖浏览器或 Cocos Native API。 */
export interface AesGcmDecryptor {
  decryptAesGcm(request: AesGcmDecryptRequest): Promise<string>;
}

export type SecureConfigErrorCode =
  | 'INVALID_ENVELOPE'
  | 'VERSION_MISMATCH'
  | 'DECRYPTION_FAILED'
  | 'INVALID_PAYLOAD';

export class SecureConfigError extends Error {
  public readonly code: SecureConfigErrorCode;
  public readonly cause: unknown;

  public constructor(
    code: SecureConfigErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'SecureConfigError';
    this.code = code;
    this.cause = options?.cause;
  }
}

/**
 * 解密并验证发布规则包。
 *
 * Build 与 Config 版本在解密前后各校验一次，避免把另一发布版本的合法密文
 * 注入当前进程；认证失败时不会返回任何部分文档。
 */
export async function openSecureConfigPackage(
  envelopeValue: unknown,
  keyBase64Url: string,
  expectedBuildId: string,
  expectedConfigVersion: string,
  decryptor: AesGcmDecryptor,
): Promise<Readonly<SecureConfigPayload>> {
  const envelope = parseSecureConfigEnvelope(envelopeValue);
  requireStableToken(expectedBuildId, 'expectedBuildId');
  requireStableToken(expectedConfigVersion, 'expectedConfigVersion');
  if (envelope.buildId !== expectedBuildId || envelope.configVersion !== expectedConfigVersion) {
    throw new SecureConfigError('VERSION_MISMATCH', '加密配置包与当前 Build/Config 版本不一致');
  }
  requireBase64UrlLength(keyBase64Url, 32, 'AES-256 内容密钥');

  let plaintext: string;
  try {
    plaintext = await decryptor.decryptAesGcm({
      keyBase64Url,
      nonceBase64Url: envelope.iv,
      authTagBase64Url: envelope.authTag,
      ciphertextBase64Url: envelope.ciphertext,
      aadUtf8: createSecureConfigAad(envelope),
    });
  } catch (cause) {
    throw new SecureConfigError('DECRYPTION_FAILED', '配置认证解密失败', { cause });
  }

  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(plaintext);
  } catch (cause) {
    throw new SecureConfigError('INVALID_PAYLOAD', '解密结果不是有效 UTF-8 JSON', { cause });
  }
  const payload = parseSecureConfigPayload(payloadValue);
  if (payload.buildId !== envelope.buildId || payload.configVersion !== envelope.configVersion) {
    throw new SecureConfigError('VERSION_MISMATCH', '解密内容与加密封装版本不一致');
  }
  return payload;
}

export function parseSecureConfigEnvelope(value: unknown): Readonly<SecureConfigEnvelope> {
  if (!isRecord(value)) {
    throw new SecureConfigError('INVALID_ENVELOPE', '加密配置包必须是 JSON 对象');
  }
  if (value.schemaVersion !== SECURE_CONFIG_SCHEMA_VERSION || value.algorithm !== SECURE_CONFIG_ALGORITHM) {
    throw new SecureConfigError('INVALID_ENVELOPE', '加密配置包版本或算法无效');
  }
  requireStableToken(value.buildId, 'buildId');
  requireStableToken(value.configVersion, 'configVersion');
  requireStableToken(value.keyId, 'keyId');
  requireBase64UrlLength(value.iv, 12, 'AES-GCM IV');
  requireBase64UrlLength(value.authTag, 16, 'AES-GCM 认证标签');
  requireBase64Url(value.ciphertext, 'AES-GCM 密文');

  return Object.freeze({
    schemaVersion: SECURE_CONFIG_SCHEMA_VERSION,
    algorithm: SECURE_CONFIG_ALGORITHM,
    buildId: value.buildId,
    configVersion: value.configVersion,
    keyId: value.keyId,
    iv: value.iv,
    authTag: value.authTag,
    ciphertext: value.ciphertext,
  });
}

/** 与 Node 发布工具的 canonical JSON 字节保持一致；字段顺序按字母排序。 */
export function createSecureConfigAad(envelope: SecureConfigEnvelope): string {
  return JSON.stringify({
    algorithm: envelope.algorithm,
    buildId: envelope.buildId,
    configVersion: envelope.configVersion,
    keyId: envelope.keyId,
    schemaVersion: envelope.schemaVersion,
  });
}

function parseSecureConfigPayload(value: unknown): Readonly<SecureConfigPayload> {
  const buildId = isRecord(value) && typeof value.buildId === 'string' ? value.buildId : '';
  const configVersion = isRecord(value) && typeof value.configVersion === 'string' ? value.configVersion : '';
  if (
    !isRecord(value) ||
    value.schemaVersion !== SECURE_CONFIG_SCHEMA_VERSION ||
    !STABLE_TOKEN_PATTERN.test(buildId) ||
    !STABLE_TOKEN_PATTERN.test(configVersion) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0
  ) {
    throw new SecureConfigError('INVALID_PAYLOAD', '配置明文结构、版本或标识无效');
  }

  const paths = new Set<string>();
  const documents = value.documents.map((item) => {
    if (!isRecord(item) || !isSafeDocumentPath(item.path) || !Object.prototype.hasOwnProperty.call(item, 'document')) {
      throw new SecureConfigError('INVALID_PAYLOAD', '配置文档路径或内容无效');
    }
    if (paths.has(item.path)) {
      throw new SecureConfigError('INVALID_PAYLOAD', `配置文档路径重复：${item.path}`);
    }
    paths.add(item.path);
    return Object.freeze({ path: item.path, document: item.document });
  });

  return Object.freeze({
    schemaVersion: SECURE_CONFIG_SCHEMA_VERSION,
    buildId,
    configVersion,
    documents: Object.freeze(documents),
  });
}

function isSafeDocumentPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  return value.endsWith('.json') && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function requireStableToken(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_TOKEN_PATTERN.test(value)) {
    throw new SecureConfigError('INVALID_ENVELOPE', `${label} 必须是稳定字符串`);
  }
}

function requireBase64UrlLength(value: unknown, bytes: number, label: string): asserts value is string {
  requireBase64Url(value, label);
  if (decodedBase64UrlLength(value) !== bytes) {
    throw new SecureConfigError('INVALID_ENVELOPE', `${label} 长度无效`);
  }
}

function requireBase64Url(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !BASE64_URL_PATTERN.test(value) ||
    value.length % 4 === 1
  ) {
    throw new SecureConfigError('INVALID_ENVELOPE', `${label} 不是无填充 Base64URL`);
  }
}

function decodedBase64UrlLength(value: string): number {
  return Math.floor(value.length * 6 / 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
