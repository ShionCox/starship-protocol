import type { AssetMenuContext, EditorMenuItem, EditorToolModule } from './contracts';
import { roomEditorToolModule } from './rooms/room-module';

const modules: readonly EditorToolModule[] = [roomEditorToolModule];

export function onCreateMenu(context: AssetMenuContext): readonly EditorMenuItem[] {
  const submenu = modules.flatMap((module) => module.getAssetCreateMenu(context));
  return submenu.length === 0 ? [] : [{ label: '星舰协议', submenu }];
}
