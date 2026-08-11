import type { AssetMenuContext, EditorMenuItem, EditorToolModule } from './contracts';
import { roomEditorToolModule } from './rooms/room-module';
import { crewEditorToolModule } from './crew/crew-module';

const modules: readonly EditorToolModule[] = [roomEditorToolModule, crewEditorToolModule];

export function onCreateMenu(context: AssetMenuContext): readonly EditorMenuItem[] {
  const submenu = modules.flatMap((module) => module.getAssetCreateMenu(context));
  return submenu.length === 0 ? [] : [{ label: '星舰协议', submenu }];
}
