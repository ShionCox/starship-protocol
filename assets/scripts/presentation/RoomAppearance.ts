import {
  _decorator,
  Animation,
  AnimationClip,
  Component,
  Enum,
  error,
  Graphics,
  Rect,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
  Vec3,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import {
  captureAuthoringSpriteFrame,
  loadAuthoringAnimationClip,
  loadAuthoringSpriteFrames,
  serializeAuthoringAnimationClip,
  type SerializedAnimationClipResult,
} from './AuthoringAnimationAssets';

const { ccclass, executeInEditMode, menu, property, requireComponent } = _decorator;

/**
 * 房间表现模式的稳定运行时值。Inspector 使用下方中文 Enum 显示，存档/配置只认这些整数。
 * STATIC 不创建动画状态；ALWAYS_LOOP 始终循环；POWERED_LOOP 由供电状态选择通电或断电首帧。
 */
export const ROOM_APPEARANCE_MODE = Object.freeze({
  STATIC: 0,
  ALWAYS_LOOP: 1,
  POWERED_LOOP: 2,
} as const);
export type RoomAppearanceMode = (typeof ROOM_APPEARANCE_MODE)[keyof typeof ROOM_APPEARANCE_MODE];
export type RoomAppearancePivot = 'CENTER' | 'BOTTOM_CENTER';

/** 供 Creator Inspector 使用的中文枚举，不把中文文本写入规则状态。 */
export const RoomAppearanceModeEnum = Enum({
  静态: ROOM_APPEARANCE_MODE.STATIC,
  始终循环: ROOM_APPEARANCE_MODE.ALWAYS_LOOP,
  供电循环: ROOM_APPEARANCE_MODE.POWERED_LOOP,
});

export const ROOM_APPEARANCE_FILTER = Object.freeze({
  NEAREST: 0,
  LINEAR: 1,
} as const);
export type RoomAppearanceFilter = (typeof ROOM_APPEARANCE_FILTER)[keyof typeof ROOM_APPEARANCE_FILTER];

export const RoomAppearanceFilterEnum = Enum({
  最近邻: ROOM_APPEARANCE_FILTER.NEAREST,
  线性: ROOM_APPEARANCE_FILTER.LINEAR,
});

export interface AuthoringResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * 房间外观的编辑器烘焙输入。SpriteFrame/AnimationClip 必须由 Creator 先写入
 * 组件属性或由本方法在编辑器中生成；运行时不会根据这些 DTO 创建任何资源。
 */
export interface RoomAppearanceBakeDto {
  readonly visualId?: unknown;
  readonly mode?: unknown;
  readonly frameRate?: unknown;
  readonly initiallyPowered?: unknown;
  readonly canvasSize?: unknown;
  readonly canvasWidth?: unknown;
  readonly canvasHeight?: unknown;
  readonly displayScalePermille?: unknown;
  readonly gridOffsetX?: unknown;
  readonly gridOffsetY?: unknown;
  readonly pivot?: unknown;
  readonly filter?: unknown;
  readonly frameRects?: unknown;
  readonly frameUuids?: unknown;
  readonly alwaysLoopClipUuid?: unknown;
  readonly poweredClipUuid?: unknown;
  readonly sourceTexture?: Texture2D | null;
  readonly staticFrame?: SpriteFrame | null;
  readonly unpoweredFrame?: SpriteFrame | null;
  readonly poweredFrame?: SpriteFrame | null;
  readonly alwaysLoopFrames?: readonly SpriteFrame[];
  readonly unpoweredFrames?: readonly SpriteFrame[];
  readonly poweredFrames?: readonly SpriteFrame[];
  readonly alwaysLoopClip?: AnimationClip | null;
  readonly poweredClip?: AnimationClip | null;
}

/**
 * 房间 Sprite 原生动画适配器。
 *
 * 所有 Sprite、Animation、SpriteFrame 和 AnimationClip 引用都应由 Creator 持久挂载。
 * 缺少烘焙 SpriteFrame/AnimationClip 时不生成节点或组件，RoomView 原有 Graphics
 * 继续作为安全回退。资源烘焙只由编辑器公开方法完成，运行时只读取已经保存的引用。
 */
@ccclass('RoomAppearance')
@executeInEditMode
@requireComponent(Sprite)
@requireComponent(Animation)
@menu('星舰协议/场景表现/房间外观动画')
export class RoomAppearance extends Component {
  @property({ type: RoomAppearanceModeEnum, displayName: '播放模式', tooltip: '静态、始终循环或根据能源切换的原生 Sprite 动画。', group: '动画' })
  public mode: RoomAppearanceMode = ROOM_APPEARANCE_MODE.STATIC;

  @property({ type: Sprite, displayName: '房间精灵', tooltip: 'Creator 中持久保存的 Sprite 组件；缺少时保留 Graphics 回退。', group: '节点引用' })
  public sprite: Sprite | null = null;

  @property({ type: Animation, displayName: '房间动画', tooltip: 'Creator 中持久保存的 Animation 组件；缺少时只显示首帧。', group: '节点引用' })
  public animation: Animation | null = null;

  @property({ type: Graphics, displayName: '图形回退', tooltip: '没有精灵资源时由 RoomView 绘制的 Graphics；不由运行时创建。', group: '节点引用' })
  public fallbackGraphics: Graphics | null = null;

  @property({ type: SpriteFrame, displayName: '静态首帧', tooltip: '静态模式或断电时使用的持久 SpriteFrame。', group: '首帧' })
  public staticFrame: SpriteFrame | null = null;

  @property({ type: SpriteFrame, displayName: '断电首帧', tooltip: '供电循环断电时停止在此帧；为空时使用通电帧数组首帧。', group: '首帧' })
  public unpoweredFrame: SpriteFrame | null = null;

  @property({ type: SpriteFrame, displayName: '通电首帧', tooltip: '供电循环通电时没有动画组件或帧数组时使用此帧。', group: '首帧' })
  public poweredFrame: SpriteFrame | null = null;

  @property({ type: Texture2D, displayName: '源贴图', tooltip: '编辑器导入的 PSS 原始贴图；仅供 bakeAuthoringVisualAssets 烘焙持久帧，不访问外部素材目录。', group: '帧资源' })
  public sourceTexture: Texture2D | null = null;

  @property({ displayName: '视觉标识', tooltip: '必须与 visuals.csv 中 ROOM 类型的稳定 ID 一致。', group: '帧资源' })
  public visualId = '';

  @property({ displayName: '固定画布宽度', tooltip: '所有烘焙 SpriteFrame 共用的原始画布宽度。', group: '帧资源', min: 1, step: 1 })
  public sourceCanvasWidth = 1;

  @property({ displayName: '固定画布高度', tooltip: '所有烘焙 SpriteFrame 共用的原始画布高度。', group: '帧资源', min: 1, step: 1 })
  public sourceCanvasHeight = 1;

  @property({ type: [Rect], displayName: '源贴图裁切矩形', tooltip: '从源贴图生成原生 SpriteFrame 的裁切区域；矩形由素材 manifest 校验后写入。', group: '帧资源' })
  public sourceFrameRects: Rect[] = [];

  @property({ type: [SpriteFrame], displayName: '始终循环帧', tooltip: '编辑器烘焙写入的持久序列帧；运行时只作首帧回退。', group: '帧资源' })
  public alwaysLoopFrames: SpriteFrame[] = [];

  @property({ type: [SpriteFrame], displayName: '断电帧序列', tooltip: '供电循环断电时只读取其中的首帧，避免断电后继续播放旧动画。', group: '帧资源' })
  public unpoweredFrames: SpriteFrame[] = [];

  @property({ type: [SpriteFrame], displayName: '通电循环帧', tooltip: '编辑器烘焙写入的持久供电序列帧；动画由持久 AnimationClip 驱动。', group: '帧资源' })
  public poweredFrames: SpriteFrame[] = [];

  @property({ type: AnimationClip, displayName: '始终循环剪辑', tooltip: '编辑器烘焙并持久保存的始终循环 AnimationClip。', group: '动画剪辑' })
  public alwaysLoopClip: AnimationClip | null = null;

  @property({ type: AnimationClip, displayName: '通电循环剪辑', tooltip: '编辑器烘焙并持久保存的供电 AnimationClip。', group: '动画剪辑' })
  public poweredClip: AnimationClip | null = null;

  @property({ displayName: '帧率', tooltip: '编辑器烘焙 AnimationClip 使用的帧率，单位为帧/秒。', group: '动画', min: 1, step: 1 })
  public frameRate = 8;

  @property({ type: RoomAppearanceFilterEnum, displayName: '贴图过滤', tooltip: '像素房间通常选择“最近邻”，避免整数缩放时出现模糊。', group: '像素表现' })
  public filter: RoomAppearanceFilter = ROOM_APPEARANCE_FILTER.NEAREST;

  @property({ displayName: '显示缩放千分比', tooltip: '视觉 CSV 的显示缩放，1000 表示原始尺寸。', group: '像素表现', min: 1, max: 10000, step: 1 })
  public displayScalePermille = 1000;

  @property({ displayName: '网格横向偏移', tooltip: '相对房间逻辑网格中心的像素偏移。', group: '像素表现', step: 1 })
  public gridOffsetX = 0;

  @property({ displayName: '网格纵向偏移', tooltip: '相对房间逻辑网格中心的像素偏移。', group: '像素表现', step: 1 })
  public gridOffsetY = 0;

  @property({ displayName: '视觉锚点', tooltip: '视觉 CSV 的锚点语义；房间通常使用中心锚点。', group: '像素表现' })
  public pivot: RoomAppearancePivot = 'CENTER';

  @property({ displayName: '整数缩放', tooltip: '精灵节点的整数像素缩放倍数，禁止小数缩放破坏像素边缘。', group: '像素表现', min: 1, step: 1 })
  public integerScale = 1;

  @property({ displayName: '初始供电', tooltip: '编辑器预览及首次启用时的供电状态；运行时由 RoomView/Bootstrap 注入。', group: '能源表现' })
  public initiallyPowered = false;

  private powered = false;
  private activeAnimationName: string | null = null;
  private missingBakeReported = false;
  private displayWidth = 0;
  private displayHeight = 0;
  private authoringConfigurationResult: AuthoringResult | null = null;
  private authoringClipAssetResult: SerializedAnimationClipResult | null = null;

  protected onEnable(): void {
    this.resolveComponents();
    this.powered = this.initiallyPowered;
    this.applyAppearance();
  }

  protected onDisable(): void {
    this.animation?.stop();
    this.activeAnimationName = null;
  }

  /** 运行时由权威能源快照调用；仅切换 Cocos Animation，不修改 GameCore。 */
  public setPowered(powered: boolean): void {
    this.resolveComponents();
    if (this.powered === powered && !EDITOR_NOT_IN_PREVIEW) return;
    this.powered = powered;
    this.applyAppearance();
  }

  /** 供 RoomView/编辑器扩展显式刷新已持久化的表现引用。 */
  public refreshPreview(): void {
    this.resolveComponents();
    this.applyAppearance();
  }

  /** 图片始终覆盖房间占用的完整逻辑网格；整数缩放只影响采样，不改变最终占地。 */
  public setGridDisplaySize(width: number, height: number): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    this.displayWidth = width;
    this.displayHeight = height;
    this.applyVisualTransform();
    return true;
  }

  /** 只有已经烘焙并持久保存的资源才会关闭 RoomView 的 Graphics 回退。 */
  public hasRenderableVisual(): boolean {
    const mode = normalizeMode(this.mode);
    if (mode === ROOM_APPEARANCE_MODE.STATIC) return this.staticFrame !== null;
    if (mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP) {
      return this.hasPersistentClip('always-loop', this.alwaysLoopClip) || countFrames(this.alwaysLoopFrames) === 1;
    }
    if (this.powered) {
      return this.hasPersistentClip('powered-loop', this.poweredClip) || countFrames(this.poweredFrames) === 1;
    }
    return (this.unpoweredFrame !== null || countFrames(this.unpoweredFrames) > 0) && countFrames(this.poweredFrames) <= 1;
  }

  /**
   * 编辑器烘焙房间视觉资源，并把结果写入 Prefab 可持久化属性。
   *
   * 该方法只允许 Creator 编辑器（非预览）调用。sourceTexture + frameRects 是
   * 编辑器输入；生成后的 SpriteFrame/AnimationClip 会被分配到序列化字段，保存
   * Prefab 后运行时直接消费这些引用。运行时调用会 fail-closed，不会偷偷创建资源。
   */
  public async bakeAuthoringVisualAssets(value: unknown): Promise<AuthoringResult> {
    if (!EDITOR_NOT_IN_PREVIEW) return { ok: false, message: '房间视觉资源只能在 Creator 编辑器中烘焙' };
    if (typeof value !== 'object' || value === null) return { ok: false, message: '房间外观烘焙配置必须是对象' };
    this.resolveComponents();
    if (this.sprite === null || this.animation === null) return { ok: false, message: '房间外观缺少持久 Sprite 或 Animation 组件' };
    const candidate = value as RoomAppearanceBakeDto;
    const sourceTexture = candidate.sourceTexture !== undefined ? candidate.sourceTexture : this.sourceTexture;
    const mode = normalizeModeValue(candidate.mode ?? this.mode);
    if (mode === null) return { ok: false, message: '房间外观播放模式无效' };
    const frameRate = positiveInteger(candidate.frameRate ?? this.frameRate, '房间外观帧率');
    if (frameRate === null) return { ok: false, message: '房间外观帧率必须是正整数' };
    const canvas = readCanvasSize(candidate, this.sourceCanvasWidth, this.sourceCanvasHeight);
    if (canvas === null) return { ok: false, message: '房间固定画布必须是正整数宽高' };
    const rects = parseFrameRects(candidate.frameRects ?? this.sourceFrameRects);
    const hasProvidedFrames = candidate.staticFrame !== undefined
      || (candidate.alwaysLoopFrames?.length ?? 0) > 0
      || (candidate.poweredFrames?.length ?? 0) > 0
      || (candidate.unpoweredFrames?.length ?? 0) > 0
      || this.staticFrame !== null
      || this.alwaysLoopFrames.length > 0
      || this.poweredFrames.length > 0
      || this.unpoweredFrames.length > 0;
    if ((rects === null || rects.length === 0) && !hasProvidedFrames) {
      return { ok: false, message: '房间外观裁切矩形必须使用非负整数坐标和正整数尺寸，或提供持久 SpriteFrame' };
    }
    if (rects !== null && rects.some((rect) => rect.x + rect.width > canvas.width || rect.y + rect.height > canvas.height)) {
      return { ok: false, message: '房间外观裁切矩形超出固定画布边界' };
    }
    const scale = readScale(candidate.displayScalePermille ?? this.displayScalePermille);
    if (scale === null) return { ok: false, message: '房间显示缩放必须是 1 到 10000 的整数' };
    const offsetX = integerValue(candidate.gridOffsetX ?? this.gridOffsetX);
    const offsetY = integerValue(candidate.gridOffsetY ?? this.gridOffsetY);
    if (offsetX === null || offsetY === null) return { ok: false, message: '房间网格偏移必须是整数' };
    const filter = normalizeFilterValue(candidate.filter, this.filter);
    if (filter === null) return { ok: false, message: '房间贴图过滤值无效' };
    const pivot = normalizePivotValue(candidate.pivot, this.pivot);
    if (pivot === null) return { ok: false, message: '房间视觉锚点无效' };
    const initiallyPowered = candidate.initiallyPowered ?? this.initiallyPowered;
    if (typeof initiallyPowered !== 'boolean') return { ok: false, message: '房间初始供电状态无效' };

    let bakedFrames: SpriteFrame[];
    try {
      bakedFrames = await this.resolveBakeFrames(candidate);
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (bakedFrames.length === 0) return { ok: false, message: '房间烘焙缺少 SpriteFrame；请先绑定源贴图或持久帧' };
    this.visualId = typeof candidate.visualId === 'string' ? candidate.visualId.trim() : this.visualId.trim();
    this.sourceTexture = sourceTexture;
    this.mode = mode;
    this.frameRate = frameRate;
    this.initiallyPowered = initiallyPowered;
    this.powered = initiallyPowered;
    this.sourceCanvasWidth = canvas.width;
    this.sourceCanvasHeight = canvas.height;
    this.displayScalePermille = scale;
    this.gridOffsetX = offsetX;
    this.gridOffsetY = offsetY;
    this.filter = filter;
    this.pivot = pivot;
    if (rects !== null) this.sourceFrameRects = rects.map((rect) => new Rect(rect.x, rect.y, rect.width, rect.height));

    const first = bakedFrames[0] ?? null;
    this.staticFrame = candidate.staticFrame ?? (mode === ROOM_APPEARANCE_MODE.STATIC ? first : this.staticFrame ?? first);
    this.unpoweredFrame = candidate.unpoweredFrame ?? this.unpoweredFrame ?? first;
    if (mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP) this.alwaysLoopFrames = candidate.alwaysLoopFrames !== undefined ? [...candidate.alwaysLoopFrames] : bakedFrames;
    if (mode === ROOM_APPEARANCE_MODE.POWERED_LOOP) this.poweredFrames = candidate.poweredFrames !== undefined ? [...candidate.poweredFrames] : bakedFrames;
    this.unpoweredFrames = candidate.unpoweredFrames !== undefined ? [...candidate.unpoweredFrames] : [first];

    try {
      this.alwaysLoopClip = await resolveClip(candidate.alwaysLoopClipUuid, candidate.alwaysLoopClip, this.alwaysLoopClip);
      this.poweredClip = await resolveClip(candidate.poweredClipUuid, candidate.poweredClip, this.poweredClip);
    } catch (cause) {
      return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
    }
    if (this.mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP && bakedFrames.length > 1 && this.alwaysLoopClip === null) {
      return { ok: false, message: '始终循环房间缺少持久 AnimationClip' };
    }
    if (this.mode === ROOM_APPEARANCE_MODE.POWERED_LOOP && bakedFrames.length > 1 && this.poweredClip === null) {
      return { ok: false, message: '供电循环房间缺少持久 AnimationClip' };
    }
    this.resolveComponents();
    this.registerBakedClip(this.alwaysLoopClip, 'always-loop');
    this.registerBakedClip(this.poweredClip, 'powered-loop');
    this.applyAppearance();
    return { ok: true, message: `已烘焙并写入 ${bakedFrames.length} 个房间视觉帧` };
  }

  /** Scene API 不传递 Promise；同步启动编辑器任务，再由扩展轮询结果。 */
  public applyAuthoringPssConfiguration(value: unknown): AuthoringResult {
    this.authoringConfigurationResult = null;
    void this.bakeAuthoringVisualAssets(value).then(
      (result) => { this.authoringConfigurationResult = result; },
      (cause) => { this.authoringConfigurationResult = { ok: false, message: formatAuthoringError(cause) }; },
    );
    return { ok: true, message: '房间外观烘焙已开始' };
  }

  public getAuthoringPssConfigurationResult(): AuthoringResult & { readonly pending: boolean } {
    return this.authoringConfigurationResult === null
      ? { ok: true, pending: true, message: '房间外观烘焙中' }
      : { ...this.authoringConfigurationResult, pending: false };
  }

  public captureAuthoringSpriteFrame(uuid: unknown): AuthoringResult {
    this.resolveComponents();
    if (typeof uuid !== 'string' || uuid.trim() === '') return { ok: false, message: '房间 SpriteFrame UUID 无效' };
    const frame = this.sprite?.spriteFrame;
    if (frame === null || frame === undefined) return { ok: false, message: '房间 SpriteFrame 尚未加载' };
    captureAuthoringSpriteFrame(uuid, frame);
    return { ok: true, message: '已捕获房间 SpriteFrame' };
  }

  /** 供编辑器扩展生成真实 .anim 内容；运行时调用会拒绝。 */
  public createAuthoringAnimationClipAsset(value: unknown): AuthoringResult {
    this.authoringClipAssetResult = null;
    void serializeAuthoringAnimationClip(value).then(
      (result) => { this.authoringClipAssetResult = result; },
      (cause) => { this.authoringClipAssetResult = { ok: false, message: formatAuthoringError(cause) }; },
    );
    return { ok: true, message: '房间动画剪辑生成已开始' };
  }

  public getAuthoringAnimationClipAssetResult(): SerializedAnimationClipResult & { readonly pending: boolean } {
    return this.authoringClipAssetResult === null
      ? { ok: true, pending: true, message: '房间动画剪辑生成中' }
      : { ...this.authoringClipAssetResult, pending: false };
  }

  /** 返回白名单状态，供创作工具显示而不暴露 Cocos 对象。 */
  public getAuthoringInspectorState(): {
    readonly ok: boolean;
    readonly message: string;
    readonly mode: RoomAppearanceMode;
    readonly hasSprite: boolean;
    readonly hasAnimation: boolean;
    readonly frameCount: number;
    readonly powered: boolean;
  } {
    this.resolveComponents();
    const mode = normalizeMode(this.mode);
    const frameCount = this.getCandidateFrames(mode, this.powered).length;
    const hasSprite = this.sprite !== null;
    const hasAnimation = this.animation !== null;
    if (!hasSprite && !hasAnimation) {
      return {
        ok: true,
        message: '未绑定 Sprite/Animation，将使用 RoomView 的 Graphics 回退',
        mode,
        hasSprite,
        hasAnimation,
        frameCount,
        powered: this.powered,
      };
    }
    if (this.integerScale < 1 || !Number.isInteger(this.integerScale)
      || !Number.isInteger(this.displayScalePermille) || this.displayScalePermille < 1 || this.displayScalePermille > 10000) {
      return {
        ok: false,
        message: '整数缩放和显示缩放必须是有效整数',
        mode,
        hasSprite,
        hasAnimation,
        frameCount,
        powered: this.powered,
      };
    }
    return {
      ok: true,
      message: frameCount > 0 || this.staticFrame !== null || this.poweredFrame !== null || this.unpoweredFrame !== null
        ? '房间原生动画引用有效'
        : '未完成视觉烘焙，将使用 Graphics 回退',
      mode,
      hasSprite,
      hasAnimation,
      frameCount,
      powered: this.powered,
    };
  }

  private applyAppearance(): void {
    this.applyVisualTransform();
    this.applyFilter();

    const mode = normalizeMode(this.mode);
    if (mode === ROOM_APPEARANCE_MODE.STATIC) {
      const frame = this.staticFrame
        ?? this.unpoweredFrame
        ?? this.firstFrame(this.alwaysLoopFrames)
        ?? this.firstFrame(this.poweredFrames)
        ?? null;
      if (frame === null) this.reportMissingBake('static');
      this.stopAt(frame);
      return;
    }

    if (mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP) {
      this.playLoop('always-loop', this.alwaysLoopClip, this.alwaysLoopFrames);
      return;
    }

    if (this.powered) {
      this.playLoop('powered-loop', this.poweredClip, this.poweredFrames, this.poweredFrame);
    } else {
      // 断电是明确的首帧状态，不让旧 AnimationState 继续在断电后推进。
      this.stopAt(this.unpoweredFrame
        ?? this.firstFrame(this.unpoweredFrames)
        ?? this.staticFrame
        ?? this.firstFrame(this.poweredFrames));
    }
  }

  private playLoop(name: string, clip: AnimationClip | null, frames: readonly SpriteFrame[], firstFrame?: SpriteFrame | null): void {
    // Creator may keep empty slots in Animation.clips after a prefab is reimported.
    // Treat those slots as missing baked assets instead of dereferencing null.
    const resolvedClip = clip ?? this.animation?.clips.find((entry) => entry !== null && entry.name === name) ?? null;
    if (resolvedClip === null || this.animation === null) {
      this.stopAt(firstFrame ?? this.firstFrame(frames) ?? this.staticFrame);
      this.reportMissingBake(name);
      return;
    }
    const sample = normalizeFrameRate(this.frameRate);
    // Cocos 在动态修改 wrapMode 时会重置时间轴；只在配置真的变化时写入，
    // 避免每次耐久/能源刷新都把循环动画重新跳回第一帧。
    if (resolvedClip.wrapMode !== AnimationClip.WrapMode.Loop) resolvedClip.wrapMode = AnimationClip.WrapMode.Loop;
    if (resolvedClip.sample !== sample) resolvedClip.sample = sample;
    const state = this.animation.getState(name);
    if (state === null || state === undefined) this.animation.addClip(resolvedClip, name);
    else if (!this.animation.clips.some((entry) => entry === resolvedClip)) this.animation.addClip(resolvedClip, name);
    // MainScene 每次刷新都会重新 bind 房间；同一剪辑已经在播放时不能再次 play，
    // 因为 Cocos 的 play() 会把时间轴重置到 0，表现上就会像动画不播放。
    if (this.activeAnimationName !== name) {
      this.animation.play(name);
      this.activeAnimationName = name;
    }
    if (firstFrame !== undefined && firstFrame !== null && this.sprite !== null) this.sprite.spriteFrame = firstFrame;
  }

  private stopAt(frame: SpriteFrame | null): void {
    this.animation?.stop();
    this.activeAnimationName = null;
    if (frame !== null && this.sprite !== null) {
      this.sprite.spriteFrame = frame;
      this.applyFrameFilter(frame);
    }
  }

  private getCandidateFrames(mode: RoomAppearanceMode, powered: boolean): readonly SpriteFrame[] {
    if (mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP) return this.alwaysLoopFrames;
    if (mode === ROOM_APPEARANCE_MODE.POWERED_LOOP) return powered
      ? this.poweredFrames
      : this.unpoweredFrames;
    return this.staticFrame === null ? [] : [this.staticFrame];
  }

  private firstFrame(frames: readonly SpriteFrame[]): SpriteFrame | null {
    return frames.find((frame) => frame !== null) ?? null;
  }

  private applyVisualTransform(): void {
    const target = this.sprite?.node ?? null;
    if (target === null) return;
    const scale = normalizeIntegerScale(this.integerScale) * normalizeDisplayScale(this.displayScalePermille);
    const current = target.scale;
    if (current.x !== scale || current.y !== scale || target.position.x !== this.gridOffsetX || target.position.y !== this.gridOffsetY) {
      target.setScale(new Vec3(scale, scale, current.z));
      target.setPosition(this.gridOffsetX, this.gridOffsetY, current.z);
    }
    const transform = target.getComponent(UITransform);
    if (transform !== null && this.displayWidth > 0 && this.displayHeight > 0) {
      transform.setContentSize(this.displayWidth / scale, this.displayHeight / scale);
      transform.setAnchorPoint(0.5, this.pivot === 'BOTTOM_CENTER' ? 0 : 0.5);
      if (this.sprite !== null) this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    }
  }

  private applyFilter(): void {
    const frames = [
      this.staticFrame,
      this.unpoweredFrame,
      this.poweredFrame,
      ...this.alwaysLoopFrames,
      ...this.unpoweredFrames,
      ...this.poweredFrames,
    ];
    for (const frame of frames) if (frame !== null) this.applyFrameFilter(frame);
  }

  private applyFrameFilter(frame: SpriteFrame): void {
    const texture = frame.texture;
    if (texture === null || typeof texture.setFilters !== 'function') return;
    const filter = this.filter === ROOM_APPEARANCE_FILTER.NEAREST ? Texture2D.Filter.NEAREST : Texture2D.Filter.LINEAR;
    texture.setFilters(filter, filter);
  }

  private resolveComponents(): void {
    this.sprite ??= this.getComponent(Sprite);
    this.animation ??= this.getComponent(Animation);
    this.fallbackGraphics ??= this.getComponent(Graphics);
  }

  private async resolveBakeFrames(candidate: RoomAppearanceBakeDto): Promise<SpriteFrame[]> {
    if (!EDITOR_NOT_IN_PREVIEW) return [];
    const frameUuids = readUuidArray(candidate.frameUuids);
    if (frameUuids !== null) return await loadAuthoringSpriteFrames(frameUuids);
    const configured = [candidate.alwaysLoopFrames, candidate.poweredFrames, candidate.unpoweredFrames,
      this.alwaysLoopFrames, this.poweredFrames, this.unpoweredFrames, this.staticFrame === null ? undefined : [this.staticFrame]]
      .map((frames) => frames?.filter((frame): frame is SpriteFrame => frame !== null) ?? [])
      .find((frames) => frames.length > 0);
    return configured === undefined ? [] : [...configured];
  }

  private reportMissingBake(name: string): void {
    if (this.missingBakeReported || EDITOR_NOT_IN_PREVIEW || this.hasRenderableVisual()) return;
    this.missingBakeReported = true;
    // 运行时缺失烘焙资源必须可观察，但 Graphics 回退仍保留，避免阻断整舰 UI。
    const assetType = name === 'static' ? 'SpriteFrame' : 'AnimationClip';
    error(`[RoomAppearance] 缺少持久 ${name} ${assetType}，已回退到 Graphics/首帧`);
  }

  private hasPersistentClip(name: string, configured: AnimationClip | null): boolean {
    return configured !== null || this.animation?.clips.some((entry) => entry !== null && entry.name === name) === true;
  }

  private registerBakedClip(clip: AnimationClip | null, name: string): void {
    if (clip === null || this.animation === null) return;
    clip.wrapMode = AnimationClip.WrapMode.Loop;
    clip.sample = normalizeFrameRate(this.frameRate);
    if (!this.animation.clips.some((entry) => entry === clip)) this.animation.addClip(clip, name);
  }

}

function normalizeMode(mode: number): RoomAppearanceMode {
  if (mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP) return ROOM_APPEARANCE_MODE.ALWAYS_LOOP;
  if (mode === ROOM_APPEARANCE_MODE.POWERED_LOOP) return ROOM_APPEARANCE_MODE.POWERED_LOOP;
  return ROOM_APPEARANCE_MODE.STATIC;
}

function normalizeFrameRate(frameRate: number): number {
  return Number.isFinite(frameRate) && frameRate > 0 ? Math.max(1, Math.round(frameRate)) : 8;
}

function normalizeIntegerScale(scale: number): number {
  return Number.isFinite(scale) && scale >= 1 ? Math.max(1, Math.round(scale)) : 1;
}

interface AuthoringFrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function normalizeModeValue(mode: unknown): RoomAppearanceMode | null {
  if (typeof mode === 'number') {
    if (mode === ROOM_APPEARANCE_MODE.STATIC || mode === ROOM_APPEARANCE_MODE.ALWAYS_LOOP || mode === ROOM_APPEARANCE_MODE.POWERED_LOOP) return mode;
    return null;
  }
  if (mode === 'STATIC') return ROOM_APPEARANCE_MODE.STATIC;
  if (mode === 'ALWAYS_LOOP') return ROOM_APPEARANCE_MODE.ALWAYS_LOOP;
  if (mode === 'POWERED_LOOP') return ROOM_APPEARANCE_MODE.POWERED_LOOP;
  return null;
}

function positiveInteger(value: unknown, label: string): number | null {
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

function normalizeFilterValue(value: unknown, fallback: RoomAppearanceFilter): RoomAppearanceFilter | null {
  if (value === undefined || value === null) return fallback;
  if (value === ROOM_APPEARANCE_FILTER.NEAREST || value === 'NEAREST') return ROOM_APPEARANCE_FILTER.NEAREST;
  if (value === ROOM_APPEARANCE_FILTER.LINEAR || value === 'LINEAR') return ROOM_APPEARANCE_FILTER.LINEAR;
  return null;
}

function normalizePivotValue(value: unknown, fallback: RoomAppearancePivot): RoomAppearancePivot | null {
  if (value === undefined || value === null) return fallback;
  return value === 'CENTER' || value === 'BOTTOM_CENTER' ? value : null;
}

function readCanvasSize(
  candidate: RoomAppearanceBakeDto,
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
  if (!Array.isArray(value)) throw new Error('房间持久 SpriteFrame UUID 列表无效');
  const uuids = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  if (uuids.length === 0 || uuids.some((uuid) => uuid === '')) throw new Error('房间持久 SpriteFrame UUID 列表无效');
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
  if (typeof uuidValue !== 'string' || uuidValue.trim() === '') throw new Error('房间持久 AnimationClip UUID 无效');
  return await loadAuthoringAnimationClip(uuidValue.trim());
}

function countFrames(frames: readonly SpriteFrame[]): number {
  return frames.filter((frame) => frame !== null).length;
}
