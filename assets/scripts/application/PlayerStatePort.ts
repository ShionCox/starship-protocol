import type { ShipCommand, ShipEvent, ShipSnapshot } from '../game-core/ShipModel.ts';

export const PLAYER_STATE_SCHEMA_VERSION = 1 as const;

/** 玩家聚合状态 Envelope；开发期与未来服务端适配器共用同一应用层结构。 */
export interface PlayerStateSnapshot {
  readonly schemaVersion: typeof PLAYER_STATE_SCHEMA_VERSION;
  readonly configVersion: string;
  readonly revision: number;
  readonly savedAtUnixMs: number;
  readonly activeShipId: string;
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

/** UI 与应用用例只依赖此端口；开发期为本地实现，联网后替换为 HTTP 权威实现。 */
export interface PlayerStatePort {
  bootstrap(): Promise<PlayerStateSnapshot>;
  execute(request: PlayerCommandRequest): Promise<PlayerCommandResult>;
}

/** 开发期存储的最小边界，业务与 UI 不得直接访问 localStorage。 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
