import { DEFAULT_PREFAB_DIRECTORY, DEFAULT_TEMPLATE_URL, PACKAGE_NAME } from '../constants';
import type { AssetMenuContext, EditorToolModule, SceneSelectionContext } from '../contracts';
import type { RoomPrefabCatalogEntry } from './discover-room-prefabs';
import { createRoomInstance } from './room-scene-authoring';
import { editorSceneQuery } from '../shared/editor-scene';

let roomCatalog: readonly RoomPrefabCatalogEntry[] = [];

function resolveTargetDirectory(context: AssetMenuContext): string {
  if (
    context.isDirectory === true &&
    context.readonly !== true &&
    typeof context.url === 'string' &&
    (context.url === DEFAULT_PREFAB_DIRECTORY || context.url.startsWith(`${DEFAULT_PREFAB_DIRECTORY}/`))
  ) {
    return context.url;
  }
  return DEFAULT_PREFAB_DIRECTORY;
}

export const roomEditorToolModule: EditorToolModule = {
  id: 'rooms',
  getAssetCreateMenu(context) {
    return [
      {
        label: '新建房间建筑…',
        click() {
          Editor.Message.send(PACKAGE_NAME, 'open-room-create', {
            targetDirectory: resolveTargetDirectory(context),
            templateUrl: DEFAULT_TEMPLATE_URL,
          });
        },
      },
    ];
  },
};

export function setRoomCatalog(entries: readonly RoomPrefabCatalogEntry[]): void {
  roomCatalog = entries;
}

export function getRoomCatalog(): readonly RoomPrefabCatalogEntry[] {
  return roomCatalog;
}

export async function createRoomFromSelection(
  entry: RoomPrefabCatalogEntry,
  context: SceneSelectionContext,
) {
  return await createRoomInstance(editorSceneQuery, context, entry);
}
