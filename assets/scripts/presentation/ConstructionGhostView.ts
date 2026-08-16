import { _decorator, Color, Component, EventMouse, Graphics, Label, Layers, Node, UITransform } from 'cc';
import type { ConstructionJobSnapshot } from '../game-core/ConstructionModel';
import { ShipView } from './ShipView';

const { ccclass, executeInEditMode, menu, property } = _decorator;

export type ConstructionSelectHandler = (jobId: string) => void;
export type ConstructionContextHandler = (jobId: string, event: EventMouse) => void;

/** 施工中的占格和进度表现；不决定合法性，也不修改施工快照。 */
@ccclass('ConstructionGhostView')
@executeInEditMode
@menu('星舰协议/场景表现/施工预览')
export class ConstructionGhostView extends Component {
  @property({ type: Label, displayName: '进度文字', tooltip: '显示施工类型和完成百分比。', group: '引用' })
  public progressLabel: Label | null = null;

  @property({ displayName: '施工颜色', tooltip: '合法施工预留范围颜色。', group: '外观' })
  public buildColor = new Color(62, 166, 208, 105);

  @property({ displayName: '拆除颜色', tooltip: '拆除预留范围颜色。', group: '外观' })
  public demolitionColor = new Color(238, 96, 80, 115);

  private job: Readonly<ConstructionJobSnapshot> | null = null;
  private width = 1;
  private height = 1;
  private shipView: ShipView | null = null;
  private selectHandler: ConstructionSelectHandler | null = null;
  private contextHandler: ConstructionContextHandler | null = null;
  private selected = false;

  protected onEnable(): void {
    this.node.on(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
  }

  public bind(
    job: Readonly<ConstructionJobSnapshot>,
    width: number,
    height: number,
    shipView: ShipView,
    selectHandler: ConstructionSelectHandler | null = null,
    contextHandler: ConstructionContextHandler | null = null,
  ): void {
    this.job = job;
    this.width = width;
    this.height = height;
    this.shipView = shipView;
    this.selectHandler = selectHandler;
    this.contextHandler = contextHandler;
    const parent = this.node.parent;
    const local = parent === null ? null : shipView.gridPositionToParentLocal(parent, job, width, height);
    if (local !== null) this.node.setPosition(local);
    const cell = shipView.cellSize;
    const transform = this.getComponent(UITransform);
    const graphics = this.getComponent(Graphics);
    if (transform !== null && graphics !== null) {
      transform.setContentSize(width * cell, height * cell);
      graphics.clear();
      graphics.fillColor = job.operation.startsWith('DEMOLISH') ? this.demolitionColor : this.buildColor;
      graphics.rect(-width * cell / 2, -height * cell / 2, width * cell, height * cell);
      graphics.fill();
      graphics.strokeColor = this.selected ? new Color(255, 220, 70, 255) : new Color(230, 245, 255, 230);
      graphics.lineWidth = this.selected ? 4 : 2;
      graphics.rect(-width * cell / 2, -height * cell / 2, width * cell, height * cell);
      graphics.stroke();
    }
    if (this.progressLabel !== null) {
      const progress = Math.floor(job.completedWorkMs * 100 / job.requiredWorkMs);
      this.progressLabel.string = `${job.operation.startsWith('DEMOLISH') ? '拆除' : '施工'} ${progress}%`;
    }
  }

  public setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    if (this.job !== null && this.shipView !== null) {
      this.bind(this.job, this.width, this.height, this.shipView, this.selectHandler, this.contextHandler);
    }
  }

  public ensureAuthoringPrefabStructure(): boolean {
    this.node.layer = Layers.Enum.UI_2D;
    this.getComponent(UITransform) ?? this.addComponent(UITransform);
    this.getComponent(Graphics) ?? this.addComponent(Graphics);
    this.progressLabel = this.getComponentInChildren(Label);
    return true;
  }

  private handleMouseDown(event: EventMouse): void {
    const jobId = this.job?.jobId ?? this.node.name;
    if (event.getButton() === EventMouse.BUTTON_LEFT && this.selectHandler !== null) {
      event.propagationStopped = true;
      this.selectHandler(jobId);
    } else if (event.getButton() === EventMouse.BUTTON_RIGHT && this.contextHandler !== null) {
      event.propagationStopped = true;
      this.contextHandler(jobId, event);
    }
  }
}
