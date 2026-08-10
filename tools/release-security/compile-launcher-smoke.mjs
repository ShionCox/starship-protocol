import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalJson, signManifest } from './release-security.mjs';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const creatorRoot = process.env.COCOS_CREATOR_ROOT
  ?? 'C:/ProgramData/cocos/editors/Creator/3.8.8';
const cmake = join(creatorRoot, 'resources/tools/cmake/bin/cmake.exe');
const engineRoot = join(creatorRoot, 'resources/resources/3d/engine');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'starship-launcher-build-'));

try {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyFile = join(temporaryDirectory, 'manifest-public.der');
  await writeFile(publicKeyFile, publicKey.export({ type: 'spki', format: 'der' }));
  const signedManifestFile = join(temporaryDirectory, 'release.spmanifest');
  await writeFile(signedManifestFile, `${canonicalJson(signManifest({
    schemaVersion: 1,
    platform: 'windows',
    channel: 'test',
    buildId: 'windows-test-1',
    configVersion: 'config-test-1',
    minimumLauncherVersion: '1.0.0',
    publishedAt: '2026-08-09T00:00:00.000Z',
    launchTicketUrl: 'https://api.example.test/api/v1/client/launch-ticket',
    reinstallUrl: 'https://download.example.test/installer.exe',
    files: [{ path: 'StarshipProtocol.exe', size: 1, sha256: '0'.repeat(64), verification: 'CORE' }],
  }, privateKey.export({ type: 'pkcs8', format: 'pem' })))}\n`);
  run(cmake, [
    '-S', join(projectRoot, 'native/launcher'),
    '-B', join(temporaryDirectory, 'build'),
    '-G', 'Visual Studio 17 2022',
    '-A', 'x64',
    `-DSTARSHIP_MANIFEST_PUBLIC_KEY_DER=${publicKeyFile}`,
    `-DCOCOS_ENGINE_ROOT=${engineRoot}`,
    '-DSTARSHIP_REQUIRE_AUTHENTICODE=OFF',
    '-DSTARSHIP_ENABLE_TEST_COMMANDS=ON',
    '-DSTARSHIP_MANIFEST_URL=https://localhost.invalid/latest.spmanifest',
  ]);
  run(cmake, ['--build', join(temporaryDirectory, 'build'), '--config', 'Release', '--parallel', '2']);
  run(join(temporaryDirectory, 'build/Release/StarshipProtocolLauncher.exe'), [
    '--verify-manifest', signedManifestFile,
  ]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${String(result.status)}`);
}
