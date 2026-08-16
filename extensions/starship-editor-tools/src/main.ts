import {
  DEFAULT_PREFAB_DIRECTORY,
  CREW_CATALOG_CHANGE_MESSAGE,
  HULL_CATALOG_CHANGE_MESSAGE,
  PACKAGE_NAME,
  ROOM_CATALOG_CHANGE_MESSAGE,
  PSS_INDEX_CHANGE_MESSAGE,
  CSV_CONFIG_CHANGE_MESSAGE,
  AUTHORING_BATCH_START_MESSAGE,
  AUTHORING_BATCH_END_MESSAGE,
} from './constants';
import { ASSET_OPERATION_QUIET_MS, editorAssetDb, getCurrentAuthoringAsset, noteAuthoringAssetOperation, openEditorAsset, waitForAuthoringQuiet } from './shared/editor-asset-db';
import type { AssetDbPort } from './shared/editor-asset-db';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { componentTypeMatches, editorSceneQuery, getSceneComponentUuid, saveAuthoringScene } from './shared/editor-scene';
import {
  createRoomFromSelection,
  getRoomCatalog,
  setRoomCatalog,
} from './rooms/room-module';
import type { SceneSkeletonKind } from './scene/scene-skeleton';
import {
  createOrUpdateScene as createOrUpdateSceneInCreator,
  openAuthoringSceneContext,
} from './scene/foundation-prefab-authoring';
import { resolveRoomPlacementTarget } from './rooms/room-scene-authoring';
import type { SceneNodeTree } from './shared/editor-scene';
import {
  recognizeAuthoringSelection,
  type AuthoringSelection,
} from './authoring-selection';
import { bindFirstPssCrewAppearances } from './crew/bind-crew-prefab';
import { createCrewFromSelection, getCrewCatalog, setCrewCatalog } from './crew/crew-module';
import { getHullCatalog, setHullCatalog } from './hulls/hull-catalog';
import { createShipInstance as createShipInstanceInScene } from './hulls/ship-scene-authoring';
import { bindFirstHullAppearances, FIRST_HULL_VISUALS } from './hulls/hull-appearance-authoring';
import {
  buildPssIndex as buildPssLibraryIndex,
  searchPssAssets,
} from './pss/pss-index';
import type { PssLibraryIndex, PssSearchQuery } from './pss/pss-types';
import type { PssManifest } from './pss/pss-types';
import { createPssImportPort } from './pss/pss-import';
import { bindFirstPssRoomAppearances } from './pss/pss-appearance-authoring';
import { EDITOR_CSV_CONFIG_TABLES, loadCsvConfigBundle, saveCsvConfigBundle, validateEditorCsvConfigTables } from './csv/config-csv';
import { loadEditorCatalogs } from './csv/editor-catalog';
import {
  loadRoomCsvDrafts,
  saveOrCreateRoomCsvDraft,
  toRoomPreviewDto,
  updateRoomInstance as updateRoomInstanceFromCsv,
  type RoomCsvDraft,
  type RoomInstanceEditRequest,
} from './rooms/room-csv-authoring';
import { loadCrewCsvDrafts, loadHullCsvDrafts, saveOrCreateCrewCsvDraft, saveOrCreateHullCsvDraft, toCrewPreviewDto, toHullPreviewDto, type CrewCsvDraft, type HullCsvDraft } from './csv/domain-csv-authoring';

export interface AuthoringState {
  readonly selection: AuthoringSelection;
  readonly roomTarget: {
    readonly ok: boolean;
    readonly mode: 'grid' | 'canvas' | 'scene-root' | 'blocked';
    readonly uuid?: string;
    readonly path?: string;
    readonly message: string;
  };
  readonly rooms: ReturnType<typeof getRoomCatalog>;
  readonly crews: ReturnType<typeof getCrewCatalog>;
  readonly hulls: ReturnType<typeof getHullCatalog>;
  readonly warnings: readonly string[];
}

let catalogWarnings: readonly string[] = [];
let crewCatalogWarnings: readonly string[] = [];
let hullCatalogWarnings: readonly string[] = [];
let catalogFingerprint = '';
let crewCatalogFingerprint = '';
let hullCatalogFingerprint = '';
let catalogRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let authoringRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let pendingAuthoringAssetUuid: string | undefined;
let assetChangeListener: ((...args: unknown[]) => void) | undefined;
let extensionLoaded = false;
let authoringBatchDepth = 0;
let assetRefreshQueuedDuringBatch = false;
let pssIndex: PssLibraryIndex | undefined;
let lastAuthoringRefreshFingerprint = '';

export const methods = {
  openAuthoringPanel() {
    return Editor.Panel.open(`${PACKAGE_NAME}.authoring`);
  },
  async openCreatedPrefab(prefabUrl: string) {
    await openEditorAsset(prefabUrl);
    await previewMappedPrefab(prefabUrl);
  },
  async refreshAuthoringState() {
    await refreshEditorCatalogsNow();
    return await getAuthoringState();
  },
  async createOrUpdateScene(kind: SceneSkeletonKind) {
    beginAuthoringBatch();
    try {
      return await createOrUpdateSceneInCreator(editorAssetDb, editorSceneQuery, kind);
    } finally {
      await endAuthoringBatch();
    }
  },
  async getAuthoringState() {
    return await getAuthoringState();
  },
  async getCsvConfigTables() {
    return await loadCsvConfigBundle(editorAssetDb);
  },
  /** 使用 Creator 公开原生文件选择器一次导入完整编辑器 CSV bundle。 */
  async importCsvConfigBundle() {
    const dialog = (Editor as unknown as { Dialog?: { select?: (options: Record<string, unknown>) => Promise<unknown> } }).Dialog;
    if (dialog?.select === undefined) return { ok: false as const, message: '当前 Creator 不提供公开 CSV 文件选择器' };
    let selected: unknown;
    try {
      selected = await dialog.select({
        title: '选择完整 P8.3 CSV 配置包',
        path: Editor.Project.path,
        type: 'file',
        multi: true,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
    } catch (cause) {
      return { ok: false as const, message: `打开 CSV 文件选择器失败：${cause instanceof Error ? cause.message : String(cause)}` };
    }
    const paths = Array.isArray(selected)
      ? selected.filter((value): value is string => typeof value === 'string')
      : (typeof selected === 'object' && selected !== null && Array.isArray((selected as { filePaths?: unknown }).filePaths)
        ? ((selected as { filePaths: unknown[] }).filePaths.filter((value): value is string => typeof value === 'string'))
        : []);
    if (paths.length === 0) return { ok: false as const, cancelled: true as const, message: '已取消 CSV 导入' };
    const names = new Set(paths.map((file) => basename(file)));
    const expected = new Set<string>(EDITOR_CSV_CONFIG_TABLES);
    if (paths.length !== expected.size || names.size !== expected.size || [...expected].some((name) => !names.has(name))) {
      return { ok: false as const, message: `必须一次选择完整 ${expected.size} 张 CSV（${[...expected].join('、')}）` };
    }
    try {
      const tables = Object.fromEntries(await Promise.all(paths.map(async (file) => [basename(file), await readFile(file, 'utf8')] as const))) as Record<typeof EDITOR_CSV_CONFIG_TABLES[number], string>;
      validateEditorCsvConfigTables(tables);
      const result = await saveCsvConfigBundle(editorAssetDb, tables);
      if (result.ok) getBroadcastMessagePort()?.broadcast?.(CSV_CONFIG_CHANGE_MESSAGE);
      return result;
    } catch (cause) {
      return { ok: false as const, message: cause instanceof Error ? cause.message : String(cause) };
    }
  },
  /** 读取 rooms.csv 与 connector-ports.csv 的白名单草稿，不读取旧 JSON。 */
  async getRoomCsvDrafts() {
    return await loadRoomCsvDrafts(editorAssetDb);
  },
  /** 新建只产生内存草稿；真正写入由领域页保存按钮完成。 */
  async createRoomCsvDraft() {
    const loaded = await loadRoomCsvDrafts(editorAssetDb);
    if (!loaded.ok || loaded.drafts === undefined || loaded.drafts.length === 0) return { ok: false as const, message: loaded.message || 'rooms.csv 没有可复制的基础行' };
    const ids = new Set(loaded.drafts.map((draft) => draft.id));
    const id = nextDraftId('room', ids);
    const base = loaded.drafts[0];
    return { ok: true as const, message: `已创建房间草稿 ${id}，点击保存后追加到 rooms.csv`, draft: { ...base, id, displayName: '新房间', category: 'SPECIAL', verticalConnectorKind: 'NONE', visualId: base.visualId, connectorPorts: [] } };
  },
  async createCrewCsvDraft() {
    const loaded = await loadCrewCsvDrafts(editorAssetDb);
    if (!loaded.ok || loaded.drafts === undefined || loaded.drafts.length === 0) return { ok: false as const, message: loaded.message || 'crews.csv 没有可复制的基础行' };
    const ids = new Set(loaded.drafts.map((draft) => draft.id));
    const id = nextDraftId('crew', ids);
    const base = loaded.drafts[0];
    return { ok: true as const, message: `已创建船员草稿 ${id}，点击保存后追加到 crews.csv`, draft: { ...base, id, displayName: '新船员' } };
  },
  async createHullCsvDraft() {
    const loaded = await loadHullCsvDrafts(editorAssetDb);
    if (!loaded.ok || loaded.drafts === undefined || loaded.drafts.length === 0) return { ok: false as const, message: loaded.message || 'hulls.csv 没有可复制的基础行' };
    const ids = new Set(loaded.drafts.map((draft) => draft.id));
    const id = nextDraftId('hull', ids);
    const base = loaded.drafts[0];
    return { ok: true as const, message: `已创建船体草稿 ${id}，点击保存后追加到 hulls.csv`, draft: { ...base, id, displayName: '新船体' } };
  },
  async saveCrewCsvDraft(request: { readonly draft: CrewCsvDraft }) {
    const result = await saveOrCreateCrewCsvDraft(editorAssetDb, request.draft);
    if (result.ok) {
      getBroadcastMessagePort()?.broadcast?.(CSV_CONFIG_CHANGE_MESSAGE);
      await refreshEditorCatalogsNow();
    }
    return result;
  },
  async previewCrewDefinition(draft: CrewCsvDraft) {
    const checked = toCrewPreviewDto(draft);
    if (typeof checked === 'string') return { ok: false as const, message: checked };
    try { return { ok: true as const, message: describeAuthoringRefresh(await refreshCurrentAuthoringContext('crew', draft.id, checked)), dto: checked }; }
    catch (cause) { return { ok: false as const, message: `船员预览刷新失败：${cause instanceof Error ? cause.message : String(cause)}` }; }
  },
  async saveHullCsvDraft(request: { readonly draft: HullCsvDraft }) {
    const result = await saveOrCreateHullCsvDraft(editorAssetDb, request.draft);
    if (result.ok) {
      getBroadcastMessagePort()?.broadcast?.(CSV_CONFIG_CHANGE_MESSAGE);
      await refreshEditorCatalogsNow();
    }
    return result;
  },
  async previewHullDefinition(draft: HullCsvDraft) {
    const checked = toHullPreviewDto(draft);
    if (typeof checked === 'string') return { ok: false as const, message: checked };
    try { return { ok: true as const, message: describeAuthoringRefresh(await refreshCurrentAuthoringContext('hull', draft.id, checked)), dto: checked }; }
    catch (cause) { return { ok: false as const, message: `船体预览刷新失败：${cause instanceof Error ? cause.message : String(cause)}` }; }
  },
  /** 房间表单输入只在编辑器内存中预览，不写入 CSV 或场景序列化数据。 */
  async previewRoomDefinition(draft: RoomCsvDraft) {
    const checked = toRoomPreviewDto(draft);
    if (checked.ok === false) return checked;
    try {
      const summary = await refreshCurrentAuthoringContext('room', checked.dto.id, checked.dto);
      return { ok: true as const, message: describeAuthoringRefresh(summary), dto: checked.dto };
    } catch (cause) {
      return { ok: false as const, message: `房间预览刷新失败：${cause instanceof Error ? cause.message : String(cause)}` };
    }
  },
  /** 清理当前打开 Scene/Prefab 的所有创作预览，不保存 Scene，也不产生 Undo。 */
  async cancelAuthoringPreview() {
    return await clearCurrentAuthoringPreviews();
  },
  /** 保存房间 CSV 行并在当前打开上下文刷新预览。 */
  async saveRoomCsvDraft(request: { readonly draft: RoomCsvDraft }) {
    const result = await saveOrCreateRoomCsvDraft(editorAssetDb, request);
    if (!result.ok) return result;
    let message = result.message;
    try {
      const summary = await refreshCurrentAuthoringContext('room', result.dto.id, result.dto);
      message = `${message}；${describeAuthoringRefresh(summary)}`;
    } catch (cause) {
      message = `${message}；当前房间预览刷新失败：${cause instanceof Error ? cause.message : String(cause)}`;
    }
    getBroadcastMessagePort()?.broadcast?.(CSV_CONFIG_CHANGE_MESSAGE);
    return { ...result, message };
  },
  /** 房间实例只允许编辑逻辑格 x/y 与 initialHp，并通过一次 Scene recording 提交。 */
  async updateRoomInstance(request: RoomInstanceEditRequest) {
    return await updateRoomInstanceFromCsv(editorSceneQuery, request);
  },
  async createRoomInstance(entry: Parameters<typeof createRoomFromSelection>[0]) {
    return await createRoomFromSelection(entry, { nodeUuid: getSelectedNodeUuid() });
  },
  async createCrewInstance(input: Parameters<typeof createCrewFromSelection>[0] | { readonly entry: Parameters<typeof createCrewFromSelection>[0]; readonly nameMode?: string; readonly callSign?: string }) {
    const request = 'entry' in input ? input : { entry: input };
    return await createCrewFromSelection(request.entry, { nodeUuid: getSelectedNodeUuid() }, request);
  },
  /** PSS 只读参考库索引；缺失 sourceRoot 时保留中文 warning。 */
  async buildPssIndex(sourceRoot?: string) {
    const result = await buildPssLibraryIndex(sourceRoot);
    pssIndex = result;
    getBroadcastMessagePort()?.broadcast?.(PSS_INDEX_CHANGE_MESSAGE);
    return result;
  },
  async searchPssAssets(query: PssSearchQuery = {}) {
    if (pssIndex === undefined) pssIndex = await buildPssLibraryIndex();
    return searchPssAssets(pssIndex, query);
  },
  async bindFirstPssRoomAppearances(kind: SceneSkeletonKind = 'MAIN') {
    let result: Awaited<ReturnType<typeof bindFirstPssRoomAppearances>> | undefined;
    beginAuthoringBatch();
    try {
      result = await bindFirstPssRoomAppearances(editorAssetDb, editorSceneQuery, openEditorAsset, async () => {
        await saveAuthoringScene();
      });
    } finally {
      try { await openAuthoringSceneContext(editorSceneQuery, kind); }
      finally { await endAuthoringBatch(); }
    }
    return result as Awaited<ReturnType<typeof bindFirstPssRoomAppearances>>;
  },
  async bindFirstPssCrewAppearances(kind: SceneSkeletonKind = 'MAIN') {
    let result: Awaited<ReturnType<typeof bindFirstPssCrewAppearances>> | undefined;
    beginAuthoringBatch();
    try {
      result = await bindFirstPssCrewAppearances(editorAssetDb, editorSceneQuery, openEditorAsset, async () => {
        await saveAuthoringScene();
      });
    } catch (cause) {
      result = { ok: false, message: cause instanceof Error ? cause.message : String(cause), bound: [] };
    } finally {
      // 批量打开 Prefab 会改变 Creator 当前编辑上下文；无论成功或失败，
      // 都回到面板选择的 Scene，避免用户误以为场景引用丢失。
      try {
        await openAuthoringSceneContext(editorSceneQuery, kind);
      } catch (restoreCause) {
        if (result !== undefined) {
          result = { ...result, ok: false, message: `${result.message}；恢复${kind}场景失败：${restoreCause instanceof Error ? restoreCause.message : String(restoreCause)}` };
        } else {
          throw restoreCause;
        }
      } finally { await endAuthoringBatch(); }
    }
    return result as Awaited<ReturnType<typeof bindFirstPssCrewAppearances>>;
  },
  /** 用户确认 PSS 候选后，仅导入两张白名单船图并持久升级共享 ShipView Prefab。 */
  async importAndBindFirstPssHullAppearances(kind: SceneSkeletonKind = 'MAIN') {
    beginAuthoringBatch();
    try {
      const manifestInfo = await editorAssetDb.queryInfo('db://assets/textures/pss/manifest.json');
      if (manifestInfo?.file === undefined) return { ok: false as const, message: '无法读取项目 PSS manifest' };
      const manifest = JSON.parse(await editorAssetDb.readFile('db://assets/textures/pss/manifest.json')) as PssManifest;
      const selected = manifest.entries.filter((entry) => FIRST_HULL_VISUALS.some((item) => item.visualId === entry.visualId));
      if (selected.length !== FIRST_HULL_VISUALS.length) return { ok: false as const, message: 'PSS manifest 缺少 4324/261 船体白名单条目' };
      const targetRoot = Editor.Project.path;
      const imported = await createPssImportPort({ sourceRoot: manifest.sourceRoot, targetRoot }).importManifest({ ...manifest, entries: selected });
      if (!imported.every((entry) => entry.ok)) return { ok: false as const, message: imported.map((entry) => `${entry.assetId}：${entry.message}`).join('；') };
      await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/textures/pss/ship');
      for (const item of FIRST_HULL_VISUALS) {
        const url = `db://${item.target}`;
        await waitForImportedTexture2D(editorAssetDb, url);
      }
      await openEditorAsset('db://assets/prefabs/ShipView.prefab');
      const result = await bindFirstHullAppearances(editorAssetDb, editorSceneQuery);
      if (result.ok) await saveAuthoringScene();
      return result;
    } catch (cause) {
      return { ok: false as const, message: cause instanceof Error ? cause.message : String(cause), bound: [] };
    } finally {
      try { await openAuthoringSceneContext(editorSceneQuery, kind); }
      finally { await endAuthoringBatch(); }
    }
  },
  async createShipInstance(entry: Parameters<typeof createShipInstanceInScene>[3]) {
    return await createShipInstanceInScene(editorAssetDb, editorSceneQuery, { nodeUuid: getSelectedNodeUuid() }, entry);
  },
};

/** 打开独立 Prefab 后只注入内存 DTO；不会把九张 CSV 或预览 DTO 写回资源。 */
async function previewMappedPrefab(prefabUrl: string): Promise<void> {
  if (getRoomCatalog().length === 0 && getCrewCatalog().length === 0 && getHullCatalog().length === 0) {
    await refreshEditorCatalogsNow();
  }
  const roomEntries = getRoomCatalog().filter((entry) => entry.prefabUrl === prefabUrl);
  if (roomEntries.length > 0) {
    const loaded = await loadRoomCsvDrafts(editorAssetDb);
    if (!loaded.ok || loaded.drafts === undefined) throw new Error(loaded.message);
    for (const entry of roomEntries) {
      const draft = loaded.drafts.find((item) => item.id === entry.id);
      if (draft === undefined) throw new Error(`权威 CSV 中不存在房间定义：${entry.id}`);
      const checked = toRoomPreviewDto(draft);
      if (!checked.ok) throw new Error(checked.message);
      await refreshCurrentAuthoringContext('room', entry.id, checked.dto);
    }
    return;
  }
  const crewEntries = getCrewCatalog().filter((entry) => entry.prefabUrl === prefabUrl);
  if (crewEntries.length > 0) {
    const loaded = await loadCrewCsvDrafts(editorAssetDb);
    if (!loaded.ok || loaded.drafts === undefined) throw new Error(loaded.message);
    for (const entry of crewEntries) {
      const draft = loaded.drafts.find((item) => item.id === entry.id);
      if (draft === undefined) throw new Error(`权威 CSV 中不存在船员定义：${entry.id}`);
      const checked = toCrewPreviewDto(draft);
      if (typeof checked === 'string') throw new Error(checked);
      await refreshCurrentAuthoringContext('crew', entry.id, checked);
    }
    return;
  }
  const hullEntries = getHullCatalog().filter((entry) => entry.prefabUrl === prefabUrl);
  if (hullEntries.length === 0) return;
  const loaded = await loadHullCsvDrafts(editorAssetDb);
  if (!loaded.ok || loaded.drafts === undefined) throw new Error(loaded.message);
  // ShipView 是共享模板；依次提交 DTO，只有当前持久 hullDefinitionId 匹配的项会生效。
  for (const entry of hullEntries) {
    const draft = loaded.drafts.find((item) => item.id === entry.id);
    if (draft === undefined) throw new Error(`权威 CSV 中不存在船体定义：${entry.id}`);
    const checked = toHullPreviewDto(draft);
    if (typeof checked === 'string') throw new Error(checked);
    await refreshCurrentAuthoringContext('hull', entry.id, checked);
  }
}

export function load(): void {
  extensionLoaded = true;
  registerAssetChangeListener();
  void Promise.all([
    refreshEditorCatalogsNow(),
    buildPssLibraryIndex().then((result) => { pssIndex = result; }),
  ]).catch((cause: unknown) => {
    console.warn(`[AUTHORING] 创作资源列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
  });
}

type AuthoringPreviewKind = 'room' | 'crew' | 'hull';
export interface AuthoringPreviewRefreshSummary {
  readonly matched: number;
  readonly moved: number;
  readonly invalid: readonly string[];
}

/**
 * 只刷新 Creator 当前打开的 Scene/Prefab。
 *
 * CSV 保存后，编辑器中的组件仍可能持有旧的预览缓存。这里通过公开 Scene API 将
 * 纯 DTO 传给当前上下文的 View，
 * 不扫描关闭的场景，也不自动保存 Scene，避免覆盖设计人员其他未提交修改。
 */
export async function refreshCurrentAuthoringContext(
  kind: AuthoringPreviewKind,
  definitionId: string,
  document: unknown,
): Promise<AuthoringPreviewRefreshSummary> {
  const before = await editorSceneQuery.queryNodeTree();
  const fingerprint = JSON.stringify({ root: before.uuid ?? '', kind, definitionId, document });
  if (fingerprint === lastAuthoringRefreshFingerprint) return { matched: 0, moved: 0, invalid: [] };
  const classes = editorSceneQuery.queryComponents === undefined ? [] : await editorSceneQuery.queryComponents();
  const nodes = flattenTree(before);
  const componentType = kind === 'room' ? 'RoomView' : kind === 'crew' ? 'CrewView' : 'ShipView';
  const applyMethod = kind === 'room'
    ? 'applyAuthoringDefinitionPreview'
    : kind === 'crew' ? 'applyAuthoringDefinitionPreview' : 'applyAuthoringHullPreview';
  let matched = 0;
  const invalid: string[] = [];

  for (const node of nodes) {
    for (const component of node.components ?? []) {
      if (!componentTypeMatches(component, componentType, classes)) continue;
      const uuid = getSceneComponentUuid(component);
      if (uuid === undefined) continue;
      const state = await editorSceneQuery.executeComponentMethod(uuid, 'getAuthoringInspectorState', []) as Record<string, unknown> | null;
      const currentId = kind === 'room'
        ? state?.roomDefinitionId
        : kind === 'crew' ? state?.crewDefinitionId : state?.hullDefinitionId;
      if (currentId !== definitionId) continue;
      matched += 1;
      const applied = await editorSceneQuery.executeComponentMethod(uuid, applyMethod, [document]);
      if (applied !== true) {
        invalid.push(String(state?.roomInstanceId ?? state?.crewInstanceId ?? state?.shipId ?? node.name ?? uuid));
      }
    }
  }

  // 房间或船体尺寸/Mask变化后，重新计算当前上下文中的房间与船员表现位置。
  // 这里的布局刷新是伴随校验，不应把其他既有非法实例误报成“本次资源保存失败”；
  // 目标定义本身的 applyAuthoring* 返回 false 才属于本次保存的刷新失败。
  if (kind === 'room' || kind === 'hull') {
    for (const node of nodes) {
      for (const component of node.components ?? []) {
        const uuid = getSceneComponentUuid(component);
        if (uuid === undefined) continue;
        if (!componentTypeMatches(component, 'ShipView', classes)
          && !componentTypeMatches(component, 'RoomView', classes)
          && !componentTypeMatches(component, 'CrewView', classes)) continue;
        try {
          await editorSceneQuery.executeComponentMethod(uuid, 'refreshAuthoringLayoutPreview', []);
        } catch (cause) {
          // 布局伴随刷新失败不能回滚已经保存的 JSON；目标定义的 apply 方法仍会
          // 把自身错误返回给保存结果，其他旧实例只保留编辑器里的现状并等待重试。
          console.warn(`[AUTHORING] 布局伴随刷新失败（${node.name ?? uuid}）：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    }
  }

  const after = await editorSceneQuery.queryNodeTree();
  const moved = countPositionChanges(before, after);
  // 定义草稿预览只改变内存中的组件表现，不创建 Scene Undo；实例位置修改
  // 通过 updateRoomInstance 的一次 recording 单独提交。
  if (invalid.length > 0) {
    throw new Error(`已刷新 ${matched} 个实例，但以下实例需要调整：${[...new Set(invalid)].join('、')}`);
  }
  lastAuthoringRefreshFingerprint = fingerprint;
  return { matched, moved, invalid };
}

/**
 * 清理当前打开的 Scene/Prefab 中所有创作预览覆盖。
 * 只调用 View 的公开清理方法，不保存 Scene、不建立 Undo，也不扫描关闭的资源。
 */
export async function clearCurrentAuthoringPreviews(): Promise<{ readonly ok: boolean; readonly message: string; readonly cleared: number }> {
  const tree = await editorSceneQuery.queryNodeTree();
  const classes = editorSceneQuery.queryComponents === undefined ? [] : await editorSceneQuery.queryComponents();
  const methodsByType: Readonly<Record<string, string>> = {
    RoomView: 'clearAuthoringDefinitionPreview',
    CrewView: 'clearAuthoringDefinitionPreview',
    ShipView: 'clearAuthoringDefinitionPreview',
  };
  let cleared = 0;
  for (const node of flattenTree(tree)) {
    for (const component of node.components ?? []) {
      const type = Object.keys(methodsByType).find((candidate) => componentTypeMatches(component, candidate, classes));
      if (type === undefined) continue;
      const uuid = getSceneComponentUuid(component);
      if (uuid === undefined) continue;
      await editorSceneQuery.executeComponentMethod(uuid, methodsByType[type], []);
      cleared += 1;
    }
  }
  lastAuthoringRefreshFingerprint = '';
  return { ok: true, message: cleared === 0 ? '当前上下文没有创作预览覆盖' : `已清理当前上下文 ${cleared} 个创作预览`, cleared };
}

function describeAuthoringRefresh(summary: AuthoringPreviewRefreshSummary): string {
  const invalid = summary.invalid.length > 0 ? `，需调整 ${[...new Set(summary.invalid)].join('、')}` : '';
  return `已刷新 ${summary.matched} 个实例，位置调整 ${summary.moved} 个${invalid}`;
}
export function unload(): void {
  extensionLoaded = false;
  const message = getBroadcastMessagePort();
  if (assetChangeListener !== undefined) {
    message?.removeBroadcastListener?.('asset-db:asset-change', assetChangeListener);
    assetChangeListener = undefined;
  }
  if (catalogRefreshTimer !== undefined) {
    clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = undefined;
  }
  if (authoringRefreshTimer !== undefined) {
    clearTimeout(authoringRefreshTimer);
    authoringRefreshTimer = undefined;
  }
  pendingAuthoringAssetUuid = undefined;
  authoringBatchDepth = 0;
  assetRefreshQueuedDuringBatch = false;
  lastAuthoringRefreshFingerprint = '';
}

interface EditorCatalogRefreshResult {
  readonly entries: {
    readonly rooms: ReturnType<typeof getRoomCatalog>;
    readonly crews: ReturnType<typeof getCrewCatalog>;
    readonly hulls: ReturnType<typeof getHullCatalog>;
  };
  readonly warnings: readonly string[];
}

/** 目录只从九张运行时 CSV 与 editor-prefabs.csv 生成，避免关闭资源被 JSON 扫描重新带回。 */
async function refreshEditorCatalogsNow(): Promise<EditorCatalogRefreshResult> {
  try {
    const catalogs = await loadEditorCatalogs(editorAssetDb);
    const warnings: string[] = [];
    setRoomCatalog(catalogs.rooms);
    setCrewCatalog(catalogs.crews);
    setHullCatalog(catalogs.hulls);
    catalogWarnings = crewCatalogWarnings = hullCatalogWarnings = warnings;
    const roomFingerprint = JSON.stringify(catalogs.rooms);
    const crewFingerprint = JSON.stringify(catalogs.crews);
    const hullFingerprint = JSON.stringify(catalogs.hulls);
    const roomChanged = roomFingerprint !== catalogFingerprint;
    const crewChanged = crewFingerprint !== crewCatalogFingerprint;
    const hullChanged = hullFingerprint !== hullCatalogFingerprint;
    catalogFingerprint = roomFingerprint;
    crewCatalogFingerprint = crewFingerprint;
    hullCatalogFingerprint = hullFingerprint;
    if (roomChanged) getBroadcastMessagePort()?.broadcast?.(ROOM_CATALOG_CHANGE_MESSAGE);
    if (crewChanged) getBroadcastMessagePort()?.broadcast?.(CREW_CATALOG_CHANGE_MESSAGE);
    if (hullChanged) getBroadcastMessagePort()?.broadcast?.(HULL_CATALOG_CHANGE_MESSAGE);
    return { entries: {
      rooms: catalogs.rooms,
      crews: catalogs.crews,
      hulls: catalogs.hulls,
    }, warnings };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const warnings = [`CSV 目录加载失败：${message}`];
    catalogWarnings = crewCatalogWarnings = hullCatalogWarnings = warnings;
    console.warn(`[AUTHORING] ${warnings[0]}`);
    return { entries: { rooms: getRoomCatalog(), crews: getCrewCatalog(), hulls: getHullCatalog() }, warnings };
  }
}

async function getAuthoringState(): Promise<AuthoringState> {
  const selectedUuid = getSelectedNodeUuid();
  try {
    const tree = await editorSceneQuery.queryNodeTree();
    const selectedNode = selectedUuid === undefined ? undefined : flattenTree(tree).find((node) => node.uuid === selectedUuid);
    // Creator 启动或切场景的瞬间，组件注册表可能还未响应；它只用于还原压缩 CID，
    // 不能因为这个辅助查询失败就把已有 Canvas/场景根判定为不可创建。
    const componentClasses = editorSceneQuery.queryComponents === undefined
      ? []
      : await editorSceneQuery.queryComponents().catch(() => []);
    const target = resolveRoomPlacementTarget(tree, { nodeUuid: selectedUuid }, componentClasses);
    const roomTarget = target.ok
      ? {
        ok: true,
        mode: target.mode,
        uuid: target.node.uuid,
        path: getNodePath(tree, target.node.uuid),
        message: target.message,
      }
      : { ok: false, mode: 'blocked' as const, message: target.message };
    return {
      selection: await recognizeAuthoringSelection({
        selectedNode,
        tree,
        componentClasses,
        scene: editorSceneQuery,
        rooms: getRoomCatalog(),
        crews: getCrewCatalog(),
      }),
      roomTarget,
      rooms: getRoomCatalog(),
      crews: getCrewCatalog(),
      hulls: getHullCatalog(),
      warnings: [...catalogWarnings, ...crewCatalogWarnings, ...hullCatalogWarnings],
    };
  } catch (cause) {
    return {
      selection: { kind: 'none', typeId: 'none', page: 'scene', uuid: selectedUuid },
      roomTarget: { ok: false, mode: 'blocked', message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
      rooms: getRoomCatalog(),
      crews: getCrewCatalog(),
      hulls: getHullCatalog(),
      warnings: [...catalogWarnings, ...crewCatalogWarnings, ...hullCatalogWarnings],
    };
  }
}

/** Asset DB 导入是异步的；超过固定窗口仍无 Texture2D UUID 时必须失败闭环，不能继续写空引用。 */
async function waitForImportedTexture2D(assetDb: AssetDbPort, assetUrl: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const uuid = await assetDb.queryUuid(`${assetUrl}/texture`);
    if (uuid !== '') return uuid;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`导入船体贴图超时，未出现 Texture2D：${assetUrl}`);
}

function getSelectedNodeUuid(): string | undefined {
  try {
    const selection = (globalThis as {
      Editor?: { Selection?: { getSelected?: (type: string) => readonly string[] } };
    }).Editor?.Selection;
    return selection?.getSelected?.('node')?.[0];
  } catch {
    return undefined;
  }
}

function registerAssetChangeListener(): void {
  if (assetChangeListener !== undefined) return;
  const message = getBroadcastMessagePort();
  if (message?.addBroadcastListener === undefined) return;
  assetChangeListener = (...args: unknown[]) => {
    void handleAssetChange(args[0]);
  };
  message.addBroadcastListener('asset-db:asset-change', assetChangeListener);
}

async function handleAssetChange(value: unknown): Promise<void> {
  const uuid = readAssetChangeUuid(value);
  if (uuid !== undefined && !await isAuthoringAssetChange(uuid)) return;
  noteAuthoringAssetOperation(uuid);
  noteAuthoringAssetOperation(getCurrentAuthoringAsset());
  if (!extensionLoaded) return;
  if (authoringBatchDepth > 0) {
    assetRefreshQueuedDuringBatch = true;
    return;
  }
  if (uuid !== undefined) queueAuthoringContextRefresh(uuid);
  if (catalogRefreshTimer !== undefined) clearTimeout(catalogRefreshTimer);
  catalogRefreshTimer = setTimeout(() => {
    catalogRefreshTimer = undefined;
    void refreshEditorCatalogsNow().catch((cause: unknown) => {
      console.warn(`[AUTHORING] 创作资源列表自动刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }, ASSET_OPERATION_QUIET_MS);
}

function beginAuthoringBatch(): void {
  authoringBatchDepth += 1;
  if (authoringBatchDepth === 1) getBroadcastMessagePort()?.broadcast?.(AUTHORING_BATCH_START_MESSAGE);
  if (catalogRefreshTimer !== undefined) clearTimeout(catalogRefreshTimer);
  if (authoringRefreshTimer !== undefined) clearTimeout(authoringRefreshTimer);
  catalogRefreshTimer = undefined;
  authoringRefreshTimer = undefined;
  pendingAuthoringAssetUuid = undefined;
}

async function endAuthoringBatch(): Promise<void> {
  authoringBatchDepth = Math.max(0, authoringBatchDepth - 1);
  if (authoringBatchDepth !== 0) return;
  try {
    await waitForAuthoringQuiet();
    if (assetRefreshQueuedDuringBatch) {
      assetRefreshQueuedDuringBatch = false;
      await refreshEditorCatalogsNow();
    }
  } catch (cause) {
    console.warn(`[AUTHORING] 批量操作后的目录刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    // 目录广播发生时面板仍保持暂停；全部 Creator Scene/Asset DB 操作结束后再恢复。
    getBroadcastMessagePort()?.broadcast?.(AUTHORING_BATCH_END_MESSAGE);
  }
}

function queueAuthoringContextRefresh(uuid: string): void {
  pendingAuthoringAssetUuid = uuid;
  if (authoringRefreshTimer !== undefined) clearTimeout(authoringRefreshTimer);
  authoringRefreshTimer = setTimeout(() => {
    authoringRefreshTimer = undefined;
    const pending = pendingAuthoringAssetUuid;
    pendingAuthoringAssetUuid = undefined;
    if (pending !== undefined) void refreshAuthoringContextFromAsset(pending);
  }, ASSET_OPERATION_QUIET_MS);
}

async function refreshAuthoringContextFromAsset(uuid: string): Promise<void> {
  try {
    const info = await editorAssetDb.queryInfo(uuid);
    const url = info?.url ?? '';
    if (!url.startsWith('db://assets/config/csv/') || !url.endsWith('.csv')) return;
    // 广播只负责重建目录。具体草稿的预览由当前页面的显式 preview 消息触发，
    // 不能在不知道被修改行 ID 时擅自把第一行房间推到当前场景。
    await refreshEditorCatalogsNow();
  } catch (cause) {
    console.warn(`[AUTHORING] 当前预览自动刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function isAuthoringAssetChange(uuid: string): Promise<boolean> {
  if (getRoomCatalog().some((entry) => entry.prefabUuid === uuid)
    || getCrewCatalog().some((entry) => entry.prefabUuid === uuid)
    || (getHullCatalog() as readonly { readonly prefabUuid?: string }[]).some((entry) => entry.prefabUuid === uuid)) return true;
  try {
    const info = await editorAssetDb.queryInfo(uuid);
    return info === null || isAuthoringAssetUrl(info.url);
  } catch {
    // 资源删除或导入过程中的临时查询失败不能让房间目录停留在旧状态。
    return true;
  }
}

function nextDraftId(prefix: 'room' | 'crew' | 'hull', existing: ReadonlySet<string>): string {
  let index = 1;
  while (existing.has(`${prefix}-new-${index}`)) index += 1;
  return `${prefix}-new-${index}`;
}

function isAuthoringAssetUrl(url: string): boolean {
  return (url.startsWith('db://assets/config/csv/') && url.endsWith('.csv'))
    || (url.startsWith(`${DEFAULT_PREFAB_DIRECTORY}/`) && url.endsWith('.prefab'));
}

function readAssetChangeUuid(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'object' && value !== null) {
    const uuid = (value as { uuid?: unknown }).uuid;
    return typeof uuid === 'string' && uuid !== '' ? uuid : undefined;
  }
  return undefined;
}

interface BroadcastMessagePort {
  addBroadcastListener?(name: string, callback: (...args: unknown[]) => void): void;
  removeBroadcastListener?(name: string, callback: (...args: unknown[]) => void): void;
  broadcast?(name: string, ...args: unknown[]): void;
}

function getBroadcastMessagePort(): BroadcastMessagePort | undefined {
  const message = (globalThis as { Editor?: { Message?: unknown } }).Editor?.Message;
  return typeof message === 'object' && message !== null ? message as BroadcastMessagePort : undefined;
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree, parent?: string): void => {
    result.push(parent === undefined || node.parent !== undefined ? node : { ...node, parent });
    for (const child of node.children ?? []) visit(child, node.uuid);
  };
  visit(tree);
  return result;
}

function getNodePath(tree: SceneNodeTree, uuid: string | undefined): string | undefined {
  if (uuid === undefined) return undefined;
  const nodes = flattenTree(tree);
  const byUuid = new Map(nodes.filter((node) => node.uuid !== undefined).map((node) => [node.uuid as string, node]));
  const names: string[] = [];
  let cursor = byUuid.get(uuid);
  while (cursor !== undefined) {
    if (cursor.name !== undefined) names.unshift(cursor.name);
    cursor = cursor.parent === undefined ? undefined : byUuid.get(cursor.parent);
  }
  return names.join('/');
}

function countPositionChanges(before: SceneNodeTree, after: SceneNodeTree): number {
  const oldNodes = new Map(flattenTree(before).filter((node) => node.uuid !== undefined).map((node) => [node.uuid as string, node]));
  let changed = 0;
  for (const node of flattenTree(after)) {
    if (node.uuid === undefined) continue;
    const previous = oldNodes.get(node.uuid);
    if (previous === undefined) continue;
    const oldPosition = previous.position;
    const newPosition = node.position;
    if (oldPosition === undefined || newPosition === undefined) continue;
    if (oldPosition.x !== newPosition.x || oldPosition.y !== newPosition.y || oldPosition.z !== newPosition.z) changed += 1;
  }
  return changed;
}
