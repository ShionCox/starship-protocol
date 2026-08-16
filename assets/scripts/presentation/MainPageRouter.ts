import {
  _decorator,
  Color,
  Component,
  director,
  error,
  Label,
  Node,
  Prefab,
  screen,
  Sprite,
  instantiate,
} from 'cc';
import { WorldInteractionController } from './WorldInteractionController';
import { PowerPanel } from './PowerPanel';
import { CrewStatusPanel } from './CrewStatusPanel';

const { ccclass, menu, property } = _decorator;

export type MainPageId = 'MAIN_MENU' | 'GALAXY_MAP' | 'SHIP' | 'BUILD' | 'CREW';

export type MainPageMountHandler = (pageId: MainPageId, pageRoot: Node | null) => void;

const MAIN_NAVIGATION_BUTTONS: ReadonlyArray<readonly [string, string, MainPageId | 'SETTINGS', number]> = [
  ['主菜单按钮', '主界面', 'MAIN_MENU', -558],
  ['星图按钮', '星图', 'GALAXY_MAP', -406],
  ['飞船按钮', '飞船', 'SHIP', -254],
  ['建造按钮', '建造', 'BUILD', -102],
  ['船员按钮', '船员', 'CREW', 50],
  ['设置按钮', '设置', 'SETTINGS', 202],
];

/** 主场景页面路由；页面资源由 Creator 持久引用，页面节点按需挂载并在离开时销毁。 */
@ccclass('MainPageRouter')
@menu('星舰协议/界面/主界面页面路由')
export class MainPageRouter extends Component {
  @property({ type: Prefab, displayName: '主菜单页面资源', tooltip: 'MainMenuPage.prefab 资源；切页时实例化。', group: '页面资源' })
  public mainMenuPagePrefab: Prefab | null = null;

  @property({ type: Prefab, displayName: '星图页面资源', tooltip: 'GalaxyMapPage.prefab 资源；切页时实例化。', group: '页面资源' })
  public galaxyMapPagePrefab: Prefab | null = null;

  @property({ type: Prefab, displayName: '飞船页面资源', tooltip: 'ShipMainPage.prefab 资源；切页时实例化。', group: '页面资源' })
  public shipPagePrefab: Prefab | null = null;

  @property({ type: Prefab, displayName: '建造页面资源', tooltip: 'BuildPage.prefab 资源；切页时实例化。', group: '页面资源' })
  public buildPagePrefab: Prefab | null = null;

  @property({ type: Prefab, displayName: '船员页面资源', tooltip: 'CrewPage.prefab 资源；切页时实例化。', group: '页面资源' })
  public crewPagePrefab: Prefab | null = null;

  @property({ type: Node, displayName: '页面挂载点', tooltip: '动态页面唯一挂载点；保存 Prefab 时应保持为空。', group: '页面资源' })
  public pageHost: Node | null = null;

  @property({ type: PowerPanel, displayName: '能源面板', tooltip: '主界面中持久保存的能源面板。', group: '页面联动' })
  public powerPanel: PowerPanel | null = null;

  @property({ type: CrewStatusPanel, displayName: '船员状态面板', tooltip: '主界面中持久保存的船员状态面板。', group: '页面联动' })
  public crewStatusPanel: CrewStatusPanel | null = null;

  @property({ type: Node, displayName: '设置弹窗', tooltip: 'SettingsPopup Prefab 的持久实例。', group: '弹窗' })
  public settingsPopup: Node | null = null;

  @property({ type: Label, displayName: '当前页面提示', tooltip: '显示当前激活页面的中文名称。', group: '导航' })
  public currentPageLabel: Label | null = null;

  private navigationHandlers: Array<readonly [Node, () => void]> = [];
  private activePage: MainPageId = 'MAIN_MENU';
  private pageBeforeSettings: MainPageId = 'MAIN_MENU';
  private activePageNode: Node | null = null;
  private pageMountHandler: MainPageMountHandler | null = null;

  protected onEnable(): void {
    this.refreshSerializedReferences();
    if (this.node.getChildByName('主导航栏') === null || this.pageHost === null || this.mainMenuPagePrefab === null || this.galaxyMapPagePrefab === null || this.shipPagePrefab === null || this.buildPagePrefab === null || this.crewPagePrefab === null) {
      error('主界面 Prefab 缺少页面挂载点或五个页面资源引用，运行时不会重建主界面结构。');
      return;
    }
    this.clearPageHost();
    this.registerEvents();
    this.showPage('MAIN_MENU');
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
  }

  protected onDisable(): void {
    this.unregisterEvents();
    this.destroyActivePage();
  }

  public showMainMenu(): void { this.showPage('MAIN_MENU'); }
  public showGalaxyMap(): void { this.showPage('GALAXY_MAP'); }
  public showShip(): void { this.showPage('SHIP'); }
  public showBuild(): void { this.showPage('BUILD'); }
  public showCrew(): void { this.showPage('CREW'); }

  /** 绑定页面挂载生命周期；绑定后立即回放当前页面，便于 Bootstrap 接入动态控制器。 */
  public bindPageMount(handler: MainPageMountHandler | null): void {
    this.pageMountHandler = handler;
    if (handler !== null && this.activePageNode !== null && this.activePageNode.isValid) handler(this.activePage, this.activePageNode);
  }

  public getActivePageRoot(): Node | null { return this.activePageNode?.isValid === true ? this.activePageNode : null; }

  public openSettings(): void {
    // 设置入口同时承担关闭动作，保证动态页面仍能恢复进入前的页面。
    if (this.settingsPopup?.active === true) {
      this.closeSettings();
      return;
    }
    this.node.scene?.getComponentInChildren(WorldInteractionController)?.clearSelection();
    if (this.settingsPopup === null) error('[UI] 主界面缺少设置弹窗 Prefab 实例');
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
    this.node.scene?.getComponentInChildren(WorldInteractionController)?.clearSelection();
    if (this.activePage === pageId && this.activePageNode?.isValid === true) {
      this.refreshPageChrome(pageId);
      return;
    }
    const prefab = this.pagePrefabFor(pageId);
    if (this.pageHost === null || !this.pageHost.isValid) {
      error('[UI] 主界面缺少动态页面挂载点');
      return;
    }
    if (prefab === null) {
      error(`[UI] 主界面缺少${pageId}页面 Prefab 资源`);
      return;
    }
    let nextPage: Node | null = null;
    try {
      nextPage = instantiate(prefab);
      nextPage.name = pageId;
      nextPage.active = false;
      this.pageHost.addChild(nextPage);
      this.pageMountHandler?.(pageId, nextPage);
      nextPage.active = true;
    } catch (cause) {
      nextPage?.destroy();
      error(`[UI] ${pageId}页面挂载失败：${describeCause(cause)}`);
      return;
    }
    if (nextPage === null || !nextPage.isValid) return;
    const previousPage = this.activePageNode;
    const previousPageId = this.activePage;
    if (previousPage !== null && previousPage.isValid) {
      previousPage.active = false;
      this.pageMountHandler?.(previousPageId, null);
      previousPage.destroy();
    }
    this.activePageNode = nextPage;
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
    this.pageHost ??= this.node.getChildByName('页面挂载点');
    this.powerPanel ??= this.node.getChildByName('能源面板')?.getComponent(PowerPanel) ?? null;
    this.crewStatusPanel ??= this.node.getChildByName('船员状态面板')?.getComponent(CrewStatusPanel) ?? null;
    this.settingsPopup = resolveSettingsPopup(
      this.settingsPopup,
      this.node.parent?.getChildByName('弹窗层'),
      findDescendant(this.node.scene ?? this.node, '设置弹窗'),
    );
    const navigation = this.node.getChildByName('主导航栏');
    this.currentPageLabel = navigation?.getChildByName('当前页面提示')?.getComponent(Label)
      ?? this.node.getChildByName('当前页面提示')?.getComponent(Label)
      ?? null;
  }

  private registerEvents(): void {
    this.unregisterEvents();
    const handlers: ReadonlyArray<readonly [string, () => void]> = [
      ['主菜单按钮', this.showMainMenu], ['星图按钮', this.showGalaxyMap], ['飞船按钮', this.showShip],
      ['建造按钮', this.showBuild], ['船员按钮', this.showCrew], ['设置按钮', this.openSettings],
      ['全屏按钮', this.toggleFullScreen], ['进入战斗按钮', this.enterBattle],
    ];
    const navigation = this.node.getChildByName('主导航栏');
    if (navigation === null) return;
    for (const [name, handler] of handlers) {
      const button = navigation.getChildByName(name);
      if (button === null) continue;
      button.on(Node.EventType.TOUCH_END, handler, this);
      this.navigationHandlers.push([button, handler]);
    }
  }

  private unregisterEvents(): void {
    for (const [button, handler] of this.navigationHandlers) {
      button.off(Node.EventType.TOUCH_END, handler, this);
    }
    this.navigationHandlers = [];
  }

  private deactivatePopupLayerIfEmpty(): void {
    const parent = this.settingsPopup?.parent;
    if (parent !== null && parent !== undefined && parent.children.every((child) => child.active !== true)) parent.active = false;
  }

  private refreshNavigationChrome(): void {
    const navigation = this.node.getChildByName('主导航栏');
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
    if (battle !== null) {
      battle.active = this.activePage !== 'BUILD' && !settingsOpen;
    }
    const fullScreen = navigation.getChildByName('全屏按钮');
    if (fullScreen !== null) fullScreen.active = !settingsOpen;
  }

  private refreshNavigationFrame(navigation: Node): void {
    const frame = navigation.getChildByName('界面框架素材');
    if (frame === null || frame.getComponent(Sprite)?.spriteFrame === null) return;
    frame.setSiblingIndex(0);
  }

  private pagePrefabFor(pageId: MainPageId): Prefab | null {
    if (pageId === 'MAIN_MENU') return this.mainMenuPagePrefab;
    if (pageId === 'GALAXY_MAP') return this.galaxyMapPagePrefab;
    if (pageId === 'SHIP') return this.shipPagePrefab;
    if (pageId === 'BUILD') return this.buildPagePrefab;
    return this.crewPagePrefab;
  }

  private clearPageHost(): void {
    if (this.pageHost === null) return;
    for (const child of [...this.pageHost.children]) {
      child.active = false;
      child.destroy();
    }
    this.activePageNode = null;
  }

  private destroyActivePage(): void {
    const page = this.activePageNode;
    if (page === null || !page.isValid) return;
    page.active = false;
    this.pageMountHandler?.(this.activePage, null);
    page.destroy();
    this.activePageNode = null;
  }
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
    // Cocos 3.8 重新导入 Prefab 实例时可能丢失根节点的名称覆盖；
    // 只要序列化引用仍指向弹窗层下的实例，就继续使用该持久节点，
    // 避免把可用设置弹窗误判为缺失并在运行时动态补节点。
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
