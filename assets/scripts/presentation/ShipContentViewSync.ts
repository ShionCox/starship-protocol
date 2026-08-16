import { _decorator, Component, error, instantiate, Node, Prefab } from 'cc';
import type { ParsedGameConfig } from '../game-core/CsvGameConfig';
import type { ShipSnapshot } from '../game-core/ShipModel';
import { BuildablePrefabCatalog } from './BuildablePrefabCatalog';
import {
  ConstructionGhostView,
  type ConstructionContextHandler,
  type ConstructionSelectHandler,
} from './ConstructionGhostView';
import { FloorView } from './FloorView';
import { RoomView } from './RoomView';
import { ShipView } from './ShipView';

const { ccclass, menu, property } = _decorator;

/**
 * 玩家建造内容的表现同步器。只在 ShipView 已持久保存的容器内复用或实例化 Prefab，
 * 缺少映射时中文报错并停止；不作为场景初始节点缺失的运行时兜底。
 */
@ccclass('ShipContentViewSync')
@menu('星舰协议/场景表现/飞船动态内容同步')
export class ShipContentViewSync extends Component {
  @property({ type: ShipView, displayName: '飞船视图', tooltip: '当前单舰表现根。', group: '持久引用' })
  public shipView: ShipView | null = null;

  @property({ type: BuildablePrefabCatalog, displayName: '可建造目录', tooltip: 'definitionId 到 Prefab 的持久映射。', group: '持久引用' })
  public catalog: BuildablePrefabCatalog | null = null;

  @property({ type: Node, displayName: '施工预览容器', tooltip: 'ShipView 中持久保存的施工幽灵容器。', group: '持久引用' })
  public constructionRoot: Node | null = null;

  @property({ type: Prefab, displayName: '施工幽灵预制体', tooltip: '带 ConstructionGhostView 的持久 Prefab。', group: '持久引用' })
  public constructionGhostPrefab: Prefab | null = null;

  private constructionSelectHandler: ConstructionSelectHandler | null = null;
  private constructionContextHandler: ConstructionContextHandler | null = null;

  /** 创作工具补齐组件后只连接同一 ShipView 已持久保存的引用。 */
  public applyAuthoringReferences(): boolean {
    this.shipView = this.getComponent(ShipView);
    this.catalog = this.getComponent(BuildablePrefabCatalog);
    this.constructionRoot = this.shipView?.constructionRoot ?? null;
    return this.shipView !== null && this.catalog !== null && this.constructionRoot !== null;
  }

  public bindInteraction(
    selectHandler: ConstructionSelectHandler,
    contextHandler: ConstructionContextHandler,
  ): void {
    this.constructionSelectHandler = selectHandler;
    this.constructionContextHandler = contextHandler;
  }

  public sync(snapshot: Readonly<ShipSnapshot>, config: Readonly<ParsedGameConfig>): boolean {
    const ship = this.shipView;
    const catalog = this.catalog;
    if (ship === null || catalog === null || ship.floorRoot === null || ship.roomRoot === null || this.constructionRoot === null) {
      error('[UI] 动态内容同步缺少 ShipView、Prefab目录或持久容器');
      return false;
    }
    const floorDefinitions = new Map(config.floors.map((definition) => [definition.id, definition]));
    const roomDefinitions = new Map(config.rooms.map((definition) => [definition.id, definition]));
    const floorViews = new Map(ship.floorRoot.getComponentsInChildren(FloorView).map((view) => [view.floorInstanceId.trim(), view]));
    for (const floor of snapshot.floors) {
      let view = floorViews.get(floor.instanceId);
      if (view === undefined) {
        const prefab = catalog.resolve(floor.definitionId);
        if (prefab === null) return this.fail(`缺少地板 Prefab 映射：${floor.definitionId}`);
        const node = instantiate(prefab);
        ship.floorRoot.addChild(node);
        view = node.getComponent(FloorView) ?? undefined;
        if (view === undefined) return this.fail(`地板 Prefab 缺少 FloorView：${floor.definitionId}`);
        view.floorInstanceId = floor.instanceId;
      }
      const definition = floorDefinitions.get(floor.definitionId);
      if (definition === undefined) return this.fail(`floors.csv 缺少定义：${floor.definitionId}`);
      view.bind(definition, floor, ship);
      floorViews.delete(floor.instanceId);
    }
    for (const stale of floorViews.values()) stale.node.destroy();

    const roomViews = new Map(ship.roomRoot.getComponentsInChildren(RoomView).map((view) => [view.roomInstanceId.trim(), view]));
    for (const room of snapshot.rooms) {
      let view = roomViews.get(room.instanceId);
      if (view === undefined) {
        const prefab = catalog.resolve(room.definitionId);
        if (prefab === null) return this.fail(`缺少房间 Prefab 映射：${room.definitionId}`);
        const node = instantiate(prefab);
        ship.roomRoot.addChild(node);
        view = node.getComponent(RoomView) ?? undefined;
        if (view === undefined) return this.fail(`房间 Prefab 缺少 RoomView：${room.definitionId}`);
        view.roomInstanceId = room.instanceId;
        view.roomDefinitionId = room.definitionId;
      }
      const definition = roomDefinitions.get(room.definitionId);
      if (definition === undefined) return this.fail(`rooms.csv 缺少定义：${room.definitionId}`);
      const local = ship.gridPositionToParentLocal(ship.roomRoot, room, definition.width, definition.height);
      if (local === null) return this.fail(`房间快照位置无效：${room.instanceId}`);
      view.node.setPosition(local);
      roomViews.delete(room.instanceId);
    }
    for (const stale of roomViews.values()) stale.node.destroy();
    this.syncGhosts(snapshot, config);
    return true;
  }

  private syncGhosts(snapshot: Readonly<ShipSnapshot>, config: Readonly<ParsedGameConfig>): void {
    if (this.constructionRoot === null || this.shipView === null || this.constructionGhostPrefab === null) return;
    const existing = new Map(this.constructionRoot.getComponentsInChildren(ConstructionGhostView).map((view) => [view.node.name, view]));
    for (const job of snapshot.constructionJobs) {
      let view = existing.get(job.jobId);
      if (view === undefined) {
        const node = instantiate(this.constructionGhostPrefab);
        node.active = true;
        node.name = job.jobId;
        this.constructionRoot.addChild(node);
        view = node.getComponent(ConstructionGhostView) ?? undefined;
      }
      if (view === undefined) continue;
      const room = config.rooms.find((entry) => entry.id === job.definitionId);
      view.bind(
        job,
        room?.width ?? 1,
        room?.height ?? 1,
        this.shipView,
        this.constructionSelectHandler,
        this.constructionContextHandler,
      );
      existing.delete(job.jobId);
    }
    for (const stale of existing.values()) stale.node.destroy();
  }

  private fail(message: string): false {
    error(`[UI] ${message}`);
    return false;
  }
}
