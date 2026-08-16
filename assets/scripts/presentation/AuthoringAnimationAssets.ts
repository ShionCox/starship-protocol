import { AnimationClip, Asset, assetManager, SpriteFrame } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

const authoringSpriteFrames = new Map<string, SpriteFrame>();

declare const EditorExtends: {
  serialize(value: unknown): string;
};

export interface SerializedAnimationClipResult {
  readonly ok: boolean;
  readonly message: string;
  readonly content?: string;
}

/** 仅供 Creator 编辑器把持久 SpriteFrame 组装并序列化为可交给 Asset DB 的 AnimationClip。 */
export async function serializeAuthoringAnimationClip(value: unknown): Promise<SerializedAnimationClipResult> {
  if (!EDITOR_NOT_IN_PREVIEW) return { ok: false, message: '动画剪辑只能在 Creator 编辑器中生成' };
  if (typeof value !== 'object' || value === null) return { ok: false, message: '动画剪辑配置必须是对象' };
  const candidate = value as { readonly name?: unknown; readonly frameRate?: unknown; readonly frameUuids?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const frameRate = typeof candidate.frameRate === 'number' && Number.isInteger(candidate.frameRate) && candidate.frameRate > 0
    ? candidate.frameRate : null;
  const frameUuids = readUuidArray(candidate.frameUuids);
  if (name === '') return { ok: false, message: '动画剪辑名称不能为空' };
  if (frameRate === null) return { ok: false, message: '动画剪辑帧率必须是正整数' };
  if (frameUuids === null || frameUuids.length < 2) return { ok: false, message: '动画剪辑至少需要两个持久 SpriteFrame' };
  try {
    const frames = await loadAuthoringSpriteFrames(frameUuids);
    const clip = AnimationClip.createWithSpriteFrames(frames, frameRate);
    clip.name = name;
    clip.wrapMode = AnimationClip.WrapMode.Loop;
    clip.sample = frameRate;
    return { ok: true, message: `已生成 ${frames.length} 帧动画剪辑`, content: EditorExtends.serialize(clip) };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

export async function loadAuthoringSpriteFrames(uuids: readonly string[]): Promise<SpriteFrame[]> {
  const frames: SpriteFrame[] = [];
  for (const uuid of uuids) {
    const asset = await loadEditorAsset(uuid);
    if (!(asset instanceof SpriteFrame)) throw new Error(`Creator 资源不是 SpriteFrame：${uuid}`);
    frames.push(asset);
  }
  return frames;
}

/** Scene set-property 已让 Creator 加载资源；捕获真实对象供本轮编辑器烘焙复用。 */
export function captureAuthoringSpriteFrame(uuid: string, frame: SpriteFrame): void {
  authoringSpriteFrames.set(uuid, frame);
}

export async function loadAuthoringAnimationClip(uuid: string): Promise<AnimationClip> {
  const asset = await loadEditorAsset(uuid);
  if (!(asset instanceof AnimationClip)) throw new Error(`Creator 资源不是 AnimationClip：${uuid}`);
  return asset;
}

function loadEditorAsset(uuid: string): Promise<Asset> {
  const captured = authoringSpriteFrames.get(uuid) ?? assetManager.assets.get(uuid);
  if (captured instanceof Asset) return Promise.resolve(captured);
  return new Promise((resolve, reject) => {
    assetManager.loadAny(uuid, (cause, asset) => {
      if (cause !== null) reject(cause);
      else if (asset instanceof Asset) resolve(asset);
      else reject(new Error(`Creator 无法加载持久资源：${uuid}`));
    });
  });
}

function readUuidArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const uuids = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  return uuids.length > 0 && uuids.every((uuid) => uuid !== '') ? uuids : null;
}
