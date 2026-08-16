/** 新基线只识别中文语义节点；旧英文 Prototype 别名已删除。 */
export const SCENE_NODE_NAMES = {
  mainCamera: '主相机',
  canvas: '画布',
  worldRoot: '世界根',
  currentShipMount: '当前飞船挂载点',
  playerShipMount: '我方飞船挂载点',
  enemyShipMount: '敌方飞船挂载点',
  shipView: '飞船视图',
  gridRoot: '网格根',
  roomRoot: '房间容器',
  crewRoot: '船员层',
  effectRoot: '特效层',
  projectileRoot: '弹道层',
  battleEnvironment: '战斗环境',
  uiRoot: '界面根',
  appRoot: '应用根',
  bootAssembly: '启动装配',
} as const;

export type SceneNodeKey = keyof typeof SCENE_NODE_NAMES;

export function sceneNodeName(key: SceneNodeKey): string { return SCENE_NODE_NAMES[key]; }
export function isSceneNodeName(name: string | undefined, key: SceneNodeKey): boolean { return name === SCENE_NODE_NAMES[key]; }
