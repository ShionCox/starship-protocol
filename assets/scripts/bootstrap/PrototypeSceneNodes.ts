import { Node } from 'cc';

/**
 * Prototype 场景的语义节点名。
 *
 * 新建骨架使用中文名称；旧场景中的英文名称仍作为兼容别名读取，
 * 这样不会因为编辑器创作语言变化而破坏运行时路径和已有存档。
 */
export const PROTOTYPE_SCENE_NODE_ALIASES = {
  mainCamera: ['主相机', 'MainCamera'],
  canvas: ['画布', 'Canvas'],
  background: ['背景层', 'Background'],
  worldRoot: ['世界根', 'WorldRoot'],
  shipRoot: ['飞船根', 'ShipRoot'],
  gridRoot: ['网格根', 'GridRoot'],
  roomRoot: ['房间容器', 'RoomRoot'],
  previewRoot: ['预览根', 'PreviewRoot'],
  uiRoot: ['界面根', 'UIRoot'],
  appRoot: ['应用根', 'AppRoot'],
} as const;

export type PrototypeSceneNodeKey = keyof typeof PROTOTYPE_SCENE_NODE_ALIASES;

/** 返回新建场景骨架使用的中文节点名。 */
export function prototypeSceneNodeName(key: PrototypeSceneNodeKey): string {
  return PROTOTYPE_SCENE_NODE_ALIASES[key][0];
}

/** 在一个父节点下按中文名、旧英文名顺序寻找语义节点。 */
export function findPrototypeSceneNode(parent: Node, key: PrototypeSceneNodeKey): Node | null {
  for (const name of PROTOTYPE_SCENE_NODE_ALIASES[key]) {
    const node = parent.getChildByName(name);
    if (node !== null) return node;
  }
  return null;
}

/** 从场景根开始按语义路径查找节点，兼容中文新骨架和英文旧场景。 */
export function findPrototypeSceneNodePath(
  root: Node,
  ...keys: readonly PrototypeSceneNodeKey[]
): Node | null {
  let current: Node | null = root;
  for (const key of keys) {
    if (current === null) return null;
    current = findPrototypeSceneNode(current, key);
  }
  return current;
}
