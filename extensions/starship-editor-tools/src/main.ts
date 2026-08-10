import { PACKAGE_NAME } from './constants';
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
import { resolveRoomRoot } from './rooms/room-scene-authoring';
import {
  updateRoomDefinition,
  type RoomDefinitionEditRequest,
} from './rooms/edit-room-definition';
import type { SceneNodeTree } from './shared/editor-scene';

export interface AuthoringState {
  readonly selection: { readonly uuid?: string; readonly name?: string };
  readonly roomTarget: {
    readonly ok: boolean;
    readonly uuid?: string;
    readonly path?: string;
    readonly message: string;
  };
  readonly rooms: ReturnType<typeof getRoomCatalog>;
  readonly warnings: readonly string[];
}

let catalogWarnings: readonly string[] = [];

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
  openCreatedPrefab(prefabUrl: string) {
    return Editor.Message.request('asset-db', 'open-asset', prefabUrl);
  },
  validateOpenRoomPrefab() {
    return validateOpenRoomPrefab(editorSceneQuery);
  },
  async refreshAuthoringState() {
    await refreshRoomCatalogNow();
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
  async updateRoomDefinition(request: RoomDefinitionEditRequest) {
    const result = await updateRoomDefinition(request, editorAssetDb);
    if (result.ok) await refreshRoomCatalogNow();
    return result;
  },
};

export function load(): void {
  void refreshRoomCatalogNow().catch((cause: unknown) => {
    console.warn(`[ROOM] 房间建筑列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`);
  });
}
export function unload(): void {}

async function refreshRoomCatalogNow() {
  const result = await discoverRoomPrefabs(editorAssetDb);
  setRoomCatalog(result.entries);
  catalogWarnings = result.warnings;
  for (const warning of result.warnings) console.warn(`[ROOM] ${warning}`);
  return result;
}

async function getAuthoringState(): Promise<AuthoringState> {
  const selectedUuid = getSelectedNodeUuid();
  try {
    const tree = await editorSceneQuery.queryNodeTree();
    const selectedNode = selectedUuid === undefined ? undefined : flattenTree(tree).find((node) => node.uuid === selectedUuid);
    const target = resolveRoomRoot(tree, { nodeUuid: selectedUuid });
    const roomTarget = target.ok
      ? {
        ok: true,
        uuid: target.node.uuid,
        path: getNodePath(tree, target.node.uuid),
        message: '已解析唯一 RoomRoot，可创建房间建筑',
      }
      : { ok: false, message: target.message };
    return {
      selection: { uuid: selectedUuid, name: selectedNode?.name },
      roomTarget,
      rooms: getRoomCatalog(),
      warnings: catalogWarnings,
    };
  } catch (cause) {
    return {
      selection: { uuid: selectedUuid },
      roomTarget: { ok: false, message: `无法读取当前场景：${cause instanceof Error ? cause.message : String(cause)}` },
      rooms: getRoomCatalog(),
      warnings: catalogWarnings,
    };
  }
}

function getSelectedNodeUuid(): string | undefined {
  const selection = (globalThis as {
    Editor?: { Selection?: { getSelected?: (type: string) => readonly string[] } };
  }).Editor?.Selection;
  return selection?.getSelected?.('node')?.[0];
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
