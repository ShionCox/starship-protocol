import type { AssetDbPort } from '../shared/editor-asset-db';
import { loadVisualDefinition } from '../csv/config-csv';
import { ensureAnimationClipAsset, ensureVisualFrameAssets, primeAuthoringSpriteFrames, waitForAuthoringConfiguration } from './animation-asset-authoring';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

export interface PssAppearanceAuthoringResult {
  readonly ok: boolean;
  readonly message: string;
  readonly bound: readonly string[];
}

interface RoomBinding {
  readonly prefabUrl: string;
  readonly visualId: string;
  readonly mode: number;
  readonly initiallyPowered: boolean;
}

/** 首批房间视觉绑定只写入公开 Scene 属性；规则 JSON 与素材 manifest 仍是各自权威来源。 */
export const FIRST_PSS_ROOM_BINDINGS: readonly RoomBinding[] = [
  { prefabUrl: 'db://assets/prefabs/ElevatorRoom.prefab', visualId: 'visual-pss-room-elevator-83', mode: 0, initiallyPowered: false },
  { prefabUrl: 'db://assets/prefabs/ReactorRoom.prefab', visualId: 'visual-pss-room-reactor-808', mode: 1, initiallyPowered: true },
  { prefabUrl: 'db://assets/prefabs/LaserRoom.prefab', visualId: 'visual-pss-room-laser-8285', mode: 2, initiallyPowered: false },
  { prefabUrl: 'db://assets/prefabs/ShieldRoom.prefab', visualId: 'visual-pss-room-shield-8041', mode: 2, initiallyPowered: false },
  { prefabUrl: 'db://assets/prefabs/MedicalRoom.prefab', visualId: 'visual-pss-room-medbay-1107', mode: 0, initiallyPowered: false },
] as const;

export async function bindFirstPssRoomAppearances(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  openAsset: (url: string) => Promise<void>,
  saveScene: () => Promise<void>,
): Promise<PssAppearanceAuthoringResult> {
  const bound: string[] = [];
  let currentPrefabUrl = '';
  let stage = '启动绑定';
  try {
    for (const binding of FIRST_PSS_ROOM_BINDINGS) {
      currentPrefabUrl = binding.prefabUrl;
      stage = '读取视觉 CSV';
      const visual = await readVisual(assetDb, binding.visualId);
      stage = '查询源贴图';
      const textureUuid = await assetDb.queryUuid(`${visual.textureUrl}/texture`);
      if (textureUuid === '') throw new Error(`找不到 PSS Texture2D 子资源：${visual.textureUrl}/texture`);
      stage = '打开房间 Prefab';
      await openAsset(binding.prefabUrl);
      stage = '查询房间组件';
      const classes = await scene.queryComponents?.() ?? [];
      const room = findComponent(await scene.queryNodeTree(), 'RoomView', classes);
      if (room === null || room.nodeUuid === undefined) throw new Error(`${binding.prefabUrl} 缺少 RoomView`);
      const roomTarget = getSceneComponentTarget(room);
      if (roomTarget === undefined) throw new Error(`${binding.prefabUrl} 无法定位 RoomView 属性目标`);
      stage = '开始单次 Undo';
      const undoId = await scene.beginRecording(room.nodeUuid);
      let recordingActive = true;
      try {
      stage = '准备房间图像节点';
      const previousImage = findChild(await scene.queryNodeTree(), room.nodeUuid, '房间图像');
      // 同名视觉子树是当前规范结构；重复绑定时原位升级，避免无意义删除并保持 Prefab 引用稳定。
      const imageNode = previousImage ?? await scene.createNode({ parent: room.nodeUuid, name: '房间图像', type: 'cc.Node', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
      if (imageNode?.uuid === undefined) throw new Error(`${binding.prefabUrl} 无法创建房间图像节点`);
      const sprite = await ensureComponent(scene, imageNode.uuid, 'cc.Sprite');
      const animation = await ensureComponent(scene, imageNode.uuid, 'cc.Animation');
      const appearance = await ensureComponent(scene, imageNode.uuid, 'RoomAppearance');
      const fallback = findComponent(await scene.queryNodeTree(), 'cc.Graphics', classes);
      if (!(await scene.setProperty(roomTarget, 'roomAppearance', { type: 'RoomAppearance', uuid: appearance.uuid }, { record: false }))) throw new Error(`${binding.prefabUrl} 无法连接 RoomAppearance`);
      if (!(await scene.setProperty(appearance, 'sprite', { type: 'cc.Sprite', uuid: sprite.uuid }, { record: false }))) throw new Error(`${binding.prefabUrl} 无法绑定 Sprite`);
      if (!(await scene.setProperty(appearance, 'animation', { type: 'cc.Animation', uuid: animation.uuid }, { record: false }))) throw new Error(`${binding.prefabUrl} 无法绑定 Animation`);
      if (fallback !== null && !(await scene.setProperty(appearance, 'fallbackGraphics', { type: 'cc.Graphics', uuid: fallback.uuid }, { record: false }))) throw new Error(`${binding.prefabUrl} 无法绑定 Graphics 回退`);
      if (!(await scene.setProperty(appearance, 'sourceTexture', { type: 'cc.Texture2D', uuid: textureUuid }, { record: false }))) throw new Error(`${binding.prefabUrl} 无法绑定源贴图`);
      stage = '生成持久 SpriteFrame';
      const frameUuids = await ensureVisualFrameAssets(assetDb, binding.visualId, visual.textureUrl, visual.canvasWidth, visual.canvasHeight, visual.frames);
      stage = '通过 Scene 加载 SpriteFrame';
      await primeAuthoringSpriteFrames(scene, sprite, appearance.uuid, frameUuids, binding.prefabUrl);
      const clipUrl = visual.textureUrl.replace(/\.png$/i, binding.mode === 1 ? '-always-loop.anim' : '-powered-loop.anim');
      stage = '生成持久 AnimationClip';
      const clipUuid = binding.mode === 0 ? undefined : await ensureAnimationClipAsset(
        assetDb,
        scene,
        appearance.uuid,
        clipUrl,
        `RoomAppearance-${binding.visualId}`,
        visual.fps,
        frameUuids,
      );
      if (binding.mode === 1 && clipUuid !== undefined
        && !(await scene.setProperty(appearance, 'alwaysLoopClip', { type: 'cc.AnimationClip', uuid: clipUuid }, { record: false }))) {
        throw new Error(`${binding.prefabUrl} 无法绑定始终循环 AnimationClip`);
      }
      if (binding.mode === 2 && clipUuid !== undefined
        && !(await scene.setProperty(appearance, 'poweredClip', { type: 'cc.AnimationClip', uuid: clipUuid }, { record: false }))) {
        throw new Error(`${binding.prefabUrl} 无法绑定供电循环 AnimationClip`);
      }
      stage = '启动房间外观配置';
      const configured = await scene.executeComponentMethod(appearance.uuid, 'applyAuthoringPssConfiguration', [{
        visualId: binding.visualId,
        mode: binding.mode,
        frameRate: visual.fps,
        canvasWidth: visual.canvasWidth,
        canvasHeight: visual.canvasHeight,
        initiallyPowered: binding.initiallyPowered,
        displayScalePermille: visual.displayScalePermille,
        gridOffsetX: visual.gridOffsetX,
        gridOffsetY: visual.gridOffsetY,
        pivot: visual.pivot,
        filter: visual.filter,
        frameRects: visual.frames,
        frameUuids,
      }]);
      stage = '等待房间外观配置';
      await waitForAuthoringConfiguration(scene, appearance.uuid, configured, binding.prefabUrl);
      stage = '刷新房间预览';
      await scene.executeComponentMethod(appearance.uuid, 'refreshPreview', []);
      stage = '结束单次 Undo';
      await scene.endRecording(undoId);
      recordingActive = false;
      stage = '保存房间 Prefab';
      await saveScene();
      bound.push(binding.prefabUrl);
      } catch (cause) {
        if (recordingActive) await scene.cancelRecording(undoId).catch(() => undefined);
        throw cause;
      }
    }
    return { ok: true, message: `已从视觉 CSV 全新重建 ${bound.length} 个房间外观`, bound };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, message: `${currentPrefabUrl} 在“${stage}”阶段失败：${detail}；已停止后续房间绑定`, bound };
  }
}

async function readVisual(assetDb: AssetDbPort, visualId: string): Promise<{
  readonly textureUrl: string;
  readonly fps: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly displayScalePermille: number;
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
  readonly pivot: 'CENTER' | 'BOTTOM_CENTER';
  readonly filter: 'NEAREST' | 'LINEAR';
  readonly frames: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}> {
  const visual = await loadVisualDefinition(assetDb, visualId, 'ROOM');
  return {
    textureUrl: visual.textureUrl,
    fps: visual.fps,
    canvasWidth: visual.imageWidth,
    canvasHeight: visual.imageHeight,
    displayScalePermille: visual.displayScalePermille,
    gridOffsetX: visual.gridOffsetX,
    gridOffsetY: visual.gridOffsetY,
    pivot: visual.pivot,
    filter: visual.filter,
    frames: visual.frames.map(({ x, y, width, height }) => ({ x, y, width, height })),
  };
}

async function ensureComponent(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget> {
  const classes = await scene.queryComponents?.() ?? [];
  let target = getSceneComponentTarget(findComponent(await scene.queryNodeTree(), type, classes, nodeUuid));
  if (target !== undefined) return target;
  await scene.createComponent(nodeUuid, type);
  target = getSceneComponentTarget(findComponent(await scene.queryNodeTree(), type, await scene.queryComponents?.() ?? [], nodeUuid));
  if (target === undefined) throw new Error(`节点 ${nodeUuid} 无法挂载 ${type}`);
  return target;
}

function findComponent(tree: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[], nodeUuid?: string): SceneComponentInfo | null {
  for (const node of flattenTree(tree)) {
    if (nodeUuid !== undefined && node.uuid !== nodeUuid) continue;
    for (const [index, component] of (node.components ?? []).entries()) {
      const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
      if (componentTypeMatches(candidate, type, classes)) return candidate;
    }
  }
  return null;
}

function findChild(tree: SceneNodeTree, parentUuid: string, name: string): SceneNodeTree | null {
  for (const node of flattenTree(tree)) {
    if (node.uuid === parentUuid) return (node.children ?? []).find((child) => child.name === name) ?? null;
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): readonly SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}
