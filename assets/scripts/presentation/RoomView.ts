import {
  _decorator,
  Color,
  Component,
  error,
  EventMouse,
  Graphics,
  input,
  Input,
  JsonAsset,
  Node,
  TransformBit,
  UITransform,
  Vec3,
  warn,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW, NATIVE } from 'cc/env';

import { PrototypeSceneSettings } from '../bootstrap/PrototypeSceneSettings';
import { findPrototypeSceneNode } from '../bootstrap/PrototypeSceneNodes';
import {
  parseRoomDefinition,
  type RoomDefinition,
  type RoomDefinitionParseResult,
} from '../game-core/RoomDefinition';
import type {
  GridPosition,
  MoveRoomCommand,
  PlacementValidation,
  RoomPlacement,
} from '../game-core/ShipGridModel';

const { ccclass, executeInEditMode, menu, property } = _decorator;

type RoomMoveHandler = (command: MoveRoomCommand) => PlacementValidation;
type PanBlockHandler = (blocked: boolean) => void;

@ccclass('RoomView')
@executeInEditMode
@menu('星舰协议/场景表现/房间视图')
export class RoomView extends Component {
  @property({
    displayName: '房间实例 ID',
    tooltip: '同一场景内必须唯一；存档和移动命令使用这个稳定字符串 ID。',
    group: '房间实例',
  })
  public roomInstanceId = 'room-reactor-1';

  @property({
    displayName: '房间定义 ID',
    tooltip: '正式包从 Secure ConfigRegistry 按此稳定 ID 取规则；必须与绑定 JSON 的 id 一致。',
    group: '房间定义',
  })
  public roomDefinitionId = 'room-reactor';

  @property({
    type: JsonAsset,
    displayName: '房间定义',
    tooltip: '仅供编辑器预览和 Web 原型使用；Windows 正式包不会导出此引用，运行时从 Secure ConfigRegistry 读取。',
    group: '房间定义',
  })
  public definitionAsset: JsonAsset | null = null;

  @property({ displayName: '房间底色', tooltip: '房间主体填充颜色。', group: '外观' })
  public fillColor = new Color(185, 92, 35, 245);

  @property({ displayName: '房间边框颜色', tooltip: '房间外框颜色。', group: '外观' })
  public borderColor = new Color(255, 193, 92, 255);

  @property({ displayName: '核心标记颜色', tooltip: '房间中央标记颜色。', group: '外观' })
  public coreColor = new Color(255, 224, 148, 255);

  @property({ displayName: '合法预览边框', tooltip: '运行时拖到合法位置时使用的边框颜色。', group: '拖放预览' })
  public validPreviewBorderColor = new Color(94, 220, 132, 255);

  @property({ displayName: '非法预览边框', tooltip: '运行时拖到非法位置时使用的边框颜色。', group: '拖放预览' })
  public invalidPreviewBorderColor = new Color(255, 92, 92, 255);

  private editorPreviewSignature = '';
  private editorRenderPositionSignature = '';
  private isSnappingInEditor = false;
  private editorSnapScheduled = false;
  private definition: RoomDefinition | null = null;
  private placement: RoomPlacement | null = null;
  private sceneSettings: PrototypeSceneSettings | null = null;
  private previewRoomMove: RoomMoveHandler | null = null;
  private commitRoomMove: RoomMoveHandler | null = null;
  private setPanBlocked: PanBlockHandler | null = null;
  private runtimeCanvas: Node | null = null;
  private readonly runtimeDragOffset = new Vec3();
  private readonly runtimePointerWorld = new Vec3();
  private readonly runtimeCandidateWorld = new Vec3();
  private runtimeCandidate: MoveRoomCommand | null = null;
  private runtimeCandidateValidation: PlacementValidation | null = null;
  private isDraggingAtRuntime = false;

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
    this.unschedule(this.flushEditorGridSnap);
    this.editorSnapScheduled = false;
    this.node.off(Node.EventType.MOUSE_DOWN, this.handleRuntimeMouseDown, this);
    this.stopRuntimeDrag();
  }

  /** Creator 编辑器在 Undo/Redo 恢复序列化状态后调用，用于重建非序列化预览缓存。 */
  protected onRestore(): void {
    if (!EDITOR_NOT_IN_PREVIEW) {
      return;
    }
    this.editorPreviewSignature = '';
    this.editorRenderPositionSignature = '';
    this.scheduleEditorGridSnap();
  }

  protected update(): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      this.refreshPreview();
    }
  }

  /** 统一解析 Prefab 绑定的版本化房间定义，供编辑器预览和场景装配复用。 */
  public resolveRoomDefinition(): RoomDefinitionParseResult {
    if (this.definitionAsset === null) {
      return {
        ok: false,
        code: 'INVALID_DOCUMENT',
        message: '请在房间 Prefab 的 RoomView 上绑定房间定义 JSON',
      };
    }
    const result = parseRoomDefinition(this.definitionAsset.json);
    if (result.ok && result.definition.id !== this.roomDefinitionId.trim()) {
      return {
        ok: false,
        code: 'INVALID_ID',
        message: `房间定义 ID 不匹配：Inspector 为 ${this.roomDefinitionId || '空'}，JSON 为 ${result.definition.id}`,
      };
    }
    return result;
  }

  /** 正式 Native 运行时只把稳定 ID 交给 ConfigRegistry，不读取源 JsonAsset。 */
  public getRoomDefinitionId(): string {
    return this.roomDefinitionId.trim();
  }

  /** 供编辑器语义创建命令把新实例放到已计算的整数逻辑格。 */
  public applyEditorPlacement(position: GridPosition): boolean {
    const sceneSettings = this.findSceneSettings();
    const parent = this.node.parent;
    const definitionResult = this.resolveRoomDefinition();
    if (sceneSettings === null || parent === null || definitionResult.ok === false) {
      return false;
    }
    const local = sceneSettings.gridPositionToParentLocal(
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
    const result = this.resolveRoomDefinition();
    if (result.ok === false) {
      return { ok: false, message: result.message };
    }
    const assetName = this.definitionAsset?.name.replace(/\.json$/i, '') ?? '';
    if (assetName !== result.definition.id) {
      return {
        ok: false,
        message: `定义文件名必须与稳定 ID 一致：当前 ${assetName || '空'}，期望 ${result.definition.id}`,
      };
    }
    return { ok: true, message: `房间定义有效：${result.definition.displayName}（${result.definition.id}）` };
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
    readonly gridPosition?: GridPosition;
  } {
    const definitionResult = this.resolveRoomDefinition();
    const sceneSettings = this.findSceneSettings();
    const base = {
      roomInstanceId: this.roomInstanceId.trim(),
      roomDefinitionId: this.roomDefinitionId.trim(),
    };
    if (definitionResult.ok === false) {
      return { ...base, ok: false, message: definitionResult.message };
    }
    if (sceneSettings === null) {
      return { ...base, ok: false, message: '场景缺少 PrototypeSceneSettings，无法换算逻辑格位置' };
    }
    const parent = this.node.parent;
    if (parent === null) {
      return { ...base, ok: false, message: '房间缺少父节点，无法换算逻辑格位置' };
    }
    const gridPosition = sceneSettings.parentLocalCenterToGrid(
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
      gridPosition,
    };
  }

  /**
   * Prefab 只负责表现；房间尺寸和逻辑坐标来自纯 TS 配置与状态。
   */
  public bind(
    definition: RoomDefinition,
    placement: RoomPlacement,
    sceneSettings: PrototypeSceneSettings,
    previewRoomMove: RoomMoveHandler | null = null,
    commitRoomMove: RoomMoveHandler | null = null,
    setPanBlocked: PanBlockHandler | null = null,
  ): void {
    const parent = this.node.parent;
    const roomCenter = parent === null
      ? null
      : sceneSettings.gridPositionToParentLocal(parent, placement, definition.width, definition.height);
    if (roomCenter === null) {
      error('[UI] 房间缺少父节点或场景网格设置，无法绑定到逻辑网格');
      return;
    }

    this.definition = definition;
    this.placement = { ...placement };
    this.sceneSettings = sceneSettings;
    this.previewRoomMove = previewRoomMove;
    this.commitRoomMove = commitRoomMove;
    this.setPanBlocked = setPanBlocked;
    this.node.name = `Room-${placement.id}`;
    this.node.setPosition(roomCenter);
    this.draw(definition.width, definition.height, sceneSettings.cellSize);
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

    graphics.clear();
    graphics.fillColor = this.fillColor;
    graphics.roundRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, 8);
    graphics.fill();
    graphics.lineWidth = 3;
    graphics.strokeColor = previewBorderColor ?? this.borderColor;
    graphics.roundRect(-width / 2 + 3, -height / 2 + 3, width - 6, height - 6, 8);
    graphics.stroke();

    graphics.lineWidth = 5;
    graphics.strokeColor = this.coreColor;
    graphics.circle(0, 0, Math.min(width, height) * 0.22);
    graphics.stroke();
  }

  private handleRuntimeMouseDown(event: EventMouse): void {
    if (event.getButton() !== EventMouse.BUTTON_LEFT || this.isDraggingAtRuntime) {
      return;
    }
    if (
      this.definition === null ||
      this.placement === null ||
      this.sceneSettings === null ||
      this.previewRoomMove === null ||
      this.commitRoomMove === null
    ) {
      error('[INPUT] RoomView 尚未完成运行时绑定，请检查 AppRoot 的 PrototypeBootstrap');
      return;
    }

    const scene = this.node.scene;
    const canvas = scene === null ? null : findPrototypeSceneNode(scene, 'canvas');
    if (canvas === null) {
      error('[INPUT] 运行时拖放缺少 Canvas');
      return;
    }

    event.propagationStopped = true;
    this.isDraggingAtRuntime = true;
    this.setPanBlocked?.(true);
    this.runtimeCanvas = canvas;
    const pointerWorld = this.getPointerWorld(event);
    Vec3.subtract(this.runtimeDragOffset, this.node.worldPosition, pointerWorld);
    canvas.on(Node.EventType.MOUSE_MOVE, this.handleRuntimeMouseMove, this);
    canvas.on(Node.EventType.MOUSE_UP, this.handleRuntimeMouseUp, this);
    // Cocos Web 输入源把 MOUSE_UP 同时监听到 window，可处理 Canvas 外松开。
    input.on(Input.EventType.MOUSE_UP, this.handleRuntimeMouseUp, this);
  }

  private handleRuntimeMouseMove(event: EventMouse): void {
    if (
      !this.isDraggingAtRuntime ||
      this.definition === null ||
      this.placement === null ||
      this.sceneSettings === null ||
      this.previewRoomMove === null
    ) {
      return;
    }

    event.propagationStopped = true;
    const pointerWorld = this.getPointerWorld(event);
    const candidateWorld = Vec3.add(this.runtimeCandidateWorld, pointerWorld, this.runtimeDragOffset);
    const gridPosition = this.sceneSettings.worldCenterToGrid(
      candidateWorld,
      this.definition.width,
      this.definition.height,
    );
    const parent = this.node.parent;
    if (gridPosition === null || parent === null) {
      return;
    }

    const command: MoveRoomCommand = {
      type: 'MOVE_ROOM',
      roomId: this.placement.id,
      ...gridPosition,
    };
    const validation = this.previewRoomMove(command);
    const candidateLocal = this.sceneSettings.gridPositionToParentLocal(
      parent,
      gridPosition,
      this.definition.width,
      this.definition.height,
    );
    if (candidateLocal === null) {
      return;
    }

    this.runtimeCandidate = command;
    this.runtimeCandidateValidation = validation;
    this.node.setPosition(candidateLocal.x, candidateLocal.y, this.node.position.z);
    this.draw(
      this.definition.width,
      this.definition.height,
      this.sceneSettings.cellSize,
      validation.ok ? this.validPreviewBorderColor : this.invalidPreviewBorderColor,
    );
  }

  private handleRuntimeMouseUp(event: EventMouse): void {
    if (!this.isDraggingAtRuntime) {
      return;
    }

    event.propagationStopped = true;
    const command = this.runtimeCandidate;
    const preview = this.runtimeCandidateValidation;
    const committed = command !== null && preview?.ok === true && this.commitRoomMove?.(command).ok === true;
    if (committed && this.placement !== null && command !== null) {
      this.placement = { ...this.placement, x: command.x, y: command.y };
    } else {
      this.restoreRuntimePlacement();
    }
    this.drawRuntimeNormalState();
    this.stopRuntimeDrag();
  }

  private restoreRuntimePlacement(): void {
    const parent = this.node.parent;
    if (parent === null || this.definition === null || this.placement === null || this.sceneSettings === null) {
      return;
    }

    const originalLocal = this.sceneSettings.gridPositionToParentLocal(
      parent,
      this.placement,
      this.definition.width,
      this.definition.height,
    );
    if (originalLocal !== null) {
      this.node.setPosition(originalLocal.x, originalLocal.y, this.node.position.z);
    }
  }

  private drawRuntimeNormalState(): void {
    if (this.definition !== null && this.sceneSettings !== null) {
      this.draw(this.definition.width, this.definition.height, this.sceneSettings.cellSize);
    }
  }

  private stopRuntimeDrag(): void {
    this.runtimeCanvas?.off(Node.EventType.MOUSE_MOVE, this.handleRuntimeMouseMove, this);
    this.runtimeCanvas?.off(Node.EventType.MOUSE_UP, this.handleRuntimeMouseUp, this);
    input.off(Input.EventType.MOUSE_UP, this.handleRuntimeMouseUp, this);
    this.runtimeCanvas = null;
    this.runtimeCandidate = null;
    this.runtimeCandidateValidation = null;
    this.isDraggingAtRuntime = false;
    this.setPanBlocked?.(false);
  }

  private getPointerWorld(event: EventMouse): Vec3 {
    const location = event.getUILocation();
    // Cocos UI 事件坐标可直接交给 UITransform/Node 的世界坐标转换接口。
    return this.runtimePointerWorld.set(location.x, location.y, this.node.worldPosition.z);
  }

  private refreshPreview(): void {
    this.synchronizeEditorGraphicsTransform();
    const sceneSettings = this.findSceneSettings();
    const cellSize = sceneSettings?.cellSize ?? 48;
    const definitionResult = this.resolveRoomDefinition();
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
    const signature = [
      definition.id,
      definition.width,
      definition.height,
      cellSize,
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
    this.editorSnapScheduled = true;
    this.scheduleOnce(this.flushEditorGridSnap, 0);
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

    const sceneSettings = this.findSceneSettings();
    const parent = this.node.parent;
    if (sceneSettings === null || !sceneSettings.snapRoomsInEditor || parent === null) {
      return;
    }
    const definitionResult = this.resolveRoomDefinition();
    if (definitionResult.ok === false) {
      return;
    }
    const definition = definitionResult.definition;

    const gridPosition = sceneSettings.parentLocalCenterToGrid(
      parent,
      this.node.position,
      definition.width,
      definition.height,
    );
    if (gridPosition === null) {
      return;
    }

    const maxX = sceneSettings.gridColumns - definition.width;
    const maxY = sceneSettings.gridRows - definition.height;
    if (maxX < 0 || maxY < 0) {
      return;
    }
    // 逻辑换算在网格外仍会返回整数；编辑器吸附不应把撤销回放后的像素位置
    // 永久保存在网格外，因此把候选格限制在房间尺寸允许的边界内。
    const boundedGridPosition = {
      x: Math.min(Math.max(gridPosition.x, 0), maxX),
      y: Math.min(Math.max(gridPosition.y, 0), maxY),
    };
    const snappedParentCenter = sceneSettings.gridPositionToParentLocal(
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

  private findSceneSettings(): PrototypeSceneSettings | null {
    const scene = this.node.scene;
    return scene === null ? null : scene.getComponentInChildren(PrototypeSceneSettings);
  }
}
