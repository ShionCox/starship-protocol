import {
  _decorator,
  Color,
  Component,
  error,
  Graphics,
  Layers,
  Node,
  Rect,
  TransformBit,
  UITransform,
  Vec3,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import {
  parseHullDefinition,
  type HullDefinition,
  type HullDefinitionParseResult,
} from '../game-core/HullDefinition';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import { GameConfigCsvSource } from './GameConfigCsvSource';
import { HullAppearance } from './HullAppearance';
import {
  ShipGridModel,
  validateRoomPlacement,
  type GridPosition,
} from '../game-core/ShipGridModel';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/**
 * 单艘飞船的表现根。船体网格、房间层和船员层都属于此组件，任何查找都不得跨出
 * 当前 ShipView，避免 BattleScene 中我方与敌方飞船串联。
 */
@ccclass('ShipView')
@executeInEditMode
@menu('星舰协议/场景表现/飞船视图')
export class ShipView extends Component {
  @property({
    displayName: '飞船实例标识',
    tooltip: '当前场景内的稳定飞船实例 ID；由创作工具生成，Prefab 模板中保持为空。',
    group: '飞船实例',
  })
  public shipId = '';

  @property({
    displayName: '船体定义标识',
    tooltip: '必须与权威 hulls.csv 中稳定 ID 一致。',
    group: '船体定义',
  })
  public hullDefinitionId = '';

  @property({ type: GameConfigCsvSource, displayName: '应用根配置来源', tooltip: '由创作工具持久连接到当前 Main/Battle 应用根的唯一权威 CSV 来源。', group: '船体定义' })
  public configSource: GameConfigCsvSource | null = null;

  @property({ type: Node, displayName: '逻辑内容根', tooltip: '承载网格、地板、房间、船员和施工层的单舰逻辑内容根；不与 UIRoot 或其他飞船共享。', group: '节点引用' })
  public contentRoot: Node | null = null;

  @property({ type: Node, displayName: '船体外观层', tooltip: '位于网格与玩法内容下方，持久保存全部船体 Sprite。', group: '节点引用' })
  public hullAppearanceRoot: Node | null = null;

  @property({ type: Node, displayName: '网格根节点', tooltip: '持久保存网格 UITransform 与 Graphics 的节点。', group: '节点引用' })
  public gridRoot: Node | null = null;

  @property({ type: Node, displayName: '房间容器', tooltip: '仅包含本飞船的 RoomView 实例。', group: '节点引用' })
  public roomRoot: Node | null = null;

  @property({ type: Node, displayName: '地板容器', tooltip: '仅包含本飞船的 FloorView 实例。', group: '节点引用' })
  public floorRoot: Node | null = null;

  @property({ type: Node, displayName: '网格交互高亮层', tooltip: '单个持久 Graphics 节点，绘制悬浮、目标和建造合法性。', group: '节点引用' })
  public interactionRoot: Node | null = null;

  @property({ type: Node, displayName: '船员层', tooltip: '仅包含本飞船的 CrewView 实例。', group: '节点引用' })
  public crewRoot: Node | null = null;

  @property({ type: Node, displayName: '施工预览容器', tooltip: '仅包含当前飞船的施工幽灵表现。', group: '节点引用' })
  public constructionRoot: Node | null = null;

  @property({
    displayName: '格子尺寸（像素）',
    tooltip: '单个逻辑格在当前飞船表现中的尺寸和吸附步长。',
    group: '网格表现',
    min: 1,
    step: 1,
  })
  public cellSize = 24;

  @property({ displayName: '房间拖动自动吸附', tooltip: '编辑器中拖动本飞船房间时吸附到逻辑格。', group: '网格表现' })
  public snapRoomsInEditor = true;

  /** 仅供创作插件建立正式 ShipView Prefab 的持久子层级；Prefab 模板不写实例 ID。 */
  public ensureAuthoringPrefabStructure(): boolean {
    this.shipId = '';
    this.hullDefinitionId = '';
    this.configSource = null;
    this.cellSize = 24;
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
    transform.setContentSize(960, 480);
    // 逻辑内容根是单舰边界：场景中可以并排放置多艘 ShipView，但任何动态层都不能
    // 直接挂到 Canvas、世界根或另一艘飞船。旧版本直接挂在 ShipView 下的层会在
    // Creator 升级时移动到此根，避免保留一套“看起来有效”但不受作用域约束的层级。
    this.contentRoot = ensureShipContentRoot(this.node, this.contentRoot);
    this.hullAppearanceRoot = ensureShipLayer(this.contentRoot, '船体外观层');
    this.gridRoot = ensureShipLayer(this.contentRoot, '网格根', true);
    this.floorRoot = ensureShipLayer(this.contentRoot, '地板容器');
    this.interactionRoot = ensureShipLayer(this.contentRoot, '网格交互高亮层', true);
    this.roomRoot = ensureShipLayer(this.contentRoot, '房间容器');
    this.crewRoot = ensureShipLayer(this.contentRoot, '船员层');
    this.constructionRoot = ensureShipLayer(this.contentRoot, '施工预览容器');
    const effectsRoot = ensureShipLayer(this.contentRoot, '特效层');
    [this.hullAppearanceRoot, this.gridRoot, this.floorRoot, this.interactionRoot, this.roomRoot, this.crewRoot, this.constructionRoot, effectsRoot]
      .forEach((layer, index) => layer.setSiblingIndex(index));
    // 这些节点只负责分层与挂载子内容，本身不能覆盖整艘船参与 UI 命中。
    // 房间、船员和施工幽灵都由各自的 UITransform 接收点击。
    [this.hullAppearanceRoot, this.floorRoot, this.roomRoot, this.crewRoot, this.constructionRoot, effectsRoot]
      .forEach((layer) => layer.getComponent(UITransform)?.setContentSize(0, 0));
    setUiLayerRecursively(this.node);
    this.refreshGridPreview();
    return true;
  }

  @property({ displayName: '网格背景颜色', tooltip: '有效船体区域下方的网格底色。', group: '网格外观' })
  public gridBackgroundColor = new Color(8, 19, 34, 230);

  @property({ displayName: '网格线颜色', tooltip: '有效格边界线颜色。', group: '网格外观' })
  public gridLineColor = new Color(78, 121, 148, 210);

  @property({ displayName: '网格线宽度', tooltip: '有效格边界线宽度。', group: '网格外观', min: 1, step: 1 })
  public gridLineWidth = 1;

  @property({ displayName: '无效船体格颜色', tooltip: '船体 Mask 中数值为 0 的逻辑格颜色。', group: '网格外观' })
  public invalidHullCellColor = new Color(70, 35, 42, 230);

  @property({ displayName: '显示网格底色', tooltip: '关闭后可直接看到下方船体图片；网格线和无效格仍保留。', group: '网格外观' })
  public showGridBackground = false;

  @property({ displayName: '填充墙格与虚空', tooltip: '通常关闭以显示船体图片；开启后使用无效船体格颜色覆盖非建造格。', group: '网格外观' })
  public showInvalidHullCellFill = false;

  @property({ displayName: '悬浮高亮颜色', tooltip: '鼠标悬浮普通逻辑格时的颜色。', group: '交互高亮' })
  public hoverCellColor = new Color(62, 214, 235, 78);

  @property({ displayName: '目标高亮颜色', tooltip: '右键任务目标格的颜色。', group: '交互高亮' })
  public targetCellColor = new Color(255, 213, 78, 105);

  @property({ displayName: '合法建造颜色', tooltip: '建造目标合法时的颜色。', group: '交互高亮' })
  public validCellColor = new Color(82, 222, 132, 92);

  @property({ displayName: '非法目标颜色', tooltip: '墙体、虚空或非法建造目标的颜色。', group: '交互高亮' })
  public invalidCellColor = new Color(255, 82, 82, 100);

  private previewSignature = '';
  private authoringPreviewResult: HullDefinitionParseResult | null = null;
  private previousGridRoot: Node | null = null;

  protected onEnable(): void {
    this.disableContainerHitAreas();
    this.refreshGridPreview();
  }

  protected onRestore(): void {
    this.authoringPreviewResult = null;
    this.previewSignature = '';
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) this.refreshGridPreview();
  }

  /** 解析并验证当前绑定的船体定义。 */
  public resolveHullDefinition(): HullDefinitionParseResult {
    const source = this.configSource;
    const resolved = source?.resolve();
    if (resolved === undefined) return { ok: false, code: 'INVALID_DOCUMENT', message: '请给飞船视图绑定权威 CSV 来源' };
    if (resolved.ok === false) return { ok: false, code: 'INVALID_DOCUMENT', message: resolved.message };
    const definition = resolved.config.hulls.find((entry) => entry.id === this.hullDefinitionId.trim());
    if (definition === undefined) {
      return {
        ok: false,
        code: 'INVALID_ID',
        message: `hulls.csv 不包含船体定义：${this.hullDefinitionId || '空'}`,
      };
    }
    return { ok: true, definition };
  }

  /** 创作工具只读取此白名单 DTO，不读取原始组件对象。 */
  public getAuthoringInspectorState(): {
    readonly ok: boolean;
    readonly message: string;
    readonly shipId: string;
    readonly hullDefinitionId: string;
    readonly gridWidth?: number;
    readonly gridHeight?: number;
    readonly maxCrew?: number;
    readonly maxRooms?: number;
  } {
    const base = { shipId: this.shipId.trim(), hullDefinitionId: this.hullDefinitionId.trim() };
    if (base.shipId === '') return { ...base, ok: false, message: '飞船实例标识不能为空' };
    const result = this.authoringPreviewResult ?? this.resolveHullDefinition();
    if (result.ok === false) return { ...base, ok: false, message: result.message };
    if (this.gridRoot === null || this.roomRoot === null || this.crewRoot === null) {
      return { ...base, ok: false, message: '飞船视图必须绑定网格根、房间容器和船员层' };
    }
    return {
      ...base,
      ok: true,
      message: `飞船实例有效：${result.definition.displayName}`,
      gridWidth: result.definition.gridWidth,
      gridHeight: result.definition.gridHeight,
      maxCrew: result.definition.maxCrew,
      maxRooms: result.definition.maxRooms,
    };
  }

  /** 创作面板以内存船体配置行刷新网格，不改写 CSV 或场景数据。 */
  public applyAuthoringHullPreview(document: unknown): boolean {
    const documentId = typeof document === 'object' && document !== null && typeof (document as { id?: unknown }).id === 'string'
      ? (document as { id: string }).id.trim()
      : '';
    if (documentId !== this.hullDefinitionId.trim()) return true;
    const result = parseHullDefinition(document);
    this.authoringPreviewResult = result;
    this.previewSignature = '';
    if (result.ok === false || this.gridRoot === null) return false;
    this.drawHullAppearance(result.definition);
    this.drawGrid(result.definition);
    return true;
  }

  /**
   * 清空创作定义的内存预览覆盖，并立即按权威 CSV 重绘船体网格。
   * 这里只清理 View 缓存，不写 Scene，也不创建 Undo 记录。
   */
  public clearAuthoringDefinitionPreview(): void {
    this.authoringPreviewResult = null;
    this.previewSignature = '';
    this.refreshGridPreview();
  }

  /** 清空缓存并立即按当前绑定定义重绘，供创作面板保存后调用。 */
  public refreshAuthoringLayoutPreview(): void {
    this.previewSignature = '';
    this.refreshGridPreview();
  }

  public hasValidGridConfig(): boolean {
    const result = this.authoringPreviewResult ?? this.resolveHullDefinition();
    return this.gridRoot !== null && Number.isInteger(this.cellSize) && this.cellSize > 0 && result.ok;
  }

  public getHullDefinition(): Readonly<HullDefinition> {
    if (this.authoringPreviewResult?.ok === true) return this.authoringPreviewResult.definition;
    const result = this.resolveHullDefinition();
    if (result.ok === false) throw new RangeError(result.message);
    return result.definition;
  }

  public gridToLocal(position: GridPosition): Vec3 {
    const hull = this.getHullDefinition();
    const originX = -(hull.gridWidth * this.cellSize) / 2;
    const originY = -(hull.gridHeight * this.cellSize) / 2;
    return new Vec3(originX + (position.x + 0.5) * this.cellSize, originY + (position.y + 0.5) * this.cellSize, 0);
  }

  /** 导航锚点允许小数格；表现层只换算，不把像素坐标写回核心快照。 */
  public navigationAnchorToParentLocal(parent: Node, anchor: Readonly<GridPosition>): Vec3 | null {
    if (this.gridRoot === null || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
    try {
      this.refreshEditorWorldTransform();
      const local = this.gridToLocal(anchor);
      const world = Vec3.transformMat4(new Vec3(), local, this.gridRoot.worldMatrix);
      parent.updateWorldTransform();
      return parent.inverseTransformPoint(new Vec3(), world);
    } catch {
      return null;
    }
  }

  /** 所有船体格都可悬浮，包括 VOID/固定墙；这里只检查矩形边界。 */
  public worldPointToGridCell(worldPoint: Readonly<Vec3>): GridPosition | null {
    if (this.gridRoot === null) return null;
    try {
      this.refreshEditorWorldTransform();
      const hull = this.getHullDefinition();
      const local = this.gridRoot.inverseTransformPoint(new Vec3(), worldPoint);
      const originX = -(hull.gridWidth * this.cellSize) / 2;
      const originY = -(hull.gridHeight * this.cellSize) / 2;
      const x = Math.floor((local.x - originX) / this.cellSize);
      const y = Math.floor((local.y - originY) / this.cellSize);
      return x >= 0 && y >= 0 && x < hull.gridWidth && y < hull.gridHeight ? { x, y } : null;
    } catch {
      return null;
    }
  }

  public getHullCellType(position: GridPosition): Readonly<HullDefinition>['cellTypes'][number] | null {
    const hull = this.getHullDefinition();
    return Number.isInteger(position.x) && Number.isInteger(position.y) && position.x >= 0 && position.y >= 0
      && position.x < hull.gridWidth && position.y < hull.gridHeight
      ? hull.cellTypes[position.y * hull.gridWidth + position.x]
      : null;
  }

  public refreshInteractionCell(
    position: GridPosition | null,
    mode: 'HOVER' | 'TARGET' | 'VALID' | 'INVALID' = 'HOVER',
  ): void {
    const graphics = this.interactionRoot?.getComponent(Graphics) ?? null;
    const transform = this.interactionRoot?.getComponent(UITransform) ?? null;
    if (graphics === null || transform === null) return;
    graphics.clear();
    if (position === null) return;
    const hull = this.getHullDefinition();
    transform.setContentSize(hull.gridWidth * this.cellSize, hull.gridHeight * this.cellSize);
    const center = this.gridToLocal(position);
    const color = mode === 'TARGET' ? this.targetCellColor
      : mode === 'VALID' ? this.validCellColor
        : mode === 'INVALID' ? this.invalidCellColor
          : this.hoverCellColor;
    graphics.fillColor = color;
    graphics.rect(center.x - this.cellSize / 2 + 1, center.y - this.cellSize / 2 + 1, this.cellSize - 2, this.cellSize - 2);
    graphics.fill();
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(color.r, color.g, color.b, Math.max(180, color.a));
    graphics.rect(center.x - this.cellSize / 2 + 1, center.y - this.cellSize / 2 + 1, this.cellSize - 2, this.cellSize - 2);
    graphics.stroke();
  }

  public worldCenterToGrid(worldCenter: Vec3, widthCells: number, heightCells: number): GridPosition | null {
    const position = this.worldCenterToGridCandidate(worldCenter, widthCells, heightCells);
    return position !== null && this.isValidStandalonePlacement(position, widthCells, heightCells) ? position : null;
  }

  /**
   * 将拖放指针吸附到占地矩形左下角；此方法只负责坐标换算，不把 VOID/固定墙误判为合法。
   * 预览需要先画出红色非法范围，因此不能复用会直接返回 null 的 worldCenterToGrid。
   */
  public worldCenterToGridCandidate(worldCenter: Vec3, widthCells: number, heightCells: number): GridPosition | null {
    if (!this.hasValidRoomSize(widthCells, heightCells) || this.gridRoot === null) return null;
    try {
      this.refreshEditorWorldTransform();
      const hull = this.getHullDefinition();
      const localCenter = this.gridRoot.inverseTransformPoint(new Vec3(), worldCenter);
      const originX = -(hull.gridWidth * this.cellSize) / 2;
      const originY = -(hull.gridHeight * this.cellSize) / 2;
      const position = {
        x: Math.round((localCenter.x - originX) / this.cellSize - widthCells / 2),
        y: Math.round((localCenter.y - originY) / this.cellSize - heightCells / 2),
      };
      return position;
    } catch {
      return null;
    }
  }

  /** 复用单个交互 Graphics 绘制拖拽占地矩形，避免为多格建筑创建临时节点。 */
  public refreshInteractionRect(
    position: GridPosition | null,
    widthCells: number,
    heightCells: number,
    mode: 'VALID' | 'INVALID',
  ): void {
    const graphics = this.interactionRoot?.getComponent(Graphics) ?? null;
    const transform = this.interactionRoot?.getComponent(UITransform) ?? null;
    if (graphics === null || transform === null) return;
    graphics.clear();
    if (position === null || !this.hasValidRoomSize(widthCells, heightCells)) return;
    const hull = this.getHullDefinition();
    transform.setContentSize(hull.gridWidth * this.cellSize, hull.gridHeight * this.cellSize);
    const first = this.gridToLocal(position);
    const center = new Vec3(
      first.x + ((widthCells - 1) * this.cellSize) / 2,
      first.y + ((heightCells - 1) * this.cellSize) / 2,
      0,
    );
    const color = mode === 'VALID' ? this.validCellColor : this.invalidCellColor;
    graphics.fillColor = new Color(color.r, color.g, color.b, 92);
    graphics.rect(
      center.x - (widthCells * this.cellSize) / 2 + 1,
      center.y - (heightCells * this.cellSize) / 2 + 1,
      widthCells * this.cellSize - 2,
      heightCells * this.cellSize - 2,
    );
    graphics.fill();
    graphics.lineWidth = 2;
    graphics.strokeColor = new Color(color.r, color.g, color.b, 230);
    graphics.rect(
      center.x - (widthCells * this.cellSize) / 2 + 1,
      center.y - (heightCells * this.cellSize) / 2 + 1,
      widthCells * this.cellSize - 2,
      heightCells * this.cellSize - 2,
    );
    graphics.stroke();
  }

  public parentLocalCenterToGrid(
    parent: Node,
    parentLocalCenter: Readonly<Vec3>,
    widthCells: number,
    heightCells: number,
  ): GridPosition | null {
    if (this.gridRoot === null || !this.hasValidRoomSize(widthCells, heightCells)) return null;
    this.refreshEditorWorldTransform();
    parent.updateWorldTransform();
    return this.worldCenterToGrid(Vec3.transformMat4(new Vec3(), parentLocalCenter, parent.worldMatrix), widthCells, heightCells);
  }

  public gridPositionToParentLocal(
    parent: Node,
    gridPosition: GridPosition,
    widthCells: number,
    heightCells: number,
  ): Vec3 | null {
    if (this.gridRoot === null || !this.hasValidRoomSize(widthCells, heightCells)) return null;
    if (!this.isValidStandalonePlacement(gridPosition, widthCells, heightCells)) return null;
    try {
      this.refreshEditorWorldTransform();
      const firstCell = this.gridToLocal(gridPosition);
      const gridCenter = new Vec3(
        firstCell.x + ((widthCells - 1) * this.cellSize) / 2,
        firstCell.y + ((heightCells - 1) * this.cellSize) / 2,
        0,
      );
      const worldCenter = Vec3.transformMat4(new Vec3(), gridCenter, this.gridRoot.worldMatrix);
      parent.updateWorldTransform();
      return parent.inverseTransformPoint(new Vec3(), worldCenter);
    } catch {
      return null;
    }
  }

  /** 以 y→x 的稳定顺序寻找本飞船第一个合法空位。 */
  public findFirstAvailableRoomPlacement(widthCells: number, heightCells: number): GridPosition | null {
    if (!this.hasValidRoomSize(widthCells, heightCells) || this.roomRoot === null) return null;
    try {
      const hull = this.getHullDefinition();
      const grid = new ShipGridModel(hull);
      for (const roomNode of this.roomRoot.children) {
        // 房间容器按约定只保存 RoomView。发现未知子节点时停止创建，避免把
        // 未知内容当成空白并在其占用的坐标上再次放置房间。
        const roomView = roomNode.getComponent('RoomView') as {
          roomInstanceId?: string;
          getAuthoringDefinitionForLayout?: () => RoomDefinition | null;
          resolveRoomDefinition?: () => { ok: true; definition: RoomDefinition } | { ok: false; message?: string };
        } | null;
        if (
          roomView === null ||
          typeof roomView.roomInstanceId !== 'string' ||
          roomView.roomInstanceId.trim() === '' ||
          typeof roomView.resolveRoomDefinition !== 'function'
        ) {
          return null;
        }
        const previewDefinition = typeof roomView.getAuthoringDefinitionForLayout === 'function'
          ? roomView.getAuthoringDefinitionForLayout()
          : null;
        const definition = previewDefinition === null
          ? roomView.resolveRoomDefinition()
          : { ok: true as const, definition: previewDefinition };
        if (definition.ok !== true || definition.definition === undefined) return null;
        const position = this.parentLocalCenterToGrid(
          this.roomRoot,
          roomNode.position,
          definition.definition.width,
          definition.definition.height,
        );
        // 已有房间的定义、坐标或放置校验任一失败，都不能把它当作空白跳过。
        if (position === null) return null;
        const placed = grid.placeRoom({
          instanceId: roomView.roomInstanceId.trim(),
          definitionId: definition.definition.id,
          ...position,
          width: definition.definition.width,
          height: definition.definition.height,
        });
        if (placed.ok === false) return null;
      }
      // 纯校验函数不包含房间上限；先显式检查，避免满容量飞船被误报为仍有空位。
      if (grid.getRooms().length >= hull.maxRooms) return null;
      for (let y = 0; y < hull.gridHeight; y += 1) {
        for (let x = 0; x < hull.gridWidth; x += 1) {
          const candidate = {
            instanceId: '__editor_candidate__',
            definitionId: '__editor_definition__',
            x,
            y,
            width: widthCells,
            height: heightCells,
          };
          if (validateRoomPlacement(grid, candidate).ok) return { x, y };
        }
      }
    } catch {
      // 编辑器场景可能在资源重载期间暂时处于半绑定状态；任何异常都按无合法空位处理。
      return null;
    }
    return null;
  }

  private refreshGridPreview(): void {
    // 共享 ShipView Prefab 是无实例 ID/船体 ID 的模板；只有场景实例才要求解析船体。
    if (this.hullDefinitionId.trim() === '') {
      this.previewSignature = 'template';
      this.gridRoot?.getComponent(Graphics)?.clear();
      this.hideHullAppearances();
      return;
    }
    const source = this.configSource;
    if (EDITOR_NOT_IN_PREVIEW && this.authoringPreviewResult === null && (source === null || !source.hasCompleteBinding())) {
      this.previewSignature = 'config-binding-pending';
      // ShipView 模板不保存配置来源；保持最近一次合法场景/DTO 预览，不制造错误日志。
      return;
    }
    const result = this.authoringPreviewResult ?? this.resolveHullDefinition();
    let signature: string;
    if (result.ok === true) {
      signature = [this.gridRoot?.uuid ?? '', this.hullAppearanceRoot?.uuid ?? '', result.definition.id, result.definition.visualId, result.definition.gridWidth, result.definition.gridHeight,
        result.definition.cellTypes.join(','), this.cellSize, this.gridLineWidth, this.showGridBackground, this.showInvalidHullCellFill,
        this.gridBackgroundColor.toHEX('#rrggbbaa'), this.gridLineColor.toHEX('#rrggbbaa'),
        this.invalidHullCellColor.toHEX('#rrggbbaa'), this.visualSignature(result.definition.visualId)].join('|');
    } else {
      signature = `error|${result.code}|${result.message}`;
    }
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    if (this.previousGridRoot !== null && this.previousGridRoot !== this.gridRoot) this.previousGridRoot.getComponent(Graphics)?.clear();
    this.previousGridRoot = this.gridRoot;
    if (result.ok === false || this.gridRoot === null) {
      this.hideHullAppearances();
      if (result.ok === false) error(`[SHIP] ${result.message}`);
      return;
    }
    this.drawHullAppearance(result.definition);
    this.drawGrid(result.definition);
  }

  private drawGrid(hull: Readonly<HullDefinition>): void {
    if (this.gridRoot === null || !Number.isFinite(this.gridLineWidth) || this.gridLineWidth <= 0) return;
    const transform = this.gridRoot.getComponent(UITransform);
    const graphics = this.gridRoot.getComponent(Graphics);
    if (transform === null || graphics === null) {
      error('[SHIP] 请在网格根节点持久挂载界面变换和图形组件');
      return;
    }
    const width = hull.gridWidth * this.cellSize;
    const height = hull.gridHeight * this.cellSize;
    const originX = -width / 2;
    const originY = -height / 2;
    transform.setContentSize(width, height);
    graphics.clear();
    if (this.showGridBackground) {
      graphics.fillColor = this.gridBackgroundColor;
      graphics.rect(originX, originY, width, height);
      graphics.fill();
    }
    if (this.showInvalidHullCellFill) {
      graphics.fillColor = this.invalidHullCellColor;
      for (let index = 0; index < hull.cellTypes.length; index += 1) {
        if (hull.cellTypes[index] === 'BUILDABLE') continue;
        const x = index % hull.gridWidth;
        const y = Math.floor(index / hull.gridWidth);
        graphics.rect(originX + x * this.cellSize, originY + y * this.cellSize, this.cellSize, this.cellSize);
      }
      graphics.fill();
    }
    graphics.lineWidth = this.gridLineWidth;
    graphics.strokeColor = this.gridLineColor;
    for (let index = 0; index < hull.cellTypes.length; index += 1) {
      if (hull.cellTypes[index] !== 'BUILDABLE') continue;
      const x = index % hull.gridWidth;
      const y = Math.floor(index / hull.gridWidth);
      graphics.rect(originX + x * this.cellSize, originY + y * this.cellSize, this.cellSize, this.cellSize);
    }
    graphics.stroke();
  }

  private drawHullAppearance(hull: Readonly<HullDefinition>): void {
    const root = this.hullAppearanceRoot;
    const source = this.configSource;
    const visual = source?.getVisualDefinition(hull.visualId) ?? null;
    if (root === null) {
      this.hideHullAppearances();
      error('[SHIP] 请在 ShipView Prefab 持久绑定船体外观层');
      return;
    }
    const appearances = root.children.map((node) => node.getComponent(HullAppearance)).filter((entry): entry is HullAppearance => entry !== null);
    const active = appearances.find((appearance) => appearance.visualId.trim() === hull.visualId);
    for (const appearance of appearances) appearance.node.active = appearance === active;
    const width = hull.gridWidth * this.cellSize;
    const height = hull.gridHeight * this.cellSize;
    if (visual === null || visual.visual.kind !== 'HULL') {
      if (active === undefined || !active.showFor(hull.visualId, width, height)) {
        this.hideHullAppearances();
      }
      return;
    }
    const frame = visual.frames[visual.visual.idleFrameIndex] ?? visual.frames[0];
    const frameRect = frame === undefined ? undefined : new Rect(frame.x, frame.y, frame.width, frame.height);
    if (active === undefined || frameRect === undefined
      || !active.showFor(hull.visualId, width, height, frameRect)) {
      error(`[SHIP] 船体视觉 ${hull.visualId} 尚未通过创作工具持久绑定`);
      return;
    }
    // 船体图片属于表现层，不能反过来改变 HullDefinition 的逻辑尺寸。先按帧矩形
    // 做 contain，保证整张外观落在逻辑内容根，再叠加 CSV 的千分比缩放和像素偏移。
    applyVisualContain(active.node, frameRect.width, frameRect.height, width, height, visual.visual.displayScalePermille, visual.visual.gridOffsetX, visual.visual.gridOffsetY);
  }

  /** 把视觉几何字段集中成一个可测试的变换，避免各外观组件各自解释 CSV。 */
  private visualSignature(visualId: string): string {
    const source = this.configSource;
    const visual = source?.getVisualDefinition(visualId)?.visual;
    if (visual === undefined) return visualId;
    return [visual.visualId, visual.displayScalePermille, visual.gridOffsetX, visual.gridOffsetY].join(':');
  }

  private hideHullAppearances(): void {
    for (const node of this.hullAppearanceRoot?.children ?? []) node.active = false;
  }

  private refreshEditorWorldTransform(): void {
    if (!EDITOR_NOT_IN_PREVIEW || this.gridRoot === null) return;
    let canvasChild = this.gridRoot;
    while (canvasChild.parent !== null && canvasChild.parent !== this.gridRoot.scene) canvasChild = canvasChild.parent;
    canvasChild.invalidateChildren(TransformBit.TRS);
    this.gridRoot.updateWorldTransform();
  }

  /** 纯容器不参与鼠标命中；子节点仍保留各自 UITransform 与交互。 */
  private disableContainerHitAreas(): void {
    [this.contentRoot, this.hullAppearanceRoot, this.floorRoot, this.roomRoot, this.crewRoot, this.constructionRoot]
      .forEach((layer) => layer?.getComponent(UITransform)?.setContentSize(0, 0));
    this.contentRoot?.getChildByName('特效层')?.getComponent(UITransform)?.setContentSize(0, 0);
  }

  private hasValidRoomSize(widthCells: number, heightCells: number): boolean {
    return this.hasValidGridConfig() && Number.isInteger(widthCells) && Number.isInteger(heightCells) && widthCells > 0 && heightCells > 0;
  }

  /** 只校验单个候选房间的船体边界和有效格，供绑定与编辑器放置共用。 */
  private isValidStandalonePlacement(position: GridPosition, widthCells: number, heightCells: number): boolean {
    if (!this.hasValidRoomSize(widthCells, heightCells)) return false;
    try {
      const grid = new ShipGridModel(this.getHullDefinition());
      return validateRoomPlacement(grid, {
        instanceId: '__editor_candidate__',
        definitionId: '__editor_definition__',
        ...position,
        width: widthCells,
        height: heightCells,
      }).ok;
    } catch {
      return false;
    }
  }
}

function setUiLayerRecursively(node: Node): void {
  node.layer = Layers.Enum.UI_2D;
  for (const child of node.children) setUiLayerRecursively(child);
}

/**
 * 获取单舰逻辑内容根。旧 Prefab 可能把层级直接放在 ShipView 下，这里只在编辑器
 * 升级入口迁移已有节点；运行时 bind/refresh 不会调用此函数，也不会补正式节点。
 */
function ensureShipContentRoot(shipNode: Node, configured: Node | null): Node {
  const contentRoot = configured ?? shipNode.getChildByName('逻辑内容根') ?? new Node('逻辑内容根');
  if (contentRoot.parent !== shipNode) shipNode.addChild(contentRoot);
  contentRoot.layer = Layers.Enum.UI_2D;
  contentRoot.getComponent(UITransform) ?? contentRoot.addComponent(UITransform);
  // 容器本身不参加 UI 命中；交互由网格高亮、房间或船员子节点接收。
  contentRoot.getComponent(UITransform)?.setContentSize(0, 0);
  for (const child of [...shipNode.children]) {
    if (child === contentRoot) continue;
    if (['船体外观层', '网格根', '地板容器', '网格交互高亮层', '房间容器', '船员层', '施工预览容器', '特效层'].indexOf(child.name) >= 0) {
      contentRoot.addChild(child);
    }
  }
  return contentRoot;
}

function ensureShipLayer(parent: Node, name: string, graphics = false): Node {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.layer = Layers.Enum.UI_2D;
  node.getComponent(UITransform) ?? node.addComponent(UITransform);
  if (graphics) node.getComponent(Graphics) ?? node.addComponent(Graphics);
  return node;
}

/**
 * 视觉 CSV 的 contain/scale/offset 消费。contain 以裁切帧矩形为基准，保证图片不
 * 超出逻辑船体；显示缩放和偏移只改变表现节点，不改变网格、碰撞或存档坐标。
 */
function applyVisualContain(
  node: Node,
  frameWidth: number,
  frameHeight: number,
  contentWidth: number,
  contentHeight: number,
  displayScalePermille: number,
  gridOffsetX: number,
  gridOffsetY: number,
): void {
  if (![frameWidth, frameHeight, contentWidth, contentHeight, displayScalePermille, gridOffsetX, gridOffsetY].every(Number.isFinite)
    || frameWidth <= 0 || frameHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return;
  // HullAppearance.showFor 先把 Sprite 绑定到逻辑网格；这里恢复帧原始尺寸，
  // 再通过节点缩放做 contain，避免“先拉伸到网格、再缩放”导致二次缩放和留白。
  node.getComponent(UITransform)?.setContentSize(frameWidth, frameHeight);
  const containScale = Math.min(1, contentWidth / frameWidth, contentHeight / frameHeight);
  const scale = containScale * Math.max(0.001, displayScalePermille / 1000);
  const z = node.scale.z;
  node.setScale(new Vec3(scale, scale, z));
  node.setPosition(new Vec3(gridOffsetX, gridOffsetY, node.position.z));
}

/** 从节点向上寻找所属飞船；不得退化为全场景首个 ShipView。 */
export function findOwningShipView(node: Node): ShipView | null {
  let cursor: Node | null = node;
  while (cursor !== null) {
    const shipView = cursor.getComponent(ShipView);
    if (shipView !== null) return shipView;
    cursor = cursor.parent;
  }
  return null;
}
