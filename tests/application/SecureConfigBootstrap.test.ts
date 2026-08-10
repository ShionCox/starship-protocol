import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import test from 'node:test';

import { ConfigRegistry } from '../../assets/scripts/application/ConfigRegistry.ts';
import {
  bootstrapSecureConfig,
  parseSecureLaunchContext,
  type SecureConfigHttpResponse,
  type SecureConfigTransport,
} from '../../assets/scripts/application/SecureConfigBootstrap.ts';
import {
  createSecureConfigAad,
  type AesGcmDecryptor,
  type AesGcmDecryptRequest,
  type SecureConfigEnvelope,
} from '../../assets/scripts/application/SecureConfigPackage.ts';

const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const IV = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 1));
const TICKET_URL = 'https://api.example.test/api/v1/client/launch-ticket';
const CONFIG_URL = 'https://cdn.example.test/rules.spcfg';

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

test('安全启动按 Guest、Bootstrap、Hash、解密顺序原子注入 Registry', async () => {
  const envelopeText = createEnvelopeText();
  const transport = new FakeTransport(envelopeText);
  const registry = new ConfigRegistry();
  const result = await bootstrapSecureConfig(createContext(), transport, nodeDecryptor, registry);

  assert.deepEqual(result, { buildId: 'windows-1', configVersion: 'config-1' });
  assert.equal(registry.getRoomDefinition('room-reactor')?.displayName, '反应仓');
  assert.deepEqual(transport.calls.map((call) => [call.method, call.url]), [
    ['POST', 'https://api.example.test/api/v1/auth/guest'],
    ['GET', 'https://api.example.test/api/v1/client/bootstrap'],
    ['GET', CONFIG_URL],
  ]);
  assert.equal(transport.calls[1].headers?.Authorization, 'Bearer ticket.payload.signature');
  assert.equal(transport.calls[1].headers?.['X-Player-Session'], 'session-token');
});

test('下载 Hash 不匹配时不解密也不污染 Registry', async () => {
  const transport = new FakeTransport(createEnvelopeText());
  transport.forcedDigest = '0'.repeat(64);
  let decryptCalls = 0;
  const decryptor: AesGcmDecryptor = {
    async decryptAesGcm(): Promise<string> {
      decryptCalls += 1;
      return '{}';
    },
  };
  const registry = new ConfigRegistry();

  await assert.rejects(
    bootstrapSecureConfig(createContext(), transport, decryptor, registry),
    /SHA-256 校验失败/,
  );
  assert.equal(decryptCalls, 0);
  assert.equal(registry.buildId, null);
});

test('Bootstrap 版本漂移在配置下载前拒绝', async () => {
  const transport = new FakeTransport(createEnvelopeText());
  transport.bootstrapBuildId = 'windows-2';
  const registry = new ConfigRegistry();

  await assert.rejects(
    bootstrapSecureConfig(createContext(), transport, nodeDecryptor, registry),
    /Build\/Config 版本不一致/,
  );
  assert.equal(transport.calls.some((call) => call.url === CONFIG_URL), false);
  assert.equal(registry.buildId, null);
});

test('启动上下文拒绝非 HTTPS、错误路径和缺失 Ticket', () => {
  assert.throws(
    () => parseSecureLaunchContext({ ...createContext(), launchTicketUrl: 'http://api.example.test/api/v1/client/launch-ticket' }),
    /HTTPS/,
  );
  assert.throws(
    () => parseSecureLaunchContext({ ...createContext(), launchTicketUrl: 'https://api.example.test/not-supported' }),
    /HTTPS 地址/,
  );
  assert.throws(
    () => parseSecureLaunchContext({ ...createContext(), launchTicket: '' }),
    /Launch Ticket/,
  );
});

interface RecordedCall {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

class FakeTransport implements SecureConfigTransport {
  public readonly calls: RecordedCall[] = [];
  public forcedDigest: string | null = null;
  public bootstrapBuildId = 'windows-1';
  private readonly envelopeText: string;

  public constructor(envelopeText: string) {
    this.envelopeText = envelopeText;
  }

  public async request(
    method: 'GET' | 'POST',
    url: string,
    headers?: Readonly<Record<string, string>>,
    body?: string,
  ): Promise<SecureConfigHttpResponse> {
    this.calls.push({ method, url, headers, body });
    if (url.endsWith('/api/v1/auth/guest')) {
      return { status: 200, body: JSON.stringify({ sessionToken: 'session-token' }) };
    }
    if (url.endsWith('/api/v1/client/bootstrap')) {
      const envelope = JSON.parse(this.envelopeText) as SecureConfigEnvelope;
      return {
        status: 200,
        body: JSON.stringify({
          buildId: this.bootstrapBuildId,
          configVersion: 'config-1',
          encryptedConfig: {
            formatVersion: 1,
            algorithm: 'AES-256-GCM',
            keyId: envelope.keyId,
            assetUrl: CONFIG_URL,
            sha256: createHash('sha256').update(this.envelopeText, 'utf8').digest('hex'),
            iv: envelope.iv,
          },
          contentKey: KEY.toString('base64url'),
        }),
      };
    }
    if (url === CONFIG_URL) {
      return { status: 200, body: this.envelopeText };
    }
    return { status: 404, body: '{}' };
  }

  public async sha256HexUtf8(value: string): Promise<string> {
    return this.forcedDigest ?? createHash('sha256').update(value, 'utf8').digest('hex');
  }
}

function createContext(): Record<string, string> {
  return {
    buildId: 'windows-1',
    configVersion: 'config-1',
    installId: 'install-test-001',
    launchTicket: 'ticket.payload.signature',
    launchTicketUrl: TICKET_URL,
  };
}

function createEnvelopeText(): string {
  const base = {
    schemaVersion: 1 as const,
    algorithm: 'AES-256-GCM' as const,
    buildId: 'windows-1',
    configVersion: 'config-1',
    keyId: 'key-1',
  };
  const payload = {
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
  };
  const cipher = createCipheriv('aes-256-gcm', KEY, IV, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(createSecureConfigAad({
    ...base,
    iv: IV.toString('base64url'),
    authTag: 'unused',
    ciphertext: 'unused',
  }), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const envelope: SecureConfigEnvelope = {
    ...base,
    iv: IV.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
  return JSON.stringify(envelope);
}
