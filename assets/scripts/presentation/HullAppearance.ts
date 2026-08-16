import {
  _decorator,
  Color,
  Component,
  Enum,
  error,
  Graphics,
  Rect,
  Size,
  Sprite,
  SpriteFrame,
  Texture2D,
  UITransform,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

const { ccclass, executeInEditMode, menu, property, requireComponent } = _decorator;

export const HullAppearanceFilterEnum = Enum({ 最近邻: 0, 线性: 1 });
export type HullAppearanceFilter = 0 | 1;
export type HullAppearancePivot = 'CENTER' | 'BOTTOM_CENTER';

export interface AuthoringResult {
  readonly ok: boolean;
  readonly message: string;
}

/** 船体静态视觉 CSV 由编辑器烘焙为一个持久 SpriteFrame 后写入的最小 DTO。 */
export interface HullAppearanceBakeDto {
  readonly visualId?: unknown;
  readonly frame?: unknown;
  readonly canvasSize?: unknown;
  readonly canvasWidth?: unknown;
  readonly canvasHeight?: unknown;
  readonly displayScalePermille?: unknown;
  readonly gridOffsetX?: unknown;
  readonly gridOffsetY?: unknown;
  readonly filter?: unknown;
  readonly sourceTexture?: Texture2D | null;
  readonly pivot?: unknown;
  readonly staticFrame?: SpriteFrame | null;
}

/**
 * 船体静态外观。贴图和裁切由 Creator 创作工具从视觉 CSV 持久绑定；
 * 运行时只按 HullDefinition.visualId 切换已有 SpriteFrame，不访问 Asset DB 或外部 PSS 目录。
 */
@ccclass('HullAppearance')
@executeInEditMode
@requireComponent(Sprite)
@menu('星舰协议/场景表现/船体外观')
export class HullAppearance extends Component {
  @property({ displayName: '视觉标识', tooltip: '必须与 visuals.csv 中 HULL 类型的稳定 ID 一致。', group: '视觉配置' })
  public visualId = '';

  @property({ type: Sprite, displayName: '船体精灵', tooltip: 'Creator 持久保存的船体 Sprite。', group: '节点引用' })
  public sprite: Sprite | null = null;

  @property({ type: Graphics, displayName: '图形回退', tooltip: '没有持久 SpriteFrame 时保留的 Graphics 回退；不由运行时创建。', group: '节点引用' })
  public fallbackGraphics: Graphics | null = null;

  @property({ type: SpriteFrame, displayName: '持久船体帧', tooltip: '编辑器烘焙并保存的静态 SpriteFrame；运行时只读取此引用。', group: '视觉配置' })
  public staticFrame: SpriteFrame | null = null;

  @property({ type: Texture2D, displayName: '源贴图', tooltip: '编辑器导入的船体贴图，仅供视觉烘焙使用。', group: '视觉配置' })
  public sourceTexture: Texture2D | null = null;

  @property({ displayName: '裁切矩形', tooltip: '来自 visual-frames.csv 的第 0 帧矩形。', group: '视觉配置' })
  public sourceFrameRect = new Rect(0, 0, 1, 1);

  @property({ displayName: '固定画布宽度', tooltip: '烘焙 SpriteFrame 的原始画布宽度。', group: '视觉配置', min: 1, step: 1 })
  public sourceCanvasWidth = 1;

  @property({ displayName: '固定画布高度', tooltip: '烘焙 SpriteFrame 的原始画布高度。', group: '视觉配置', min: 1, step: 1 })
  public sourceCanvasHeight = 1;

  @property({ displayName: '显示缩放千分比', tooltip: '视觉 CSV 的显示缩放，1000 表示原始尺寸。', group: '视觉配置', min: 1, max: 10000, step: 1 })
  public displayScalePermille = 1000;

  @property({ displayName: '网格横向偏移', tooltip: '相对船体逻辑网格中心的像素偏移。', group: '视觉配置', step: 1 })
  public gridOffsetX = 0;

  @property({ displayName: '网格纵向偏移', tooltip: '相对船体逻辑网格中心的像素偏移。', group: '视觉配置', step: 1 })
  public gridOffsetY = 0;

  @property({ type: HullAppearanceFilterEnum, displayName: '贴图过滤', tooltip: '像素船体通常选择“最近邻”，避免整数缩放时出现模糊。', group: '视觉配置' })
  public filter: HullAppearanceFilter = 0;

  @property({ displayName: '视觉锚点', tooltip: '视觉 CSV 的锚点语义；船体通常使用中心锚点。', group: '视觉配置' })
  public pivot: HullAppearancePivot = 'CENTER';

  private missingBakeReported = false;

  protected onEnable(): void {
    this.refreshPreview();
  }

  /** ShipView 以权威 visualId 选择当前外观，并把图片固定铺到逻辑网格尺寸。 */
  public showFor(visualId: string, width: number, height: number, frame?: Readonly<Rect>): boolean {
    const matched = this.visualId.trim() === visualId.trim();
    this.node.active = matched;
    if (!matched) return false;
    // 运行时不把 CSV DTO 写回序列化属性；持久帧必须已由 bakeAuthoringVisualAssets 生成。
    if (frame !== undefined && !isValidRect(frame) && this.staticFrame === null) return false;
    return this.applyDisplaySize(width, height) && this.refreshPreview();
  }

  /** 编辑器烘焙并持久化船体 SpriteFrame；运行时调用会安全失败。 */
  public async bakeAuthoringVisualAssets(value: unknown): Promise<AuthoringResult> {
    if (!EDITOR_NOT_IN_PREVIEW) return { ok: false, message: '船体视觉资源只能在 Creator 编辑器中烘焙' };
    if (typeof value !== 'object' || value === null) return { ok: false, message: '船体外观烘焙配置必须是对象' };
    this.sprite ??= this.getComponent(Sprite);
    if (this.sprite === null) return { ok: false, message: '船体外观缺少持久 Sprite 组件' };
    const candidate = value as HullAppearanceBakeDto;
    const sourceTexture = candidate.sourceTexture !== undefined ? candidate.sourceTexture : this.sourceTexture;
    const visualId = typeof candidate.visualId === 'string' ? candidate.visualId.trim() : this.visualId.trim();
    if (!/^visual-hull-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(visualId)) return { ok: false, message: '船体视觉标识无效' };
    const frame = parseRect(candidate.frame ?? this.sourceFrameRect);
    if (frame === null) return { ok: false, message: '船体裁切矩形必须使用非负整数坐标和正整数尺寸' };
    const parsedCanvas = readCanvasSize(candidate, this.sourceCanvasWidth, this.sourceCanvasHeight);
    if (parsedCanvas === null) return { ok: false, message: '船体固定画布必须是正整数宽高' };
    // 旧版公开绑定 DTO 只携带完整船体帧；在没有显式画布字段时可由该帧恢复固定画布。
    const hasExplicitCanvas = candidate.canvasSize !== undefined || candidate.canvasWidth !== undefined || candidate.canvasHeight !== undefined;
    const canvas = !hasExplicitCanvas && this.sourceCanvasWidth === 1 && this.sourceCanvasHeight === 1
      ? { width: frame.x + frame.width, height: frame.y + frame.height }
      : parsedCanvas;
    if (frame.x + frame.width > canvas.width || frame.y + frame.height > canvas.height) {
      return { ok: false, message: '船体裁切矩形超出固定画布边界' };
    }
    const scale = readScale(candidate.displayScalePermille ?? this.displayScalePermille);
    const offsetX = integerValue(candidate.gridOffsetX ?? this.gridOffsetX);
    const offsetY = integerValue(candidate.gridOffsetY ?? this.gridOffsetY);
    if (scale === null) return { ok: false, message: '船体显示缩放必须是 1 到 10000 的整数' };
    if (offsetX === null || offsetY === null) return { ok: false, message: '船体网格偏移必须是整数' };
    const filter = normalizeFilterValue(candidate.filter, this.filter);
    if (filter === null) return { ok: false, message: '船体贴图过滤值无效' };
    const pivot = normalizePivotValue(candidate.pivot, this.pivot);
    if (pivot === null) return { ok: false, message: '船体视觉锚点无效' };
    const bakedFrame = candidate.staticFrame ?? this.staticFrame ?? this.createEditorFrame(frame, canvas.width, canvas.height, sourceTexture);
    if (bakedFrame === null) return { ok: false, message: '船体烘焙缺少 SpriteFrame；请先绑定源贴图或持久帧' };
    this.visualId = visualId;
    this.sourceTexture = sourceTexture;
    this.sourceFrameRect = new Rect(frame.x, frame.y, frame.width, frame.height);
    this.sourceCanvasWidth = canvas.width;
    this.sourceCanvasHeight = canvas.height;
    this.displayScalePermille = scale;
    this.gridOffsetX = offsetX;
    this.gridOffsetY = offsetY;
    this.filter = filter;
    this.pivot = pivot;
    this.staticFrame = bakedFrame;
    return this.refreshPreview()
      ? { ok: true, message: `已烘焙并写入船体外观：${this.visualId}` }
      : { ok: false, message: `${this.visualId} 缺少 Sprite 或 UITransform` };
  }

  /** 旧创作入口保留为薄别名，实际烘焙统一走 bakeAuthoringVisualAssets。 */
  public async applyAuthoringVisualConfiguration(value: unknown): Promise<AuthoringResult> {
    return this.bakeAuthoringVisualAssets(value);
  }

  public refreshPreview(): boolean {
    this.sprite ??= this.getComponent(Sprite);
    this.fallbackGraphics ??= this.getComponent(Graphics);
    if (this.sprite === null || this.staticFrame === null) {
      this.reportMissingBake();
      this.setFallbackVisible(true);
      return false;
    }
    const texture = this.staticFrame.texture;
    if (texture !== null && typeof texture.setFilters === 'function') {
      const filter = this.filter === 0 ? Texture2D.Filter.NEAREST : Texture2D.Filter.LINEAR;
      texture.setFilters(filter, filter);
    }
    this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    this.sprite.spriteFrame = this.staticFrame;
    this.sprite.enabled = true;
    this.setFallbackVisible(false);
    return true;
  }

  public hasRenderableVisual(): boolean {
    return this.staticFrame !== null;
  }

  private applyDisplaySize(width: number, height: number): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
    const transform = this.getComponent(UITransform);
    if (transform === null) return false;
    const scale = normalizeDisplayScale(this.displayScalePermille);
    transform.setContentSize(width / scale, height / scale);
    transform.setAnchorPoint(0.5, this.pivot === 'BOTTOM_CENTER' ? 0 : 0.5);
    this.node.setScale(scale, scale, this.node.scale.z);
    this.node.setPosition(this.gridOffsetX, this.gridOffsetY, this.node.position.z);
    if (this.staticFrame === null) this.drawFallback(width / scale, height / scale);
    return true;
  }

  private createEditorFrame(frame: Readonly<Rect>, canvasWidth: number, canvasHeight: number, sourceTexture: Texture2D | null): SpriteFrame | null {
    if (!EDITOR_NOT_IN_PREVIEW) return null;
    if (sourceTexture === null) return null;
    // 只有编辑器烘焙路径允许创建 SpriteFrame；refreshPreview/showFor 永不创建资源。
    const baked = new SpriteFrame();
    baked.texture = sourceTexture;
    baked.rect = new Rect(frame.x, frame.y, frame.width, frame.height);
    baked.originalSize = new Size(canvasWidth, canvasHeight);
    return baked;
  }

  private setFallbackVisible(visible: boolean): void {
    if (this.fallbackGraphics !== null) this.fallbackGraphics.enabled = visible;
  }

  private drawFallback(width: number, height: number): void {
    const graphics = this.fallbackGraphics;
    if (graphics === null) return;
    graphics.clear();
    graphics.fillColor = new Color(34, 48, 66, 220);
    graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(112, 164, 198, 255);
    graphics.rect(-width / 2 + 1, -height / 2 + 1, Math.max(1, width - 2), Math.max(1, height - 2));
    graphics.stroke();
  }

  private reportMissingBake(): void {
    if (this.missingBakeReported || EDITOR_NOT_IN_PREVIEW) return;
    this.missingBakeReported = true;
    error('[HullAppearance] 缺少持久船体 SpriteFrame，已回退到 Graphics');
  }
}

function parseRect(value: unknown): Rect | null {
  if (value instanceof Rect) return isValidRect(value) ? value : null;
  if (typeof value !== 'object' || value === null) return null;
  const rect = value as Record<string, unknown>;
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger)
    || (rect.x as number) < 0 || (rect.y as number) < 0
    || (rect.width as number) <= 0 || (rect.height as number) <= 0) return null;
  return new Rect(rect.x as number, rect.y as number, rect.width as number, rect.height as number);
}

function readScale(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 10000 ? value as number : null;
}

function integerValue(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function normalizeFilterValue(value: unknown, fallback: HullAppearanceFilter): HullAppearanceFilter | null {
  if (value === undefined || value === null) return fallback;
  if (value === 0 || value === 'NEAREST') return 0;
  if (value === 1 || value === 'LINEAR') return 1;
  return null;
}

function normalizePivotValue(value: unknown, fallback: HullAppearancePivot): HullAppearancePivot | null {
  if (value === undefined || value === null) return fallback;
  return value === 'CENTER' || value === 'BOTTOM_CENTER' ? value : null;
}

function normalizeDisplayScale(value: number): number {
  return Number.isInteger(value) && value >= 1 && value <= 10000 ? value / 1000 : 1;
}

function readCanvasSize(
  candidate: HullAppearanceBakeDto,
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

function isValidRect(rect: Readonly<Rect>): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0;
}
