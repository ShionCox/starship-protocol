import type { AssetDbPort, AssetInfo } from '../shared/editor-asset-db';
import type { SceneComponentTarget, SceneQueryPort } from '../shared/editor-scene';

export interface VisualFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface AtlasAssetInfo extends AssetInfo {
  readonly subAssets?: Readonly<Record<string, AssetInfo>>;
}

/** 使用 Creator 原生 SpriteAtlas 导入器，把视觉 CSV 的裁切矩形变为可寻址 SpriteFrame。 */
export async function ensureVisualFrameAssets(
  assetDb: AssetDbPort,
  visualId: string,
  textureUrl: string,
  canvasWidth: number,
  canvasHeight: number,
  frames: readonly VisualFrameRect[],
): Promise<readonly string[]> {
  if (!textureUrl.endsWith('.png')) throw new Error(`视觉贴图必须是 PNG：${textureUrl}`);
  const atlasUrl = textureUrl.replace(/\.png$/i, '.plist');
  const textureFileName = textureUrl.split('/').at(-1) as string;
  const frameNames = frames.map((_, index) => `${visualId}-frame-${String(index).padStart(3, '0')}.png`);
  await writeTextAsset(assetDb, atlasUrl, createAtlasPlist(textureFileName, canvasWidth, canvasHeight, frameNames, frames));

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const info = await assetDb.queryInfo(atlasUrl) as AtlasAssetInfo | null;
    const spriteFrames = Object.values(info?.subAssets ?? {}).filter((entry) => entry.type === 'cc.SpriteFrame');
    const byName = new Map(spriteFrames.map((entry) => [stripPng(entry.name ?? entry.displayName ?? ''), entry.uuid]));
    const resolved = frameNames.map((name) => byName.get(stripPng(name)) ?? '');
    if (resolved.every((uuid) => uuid !== '')) return resolved;
    if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${atlasUrl} 未生成完整 SpriteFrame 子资源`);
}

/** 由 Creator 场景进程创建 Clip 内容，再通过公开 Asset DB 保存为真实 .anim 资产。 */
export async function ensureAnimationClipAsset(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  appearanceUuid: string,
  url: string,
  name: string,
  frameRate: number,
  frameUuids: readonly string[],
): Promise<string> {
  const started = await scene.executeComponentMethod(appearanceUuid, 'createAuthoringAnimationClipAsset', [{
    name,
    frameRate,
    frameUuids,
  }]) as AuthoringMethodResult | null;
  const generated = typeof started?.content === 'string'
    ? started
    : await waitForAuthoringMethod(scene, appearanceUuid, 'getAuthoringAnimationClipAssetResult', `动画剪辑 ${name}`);
  if (generated.ok !== true || typeof generated.content !== 'string') throw new Error(readMethodError(generated, `无法生成动画剪辑：${name}`));
  return await writeTextAsset(assetDb, url, generated.content);
}

/** 通过 Creator Scene 单引用属性加载 SpriteFrame，再同步捕获给编辑器烘焙任务。 */
export async function primeAuthoringSpriteFrames(
  scene: SceneQueryPort,
  sprite: SceneComponentTarget,
  appearanceUuid: string,
  frameUuids: readonly string[],
  label: string,
): Promise<void> {
  for (const uuid of frameUuids) {
    if (!(await scene.setProperty(sprite, 'spriteFrame', { type: 'cc.SpriteFrame', uuid }, { record: false }))) {
      throw new Error(`${label}无法加载 SpriteFrame：${uuid}`);
    }
    let captured = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await scene.executeComponentMethod(appearanceUuid, 'captureAuthoringSpriteFrame', [uuid]) as AuthoringMethodResult | null;
      if (result?.ok === true) { captured = true; break; }
      if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!captured) throw new Error(`${label}无法捕获 SpriteFrame：${uuid}`);
  }
}

export async function waitForAuthoringConfiguration(
  scene: SceneQueryPort,
  appearanceUuid: string,
  started: unknown,
  label: string,
): Promise<void> {
  const start = started as AuthoringMethodResult | null;
  if (start?.ok !== true) throw new Error(readMethodError(start, `${label}无法启动`));
  const completed = await waitForAuthoringMethod(scene, appearanceUuid, 'getAuthoringPssConfigurationResult', label);
  if (completed.ok !== true) throw new Error(readMethodError(completed, `${label}失败`));
}

interface AuthoringMethodResult {
  readonly ok?: unknown;
  readonly pending?: unknown;
  readonly message?: unknown;
  readonly content?: unknown;
}

async function waitForAuthoringMethod(
  scene: SceneQueryPort,
  appearanceUuid: string,
  method: string,
  label: string,
): Promise<AuthoringMethodResult> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await scene.executeComponentMethod(appearanceUuid, method, []) as AuthoringMethodResult | null;
    if (result !== null && result.pending !== true) return result;
    if (attempt < 99) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}超时`);
}

function readMethodError(result: AuthoringMethodResult | null, fallback: string): string {
  return typeof result?.message === 'string' && result.message !== '' ? result.message : fallback;
}

async function writeTextAsset(assetDb: AssetDbPort, url: string, content: string): Promise<string> {
  const existed = await assetDb.queryUuid(url);
  const saved = existed === '' ? await assetDb.createAsset(url, content) : await assetDb.saveAsset(url, content);
  if (saved === null) throw new Error(`Creator Asset DB 无法保存资源：${url}`);
  await assetDb.reimportAsset?.(url);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const uuid = await assetDb.queryUuid(url);
    if (uuid !== '') return uuid;
    if (attempt < 29) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Creator Asset DB 未完成资源导入：${url}`);
}

export function createAtlasPlist(
  textureFileName: string,
  width: number,
  height: number,
  frameNames: readonly string[],
  frames: readonly VisualFrameRect[],
): string {
  if (frameNames.length !== frames.length || frames.length === 0) throw new Error('SpriteAtlas 帧名称与裁切矩形数量不一致');
  if (!textureFileName.endsWith('.png')) throw new Error('SpriteAtlas 贴图文件名必须是 PNG');
  const entries = frames.map((frame, index) => `
      <key>${escapeXml(frameNames[index] as string)}</key>
      <dict>
        <key>frame</key><string>{{${frame.x},${frame.y}},{${frame.width},${frame.height}}}</string>
        <key>offset</key><string>{0,0}</string>
        <key>rotated</key><false/>
        <key>sourceColorRect</key><string>{{0,0},{${frame.width},${frame.height}}}</string>
        <key>sourceSize</key><string>{${frame.width},${frame.height}}</string>
      </dict>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>frames</key>
  <dict>${entries}
  </dict>
  <key>metadata</key>
  <dict>
    <key>format</key><integer>2</integer>
    <key>realTextureFileName</key><string>${escapeXml(textureFileName)}</string>
    <key>size</key><string>{${width},${height}}</string>
    <key>textureFileName</key><string>${escapeXml(textureFileName)}</string>
  </dict>
</dict>
</plist>
`;
}

function stripPng(value: string): string {
  return value.replace(/\.png$/i, '');
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
