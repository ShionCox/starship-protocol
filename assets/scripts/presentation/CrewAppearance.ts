import {
  _decorator,
  Animation,
  AnimationClip,
  Component,
  Enum,
  error,
  Rect,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import {
  captureAuthoringSpriteFrame,
  loadAuthoringAnimationClip,
  loadAuthoringSpriteFrames,
  serializeAuthoringAnimationClip,
  type SerializedAnimationClipResult,
} from './AuthoringAnimationAssets';

const {
  ccclass,
  executeInEditMode,
  menu,
  property,
  requireComponent,
} = _decorator;

export type CrewAppearanceState = 'IDLE' | 'MOVING' | 'TASK';
export type CrewFacing = 'LEFT' | 'RIGHT';
export type CrewAppearancePivot = 'CENTER' | 'BOTTOM_CENTER';

/** 船员外观状态的稳定数值，Inspector 只显示中文，运行时仍使用这些固定值。 */
export const CREW_APPEARANCE_STATE = Object.freeze({
  IDLE: 0,
  MOVING: 1,
  TASK: 2,
} as const);

export const CrewAppearanceStateEnum = Enum({
  待机: CREW_APPEARANCE_STATE.IDLE,
  移动: CREW_APPEARANCE_STATE.MOVING,
  任务: CREW_APPEARANCE_STATE.TASK,
});

/** 像素船员默认使用最近邻，避免原始 SpriteFrame 被平滑采样。 */
export const CREW_APPEARANCE_FILTER = Object.freeze({
  NEAREST: 0,
  LINEAR: 1,
} as const);
export type CrewAppearanceFilter = (typeof CREW_APPEARANCE_FILTER)[keyof typeof CREW_APPEARANCE_FILTER];
export const CrewAppearanceFilterEnum = Enum({
  最近邻: CREW_APPEARANCE_FILTER.NEAREST,
  线性: CREW_APPEARANCE_FILTER.LINEAR,
});

export interface AuthoringResult {
  readonly ok: boolean;
  readonly message: string;
}

/** 船员视觉 CSV 经编辑器烘焙后写入 Prefab 的最小输入 DTO。 */
export interface CrewAppearanceBakeDto {
  readonly visualId?: unknown;
  readonly frameRate?: unknown;
  readonly taskFrameRate?: unknown;
  readonly taskFps?: unknown;
  readonly idleFrameIndex?: unknown;
  readonly canvasSize?: unknown;
  readonly canvasWidth?: unknown;
  readonly canvasHeight?: unknown;
  readonly displayScalePermille?: unknown;
  readonly gridOffsetX?: unknown;
  readonly gridOffsetY?: unknown;
  readonly filter?: unknown;
  readonly pivot?: unknown;
  readonly frameRects?: unknown;
  readonly frameUuids?: unknown;
  readonly idleClipUuid?: unknown;
  readonly movingClipUuid?: unknown;
  readonly taskClipUuid?: unknown;
  readonly sourceTexture?: Texture2D | null;
  readonly idleFrames?: readonly SpriteFrame[];
  readonly movingFrames?: readonly SpriteFrame[];
  readonly taskFrames?: readonly SpriteFrame[];
  readonly idleClip?: AnimationClip | null;
  readonly movingClip?: AnimationClip | null;
  readonly taskClip?: AnimationClip | null;
}

const CLIP_NAMES: Readonly<Record<CrewAppearanceState, string>> = {
  IDLE: 'idle',
  MOVING: 'moving',
  TASK: 'task',
};

/**
 * 船员的原生 2D 外观适配器。
 *
 * Sprite、Animation、SpriteFrame 和 AnimationClip 都由 Prefab 在编辑器中持久引用；
 * 视觉烘焙只发生在公开编辑器方法中，运行时没有贴图时仍保留 CrewView 的 Graphics 表现。
 */
@ccclass('CrewAppearance')
@executeInEditMode
@requireComponent(Sprite)
@requireComponent(Animation)
@menu('星舰协议/场景表现/船员外观')
export class CrewAppearance extends Component {
  @property({ type: Sprite, displayName: '船员精灵', tooltip: '持久保存的船员 Sprite 组件引用。', group: '原生动画' })
  public sprite: Sprite | null = null;

  @property({ type: Animation, displayName: '船员动画', tooltip: '持久保存的船员 Animation 组件引用。', group: '原生动画' })
  public animation: Animation | null = null;

  @property({ type: AnimationClip, displayName: '待机动画剪辑', tooltip: '编辑器烘焙并持久保存的 idle AnimationClip。', group: '原生动画' })
  public idleClip: AnimationClip | null = null;

  @property({ type: AnimationClip, displayName: '移动动画剪辑', tooltip: '编辑器烘焙并持久保存的 moving AnimationClip。', group: '原生动画' })
  public movingClip: AnimationClip | null = null;

  @property({ type: AnimationClip, displayName: '任务动画剪辑', tooltip: '编辑器烘焙并持久保存的 task AnimationClip。', group: '原生动画' })
  public taskClip: AnimationClip | null = null;

  @property({ type: [SpriteFrame], displayName: '待机序列帧', tooltip: '编辑器烘焙写入的 idle 持久序列帧。', group: '序列帧来源' })
  public idleFrames: SpriteFrame[] = [];

  @property({ type: [SpriteFrame], displayName: '移动序列帧', tooltip: '编辑器烘焙写入的 moving 持久序列帧。', group: '序列帧来源' })
  public movingFrames: SpriteFrame[] = [];

  @property({ type: [SpriteFrame], displayName: '任务序列帧', tooltip: '编辑器烘焙写入的 task 持久序列帧。', group: '序列帧来源' })
  public taskFrames: SpriteFrame[] = [];

  @property({ displayName: '固定画布宽度', tooltip: '所有视觉帧共用的原始画布宽度；不会随当前帧改变。', group: '序列帧来源', min: 1, step: 1 })
  public sourceCanvasWidth = 1;

  @property({ displayName: '固定画布高度', tooltip: '所有视觉帧共用的原始画布高度；不会随当前帧改变。', group: '序列帧来源', min: 1, step: 1 })
  public sourceCanvasHeight = 1;

  @property({ type: Texture2D, displayName: '组合角色贴图', tooltip: '编辑器导入的角色贴图；运行时不访问外部素材目录。', group: '序列帧来源' })
  public sourceTexture: Texture2D | null = null;

  @property({ type: [Rect], displayName: '组合角色裁切矩形', tooltip: '从组合角色贴图中读取的显式序列帧矩形；由视觉 CSV 校验后写入。', group: '序列帧来源' })
  public sourceFrameRects: Rect[] = [];

  @property({ displayName: '序列帧帧率', tooltip: '由序列帧生成的 AnimationClip 播放帧率。', group: '序列帧来源', min: 1, max: 30, step: 1 })
  public framesPerSecond = 6;

  @property({ displayName: '任务帧率', tooltip: '施工、维修、治疗等任务状态使用的帧率。', group: '序列帧来源', min: 1, max: 30, step: 1 })
  public taskFrameRate = 4;

  @property({ displayName: '静置帧索引', tooltip: 'IDLE 停止动画后固定显示的视觉帧。', group: '序列帧来源', min: 0, step: 1 })
  public idleFrameIndex = 0;

  @property({ displayName: '视觉标识', tooltip: '必须与 visuals.csv 中 CREW 类型的稳定 ID 一致。', group: '序列帧来源' })
  public visualId = '';

  @property({ displayName: '朝向', tooltip: '左右朝向只翻转 Sprite，不改变船员逻辑坐标。', group: '像素外观' })
  public facing: CrewFacing = 'RIGHT';

  @property({ type: CrewAppearanceFilterEnum, displayName: '贴图过滤', tooltip: '像素船员通常选择“最近邻”，避免整数缩放时出现模糊边缘。', group: '像素外观' })
  public filter: CrewAppearanceFilter = CREW_APPEARANCE_FILTER.NEAREST;

  @property({ displayName: '整数缩放', tooltip: '像素船员使用整数倍缩放，避免放大时出现模糊边缘。', group: '像素外观', min: 1, max: 8, step: 1 })
  public integerScale = 1;

  @property({ displayName: '显示缩放千分比', tooltip: '视觉 CSV 的显示缩放，1000 表示原始尺寸。', group: '像素外观', min: 1, max: 10000, step: 1 })
  public displayScalePermille = 1000;

  @property({ displayName: '网格横向偏移', tooltip: '相对船员脚底锚点的像素偏移。', group: '像素外观', step: 1 })
  public gridOffsetX = 0;

  @property({ displayName: '网格纵向偏移', tooltip: '相对船员脚底锚点的像素偏移。', group: '像素外观', step: 1 })
  public gridOffsetY = 0;

  @property({ displayName: '视觉锚点', tooltip: '视觉 CSV 的锚点语义；船员通常使用脚底中心。', group: '像素外观' })
  public pivot: CrewAppearancePivot = 'BOTTOM_CENTER';

  private registeredClips = new Map<CrewAppearanceState, AnimationClip>();
  private resolved = false;
  private activeState: CrewAppearanceState | null = null;
  private missingBakeReported = false;
  private authoringConfigurationResult: AuthoringResult | null = null;
  private authoringClipAssetResult: SerializedAnimationClipResult | null = null;

  protected onEnable(): void {
    this.resolveComponents();
    this.applyPixelStyle();
    this.playState('IDLE');
  }

  /** 供 CrewView 编辑器预览在属性变化后显式刷新，不在 update 中手工切帧。 */
  public refreshPreview(): void {
    this.activeState = null;
    this.playState('IDLE');
  }

  /** 供 CrewView 决定是否显示 Graphics 回退圆标。 */
  public hasRenderableVisual(): boolean {
    const hasIdle = countFrames(this.idleFrames) >= 1 || this.hasPersistentClip('idle', this.idleClip);
    const hasMoving = countFrames(this.movingFrames) <= 1 || this.hasPersistentClip('moving', this.movingClip);
    const hasTask = countFrames(this.taskFrames) <= 1 || this.hasPersistentClip('task', this.taskClip);
    return hasIdle && hasMoving && hasTask;
  }

  /**
   * 编辑器烘焙船员视觉资源，并把固定画布、缩放和脚底偏移写入 Prefab。
   * 该方法在运行预览或正式客户端中只返回错误，不会动态创建 SpriteFrame/Clip。
   */
  public async bakeAuthoringVisualAssets(value: unknown): Promise<AuthoringResult> {
    if (!EDITOR_NOT_IN_PREVIEW) return { ok: false, message: '船员视觉资源只能在 Creator 编辑器中烘焙' };
    if (typeof value !== 'object' || value === null) return { ok: false, message: '船员外观烘焙配置必须是对象' };
    this.resolveComponents();
    if (this.sprite === null || this.animation === null) return { ok: false, message: '船员外观缺少持久 Sprite 或 Animation 组件' };
    const candidate = value as CrewAppearanceBakeDto;
    const sourceTexture = candidate.sourceTexture !== undefined ? candidate.sourceTexture : this.sourceTexture;
    const fps = positiveInteger(candidate.frameRate ?? this.framesPerSecond);
    const taskFps = positiveInteger(candidate.taskFrameRate ?? candidate.taskFps ?? this.taskFrameRate);
    if (fps === null || taskFps === null) return { ok: false, message: '船员外观帧率必须是正整数' };
    const rects = parseFrameRects(candidate.frameRects ?? this.sourceFrameRects);
    const hasProvidedFrames = (candidate.idleFrames?.length ?? 0) > 0
      || (candidate.movingFrames?.length ?? 0) > 0
      || (candidate.taskFrames?.length ?? 0) > 0
      || this.idleFrames.length > 0
      || this.movingFrames.length > 0
      || this.taskFrames.length > 0;
    if ((rects === null || rects.length < 1) && !hasProvidedFrames) {
      return { ok: false, message: '船员外观裁切矩形必须是非负整数，或提供持久 SpriteFrame' };
    }
    const canvas = readCanvasSize(candidate, this.sourceCanvasWidth, this.sourceCanvasHeight);
    if (canvas === null) return { ok: false, message: '船员固定画布必须是正整数宽高' };
    if (rects !== null && rects.some((rect) => rect.x + rect.width > canvas.width || rect.y + rect.height > canvas.height)) {
      return { ok: false, message: '船员外观裁切矩形超出固定画布边界' };
    }
    const scale = readScale(candidate.displayScalePermille ?? this.displayScalePermille);
    const offsetX = integerValue(candidate.gridOffsetX ?? this.gridOffsetX);
    const offsetY = integerValue(candidate.gridOffsetY ?? this.gridOffsetY);
    if (scale === null) return { ok: false, message: '船员显示缩放必须是 1 到 10000 的整数' };
    if (offsetX === null || offsetY === null) return { ok: false, message: '船员网格偏移必须是整数' };
    const filter = normalizeFilterValue(candidate.filter, this.filter);
    if (filter === null) return { ok: false, message: '船员贴图过滤值无效' };
    const pivot = normalizePivotValue(candidate.pivot, this.pivot);
    if (pivot === null) return { ok: false, message: '船员视觉锚点无效' };

    let bakedFrames: SpriteFrame[];
    try {
      bakedFrames = await this.resolveBakeFrames(candidate);
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (bakedFrames.length === 0) return { ok: false, message: '船员烘焙缺少 SpriteFrame；请先绑定源贴图或持久帧' };
    this.visualId = typeof candidate.visualId === 'string' ? candidate.visualId.trim() : this.visualId.trim();
    this.sourceTexture = sourceTexture;
    this.framesPerSecond = fps;
    this.taskFrameRate = taskFps;
    this.idleFrameIndex = Number.isInteger(candidate.idleFrameIndex) && (candidate.idleFrameIndex as number) >= 0
      ? candidate.idleFrameIndex as number : this.idleFrameIndex;
    this.sourceCanvasWidth = canvas.width;
    this.sourceCanvasHeight = canvas.height;
    this.displayScalePermille = scale;
    this.gridOffsetX = offsetX;
    this.gridOffsetY = offsetY;
    this.filter = filter;
    this.pivot = pivot;
    if (rects !== null) this.sourceFrameRects = rects.map((rect) => new Rect(rect.x, rect.y, rect.width, rect.height));
    this.idleFrames = candidate.idleFrames !== undefined ? [...candidate.idleFrames] : bakedFrames;
    this.movingFrames = candidate.movingFrames !== undefined ? [...candidate.movingFrames] : bakedFrames;
    this.taskFrames = candidate.taskFrames !== undefined ? [...candidate.taskFrames] : bakedFrames;
    try {
      this.idleClip = await resolveClip(candidate.idleClipUuid, candidate.idleClip, this.idleClip);
      this.movingClip = await resolveClip(candidate.movingClipUuid, candidate.movingClip, this.movingClip);
      this.taskClip = await resolveClip(candidate.taskClipUuid, candidate.taskClip, this.taskClip);
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (bakedFrames.length > 1 && (this.idleClip === null || this.movingClip === null || this.taskClip === null)) {
      return { ok: false, message: '船员三种状态必须绑定持久 AnimationClip' };
    }
    this.resolveComponents();
    this.registerBakedClip(this.idleClip, 'idle', fps);
    this.registerBakedClip(this.movingClip, 'moving', fps);
    this.registerBakedClip(this.taskClip, 'task', taskFps);

    this.registeredClips.clear();
    this.activeState = null;
    this.refreshPreview();
    return { ok: true, message: `已烘焙并写入 ${bakedFrames.length} 个船员视觉帧` };
  }

  /** Scene API 不传递 Promise；同步启动编辑器任务，再由扩展轮询结果。 */
  public applyAuthoringPssConfiguration(value: unknown): AuthoringResult {
    this.authoringConfigurationResult = null;
    void this.bakeAuthoringVisualAssets(value).then(
      (result) => { this.authoringConfigurationResult = result; },
      (cause) => { this.authoringConfigurationResult = { ok: false, message: formatAuthoringError(cause) }; },
    );
    return { ok: true, message: '船员外观烘焙已开始' };
  }

  public getAuthoringPssConfigurationResult(): AuthoringResult & { readonly pending: boolean } {
    return this.authoringConfigurationResult === null
      ? { ok: true, pending: true, message: '船员外观烘焙中' }
      : { ...this.authoringConfigurationResult, pending: false };
  }

  public captureAuthoringSpriteFrame(uuid: unknown): AuthoringResult {
    this.resolveComponents();
    if (typeof uuid !== 'string' || uuid.trim() === '') return { ok: false, message: '船员 SpriteFrame UUID 无效' };
    const frame = this.sprite?.spriteFrame;
    if (frame === null || frame === undefined) return { ok: false, message: '船员 SpriteFrame 尚未加载' };
    captureAuthoringSpriteFrame(uuid, frame);
    return { ok: true, message: '已捕获船员 SpriteFrame' };
  }

  /** 供编辑器扩展生成真实 .anim 内容；运行时调用会拒绝。 */
  public createAuthoringAnimationClipAsset(value: unknown): AuthoringResult {
    this.authoringClipAssetResult = null;
    void serializeAuthoringAnimationClip(value).then(
      (result) => { this.authoringClipAssetResult = result; },
      (cause) => { this.authoringClipAssetResult = { ok: false, message: formatAuthoringError(cause) }; },
    );
    return { ok: true, message: '船员动画剪辑生成已开始' };
  }

  public getAuthoringAnimationClipAssetResult(): SerializedAnimationClipResult & { readonly pending: boolean } {
    return this.authoringClipAssetResult === null
      ? { ok: true, pending: true, message: '船员动画剪辑生成中' }
      : { ...this.authoringClipAssetResult, pending: false };
  }

  protected onDisable(): void {
    this.animation?.stop();
    this.activeState = null;
  }

  /** 播放一个已经由 Creator 持久绑定的原生动画状态。 */
  public playState(state: CrewAppearanceState): void {
    this.resolveComponents();
    if (this.activeState === state) {
      this.applyPixelStyle();
      return;
    }
    // 静置只显示统一画布的第 0 帧，不能循环动作帧造成角色轮廓忽大忽小。
    if (state === 'IDLE' && this.sprite !== null) {
      const idleFrames = this.getFrames('IDLE');
      if (idleFrames.length === 0) {
        const idleClip = this.ensureClip('IDLE');
        if (idleClip !== null && this.animation !== null) {
          this.sprite.enabled = true;
          this.applyPixelStyle();
          idleClip.wrapMode = AnimationClip.WrapMode.Loop;
          this.animation.play(CLIP_NAMES.IDLE);
          this.activeState = state;
          return;
        }
      }
      const firstFrame = idleFrames[this.idleFrameIndex] ?? idleFrames[0] ?? this.sprite.spriteFrame;
      this.animation?.stop();
      if (firstFrame !== null) {
        this.applyFrameFilter(firstFrame);
        this.sprite.spriteFrame = firstFrame;
        this.sprite.enabled = true;
      } else {
        this.reportMissingBake('IDLE');
        this.sprite.enabled = false;
      }
      this.applyPixelStyle();
      this.activeState = state;
      return;
    }
    const clip = this.ensureClip(state);
    if (clip !== null && this.animation !== null && this.sprite !== null) {
      this.sprite.enabled = true;
      this.applyPixelStyle();
      clip.wrapMode = AnimationClip.WrapMode.Loop;
      this.animation.play(CLIP_NAMES[state]);
      this.activeState = state;
      return;
    }

    this.reportMissingBake(state);
    this.animation?.stop();
    if (this.sprite !== null) this.sprite.enabled = false;
    this.activeState = state;
  }

  /** 设置左右朝向；翻转只作用于“船员精灵”节点，名称和选框保持正向。 */
  public setFacing(facing: CrewFacing): void {
    this.facing = facing;
    this.applyPixelStyle();
  }

  /** 根据移动边的水平方向翻转 Sprite；垂直移动不会打断原有朝向。 */
  public setFacingByDelta(deltaX: number): void {
    if (deltaX < -0.001) this.setFacing('LEFT');
    else if (deltaX > 0.001) this.setFacing('RIGHT');
  }

  private resolveComponents(): void {
    if (this.resolved) return;
    this.sprite ??= this.getComponent(Sprite);
    this.animation ??= this.getComponent(Animation);
    this.resolved = true;
  }

  private ensureClip(state: CrewAppearanceState): AnimationClip | null {
    const configured = this.getConfiguredClip(state);
    const registered = this.registeredClips.get(state);
    if (registered !== undefined) return registered;
    const persistent = configured ?? this.animation?.clips.find((entry) => entry !== null && entry.name === CLIP_NAMES[state]) ?? null;
    if (persistent === null || this.animation === null) return null;
    if (!this.animation.clips.some((entry) => entry === persistent)) this.animation.addClip(persistent, CLIP_NAMES[state]);
    this.registeredClips.set(state, persistent);
    return persistent;
  }

  private getConfiguredClip(state: CrewAppearanceState): AnimationClip | null {
    if (state === 'IDLE') return this.idleClip;
    if (state === 'MOVING') return this.movingClip;
    return this.taskClip;
  }

  private getFrames(state: CrewAppearanceState): SpriteFrame[] {
    const configured = state === 'IDLE' ? this.idleFrames : state === 'MOVING' ? this.movingFrames : this.taskFrames;
    return configured.filter((frame): frame is SpriteFrame => frame !== null);
  }

  private applyPixelStyle(): void {
    const sprite = this.sprite;
    const frame = sprite?.spriteFrame;
    if (frame !== undefined && frame !== null) this.applyFrameFilter(frame);
    const target = sprite?.node ?? null;
    if (target === null) return;
    if (sprite !== null) sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const transform = target.getComponent(UITransform);
    if (transform !== null) transform.setAnchorPoint(0.5, this.pivot === 'BOTTOM_CENTER' ? 0 : 0.5);
    const scale = Math.max(1, Math.round(Number(this.integerScale) || 1)) * normalizeDisplayScale(this.displayScalePermille);
    target.setScale(this.facing === 'LEFT' ? -scale : scale, scale, target.scale.z);
    target.setPosition(this.gridOffsetX, this.gridOffsetY, target.position.z);
  }

  private applyFrameFilter(frame: SpriteFrame): void {
    const texture = frame.texture;
    if (texture === null || typeof texture.setFilters !== 'function') return;
    const filter = this.filter === CREW_APPEARANCE_FILTER.NEAREST ? Texture2D.Filter.NEAREST : Texture2D.Filter.LINEAR;
    texture.setFilters(filter, filter);
  }

  private reportMissingBake(state: CrewAppearanceState): void {
    if (this.missingBakeReported || EDITOR_NOT_IN_PREVIEW) return;
    this.missingBakeReported = true;
    error(`[CrewAppearance] 缺少持久 ${state} AnimationClip，已交由 CrewView 显示 Graphics 回退`);
  }

  private hasPersistentClip(name: string, configured: AnimationClip | null): boolean {
    return configured !== null || this.animation?.clips.some((entry) => entry !== null && entry.name === name) === true;
  }

  private registerBakedClip(clip: AnimationClip | null, name: string, fps: number): void {
    if (clip === null || this.animation === null) return;
    clip.wrapMode = AnimationClip.WrapMode.Loop;
    clip.sample = Math.max(1, Math.round(fps));
    if (!this.animation.clips.some((entry) => entry === clip)) this.animation.addClip(clip, name);
  }

  private async resolveBakeFrames(candidate: CrewAppearanceBakeDto): Promise<SpriteFrame[]> {
    if (!EDITOR_NOT_IN_PREVIEW) return [];
    const frameUuids = readUuidArray(candidate.frameUuids);
    if (frameUuids !== null) return await loadAuthoringSpriteFrames(frameUuids);
    const configured = [candidate.idleFrames, candidate.movingFrames, candidate.taskFrames,
      this.idleFrames, this.movingFrames, this.taskFrames]
      .map((frames) => frames?.filter((frame): frame is SpriteFrame => frame !== null) ?? [])
      .find((frames) => frames.length > 0);
    return configured === undefined ? [] : [...configured];
  }

}

interface AuthoringFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : null;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function readScale(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10000 ? value as number : null;
}

function normalizeDisplayScale(value: number): number {
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value / 1000 : 1;
}

function normalizeFilterValue(value: unknown, fallback: CrewAppearanceFilter): CrewAppearanceFilter | null {
  if (value === undefined || value === null) return fallback;
  if (value === CREW_APPEARANCE_FILTER.NEAREST || value === 'NEAREST') return CREW_APPEARANCE_FILTER.NEAREST;
  if (value === CREW_APPEARANCE_FILTER.LINEAR || value === 'LINEAR') return CREW_APPEARANCE_FILTER.LINEAR;
  return null;
}

function normalizePivotValue(value: unknown, fallback: CrewAppearancePivot): CrewAppearancePivot | null {
  if (value === undefined || value === null) return fallback;
  return value === 'CENTER' || value === 'BOTTOM_CENTER' ? value : null;
}

function readCanvasSize(
  candidate: CrewAppearanceBakeDto,
  fallbackWidth: number,
  fallbackHeight: number,
): { readonly width: number; readonly height: number } | null {
  const canvas = candidate.canvasSize;
  let width: unknown = candidate.canvasWidth ?? fallbackWidth;
  let height: unknown = candidate.canvasHeight ?? fallbackHeight;
  if (canvas === undefined && (candidate.canvasWidth === undefined) !== (candidate.canvasHeight === undefined)) return null;
  if (canvas !== undefined) {
    if (typeof canvas !== 'object' || canvas === null) return null;
    const source = canvas as Record<string, unknown>;
    width = source.width;
    height = source.height;
  }
  return Number.isInteger(width) && Number.isInteger(height) && (width as number) > 0 && (height as number) > 0
    ? { width: width as number, height: height as number }
    : null;
}

function parseFrameRects(value: unknown): AuthoringFrameRect[] | null {
  if (!Array.isArray(value)) return null;
  const result: AuthoringFrameRect[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const rect = entry as Record<string, unknown>;
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
      || (rect.x as number) < 0 || (rect.y as number) < 0
      || (rect.width as number) <= 0 || (rect.height as number) <= 0) return null;
    result.push({ x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number });
  }
  return result;
}

function readUuidArray(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error('船员持久 SpriteFrame UUID 列表无效');
  const uuids = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  if (uuids.length === 0 || uuids.some((uuid) => uuid === '')) throw new Error('船员持久 SpriteFrame UUID 列表无效');
  return uuids;
}

function formatAuthoringError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function resolveClip(
  uuidValue: unknown,
  configured: AnimationClip | null | undefined,
  fallback: AnimationClip | null,
): Promise<AnimationClip | null> {
  if (uuidValue === undefined) return configured === undefined ? fallback : configured;
  if (typeof uuidValue !== 'string' || uuidValue.trim() === '') throw new Error('船员持久 AnimationClip UUID 无效');
  return await loadAuthoringAnimationClip(uuidValue.trim());
}

function countFrames(frames: readonly SpriteFrame[]): number {
  return frames.filter((frame) => frame !== null).length;
}
