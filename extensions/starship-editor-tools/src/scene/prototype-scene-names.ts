/**
 * Prototype 场景骨架的语义节点名。
 *
 * 新节点使用中文名称；英文名称是旧场景兼容别名。这样面板可以创建中文层级，
 * 同时继续识别用户已经搭建好的英文 PrototypeScene。
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

export function prototypeSceneNodeName(key: PrototypeSceneNodeKey): string {
  return PROTOTYPE_SCENE_NODE_ALIASES[key][0];
}

export function isPrototypeSceneNodeName(
  name: string | undefined,
  key: PrototypeSceneNodeKey,
): boolean {
  return name !== undefined && PROTOTYPE_SCENE_NODE_ALIASES[key].some((candidate) => candidate === name);
}
