import {
  _decorator,
  Color,
  Component,
  EventMouse,
  Graphics,
  JsonAsset,
  Label,
  Node,
  Tween,
  tween,
  UITransform,
  Vec3,
  warn,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import { findOwningShipView, ShipView } from './ShipView';
import {
  parseCrewDefinition,
  type CrewDefinition,
  type CrewDefinitionParseResult,
} from '../game-core/CrewDefinition';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import type { CrewReadState } from '../game-core/CrewModel';
import type { NavigationGraph } from '../game-core/NavigationGraph';
import { RoomView } from './RoomView';

const { ccclass, executeInEditMode, menu, property } = _decorator;

export type CrewSelectHandler = (crewInstanceId: string) => void;

/** 船员表现只处理中文可调外观、选择和移动插值，不修改 GameCore 状态。 */
@ccclass('CrewView')
@executeInEditMode
@menu('星舰协议/场景表现/船员视图')
export class CrewView extends Component {
  @property({ displayName: '船员实例标识', tooltip: '场景内唯一的稳定船员实例 ID。', group: '船员实例' })
  public crewInstanceId = '';

  @property({ displayName: '船员定义标识', tooltip: '必须与船员定义 JSON 中的稳定 ID 一致。', group: '船员定义' })
  public crewDefinitionId = 'crew-engineer';

  @property({ type: JsonAsset, displayName: '船员定义', tooltip: '网页原型和编辑器预览使用的版本化船员 JSON。', group: '船员定义' })
  public definitionAsset: JsonAsset | null = null;

  @property({ displayName: '初始房间实例标识', tooltip: '空存档时船员所在的房间实例 ID。', group: '初始站位' })
  public initialRoomInstanceId = '';

  @property({ displayName: '初始站位编号', tooltip: '从 0 开始；必须小于目标房间的船员容量。', group: '初始站位', min: 0, step: 1 })
  public initialStationIndex = 0;

  @property({ displayName: '船员主体颜色', tooltip: '船员圆形标记的填充颜色。', group: '外观' })
  public bodyColor = new Color(36, 184, 155, 255);

  @property({ displayName: '船员边框颜色', tooltip: '未选中状态的轮廓颜色。', group: '外观' })
  public borderColor = new Color(175, 255, 235, 255);

  @property({ displayName: '选中描边颜色', tooltip: '玩家选中该船员时显示的轮廓颜色。', group: '外观' })
  public selectedOutlineColor = new Color(255, 220, 70, 255);

  @property({ displayName: '船员标记直径', tooltip: '船员圆形标记的像素直径。', group: '外观', min: 16, step: 1 })
  public markerDiameter = 34;

  @property({ displayName: '移动插值时长', tooltip: '每个固定 Tick 之间的画面平滑时长；只影响表现，不改变 GameCore 移动速度。', group: '移动表现', min: 0.02, max: 0.2, step: 0.01 })
  public movementTweenSeconds = 0.1;

  private definition: Readonly<CrewDefinition> | null = null;
  private state: CrewReadState | null = null;
  private navigation: NavigationGraph | null = null;
  private shipView: ShipView | null = null;
  private selectHandler: CrewSelectHandler | null = null;
  private selected = false;
  private previewSignature = '';

  protected onEnable(): void {
    this.node.on(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
    if (EDITOR_NOT_IN_PREVIEW) this.refreshEditorPreview();
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.MOUSE_DOWN, this.handleMouseDown, this);
    Tween.stopAllByTarget(this.node);
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) this.refreshEditorPreview();
  }

  public resolveCrewDefinition(): CrewDefinitionParseResult {
    if (this.definitionAsset === null) {
      return { ok: false, code: 'INVALID_DOCUMENT', message: '请给船员预制体绑定船员定义 JSON' };
    }
    const result = parseCrewDefinition(this.definitionAsset.json);
    if (result.ok && result.definition.id !== this.crewDefinitionId.trim()) {
      return { ok: false, code: 'INVALID_ID', message: `船员定义 ID 不匹配：Inspector 为 ${this.crewDefinitionId || '空'}，JSON 为 ${result.definition.id}` };
    }
    return result;
  }

  /** 供创作插件在打开 Prefab 后验证绑定的稳定 ID 与 JSON。 */
  public validateAuthoringDefinition(): { readonly ok: boolean; readonly message: string } {
    const result = this.resolveCrewDefinition();
    if (result.ok === false) return { ok: false, message: result.message };
    return { ok: true, message: `船员定义有效：${result.definition.displayName}（${result.definition.id}）` };
  }

  /** 供创作插件把持久船员实例放到编辑器初始房间的可见站位。 */
  public applyEditorInitialPlacement(): boolean {
    const validation = this.validateInitialPlacement();
    if (validation.ok === false || validation.roomView === undefined || validation.roomDefinition === undefined) return false;
    const parent = this.node.parent;
    const shipView = findOwningShipView(this.node);
    const roomView = validation.roomView;
    const roomState = roomView.getAuthoringInspectorState();
    if (parent === null || shipView === null || roomState.ok !== true || roomState.gridPosition === undefined) return false;
    const center = shipView.gridPositionToParentLocal(
      parent,
      roomState.gridPosition,
      validation.roomDefinition.width,
      validation.roomDefinition.height,
    );
    if (center === null) return false;
    center.x += (this.initialStationIndex - (validation.roomDefinition.crewCapacity - 1) / 2) * shipView.cellSize * 0.42;
    center.y -= shipView.cellSize * 0.16;
    center.z = 20;
    this.node.setPosition(center);
    return true;
  }

  public getAuthoringInspectorState(): {
    readonly ok: boolean;
    readonly message: string;
    readonly crewInstanceId: string;
    readonly crewDefinitionId: string;
    readonly initialRoomInstanceId: string;
    readonly initialStationIndex: number;
  } {
    const result = this.resolveCrewDefinition();
    let message: string;
    let ok = result.ok;
    if (result.ok === false) message = result.message;
    else {
      const placement = this.validateInitialPlacement();
      ok = placement.ok;
      message = placement.ok ? `船员实例有效：${result.definition.displayName}` : placement.message;
    }
    return {
      ok,
      message,
      crewInstanceId: this.crewInstanceId.trim(),
      crewDefinitionId: this.crewDefinitionId.trim(),
      initialRoomInstanceId: this.initialRoomInstanceId.trim(),
      initialStationIndex: this.initialStationIndex,
    };
  }

  /**
   * 编辑器和运行时共用的初始站位不变量：目标房间必须存在且已通过 RoomView
   * 校验，站位编号必须落在该房间容量生成的 [0, capacity) 范围内。
   *
   * 这里不检查其他船员占位；场景中已有实例的重复站位由 GameCore 在启动时拒绝，
   * 创作插件则在创建前单独分配最低空闲站位。
   */
  private validateInitialPlacement(): {
    readonly ok: boolean;
    readonly message: string;
    readonly roomView?: RoomView;
    readonly roomDefinition?: Readonly<RoomDefinition>;
  } {
    const roomInstanceId = this.initialRoomInstanceId.trim();
    if (roomInstanceId === '') {
      return { ok: false, message: '船员初始房间标识不能为空' };
    }
    const shipView = findOwningShipView(this.node);
    if (shipView?.roomRoot === null || shipView?.roomRoot === undefined) {
      return { ok: false, message: `船员初始房间不存在：${roomInstanceId}` };
    }
    const roomView = shipView.roomRoot.getComponentsInChildren(RoomView)
      .find((view) => view.roomInstanceId.trim() === roomInstanceId);
    if (roomView === undefined) {
      return { ok: false, message: `船员初始房间不存在：${roomInstanceId}` };
    }
    const roomDefinition = roomView.resolveRoomDefinition();
    if (roomDefinition.ok === false) {
      return { ok: false, message: `船员初始房间定义无效：${roomInstanceId}，${roomDefinition.message}` };
    }
    const roomState = roomView.getAuthoringInspectorState();
    if (roomState.ok !== true) {
      return { ok: false, message: `船员初始房间校验失败：${roomState.message}` };
    }
    const capacity = roomDefinition.definition.crewCapacity;
    if (!Number.isInteger(capacity) || capacity < 0) {
      return { ok: false, message: `船员初始房间容量无效：${roomInstanceId}` };
    }
    if (!Number.isInteger(this.initialStationIndex) || this.initialStationIndex < 0) {
      return { ok: false, message: `船员初始站位必须是非负整数：${this.initialStationIndex}` };
    }
    if (this.initialStationIndex >= capacity) {
      return { ok: false, message: `船员初始站位超出房间容量：${this.initialStationIndex}（容量 ${capacity}）` };
    }
    return { ok: true, message: '', roomView, roomDefinition: roomDefinition.definition };
  }

  public bind(
    definition: Readonly<CrewDefinition>,
    state: CrewReadState,
    navigation: NavigationGraph,
    shipView: ShipView,
    selectHandler: CrewSelectHandler,
  ): void {
    this.definition = definition;
    this.navigation = navigation;
    this.shipView = shipView;
    this.selectHandler = selectHandler;
  }

  public setNavigation(navigation: NavigationGraph): void {
    this.navigation = navigation;
  }

  public setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.draw();
  }

  public refresh(state: CrewReadState, animate = true): void {
    this.state = state;
    const current = this.resolveNodePosition(state.currentNodeId);
    const next = state.nextNodeId === null ? null : this.resolveNodePosition(state.nextNodeId);
    const target = current === null
      ? next
      : next === null
        ? current
        : Vec3.lerp(new Vec3(), current, next, Math.min(1, Math.max(0, state.edgeProgress)));
    if (target !== null) {
      Tween.stopAllByTarget(this.node);
      if (animate && !EDITOR_NOT_IN_PREVIEW) tween(this.node).to(this.movementTweenSeconds, { position: target }).start();
      else this.node.setPosition(target);
    }
    const label = this.node.getChildByName('船员名称')?.getComponent(Label) ?? null;
    if (label !== null) label.string = this.definition?.displayName ?? this.crewInstanceId;
    this.draw();
  }

  private handleMouseDown(event: EventMouse): void {
    if (event.getButton() !== EventMouse.BUTTON_LEFT || this.selectHandler === null) return;
    event.propagationStopped = true;
    this.selectHandler(this.crewInstanceId.trim());
  }

  private resolveNodePosition(nodeId: string): Vec3 | null {
    const parent = this.node.parent;
    const navigationNode = this.navigation?.getNode(nodeId) ?? null;
    const placement = navigationNode === null ? null : this.navigation?.getRoomPlacement(navigationNode.roomId) ?? null;
    if (parent === null || navigationNode === null || placement === null || this.shipView === null) return null;
    const center = this.shipView.gridPositionToParentLocal(parent, placement, placement.width, placement.height);
    if (center === null) return null;
    if (navigationNode.kind === 'STATION') {
      const count = this.navigation?.getRoomStationCount(navigationNode.roomId) ?? 1;
      center.x += ((navigationNode.stationIndex ?? 0) - (count - 1) / 2) * this.shipView.cellSize * 0.42;
      center.y -= this.shipView.cellSize * 0.16;
    } else {
      center.y += this.shipView.cellSize * 0.2;
    }
    center.z = 20;
    return center;
  }

  private refreshEditorPreview(): void {
    const result = this.resolveCrewDefinition();
    let previewText: string;
    if (result.ok === false) previewText = result.message;
    else previewText = result.definition.displayName;
    const signature = [
      previewText,
      this.markerDiameter,
      this.bodyColor.toHEX('#rrggbbaa'),
      this.borderColor.toHEX('#rrggbbaa'),
      this.selectedOutlineColor.toHEX('#rrggbbaa'),
    ].join('|');
    if (signature === this.previewSignature) return;
    this.previewSignature = signature;
    if (result.ok === false) warn(`[UI] ${result.message}`);
    const label = this.node.getChildByName('船员名称')?.getComponent(Label) ?? null;
    if (label !== null) label.string = result.ok ? result.definition.displayName : '船员';
    this.draw();
  }

  private draw(): void {
    const transform = this.getComponent(UITransform);
    const graphics = this.getComponent(Graphics);
    if (transform === null || graphics === null || this.markerDiameter <= 0) return;
    transform.setContentSize(this.markerDiameter + 10, this.markerDiameter + 10);
    graphics.clear();
    graphics.fillColor = this.bodyColor;
    graphics.circle(0, 0, this.markerDiameter / 2);
    graphics.fill();
    graphics.lineWidth = this.selected ? 4 : 2;
    graphics.strokeColor = this.selected ? this.selectedOutlineColor : this.borderColor;
    graphics.circle(0, 0, this.markerDiameter / 2);
    graphics.stroke();
  }
}
