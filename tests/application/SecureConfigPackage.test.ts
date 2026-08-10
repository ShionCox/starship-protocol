import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import test from 'node:test';

import { ConfigRegistry } from '../../assets/scripts/application/ConfigRegistry.ts';
import {
  createSecureConfigAad,
  openSecureConfigPackage,
  type AesGcmDecryptor,
  type AesGcmDecryptRequest,
  type SecureConfigEnvelope,
} from '../../assets/scripts/application/SecureConfigPackage.ts';

const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const IV = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 1));

const nodeDecryptor: AesGcmDecryptor = {
  async decryptAesGcm(request: AesGcmDecryptRequest): Promise<string> {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(request.keyBase64Url, 'base64url'),
      Buffer.from(request.nonceBase64Url, 'base64url'),
      { authTagLength: 16 },
    );
    decipher.setAAD(Buffer.from(request.aadUtf8, 'utf8'));
    decipher.setAuthTag(Buffer.from(request.authTagBase64Url, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(request.ciphertextBase64Url, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  },
};

test('安全配置包认证解密并原子装入房间注册表', async () => {
  const envelope = encryptPayload({
    schemaVersion: 1,
    buildId: 'windows-1',
    configVersion: 'config-1',
    documents: [{
      path: 'rooms/room-reactor.json',
      document: {
        schemaVersion: 1,
        id: 'room-reactor',
        displayName: '反应仓',
        category: 'ENERGY',
        width: 2,
        height: 2,
        maxLevel: 5,
        maxHp: 120,
        minPower: 1,
        maxPower: 4,
        crewCapacity: 2,
      },
    }],
  });
  const payload = await openSecureConfigPackage(
    envelope,
    KEY.toString('base64url'),
    'windows-1',
    'config-1',
    nodeDecryptor,
  );
  const registry = new ConfigRegistry();
  registry.replaceFromSecurePayload(payload);

  assert.equal(registry.buildId, 'windows-1');
  assert.equal(registry.configVersion, 'config-1');
  assert.deepEqual(registry.getRoomDefinition('room-reactor'), {
    id: 'room-reactor',
    displayName: '反应仓',
    category: 'ENERGY',
    width: 2,
    height: 2,
    maxLevel: 5,
    maxHp: 120,
    minPower: 1,
    maxPower: 4,
    crewCapacity: 2,
  });
});

test('Build 或 Config 版本不匹配时在解密前拒绝', async () => {
  const envelope = encryptPayload({
    schemaVersion: 1,
    buildId: 'windows-1',
    configVersion: 'config-1',
    documents: [{ path: 'rooms/room-reactor.json', document: {} }],
  });
  let decryptCalls = 0;
  const countingDecryptor: AesGcmDecryptor = {
    async decryptAesGcm(): Promise<string> {
      decryptCalls += 1;
      return '{}';
    },
  };

  await assert.rejects(
    openSecureConfigPackage(envelope, KEY.toString('base64url'), 'windows-2', 'config-1', countingDecryptor),
    /Build\/Config 版本不一致/,
  );
  assert.equal(decryptCalls, 0);
});

test('密文或认证标签篡改时不产生配置状态', async () => {
  const envelope = encryptPayload({
    schemaVersion: 1,
    buildId: 'windows-1',
    configVersion: 'config-1',
    documents: [{ path: 'rooms/room-reactor.json', document: {} }],
  });
  const tampered = { ...envelope, ciphertext: flipBase64UrlCharacter(envelope.ciphertext) };
  const registry = new ConfigRegistry();

  await assert.rejects(
    openSecureConfigPackage(tampered, KEY.toString('base64url'), 'windows-1', 'config-1', nodeDecryptor),
    /认证解密失败/,
  );
  assert.equal(registry.buildId, null);
  assert.equal(registry.getRoomDefinition('room-reactor'), null);
});

test('文档路径穿越、重复路径和文件名与稳定 ID 不一致会被拒绝', async () => {
  const unsafeEnvelope = encryptPayload({
    schemaVersion: 1,
    buildId: 'windows-1',
    configVersion: 'config-1',
    documents: [{ path: '../room-reactor.json', document: {} }],
  });
  await assert.rejects(
    openSecureConfigPackage(unsafeEnvelope, KEY.toString('base64url'), 'windows-1', 'config-1', nodeDecryptor),
    /路径或内容无效/,
  );

  const validDefinition = {
    schemaVersion: 1,
    id: 'room-reactor',
    displayName: '反应仓',
    category: 'ENERGY',
    width: 2,
    height: 2,
    maxLevel: 5,
    maxHp: 120,
    minPower: 1,
    maxPower: 4,
    crewCapacity: 2,
  };
  const wrongNamePayload = await openSecureConfigPackage(
    encryptPayload({
      schemaVersion: 1,
      buildId: 'windows-1',
      configVersion: 'config-1',
      documents: [{ path: 'rooms/not-reactor.json', document: validDefinition }],
    }),
    KEY.toString('base64url'),
    'windows-1',
    'config-1',
    nodeDecryptor,
  );
  assert.throws(() => new ConfigRegistry().replaceFromSecurePayload(wrongNamePayload), /文件名与稳定 ID 不一致/);
});

function encryptPayload(payload: unknown): SecureConfigEnvelope {
  const base = {
    schemaVersion: 1 as const,
    algorithm: 'AES-256-GCM' as const,
    buildId: 'windows-1',
    configVersion: 'config-1',
    keyId: 'key-1',
  };
  const cipher = createCipheriv('aes-256-gcm', KEY, IV, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(createSecureConfigAad({
    ...base,
    iv: IV.toString('base64url'),
    authTag: 'unused',
    ciphertext: 'unused',
  }), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    ...base,
    iv: IV.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function flipBase64UrlCharacter(value: string): string {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}
