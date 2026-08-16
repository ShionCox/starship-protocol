import { _decorator, Color, Component, Graphics, Layers, Node, UITransform } from 'cc';
import type { FloorInstanceSnapshot } from '../game-core/VoxelLayoutModel';
import type { FloorDefinition } from '../game-core/CsvGameConfig';
import { ShipView } from './ShipView';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/** 单格地板表现；规则坐标仍来自 ShipSnapshot，不保存世界像素坐标。 */
@ccclass('FloorView')
@executeInEditMode
@menu('星舰协议/场景表现/地板视图')
export class FloorView extends Component {
  @property({ displayName: '地板实例标识', tooltip: '同一飞船内唯一。', group: '地板实例' })
  public floorInstanceId = '';

  @property({ displayName: '地板定义标识', tooltip: '对应 floors.csv 的稳定 ID。', group: '地板实例' })
  public floorDefinitionId = 'floor-basic';

  @property({ displayName: '地板颜色', tooltip: '无贴图时的 Cocos Graphics 回退颜色。', group: '外观' })
  public fillColor = new Color(58, 91, 112, 255);

  @property({ displayName: '地板边线颜色', tooltip: '单格地板边线。', group: '外观' })
  public borderColor = new Color(105, 187, 207, 255);

  public ensureAuthoringPrefabStructure(): boolean {
    this.floorInstanceId = '';
    this.node.layer = Layers.Enum.UI_2D;
    this.getComponent(UITransform) ?? this.addComponent(UITransform);
    this.getComponent(Graphics) ?? this.addComponent(Graphics);
    this.draw(24);
    return true;
  }

  public bind(definition: Readonly<FloorDefinition>, snapshot: Readonly<FloorInstanceSnapshot>, shipView: ShipView): void {
    this.floorDefinitionId = definition.id;
    this.floorInstanceId = snapshot.instanceId;
    const parent = this.node.parent;
    const local = parent === null ? null : shipView.gridPositionToParentLocal(parent, snapshot, 1, 1);
    if (local !== null) this.node.setPosition(local);
    this.draw(shipView.cellSize);
  }

  /** 创作工具以整数格坐标放置持久 Floor Prefab；不把世界像素写入规则快照。 */
  public applyAuthoringPlacement(x: number, y: number): boolean {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    const shipView = findOwningShipView(this.node);
    const parent = this.node.parent;
    if (shipView === null || parent === null) return false;
    const local = shipView.gridPositionToParentLocal(parent, { x, y }, 1, 1);
    if (local === null) return false;
    this.node.setPosition(local);
    this.draw(shipView.cellSize);
    return true;
  }

  /** 只向扩展暴露稳定 ID；不返回组件 dump。 */
  public getAuthoringInspectorState(): { readonly floorInstanceId: string; readonly floorDefinitionId: string } {
    return { floorInstanceId: this.floorInstanceId.trim(), floorDefinitionId: this.floorDefinitionId.trim() };
  }

  public draw(cellSize: number): void {
    const transform = this.getComponent(UITransform);
    const graphics = this.getComponent(Graphics);
    if (transform === null || graphics === null) return;
    transform.setContentSize(cellSize, cellSize);
    graphics.clear();
    // 一格一块完整地板；内缩 1px 的边线防止相邻格视觉上连成无法辨认的整条色块。
    const inset = 1;
    graphics.fillColor = this.fillColor;
    graphics.rect(-cellSize / 2 + inset, -cellSize / 2 + inset, cellSize - inset * 2, cellSize - inset * 2);
    graphics.fill();
    graphics.strokeColor = this.borderColor;
    graphics.lineWidth = 1;
    graphics.rect(-cellSize / 2 + inset, -cellSize / 2 + inset, cellSize - inset * 2, cellSize - inset * 2);
    graphics.stroke();
  }
}

function findOwningShipView(node: Node): ShipView | null {
  let cursor: Node | null = node;
  while (cursor !== null) {
    const ship = cursor.getComponent(ShipView);
    if (ship !== null) return ship;
    cursor = cursor.parent;
  }
  return null;
}
