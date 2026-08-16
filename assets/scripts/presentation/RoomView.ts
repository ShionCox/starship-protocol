import {
  _decorator,
  Color,
  Component,
  error,
  EventMouse,
  Graphics,
  Node,
  TransformBit,
  UITransform,
  warn,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW, NATIVE } from 'cc/env';

import { findOwningShipView, ShipView } from './ShipView';
import { RoomAppearance } from './RoomAppearance';
import {
  parseRoomDefinition,
  type RoomDefinition,
  type RoomDefinitionParseResult,
} from '../game-core/RoomDefinition';
import type {
  GridPosition,
  RoomPlacement,
} from '../game-core/ShipGridModel';
import { ShipGridModel, validateRoomPlacement } from '../game-core/ShipGridModel';

const { ccclass, executeInEditMode, menu, property } = _decorator;

type RoomClickHandler = (roomInstanceId: string) => void;
type RoomContextHandler = (roomInstanceId: string, event: EventMouse) => void;

@ccclass('RoomView')
@executeInEditMode
@menu('星舰协议/场景表现/房间视图')
export class RoomView extends Component {
  @property({
    displayName: '房间实例标识',
    tooltip: '同一场景内必须唯一；存档和移动命令使用这个稳定字符串标识。',
    group: '房间实例',
  })
  public roomInstanceId = '';

  @property({
    displayName: '房间定义标识',
    tooltip: '必须与绑定房间规则文件的稳定标识一致。',
    group: '房间定义',
  })
  public roomDefinitionId = 'room-reactor';

  @property({ displayName: '房间底色', tooltip: '房间主体填充颜色。', group: '外观' })
  public fillColor = new Color(185, 92, 35, 245);

  @property({ displayName: '房间边框颜色', tooltip: '房间外框颜色。', group: '外观' })
  public borderColor = new Color(255, 193, 92, 255);

  @property({ displayName: '核心标记颜色', tooltip: '房间中央标记颜色。', group: '外观' })
  public coreColor = new Color(255, 224, 148, 255);

  @property({ type: RoomAppearance, displayName: '原生房间外观', tooltip: '可选的 Sprite/Animation 外观适配器；未绑定时继续使用 Graphics 绘制。', group: '外观' })
  public roomAppearance: RoomAppearance | null = null;

  @property({ displayName: '初始耐久', tooltip: '-1 表示按房间定义的最大耐久启动；仅用于开发场景初始状态。', min: -1, step: 1, group: '开发初始状态' })
  public initialHp = -1;

  @property({ displayName: '合法预览边框', tooltip: '运行时拖到合法位置时使用的边框颜色。', group: '拖放预览' })
  public validPreviewBorderColor = new Color(94, 220, 132, 255);

  @property({ displayName: '非法预览边框', tooltip: '运行时拖到非法位置时使用的边框颜色。', group: '拖放预览' })
  public invalidPreviewBorderColor = new Color(255, 92, 92, 255);

  @property({ displayName: '选中边框', tooltip: '左键选中房间或连接器时使用的边框颜色。', group: '交互外观' })
  public selectedBorderColor = new Color(255, 220, 70, 255);

  private editorPreviewSignature = '';
  private editorRenderPositionSignature = '';
  private isSnappingInEditor = false;
  private editorSnapScheduled = false;
  private definition: RoomDefinition | null = null;
  private authoringPreviewResult: RoomDefinitionParseResult | null = null;
  private placement: RoomPlacement | null = null;
  private shipView: ShipView | null = null;
  private handleRoomClick: RoomClickHandler | null = null;
  private handleRoomContext: RoomContextHandler | null = null;
  private selected = false;
  private runtimeHp = -1;
  private runtimeMaxHp = 0;
  private runtimeRepairing = false;

  protected onEnable(): void {
    if (!NATIVE || EDITOR_NOT_IN_PREVIEW) {
      this.refreshPreview();
    }
    if (EDITOR_NOT_IN_PREVIEW) {
      this.node.on(Node.EventType.TRANSFORM_CHANGED, this.handleEditorTransformChanged, this);
      this.scheduleEditorGridSnap();
    } else {
      this.node.on(Node.EventType.MOUSE_DOWN, this.handleRuntimeMouseDown, this);
    }
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.TRANSFORM_CHANGED, this.handleEditorTransformChanged, this);
    this.editorSnapScheduled = false;
    this.node.off(Node.EventType.MOUSE_DOWN, this.handleRuntimeMouseDown, this);
  }

  /** Creator 编辑器在 Undo/Redo 恢复序列化状态后调用，用于重建非序列化预览缓存。 */
  protected onRestore(): void {
    if (!EDITOR_NOT_IN_PREVIEW) {
      return;
    }
    this.editorPreviewSignature = '';
    this.editorRenderPositionSignature = '';
    this.authoringPreviewResult = null;
    this.scheduleEditorGridSnap();
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      if (this.editorSnapScheduled) this.flushEditorGridSnap();
      this.refreshPreview();
    }
  }

  /** 场景实例只读取所属 ShipView 已持久连接的应用根配置来源。 */
  public resolveRoomDefinition(): RoomDefinitionParseResult {
    const source = this.findShipView()?.configSource;
    const resolved = source?.resolve();
    if (resolved === undefined) return { ok: false, code: 'INVALID_DOCUMENT', message: '请绑定权威 CSV 来源' };
    if (resolved.ok === false) return { ok: false, code: 'INVALID_DOCUMENT', message: resolved.message };
    const definition = resolved.config.rooms.find((entry) => entry.id === this.roomDefinitionId.trim());
    return definition === undefined
      ? { ok: false, code: 'INVALID_ID', message: `rooms.csv 不包含房间定义：${this.roomDefinitionId || '空'}` }
      : { ok: true, definition };
  }

  /** 返回定义稳定 ID，供本地配置目录和未来服务端配置目录使用。 */
  public getRoomDefinitionId(): string {
    return this.roomDefinitionId.trim();
  }

  /** 供编辑器语义创建命令把新实例放到已计算的整数逻辑格。 */
  public applyEditorPlacement(position: GridPosition): boolean {
    const shipView = this.findShipView();
    const parent = this.node.parent;
    const definitionResult = this.resolveRoomDefinition();
    if (shipView === null || parent === null || definitionResult.ok === false) {
      return false;
    }
    const local = shipView.gridPositionToParentLocal(
      parent,
      position,
      definitionResult.definition.width,
      definitionResult.definition.height,
    );
    if (local === null) return false;
    this.node.setPosition(local);
    return true;
  }

  /** 供 Cocos 编辑器扩展通过公开 execute-component-method 调用。 */
  public validateAuthoringDefinition(): { readonly ok: boolean; readonly message: string } {
    const result = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    if (result.ok === false) {
      return { ok: false, message: result.message };
    }
    return { ok: true, message: `房间定义有效：${result.definition.displayName}（${result.definition.id}）` };
  }

  /** 创作面板以内存配置行刷新预览，不改写 CSV 或场景序列化数据。 */
  public applyAuthoringDefinitionPreview(document: unknown): boolean {
    const documentId = typeof document === 'object' && document !== null && typeof (document as { id?: unknown }).id === 'string'
      ? (document as { id: string }).id.trim()
      : '';
    if (documentId !== this.roomDefinitionId.trim()) return true;
    const result = parseRoomDefinition(document);
    const previous = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    const previousGrid = previous.ok === true ? this.captureAuthoringGrid(previous.definition) : null;
    this.authoringPreviewResult = result;
    this.editorPreviewSignature = '';
    if (result.ok === false) {
      this.draw(1, 1, this.findShipView()?.cellSize ?? 24, this.invalidPreviewBorderColor);
      return false;
    }
    const cellSize = this.findShipView()?.cellSize ?? 24;
    this.runtimeHp = result.definition.maxHp;
    this.runtimeMaxHp = result.definition.maxHp;
    this.runtimeRepairing = false;
    const valid = previousGrid === null || this.applyAuthoringLayout(previousGrid, result.definition);
    this.draw(result.definition.width, result.definition.height, cellSize, valid ? null : this.invalidPreviewBorderColor);
    return valid;
  }

  /**
   * 清空创作定义的内存预览覆盖，并立即按权威 CSV 重绘当前房间表现。
   * 这里只重建非序列化缓存和 Graphics，不写 Scene，也不创建 Undo 记录。
   */
  public clearAuthoringDefinitionPreview(): void {
    this.authoringPreviewResult = null;
    this.editorPreviewSignature = '';
    this.editorRenderPositionSignature = '';
    this.refreshPreview();
  }

  /** 由船体/房间定义刷新触发，保持原逻辑格并在冲突时保留原位置标红。 */
  public refreshAuthoringLayoutPreview(): boolean {
    const result = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    if (result.ok === false) {
      this.draw(1, 1, this.findShipView()?.cellSize ?? 24, this.invalidPreviewBorderColor);
      return false;
    }
    // 单独打开房间 Prefab 时没有所属 ShipView；此时只刷新自身尺寸，不做场景网格校验。
    if (this.findShipView() === null || this.node.parent === null) {
      this.editorPreviewSignature = '';
      this.draw(result.definition.width, result.definition.height, 24);
      return true;
    }
    const current = this.captureAuthoringGrid(result.definition);
    if (current === null) {
      this.draw(result.definition.width, result.definition.height, this.findShipView()?.cellSize ?? 24, this.invalidPreviewBorderColor);
      return false;
    }
    const valid = this.applyAuthoringLayout(current, result.definition);
    this.editorPreviewSignature = '';
    this.draw(result.definition.width, result.definition.height, this.findShipView()?.cellSize ?? 24, valid ? null : this.invalidPreviewBorderColor);
    return valid;
  }

  /** 供 ShipView 重建布局时读取当前编辑器预览定义；不暴露 Component 或 TextAsset。 */
  public getAuthoringDefinitionForLayout(): RoomDefinition | null {
    const result = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    return result.ok === true ? result.definition : null;
  }

  /**
   * 仅供项目创作插件把复制出的房间 Prefab 转换成其他模板。
   * 组件销毁仍通过 Cocos 公共对象生命周期完成，转换后的资源必须由 Creator 保存。
   */
  public removeForAuthoringTemplateConversion(): boolean {
    // 复制房间 Prefab 作为正式基础模板时，不应把房间专属的橙色图形带入 UI 或飞船根。
    const graphics = this.getComponent(Graphics);
    if (graphics !== null) this.node.removeComponent(graphics);
    this.node.removeComponent(this);
    return true;
  }

  /**
   * 编辑器面板只读取这份白名单 DTO，不把 Component、Node 或世界坐标对象泄露给扩展。
   * 逻辑位置继续由 SceneSettings 统一换算，保证面板和运行时使用同一套网格基准。
   */
  public getAuthoringInspectorState(): {
    readonly ok: boolean;
    readonly message: string;
    readonly roomInstanceId: string;
    readonly roomDefinitionId: string;
    readonly crewCapacity?: number;
    readonly initialHp?: number;
    readonly maxHp?: number;
    readonly gridPosition?: GridPosition;
  } {
    const definitionResult = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    const shipView = this.findShipView();
    const base = {
      roomInstanceId: this.roomInstanceId.trim(),
      roomDefinitionId: this.roomDefinitionId.trim(),
    };
    if (definitionResult.ok === false) {
      return { ...base, ok: false, message: definitionResult.message };
    }
    if (!this.isInitialHpValid(definitionResult.definition)) {
      return { ...base, ok: false, message: `初始耐久必须是 -1 或 0 到 ${definitionResult.definition.maxHp} 的整数` };
    }
    if (shipView === null) {
      return { ...base, ok: false, message: '房间不属于有效飞船视图，无法换算逻辑格位置' };
    }
    const parent = this.node.parent;
    if (parent === null) {
      return { ...base, ok: false, message: '房间缺少父节点，无法换算逻辑格位置' };
    }
    const gridPosition = shipView.parentLocalCenterToGrid(
      parent,
      this.node.position,
      definitionResult.definition.width,
      definitionResult.definition.height,
    );
    if (gridPosition === null) {
      return { ...base, ok: false, message: '房间世界坐标无法换算为有效逻辑格位置' };
    }
    return {
      ...base,
      ok: true,
      message: `房间实例有效：${definitionResult.definition.displayName}`,
      crewCapacity: definitionResult.definition.crewCapacity,
      initialHp: this.initialHp,
      maxHp: definitionResult.definition.maxHp,
      gridPosition,
    };
  }

  /**
   * Prefab 只负责表现；房间尺寸和逻辑坐标来自纯 TS 配置与状态。
   */
  public bind(
    definition: RoomDefinition,
    placement: RoomPlacement,
    shipView: ShipView,
    handleRoomClick: RoomClickHandler | null = null,
    handleRoomContext: RoomContextHandler | null = null,
  ): void {
    const parent = this.node.parent;
    const roomCenter = parent === null
      ? null
      : shipView.gridPositionToParentLocal(parent, placement, definition.width, definition.height);
    if (roomCenter === null) {
      error('[UI] 房间缺少父节点或场景网格设置，无法绑定到逻辑网格');
      return;
    }

    this.definition = definition;
    this.placement = { ...placement };
    this.shipView = shipView;
    this.handleRoomClick = handleRoomClick;
    this.handleRoomContext = handleRoomContext;
    this.runtimeHp = this.initialHp === -1 ? definition.maxHp : this.initialHp;
    this.runtimeMaxHp = definition.maxHp;
    this.runtimeRepairing = false;
    this.node.name = `房间-${placement.instanceId}`;
    this.node.setPosition(roomCenter);
    this.draw(definition.width, definition.height, shipView.cellSize);
    this.getRoomAppearance()?.refreshPreview();
  }

  /** 运行时只读取 ShipSnapshot 的权威耐久；View 不自行修改规则状态。 */
  public refreshRuntimeState(hp: number, repairing: boolean, powered?: boolean): void {
    if (this.definition === null || this.shipView === null || !Number.isInteger(hp) || hp < 0 || hp > this.definition.maxHp) {
      error('[UI] 房间耐久状态无效，无法刷新房间视图');
      return;
    }
    this.runtimeHp = hp;
    this.runtimeMaxHp = this.definition.maxHp;
    this.runtimeRepairing = repairing;
    if (powered !== undefined) this.getRoomAppearance()?.setPowered(powered);
    this.draw(
      this.definition.width,
      this.definition.height,
      this.shipView.cellSize,
      repairing ? this.validPreviewBorderColor : null,
    );
  }

  /** 供上层在能源快照变化时单独刷新表现；没有外观组件时安全忽略。 */
  public refreshPowered(powered: boolean): void {
    this.getRoomAppearance()?.setPowered(powered);
  }

  public setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.drawRuntimeNormalState();
  }

  private draw(
    widthCells: number,
    heightCells: number,
    cellSize: number,
    previewBorderColor: Color | null = null,
  ): void {
    if (
      !Number.isInteger(widthCells) ||
      !Number.isInteger(heightCells) ||
      !Number.isInteger(cellSize) ||
      widthCells <= 0 ||
      heightCells <= 0 ||
      cellSize <= 0
    ) {
      error('[UI] 房间预览尺寸必须是正整数');
      return;
    }

    const transform = this.getComponent(UITransform);
    const graphics = this.getComponent(Graphics);
    if (transform === null || graphics === null) {
      error('[UI] 请在 Cocos 编辑器中给房间 Prefab 持久挂载 UITransform 和 Graphics');
      return;
    }

    const width = widthCells * cellSize;
    const height = heightCells * cellSize;
    transform.setContentSize(width, height);

    const appearance = this.getRoomAppearance();
    appearance?.setGridDisplaySize(width, height);
    const hasImage = appearance?.hasRenderableVisual() === true;

    const effectiveBorder = previewBorderColor ?? (this.selected ? this.selectedBorderColor : null);
    graphics.clear();
    if (!hasImage) {
      graphics.fillColor = this.fillColor;
      graphics.roundRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, 8);
      graphics.fill();
      graphics.lineWidth = 3;
      graphics.strokeColor = effectiveBorder ?? this.borderColor;
      graphics.roundRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, 8);
      graphics.stroke();

      graphics.lineWidth = 5;
      graphics.strokeColor = this.coreColor;
      graphics.circle(0, 0, Math.min(width, height) * 0.22);
      graphics.stroke();
    } else if (effectiveBorder !== null) {
      graphics.lineWidth = 3;
      graphics.strokeColor = effectiveBorder;
      graphics.rect(-width / 2 + 1.5, -height / 2 + 1.5, width - 3, height - 3);
      graphics.stroke();
    }

    const maxHp = this.runtimeMaxHp > 0 ? this.runtimeMaxHp : this.definition?.maxHp ?? 0;
    const hp = this.runtimeHp >= 0 ? this.runtimeHp : maxHp;
    if (maxHp > 0) {
      const barInset = Math.max(4, Math.min(8, Math.round(cellSize / 8)));
      const barWidth = Math.max(8, width - barInset * 2);
      const barHeight = cellSize >= 36 ? 6 : 4;
      const barX = -barWidth / 2;
      const barY = -height / 2 - barHeight - 4;
      graphics.fillColor = new Color(7, 12, 18, 220);
      graphics.roundRect(barX, barY, barWidth, barHeight, barHeight / 2);
      graphics.fill();
      graphics.fillColor = this.runtimeRepairing
        ? this.validPreviewBorderColor
        : hp / maxHp > 0.5 ? new Color(82, 205, 124, 255) : new Color(235, 88, 88, 255);
      const fillWidth = (barWidth - 2) * Math.max(0, Math.min(1, hp / maxHp));
      if (fillWidth > 0) {
        graphics.roundRect(barX + 1, barY + 1, fillWidth, barHeight - 2, Math.min((barHeight - 2) / 2, fillWidth / 2));
        graphics.fill();
      }
    }
  }

  private handleRuntimeMouseDown(event: EventMouse): void {
    if (event.getButton() === EventMouse.BUTTON_RIGHT && this.handleRoomContext !== null && this.placement !== null) {
      event.propagationStopped = true;
      this.handleRoomContext(this.placement.instanceId, event);
      return;
    }
    if (event.getButton() === EventMouse.BUTTON_LEFT && this.placement !== null && this.handleRoomClick !== null) {
      event.propagationStopped = true;
      this.handleRoomClick(this.placement.instanceId);
    }
  }

  private drawRuntimeNormalState(): void {
    if (this.definition !== null && this.shipView !== null) {
      this.draw(this.definition.width, this.definition.height, this.shipView.cellSize);
    }
  }

  private refreshPreview(): void {
    this.synchronizeEditorGraphicsTransform();
    const shipView = this.findShipView();
    const cellSize = shipView?.cellSize ?? 24;
    const source = shipView?.configSource ?? null;
    if (EDITOR_NOT_IN_PREVIEW && this.authoringPreviewResult === null && (source === null || !source.hasCompleteBinding())) {
      if (this.editorPreviewSignature !== 'config-binding-pending') {
        this.editorPreviewSignature = 'config-binding-pending';
        // 独立 Prefab 不再保存九张 CSV。保留上次合法预览写入的 UITransform 尺寸，
        // 使直接双击资源仍显示代表外观；权威定义校验由创作工具内存 DTO 完成。
        const size = this.getComponent(UITransform)?.contentSize;
        const widthCells = Math.max(1, Math.round((size?.width ?? cellSize) / cellSize));
        const heightCells = Math.max(1, Math.round((size?.height ?? cellSize) / cellSize));
        this.draw(widthCells, heightCells, cellSize);
      }
      return;
    }
    const definitionResult = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    if (definitionResult.ok === false) {
      const errorSignature = `definition-error|${definitionResult.code}|${definitionResult.message}|${cellSize}`;
      if (errorSignature !== this.editorPreviewSignature) {
        this.editorPreviewSignature = errorSignature;
        warn(`[UI] ${definitionResult.message}`);
        this.draw(1, 1, cellSize, this.invalidPreviewBorderColor);
      }
      return;
    }
    const definition = definitionResult.definition;
    if (!this.isInitialHpValid(definition)) {
      const invalidSignature = `initial-hp-error|${this.initialHp}|${definition.maxHp}`;
      if (invalidSignature !== this.editorPreviewSignature) warn(`[UI] 初始耐久必须是 -1 或 0 到 ${definition.maxHp} 的整数`);
      this.editorPreviewSignature = invalidSignature;
      this.runtimeHp = 0;
      this.runtimeMaxHp = definition.maxHp;
      this.draw(definition.width, definition.height, cellSize, this.invalidPreviewBorderColor);
      return;
    }
    this.runtimeHp = this.initialHp === -1 ? definition.maxHp : this.initialHp;
    this.runtimeMaxHp = definition.maxHp;
    this.runtimeRepairing = false;
    const hasImage = this.getRoomAppearance()?.hasRenderableVisual() === true;
    const signature = [
      definition.id,
      definition.width,
      definition.height,
      cellSize,
      hasImage,
      this.fillColor.toHEX('#rrggbbaa'),
      this.borderColor.toHEX('#rrggbbaa'),
      this.coreColor.toHEX('#rrggbbaa'),
      this.validPreviewBorderColor.toHEX('#rrggbbaa'),
      this.invalidPreviewBorderColor.toHEX('#rrggbbaa'),
    ].join('|');
    if (signature === this.editorPreviewSignature) {
      return;
    }
    this.editorPreviewSignature = signature;
    this.draw(definition.width, definition.height, cellSize);
    this.scheduleEditorGridSnap();
  }

  private handleEditorTransformChanged(): void {
    // TRANSFORM_CHANGED 在 Creator 撤销/重做回放尚未完全刷新世界矩阵时同步触发；
    // 推迟到当前编辑操作结束后再吸附，避免读取旧矩阵并把错误位置再次写回撤销栈。
    this.scheduleEditorGridSnap();
  }

  private scheduleEditorGridSnap(): void {
    if (!EDITOR_NOT_IN_PREVIEW || this.isSnappingInEditor || this.editorSnapScheduled) {
      return;
    }
    // Creator 3.8.8 在切换 Prefab 时可能先销毁 Scheduler target，再让 scheduleOnce
    // 自动取消，从而在引擎内部读取不存在的 timers。复用现有编辑器 update 下一帧处理，
    // 既保留延迟吸附语义，也不创建跨文档存活的自定义 Timer。
    this.editorSnapScheduled = true;
  }

  private flushEditorGridSnap(): void {
    this.editorSnapScheduled = false;
    if (!this.isValid || !this.node.isValid) {
      return;
    }
    this.snapToEditorGrid();
    this.synchronizeEditorGraphicsTransform(true);
  }

  /**
   * Creator 3.8.8 的 Graphics.onRestore 不会重跑 onEnable 中的 USE_LOCAL 材质初始化。
   * Undo 后若该宏丢失，图形会忽略 Node 变换并固定在世界原点；这里检测公开 Pass defines，
   * 仅在宏确实丢失时重启 Graphics 生命周期，再让当前帧重新上传节点矩阵和预览数据。
   */
  private synchronizeEditorGraphicsTransform(force = false): void {
    if (!EDITOR_NOT_IN_PREVIEW || !this.isValid || !this.node.isValid) {
      return;
    }

    const position = this.node.position;
    const signature = `${position.x}|${position.y}|${position.z}`;
    if (!force && signature === this.editorRenderPositionSignature) {
      return;
    }
    const graphics = this.getComponent(Graphics);
    if (graphics === null) {
      return;
    }

    const material = graphics.getRenderMaterial(0);
    const passes = material?.passes;
    if (!Array.isArray(passes) || passes.length === 0) {
      return;
    }
    const usesLocalCoordinates = passes.some((pass) => {
      const value = pass?.defines?.USE_LOCAL;
      return value === true || value === 1;
    });
    if (!usesLocalCoordinates) {
      // 不切换 enabled：编辑器会把它视为新的序列化修改并清空 Redo 栈。
      // MaterialInstance 的 shader 宏不是场景业务数据，可以安全地原地恢复。
      graphics.getMaterialInstance(0)?.recompileShaders({ USE_LOCAL: true });
    }

    this.editorRenderPositionSignature = signature;
    this.node.invalidateChildren(TransformBit.POSITION);
    graphics.markForUpdateRenderData(true);
  }

  /** 编辑器坐标只用于设计输入；最终仍转换为 GameCore 的整数逻辑坐标。 */
  private snapToEditorGrid(): void {
    if (!EDITOR_NOT_IN_PREVIEW || this.isSnappingInEditor) {
      return;
    }

    const shipView = this.findShipView();
    const parent = this.node.parent;
    if (shipView === null || !shipView.snapRoomsInEditor || parent === null) {
      return;
    }
    const definitionResult = this.authoringPreviewResult ?? this.resolveRoomDefinition();
    if (definitionResult.ok === false) {
      return;
    }
    const definition = definitionResult.definition;

    const gridPosition = shipView.parentLocalCenterToGrid(
      parent,
      this.node.position,
      definition.width,
      definition.height,
    );
    if (gridPosition === null) {
      return;
    }

    const hull = shipView.getHullDefinition();
    const maxX = hull.gridWidth - definition.width;
    const maxY = hull.gridHeight - definition.height;
    if (maxX < 0 || maxY < 0) {
      return;
    }
    // 逻辑换算在网格外仍会返回整数；编辑器吸附不应把撤销回放后的像素位置
    // 永久保存在网格外，因此把候选格限制在房间尺寸允许的边界内。
    const boundedGridPosition = {
      x: Math.min(Math.max(gridPosition.x, 0), maxX),
      y: Math.min(Math.max(gridPosition.y, 0), maxY),
    };
    const snappedParentCenter = shipView.gridPositionToParentLocal(
      parent,
      boundedGridPosition,
      definition.width,
      definition.height,
    );
    if (snappedParentCenter === null) {
      return;
    }
    const current = this.node.position;
    if (Math.abs(current.x - snappedParentCenter.x) < 0.001 && Math.abs(current.y - snappedParentCenter.y) < 0.001) {
      return;
    }

    this.isSnappingInEditor = true;
    this.node.setPosition(snappedParentCenter.x, snappedParentCenter.y, current.z);
    this.isSnappingInEditor = false;
  }

  private findShipView(): ShipView | null {
    return findOwningShipView(this.node);
  }

  private getRoomAppearance(): RoomAppearance | null {
    return this.roomAppearance ?? this.getComponent(RoomAppearance);
  }

  private isInitialHpValid(definition: RoomDefinition): boolean {
    return Number.isInteger(this.initialHp) && this.initialHp >= -1 && this.initialHp <= definition.maxHp;
  }

  private captureAuthoringGrid(definition: RoomDefinition): GridPosition | null {
    const shipView = this.findShipView();
    const parent = this.node.parent;
    return shipView === null || parent === null
      ? null
      : shipView.parentLocalCenterToGrid(parent, this.node.position, definition.width, definition.height);
  }

  private applyAuthoringLayout(position: GridPosition, definition: RoomDefinition): boolean {
    const shipView = this.findShipView();
    const parent = this.node.parent;
    if (shipView === null || parent === null) return false;
    const local = shipView.gridPositionToParentLocal(parent, position, definition.width, definition.height);
    if (local === null || !this.isAuthoringPlacementAvailable(position, definition)) return false;
    const current = this.node.position;
    this.node.setPosition(local.x, local.y, current.z);
    return true;
  }

  private isAuthoringPlacementAvailable(position: GridPosition, definition: RoomDefinition): boolean {
    const shipView = this.findShipView();
    if (shipView === null || shipView.roomRoot === null) return false;
    let grid: ShipGridModel;
    try {
      grid = new ShipGridModel(shipView.getHullDefinition());
      for (const sibling of shipView.roomRoot.children) {
        if (sibling === this.node) continue;
        const view = sibling.getComponent('RoomView') as {
          roomInstanceId?: string;
          getAuthoringDefinitionForLayout?: () => RoomDefinition | null;
        } | null;
        const siblingDefinition = view?.getAuthoringDefinitionForLayout?.() ?? null;
        if (view === null || siblingDefinition === null || typeof view.roomInstanceId !== 'string' || view.roomInstanceId.trim() === '') return false;
        const siblingPosition = shipView.parentLocalCenterToGrid(shipView.roomRoot, sibling.position, siblingDefinition.width, siblingDefinition.height);
        if (siblingPosition === null) return false;
        const placed = grid.placeRoom({ instanceId: view.roomInstanceId.trim(), definitionId: siblingDefinition.id, ...siblingPosition, width: siblingDefinition.width, height: siblingDefinition.height });
        if (placed.ok === false) return false;
      }
      return validateRoomPlacement(grid, { instanceId: this.roomInstanceId.trim() || '__editor_room__', definitionId: definition.id, ...position, width: definition.width, height: definition.height }).ok;
    } catch {
      return false;
    }
  }
}
