import { _decorator, Component, Enum, error, Node } from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/** Inspector 使用中文选项；序列化值仍是稳定整数。 */
export const UIRootMode = Enum({ 主界面: 0, 战斗界面: 1 });

/** MainScene 与 BattleScene 共用的 UIRoot Prefab 模式开关。 */
@ccclass('UIRootController')
@executeInEditMode
@menu('星舰协议/界面/界面根控制')
export class UIRootController extends Component {
  @property({ type: UIRootMode, displayName: '界面模式', tooltip: '主场景选择“主界面”，战斗场景选择“战斗界面”。', group: '模式' })
  public mode = 0;

  @property({ type: Node, displayName: '主界面内容根', tooltip: '包含 MainScreen 主导航、公共面板和五个持久页面。', group: '持久节点' })
  public mainContentRoot: Node | null = null;

  @property({ type: Node, displayName: '战斗界面内容根', tooltip: '包含 BattleHUD，不承载世界空间飞船节点。', group: '持久节点' })
  public battleContentRoot: Node | null = null;

  private appliedMode = -1;

  protected onEnable(): void {
    // Main/Battle 的世界根与 UIRoot 共用同一台 2D 相机；UIRoot 必须位于 Canvas
    // 子节点最后，否则后绘制的飞船会遮挡能源、船员和导航面板。
    const parent = this.node.parent;
    if (parent !== null) this.node.setSiblingIndex(Math.max(0, parent.children.length - 1));
    this.refreshMode();
  }

  protected update(): void {
    // executeInEditMode 让 Inspector 修改无需运行预览即可立即切换画面；
    // 运行时仍只在 onEnable/模式变化时同步 active，避免每帧写节点状态。
    if (EDITOR_NOT_IN_PREVIEW && this.mode !== this.appliedMode) this.refreshMode();
  }

  private refreshMode(): void {
    if (this.mainContentRoot === null || this.battleContentRoot === null || this.node.getChildByName('弹窗层') === null || this.node.getChildByName('提示层') === null || this.node.getChildByName('加载层') === null) {
      error('[UI] 界面根 Prefab 缺少主界面内容根或战斗界面内容根');
      return;
    }
    this.mainContentRoot.active = this.mode === 0;
    this.battleContentRoot.active = this.mode === 1;
    this.appliedMode = this.mode;
  }
}
