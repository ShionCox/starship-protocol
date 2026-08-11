import { DEFAULT_TEMPLATE_URL } from '../constants';
import type { AssetDbPort } from '../shared/editor-asset-db';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

export const CREW_MEMBER_TEMPLATE_URL = 'db://assets/prefabs/CrewMember.prefab';
export const POWER_ROOM_ROW_TEMPLATE_URL = 'db://assets/prefabs/PowerRoomRow.prefab';

export interface TemplateAuthoringResult {
  readonly ok: boolean;
  readonly message: string;
}

/** 通过公开 Asset DB 和 Scene API，把既有房间 Prefab 转换成船员模板。 */
export async function createCrewMemberTemplate(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
): Promise<TemplateAuthoringResult> {
  return await createConvertedTemplate(assetDb, scene, {
    targetUrl: CREW_MEMBER_TEMPLATE_URL,
    componentType: 'CrewView',
    ensureMethod: 'ensureAuthoringStructure',
    ensureArgs: [],
    successMessage: 'CrewMember.prefab 已通过 Creator 公共接口创建并保存',
  });
}

/** 通过公开 Asset DB 和 Scene API，建立可在场景中重复实例化的能源行模板。 */
export async function createPowerRoomRowTemplate(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
): Promise<TemplateAuthoringResult> {
  return await createConvertedTemplate(assetDb, scene, {
    targetUrl: POWER_ROOM_ROW_TEMPLATE_URL,
    componentType: 'PowerRoomRow',
    ensureMethod: 'ensureAuthoringPrefabStructure',
    ensureArgs: ['room-laser-1', '激光室'],
    successMessage: 'PowerRoomRow.prefab 已通过 Creator 公共接口创建并保存',
  });
}

/**
 * 把能源面板内的普通行替换为同一 PowerRoomRow Prefab 的两个关联实例。
 * 先创建并完成属性写入，再删除旧节点；任一步失败都取消单次 Undo，避免半份场景。
 */
export async function replacePowerRowsWithPrefab(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
): Promise<TemplateAuthoringResult> {
  const prefabUuid = await assetDb.queryUuid(POWER_ROOM_ROW_TEMPLATE_URL);
  if (prefabUuid === '') return { ok: false, message: '请先生成 PowerRoomRow.prefab' };
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  const tree = await scene.queryNodeTree();
  const panelNode = findNodeWithComponent(tree, 'PowerPanel', classes)?.node;
  if (panelNode?.uuid === undefined) return { ok: false, message: '当前场景没有持久化能源面板' };

  const oldRows = collectNodesWithComponent(panelNode, 'PowerRoomRow', classes);
  const created: string[] = [];
  const undoId = await scene.beginRecording(panelNode.uuid);
  try {
    for (const row of [
      { name: '能源行-激光室', roomId: 'room-laser-1', localPosition: { x: 0, y: 12 } },
      { name: '能源行-护盾室', roomId: 'room-shield-1', localPosition: { x: 0, y: -31 } },
    ] as const) {
      const result = await scene.createNode({
        parent: panelNode.uuid,
        name: row.name,
        assetUuid: prefabUuid,
        type: 'cc.Prefab',
        unlinkPrefab: false,
        snapshot: false,
      });
      if (result?.uuid === undefined) throw new Error(`无法创建 ${row.name}`);
      created.push(result.uuid);
      const target = await waitForComponentOnNode(scene, result.uuid, 'PowerRoomRow');
      if (target === null || !(await scene.setProperty(target, 'roomInstanceId', row.roomId, { record: false }))) {
        throw new Error(`无法绑定 ${row.name} 的房间实例标识`);
      }
      const positioned = await scene.executeComponentMethod(
        target.uuid,
        'applyAuthoringLocalPosition',
        [row.localPosition.x, row.localPosition.y],
      );
      if (positioned !== true) throw new Error(`无法设置 ${row.name} 的面板内位置`);
    }
    for (const oldRow of oldRows) {
      if (oldRow.uuid !== undefined && !created.includes(oldRow.uuid)) await scene.removeNode(oldRow.uuid);
    }
    await scene.endRecording(undoId);
    await Editor.Message.request('scene', 'save-scene');
    return { ok: true, message: '激光室和护盾室能源行已替换为 PowerRoomRow Prefab 关联实例' };
  } catch (cause) {
    for (const uuid of created) await scene.removeNode(uuid).catch(() => undefined);
    await scene.cancelRecording(undoId).catch(() => undefined);
    return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
  }
}

interface ConvertedTemplateOptions {
  readonly targetUrl: string;
  readonly componentType: 'CrewView' | 'PowerRoomRow';
  readonly ensureMethod: string;
  readonly ensureArgs: readonly unknown[];
  readonly successMessage: string;
}

async function createConvertedTemplate(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  options: ConvertedTemplateOptions,
): Promise<TemplateAuthoringResult> {
  if (await assetDb.queryUuid(options.targetUrl)) {
    return { ok: true, message: `${options.targetUrl.split('/').pop()} 已存在` };
  }
  if (await assetDb.copyAsset(DEFAULT_TEMPLATE_URL, options.targetUrl) === null) {
    return { ok: false, message: `无法复制模板资源：${options.targetUrl}` };
  }
  try {
    await Editor.Message.request('asset-db', 'open-asset', options.targetUrl);
    const roomTarget = await waitForComponent(scene, 'RoomView');
    if (roomTarget === null) throw new Error('复制出的 Prefab 中没有 RoomView，无法安全转换');
    await scene.executeComponentMethod(roomTarget.target.uuid, 'removeForAuthoringTemplateConversion', []);
    await waitForComponentRemoval(scene, 'RoomView');
    if (roomTarget.node.uuid === undefined) throw new Error('Prefab 根节点缺少 UUID');
    await scene.createComponent(roomTarget.node.uuid, options.componentType);
    const target = await waitForComponentOnNode(scene, roomTarget.node.uuid, options.componentType);
    if (target === null) throw new Error(`无法挂载 ${options.componentType}`);
    const ensured = await scene.executeComponentMethod(target.uuid, options.ensureMethod, options.ensureArgs);
    if (ensured !== true) throw new Error(`${options.componentType} 模板结构补齐失败`);
    await Editor.Message.request('scene', 'save-scene');
    return { ok: true, message: options.successMessage };
  } catch (cause) {
    await assetDb.deleteAsset(options.targetUrl).catch(() => null);
    return {
      ok: false,
      message: `${cause instanceof Error ? cause.message : String(cause)}；已回滚模板资源`,
    };
  }
}

async function waitForComponent(
  scene: SceneQueryPort,
  type: string,
): Promise<{ readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
    const found = findNodeWithComponent(await scene.queryNodeTree(), type, classes);
    if (found !== null) return found;
    await delay();
  }
  return null;
}

async function waitForComponentOnNode(
  scene: SceneQueryPort,
  nodeUuid: string,
  type: string,
): Promise<SceneComponentTarget | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
    const node = findNodeByUuid(await scene.queryNodeTree(), nodeUuid);
    const target = node === null ? null : getComponentTarget(node, type, classes);
    if (target !== null) return target;
    await delay();
  }
  return null;
}

async function waitForComponentRemoval(scene: SceneQueryPort, type: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
    if (findNodeWithComponent(await scene.queryNodeTree(), type, classes) === null) return;
    await delay();
  }
  throw new Error(`${type} 未从模板中移除`);
}

function findNodeWithComponent(
  tree: SceneNodeTree,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): { readonly node: SceneNodeTree; readonly target: SceneComponentTarget } | null {
  const target = getComponentTarget(tree, type, classes);
  if (target !== null) return { node: tree, target };
  for (const child of tree.children ?? []) {
    const found = findNodeWithComponent(child, type, classes);
    if (found !== null) return found;
  }
  return null;
}

function collectNodesWithComponent(
  tree: SceneNodeTree,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  if (getComponentTarget(tree, type, classes) !== null) result.push(tree);
  for (const child of tree.children ?? []) result.push(...collectNodesWithComponent(child, type, classes));
  return result;
}

function getComponentTarget(
  node: SceneNodeTree,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): SceneComponentTarget | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate: SceneComponentInfo = {
      ...component,
      nodeUuid: component.nodeUuid ?? node.uuid,
      index: component.index ?? index,
    };
    if (componentTypeMatches(candidate, type, classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  return null;
}

function findNodeByUuid(tree: SceneNodeTree, uuid: string): SceneNodeTree | null {
  if (tree.uuid === uuid) return tree;
  for (const child of tree.children ?? []) {
    const found = findNodeByUuid(child, uuid);
    if (found !== null) return found;
  }
  return null;
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}
