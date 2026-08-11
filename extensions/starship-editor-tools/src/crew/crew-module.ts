import { DEFAULT_CREW_TEMPLATE_URL, DEFAULT_PREFAB_DIRECTORY, PACKAGE_NAME } from '../constants';
import type { AssetMenuContext, EditorToolModule, SceneSelectionContext } from '../contracts';
import { editorSceneQuery } from '../shared/editor-scene';
import type { CrewPrefabCatalogEntry } from './discover-crew-prefabs';
import { createCrewInstance } from './crew-scene-authoring';

let crewCatalog: readonly CrewPrefabCatalogEntry[] = [];

export const crewEditorToolModule: EditorToolModule = {
  id: 'crew',
  getAssetCreateMenu(_context: AssetMenuContext) {
    return [{ label: '新建船员…', click() { Editor.Message.send(PACKAGE_NAME, 'open-authoring-panel', { page: 'crew', targetDirectory: DEFAULT_PREFAB_DIRECTORY, templateUrl: DEFAULT_CREW_TEMPLATE_URL }); } }];
  },
};

export function setCrewCatalog(entries: readonly CrewPrefabCatalogEntry[]): void { crewCatalog = entries; }
export function getCrewCatalog(): readonly CrewPrefabCatalogEntry[] { return crewCatalog; }
export async function createCrewFromSelection(entry: CrewPrefabCatalogEntry, context: SceneSelectionContext) {
  return await createCrewInstance(editorSceneQuery, context, entry);
}
