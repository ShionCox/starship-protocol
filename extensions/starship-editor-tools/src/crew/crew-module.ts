import { PACKAGE_NAME } from '../constants';
import type { AssetMenuContext, EditorToolModule, SceneSelectionContext } from '../contracts';
import { editorSceneQuery } from '../shared/editor-scene';
import type { EditorCrewCatalogEntry as CrewPrefabCatalogEntry } from '../csv/editor-catalog';
import { createCrewInstance } from './crew-scene-authoring';

let crewCatalog: readonly CrewPrefabCatalogEntry[] = [];

export const crewEditorToolModule: EditorToolModule = {
  id: 'crew',
  getAssetCreateMenu(_context: AssetMenuContext) {
    return [{ label: '打开船员 CSV 创作页', click() { Editor.Message.send(PACKAGE_NAME, 'open-authoring-panel', { page: 'crew' }); } }];
  },
};

export function setCrewCatalog(entries: readonly CrewPrefabCatalogEntry[]): void { crewCatalog = entries; }
export function getCrewCatalog(): readonly CrewPrefabCatalogEntry[] { return crewCatalog; }
export async function createCrewFromSelection(entry: CrewPrefabCatalogEntry, context: SceneSelectionContext, identity?: { readonly nameMode?: string; readonly callSign?: string }) {
  return await createCrewInstance(editorSceneQuery, context, entry, identity);
}
