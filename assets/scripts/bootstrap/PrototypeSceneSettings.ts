import {
  _decorator,
  Color,
  Component,
  error,
  Graphics,
  Node,
  TransformBit,
  UITransform,
  Vec2,
  Vec3,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import {
  SHIP_GRID_HEIGHT,
  SHIP_GRID_WIDTH,
  ShipGridModel,
  validateRoomPlacement,
  type GridPosition,
} from '../game-core/ShipGridModel';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import { findPrototypeSceneNode } from './PrototypeSceneNodes';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/**
 * PrototypeScene 的唯一场景参数入口。
 *
 * 网格尺寸、外观和编辑器吸附都从这里读取，避免在 GridRoot 或各个房间上形成多份配置。
 */
@ccclass('PrototypeSceneSettings')
@executeInEditMode
@menu('星舰协议/场景/原型场景设置')
export class PrototypeSceneSettings extends Component {
  @property({
    type: Node,
    displayName: '网格根节点',
    tooltip: '用于绘制飞船网格的 GridRoot 节点。',
    group: '节点引用',
  })
  public gridRoot: Node | null = null;

  @property({
    displayName: '网格列数',
    tooltip: '飞船逻辑网格的横向格子数量，同时用于创建 GameCore 网格。',
    group: '网格参数',
    min: 1,
    step: 1,
  })
  public gridColumns = SHIP_GRID_WIDTH;

  @property({
    displayName: '网格行数',
    tooltip: '飞船逻辑网格的纵向格子数量，同时用于创建 GameCore 网格。',
    group: '网格参数',
    min: 1,
    step: 1,
  })
  public gridRows = SHIP_GRID_HEIGHT;

  @property({
    displayName: '格子尺寸（像素）',
    tooltip: '单个逻辑格在场景中的显示尺寸和吸附步长。',
    group: '网格参数',
    min: 1,
    step: 1,
  })
  public cellSize = 48;

  @property({
    displayName: '房间拖动自动吸附',
    tooltip: '在场景编辑器中拖动房间时，按照本场景的格子尺寸自动吸附。',
    group: '网格参数',
  })
  public snapRoomsInEditor = true;

  @property({
    type: [Vec2],
    displayName: '无效船体格',
    tooltip: '不能放置房间的逻辑格坐标。R0 默认把左上角 2×2 区域标记为无效格，便于验证船体边界。',
    group: '网格参数',
  })
  public invalidHullCells = [new Vec2(0, 8), new Vec2(1, 8), new Vec2(0, 9), new Vec2(1, 9)];

  @property({
    displayName: '网格背景颜色',
    tooltip: '飞船逻辑网格的底色。',
    group: '网格外观',
  })
  public gridBackgroundColor = new Color(8, 19, 34, 230);

  @property({
    displayName: '网格线颜色',
    tooltip: '逻辑格分隔线的颜色。',
    group: '网格外观',
  })
  public gridLineColor = new Color(78, 121, 148, 210);

  @property({
    displayName: '网格线宽度',
    tooltip: '逻辑格分隔线的显示宽度。',
    group: '网格外观',
    min: 1,
    step: 1,
  })
  public gridLineWidth = 1;

  @property({
    displayName: '无效船体格颜色',
    tooltip: '编辑器和运行时中无效船体格的底色。',
    group: '网格外观',
  })
  public invalidHullCellColor = new Color(70, 35, 42, 230);

  private editorPreviewSignature = '';
  private previousGridRoot: Node | null = null;

  protected onEnable(): void {
    this.refreshGridPreview();
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      this.refreshGridPreview();
    }
  }

  public hasValidGridConfig(): boolean {
    const invalidHullCells = this.invalidHullCells;
    return (
      Number.isInteger(this.gridColumns) &&
      Number.isInteger(this.gridRows) &&
      Number.isInteger(this.cellSize) &&
      this.gridColumns > 0 &&
      this.gridRows > 0 &&
      this.cellSize > 0 &&
      Array.isArray(invalidHullCells) &&
      invalidHullCells.every((cell) => (
        Number.isInteger(cell.x) &&
        Number.isInteger(cell.y) &&
        cell.x >= 0 &&
        cell.y >= 0 &&
        cell.x < this.gridColumns &&
        cell.y < this.gridRows
      ))
    );
  }

  /** SceneSettings 中的无效格是设计输入；GameCore 只接收有效逻辑格列表。 */
  public getValidHullCells(): readonly GridPosition[] {
    if (!this.hasValidGridConfig()) {
      throw new RangeError('场景网格或无效船体格配置不合法');
    }

    const invalidCells = new Set(this.invalidHullCells.map((cell) => `${cell.x},${cell.y}`));
    const validCells: GridPosition[] = [];
    for (let y = 0; y < this.gridRows; y += 1) {
      for (let x = 0; x < this.gridColumns; x += 1) {
        if (!invalidCells.has(`${x},${y}`)) {
          validCells.push({ x, y });
        }
      }
    }
    return validCells;
  }

  /** 将整数逻辑格转换为 GridRoot 本地坐标中的格子中心。 */
  public gridToLocal(position: GridPosition): Vec3 {
    if (!this.hasValidGridConfig()) {
      throw new RangeError('场景网格行列数和格子尺寸必须是正整数');
    }

    const originX = -(this.gridColumns * this.cellSize) / 2;
    const originY = -(this.gridRows * this.cellSize) / 2;
    return new Vec3(
      originX + (position.x + 0.5) * this.cellSize,
      originY + (position.y + 0.5) * this.cellSize,
      0,
    );
  }

  public localToGrid(localX: number, localY: number): GridPosition | null {
    if (!this.hasValidGridConfig()) {
      return null;
    }

    const originX = -(this.gridColumns * this.cellSize) / 2;
    const originY = -(this.gridRows * this.cellSize) / 2;
    const x = Math.floor((localX - originX) / this.cellSize);
    const y = Math.floor((localY - originY) / this.cellSize);
    return x >= 0 && y >= 0 && x < this.gridColumns && y < this.gridRows ? { x, y } : null;
  }

  /** 将房间世界坐标吸附为最接近的逻辑网格左下角。 */
  public worldCenterToGrid(
    worldCenter: Vec3,
    widthCells: number,
    heightCells: number,
  ): GridPosition | null {
    if (this.gridRoot === null || !this.hasValidRoomSize(widthCells, heightCells)) {
      return null;
    }

    this.refreshEditorWorldTransform();
    const localCenter = this.gridRoot.inverseTransformPoint(new Vec3(), worldCenter);
    const originX = -(this.gridColumns * this.cellSize) / 2;
    const originY = -(this.gridRows * this.cellSize) / 2;
    return {
      x: Math.round((localCenter.x - originX) / this.cellSize - widthCells / 2),
      y: Math.round((localCenter.y - originY) / this.cellSize - heightCells / 2),
    };
  }

  /** 将逻辑房间中心转换为目标父节点的本地坐标。 */
  public gridPositionToParentLocal(
    parent: Node,
    gridPosition: GridPosition,
    widthCells: number,
    heightCells: number,
  ): Vec3 | null {
    if (this.gridRoot === null || !this.hasValidRoomSize(widthCells, heightCells)) {
      return null;
    }

    this.refreshEditorWorldTransform();
    const firstCell = this.gridToLocal(gridPosition);
    const gridCenter = new Vec3(
      firstCell.x + ((widthCells - 1) * this.cellSize) / 2,
      firstCell.y + ((heightCells - 1) * this.cellSize) / 2,
      0,
    );
    const worldCenter = Vec3.transformMat4(new Vec3(), gridCenter, this.gridRoot.worldMatrix);
    return parent.inverseTransformPoint(new Vec3(), worldCenter);
  }

  /**
   * 编辑器语义创建房间时寻找第一个合法空位。
   * 位置判断复用 GameCore，避免插件或场景组件各自实现一套边界/重叠规则。
   */
  public findFirstAvailableRoomPlacement(
    widthCells: number,
    heightCells: number,
  ): GridPosition | null {
    if (!this.hasValidRoomSize(widthCells, heightCells) || this.gridRoot === null) {
      return null;
    }

    const grid = new ShipGridModel(this.gridColumns, this.gridRows, this.getValidHullCells());
    const roomRoot = this.gridRoot.parent === null
      ? null
      : findPrototypeSceneNode(this.gridRoot.parent, 'roomRoot');
    if (roomRoot !== null) {
      for (const roomNode of roomRoot.children) {
        const roomView = roomNode.getComponent('RoomView') as {
          roomInstanceId?: string;
          resolveRoomDefinition?: () => { ok: true; definition: RoomDefinition } | { ok: false };
        } | null;
        if (roomView?.resolveRoomDefinition === undefined) continue;
        const definitionResult = roomView.resolveRoomDefinition();
        if (!definitionResult.ok || typeof roomView.roomInstanceId !== 'string') continue;
        const position = this.worldCenterToGrid(roomNode.worldPosition, definitionResult.definition.width, definitionResult.definition.height);
        if (position === null) continue;
        grid.placeRoom({
          id: roomView.roomInstanceId.trim(),
          ...position,
          width: definitionResult.definition.width,
          height: definitionResult.definition.height,
        });
      }
    }

    for (let y = 0; y < this.gridRows; y += 1) {
      for (let x = 0; x < this.gridColumns; x += 1) {
        const candidate = { x, y };
        if (validateRoomPlacement(grid, {
          id: '__editor_candidate__',
          ...candidate,
          width: widthCells,
          height: heightCells,
        }).ok) {
          return candidate;
        }
      }
    }
    return null;
  }

  private refreshGridPreview(): void {
    this.refreshEditorWorldTransform();
    const invalidHullCells = Array.isArray(this.invalidHullCells) ? this.invalidHullCells : [];
    const signature = [
      this.gridRoot?.uuid ?? '',
      this.gridColumns,
      this.gridRows,
      this.cellSize,
      this.gridLineWidth,
      this.gridBackgroundColor.toHEX('#rrggbbaa'),
      this.gridLineColor.toHEX('#rrggbbaa'),
      this.invalidHullCellColor.toHEX('#rrggbbaa'),
      Array.isArray(this.invalidHullCells) ? 'VALID_ARRAY' : 'INVALID_ARRAY',
      ...invalidHullCells.map((cell) => `${cell.x},${cell.y}`),
    ].join('|');
    if (signature === this.editorPreviewSignature) {
      return;
    }
    this.editorPreviewSignature = signature;

    if (this.previousGridRoot !== null && this.previousGridRoot !== this.gridRoot) {
      this.previousGridRoot.getComponent(Graphics)?.clear();
    }
    this.previousGridRoot = this.gridRoot;

    if (this.gridRoot === null) {
      return;
    }
    if (!this.hasValidGridConfig() || !Number.isFinite(this.gridLineWidth) || this.gridLineWidth <= 0) {
      error('[SCENE] 网格行列数、格子尺寸和线宽必须是正数');
      return;
    }
    this.drawGrid();
  }

  /**
   * Canvas 会在编辑器载入场景后再执行一次屏幕对齐。3.8.x 的编辑态下，
   * 由其他节点上的 executeInEditMode 组件驱动 Graphics 时，后代节点偶尔会保留
   * 对齐前的世界矩阵。这里只让引擎重新计算矩阵，不修改任何已保存的节点坐标。
   */
  private refreshEditorWorldTransform(): void {
    if (!EDITOR_NOT_IN_PREVIEW || this.gridRoot === null) {
      return;
    }

    let canvasChild = this.gridRoot;
    while (canvasChild.parent !== null && canvasChild.parent !== this.gridRoot.scene) {
      canvasChild = canvasChild.parent;
    }
    canvasChild.invalidateChildren(TransformBit.TRS);
    this.gridRoot.updateWorldTransform();
  }

  private drawGrid(): void {
    if (this.gridRoot === null) {
      return;
    }

    const width = this.gridColumns * this.cellSize;
    const height = this.gridRows * this.cellSize;
    const originX = -width / 2;
    const originY = -height / 2;
    const transform = this.gridRoot.getComponent(UITransform);
    const graphics = this.gridRoot.getComponent(Graphics);
    if (transform === null || graphics === null) {
      error('[SCENE] 请在 Cocos 编辑器中给 GridRoot 持久挂载 UITransform 和 Graphics');
      return;
    }

    transform.setContentSize(width, height);
    graphics.clear();
    graphics.fillColor = this.gridBackgroundColor;
    graphics.rect(originX, originY, width, height);
    graphics.fill();
    if (this.invalidHullCells.length > 0) {
      graphics.fillColor = this.invalidHullCellColor;
      for (const cell of this.invalidHullCells) {
        graphics.rect(
          originX + cell.x * this.cellSize,
          originY + cell.y * this.cellSize,
          this.cellSize,
          this.cellSize,
        );
      }
      graphics.fill();
    }
    graphics.lineWidth = this.gridLineWidth;
    graphics.strokeColor = this.gridLineColor;

    for (let x = 0; x <= this.gridColumns; x += 1) {
      const localX = originX + x * this.cellSize;
      graphics.moveTo(localX, originY);
      graphics.lineTo(localX, originY + height);
    }
    for (let y = 0; y <= this.gridRows; y += 1) {
      const localY = originY + y * this.cellSize;
      graphics.moveTo(originX, localY);
      graphics.lineTo(originX + width, localY);
    }
    graphics.stroke();
  }

  private hasValidRoomSize(widthCells: number, heightCells: number): boolean {
    return (
      this.hasValidGridConfig() &&
      Number.isInteger(widthCells) &&
      Number.isInteger(heightCells) &&
      widthCells > 0 &&
      heightCells > 0
    );
  }
}
