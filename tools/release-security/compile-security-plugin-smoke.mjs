import { createCipheriv, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const creatorRoot = process.env.COCOS_CREATOR_ROOT
  ?? 'C:/ProgramData/cocos/editors/Creator/3.8.8';
const cmake = join(creatorRoot, 'resources/tools/cmake/bin/cmake.exe');
const engineRoot = join(creatorRoot, 'resources/resources/3d/engine');
const nativeRoot = join(engineRoot, 'native').replaceAll('\\', '/');
const pluginSource = join(projectRoot, 'native/security-config/src').replaceAll('\\', '/');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'starship-security-plugin-'));

try {
  const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
  const iv = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 1));
  const aad = '{"buildId":"windows-smoke","configVersion":"config-smoke"}';
  const expectedPlaintext = 'native-aes-gcm-ok';
  const expectedSha256 = createHash('sha256').update(expectedPlaintext, 'utf8').digest('hex');
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(expectedPlaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const tamperedTag = Buffer.from(tag);
  tamperedTag[0] ^= 1;
  await writeFile(join(temporaryDirectory, 'crypto_test.cpp'), `
#include <exception>
#include <string>
#include "AesGcm.h"
#include "Sha256.h"

int main() {
    const std::string key = "${key.toString('base64url')}";
    const std::string iv = "${iv.toString('base64url')}";
    const std::string ciphertext = "${ciphertext.toString('base64url')}";
    const std::string aad = R"aad(${aad})aad";
    const auto plaintext = starship::security::decryptAesGcm(
        key, iv, "${tag.toString('base64url')}", ciphertext, aad);
    if (plaintext != "${expectedPlaintext}") return 1;
    if (starship::security::sha256HexUtf8(plaintext) != "${expectedSha256}") return 3;
    try {
        starship::security::decryptAesGcm(
            key, iv, "${tamperedTag.toString('base64url')}", ciphertext, aad);
        return 2;
    } catch (const std::exception&) {
        return 0;
    }
}
`);
  await writeFile(join(temporaryDirectory, 'CMakeLists.txt'), `
cmake_minimum_required(VERSION 3.21)
project(starship_security_smoke LANGUAGES CXX)
include("${nativeRoot}/cmake/predefine.cmake")
set(ENGINE_NAME cocos_engine_headers)
add_library(cocos_engine_headers INTERFACE)
target_include_directories(cocos_engine_headers INTERFACE
  "${nativeRoot}"
  "${nativeRoot}/cocos"
  "${nativeRoot}/cocos/bindings/jswrapper"
  "${nativeRoot}/cocos/renderer"
  "${nativeRoot}/external/win64/include/v8"
  "${nativeRoot}/external/sources"
  "${nativeRoot}/external/windows-specific"
)
add_subdirectory("${pluginSource}" starship-security)
target_compile_definitions(starship_security PRIVATE _USE_MATH_DEFINES)
add_executable(starship_security_crypto_test "${join(temporaryDirectory, 'crypto_test.cpp').replaceAll('\\', '/')}")
target_include_directories(starship_security_crypto_test PRIVATE "${pluginSource}")
target_compile_options(starship_security_crypto_test PRIVATE /utf-8 /EHsc)
target_link_libraries(starship_security_crypto_test PRIVATE starship_security_crypto)
`);
  run(cmake, [
    '-S', temporaryDirectory,
    '-B', join(temporaryDirectory, 'build'),
    '-G', 'Visual Studio 17 2022',
    '-A', 'x64',
  ]);
  run(cmake, ['--build', join(temporaryDirectory, 'build'), '--config', 'Release', '--parallel', '2']);
  run(join(temporaryDirectory, 'build/Release/starship_security_crypto_test.exe'), []);
  console.log('Cocos Native plugin compile and Windows CNG AES-GCM/SHA-256 smoke test passed.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} exited with ${String(result.status)}`);
  }
}
