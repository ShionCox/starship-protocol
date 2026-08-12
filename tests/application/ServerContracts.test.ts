import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OFFLINE_RESOURCE_PRODUCTION_CAP_MS,
  type OfflineSettlementSummary,
  type ServerPlayerBootstrapResponse,
  type ServerPlayerCommandRequest,
  type ServerPlayerCommandResponse,
} from '../../assets/scripts/application/ServerContracts.ts';
import type { PlayerStateSnapshot } from '../../assets/scripts/application/PlayerStatePort.ts';

const state = {
  schemaVersion: 1,
  configVersion: 'r1-dev-1',
  revision: 3,
  savedAtUnixMs: 1000,
  activeShipId: 'ship-1',
  ships: [],
} satisfies PlayerStateSnapshot;

test('未来玩家Command契约固定幂等、版本和完整权威状态字段', () => {
  const request = {
    requestId: 'request-1',
    idempotencyKey: 'idempotency-1',
    expectedRevision: 3,
    configVersion: 'r1-dev-1',
    command: { type: 'RESET_ROOM_POWER', shipId: 'ship-1', roomInstanceId: 'room-laser-1' },
  } satisfies ServerPlayerCommandRequest;
  const response = {
    ok: true,
    serverTime: 2000,
    revision: 4,
    events: [],
    state: { ...state, revision: 4 },
    message: '已执行',
  } satisfies ServerPlayerCommandResponse;

  assert.equal(request.idempotencyKey, 'idempotency-1');
  assert.equal(response.state.revision, response.revision);
});

test('离线资源生产封顶12小时且摘要只由Bootstrap返回', () => {
  const offlineSettlement = {
    settledFromUnixMs: 0,
    settledToUnixMs: 24 * 60 * 60 * 1000,
    resourceProductionDurationMs: OFFLINE_RESOURCE_PRODUCTION_CAP_MS,
    resourceProductionCapped: true,
    completedTimerIds: ['research-1'],
    incomes: [{ resourceId: 'resource-metal', amount: 120 }],
  } satisfies OfflineSettlementSummary;
  const response = {
    serverTime: 24 * 60 * 60 * 1000,
    revision: 3,
    state,
    offlineSettlement,
  } satisfies ServerPlayerBootstrapResponse;

  assert.equal(OFFLINE_RESOURCE_PRODUCTION_CAP_MS, 12 * 60 * 60 * 1000);
  assert.equal(response.offlineSettlement.resourceProductionCapped, true);
});
