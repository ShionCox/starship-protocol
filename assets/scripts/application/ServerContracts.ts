import type { PlayerStateSnapshot } from './PlayerStatePort';
import type { ShipCommand, ShipEvent } from '../game-core/ShipModel';

/** 未来服务端 Command 请求；客户端重试时必须复用同一幂等键。 */
export interface ServerPlayerCommandRequest {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly expectedRevision: number;
  readonly configVersion: string;
  readonly command: ShipCommand;
}

/** 未来 FastAPI 权威响应；客户端只显示结果，不自行计算经济收益。 */
export interface ServerPlayerCommandResponse {
  readonly ok: boolean;
  readonly serverTime: number;
  readonly revision: number;
  readonly events: readonly ShipEvent[];
  readonly state: PlayerStateSnapshot;
  readonly errorCode?: string;
  readonly message: string;
}

/** 离线结算中一项已经由服务端入账的资源变化。 */
export interface OfflineResourceIncome {
  readonly resourceId: string;
  readonly amount: number;
}

/** 离线结算摘要只描述服务端已经入账的结果，客户端不得提交 amount。 */
export interface OfflineSettlementSummary {
  readonly settledFromUnixMs: number;
  readonly settledToUnixMs: number;
  readonly resourceProductionDurationMs: number;
  readonly resourceProductionCapped: boolean;
  readonly completedTimerIds: readonly string[];
  readonly incomes: readonly OfflineResourceIncome[];
}

/**
 * 玩家 Bootstrap 始终返回完整权威状态；若本次请求完成了离线结算，同时返回已入账摘要。
 * 首版不支持 Delta，避免客户端在服务器尚未实现前提前承担合并与冲突规则。
 */
export interface ServerPlayerBootstrapResponse {
  readonly serverTime: number;
  readonly revision: number;
  readonly state: PlayerStateSnapshot;
  readonly offlineSettlement?: OfflineSettlementSummary;
}

export const OFFLINE_RESOURCE_PRODUCTION_CAP_MS = 12 * 60 * 60 * 1000;
