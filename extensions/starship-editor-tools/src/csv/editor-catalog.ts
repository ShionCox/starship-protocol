import { loadCsvConfigBundle, parseCsv, parseEditorPrefabCsv, type EditorPrefabBinding } from './config-csv';
import type { AssetDbPort } from '../shared/editor-asset-db';

export interface EditorRoomCatalogEntry { readonly id:string; readonly displayName:string; readonly category:string; readonly width:number; readonly height:number; readonly maxLevel:number; readonly maxHp:number; readonly minPower:number; readonly maxPower:number; readonly powerGeneration:number; readonly crewCapacity:number; readonly healingHpPerTick:number; readonly prefabUrl:string; readonly prefabUuid:string; }
export interface EditorCrewCatalogEntry { readonly id:string; readonly displayName:string; readonly role:string; readonly rarity:string; readonly maxHp:number; readonly moveTicksPerEdge:number; readonly repairHpPerTick:number; readonly appearanceId:string; readonly traitIds:string[]; readonly prefabUrl:string; readonly prefabUuid:string; }
export interface EditorHullCatalogEntry { readonly id:string; readonly displayName:string; readonly level:number; readonly gridWidth:number; readonly gridHeight:number; readonly cellMask:string; readonly maxCrew:number; readonly maxRooms:number; readonly visualId:string; readonly prefabUrl:string; readonly prefabUuid:string; }
export interface EditorCatalogs { readonly rooms: readonly EditorRoomCatalogEntry[]; readonly crews: readonly EditorCrewCatalogEntry[]; readonly hulls: readonly EditorHullCatalogEntry[]; }

/** 从权威 CSV 与 editor-prefabs.csv 生成编辑器目录；绝不扫描或读取 JSON 定义。 */
export async function loadEditorCatalogs(assetDb: AssetDbPort): Promise<EditorCatalogs> {
  const loaded = await loadCsvConfigBundle(assetDb);
  if (!loaded.ok) throw new Error(loaded.message);
  const tables = loaded.bundle.tables;
  const bindings = parseEditorPrefabCsv(tables['editor-prefabs.csv']);
  const byKey = new Map(bindings.map((b) => [`${b.definitionKind}:${b.definitionId}`, b]));
  const uuid = async (url: string): Promise<string> => (await assetDb.queryUuid(url)) || (await assetDb.queryInfo(url))?.uuid || '';
  const rows = (name: string): Record<string,string>[] => { const r=parseCsv(tables[name as keyof typeof tables]); const h=r[0]??[]; return r.slice(2).filter((x) => x.some((cell) => cell.trim() !== '')).map(x=>Object.fromEntries(h.map((k,i)=>[k,x[i]??'']))); };
  const n=(v:string)=>Number(v);
  const prefab = async (b: EditorPrefabBinding) => ({ prefabUrl: b.prefabPath, prefabUuid: await uuid(b.prefabPath) });
  const rooms = await Promise.all(rows('rooms.csv').map(async r=>({
    id: r.id,
    displayName: r.displayName,
    category: r.category,
    width: n(r.width),
    height: n(r.height),
    maxLevel: n(r.maxLevel),
    maxHp: n(r.maxHp),
    minPower: n(r.minPower),
    maxPower: n(r.maxPower),
    powerGeneration: n(r.powerGeneration),
    crewCapacity: n(r.crewCapacity),
    healingHpPerTick: n(r.healingHpPerTick),
    ...(await prefab(byKey.get(`ROOM:${r.id}`)!)),
  } as EditorRoomCatalogEntry)));
  const crews = await Promise.all(rows('crews.csv').map(async r=>({
    id: r.id,
    displayName: r.displayName,
    role: r.role,
    rarity: r.rarity,
    maxHp: n(r.maxHp),
    moveTicksPerEdge: n(r.moveTicksPerEdge),
    repairHpPerTick: n(r.repairHpPerTick),
    appearanceId: r.appearanceId,
    traitIds: r.traitIds ? r.traitIds.split('|').filter(Boolean) : [],
    ...(await prefab(byKey.get(`CREW:${r.id}`)!)),
  } as EditorCrewCatalogEntry)));
  const hulls = await Promise.all(rows('hulls.csv').map(async r=>({
    id: r.id,
    displayName: r.displayName,
    level: n(r.level),
    gridWidth: n(r.gridWidth),
    gridHeight: n(r.gridHeight),
    cellMask: r.cellMask,
    maxCrew: n(r.maxCrew),
    maxRooms: n(r.maxRooms),
    visualId: r.visualId,
    ...(await prefab(byKey.get(`HULL:${r.id}`)!)),
  } as EditorHullCatalogEntry)));
  return { rooms, crews, hulls };
}
