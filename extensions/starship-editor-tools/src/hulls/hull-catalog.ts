import type { EditorHullCatalogEntry } from '../csv/editor-catalog';

export type HullCatalogEntry = EditorHullCatalogEntry;

let catalog: readonly HullCatalogEntry[] = [];

/** 船体目录只由 main 的 CSV bundle 刷新；本模块不读取或写入 JSON。 */
export function getHullCatalog(): readonly HullCatalogEntry[] { return catalog; }
export function setHullCatalog(entries: readonly HullCatalogEntry[]): void { catalog = [...entries]; }
