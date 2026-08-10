import { ConfigRegistry } from './ConfigRegistry.ts';
import {
  openSecureConfigPackage,
  parseSecureConfigEnvelope,
  type AesGcmDecryptor,
} from './SecureConfigPackage.ts';

const LAUNCH_TICKET_PATH = '/api/v1/client/launch-ticket';
const GUEST_SESSION_PATH = '/api/v1/auth/guest';
const BOOTSTRAP_PATH = '/api/v1/client/bootstrap';
const MAXIMUM_CONFIG_TEXT_LENGTH = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface SecureLaunchContext {
  readonly buildId: string;
  readonly configVersion: string;
  readonly installId: string;
  readonly launchTicket: string;
  readonly launchTicketUrl: string;
}

export interface SecureConfigHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** 平台网络与摘要适配；应用层不依赖 DOM、Cocos 或 Windows API。 */
export interface SecureConfigTransport {
  request(
    method: 'GET' | 'POST',
    url: string,
    headers?: Readonly<Record<string, string>>,
    body?: string,
  ): Promise<SecureConfigHttpResponse>;

  sha256HexUtf8(value: string): Promise<string>;
}

export interface SecureConfigBootstrapResult {
  readonly buildId: string;
  readonly configVersion: string;
}

/**
 * 使用启动器下发的短时凭证加载受认证配置。
 *
 * 下载、Hash、AES-GCM、Build/Config 和全部文档均通过后才原子替换 Registry；
 * 任一步失败都不会暴露半份配置，也不会回退到正式包内的源 JSON。
 */
export async function bootstrapSecureConfig(
  contextValue: unknown,
  transport: SecureConfigTransport,
  decryptor: AesGcmDecryptor,
  registry: ConfigRegistry,
): Promise<SecureConfigBootstrapResult> {
  const context = parseSecureLaunchContext(contextValue);
  const apiRoot = context.launchTicketUrl.slice(0, -LAUNCH_TICKET_PATH.length);
  const guestResponse = await transport.request(
    'POST',
    `${apiRoot}${GUEST_SESSION_PATH}`,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ installId: context.installId }),
  );
  const sessionToken = readStringResponseField(guestResponse, 'sessionToken', '访客会话');

  const bootstrapResponse = await transport.request(
    'GET',
    `${apiRoot}${BOOTSTRAP_PATH}`,
    {
      Authorization: `Bearer ${context.launchTicket}`,
      'X-Player-Session': sessionToken,
    },
  );
  const bootstrap = parseBootstrapResponse(bootstrapResponse);
  if (bootstrap.buildId !== context.buildId || bootstrap.configVersion !== context.configVersion) {
    throw new Error('Bootstrap 与启动器验证的 Build/Config 版本不一致');
  }

  const packageResponse = await transport.request('GET', bootstrap.assetUrl);
  requireSuccess(packageResponse, '加密配置下载');
  if (packageResponse.body.length === 0 || packageResponse.body.length > MAXIMUM_CONFIG_TEXT_LENGTH) {
    throw new Error('加密配置文件大小无效');
  }
  const actualSha256 = await transport.sha256HexUtf8(packageResponse.body);
  if (actualSha256 !== bootstrap.sha256) {
    throw new Error('加密配置文件 SHA-256 校验失败');
  }

  let envelopeValue: unknown;
  try {
    envelopeValue = JSON.parse(packageResponse.body);
  } catch {
    throw new Error('加密配置文件不是有效 UTF-8 JSON');
  }
  const envelope = parseSecureConfigEnvelope(envelopeValue);
  if (envelope.keyId !== bootstrap.keyId || envelope.iv !== bootstrap.iv) {
    throw new Error('Bootstrap 元数据与加密配置封装不一致');
  }

  const payload = await openSecureConfigPackage(
    envelope,
    bootstrap.contentKey,
    context.buildId,
    context.configVersion,
    decryptor,
  );
  registry.replaceFromSecurePayload(payload);
  return Object.freeze({ buildId: payload.buildId, configVersion: payload.configVersion });
}

export function parseSecureLaunchContext(value: unknown): Readonly<SecureLaunchContext> {
  if (!isRecord(value)) {
    throw new Error('原生启动上下文必须是对象');
  }
  const buildId = typeof value.buildId === 'string' ? value.buildId : '';
  const configVersion = typeof value.configVersion === 'string' ? value.configVersion : '';
  const installId = typeof value.installId === 'string' ? value.installId : '';
  for (const [field, fieldValue] of [
    ['buildId', buildId],
    ['configVersion', configVersion],
    ['installId', installId],
  ] as const) {
    if (!STABLE_TOKEN_PATTERN.test(fieldValue)) {
      throw new Error(`原生启动上下文 ${field} 无效`);
    }
  }
  if (typeof value.launchTicket !== 'string' || value.launchTicket.length < 16) {
    throw new Error('原生启动上下文缺少短时 Launch Ticket');
  }
  if (
    typeof value.launchTicketUrl !== 'string' ||
    !value.launchTicketUrl.startsWith('https://') ||
    !value.launchTicketUrl.endsWith(LAUNCH_TICKET_PATH)
  ) {
    throw new Error('原生启动上下文 launchTicketUrl 必须是受支持的 HTTPS 地址');
  }
  return Object.freeze({
    buildId,
    configVersion,
    installId,
    launchTicket: value.launchTicket,
    launchTicketUrl: value.launchTicketUrl,
  });
}

interface ParsedBootstrap {
  readonly buildId: string;
  readonly configVersion: string;
  readonly keyId: string;
  readonly assetUrl: string;
  readonly sha256: string;
  readonly iv: string;
  readonly contentKey: string;
}

function parseBootstrapResponse(response: SecureConfigHttpResponse): ParsedBootstrap {
  const value = parseJsonResponse(response, 'Bootstrap');
  const encryptedConfig = isRecord(value.encryptedConfig) ? value.encryptedConfig : null;
  if (
    typeof value.buildId !== 'string' ||
    typeof value.configVersion !== 'string' ||
    encryptedConfig === null ||
    encryptedConfig.formatVersion !== 1 ||
    encryptedConfig.algorithm !== 'AES-256-GCM' ||
    typeof encryptedConfig.keyId !== 'string' ||
    typeof encryptedConfig.assetUrl !== 'string' ||
    !encryptedConfig.assetUrl.startsWith('https://') ||
    typeof encryptedConfig.sha256 !== 'string' ||
    !SHA256_PATTERN.test(encryptedConfig.sha256) ||
    typeof encryptedConfig.iv !== 'string' ||
    typeof value.contentKey !== 'string'
  ) {
    throw new Error('Bootstrap 响应结构或安全元数据无效');
  }
  return {
    buildId: value.buildId,
    configVersion: value.configVersion,
    keyId: encryptedConfig.keyId,
    assetUrl: encryptedConfig.assetUrl,
    sha256: encryptedConfig.sha256,
    iv: encryptedConfig.iv,
    contentKey: value.contentKey,
  };
}

function readStringResponseField(
  response: SecureConfigHttpResponse,
  field: string,
  label: string,
): string {
  const value = parseJsonResponse(response, label);
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error(`${label}响应缺少 ${field}`);
  }
  return result;
}

function parseJsonResponse(response: SecureConfigHttpResponse, label: string): Record<string, unknown> {
  requireSuccess(response, label);
  let value: unknown;
  try {
    value = JSON.parse(response.body);
  } catch {
    throw new Error(`${label}响应不是有效 JSON`);
  }
  if (!isRecord(value)) {
    throw new Error(`${label}响应必须是 JSON 对象`);
  }
  return value;
}

function requireSuccess(response: SecureConfigHttpResponse, label: string): void {
  if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) {
    throw new Error(`${label}请求失败：HTTP ${String(response.status)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
