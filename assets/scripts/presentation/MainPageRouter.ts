import {
  _decorator,
  Color,
  Component,
  director,
  Enum,
  error,
  Label,
  Node,
  screen,
  Sprite,
} from 'cc';
import { EDITOR_NOT_IN_PREVIEW } from 'cc/env';
import { WorldInteractionController } from './WorldInteractionController';
import { PowerPanel } from './PowerPanel';
import { CrewStatusPanel } from './CrewStatusPanel';

const { ccclass, executeInEditMode, menu, property } = _decorator;

export type MainPageId = 'MAIN_MENU' | 'GALAXY_MAP' | 'SHIP' | 'BUILD' | 'CREW';

/** Inspector 中使用中文页面名；运行时永远从主菜单开始，不读取该值。 */
export const MainPagePreview = Enum({ 主菜单: 0, 星图: 1, 飞船: 2, 建造: 3, 船员: 4 });

const MAIN_NAVIGATION_BUTTONS: ReadonlyArray<readonly [string, string, MainPageId | 'SETTINGS', number]> = [
  ['主菜单按钮', '主界面', 'MAIN_MENU', -558],
  ['星图按钮', '星图', 'GALAXY_MAP', -406],
  ['飞船按钮', '飞船', 'SHIP', -254],
  ['建造按钮', '建造', 'BUILD', -102],
  ['船员按钮', '船员', 'CREW', 50],
  ['设置按钮', '设置', 'SETTINGS', 202],
];

/**
 * MainScreen 的持久页面路由。
 *
 * 五个页面是同一 Prefab 中的普通节点，只切换 active；这样设计人员可以直接
 * 在 Creator 中选中任意页面调整布局，运行时也不会因 instantiate/destroy 丢失编辑器绑定。
 */
@ccclass('MainPageRouter')
@executeInEditMode
@menu('星舰协议/界面/主界面页面路由')
export class MainPageRouter extends Component {
  @property({ type: MainPagePreview, displayName: '编辑器预览页面', tooltip: '只影响 Creator 编辑器中的 MainScreen 预览；运行时始终从主界面开始。', group: '编辑器预览' })
  public editorPreviewPage = 0;

  @property({ type: Node, displayName: '主菜单页面', tooltip: '页面层中的持久主菜单节点。', group: '持久页面' })
  public mainMenuPage: Node | null = null;

  @property({ type: Node, displayName: '星图页面', tooltip: '页面层中的持久星图节点。', group: '持久页面' })
  public galaxyMapPage: Node | null = null;

  @property({ type: Node, displayName: '飞船页面', tooltip: '页面层中的持久飞船节点。', group: '持久页面' })
  public shipPage: Node | null = null;

  @property({ type: Node, displayName: '建造页面', tooltip: '页面层中的持久建造节点；BuildPageController 直接挂在该节点上。', group: '持久页面' })
  public buildPage: Node | null = null;

  @property({ type: Node, displayName: '船员页面', tooltip: '页面层中的持久船员节点。', group: '持久页面' })
  public crewPage: Node | null = null;

  // 两个公共面板固定按持久中文节点解析，不序列化自定义组件引用，避免
  // Creator 3.8.8 生成无法再次解码的 TargetOverrideInfo。
  public powerPanel: PowerPanel | null = null;

  public crewStatusPanel: CrewStatusPanel | null = null;

  @property({ type: Node, displayName: '设置弹窗', tooltip: 'UIRoot 弹窗层中的持久设置节点。', group: '弹窗' })
  public settingsPopup: Node | null = null;

  @property({ type: Label, displayName: '当前页面提示', tooltip: '显示当前激活页面的中文名称。', group: '导航' })
  public currentPageLabel: Label | null = null;

  private navigationHandlers: Array<readonly [Node, () => void]> = [];
  private activePage: MainPageId = 'MAIN_MENU';
  private pageBeforeSettings: MainPageId = 'MAIN_MENU';
  private appliedEditorPreviewPage = -1;

  protected onEnable(): void {
    this.refreshSerializedReferences();
    if (!this.hasPersistentPageStructure()) {
      error('主界面 Prefab 缺少主导航栏或五个持久页面节点，运行时不会补建 UI 结构。');
      return;
    }
    if (EDITOR_NOT_IN_PREVIEW) {
      this.refreshEditorPreview(true);
      return;
    }
    this.registerEvents();
    // 运行时不读取 editorPreviewPage，保证从场景进入主界面时状态确定。
    this.showPage('MAIN_MENU');
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
  }

  protected update(): void {
    if (!EDITOR_NOT_IN_PREVIEW) return;
    this.refreshSerializedReferences();
    if (this.editorPreviewPage !== this.appliedEditorPreviewPage) this.refreshEditorPreview(false);
  }

  protected onDisable(): void {
    this.unregisterEvents();
  }

  public showMainMenu(): void { this.showPage('MAIN_MENU'); }
  public showGalaxyMap(): void { this.showPage('GALAXY_MAP'); }
  public showShip(): void { this.showPage('SHIP'); }
  public showBuild(): void { this.showPage('BUILD'); }
  public showCrew(): void { this.showPage('CREW'); }

  public openSettings(): void {
    if (this.settingsPopup?.active === true) {
      this.closeSettings();
      return;
    }
    if (!EDITOR_NOT_IN_PREVIEW) this.node.scene?.getComponentInChildren(WorldInteractionController)?.clearSelection();
    if (this.settingsPopup === null) error('[UI] 主界面缺少设置弹窗持久节点');
    else {
      this.pageBeforeSettings = this.activePage;
      if (this.settingsPopup.parent !== null) this.settingsPopup.parent.active = true;
      this.settingsPopup.active = true;
      if (this.powerPanel !== null) this.powerPanel.node.active = false;
      if (this.crewStatusPanel !== null) this.crewStatusPanel.node.active = false;
      if (this.currentPageLabel !== null) this.currentPageLabel.string = '设置';
      this.refreshNavigationChrome();
    }
  }

  public closeSettings(): void {
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
    this.deactivatePopupLayerIfEmpty();
    this.showPage(this.pageBeforeSettings);
  }

  public enterBattle(): void {
    director.loadScene('BattleScene', (cause) => {
      if (cause !== null && cause !== undefined) error(`[UI] 无法进入战斗场景：${cause.message}`);
    });
  }

  public toggleFullScreen(): void {
    const operation = screen.fullScreen() ? screen.exitFullScreen() : screen.requestFullScreen();
    void operation.catch((cause: unknown) => error(`[UI] 切换全屏失败：${describeCause(cause)}`));
  }

  public showPage(pageId: MainPageId): void {
    if (EDITOR_NOT_IN_PREVIEW) {
      this.editorPreviewPage = previewValueFor(pageId);
      this.refreshEditorPreview(true);
      return;
    }
    this.node.scene?.getComponentInChildren(WorldInteractionController)?.clearSelection();
    this.activatePage(pageId);
  }

  private refreshEditorPreview(force: boolean): void {
    const pageId = pageIdForPreview(this.editorPreviewPage);
    if (force || this.activePage !== pageId) this.activatePage(pageId);
    this.appliedEditorPreviewPage = this.editorPreviewPage;
  }

  private activatePage(pageId: MainPageId): void {
    const target = this.pageNodeFor(pageId);
    if (target === null || !target.isValid) {
      error(`[UI] 主界面缺少${pageId}持久页面节点`);
      return;
    }
    for (const [id, node] of this.pageNodes()) node.active = id === pageId;
    this.activePage = pageId;
    this.refreshPageChrome(pageId);
  }

  private refreshPageChrome(pageId: MainPageId): void {
    // 主界面直接展示真实能源与船员状态；建造页保留自己的右侧操作栏，避免叠加两套面板。
    if (this.powerPanel !== null) this.powerPanel.node.active = pageId === 'MAIN_MENU' || pageId === 'SHIP';
    if (this.crewStatusPanel !== null) this.crewStatusPanel.node.active = pageId === 'MAIN_MENU' || pageId === 'SHIP' || pageId === 'CREW';
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
    this.deactivatePopupLayerIfEmpty();
    const names: Record<MainPageId, string> = { MAIN_MENU: '主界面', GALAXY_MAP: '星图', SHIP: '飞船', BUILD: '建造', CREW: '船员' };
    if (this.currentPageLabel !== null) this.currentPageLabel.string = names[pageId];
    this.refreshNavigationChrome();
  }

  private refreshSerializedReferences(): void {
    this.mainMenuPage ??= findDescendant(this.node, '主菜单页面');
    this.galaxyMapPage ??= findDescendant(this.node, '星图页面');
    this.shipPage ??= findDescendant(this.node, '飞船页面');
    this.buildPage ??= findDescendant(this.node, '建造页面');
    this.crewPage ??= findDescendant(this.node, '船员页面');
    this.powerPanel ??= findDescendant(this.node, '能源面板')?.getComponent(PowerPanel) ?? null;
    this.crewStatusPanel ??= findDescendant(this.node, '船员状态面板')?.getComponent(CrewStatusPanel) ?? null;
    this.settingsPopup = resolveSettingsPopup(
      this.settingsPopup,
      this.node.parent?.getChildByName('弹窗层'),
      findDescendant(this.node.scene ?? this.node, '设置弹窗'),
    );
    const navigation = findDescendant(this.node, '主导航栏');
    this.currentPageLabel = navigation?.getChildByName('当前页面提示')?.getComponent(Label)
      ?? findDescendant(this.node, '当前页面提示')?.getComponent(Label)
      ?? null;
  }

  private hasPersistentPageStructure(): boolean {
    const pageLayer = findDescendant(this.node, '页面层');
    const pages = this.pageNodes();
    return findDescendant(this.node, '主导航栏') !== null
      && pageLayer !== null
      && pages.length === 5
      && new Set(pages.map(([, node]) => node.uuid)).size === 5
      && pages.every(([, node]) => node.parent === pageLayer);
  }

  private pageNodes(): ReadonlyArray<readonly [MainPageId, Node]> {
    return [
      ['MAIN_MENU', this.mainMenuPage],
      ['GALAXY_MAP', this.galaxyMapPage],
      ['SHIP', this.shipPage],
      ['BUILD', this.buildPage],
      ['CREW', this.crewPage],
    ].filter((entry): entry is readonly [MainPageId, Node] => entry[1] !== null && entry[1].isValid);
  }

  private pageNodeFor(pageId: MainPageId): Node | null {
    if (pageId === 'MAIN_MENU') return this.mainMenuPage;
    if (pageId === 'GALAXY_MAP') return this.galaxyMapPage;
    if (pageId === 'SHIP') return this.shipPage;
    if (pageId === 'BUILD') return this.buildPage;
    return this.crewPage;
  }

  private registerEvents(): void {
    this.unregisterEvents();
    const handlers: ReadonlyArray<readonly [string, () => void]> = [
      ['主菜单按钮', this.showMainMenu], ['星图按钮', this.showGalaxyMap], ['飞船按钮', this.showShip],
      ['建造按钮', this.showBuild], ['船员按钮', this.showCrew], ['设置按钮', this.openSettings],
      ['全屏按钮', this.toggleFullScreen], ['进入战斗按钮', this.enterBattle],
    ];
    const navigation = findDescendant(this.node, '主导航栏');
    if (navigation === null) return;
    for (const [name, handler] of handlers) {
      const button = navigation.getChildByName(name);
      if (button === null) continue;
      button.on(Node.EventType.TOUCH_END, handler, this);
      this.navigationHandlers.push([button, handler]);
    }
  }

  private unregisterEvents(): void {
    for (const [button, handler] of this.navigationHandlers) button.off(Node.EventType.TOUCH_END, handler, this);
    this.navigationHandlers = [];
  }

  private deactivatePopupLayerIfEmpty(): void {
    const parent = this.settingsPopup?.parent;
    if (parent !== null && parent !== undefined && parent.children.every((child) => child.active !== true)) parent.active = false;
  }

  private refreshNavigationChrome(): void {
    const navigation = findDescendant(this.node, '主导航栏');
    if (navigation === null) return;
    this.refreshNavigationFrame(navigation);
    const settingsOpen = this.settingsPopup?.active === true;
    for (const [name, , pageId] of MAIN_NAVIGATION_BUTTONS) {
      const node = navigation.getChildByName(name);
      if (node !== null) {
        const selected = pageId === 'SETTINGS' ? settingsOpen : !settingsOpen && pageId === this.activePage;
        const label = node.getChildByName('文字')?.getComponent(Label);
        if (label !== null && label !== undefined) label.color = selected ? new Color(126, 235, 255, 255) : new Color(230, 240, 248, 255);
        const icon = node.getChildByName('图标')?.getComponent(Sprite);
        if (icon !== null && icon !== undefined) icon.color = selected ? Color.WHITE : new Color(205, 220, 230, 255);
      }
    }
    const battle = navigation.getChildByName('进入战斗按钮');
    if (battle !== null) battle.active = this.activePage !== 'BUILD' && !settingsOpen;
    const fullScreen = navigation.getChildByName('全屏按钮');
    if (fullScreen !== null) fullScreen.active = !settingsOpen;
  }

  private refreshNavigationFrame(navigation: Node): void {
    const frame = navigation.getChildByName('界面框架素材');
    if (frame === null || frame.getComponent(Sprite)?.spriteFrame === null) return;
    frame.setSiblingIndex(0);
  }
}

function pageIdForPreview(value: number): MainPageId {
  if (value === 1) return 'GALAXY_MAP';
  if (value === 2) return 'SHIP';
  if (value === 3) return 'BUILD';
  if (value === 4) return 'CREW';
  return 'MAIN_MENU';
}

function previewValueFor(pageId: MainPageId): number {
  if (pageId === 'GALAXY_MAP') return 1;
  if (pageId === 'SHIP') return 2;
  if (pageId === 'BUILD') return 3;
  if (pageId === 'CREW') return 4;
  return 0;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function resolveSettingsPopup(...candidates: Array<Node | null | undefined>): Node | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (candidate.name === '弹窗层') {
      const popup = candidate.getChildByName('设置弹窗');
      if (popup !== null) return popup;
      continue;
    }
    if (candidate.name === '设置弹窗') return candidate;
    // Cocos 3.8 重新导入 Prefab 实例时可能丢失根节点名称覆盖；
    // 只要序列化引用仍指向弹窗层下的实例，就继续使用该持久节点。
    if (candidate.parent?.name === '弹窗层') return candidate;
  }
  return null;
}

function findDescendant(root: Node, name: string): Node | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findDescendant(child, name);
    if (found !== null) return found;
  }
  return null;
}
