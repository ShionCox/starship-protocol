import { _decorator, Button, Component, error, instantiate, Label, Layout, Node, Prefab, ScrollView, UITransform } from 'cc';
import type { ParsedGameConfig } from '../game-core/CsvGameConfig';
import type { ShipSnapshot } from '../game-core/ShipModel';
import { BuildablePrefabCatalog } from './BuildablePrefabCatalog';
import { BuildOptionCard, type BuildOptionCardModel } from './BuildOptionCard';

const { ccclass, menu, property } = _decorator;

export type BuildPageIntent =
  | { readonly type: 'START_BUILD'; readonly definitionKind: 'FLOOR' | 'ROOM'; readonly definitionId: string; readonly x: number; readonly y: number }
  | { readonly type: 'CANCEL'; readonly jobId: string };

export type BuildPageDispatch = (intent: BuildPageIntent) => Promise<{ readonly ok: boolean; readonly message: string }>;
export type BuildPlacementStart = (option: BuildOptionCardModel) => void;
export type BuildPlacementCancel = () => void;
export type BuildCategory = 'ALL' | 'STRUCTURE' | 'MOVEMENT' | 'ENERGY' | 'COMBAT' | 'SUPPORT';

interface BuildOption extends BuildOptionCardModel {
  readonly categoryId: BuildCategory;
}

/** P8 建造页面：右侧目录只负责选择和拖拽，规则预览与 Command 由应用层/GameCore 决定。 */
@ccclass('BuildPageController')
@menu('星舰协议/界面/建造页面')
export class BuildPageController extends Component {
  @property({ type: Node, displayName: '建造侧栏', tooltip: '右侧建造目录容器，其他区域保持世界可操作。', group: '持久引用' })
  public sidebarRoot: Node | null = null;

  @property({ type: Node, displayName: '分类栏', tooltip: '全部、结构、通行、能源、战斗、支援分类按钮容器。', group: '持久引用' })
  public categoryRoot: Node | null = null;

  @property({ type: ScrollView, displayName: '建筑列表', tooltip: '可拖拽建筑卡片滚动列表。', group: '持久引用' })
  public optionScrollView: ScrollView | null = null;

  @property({ type: Prefab, displayName: '建筑卡片模板', tooltip: 'BuildOptionCard.prefab 重复实例模板。', group: '持久引用' })
  public optionCardPrefab: Prefab | null = null;

  @property({ type: Label, displayName: '金属与槽位', tooltip: '显示当前金属和施工槽。', group: '显示' })
  public resourceLabel: Label | null = null;

  @property({ type: Label, displayName: '施工队列', tooltip: '显示施工项目、进度、工程师和等待状态。', group: '显示' })
  public jobsLabel: Label | null = null;

  @property({ type: Label, displayName: '状态提示', tooltip: '显示拖拽放置和 Command 的中文结果。', group: '显示' })
  public statusLabel: Label | null = null;

  @property({ type: Button, displayName: '取消选中项目', tooltip: '先选中施工 Ghost，再取消对应施工项目。', group: '交互' })
  public cancelSelectedButton: Button | null = null;

  @property({ type: [Button], displayName: '分类按钮', tooltip: '按固定顺序绑定六个分类。', group: '交互' })
  public categoryButtons: Button[] = [];

  private config: Readonly<ParsedGameConfig> | null = null;
  private snapshot: Readonly<ShipSnapshot> | null = null;
  private metal = 0;
  private constructionSlots = 0;
  private catalog: BuildablePrefabCatalog | null = null;
  private dispatch: BuildPageDispatch | null = null;
  private beginPlacement: BuildPlacementStart | null = null;
  private cancelPlacement: BuildPlacementCancel | null = null;
  private selectedCategory: BuildCategory = 'ALL';
  private selectedConstructionJobId: string | null = null;
  private readonly cards = new Map<string, BuildOptionCard>();
  private readonly categoryHandlers: Array<readonly [Button, () => void]> = [];
  private cancelHandler: (() => void) | null = null;

  protected onEnable(): void {
    if (this.sidebarRoot === null || this.categoryRoot === null || this.optionScrollView === null || this.optionCardPrefab === null || this.resourceLabel === null || this.jobsLabel === null || this.statusLabel === null || this.cancelSelectedButton === null || this.categoryButtons.length < 6) {
      error('建造页面 Prefab 缺少持久布局引用，运行时不会重建 UI。');
      return;
    }
    this.registerEvents();
  }
  protected onDisable(): void {
    this.unregisterEvents();
    this.cancelPlacement?.();
  }

  public bind(
    input: {
      readonly config: Readonly<ParsedGameConfig>;
      readonly snapshot: Readonly<ShipSnapshot>;
      readonly metal: number;
      readonly constructionSlots: number;
      readonly catalog: BuildablePrefabCatalog | null;
      readonly selectedConstructionJobId?: string | null;
    },
    dispatch: BuildPageDispatch,
    beginPlacement: BuildPlacementStart,
    cancelPlacement?: BuildPlacementCancel,
  ): void {
    this.config = input.config;
    this.snapshot = input.snapshot;
    this.metal = input.metal;
    this.constructionSlots = input.constructionSlots;
    this.catalog = input.catalog;
    this.selectedConstructionJobId = input.selectedConstructionJobId ?? null;
    this.dispatch = dispatch;
    this.beginPlacement = beginPlacement;
    this.cancelPlacement = cancelPlacement ?? null;
    this.refresh();
  }

  public setSelectedConstructionJob(jobId: string | null): void {
    this.selectedConstructionJobId = jobId;
    this.refreshQueue();
  }

  public setStatus(message: string): void { if (this.statusLabel !== null) this.statusLabel.string = message; }

  private registerEvents(): void {
    this.unregisterEvents();
    const ids: readonly BuildCategory[] = ['ALL', 'STRUCTURE', 'MOVEMENT', 'ENERGY', 'COMBAT', 'SUPPORT'];
    for (let index = 0; index < Math.min(ids.length, this.categoryButtons.length); index += 1) {
      const button = this.categoryButtons[index];
      const handler = (): void => { this.selectedCategory = ids[index]; this.refreshCards(); };
      button.node.on(Node.EventType.TOUCH_END, handler, this);
      this.categoryHandlers.push([button, handler]);
    }
    if (this.cancelSelectedButton !== null) {
      this.cancelHandler = (): void => { void this.cancelSelectedJob(); };
      this.cancelSelectedButton.node.on(Node.EventType.TOUCH_END, this.cancelHandler, this);
    }
  }

  private unregisterEvents(): void {
    for (const [button, handler] of this.categoryHandlers) button.node.off(Node.EventType.TOUCH_END, handler, this);
    this.categoryHandlers.length = 0;
    if (this.cancelSelectedButton !== null && this.cancelHandler !== null) this.cancelSelectedButton.node.off(Node.EventType.TOUCH_END, this.cancelHandler, this);
    this.cancelHandler = null;
  }

  private refresh(): void {
    if (this.resourceLabel !== null) this.resourceLabel.string = `金属：${this.metal}　施工槽：${this.snapshot?.constructionJobs.length ?? 0}/${this.constructionSlots}`;
    this.refreshCards();
    this.refreshQueue();
  }

  private refreshCards(): void {
    const content = this.optionScrollView?.content;
    if (content === null || content === undefined) return;
    const options = this.options().filter((option) => this.selectedCategory === 'ALL' || option.categoryId === this.selectedCategory);
    const visible = new Set(options.map((option) => option.id));
    let layoutDirty = false;
    for (const [id, card] of this.cards) {
      const active = visible.has(id);
      if (card.node.active !== active) {
        card.node.active = active;
        layoutDirty = true;
      }
    }
    if (this.optionCardPrefab === null) {
      this.setStatus('建造卡片模板尚未完成 Creator 持久升级');
      return;
    }
    for (const option of options) {
      let card = this.cards.get(option.id);
      if (card === undefined) {
        const node = instantiate(this.optionCardPrefab);
        content.addChild(node);
        card = node.getComponent(BuildOptionCard) ?? undefined;
        if (card === undefined) continue;
        this.cards.set(option.id, card);
        layoutDirty = true;
      }
      const available = this.metal >= option.cost && (this.snapshot?.constructionJobs.length ?? 0) < this.constructionSlots;
      const reason = available ? '' : this.metal < option.cost ? `还差 ${option.cost - this.metal} 金属` : '施工槽已满';
      card.node.active = true;
      card.bind(option, available, reason, () => this.beginPlacement?.(option));
    }
    if (!layoutDirty) return;
    // 子节点是运行时按目录创建的，Creator 不会替我们在同一帧刷新 Layout。
    // 立即排版并保证空列表/单卡片时内容高度不小于视口，避免内容尺寸为负数
    // 或卡片从视口外溢出；多卡片时由 CONTAINER 模式保留真实滚动高度。
    const layout = content.getComponent(Layout);
    layout?.updateLayout(true);
    const contentTransform = content.getComponent(UITransform);
    const viewportTransform = this.optionScrollView?.node.getComponent(UITransform);
    if (contentTransform !== null && viewportTransform !== null && viewportTransform !== undefined) {
      const minHeight = viewportTransform.contentSize.height;
      if (contentTransform.contentSize.height < minHeight) {
        contentTransform.setContentSize(contentTransform.contentSize.width, minHeight);
      }
    }
  }

  private refreshQueue(): void {
    const jobs = this.snapshot?.constructionJobs ?? [];
    if (this.jobsLabel !== null) this.jobsLabel.string = jobs.length === 0 ? '施工队列：空' : jobs.map((job) => {
      const selected = job.jobId === this.selectedConstructionJobId ? '▶ ' : '';
      const progress = job.requiredWorkMs <= 0 ? 100 : Math.floor(job.completedWorkMs * 100 / job.requiredWorkMs);
      const type = job.operation.startsWith('DEMOLISH') ? '拆除' : job.operation === 'BUILD_ROOM' ? '建造房间' : '建造地板';
      const engineers = job.operation.startsWith('DEMOLISH') ? '无需工程师' : `到场 ${job.buildersAtSite.length}/${job.assignedCrewIds.length || 1}`;
      return `${selected}${type} ${job.targetInstanceId} ${progress}% ${engineers}`;
    }).join('\n');
    if (this.cancelSelectedButton !== null) this.cancelSelectedButton.interactable = this.selectedConstructionJobId !== null;
  }

  private async cancelSelectedJob(): Promise<void> {
    const jobId = this.selectedConstructionJobId;
    if (jobId === null || this.dispatch === null) return;
    const result = await this.dispatch({ type: 'CANCEL', jobId });
    this.setStatus(result.message);
  }

  private options(): readonly BuildOption[] {
    if (this.config === null) return [];
    const floors: BuildOption[] = this.config.floors.map((floor) => ({
      kind: 'FLOOR', id: floor.id, name: floor.displayName, category: '结构', categoryId: 'STRUCTURE', width: 1, height: 1,
      cost: floor.metalCost, durationMs: floor.buildDurationMs, previewFrame: this.catalog?.resolvePreviewFrame(floor.id) ?? null,
    }));
    const rooms: BuildOption[] = this.config.rooms.map((room) => ({
      kind: 'ROOM', id: room.id, name: room.displayName, category: room.category, categoryId: categoryForRoom(room.category), width: room.width, height: room.height,
      cost: room.metalCost, durationMs: room.buildDurationMs, previewFrame: this.catalog?.resolvePreviewFrame(room.id) ?? null,
    }));
    return Object.freeze([...floors, ...rooms]);
  }
}

function categoryForRoom(category: string): Exclude<BuildCategory, 'ALL' | 'STRUCTURE'> {
  if (category === 'MOVEMENT' || category === 'MOBILITY') return 'MOVEMENT';
  if (category === 'ENERGY') return 'ENERGY';
  if (category === 'WEAPON' || category === 'DEFENSE' || category === 'TACTICAL' || category === 'DRONE') return 'COMBAT';
  return 'SUPPORT';
}
