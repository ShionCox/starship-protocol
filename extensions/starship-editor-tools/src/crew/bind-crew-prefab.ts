import {
  componentTypeMatches,
  getSceneComponentTarget,
  saveAuthoringScene,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';
import type { AssetDbPort } from '../shared/editor-asset-db';
import { loadVisualDefinition } from '../csv/config-csv';
import { loadCrewCsvDrafts, toCrewPreviewDto } from '../csv/domain-csv-authoring';
import { ensureAnimationClipAsset, ensureVisualFrameAssets, primeAuthoringSpriteFrames, waitForAuthoringConfiguration } from '../pss/animation-asset-authoring';

export const CREW_APPEARANCE_BINDINGS: Readonly<Record<string, { readonly appearanceId: string; readonly textureUrl: string; readonly prefabUrl: string }>> = {
  'crew-engineer': { appearanceId: 'appearance-pss-engineer-bob-8', prefabUrl: 'db://assets/prefabs/EngineerCrew.prefab', textureUrl: 'db://assets/textures/pss/crew/appearance-pss-engineer-bob-8.png' },
  'crew-gunner': { appearanceId: 'appearance-pss-gunner-bobby-240', prefabUrl: 'db://assets/prefabs/GunnerCrew.prefab', textureUrl: 'db://assets/textures/pss/crew/appearance-pss-gunner-bobby-240.png' },
  'crew-medic': { appearanceId: 'appearance-pss-medic-doctor-dong-153', prefabUrl: 'db://assets/prefabs/MedicCrew.prefab', textureUrl: 'db://assets/textures/pss/crew/appearance-pss-medic-doctor-dong-153.png' },
  'crew-soldier': { appearanceId: 'appearance-pss-soldier-government-45', prefabUrl: 'db://assets/prefabs/SoldierCrew.prefab', textureUrl: 'db://assets/textures/pss/crew/appearance-pss-soldier-government-45.png' },
};

export async function bindFirstPssCrewAppearances(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  openAsset: (url: string) => Promise<void>,
  saveScene: () => Promise<void>,
): Promise<{ readonly ok: boolean; readonly message: string; readonly bound: readonly string[] }> {
  const bound: string[] = [];
  try {
    for (const [definitionId, binding] of Object.entries(CREW_APPEARANCE_BINDINGS)) {
      await openAsset(binding.prefabUrl);
      const result = await bindCrewAppearanceToOpenPrefab(scene, assetDb, definitionId, binding.prefabUrl);
      if (!result.ok) throw new Error(result.message);
      await saveScene();
      bound.push(binding.prefabUrl);
    }
    return { ok: true, message: `已通过 Creator 公共接口绑定 ${bound.length} 个船员原生外观`, bound };
  } catch (cause) {
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；已停止后续船员外观绑定`, bound };
  }
}

/** 打开新船员 Prefab 后写入稳定 ID，并用权威 CSV 生成一次内存预览后保存。 */
export async function bindCrewDefinitionToOpenPrefab(
  scene: SceneQueryPort,
  assetDb: AssetDbPort,
  definitionId: string,
  role: 'ENGINEER' | 'GUNNER' | 'MEDIC' | 'SOLDIER' = 'ENGINEER',
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const target = await waitForCrewView(scene);
  if (target === null) return { ok: false, message: '新 Prefab 中没有可绑定的 CrewView 组件' };
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(target.nodeUuid);
    if (!(await scene.setProperty(target, 'crewDefinitionId', definitionId, { record: false }))) throw new Error('无法同步船员定义 ID');
    // Prefab 是可复用模板，实例稳定 ID 必须由场景创作工具在挂载时生成。
    if (!(await scene.setProperty(target, 'crewInstanceId', '', { record: false }))) throw new Error('无法清空 Prefab 默认船员实例 ID');
    const colors = role === 'GUNNER' || role === 'SOLDIER'
      ? { body: { r: 224, g: 82, b: 55, a: 255 }, border: { r: 255, g: 174, b: 122, a: 255 } }
      : role === 'MEDIC'
        ? { body: { r: 232, g: 248, b: 238, a: 255 }, border: { r: 73, g: 218, b: 123, a: 255 } }
        : { body: { r: 36, g: 184, b: 155, a: 255 }, border: { r: 175, g: 255, b: 235, a: 255 } };
    if (!(await scene.setProperty(target, 'bodyColor', { type: 'cc.Color', value: colors.body }, { record: false }))) throw new Error('无法写入船员主体颜色');
    if (!(await scene.setProperty(target, 'borderColor', { type: 'cc.Color', value: colors.border }, { record: false }))) throw new Error('无法写入船员边框颜色');
    if (!(await scene.setProperty(target, 'selectedOutlineColor', { type: 'cc.Color', value: { r: 255, g: 220, b: 70, a: 255 } }, { record: false }))) throw new Error('无法写入选中描边颜色');
    await bindCrewAppearance(scene, assetDb, target, definitionId);
    const loaded = await loadCrewCsvDrafts(assetDb);
    if (!loaded.ok || loaded.drafts === undefined) throw new Error(loaded.message);
    const draft = loaded.drafts.find((entry) => entry.id === definitionId);
    if (draft === undefined) throw new Error(`权威 CSV 中不存在船员定义：${definitionId}`);
    const preview = toCrewPreviewDto(draft);
    if (typeof preview === 'string') throw new Error(preview);
    if (await scene.executeComponentMethod(target.uuid, 'applyAuthoringDefinitionPreview', [preview]) !== true) {
      throw new Error(`船员内存预览应用失败：${definitionId}`);
    }
    const validation = await scene.executeComponentMethod(target.uuid, 'validateAuthoringDefinition', []) as { readonly ok?: boolean; readonly message?: string };
    if (validation?.ok !== true) throw new Error(validation?.message ?? '船员预制体校验失败');
    await scene.endRecording(undoId);
    undoId = null;
    await saveAuthoringScene();
    return { ok: true, message: '预制体已写入船员定义并保存权威 CSV 内存预览外观' };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    return { ok: false, message: `${cause instanceof Error ? cause.message : String(cause)}；已取消船员预制体绑定` };
  }
}

/** 已有 Crew Prefab 只补齐持久外观，不重复改写定义或实例字段。 */
export async function bindCrewAppearanceToOpenPrefab(
  scene: SceneQueryPort,
  assetDb: AssetDbPort,
  definitionId: string,
  prefabUrl?: string,
): Promise<{ readonly ok: boolean; readonly message: string }> {
  const target = await waitForCrewView(scene, definitionId);
  if (target === null) return { ok: false, message: `当前 Prefab 没有可绑定的 CrewView 组件${prefabUrl === undefined ? '' : `：${prefabUrl}`}` };
  let undoId: string | null = null;
  try {
    undoId = await scene.beginRecording(target.nodeUuid);
    await bindCrewAppearance(scene, assetDb, target, definitionId);
    await scene.endRecording(undoId);
    undoId = null;
    await saveAuthoringScene();
    return { ok: true, message: `已从视觉 CSV 全新重建 ${definitionId} 的船员外观` };
  } catch (cause) {
    if (undoId !== null) await scene.cancelRecording(undoId).catch(() => undefined);
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function bindCrewAppearance(scene: SceneQueryPort, assetDb: AssetDbPort, crewTarget: SceneComponentTarget, definitionId: string): Promise<void> {
  const binding = CREW_APPEARANCE_BINDINGS[definitionId];
  if (binding === undefined) return;
  const visual = await readVisual(assetDb, binding.appearanceId, '船员');
  const textureUuid = await assetDb.queryUuid(`${visual.textureUrl}/texture`);
  if (textureUuid === '') throw new Error(`找不到船员外观贴图：${visual.textureUrl}/texture`);
  const tree = await scene.queryNodeTree();
  const previousImage = findChild(tree, crewTarget.nodeUuid, '船员图像');
  const previousRootLabel = findChild(tree, crewTarget.nodeUuid, '船员名称');
  // 船员精灵只能翻转自身；旧结构把 Label 和 Sprite 放在同一节点，必须在同一 Undo
  // recording 中删除整棵旧视觉子树后重建，避免留下不可见的序列化幽灵组件。
  if (previousImage?.uuid !== undefined) await scene.removeNode(previousImage.uuid);
  if (previousRootLabel?.uuid !== undefined && previousRootLabel.uuid !== previousImage?.uuid) {
    await scene.removeNode(previousRootLabel.uuid);
  }
  const image = await scene.createNode({ parent: crewTarget.nodeUuid, name: '船员图像', type: 'cc.Node', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
  if (image?.uuid === undefined) throw new Error('无法创建船员图像节点');
  const imageTransform = await ensureComponent(scene, image.uuid, 'cc.UITransform');
  await ensureComponent(scene, image.uuid, 'cc.Graphics');
  const spriteNode = await scene.createNode({ parent: image.uuid, name: '船员精灵', type: 'cc.Node', position: { x: 0, y: 0, z: 0 }, unlinkPrefab: false, snapshot: false });
  if (spriteNode?.uuid === undefined) throw new Error('无法创建船员精灵节点');
  const spriteTransform = await ensureComponent(scene, spriteNode.uuid, 'cc.UITransform');
  const sprite = await ensureComponent(scene, spriteNode.uuid, 'cc.Sprite');
  const animation = await ensureComponent(scene, spriteNode.uuid, 'cc.Animation');
  const appearance = await ensureComponent(scene, spriteNode.uuid, 'CrewAppearance');
  const imageLabel = await scene.createNode({ parent: image.uuid, name: '船员名称', type: 'cc.Node', position: { x: 0, y: 32, z: 1 }, unlinkPrefab: false, snapshot: false });
  if (imageLabel?.uuid === undefined) throw new Error('无法创建船员图像名称节点');
  const labelTransform = await ensureComponent(scene, imageLabel.uuid, 'cc.UITransform');
  const label = await ensureComponent(scene, imageLabel.uuid, 'cc.Label');
  if (!(await scene.setProperty(imageTransform, 'anchorPoint', { type: 'cc.Vec2', value: { x: 0.5, y: 0 } }, { record: false }))) throw new Error('无法设置船员脚底锚点');
  if (!(await scene.setProperty(imageTransform, 'contentSize', { type: 'cc.Size', value: { width: 24, height: 24 } }, { record: false }))) throw new Error('无法设置船员图像尺寸');
  if (!(await scene.setProperty(spriteTransform, 'anchorPoint', { type: 'cc.Vec2', value: { x: 0.5, y: 0 } }, { record: false }))) throw new Error('无法设置船员精灵锚点');
  if (!(await scene.setProperty(spriteTransform, 'contentSize', { type: 'cc.Size', value: { width: 24, height: 24 } }, { record: false }))) throw new Error('无法设置船员精灵尺寸');
  if (!(await scene.setProperty(labelTransform, 'anchorPoint', { type: 'cc.Vec2', value: { x: 0.5, y: 0.5 } }, { record: false }))) throw new Error('无法设置船员名称锚点');
  if (!(await scene.setProperty(labelTransform, 'contentSize', { type: 'cc.Size', value: { width: 128, height: 22 } }, { record: false }))) throw new Error('无法设置船员名称尺寸');
  for (const [path, value] of [
    ['string', visual.displayName],
    ['fontFamily', 'Microsoft YaHei'],
    ['fontSize', 14],
    ['lineHeight', 18],
    ['isBold', true],
    ['cacheMode', 0],
    ['enableShadow', false],
    ['enableOutline', true],
    ['outlineWidth', 1],
  ] as const) {
    if (!(await scene.setProperty(label, path, value, { record: false }))) throw new Error(`无法设置船员名称属性：${path}`);
  }
  if (!(await scene.setProperty(label, 'outlineColor', { type: 'cc.Color', value: { r: 0, g: 0, b: 0, a: 255 } }, { record: false }))) throw new Error('无法设置船员名称描边颜色');
  if (!(await scene.setProperty(crewTarget, 'visualRoot', { type: 'cc.Node', uuid: image.uuid }, { record: false }))) throw new Error('无法连接船员图像节点');
  if (!(await scene.setProperty(crewTarget, 'visualGridWidth', 1, { record: false }))) throw new Error('无法设置船员视觉宽度');
  if (!(await scene.setProperty(crewTarget, 'visualGridHeight', 1, { record: false }))) throw new Error('无法设置船员视觉高度');
  if (!(await scene.setProperty(crewTarget, 'crewAppearance', { type: 'CrewAppearance', uuid: appearance.uuid }, { record: false }))) throw new Error('无法连接 CrewAppearance');
  if (!(await scene.setProperty(appearance, 'sprite', { type: 'cc.Sprite', uuid: sprite.uuid }, { record: false }))) throw new Error('无法绑定船员 Sprite');
  if (!(await scene.setProperty(appearance, 'animation', { type: 'cc.Animation', uuid: animation.uuid }, { record: false }))) throw new Error('无法绑定船员 Animation');
  if (!(await scene.setProperty(appearance, 'sourceTexture', { type: 'cc.Texture2D', uuid: textureUuid }, { record: false }))) throw new Error('无法绑定船员合成贴图');
  const frameUuids = await ensureVisualFrameAssets(assetDb, binding.appearanceId, visual.textureUrl, visual.canvasWidth, visual.canvasHeight, visual.frames);
  await primeAuthoringSpriteFrames(scene, sprite, appearance.uuid, frameUuids, `${definitionId} 船员外观`);
  const clipBase = visual.textureUrl.replace(/\.png$/i, '');
  const idleClipUuid = await ensureAnimationClipAsset(assetDb, scene, appearance.uuid, `${clipBase}-idle.anim`, `CrewAppearance-${binding.appearanceId}-idle`, visual.fps, frameUuids);
  const movingClipUuid = await ensureAnimationClipAsset(assetDb, scene, appearance.uuid, `${clipBase}-moving.anim`, `CrewAppearance-${binding.appearanceId}-moving`, visual.fps, frameUuids);
  const taskClipUuid = await ensureAnimationClipAsset(assetDb, scene, appearance.uuid, `${clipBase}-task.anim`, `CrewAppearance-${binding.appearanceId}-task`, visual.taskFps, frameUuids);
  for (const [path, uuid] of [['idleClip', idleClipUuid], ['movingClip', movingClipUuid], ['taskClip', taskClipUuid]] as const) {
    if (!(await scene.setProperty(appearance, path, { type: 'cc.AnimationClip', uuid }, { record: false }))) {
      throw new Error(`${definitionId} 无法绑定 ${path}`);
    }
  }
  const configured = await scene.executeComponentMethod(appearance.uuid, 'applyAuthoringPssConfiguration', [{
    visualId: binding.appearanceId,
    frameRate: visual.fps,
    taskFrameRate: visual.taskFps,
    idleFrameIndex: visual.idleFrameIndex,
    canvasWidth: visual.canvasWidth,
    canvasHeight: visual.canvasHeight,
    displayScalePermille: visual.displayScalePermille,
    gridOffsetX: visual.gridOffsetX,
    gridOffsetY: visual.gridOffsetY,
    pivot: visual.pivot,
    filter: visual.filter,
    frameRects: visual.frames,
    frameUuids,
  }]);
  await waitForAuthoringConfiguration(scene, appearance.uuid, configured, `${definitionId} 船员外观配置`);
}

async function readVisual(assetDb: AssetDbPort, visualId: string, kind: string): Promise<{
  readonly displayName: string;
  readonly textureUrl: string;
  readonly fps: number;
  readonly taskFps: number;
  readonly idleFrameIndex: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly displayScalePermille: number;
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
  readonly pivot: 'CENTER' | 'BOTTOM_CENTER';
  readonly filter: 'NEAREST' | 'LINEAR';
  readonly frames: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[];
}> {
  const visual = await loadVisualDefinition(assetDb, visualId, kind === '船员' ? 'CREW' : undefined);
  return {
    displayName: visual.displayName,
    textureUrl: visual.textureUrl,
    fps: visual.fps,
    taskFps: visual.taskFps,
    idleFrameIndex: visual.idleFrameIndex,
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
  if (target === undefined) throw new Error(`无法挂载 ${type}`);
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
  return flattenTree(tree).find((node) => node.uuid === parentUuid)?.children?.find((child) => child.name === name) ?? null;
}

function flattenTree(tree: SceneNodeTree): readonly SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(tree);
  return result;
}

async function waitForCrewView(scene: SceneQueryPort, expectedDefinitionId?: string): Promise<SceneComponentTarget | null> {
  // open-asset 后 Creator 会异步刷新组件注册表和 Prefab 文档。每次轮询都
  // 重新读取两者，避免把上一个 Prefab 的空/旧树误判为“没有 CrewView”。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
    const targets = findCrewViewTargets(await scene.queryNodeTree(), classes);
    const target = targets.length === 1 ? targets[0] : undefined;
    if (target !== undefined && expectedDefinitionId === undefined) return target;
    if (target !== undefined) {
      try {
        const state = await scene.executeComponentMethod(target.uuid, 'getAuthoringInspectorState', []) as { readonly crewDefinitionId?: unknown };
        if (state?.crewDefinitionId === expectedDefinitionId) return target;
      } catch {
        // open-asset 切换期间旧文档可能已经卸载；等待目标 Prefab 的 CrewView 出现即可。
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

function findCrewViewTargets(tree: SceneNodeTree, classes: readonly SceneComponentClassInfo[]): readonly SceneComponentTarget[] {
  const targets: SceneComponentTarget[] = [];
  for (const node of flattenTree(tree)) {
    for (const [index, component] of (node.components ?? []).entries()) {
      const candidate: SceneComponentInfo = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
      if (!componentTypeMatches(candidate, 'CrewView', classes)) continue;
      const target = getSceneComponentTarget(candidate);
      if (target !== undefined) targets.push(target);
    }
  }
  return targets;
}
