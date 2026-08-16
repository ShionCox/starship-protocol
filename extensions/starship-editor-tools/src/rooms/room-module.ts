import { PACKAGE_NAME } from '../constants';
import type { EditorToolModule, SceneSelectionContext } from '../contracts';
import type { EditorRoomCatalogEntry as RoomPrefabCatalogEntry } from '../csv/editor-catalog';
import { createRoomInstance } from './room-scene-authoring';
import { editorSceneQuery } from '../shared/editor-scene';

let roomCatalog: readonly RoomPrefabCatalogEntry[] = [];

export const roomEditorToolModule: EditorToolModule = {
  id: 'rooms',
  getAssetCreateMenu(_context) {
    return [{
      label: '打开房间 CSV 创作页',
      click() { Editor.Message.send(PACKAGE_NAME, 'open-authoring-panel', { page: 'rooms' }); },
    }];
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
