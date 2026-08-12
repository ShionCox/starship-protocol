import {
  _decorator,
  Color,
  Component,
  error,
  Graphics,
  JsonAsset,
  Layers,
  Node,
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
    tooltip: '必须与绑定的船体定义 JSON 中稳定 ID 一致。',
    group: '船体定义',
  })
  public hullDefinitionId = '';

  @property({
    type: JsonAsset,
    displayName: '船体定义',
    tooltip: '船体逻辑网格、有效格和容量上限的唯一规则来源。',
    group: '船体定义',
  })
  public hullDefinitionAsset: JsonAsset | null = null;

  @property({ type: Node, displayName: '网格根节点', tooltip: '持久保存网格 UITransform 与 Graphics 的节点。', group: '节点引用' })
  public gridRoot: Node | null = null;

  @property({ type: Node, displayName: '房间容器', tooltip: '仅包含本飞船的 RoomView 实例。', group: '节点引用' })
  public roomRoot: Node | null = null;

  @property({ type: Node, displayName: '船员层', tooltip: '仅包含本飞船的 CrewView 实例。', group: '节点引用' })
  public crewRoot: Node | null = null;

  @property({
    displayName: '格子尺寸（像素）',
    tooltip: '单个逻辑格在当前飞船表现中的尺寸和吸附步长。',
    group: '网格表现',
    min: 1,
    step: 1,
  })
  public cellSize = 48;

  @property({ displayName: '房间拖动自动吸附', tooltip: '编辑器中拖动本飞船房间时吸附到逻辑格。', group: '网格表现' })
  public snapRoomsInEditor = true;

  /** 仅供创作插件建立正式 ShipView Prefab 的持久子层级；Prefab 模板不写实例 ID。 */
  public ensureAuthoringPrefabStructure(): boolean {
    this.shipId = '';
    this.hullDefinitionId = '';
    this.hullDefinitionAsset = null;
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform);
    transform.setContentSize(960, 480);
    this.gridRoot = ensureShipLayer(this.node, '网格根', true);
    this.roomRoot = ensureShipLayer(this.node, '房间容器');
    this.crewRoot = ensureShipLayer(this.node, '船员层');
    ensureShipLayer(this.node, '特效层');
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

  private previewSignature = '';
  private previousGridRoot: Node | null = null;

  protected onEnable(): void {
    this.refreshGridPreview();
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) this.refreshGridPreview();
  }

  /** 解析并验证当前绑定的船体定义。 */
  public resolveHullDefinition(): HullDefinitionParseResult {
    if (this.hullDefinitionAsset === null) {
      return { ok: false, code: 'INVALID_DOCUMENT', message: '请给飞船视图绑定船体定义 JSON' };
    }
    const result = parseHullDefinition(this.hullDefinitionAsset.json);
    if (result.ok && result.definition.id !== this.hullDefinitionId.trim()) {
      return {
        ok: false,
        code: 'INVALID_ID',
        message: `船体定义 ID 不匹配：Inspector 为 ${this.hullDefinitionId || '空'}，JSON 为 ${result.definition.id}`,
      };
    }
    return result;
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
    const result = this.resolveHullDefinition();
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

  public hasValidGridConfig(): boolean {
    return this.gridRoot !== null && Number.isInteger(this.cellSize) && this.cellSize > 0 && this.resolveHullDefinition().ok;
  }

  public getHullDefinition(): Readonly<HullDefinition> {
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

  public worldCenterToGrid(worldCenter: Vec3, widthCells: number, heightCells: number): GridPosition | null {
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
      return this.isValidStandalonePlacement(position, widthCells, heightCells) ? position : null;
    } catch {
      return null;
    }
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
        const definition = roomView.resolveRoomDefinition();
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
    const result = this.resolveHullDefinition();
    let signature: string;
    if (result.ok === true) {
      signature = [this.gridRoot?.uuid ?? '', result.definition.id, result.definition.gridWidth, result.definition.gridHeight,
        result.definition.validCells.join(''), this.cellSize, this.gridLineWidth,
        this.gridBackgroundColor.toHEX('#rrggbbaa'), this.gridLineColor.toHEX('#rrggbbaa'),
        this.invalidHullCellColor.toHEX('#rrggbbaa')].join('|');
    } else {
      signature = `error|${result.code}|${result.message}`;
    }
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    if (this.previousGridRoot !== null && this.previousGridRoot !== this.gridRoot) this.previousGridRoot.getComponent(Graphics)?.clear();
    this.previousGridRoot = this.gridRoot;
    if (result.ok === false || this.gridRoot === null) {
      if (result.ok === false) error(`[SHIP] ${result.message}`);
      return;
    }
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
    graphics.fillColor = this.gridBackgroundColor;
    graphics.rect(originX, originY, width, height);
    graphics.fill();
    graphics.fillColor = this.invalidHullCellColor;
    for (let index = 0; index < hull.validCells.length; index += 1) {
      if (hull.validCells[index] === 1) continue;
      const x = index % hull.gridWidth;
      const y = Math.floor(index / hull.gridWidth);
      graphics.rect(originX + x * this.cellSize, originY + y * this.cellSize, this.cellSize, this.cellSize);
    }
    graphics.fill();
    graphics.lineWidth = this.gridLineWidth;
    graphics.strokeColor = this.gridLineColor;
    for (let index = 0; index < hull.validCells.length; index += 1) {
      if (hull.validCells[index] !== 1) continue;
      const x = index % hull.gridWidth;
      const y = Math.floor(index / hull.gridWidth);
      graphics.rect(originX + x * this.cellSize, originY + y * this.cellSize, this.cellSize, this.cellSize);
    }
    graphics.stroke();
  }

  private refreshEditorWorldTransform(): void {
    if (!EDITOR_NOT_IN_PREVIEW || this.gridRoot === null) return;
    let canvasChild = this.gridRoot;
    while (canvasChild.parent !== null && canvasChild.parent !== this.gridRoot.scene) canvasChild = canvasChild.parent;
    canvasChild.invalidateChildren(TransformBit.TRS);
    this.gridRoot.updateWorldTransform();
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

function ensureShipLayer(parent: Node, name: string, graphics = false): Node {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.layer = Layers.Enum.UI_2D;
  node.getComponent(UITransform) ?? node.addComponent(UITransform);
  if (graphics) node.getComponent(Graphics) ?? node.addComponent(Graphics);
  return node;
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
