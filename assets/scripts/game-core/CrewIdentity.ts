/** 船员代号来源；GENERATED 由规则稳定生成，FIXED 使用玩家明确指定的名称。 */
export const CREW_NAME_MODES = ['GENERATED', 'FIXED'] as const;
export type CrewNameMode = (typeof CREW_NAME_MODES)[number];

/**
 * 船员初始身份输入。GENERATED 可以省略 callSign，FIXED 必须提供非空中文代号。
 * 代号是船员实例身份的一部分，不与 CrewDefinition 的职业名称混用。
 */
export interface CrewIdentityInitialState {
  readonly nameMode: CrewNameMode;
  readonly callSign?: string;
}

/** 已解析、可写入快照的船员身份。 */
export interface CrewIdentity {
  readonly nameMode: CrewNameMode;
  readonly callSign: string;
}

/** 稳定生成代号所使用的上下文；三个字段共同构成 hash 输入。 */
export interface CrewIdentityContext {
  readonly shipId: string;
  readonly configVersion: string;
}

/**
 * 中文代号词库。词库是规则的一部分，顺序变更会改变新船员的生成结果，发布后应保持稳定。
 * 数量大于当前 R1 船员上限，仍通过去重逻辑处理 hash 碰撞和固定名占用。
 */
export const CREW_CALL_SIGN_WORDS = Object.freeze([
  '银隼', '晨星', '玄鲸', '赤霄', '流火', '青岚', '白昼', '夜航',
  '霜刃', '雷鸣', '星河', '苍穹', '孤帆', '远歌', '逐光', '天枢',
  '北辰', '天狼', '烬羽', '云雀', '破晓', '深空', '长风', '微尘',
  '铁壁', '潮汐', '幻影', '曙光', '寒锋', '巡天', '鸣镝', '归墟',
] as const);

export type CrewIdentityErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_MODE'
  | 'INVALID_CALL_SIGN'
  | 'DUPLICATE_CALL_SIGN'
  | 'IDENTITY_POOL_EXHAUSTED';

export type CrewIdentityResolutionResult =
  | { readonly ok: true; readonly identity: CrewIdentity }
  | { readonly ok: false; readonly code: CrewIdentityErrorCode; readonly message: string };

export type CrewIdentityEntry = {
  readonly crewId: string;
  readonly identity?: CrewIdentityInitialState;
};

/**
 * 解析一名船员的固定代号。该函数只做单值校验；同舰重名由 resolveCrewIdentities 统一判断。
 */
export function resolveFixedCrewIdentity(identity: CrewIdentityInitialState): CrewIdentityResolutionResult {
  if (!isRecord(identity) || identity.nameMode !== 'FIXED') {
    return failure('INVALID_MODE', '固定船员代号必须使用 FIXED 模式');
  }
  const callSign = normalizeFixedCallSign(identity.callSign);
  if (callSign === null) return failure('INVALID_CALL_SIGN', '固定船员代号必须是 1 到 16 个字符且不能包含控制字符');
  return { ok: true, identity: Object.freeze({ nameMode: 'FIXED', callSign }) };
}

/**
 * 按 shipId、crewId、configVersion 稳定生成一个中文代号。该函数不处理同舰去重。
 */
export function generateCrewCallSign(
  shipId: string,
  crewId: string,
  configVersion: string,
  offset = 0,
): string {
  validateContext(shipId, crewId, configVersion);
  if (!Number.isInteger(offset) || offset < 0) throw new RangeError('船员代号偏移必须是非负整数');
  const start = stableCrewIdentityHash(`${shipId}\u0000${crewId}\u0000${configVersion}`) % CREW_CALL_SIGN_WORDS.length;
  return CREW_CALL_SIGN_WORDS[(start + offset) % CREW_CALL_SIGN_WORDS.length];
}

/** 稳定 32 位无符号 FNV-1a hash；不读取系统时间，也不使用 Math.random。 */
export function stableCrewIdentityHash(value: string): number {
  if (typeof value !== 'string') throw new TypeError('船员代号 hash 输入必须是字符串');
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 解析整艘飞船的船员身份。
 *
 * 固定代号先占用词库，再按稳定 crewId 顺序处理 GENERATED，保证输入数组顺序不会影响结果；
 * 生成 hash 发生碰撞时使用词库中的下一个词，直到找到未占用代号。
 */
export function resolveCrewIdentities(
  entries: readonly CrewIdentityEntry[],
  context: CrewIdentityContext,
): ReadonlyMap<string, CrewIdentity> {
  if (!isRecord(context) || typeof context.shipId !== 'string' || context.shipId.trim() === '' ||
    typeof context.configVersion !== 'string' || context.configVersion.trim() === '') {
    throw new RangeError('生成船员代号必须提供非空 shipId 和 configVersion');
  }
  const ids = new Set<string>();
  const result = new Map<string, CrewIdentity>();
  const fixedNames = new Set<string>();
  const generated: CrewIdentityEntry[] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.crewId !== 'string' || entry.crewId.trim() === '') {
      throw new RangeError('船员代号输入必须使用非空 crewId');
    }
    if (ids.has(entry.crewId)) throw new RangeError(`船员实例 ID 重复：${entry.crewId}`);
    ids.add(entry.crewId);
    const input = entry.identity;
    if (input !== undefined && !isRecord(input)) throw new RangeError(`船员身份格式无效：${entry.crewId}`);
    if (input !== undefined && input.nameMode !== 'GENERATED' && input.nameMode !== 'FIXED') {
      throw new RangeError(`船员代号模式无效：${String(input.nameMode)}`);
    }
    const mode = input?.nameMode ?? 'GENERATED';
    if (mode === 'FIXED') {
      const fixed = resolveFixedCrewIdentity({ nameMode: 'FIXED', callSign: input?.callSign });
      if (fixed.ok === false) throw new RangeError(`${entry.crewId}：${fixed.message}`);
      if (fixedNames.has(fixed.identity.callSign)) throw new RangeError(`同舰船员代号重复：${fixed.identity.callSign}`);
      fixedNames.add(fixed.identity.callSign);
      result.set(entry.crewId, fixed.identity);
    } else if (mode === 'GENERATED' || input === undefined) {
      generated.push(entry);
    } else {
      throw new RangeError(`船员代号模式无效：${String(mode)}`);
    }
  }

  const occupied = new Set(fixedNames);
  for (const entry of generated.sort((left, right) => left.crewId.localeCompare(right.crewId))) {
    let offset = 0;
    let callSign = generateCrewCallSign(context.shipId, entry.crewId, context.configVersion, offset);
    while (occupied.has(callSign) && offset < CREW_CALL_SIGN_WORDS.length) {
      offset += 1;
      callSign = generateCrewCallSign(context.shipId, entry.crewId, context.configVersion, offset);
    }
    if (occupied.has(callSign)) throw new RangeError(`船员代号词库已耗尽：${entry.crewId}`);
    occupied.add(callSign);
    result.set(entry.crewId, Object.freeze({ nameMode: 'GENERATED', callSign }));
  }
  return result;
}

function normalizeFixedCallSign(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const callSign = value.trim();
  if (callSign.length < 1 || callSign.length > 16) return null;
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(callSign)) return null;
  return callSign;
}

function validateContext(shipId: string, crewId: string, configVersion: string): void {
  if (typeof shipId !== 'string' || shipId.trim() === '' || typeof crewId !== 'string' || crewId.trim() === '' ||
    typeof configVersion !== 'string' || configVersion.trim() === '') {
    throw new RangeError('生成船员代号必须提供非空 shipId、crewId 和 configVersion');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(code: CrewIdentityErrorCode, message: string): CrewIdentityResolutionResult {
  return { ok: false, code, message };
}
