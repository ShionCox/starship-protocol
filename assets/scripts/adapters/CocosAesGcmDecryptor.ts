import { NATIVE } from 'cc/env';

import type {
  AesGcmDecryptor,
  AesGcmDecryptRequest,
} from '../application/SecureConfigPackage';

export interface NativeSecurityBridge {
  decryptAesGcm(
    keyBase64Url: string,
    nonceBase64Url: string,
    authTagBase64Url: string,
    ciphertextBase64Url: string,
    aadUtf8: string,
  ): string;

  getLaunchContext(): string;

  sha256Utf8(value: string): string;
}

interface NativeSecurityBridgeConstructor {
  new (): NativeSecurityBridge;
}

/** Cocos 平台密码适配：正式 Windows 使用 CNG 原生桥，Web 仅供开发预览。 */
export class CocosAesGcmDecryptor implements AesGcmDecryptor {
  public async decryptAesGcm(request: AesGcmDecryptRequest): Promise<string> {
    if (NATIVE) {
      const bridge = createNativeSecurityBridge();
      const plaintext = bridge.decryptAesGcm(
        request.keyBase64Url,
        request.nonceBase64Url,
        request.authTagBase64Url,
        request.ciphertextBase64Url,
        request.aadUtf8,
      );
      if (plaintext.length === 0) {
        throw new Error('Windows 原生 AES-GCM 认证解密失败');
      }
      return plaintext;
    }

    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle === undefined) {
      throw new Error('当前开发预览环境不支持 Web Crypto');
    }
    const keyBytes = decodeBase64Url(request.keyBase64Url);
    const nonce = decodeBase64Url(request.nonceBase64Url);
    const ciphertext = decodeBase64Url(request.ciphertextBase64Url);
    const authTag = decodeBase64Url(request.authTagBase64Url);
    const authenticatedCiphertext = new Uint8Array(ciphertext.length + authTag.length);
    authenticatedCiphertext.set(ciphertext);
    authenticatedCiphertext.set(authTag, ciphertext.length);

    const key = await cryptoApi.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: new TextEncoder().encode(request.aadUtf8),
        tagLength: 128,
      },
      key,
      authenticatedCiphertext,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  }
}

/** 原生启动上下文、摘要和解密共用同一个公开 Native Plugin 桥。 */
export function createNativeSecurityBridge(): NativeSecurityBridge {
  const constructor = (globalThis as typeof globalThis & {
    StarshipSecurity?: NativeSecurityBridgeConstructor;
  }).StarshipSecurity;
  if (constructor === undefined) {
    throw new Error('Windows 原生安全插件未加载');
  }
  return new constructor();
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const decoded = globalThis.atob(padded);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }
  return output;
}
