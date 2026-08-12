import { _decorator, Button, Color, Component, director, error, Graphics, Label, Layers, Node, screen, UITransform } from 'cc';

const { ccclass, menu, property } = _decorator;

export type MainPageId = 'MAIN_MENU' | 'GALAXY_MAP' | 'SHIP' | 'BUILD' | 'CREW';

/** 主场景页面切换只控制 Creator 持久保存的 Page Prefab 实例，不在运行时创建页面。 */
@ccclass('MainPageRouter')
@menu('星舰协议/界面/主界面页面路由')
export class MainPageRouter extends Component {
  @property({ type: Node, displayName: '主菜单页面', tooltip: 'MainMenuPage Prefab 的持久实例。', group: '页面' })
  public mainMenuPage: Node | null = null;

  @property({ type: Node, displayName: '星图页面', tooltip: 'GalaxyMapPage Prefab 的持久实例。', group: '页面' })
  public galaxyMapPage: Node | null = null;

  @property({ type: Node, displayName: '飞船页面', tooltip: 'ShipMainPage Prefab 的持久实例。', group: '页面' })
  public shipPage: Node | null = null;

  @property({ type: Node, displayName: '建造页面', tooltip: 'BuildPage Prefab 的持久实例。', group: '页面' })
  public buildPage: Node | null = null;

  @property({ type: Node, displayName: '船员页面', tooltip: 'CrewPage Prefab 的持久实例。', group: '页面' })
  public crewPage: Node | null = null;

  @property({ type: Node, displayName: '设置弹窗', tooltip: 'SettingsPopup Prefab 的持久实例。', group: '弹窗' })
  public settingsPopup: Node | null = null;

  @property({ type: Label, displayName: '当前页面提示', tooltip: '显示当前激活页面的中文名称。', group: '导航' })
  public currentPageLabel: Label | null = null;

  private navigationHandlers: Array<readonly [Node, () => void]> = [];

  /** 仅供创作插件补齐共享 UIRoot 中的正式页面挂载点。页面内容后续可替换为同名 Prefab。 */
  public ensureAuthoringPrefabStructure(settingsPopup: Node): boolean {
    this.node.layer = Layers.Enum.UI_2D;
    this.mainMenuPage = ensurePage(this.node, '主菜单页面');
    this.galaxyMapPage = ensurePage(this.node, '星图页面');
    this.shipPage = ensurePage(this.node, '飞船页面');
    this.buildPage = ensurePage(this.node, '建造页面');
    this.crewPage = ensurePage(this.node, '船员页面');
    this.settingsPopup = settingsPopup;
    const navigation = ensureNode(this.node, '主导航栏', 0, 320, 900, 48);
    const buttons = [
      ['主菜单按钮', '主菜单', -350], ['星图按钮', '星图', -250], ['飞船按钮', '飞船', -150],
      ['建造按钮', '建造', -50], ['船员按钮', '船员', 50], ['设置按钮', '设置', 150],
      ['全屏按钮', '全屏', 230], ['进入战斗按钮', '进入战斗', 330],
    ] as const;
    for (const [name, text, x] of buttons) ensureButton(navigation, name, text, x, text === '进入战斗' ? 120 : 92);
    this.currentPageLabel = ensureLabel(this.node, '当前页面提示', '当前页面：主菜单', 0, 278, 420);
    return true;
  }

  protected onEnable(): void {
    this.refreshSerializedReferences();
    this.registerEvents();
    this.showPage('MAIN_MENU');
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
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
    if (this.settingsPopup === null) error('[UI] 主界面缺少设置弹窗 Prefab 实例');
    else {
      this.settingsPopup.active = true;
      if (this.currentPageLabel !== null) this.currentPageLabel.string = '当前页面：设置';
    }
  }

  public closeSettings(): void {
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
    if (this.currentPageLabel !== null) this.currentPageLabel.string = '当前页面：主菜单';
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
    const pages: ReadonlyArray<readonly [MainPageId, Node | null]> = [
      ['MAIN_MENU', this.mainMenuPage],
      ['GALAXY_MAP', this.galaxyMapPage],
      ['SHIP', this.shipPage],
      ['BUILD', this.buildPage],
      ['CREW', this.crewPage],
    ];
    if (pages.some(([, node]) => node === null)) {
      error('[UI] 主界面页面路由缺少一个或多个持久 Page Prefab 实例');
      return;
    }
    for (const [id, node] of pages) (node as Node).active = id === pageId;
    if (this.settingsPopup !== null) this.settingsPopup.active = false;
    const names: Record<MainPageId, string> = { MAIN_MENU: '主菜单', GALAXY_MAP: '星图', SHIP: '飞船', BUILD: '建造', CREW: '船员' };
    if (this.currentPageLabel !== null) this.currentPageLabel.string = `当前页面：${names[pageId]}`;
  }

  private refreshSerializedReferences(): void {
    this.currentPageLabel = this.node.getChildByName('当前页面提示')?.getComponent(Label) ?? null;
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
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ensurePage(parent: Node, name: string): Node {
  const node = parent.getChildByName(name) ?? new Node(name);
  if (node.parent === null) parent.addChild(node);
  node.layer = Layers.Enum.UI_2D;
  return node;
}

function ensureNode(parent: Node, name: string, x: number, y: number, width: number, height: number): Node {
  const existing = parent.getChildByName(name);
  const node = existing ?? new Node(name);
  if (existing === null) {
    parent.addChild(node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(width, height);
  }
  node.layer = Layers.Enum.UI_2D;
  return node;
}

function ensureLabel(parent: Node, name: string, text: string, x: number, y: number, width: number): Label {
  const existed = parent.getChildByName(name) !== null;
  const node = ensureNode(parent, name, x, y, width, 36);
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  if (!existed) {
    label.string = text;
    label.fontSize = 18;
    label.lineHeight = 30;
    label.color = new Color(230, 240, 248, 255);
  }
  return label;
}

function ensureButton(parent: Node, name: string, text: string, x: number, width: number): Button {
  const existed = parent.getChildByName(name) !== null;
  const node = ensureNode(parent, name, x, 0, width, 34);
  const graphics = node.getComponent(Graphics) ?? node.addComponent(Graphics);
  if (!existed) {
    graphics.clear();
    graphics.fillColor = new Color(27, 67, 92, 245);
    graphics.roundRect(-width / 2, -17, width, 34, 5);
    graphics.fill();
    graphics.lineWidth = 1;
    graphics.strokeColor = new Color(92, 187, 220, 255);
    graphics.roundRect(-width / 2, -17, width, 34, 5);
    graphics.stroke();
  }
  const button = node.getComponent(Button) ?? node.addComponent(Button);
  ensureLabel(node, '文字', text, 0, 0, width);
  return button;
}
