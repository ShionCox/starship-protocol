import type { ShipCommand, ShipEvent, ShipSnapshot } from '../game-core/ShipModel.ts';

export const PLAYER_STATE_SCHEMA_VERSION = 2 as const;

/** 玩家聚合状态 Envelope；开发期与未来服务端适配器共用同一应用层结构。 */
export interface PlayerStateSnapshot {
  readonly schemaVersion: typeof PLAYER_STATE_SCHEMA_VERSION;
  readonly configVersion: string;
  readonly revision: number;
  readonly savedAtUnixMs: number;
  readonly activeShipId: string;
  readonly metal: number;
  readonly ships: readonly ShipSnapshot[];
}

/** 玩家 Command 请求使用请求 ID 去重，并通过 revision 拒绝过期写入。 */
export interface PlayerCommandRequest {
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly command: ShipCommand;
}

/** 玩家 Command 的统一结果；状态始终是执行后的权威视图或失败前的原状态。 */
export interface PlayerCommandResult {
  readonly ok: boolean;
  readonly revision: number;
  readonly events: readonly ShipEvent[];
  readonly state: PlayerStateSnapshot;
  readonly errorCode?: string;
  readonly message: string;
}

/** 建造拖拽期间的只读预览请求；不产生 Command、revision 或存档写入。 */
export interface ConstructionPreviewRequest {
  readonly shipId: string;
  readonly definitionKind: 'FLOOR' | 'ROOM';
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
}

export interface ConstructionPreviewResult {
  readonly ok: boolean;
  readonly revision: number;
  readonly code?: string;
  readonly message: string;
  readonly width: number;
  readonly height: number;
  readonly metalCost: number;
  readonly metal: number;
  readonly constructionSlots: number;
  readonly usedConstructionSlots: number;
}

/** UI 与应用用例只依赖此端口；开发期为本地实现，联网后替换为 HTTP 权威实现。 */
export interface OfflineConstructionJobSummary {
  readonly jobId: string;
  readonly operation: string;
  readonly definitionId: string;
  readonly targetInstanceId: string;
  readonly metal: number;
}

export interface OfflineConstructionSummary {
  readonly startUnixMs: number;
  readonly endUnixMs: number;
  readonly clockRollback: boolean;
  readonly completedJobs: readonly OfflineConstructionJobSummary[];
  readonly metalDelta: number;
}

export interface PlayerBootstrapResult {
  readonly state: PlayerStateSnapshot;
  readonly offlineConstruction?: OfflineConstructionSummary;
}

export interface PlayerStatePort {
  bootstrap(): Promise<PlayerBootstrapResult>;
  execute(request: PlayerCommandRequest): Promise<PlayerCommandResult>;
  previewConstruction(request: ConstructionPreviewRequest): Promise<ConstructionPreviewResult>;
}

/** 开发期存储的最小边界，业务与 UI 不得直接访问 localStorage。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
