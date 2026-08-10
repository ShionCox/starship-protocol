import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditWindowsNativeRelease,
  stripRoomDefinitionsFromCocosBuild,
} from './release-security.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIRECTORY = resolve(SCRIPT_DIRECTORY, '..', '..');
const DEFAULT_CREATOR = 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe';
const DEFAULT_CMAKE = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/tools/cmake/bin/cmake.exe';

/**
 * 生成一次性 XXTEA 构建密钥。该密钥会进入客户端二进制，只用于提高静态提取成本，
 * 不是服务端权威或配置 AES-GCM 的密钥。
 */
function createBuildKey() {
  return randomBytes(12).toString('base64url');
}

function run(command, args, stdio = 'inherit') {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { stdio, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => resolveResult(code ?? 1));
  });
}

async function redactBuildKey(filePath, key) {
  try {
    const content = await readFile(filePath, 'utf8');
    if (content.includes(key)) {
      await writeFile(filePath, content.split(key).join('[REDACTED]'), 'utf8');
    }
  } catch {
    // 构建日志可能不存在，或正被已打开的 Creator 占用；不影响 staging 审计。
  }
}

async function redactCreatorLogs(key) {
  const builderLogDirectory = join(PROJECT_DIRECTORY, 'temp', 'builder', 'log');
  try {
    const names = await readdir(builderLogDirectory);
    await Promise.all(names
      .filter((name) => /^windows.*\.log$/i.test(name))
      .map((name) => redactBuildKey(join(builderLogDirectory, name), key)));
  } catch {
    // Creator 尚未创建日志目录时无需处理。
  }
  await redactBuildKey(join(PROJECT_DIRECTORY, 'temp', 'logs', 'project.log'), key);
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Windows Native Release 只能在 Windows 构建机执行');
  }

  const creator = process.env.STARSHIP_COCOS_CREATOR_EXE || DEFAULT_CREATOR;
  const cmake = process.env.STARSHIP_COCOS_CMAKE_EXE || DEFAULT_CMAKE;
  const outputRoot = resolve(process.env.STARSHIP_WINDOWS_BUILD_ROOT || join(PROJECT_DIRECTORY, 'build', 'secure'));
  const outputDirectory = join(outputRoot, 'windows');
  const stagingDirectory = join(outputDirectory, 'proj', 'Release');
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'starship-cocos-build-'));
  const configPath = join(temporaryDirectory, 'windows-release.json');
  const xxteaKey = createBuildKey();

  const config = {
    platform: 'windows',
    debug: false,
    buildPath: outputRoot.replaceAll('\\', '/'),
    outputName: 'windows',
    taskName: 'windows',
    buildMode: 'normal',
    sourceMaps: false,
    mainBundleCompressionType: 'merge_dep',
    packages: {
      native: {
        encrypted: true,
        compressZip: true,
        xxteaKey,
        JobSystem: 'none',
      },
      windows: {
        executableName: '',
        renderBackEnd: { vulkan: false, gles3: true, gles2: true },
        targetPlatform: 'x64',
      },
    },
  };

  await mkdir(outputRoot, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { flag: 'wx' });
  try {
    const creatorCode = await run(creator, [
      '--project', PROJECT_DIRECTORY,
      '--build', `configPath=${configPath.replaceAll('\\', '/')};`,
    ], 'ignore');

    // 已打开的 Creator 可能让外层命令返回非零，但 staging 仍会完整生成；最终以产物审计为准。
    const projectInfo = await stat(join(outputDirectory, 'proj'));
    if (!projectInfo.isDirectory()) {
      throw new Error(`Creator 未生成 Windows 工程（退出码 ${creatorCode}）`);
    }

    const strippedDefinitions = await stripRoomDefinitionsFromCocosBuild({
      rootDirectory: join(outputDirectory, 'data'),
      definitionDirectory: join(PROJECT_DIRECTORY, 'assets', 'config', 'rooms'),
    });
    console.log(`[SECURITY] 已从 Native 生成目录移除 ${strippedDefinitions} 份编辑器源房间规则`);

    const cmakeCode = await run(cmake, ['--build', join(outputDirectory, 'proj'), '--config', 'Release', '--parallel', '2']);
    if (cmakeCode !== 0) {
      throw new Error(`CMake Release 编译失败，退出码 ${cmakeCode}`);
    }

    const audit = await auditWindowsNativeRelease({ rootDirectory: stagingDirectory });
    if (!audit.ok) {
      throw new Error(`Windows Native 发行审计失败：${JSON.stringify(audit.failures)}`);
    }
    console.log(`[SECURITY] Windows Native 加密 Release 已生成并通过审计：${stagingDirectory}`);
  } finally {
    await redactCreatorLogs(xxteaKey);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((cause) => {
  console.error(`[SECURITY] ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = 1;
});
