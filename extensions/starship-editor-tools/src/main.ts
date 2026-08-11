import {
  DEFAULT_PREFAB_DIRECTORY,
  CREW_CATALOG_CHANGE_MESSAGE,
  CREW_CONFIG_DIRECTORY,
  PACKAGE_NAME,
  ROOM_CATALOG_CHANGE_MESSAGE,
  ROOM_CONFIG_DIRECTORY,
} from './constants';
import type { AssetMenuContext } from './contracts';
import {
  createRoomContent as createRoomContentWithAssetDb,
  type RoomCreationRequest,
} from './rooms/create-room-content';
import { editorAssetDb } from './shared/editor-asset-db';
import { editorSceneQuery } from './shared/editor-scene';
import { validateOpenRoomPrefab } from './rooms/validate-open-room-prefab';
import { discoverRoomPrefabs } from './rooms/discover-room-prefabs';
import {
  createRoomFromSelection,
  getRoomCatalog,
  setRoomCatalog,
} from './rooms/room-module';
import { initializePrototypeScene } from './scene/prototype-skeleton';
import { bindRoomDefinitionToOpenPrefab } from './rooms/bind-room-prefab';
import { resolveRoomPlacementTarget } from './rooms/room-scene-authoring';
import {
  updateRoomDefinition,
  type RoomDefinitionEditRequest,
} from './rooms/edit-room-definition';
import type { SceneNodeTree } from './shared/editor-scene';
import {
  recognizeAuthoringSelection,
  type AuthoringSelection,
} from './authoring-selection';
import {
  updateSceneCoreSettings,
  type SceneCoreSettingsRequest,
} from './scene/scene-core-authoring';
import { configureR1EnergyScene } from './scene/r1-energy-authoring';
import { discoverCrewPrefabs } from './crew/discover-crew-prefabs';
import {
  createCrewContent as createCrewContentWithAssetDb,
  rollbackCrewAssets,
  type CrewCreationRequest,
} from './crew/create-crew-content';
import { bindCrewDefinitionToOpenPrefab } from './crew/bind-crew-prefab';
import { createCrewFromSelection, getCrewCatalog, setCrewCatalog } from './crew/crew-module';
import { updateCrewDefinition, type CrewDefinitionEditRequest } from './crew/edit-crew-definition';
import { configureR1CrewScene } from './scene/r1-crew-authoring';
import {
  createCrewMemberTemplate,
  createPowerRoomRowTemplate,
  replacePowerRowsWithPrefab,
} from './scene/prefab-template-authoring';

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
  readonly warnings: readonly string[];
}

let catalogWarnings: readonly string[] = [];
let crewCatalogWarnings: readonly string[] = [];
let catalogFingerprint = '';
let crewCatalogFingerprint = '';
let catalogRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let assetChangeListener: ((...args: unknown[]) => void) | undefined;
let extensionLoaded = false;

export const methods = {
  openRoomCreate(context: AssetMenuContext) {
    return Editor.Panel.open(PACKAGE_NAME, context);
  },
  openAuthoringPanel() {
    return Editor.Panel.open(`${PACKAGE_NAME}.authoring`);
  },
  createRoomContent(request: RoomCreationRequest) {
    return createRoomContentWithAssetDb(request, editorAssetDb).then(async (result) => {
      if (!result.ok) return result;
      let failureMessage: string | null = null;
      try {
        const configUuid = await editorAssetDb.queryUuid(result.configUrl);
        if (configUuid === '') {
          failureMessage = `创建后找不到房间定义资源：${result.configUrl}`;
        } else {
          await Editor.Message.request('asset-db', 'open-asset', result.prefabUrl);
          const binding = await bindRoomDefinitionToOpenPrefab(editorSceneQuery, configUuid, request.id);
          if (binding.ok) {
            const refreshed = await refreshRoomCatalogNow();
            const warning = refreshed.warnings.length > 0
              ? `（列表刷新有 ${refreshed.warnings.length} 条警告）`
              : '';
            return { ...result, message: `${result.message}${binding.message}${warning}` };
          }
          failureMessage = binding.message;
        }
      } catch (error) {
        failureMessage = error instanceof Error ? error.message : String(error);
      }
      const rollbackErrors: string[] = [];
      for (const url of [result.prefabUrl, result.configUrl]) {
        try {
          await editorAssetDb.deleteAsset(url);
        } catch (error) {
          rollbackErrors.push(`${url}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return {
        ok: false as const,
        message: `${failureMessage ?? '房间定义绑定失败'}；已回滚新资源${rollbackErrors.length === 0 ? '' : `，回滚失败：${rollbackErrors.join('；')}`}`,
      };
    });
  },
  createCrewContent(request: CrewCreationRequest) {
    return createCrewContentWithAssetDb(request, editorAssetDb).then(async (result) => {
      if (!result.ok) return result;
      let failureMessage: string | null = null;
      try {
        const configUuid = await editorAssetDb.queryUuid(result.configUrl);
        if (configUuid === '') failureMessage = `创建后找不到船员定义资源：${result.configUrl}`;
        else {
          await Editor.Message.request('asset-db', 'open-asset', result.prefabUrl);
          const binding = await bindCrewDefinitionToOpenPrefab(
            editorSceneQuery,
            configUuid,
            request.id,
            request.role as 'ENGINEER' | 'GUNNER',
          );
          if (binding.ok) {
            await refreshCrewCatalogNow();
            return { ...result, message: `${result.message}${binding.message}` };
          }
          failureMessage = binding.message;
        }
      } catch (cause) {
        failureMessage = cause instanceof Error ? cause.message : String(cause);
      }
      const rollbackErrors = await rollbackCrewAssets(editorAssetDb, [result.prefabUrl, result.configUrl]);
      const rollbackMessage = rollbackErrors.length === 0
        ? '已回滚新资源'
        : `回滚失败，资源清理未完成，无法确认以下资源已删除：${rollbackErrors.join('；')}`;
      return { ok: false as const, message: `${failureMessage ?? '船员定义绑定失败'}；${rollbackMessage}` };
    });
  },
  openCreatedPrefab(prefabUrl: string) {
    return Editor.Message.request('asset-db', 'open-asset', prefabUrl);
  },
  validateOpenRoomPrefab() {
    return validateOpenRoomPrefab(editorSceneQuery);
  },
  async refreshAuthoringState() {
    await Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]);
    return await getAuthoringState();
  },
  initializePrototypeScene() {
    return initializePrototypeScene(editorSceneQuery);
  },
  async getAuthoringState() {
    return await getAuthoringState();
  },
  async createRoomInstance(entry: Parameters<typeof createRoomFromSelection>[0]) {
    return await createRoomFromSelection(entry, { nodeUuid: getSelectedNodeUuid() });
  },
  async createCrewInstance(entry: Parameters<typeof createCrewFromSelection>[0]) {
    return await createCrewFromSelection(entry, { nodeUuid: getSelectedNodeUuid() });
  },
  async updateRoomDefinition(request: RoomDefinitionEditRequest) {
    const result = await updateRoomDefinition(request, editorAssetDb);
    if (result.ok) await refreshRoomCatalogNow();
    return result;
  },
  async updateCrewDefinition(request: CrewDefinitionEditRequest) {
    const result = await updateCrewDefinition(request, editorAssetDb);
    if (result.ok) await refreshCrewCatalogNow();
    return result;
  },
  async updateSceneCoreSettings(request: SceneCoreSettingsRequest) {
    return await updateSceneCoreSettings(editorSceneQuery, getSelectedNodeUuid(), request);
  },
  async configureR1EnergyScene() {
    const result = await configureR1EnergyScene(editorSceneQuery);
    if (result.ok) await Editor.Message.request('scene', 'save-scene');
    return result;
  },
  async configureR1CrewScene() {
    const result = await configureR1CrewScene(editorSceneQuery);
    if (result.ok) await Editor.Message.request('scene', 'save-scene');
    return result;
  },
  async createCrewMemberTemplate() {
    return await createCrewMemberTemplate(editorAssetDb, editorSceneQuery);
  },
  async createPowerRoomRowTemplate() {
    return await createPowerRoomRowTemplate(editorAssetDb, editorSceneQuery);
  },
  async replacePowerRowsWithPrefab() {
    return await replacePowerRowsWithPrefab(editorAssetDb, editorSceneQuery);
  },
};

export function load(): void {
  extensionLoaded = true;
  registerAssetChangeListener();
  void Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]).catch((cause: unknown) => {
    console.warn(`[AUTHORING] 创作资源列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
  });
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
}

async function refreshRoomCatalogNow() {
  const result = await discoverRoomPrefabs(editorAssetDb);
  setRoomCatalog(result.entries);
  catalogWarnings = result.warnings;
  const nextFingerprint = JSON.stringify({ entries: result.entries, warnings: result.warnings });
  const changed = nextFingerprint !== catalogFingerprint;
  catalogFingerprint = nextFingerprint;
  for (const warning of result.warnings) console.warn(`[ROOM] ${warning}`);
  if (changed) getBroadcastMessagePort()?.broadcast?.(ROOM_CATALOG_CHANGE_MESSAGE);
  return result;
}

async function refreshCrewCatalogNow() {
  const result = await discoverCrewPrefabs(editorAssetDb);
  setCrewCatalog(result.entries);
  crewCatalogWarnings = result.warnings;
  const nextFingerprint = JSON.stringify({ entries: result.entries, warnings: result.warnings });
  const changed = nextFingerprint !== crewCatalogFingerprint;
  crewCatalogFingerprint = nextFingerprint;
  for (const warning of result.warnings) console.warn(`[CREW] ${warning}`);
  if (changed) getBroadcastMessagePort()?.broadcast?.(CREW_CATALOG_CHANGE_MESSAGE);
  return result;
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
      warnings: [...catalogWarnings, ...crewCatalogWarnings],
    };
  } catch (cause) {
    return {
      selection: { kind: 'none', typeId: 'none', page: 'scene', uuid: selectedUuid },
      roomTarget: { ok: false, mode: 'blocked', message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
      rooms: getRoomCatalog(),
      crews: getCrewCatalog(),
      warnings: [...catalogWarnings, ...crewCatalogWarnings],
    };
  }
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
  if (!extensionLoaded) return;
  if (catalogRefreshTimer !== undefined) clearTimeout(catalogRefreshTimer);
  catalogRefreshTimer = setTimeout(() => {
    catalogRefreshTimer = undefined;
    void Promise.all([refreshRoomCatalogNow(), refreshCrewCatalogNow()]).catch((cause: unknown) => {
      console.warn(`[AUTHORING] 创作资源列表自动刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }, 200);
}

async function isAuthoringAssetChange(uuid: string): Promise<boolean> {
  if (getRoomCatalog().some((entry) => entry.prefabUuid === uuid || entry.configUuid === uuid)) return true;
  if (getCrewCatalog().some((entry) => entry.prefabUuid === uuid || entry.configUuid === uuid)) return true;
  try {
    const info = await editorAssetDb.queryInfo(uuid);
    return info === null || isAuthoringAssetUrl(info.url);
  } catch {
    // 资源删除或导入过程中的临时查询失败不能让房间目录停留在旧状态。
    return true;
  }
}

function isAuthoringAssetUrl(url: string): boolean {
  return (url.startsWith(`${ROOM_CONFIG_DIRECTORY}/`) && url.endsWith('.json'))
    || (url.startsWith(`${CREW_CONFIG_DIRECTORY}/`) && url.endsWith('.json'))
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
