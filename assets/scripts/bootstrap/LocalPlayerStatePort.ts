import {
  PLAYER_STATE_SCHEMA_VERSION,
  type ConstructionPreviewRequest,
  type ConstructionPreviewResult,
  type KeyValueStorage,
  type PlayerCommandRequest,
  type PlayerCommandResult,
  type PlayerBootstrapResult,
  type OfflineConstructionSummary,
  type PlayerStatePort,
  type PlayerStateSnapshot,
} from '../application/PlayerStatePort.ts';
import { ShipModel, type ShipModelBlueprint } from '../game-core/ShipModel.ts';
import type { ConstructionJobSnapshot } from '../game-core/ConstructionModel.ts';

export const LOCAL_PLAYER_STATE_KEY = 'starship-protocol:dev:player-state:v1';

/** 本地玩家状态适配器的装配参数；时间和告警均可注入以保持测试确定。 */
export interface LocalPlayerStateOptions {
  readonly storage: KeyValueStorage;
  readonly configVersion: string;
  readonly activeShipId: string;
  readonly ships: readonly ShipModelBlueprint[];
  readonly initialMetal?: number;
  readonly now?: () => number;
  readonly warn?: (message: string) => void;
}

/**
 * 开发期单文件玩家状态适配器。一次 Command 只写一个 JSON Envelope；写入失败时按 Command
 * 前快照重建全部飞船，避免 UI 显示未持久化状态。
 */
export class LocalPlayerStatePort implements PlayerStatePort {
  private readonly storage: KeyValueStorage;
  private readonly configVersion: string;
  private readonly activeShipId: string;
  private readonly blueprints: ReadonlyMap<string, ShipModelBlueprint>;
  private readonly now: () => number;
  private readonly warn: (message: string) => void;
  private readonly initialMetal: number;
  private readonly completedRequests = new Map<string, PlayerCommandResult>();
  private models = new Map<string, ShipModel>();
  private revision = 0;
  private savedAtUnixMs = 0;
  private metal: number;

  public constructor(options: LocalPlayerStateOptions) {
    if (options.ships.length === 0) throw new RangeError('玩家状态至少需要一艘飞船');
    this.storage = options.storage;
    this.configVersion = options.configVersion;
    this.activeShipId = options.activeShipId;
    // 代号 hash 必须使用与 Envelope 相同的配置版本；显式蓝图版本优先，旧装配自动补当前版本。
    this.blueprints = new Map(options.ships.map((blueprint) => [
      blueprint.shipId,
      blueprint.configVersion === undefined ? { ...blueprint, configVersion: options.configVersion } : blueprint,
    ]));
    if (this.blueprints.size !== options.ships.length) throw new RangeError('玩家飞船实例 ID 重复');
    if (!this.blueprints.has(this.activeShipId)) throw new RangeError('当前飞船不存在');
    this.now = options.now ?? Date.now;
    this.initialMetal = options.initialMetal ?? 1000;
    this.metal = this.initialMetal;
    if (!Number.isInteger(this.metal) || this.metal < 0) throw new RangeError('初始金属必须是非负整数');
    this.warn = options.warn ?? (() => undefined);
    this.resetToDefaults();
  }

  public async bootstrap(): Promise<PlayerBootstrapResult> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LOCAL_PLAYER_STATE_KEY);
    } catch (cause) {
      this.warn(`读取开发存档失败，已使用默认状态：${describeCause(cause)}`);
      this.resetToDefaults();
      return { state: this.getSnapshot() };
    }
    if (raw === null) {
      this.resetToDefaults();
      this.persistCurrentState();
      return { state: this.getSnapshot() };
    }
    const restored = this.restoreEnvelope(raw);
    if (restored === false) {
      this.resetToDefaults();
      this.persistCurrentState();
    } else {
      const offlineConstruction = this.settleOfflineConstruction(this.now());
      return { state: this.getSnapshot(), ...(offlineConstruction === undefined ? {} : { offlineConstruction }) };
    }
    return { state: this.getSnapshot() };
  }

  public async execute(request: PlayerCommandRequest): Promise<PlayerCommandResult> {
    if (typeof request.requestId !== 'string' || request.requestId.trim().length === 0) {
      return this.failure('INVALID_REQUEST', '请求 ID 不能为空');
    }
    const completed = this.completedRequests.get(request.requestId);
    if (completed !== undefined) return completed;
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision !== this.revision) {
      return this.failure('REVISION_CONFLICT', `玩家状态版本冲突：当前为 ${this.revision}`);
    }
    const model = this.models.get(request.command.shipId);
    if (model === undefined) return this.failure('UNKNOWN_SHIP', `未知飞船：${request.command.shipId}`);

    const before = this.getSnapshot();
    model.setConstructionMetal(this.metal);
    const result = model.apply(request.command);
    if (result.ok === false) return this.failure(result.code, result.message);
    this.metal = model.getConstructionMetal() ?? this.metal;
    if (result.events.length > 0) this.revision += 1;
    this.savedAtUnixMs = this.now();
    const state = this.getSnapshot();
    try {
      this.storage.setItem(LOCAL_PLAYER_STATE_KEY, JSON.stringify(state));
    } catch (cause) {
      this.restoreFromSnapshot(before);
      return this.failure('SAVE_FAILED', `玩家状态保存失败：${describeCause(cause)}`);
    }
    const response: PlayerCommandResult = {
      ok: true,
      revision: this.revision,
      events: result.events,
      state,
      message: result.message,
    };
    this.completedRequests.set(request.requestId, response);
    return response;
  }

  public async previewConstruction(request: ConstructionPreviewRequest): Promise<ConstructionPreviewResult> {
    const model = this.models.get(request.shipId);
    if (model === undefined) {
      return { ok: false, revision: this.revision, code: 'UNKNOWN_SHIP', message: `未知飞船：${request.shipId}`, width: 1, height: 1, metalCost: 0, metal: this.metal, constructionSlots: 0, usedConstructionSlots: 0 };
    }
    const result = model.previewConstruction(request.definitionKind, request.definitionId, request.x, request.y);
    return { ...result, revision: this.revision };
  }

  /**
   * 开发期固定 Tick 入口。它不属于 UI 端口，也不接受客户端时间；场景装配按固定频率调用。
   * 每次发生状态变化都保存完整 Envelope，失败时恢复 Tick 前状态。
   */
  public advanceOneTick(shipId: string): PlayerCommandResult {
    const model = this.models.get(shipId);
    if (model === undefined) return this.failure('UNKNOWN_SHIP', `未知飞船：${shipId}`);
    const before = this.getSnapshot();
    const beforeShip = model.getSnapshot();
    const afterShip = model.advanceOneTick();
    if (JSON.stringify(beforeShip) === JSON.stringify(afterShip)) {
      return { ok: true, revision: this.revision, events: Object.freeze([]), state: before, message: '船员状态未变化' };
    }
    this.revision += 1;
    this.savedAtUnixMs = this.now();
    const state = this.getSnapshot();
    try {
      this.storage.setItem(LOCAL_PLAYER_STATE_KEY, JSON.stringify(state));
    } catch (cause) {
      this.restoreFromSnapshot(before);
      return this.failure('SAVE_FAILED', `玩家状态保存失败：${describeCause(cause)}`);
    }
    return {
      ok: true,
      revision: this.revision,
      events: Object.freeze([{ type: 'SHIP_STATE_CHANGED', shipId, revision: afterShip.revision }]),
      state,
      message: '飞船固定 Tick 已推进',
    };
  }

  /** P8 施工独立于 10Hz 船员 Tick，应用层按秒或恢复时传入权威时间。 */
  public settleConstruction(shipId: string, nowUnixMs = this.now()): PlayerCommandResult {
    const model = this.models.get(shipId);
    if (model === undefined) return this.failure('UNKNOWN_SHIP', `未知飞船：${shipId}`);
    if (model.getConstructionMetal() === null) return { ok: true, revision: this.revision, events: Object.freeze([]), state: this.getSnapshot(), message: '当前飞船没有施工项目' };
    const before = this.getSnapshot();
    model.setConstructionMetal(this.metal);
    const result = model.settleConstruction(nowUnixMs);
    if (result.ok === false) return this.failure(result.code, result.message);
    this.metal = model.getConstructionMetal() ?? this.metal;
    // 即使本次没有产生持久化 revision，也必须返回模型当前快照。
    // settleConstruction 会先同步 buildersAtSite；返回调用前 Envelope 会把刚到场的船员状态覆盖回旧值。
    if (result.events.length === 0) return { ok: true, revision: this.revision, events: Object.freeze([]), state: this.getSnapshot(), message: result.message };
    if (result.events.length > 0) {
      this.revision += 1;
      this.savedAtUnixMs = Math.max(this.savedAtUnixMs, Math.floor(nowUnixMs));
    }
    const state = this.getSnapshot();
    try {
      this.storage.setItem(LOCAL_PLAYER_STATE_KEY, JSON.stringify(state));
    } catch (cause) {
      this.restoreFromSnapshot(before);
      return this.failure('SAVE_FAILED', `施工状态保存失败：${describeCause(cause)}`);
    }
    return { ok: true, revision: this.revision, events: result.events, state, message: result.message };
  }

  public getSnapshot(): PlayerStateSnapshot {
    const ships = Array.from(this.models.values(), (model) => model.getSnapshot())
      .sort((left, right) => left.shipId.localeCompare(right.shipId));
    return Object.freeze({
      schemaVersion: PLAYER_STATE_SCHEMA_VERSION,
      configVersion: this.configVersion,
      revision: this.revision,
      savedAtUnixMs: this.savedAtUnixMs,
      activeShipId: this.activeShipId,
      metal: this.metal,
      ships: Object.freeze(ships),
    });
  }

  private resetToDefaults(): void {
    this.models = new Map(Array.from(this.blueprints, ([shipId, blueprint]) => [shipId, new ShipModel(blueprint)]));
    this.revision = 0;
    this.metal = this.initialMetal;
    for (const model of this.models.values()) model.setConstructionMetal(this.metal);
    this.savedAtUnixMs = this.now();
    this.completedRequests.clear();
  }

  private restoreEnvelope(raw: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      this.warn('开发存档不是有效 JSON，已重置');
      return false;
    }
    if (!isPlayerStateSnapshot(parsed) || parsed.configVersion !== this.configVersion || parsed.activeShipId !== this.activeShipId) {
      this.warn('开发存档版本或当前飞船不兼容，已重置');
      return false;
    }
    return this.restoreFromSnapshot(parsed);
  }

  private restoreFromSnapshot(snapshot: PlayerStateSnapshot): boolean {
    if (snapshot.ships.length !== this.blueprints.size) {
      this.warn('开发存档飞船数量不匹配，已重置');
      return false;
    }
    const next = new Map<string, ShipModel>();
    const seenShipIds = new Set<string>();
    for (const shipSnapshot of snapshot.ships) {
      if (seenShipIds.has(shipSnapshot.shipId)) {
        this.warn(`开发存档包含重复飞船：${shipSnapshot.shipId}`);
        return false;
      }
      seenShipIds.add(shipSnapshot.shipId);
      const blueprint = this.blueprints.get(shipSnapshot.shipId);
      if (blueprint === undefined) {
        this.warn(`开发存档包含未知飞船：${shipSnapshot.shipId}`);
        return false;
      }
      const restored = ShipModel.restore(blueprint, shipSnapshot);
      if (restored.ok === false) {
        this.warn(`开发存档飞船恢复失败：${restored.message}`);
        return false;
      }
      next.set(shipSnapshot.shipId, restored.model);
    }
    for (const shipId of this.blueprints.keys()) {
      if (!seenShipIds.has(shipId)) {
        this.warn(`开发存档缺少飞船：${shipId}`);
        return false;
      }
    }
    this.models = next;
    this.revision = snapshot.revision;
    this.savedAtUnixMs = snapshot.savedAtUnixMs;
    this.metal = snapshot.metal;
    for (const model of this.models.values()) model.setConstructionMetal(this.metal);
    this.completedRequests.clear();
    return true;
  }

  private persistCurrentState(): void {
    this.savedAtUnixMs = this.now();
    try {
      this.storage.setItem(LOCAL_PLAYER_STATE_KEY, JSON.stringify(this.getSnapshot()));
    } catch (cause) {
      this.warn(`初始化开发存档失败：${describeCause(cause)}`);
    }
  }

  /** 恢复时只推进施工，不推进船员移动、巡逻、维修、医疗或其他战斗状态。 */
  private settleOfflineConstruction(nowUnixMs: number): OfflineConstructionSummary | undefined {
    const before = this.getSnapshot();
    const startUnixMs = before.savedAtUnixMs;
    const clockRollback = nowUnixMs < startUnixMs;
    const beforeJobs = new Map<string, ConstructionJobSnapshot>();
    for (const ship of before.ships) {
      for (const job of ship.constructionJobs) beforeJobs.set(job.jobId, job);
    }
    const events = [] as { readonly type: 'SHIP_STATE_CHANGED'; readonly shipId: string; readonly revision: number }[];
    for (const model of Array.from(this.models.values()).sort((left, right) => left.shipId.localeCompare(right.shipId))) {
      if (model.getConstructionMetal() === null) continue;
      model.setConstructionMetal(this.metal);
      const result = model.settleConstruction(nowUnixMs);
      if (result.ok === false) {
        this.warn(`离线施工结算失败：${result.message}`);
        this.restoreFromSnapshot(before);
        return undefined;
      }
      this.metal = model.getConstructionMetal() ?? this.metal;
      events.push(...result.events);
    }
    const after = this.getSnapshot();
    const completedJobs = Array.from(beforeJobs.values()).filter((job) => !after.ships.some((ship) => ship.constructionJobs.some((candidate) => candidate.jobId === job.jobId))).sort((left, right) => left.jobId.localeCompare(right.jobId)).map((job) => Object.freeze({ jobId: job.jobId, operation: job.operation, definitionId: job.definitionId, targetInstanceId: job.targetInstanceId, metal: job.paidMetal }));
    if (events.length === 0 && !clockRollback) return undefined;
    this.revision += 1;
    this.savedAtUnixMs = Math.max(this.savedAtUnixMs, Math.floor(nowUnixMs));
    try {
      this.storage.setItem(LOCAL_PLAYER_STATE_KEY, JSON.stringify(this.getSnapshot()));
    } catch (cause) {
      this.restoreFromSnapshot(before);
      this.warn(`离线施工保存失败，已恢复结算前状态：${describeCause(cause)}`);
      return undefined;
    }
    if (completedJobs.length === 0 && !clockRollback) return undefined;
    return Object.freeze({ startUnixMs, endUnixMs: Math.floor(nowUnixMs), clockRollback, completedJobs: Object.freeze(completedJobs), metalDelta: this.metal - before.metal });
  }

  private failure(errorCode: string, message: string): PlayerCommandResult {
    return {
      ok: false,
      revision: this.revision,
      events: Object.freeze([]),
      state: this.getSnapshot(),
      errorCode,
      message,
    };
  }
}

export function getBrowserKeyValueStorage(): KeyValueStorage {
  if (typeof globalThis.localStorage === 'undefined') throw new Error('当前平台不支持开发期本地存档');
  return globalThis.localStorage;
}

function isPlayerStateSnapshot(value: unknown): value is PlayerStateSnapshot {
  return isRecord(value) && value.schemaVersion === PLAYER_STATE_SCHEMA_VERSION &&
    typeof value.configVersion === 'string' && Number.isInteger(value.revision) && (value.revision as number) >= 0 &&
    Number.isFinite(value.savedAtUnixMs) && typeof value.activeShipId === 'string' && Number.isInteger(value.metal) && (value.metal as number) >= 0 &&
    Array.isArray(value.ships) && value.ships.every((ship) => isRecord(ship) && typeof ship.shipId === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
