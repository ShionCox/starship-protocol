import { _decorator, Component, Enum, error, Layers, Node, UITransform, Widget } from 'cc';

import { BattleHUD } from './BattleHUD';
import { MainPageRouter } from './MainPageRouter';

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

  @property({ type: Node, displayName: '主界面内容根', tooltip: '包含主菜单、星图、飞船、建造和船员页面。', group: '持久节点' })
  public mainContentRoot: Node | null = null;

  @property({ type: Node, displayName: '战斗界面内容根', tooltip: '包含战斗 HUD，不承载世界空间飞船节点。', group: '持久节点' })
  public battleContentRoot: Node | null = null;

  /** 仅供创作插件建立 MainScene 与 BattleScene 共用的正式 UIRoot Prefab。 */
  public ensureAuthoringPrefabStructure(): boolean {
    ensureFullScreen(this.node);
    this.mainContentRoot = ensureUiChild(this.node, '主界面内容根');
    this.battleContentRoot = ensureUiChild(this.node, '战斗界面内容根');
    const popupRoot = ensureUiChild(this.node, '弹窗层', false);
    ensureUiChild(this.node, '提示层', false);
    ensureUiChild(this.node, '加载层', false);
    this.mainContentRoot.getComponent(MainPageRouter)?.ensureAuthoringPrefabStructure(popupRoot);
    this.battleContentRoot.getComponent(BattleHUD)?.ensureAuthoringPrefabStructure();
    setUiLayerRecursively(this.node);
    return true;
  }

  protected onEnable(): void {
    if (this.mainContentRoot === null || this.battleContentRoot === null) {
      error('[UI] 界面根 Prefab 缺少主界面内容根或战斗界面内容根');
      return;
    }
    this.mainContentRoot.active = this.mode === 0;
    this.battleContentRoot.active = this.mode === 1;
  }
}

function setUiLayerRecursively(node: Node): void {
  node.layer = Layers.Enum.UI_2D;
  for (const child of node.children) setUiLayerRecursively(child);
}

function ensureUiChild(parent: Node, name: string, fullScreen = true): Node {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.layer = Layers.Enum.UI_2D;
  if (fullScreen) ensureFullScreen(node);
  return node;
}

function ensureFullScreen(node: Node): void {
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(1280, 720);
  const widget = node.getComponent(Widget) ?? node.addComponent(Widget);
  widget.isAlignTop = widget.isAlignBottom = widget.isAlignLeft = widget.isAlignRight = true;
  widget.top = widget.bottom = widget.left = widget.right = 0;
}
