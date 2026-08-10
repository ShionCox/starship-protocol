import { NATIVE } from 'cc/env';

import type {
  SecureConfigHttpResponse,
  SecureConfigTransport,
} from '../application/SecureConfigBootstrap';
import { createNativeSecurityBridge } from './CocosAesGcmDecryptor';

/** 读取启动器经 Cocos Native Plugin 暴露的只读启动上下文。 */
export function readCocosLaunchContext(): unknown {
  if (!NATIVE) {
    throw new Error('安全配置启动上下文只允许在 Cocos Native 正式运行时读取');
  }
  const value = createNativeSecurityBridge().getLaunchContext();
  if (value.length === 0) {
    throw new Error('启动器未提供有效的安全启动上下文');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('原生安全启动上下文不是有效 JSON');
  }
}

/** Cocos 网络与 SHA-256 适配；正式 Windows 摘要由 CNG 计算。 */
export class CocosSecureConfigTransport implements SecureConfigTransport {
  public async request(
    method: 'GET' | 'POST',
    url: string,
    headers: Readonly<Record<string, string>> = {},
    body?: string,
  ): Promise<SecureConfigHttpResponse> {
    const response = await fetch(url, {
      method,
      headers,
      body,
      cache: 'no-store',
    });
    return { status: response.status, body: await response.text() };
  }

  public async sha256HexUtf8(value: string): Promise<string> {
    if (NATIVE) {
      const digest = createNativeSecurityBridge().sha256Utf8(value);
      if (!/^[a-f0-9]{64}$/.test(digest)) {
        throw new Error('Windows 原生 SHA-256 计算失败');
      }
      return digest;
    }

    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle === undefined) {
      throw new Error('当前开发预览环境不支持 Web Crypto SHA-256');
    }
    const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => (byte + 0x100).toString(16).slice(1)).join('');
  }
}
