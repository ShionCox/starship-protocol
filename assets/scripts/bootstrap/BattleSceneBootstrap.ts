import { _decorator, Camera, Canvas, Component, error, Layers, log, Node, Vec3 } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import { BattleHUD } from '../presentation/BattleHUD';
import { ShipView } from '../presentation/ShipView';
import { configureGameDisplay } from './configureGameDisplay';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/** BattleScene 只校验并绑定两个持久 ShipView；本阶段不提前实现战斗规则。 */
@ccclass('BattleSceneBootstrap')
@executeInEditMode
@menu('星舰协议/启动/战斗场景装配')
export class BattleSceneBootstrap extends Component {
  @property({ type: ShipView, displayName: '我方飞船视图', tooltip: '我方飞船挂载点中的持久 ShipView 实例。', group: '场景引用' })
  public playerShipView: ShipView | null = null;

  @property({ type: ShipView, displayName: '敌方飞船视图', tooltip: '敌方飞船挂载点中的持久 ShipView 实例。', group: '场景引用' })
  public enemyShipView: ShipView | null = null;

  @property({ type: BattleHUD, displayName: '战斗界面', tooltip: '共享 UIRoot Prefab 中的战斗 HUD。', group: '场景引用' })
  public battleHud: BattleHUD | null = null;

  protected onEnable(): void {
    if (!EDITOR_NOT_IN_PREVIEW) return;
    // 设计期只校正已持久存在的组件和引用；缺少内容时保持原状，交由创作工具显示完整中文错误。
    this.applyEditorCameraDefaults();
    this.applyEditorSceneReferences();
  }

  /** 由创作工具调用：战斗场景只保留一台正交 2D 相机，并显式绑定唯一画布。 */
  public applyEditorCameraDefaults(): { readonly ok: boolean; readonly message: string } {
    const scene = this.node.scene;
    const cameraNode = scene?.getChildByName('主相机') ?? null;
    const camera = cameraNode?.getComponent(Camera) ?? null;
    const canvasNode = scene?.getChildByName('画布') ?? null;
    const canvas = canvasNode?.getComponent(Canvas) ?? null;
    if (cameraNode === null || camera === null) return { ok: false, message: '战斗场景缺少“主相机”或 Camera 组件' };
    if (canvasNode === null || canvas === null) return { ok: false, message: '战斗场景缺少“画布”或 Canvas 组件' };

    cameraNode.setPosition(new Vec3(640, 360, 1000));
    cameraNode.setRotationFromEuler(0, 0, 0);
    camera.projection = Camera.ProjectionType.ORTHO;
    camera.orthoHeight = 360;
    camera.far = 2000;
    camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    camera.visibility = 1_107_296_256;
    canvasNode.layer = Layers.Enum.UI_2D;
    canvas.cameraComponent = camera;
    return { ok: true, message: '战斗场景正交 2D 相机已校正' };
  }

  /**
   * 由创作工具调用：引用只从双方挂载点与共享 UIRoot 中解析，禁止跨场景全局搜索。
   * 同时固定双方挂载点位置，使两艘飞船在编辑器中无需运行即可直接预览。
   */
  public applyEditorSceneReferences(): { readonly ok: boolean; readonly message: string } {
    const scene = this.node.scene;
    const worldRoot = findDescendant(scene, '世界根');
    const playerMount = findDescendant(worldRoot, '我方飞船挂载点');
    const enemyMount = findDescendant(worldRoot, '敌方飞船挂载点');
    const playerShips = playerMount?.getComponentsInChildren(ShipView) ?? [];
    const enemyShips = enemyMount?.getComponentsInChildren(ShipView) ?? [];
    const battleHuds = scene?.getComponentsInChildren(BattleHUD) ?? [];
    if (worldRoot === null) return { ok: false, message: '战斗场景缺少“世界根”' };
    if (playerMount === null || enemyMount === null) return { ok: false, message: '战斗场景缺少我方或敌方飞船挂载点' };
    if (playerShips.length !== 1) return { ok: false, message: `我方挂载点必须且只能包含一个飞船视图，当前为 ${playerShips.length} 个` };
    if (enemyShips.length !== 1) return { ok: false, message: `敌方挂载点必须且只能包含一个飞船视图，当前为 ${enemyShips.length} 个` };
    if (battleHuds.length !== 1) return { ok: false, message: `战斗场景必须且只能包含一个战斗界面，当前为 ${battleHuds.length} 个` };

    const playerState = playerShips[0].getAuthoringInspectorState();
    const enemyState = enemyShips[0].getAuthoringInspectorState();
    if (!playerState.ok) return { ok: false, message: `我方飞船无效：${playerState.message}` };
    if (!enemyState.ok) return { ok: false, message: `敌方飞船无效：${enemyState.message}` };
    if (playerState.shipId === enemyState.shipId) return { ok: false, message: '我方和敌方飞船实例标识不能相同' };

    playerMount.setPosition(-260, -40, 0);
    enemyMount.setPosition(260, 40, 0);
    playerShips[0].node.setPosition(0, 0, 0);
    enemyShips[0].node.setPosition(0, 0, 0);
    setUiLayerRecursively(worldRoot);
    this.playerShipView = playerShips[0];
    this.enemyShipView = enemyShips[0];
    this.battleHud = battleHuds[0];
    return { ok: true, message: '战斗场景引用已连接' };
  }

  protected start(): void {
    configureGameDisplay();
    const resolved = this.resolvePersistedSceneReferences();
    if (resolved.ok) {
      this.playerShipView = resolved.playerShipView;
      this.enemyShipView = resolved.enemyShipView;
      this.battleHud = resolved.battleHud;
    }
    if (this.playerShipView === null || this.enemyShipView === null || this.battleHud === null) {
      error('[BOOT] 请在战斗场景装配组件中绑定我方飞船、敌方飞船和战斗界面');
      return;
    }
    const player = this.playerShipView.getAuthoringInspectorState();
    const enemy = this.enemyShipView.getAuthoringInspectorState();
    if (!player.ok || !enemy.ok) {
      error(`[BOOT] 战斗飞船校验失败：${!player.ok ? player.message : enemy.message}`);
      return;
    }
    if (player.shipId === enemy.shipId) {
      error('[BOOT] 我方和敌方飞船实例标识不能相同');
      return;
    }
    this.battleHud.bind(player.shipId, enemy.shipId);
    log(`[BOOT] 战斗场景已隔离绑定：我方=${player.shipId}，敌方=${enemy.shipId}`);
  }

  private resolvePersistedSceneReferences():
    | { readonly ok: true; readonly playerShipView: ShipView; readonly enemyShipView: ShipView; readonly battleHud: BattleHUD }
    | { readonly ok: false } {
    const scene = this.node.scene;
    const worldRoot = findDescendant(scene, '世界根');
    const playerMount = findDescendant(worldRoot, '我方飞船挂载点');
    const enemyMount = findDescendant(worldRoot, '敌方飞船挂载点');
    const playerShips = playerMount?.getComponentsInChildren(ShipView) ?? [];
    const enemyShips = enemyMount?.getComponentsInChildren(ShipView) ?? [];
    const huds = scene?.getComponentsInChildren(BattleHUD) ?? [];
    if (playerShips.length !== 1 || enemyShips.length !== 1 || huds.length !== 1) return { ok: false };
    return { ok: true, playerShipView: playerShips[0], enemyShipView: enemyShips[0], battleHud: huds[0] };
  }
}

function findDescendant(root: Node | null | undefined, name: string): Node | null {
  if (root === null || root === undefined) return null;
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findDescendant(child, name);
    if (found !== null) return found;
  }
  return null;
}

function setUiLayerRecursively(node: Node): void {
  node.layer = Layers.Enum.UI_2D;
  for (const child of node.children) setUiLayerRecursively(child);
}
