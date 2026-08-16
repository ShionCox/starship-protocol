import type { AssetDbPort } from '../shared/editor-asset-db';
import { ensureEditorPrefabMapping, loadCsvConfigBundle, parseCsv, saveCsvConfigBundle, type CsvConfigTableName } from './config-csv';

export const CREW_CSV_HEADERS = ['id', 'displayName', 'role', 'rarity', 'maxHp', 'moveTicksPerEdge', 'repairHpPerTick', 'appearanceId', 'traitIds'] as const;
export const HULL_CSV_HEADERS = ['id', 'displayName', 'level', 'gridWidth', 'gridHeight', 'cellMask', 'maxCrew', 'maxRooms', 'baseConstructionSlots', 'visualId'] as const;

export interface CrewCsvDraft { readonly [key: string]: string; readonly id: string; readonly displayName: string; readonly role: string; readonly rarity: string; readonly maxHp: string; readonly moveTicksPerEdge: string; readonly repairHpPerTick: string; readonly appearanceId: string; readonly traitIds: string; }
export interface HullCsvDraft { readonly [key: string]: string; readonly id: string; readonly displayName: string; readonly level: string; readonly gridWidth: string; readonly gridHeight: string; readonly cellMask: string; readonly maxCrew: string; readonly maxRooms: string; readonly baseConstructionSlots: string; readonly visualId: string; }

export function toCrewPreviewDto(draft: CrewCsvDraft): Record<string, unknown> | string {
  const maxHp = Number(draft.maxHp); const moveTicksPerEdge = Number(draft.moveTicksPerEdge); const repairHpPerTick = Number(draft.repairHpPerTick);
  if (!/^crew-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id) || draft.displayName.trim() === '') return '船员稳定 ID 或中文名称无效';
  if (!Number.isInteger(maxHp) || maxHp <= 0 || !Number.isInteger(moveTicksPerEdge) || moveTicksPerEdge <= 0 || !Number.isInteger(repairHpPerTick) || repairHpPerTick < 0) return '船员生命、移动 Tick 和维修量必须是合法整数';
  return { schemaVersion: 4, id: draft.id, displayName: draft.displayName.trim(), role: draft.role, rarity: draft.rarity, maxHp, moveTicksPerEdge, repairHpPerTick, appearanceId: draft.appearanceId, traitIds: draft.traitIds.split('|').filter(Boolean) };
}

export function toHullPreviewDto(draft: HullCsvDraft): Record<string, unknown> | string {
  const gridWidth = Number(draft.gridWidth); const gridHeight = Number(draft.gridHeight);
  if (!/^hull-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id) || draft.displayName.trim() === '') return '船体稳定 ID 或中文名称无效';
  if (!Number.isInteger(gridWidth) || gridWidth <= 0 || !Number.isInteger(gridHeight) || gridHeight <= 0) return '船体网格宽高必须是正整数';
  const rows = draft.cellMask.split('/');
  if (rows.length !== gridHeight || rows.some((row) => row.length !== gridWidth || ![...row].every((cell) => 'VBW'.includes(cell)))) return '船体 cellMask 与声明尺寸不一致或包含非法字符';
  return { schemaVersion: 2, id: draft.id, displayName: draft.displayName.trim(), level: Number(draft.level), gridWidth, gridHeight, cellMask: draft.cellMask, maxCrew: Number(draft.maxCrew), maxRooms: Number(draft.maxRooms), baseConstructionSlots: Number(draft.baseConstructionSlots), visualId: draft.visualId };
}

export async function loadCrewCsvDrafts(assetDb: AssetDbPort): Promise<{ readonly ok: boolean; readonly message: string; readonly drafts?: readonly CrewCsvDraft[] }> {
  return await loadTableDrafts(assetDb, 'crews.csv', CREW_CSV_HEADERS);
}

export async function loadHullCsvDrafts(assetDb: AssetDbPort): Promise<{ readonly ok: boolean; readonly message: string; readonly drafts?: readonly HullCsvDraft[] }> {
  return await loadTableDrafts(assetDb, 'hulls.csv', HULL_CSV_HEADERS);
}

/** 新建或覆盖一条领域 CSV；写入前执行整批配置校验并通过 bundle helper 原子保存。 */
export async function saveOrCreateCrewCsvDraft(assetDb: AssetDbPort, draft: CrewCsvDraft) {
  const prefabPath = draft.role === 'GUNNER'
    ? 'db://assets/prefabs/GunnerCrew.prefab'
    : draft.role === 'MEDIC'
      ? 'db://assets/prefabs/MedicCrew.prefab'
      : draft.role === 'SOLDIER'
        ? 'db://assets/prefabs/SoldierCrew.prefab'
        : 'db://assets/prefabs/EngineerCrew.prefab';
  return await saveOrCreateDraft(assetDb, 'crews.csv', CREW_CSV_HEADERS, draft, toCrewPreviewDto, { definitionKind: 'CREW', displayName: draft.displayName, prefabPath });
}

export async function saveOrCreateHullCsvDraft(assetDb: AssetDbPort, draft: HullCsvDraft) {
  return await saveOrCreateDraft(assetDb, 'hulls.csv', HULL_CSV_HEADERS, draft, toHullPreviewDto, { definitionKind: 'HULL', displayName: draft.displayName, prefabPath: 'db://assets/prefabs/ShipView.prefab' });
}

async function loadTableDrafts<T extends readonly string[]>(assetDb: AssetDbPort, name: CsvConfigTableName, headers: T): Promise<{ readonly ok: boolean; readonly message: string; readonly drafts?: readonly Record<T[number], string>[] }> {
  const result = await loadCsvConfigBundle(assetDb);
  if (!result.ok) return result;
  try {
    const rows = parseCsv(result.bundle.tables[name]);
    if (rows[0]?.join(',') !== headers.join(',')) throw new RangeError(`${name} 表头不匹配`);
    return { ok: true, message: `已读取 ${rows.length - 2} 条 ${name} 配置`, drafts: rows.slice(2).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])) as Record<T[number], string>) };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function saveOrCreateDraft<T extends readonly string[]>(assetDb: AssetDbPort, name: CsvConfigTableName, headers: T, draft: Record<string, string>, validate: (draft: any) => Record<string, unknown> | string, mapping: { readonly definitionKind: 'CREW' | 'HULL'; readonly displayName: string; readonly prefabPath: string }) {
  const checked = validate(draft);
  if (typeof checked === 'string') return { ok: false as const, message: checked };
  const loaded = await loadCsvConfigBundle(assetDb);
  if (!loaded.ok) return loaded;
  const rows = parseCsv(loaded.bundle.tables[name]);
  if (rows[0]?.join(',') !== headers.join(',')) return { ok: false as const, message: `${name} 表头不匹配` };
  const matches = rows.slice(2).filter((row) => row[0] === draft.id);
  if (matches.length > 1) return { ok: false as const, message: `${name} 存在重复稳定标识：${draft.id}` };
  const replacement = headers.map((header) => String(draft[header] ?? ''));
  if (matches.length === 1) rows[rows.findIndex((row, i) => i >= 2 && row[0] === draft.id)] = replacement;
  else rows.push(replacement);
  const normalized = `\uFEFF${rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')}\r\n`;
  const next = ensureEditorPrefabMapping({ ...loaded.bundle.tables, [name]: normalized }, { ...mapping, definitionId: draft.id });
  return await saveCsvConfigBundle(assetDb, next);
}

function escapeCsvField(value: string): string { return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; }
