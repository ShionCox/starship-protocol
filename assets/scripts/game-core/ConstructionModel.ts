import type { CrewRole } from './CrewDefinition.ts';
import type { FloorDefinition } from './CsvGameConfig.ts';
import type { RoomDefinition } from './RoomDefinition.ts';
import { VoxelLayoutModel } from './VoxelLayoutModel.ts';

export type ConstructionOperation = 'BUILD_FLOOR' | 'BUILD_ROOM' | 'DEMOLISH_FLOOR' | 'DEMOLISH_ROOM';

export interface ConstructionJobSnapshot {
  readonly jobId: string;
  readonly operation: ConstructionOperation;
  readonly definitionId: string;
  readonly targetInstanceId: string;
  readonly x: number;
  readonly y: number;
  readonly requiredWorkMs: number;
  readonly completedWorkMs: number;
  readonly assignedCrewIds: readonly string[];
  readonly buildersAtSite: readonly string[];
  readonly paidMetal: number;
  readonly lastSettledAtUnixMs: number;
}

export interface ConstructionCrewProfile {
  readonly crewId: string;
  readonly role: CrewRole;
  readonly speedBonusPermille: number;
  readonly slotBonus: number;
}

export interface ConstructionSnapshot {
  readonly metal: number;
  readonly jobs: readonly ConstructionJobSnapshot[];
}

export interface ConstructionPreview {
  readonly ok: boolean;
  readonly code?: string;
  readonly message: string;
  readonly width: number;
  readonly height: number;
  readonly metalCost: number;
  readonly metal: number;
  readonly constructionSlots: number;
  readonly usedConstructionSlots: number;
}

export type ConstructionResult =
  | { readonly ok: true; readonly snapshot: ConstructionSnapshot; readonly message: string }
  | { readonly ok: false; readonly code: string; readonly snapshot: ConstructionSnapshot; readonly message: string };

interface MutableJob {
  jobId: string;
  operation: ConstructionOperation;
  definitionId: string;
  targetInstanceId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  requiredWorkMs: number;
  completedWorkMs: number;
  assignedCrewIds: string[];
  buildersAtSite: string[];
  paidMetal: number;
  lastSettledAtUnixMs: number;
  refundPermille: number;
}

/**
 * 单舰施工聚合。时间由应用层显式传入；GameCore 不读取系统时钟，离线和在线共用同一结算函数。
 */
export class ConstructionModel {
  private readonly layout: VoxelLayoutModel;
  private readonly baseSlots: number;
  private readonly floors: ReadonlyMap<string, Readonly<FloorDefinition>>;
  private readonly rooms: ReadonlyMap<string, Readonly<RoomDefinition>>;
  private readonly jobs = new Map<string, MutableJob>();
  private readonly crewProfiles = new Map<string, ConstructionCrewProfile>();
  private metal: number;

  public constructor(
    layout: VoxelLayoutModel,
    baseSlots: number,
    initialMetal: number,
    crewProfiles: readonly ConstructionCrewProfile[],
    floors: ReadonlyMap<string, Readonly<FloorDefinition>>,
    rooms: ReadonlyMap<string, Readonly<RoomDefinition>>,
  ) {
    this.layout = layout;
    this.baseSlots = baseSlots;
    this.floors = floors;
    this.rooms = rooms;
    if (!Number.isInteger(initialMetal) || initialMetal < 0) throw new RangeError('初始金属必须是非负整数');
    if (!Number.isInteger(baseSlots) || baseSlots < 0 || baseSlots > 8) throw new RangeError('基础施工槽位无效');
    for (const profile of crewProfiles) {
      if (this.crewProfiles.has(profile.crewId)) throw new RangeError(`施工船员重复：${profile.crewId}`);
      if (!Number.isInteger(profile.speedBonusPermille) || profile.speedBonusPermille < 0 || !Number.isInteger(profile.slotBonus) || profile.slotBonus < 0) {
        throw new RangeError(`施工船员词条无效：${profile.crewId}`);
      }
      this.crewProfiles.set(profile.crewId, Object.freeze({ ...profile }));
    }
    this.metal = initialMetal;
  }

  public getConstructionSlots(): number {
    return Math.min(8, this.baseSlots + Array.from(this.crewProfiles.values()).reduce((sum, crew) => sum + crew.slotBonus, 0));
  }

  public getSnapshot(): ConstructionSnapshot {
    return Object.freeze({
      metal: this.metal,
      jobs: Object.freeze(Array.from(this.jobs.values()).sort((left, right) => left.jobId.localeCompare(right.jobId)).map(snapshotJob)),
    });
  }

  public getLayoutSnapshot() {
    return this.layout.getSnapshot();
  }

  public setMetal(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('金属余额必须是非负整数');
    this.metal = value;
  }

  public previewBuildFloor(definitionId: string, x: number, y: number): ConstructionPreview {
    const definition = this.floors.get(definitionId);
    if (definition === undefined) return this.previewFailure('UNKNOWN_DEFINITION', `未知地板定义：${definitionId}`, 1, 1, 0);
    const placement = this.layout.validateFloorBuild('__preview-floor__', definitionId, x, y);
    return this.previewPlacement(placement, 1, 1, definition.metalCost, x, y);
  }

  public previewBuildRoom(definitionId: string, x: number, y: number): ConstructionPreview {
    const definition = this.rooms.get(definitionId);
    if (definition === undefined) return this.previewFailure('UNKNOWN_DEFINITION', `未知房间定义：${definitionId}`, 1, 1, 0);
    const placement = this.layout.validateRoomBuild('__preview-room__', definition, x, y);
    return this.previewPlacement(placement, definition.width, definition.height, definition.metalCost, x, y);
  }

  /** 从 ShipSnapshot 恢复队列；所有字段先在临时集合中完整验证。 */
  public restore(snapshot: unknown): ConstructionResult {
    const before = this.getSnapshot();
    if (!isConstructionSnapshot(snapshot)) return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: '施工快照格式无效' };
    const next = new Map<string, MutableJob>();
    const reserved = new Set<string>();
    for (const entry of snapshot.jobs) {
      if (!validId(entry.jobId) || !validId(entry.definitionId) || !validId(entry.targetInstanceId) || next.has(entry.jobId) || reserved.has(entry.targetInstanceId)) {
        return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工快照 ID 重复或无效：${entry.jobId}` };
      }
      if (![entry.x, entry.y, entry.requiredWorkMs, entry.completedWorkMs, entry.paidMetal, entry.lastSettledAtUnixMs].every(Number.isFinite)
        || !Number.isInteger(entry.x) || !Number.isInteger(entry.y) || entry.requiredWorkMs <= 0 || entry.completedWorkMs < 0 || entry.completedWorkMs >= entry.requiredWorkMs
        || !Number.isInteger(entry.paidMetal) || entry.paidMetal < 0) {
        return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工快照数值无效：${entry.jobId}` };
      }
      if (entry.assignedCrewIds.length > 3 || new Set(entry.assignedCrewIds).size !== entry.assignedCrewIds.length
        || entry.buildersAtSite.some((crewId) => entry.assignedCrewIds.indexOf(crewId) < 0)) {
        return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工人员快照无效：${entry.jobId}` };
      }
      for (const crewId of entry.assignedCrewIds) {
        if (this.crewProfiles.get(crewId)?.role !== 'ENGINEER') return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工人员不是工程师：${crewId}` };
        if (Array.from(next.values()).some((job) => job.assignedCrewIds.indexOf(crewId) >= 0)) return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `工程师重复分配：${crewId}` };
      }
      const definition = entry.operation === 'BUILD_FLOOR' || entry.operation === 'DEMOLISH_FLOOR'
        ? this.floors.get(entry.definitionId)
        : this.rooms.get(entry.definitionId);
      if (definition === undefined) return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工定义不存在：${entry.definitionId}` };
      const width = entry.operation === 'BUILD_FLOOR' || entry.operation === 'DEMOLISH_FLOOR' ? 1 : (this.rooms.get(entry.definitionId)?.width ?? 1);
      const height = entry.operation === 'BUILD_FLOOR' || entry.operation === 'DEMOLISH_FLOOR' ? 1 : (this.rooms.get(entry.definitionId)?.height ?? 1);
      if (Array.from(next.values()).some((job) => rectanglesOverlap(job.x, job.y, job.width, job.height, entry.x, entry.y, width, height))) {
        return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: `施工快照占地重叠：${entry.jobId}` };
      }
      next.set(entry.jobId, {
        ...entry,
        width,
        height,
        assignedCrewIds: [...entry.assignedCrewIds].sort((left, right) => left.localeCompare(right)),
        buildersAtSite: [...entry.buildersAtSite].sort((left, right) => left.localeCompare(right)),
        refundPermille: definition.refundPermille,
      });
      reserved.add(entry.targetInstanceId);
    }
    if (next.size > this.getConstructionSlots()) return { ok: false, code: 'INVALID_SNAPSHOT', snapshot: before, message: '施工快照超过槽位上限' };
    this.metal = snapshot.metal;
    this.jobs.clear();
    for (const [id, job] of next) this.jobs.set(id, job);
    return this.success('施工快照已恢复');
  }

  public startBuildFloor(jobId: string, targetInstanceId: string, definitionId: string, x: number, y: number, nowUnixMs: number): ConstructionResult {
    const definition = this.floors.get(definitionId);
    if (definition === undefined) return this.failure('UNKNOWN_DEFINITION', `未知地板定义：${definitionId}`);
    const placement = this.layout.validateFloorBuild(targetInstanceId, definitionId, x, y);
    if (placement.ok === false) return this.failure(placement.code, placement.message);
    return this.start({ jobId, operation: 'BUILD_FLOOR', definitionId, targetInstanceId, x, y, width: 1, height: 1, requiredWorkMs: definition.buildDurationMs, paidMetal: definition.metalCost, refundPermille: definition.refundPermille, nowUnixMs });
  }

  public startBuildRoom(jobId: string, targetInstanceId: string, definitionId: string, x: number, y: number, nowUnixMs: number): ConstructionResult {
    const definition = this.rooms.get(definitionId);
    if (definition === undefined) return this.failure('UNKNOWN_DEFINITION', `未知房间定义：${definitionId}`);
    const placement = this.layout.validateRoomBuild(targetInstanceId, definition, x, y);
    if (placement.ok === false) return this.failure(placement.code, placement.message);
    return this.start({ jobId, operation: 'BUILD_ROOM', definitionId, targetInstanceId, x, y, width: definition.width, height: definition.height, requiredWorkMs: definition.buildDurationMs, paidMetal: definition.metalCost, refundPermille: definition.refundPermille, nowUnixMs });
  }

  public startDemolition(jobId: string, operation: 'DEMOLISH_FLOOR' | 'DEMOLISH_ROOM', targetInstanceId: string, nowUnixMs: number): ConstructionResult {
    const target = operation === 'DEMOLISH_FLOOR' ? this.layout.getFloor(targetInstanceId) : this.layout.getRoom(targetInstanceId);
    if (target === null) return this.failure('NOT_FOUND', `拆除目标不存在：${targetInstanceId}`);
    const definition = operation === 'DEMOLISH_FLOOR' ? this.floors.get(target.definitionId) : this.rooms.get(target.definitionId);
    if (definition === undefined) return this.failure('UNKNOWN_DEFINITION', `拆除目标定义不存在：${target.definitionId}`);
    const validation = operation === 'DEMOLISH_FLOOR'
      ? this.layout.validateFloorDemolition(targetInstanceId)
      : this.layout.validateRoomDemolition(targetInstanceId);
    if (validation.ok === false) return this.failure(validation.code, validation.message);
    return this.start({
      jobId,
      operation,
      definitionId: target.definitionId,
      targetInstanceId,
      x: target.x,
      y: target.y,
      width: operation === 'DEMOLISH_FLOOR' ? 1 : (definition as Readonly<RoomDefinition>).width,
      height: operation === 'DEMOLISH_FLOOR' ? 1 : (definition as Readonly<RoomDefinition>).height,
      requiredWorkMs: definition.demolishDurationMs,
      paidMetal: 0,
      refundPermille: definition.refundPermille,
      nowUnixMs,
    });
  }

  public assignBuilders(jobId: string, crewIds: readonly string[]): ConstructionResult {
    const job = this.jobs.get(jobId);
    if (job === undefined) return this.failure('UNKNOWN_JOB', `施工项目不存在：${jobId}`);
    if (crewIds.length > 3 || new Set(crewIds).size !== crewIds.length) return this.failure('INVALID_BUILDERS', '同一项目最多分配三名不重复工程师');
    for (const crewId of crewIds) {
      const profile = this.crewProfiles.get(crewId);
      if (profile?.role !== 'ENGINEER') return this.failure('INVALID_BUILDERS', `施工人员必须是工程师：${crewId}`);
      const occupied = Array.from(this.jobs.values()).some((candidate) => candidate.jobId !== jobId && candidate.assignedCrewIds.indexOf(crewId) >= 0);
      if (occupied) return this.failure('INVALID_BUILDERS', `工程师已分配到其他项目：${crewId}`);
    }
    job.assignedCrewIds = [...crewIds].sort((left, right) => left.localeCompare(right));
    job.buildersAtSite = job.buildersAtSite.filter((crewId) => job.assignedCrewIds.indexOf(crewId) >= 0);
    return this.success('施工人员已更新');
  }

  public setBuildersAtSite(jobId: string, crewIds: readonly string[]): ConstructionResult {
    const job = this.jobs.get(jobId);
    if (job === undefined) return this.failure('UNKNOWN_JOB', `施工项目不存在：${jobId}`);
    if (crewIds.some((crewId) => job.assignedCrewIds.indexOf(crewId) < 0)) return this.failure('INVALID_BUILDERS', '到场工程师必须已分配到当前项目');
    // Creator 的兼容编译会把 Set 的展开降级为 [Set]；显式 Array.from 才能保证运行时得到字符串数组。
    job.buildersAtSite = Array.from(new Set(crewIds)).sort((left, right) => left.localeCompare(right));
    return this.success('工地到场状态已更新');
  }

  public cancel(jobId: string): ConstructionResult {
    const job = this.jobs.get(jobId);
    if (job === undefined) return this.failure('UNKNOWN_JOB', `施工项目不存在：${jobId}`);
    const refund = job.completedWorkMs === 0 ? job.paidMetal : Math.floor(job.paidMetal * job.refundPermille / 1000);
    this.metal += refund;
    this.jobs.delete(jobId);
    return this.success(`施工已取消，返还金属 ${refund}`);
  }

  public settleTo(nowUnixMs: number): ConstructionResult {
    if (!Number.isFinite(nowUnixMs)) return this.failure('INVALID_TIME', '施工结算时间无效');
    const completed: MutableJob[] = [];
    for (const job of Array.from(this.jobs.values()).sort((left, right) => left.jobId.localeCompare(right.jobId))) {
      const elapsedMs = Math.max(0, Math.floor(nowUnixMs - job.lastSettledAtUnixMs));
      job.lastSettledAtUnixMs = Math.max(job.lastSettledAtUnixMs, Math.floor(nowUnixMs));
      // 建造必须由至少一名已到场工程师驱动；拆除按规则自动结算且不分配工程师。
      const speedPermille = job.operation.startsWith('DEMOLISH')
        ? 1000
        : job.buildersAtSite.length === 0
          ? 0
          : Math.min(3000, 1000 + job.buildersAtSite.reduce((sum, crewId) => sum + (this.crewProfiles.get(crewId)?.speedBonusPermille ?? 0), 0));
      // 多人施工先保留 25% 收口空间，让已分配但仍在路上的工程师能到场；否则短项目会被第一名提前完成。
      const coordinationCap = job.assignedCrewIds.length > 1 && job.buildersAtSite.length < job.assignedCrewIds.length
        ? Math.floor(job.requiredWorkMs * 0.75)
        : job.requiredWorkMs;
      job.completedWorkMs = Math.min(coordinationCap, job.completedWorkMs + Math.floor(elapsedMs * speedPermille / 1000));
      if (job.completedWorkMs >= job.requiredWorkMs) completed.push(job);
    }
    for (const job of completed) {
      const applied = this.complete(job);
      if (applied.ok === false) return this.failure(applied.code, applied.message);
      this.jobs.delete(job.jobId);
    }
    return this.success(completed.length === 0 ? '施工进度已结算' : `已完成 ${completed.length} 个施工项目`);
  }

  private start(input: Omit<MutableJob, 'completedWorkMs' | 'assignedCrewIds' | 'buildersAtSite' | 'lastSettledAtUnixMs' | 'refundPermille'> & { readonly refundPermille: number; readonly nowUnixMs: number }): ConstructionResult {
    if (!validId(input.jobId) || !validId(input.targetInstanceId) || this.jobs.has(input.jobId)) return this.failure('INVALID_JOB', '施工项目 ID 无效或重复');
    if (this.jobs.size >= this.getConstructionSlots()) return this.failure('SLOT_FULL', '施工槽位已满');
    if (this.metal < input.paidMetal) return this.failure('INSUFFICIENT_METAL', '金属不足');
    if (Array.from(this.jobs.values()).some((job) => job.targetInstanceId === input.targetInstanceId || rectanglesOverlap(job.x, job.y, job.width, job.height, input.x, input.y, input.width, input.height))) return this.failure('TARGET_RESERVED', '目标占地已被施工项目预留');
    if (!Number.isFinite(input.nowUnixMs)) return this.failure('INVALID_TIME', '施工开始时间无效');
    this.metal -= input.paidMetal;
    this.jobs.set(input.jobId, {
      ...input,
      completedWorkMs: 0,
      assignedCrewIds: [],
      buildersAtSite: [],
      lastSettledAtUnixMs: Math.floor(input.nowUnixMs),
    });
    return this.success('施工项目已开始');
  }

  private previewPlacement(
    placement: { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string },
    width: number,
    height: number,
    metalCost: number,
    x: number,
    y: number,
  ): ConstructionPreview {
    if (placement.ok === false) return this.previewFailure(placement.code, placement.message, width, height, metalCost);
    if (this.jobs.size >= this.getConstructionSlots()) return this.previewFailure('SLOT_FULL', '施工槽位已满', width, height, metalCost);
    if (this.metal < metalCost) return this.previewFailure('INSUFFICIENT_METAL', '金属不足', width, height, metalCost);
    if (Array.from(this.jobs.values()).some((job) => rectanglesOverlap(job.x, job.y, job.width, job.height, x, y, width, height))) {
      return this.previewFailure('TARGET_RESERVED', '目标占地已被施工项目预留', width, height, metalCost);
    }
    return this.previewSuccess(width, height, metalCost, '可以开始建造');
  }

  private previewFailure(code: string, message: string, width: number, height: number, metalCost: number): ConstructionPreview {
    return { ok: false, code, message, width, height, metalCost, metal: this.metal, constructionSlots: this.getConstructionSlots(), usedConstructionSlots: this.jobs.size };
  }

  private previewSuccess(width: number, height: number, metalCost: number, message: string): ConstructionPreview {
    return { ok: true, message, width, height, metalCost, metal: this.metal, constructionSlots: this.getConstructionSlots(), usedConstructionSlots: this.jobs.size };
  }

  private complete(job: MutableJob) {
    if (job.operation === 'BUILD_FLOOR') return this.layout.buildFloor(job.targetInstanceId, this.floors.get(job.definitionId) as Readonly<FloorDefinition>, job.x, job.y);
    if (job.operation === 'BUILD_ROOM') return this.layout.buildRoom(job.targetInstanceId, this.rooms.get(job.definitionId) as Readonly<RoomDefinition>, job.x, job.y);
    if (job.operation === 'DEMOLISH_FLOOR') {
      const result = this.layout.demolishFloor(job.targetInstanceId);
      if (result.ok) this.metal += Math.floor((this.floors.get(job.definitionId)?.metalCost ?? 0) * job.refundPermille / 1000);
      return result;
    }
    const result = this.layout.demolishRoom(job.targetInstanceId);
    if (result.ok) this.metal += Math.floor((this.rooms.get(job.definitionId)?.metalCost ?? 0) * job.refundPermille / 1000);
    return result;
  }

  private success(message: string): ConstructionResult {
    return { ok: true, snapshot: this.getSnapshot(), message };
  }

  private failure(code: string, message: string): ConstructionResult {
    return { ok: false, code, snapshot: this.getSnapshot(), message };
  }
}

function snapshotJob(job: MutableJob): ConstructionJobSnapshot {
  return Object.freeze({
    jobId: job.jobId,
    operation: job.operation,
    definitionId: job.definitionId,
    targetInstanceId: job.targetInstanceId,
    x: job.x,
    y: job.y,
    requiredWorkMs: job.requiredWorkMs,
    completedWorkMs: job.completedWorkMs,
    assignedCrewIds: Object.freeze([...job.assignedCrewIds]),
    buildersAtSite: Object.freeze([...job.buildersAtSite]),
    paidMetal: job.paidMetal,
    lastSettledAtUnixMs: job.lastSettledAtUnixMs,
  });
}

function validId(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function rectanglesOverlap(
  leftX: number,
  leftY: number,
  leftWidth: number,
  leftHeight: number,
  rightX: number,
  rightY: number,
  rightWidth: number,
  rightHeight: number,
): boolean {
  return leftX < rightX + rightWidth && leftX + leftWidth > rightX
    && leftY < rightY + rightHeight && leftY + leftHeight > rightY;
}

function isConstructionSnapshot(value: unknown): value is ConstructionSnapshot {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Number.isInteger((value as { metal?: unknown }).metal) && Number((value as { metal: number }).metal) >= 0
    && Array.isArray((value as { jobs?: unknown }).jobs)
    && (value as { jobs: unknown[] }).jobs.every((job) => isConstructionJob(job));
}

function isConstructionJob(value: unknown): value is ConstructionJobSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.jobId === 'string' && typeof entry.operation === 'string'
    && ['BUILD_FLOOR', 'BUILD_ROOM', 'DEMOLISH_FLOOR', 'DEMOLISH_ROOM'].indexOf(entry.operation) >= 0
    && typeof entry.definitionId === 'string' && typeof entry.targetInstanceId === 'string'
    && Array.isArray(entry.assignedCrewIds) && entry.assignedCrewIds.every((id) => typeof id === 'string')
    && Array.isArray(entry.buildersAtSite) && entry.buildersAtSite.every((id) => typeof id === 'string')
    && ['x', 'y', 'requiredWorkMs', 'completedWorkMs', 'paidMetal', 'lastSettledAtUnixMs'].every((key) => typeof entry[key] === 'number');
}
