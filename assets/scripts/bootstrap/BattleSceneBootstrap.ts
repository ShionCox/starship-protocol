import { _decorator, Camera, Canvas, Component, error, Layers, log, Node, Vec3 } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

import { BattleHUD } from '../presentation/BattleHUD';
import { GameConfigCsvSource } from '../presentation/GameConfigCsvSource';
import { ShipView } from '../presentation/ShipView';
import { configureGameDisplay, GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from './configureGameDisplay';

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

    cameraNode.setPosition(new Vec3(GAME_DESIGN_WIDTH / 2, GAME_DESIGN_HEIGHT / 2, 1000));
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
   * 场景位置由创作工具通过公开 set-property 持久化；此方法只做引用和布局重复校验。
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
    if (!isUsableComponent(this.playerShipView) || !isUsableComponent(this.enemyShipView) || !isUsableComponent(this.battleHud)) {
      return { ok: false, message: '战斗场景 Bootstrap 引用未持久绑定' };
    }
    if (playerShips[0] !== this.playerShipView || enemyShips[0] !== this.enemyShipView || battleHuds[0] !== this.battleHud) {
      return { ok: false, message: '战斗场景 Bootstrap 引用与持久挂载点不一致' };
    }
    const source = this.getComponent(GameConfigCsvSource);
    if (source === null || !source.hasCompleteBinding() || !source.resolve().ok) {
      return { ok: false, message: '战斗场景应用根缺少完整且有效的九张权威 CSV 来源' };
    }
    if (playerShips[0].configSource !== source || enemyShips[0].configSource !== source) {
      return { ok: false, message: '战斗场景双方飞船未共同指向应用根权威 CSV 来源' };
    }

    const playerState = playerShips[0].getAuthoringInspectorState();
    const enemyState = enemyShips[0].getAuthoringInspectorState();
    if (!playerState.ok) return { ok: false, message: `我方飞船无效：${playerState.message}` };
    if (!enemyState.ok) return { ok: false, message: `敌方飞船无效：${enemyState.message}` };
    if (playerState.shipId === enemyState.shipId) return { ok: false, message: '我方和敌方飞船实例标识不能相同' };

    // 世界根与双方挂载点的位置由创作工具通过公开 set-property 持久化；
    // 这里仅校验引用和重复 ShipView，不在运行期/预览期覆盖场景布局。
    setUiLayerRecursively(worldRoot);
    return { ok: true, message: '战斗场景引用已连接' };
  }

  protected start(): void {
    if (EDITOR_NOT_IN_PREVIEW) return;
    configureGameDisplay();
    // BattleScene 的跨节点引用必须由编辑器公开 set-property 持久化；运行时不扫描场景树补齐。
    if (!isUsableComponent(this.playerShipView) || !isUsableComponent(this.enemyShipView) || !isUsableComponent(this.battleHud)) {
      error('[BOOT] 战斗场景 Bootstrap 引用未持久绑定：请在场景装配组件中绑定我方飞船、敌方飞船和战斗界面');
      return;
    }
    const source = this.getComponent(GameConfigCsvSource);
    if (source === null || !source.hasCompleteBinding()) {
      error('[BOOT] 战斗场景应用根缺少完整的九张权威 CSV 来源');
      return;
    }
    const sourceResult = source.resolve();
    if (sourceResult.ok === false) {
      error(`[BOOT] 战斗场景权威 CSV 校验失败：${sourceResult.message}`);
      return;
    }
    if (this.playerShipView.configSource !== source || this.enemyShipView.configSource !== source) {
      error('[BOOT] 战斗场景双方飞船未共同指向应用根权威 CSV 来源');
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

function isUsableComponent(component: Component | null): component is Component {
  return component !== null && component.isValid && component.node !== null && component.node.isValid;
}
