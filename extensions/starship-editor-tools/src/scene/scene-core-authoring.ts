import { isPrototypeSceneNodeName } from './prototype-scene-names';
import {
  componentTypeMatches,
  getSceneComponentTarget,
  type SceneComponentClassInfo,
  type SceneComponentInfo,
  type SceneComponentTarget,
  type SceneNodeTree,
  type SceneQueryPort,
} from '../shared/editor-scene';

export interface SceneCoreSettingsRequest {
  readonly gridColumns: number;
  readonly gridRows: number;
  readonly cellSize: number;
  readonly snapRoomsInEditor: boolean;
  readonly minScale: number;
  readonly maxScale: number;
  readonly zoomStep: number;
}

export interface SceneCoreSettingsResult {
  readonly ok: boolean;
  readonly message: string;
  readonly changed: boolean;
}

export function validateSceneCoreSettings(request: SceneCoreSettingsRequest): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (!Number.isInteger(request.gridColumns) || request.gridColumns <= 0) return { ok: false, message: '网格列数必须是正整数' };
  if (!Number.isInteger(request.gridRows) || request.gridRows <= 0) return { ok: false, message: '网格行数必须是正整数' };
  if (!Number.isInteger(request.cellSize) || request.cellSize <= 0) return { ok: false, message: '格子尺寸必须是正整数' };
  if (!Number.isFinite(request.minScale) || request.minScale <= 0) return { ok: false, message: '最小缩放必须是正数' };
  if (!Number.isFinite(request.maxScale) || request.maxScale <= 0 || request.maxScale < request.minScale) return { ok: false, message: '最大缩放必须不小于最小缩放' };
  if (!Number.isFinite(request.zoomStep) || request.zoomStep <= 0) return { ok: false, message: '缩放步长必须是正数' };
  if (typeof request.snapRoomsInEditor !== 'boolean') return { ok: false, message: '自动吸附必须是布尔值' };
  return { ok: true };
}

/**
 * 通过公开 Scene API 写入 AppRoot 核心参数。所有写入先校验并保留旧值，
 * 任一步失败都会反向写回并放弃快照，成功时只生成一次 Undo 记录。
 */
export async function updateSceneCoreSettings(
  scene: SceneQueryPort,
  selectedUuid: string | undefined,
  request: SceneCoreSettingsRequest,
): Promise<SceneCoreSettingsResult> {
  const validation = validateSceneCoreSettings(request);
  if (!validation.ok) return { ...validation, changed: false };
  try {
    return await updateSceneCoreSettingsInternal(scene, selectedUuid, request);
  } catch (error) {
    return { ok: false, changed: false, message: `读取场景配置失败：${error instanceof Error ? error.message : String(error)}` };
  }
}

async function updateSceneCoreSettingsInternal(
  scene: SceneQueryPort,
  selectedUuid: string | undefined,
  request: SceneCoreSettingsRequest,
): Promise<SceneCoreSettingsResult> {
  if (selectedUuid === undefined) return { ok: false, changed: false, message: '请先选择 AppRoot' };
  const tree = await scene.queryNodeTree();
  const selected = flattenTree(tree).find((node) => node.uuid === selectedUuid);
  if (selected === undefined) return { ok: false, changed: false, message: '当前选择已变化，请重新选择 AppRoot' };
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents();
  const settingsComponent = findComponent(selected, 'PrototypeSceneSettings', classes);
  const cameraComponent = findComponent(selected, 'CameraController', classes);
  const settingsTarget = getSceneComponentTarget(settingsComponent);
  const cameraTarget = getSceneComponentTarget(cameraComponent);
  if (settingsTarget === undefined || cameraTarget === undefined || !isPrototypeSceneNodeName(selected.name, 'appRoot')) {
    return { ok: false, changed: false, message: '当前选择不是包含完整场景配置的 AppRoot' };
  }

  const settingsValue = await readComponent(scene, settingsTarget.uuid);
  const cameraValue = await readComponent(scene, cameraTarget.uuid);
  const operations = [
    operation(settingsTarget, 'gridColumns', request.gridColumns, readNumber(settingsValue, 'gridColumns'), '网格列数'),
    operation(settingsTarget, 'gridRows', request.gridRows, readNumber(settingsValue, 'gridRows'), '网格行数'),
    operation(settingsTarget, 'cellSize', request.cellSize, readNumber(settingsValue, 'cellSize'), '格子尺寸'),
    operation(settingsTarget, 'snapRoomsInEditor', request.snapRoomsInEditor, readBoolean(settingsValue, 'snapRoomsInEditor'), '自动吸附'),
    operation(cameraTarget, 'minScale', request.minScale, readNumber(cameraValue, 'minScale'), '最小缩放'),
    operation(cameraTarget, 'maxScale', request.maxScale, readNumber(cameraValue, 'maxScale'), '最大缩放'),
    operation(cameraTarget, 'zoomStep', request.zoomStep, readNumber(cameraValue, 'zoomStep'), '缩放步长'),
  ];
  const missing = operations.find((item) => item.current === undefined);
  if (missing !== undefined) return { ok: false, changed: false, message: `无法读取${missing.label}当前值，未写入任何属性` };
  const changed = operations.filter((item) => item.current !== item.next);
  if (changed.length === 0) return { ok: true, changed: false, message: '核心参数没有变化' };

  const applied: typeof changed = [];
  try {
    for (const item of changed) {
      if (!(await scene.setProperty(item.target, item.path, item.next))) throw new Error(`写入${item.label}失败`);
      applied.push(item);
    }
    await scene.snapshot();
    return { ok: true, changed: true, message: `已保存 ${changed.length} 项场景核心参数` };
  } catch (error) {
    for (const item of applied.reverse()) {
      await scene.setProperty(item.target, item.path, item.current, { record: false }).catch(() => false);
    }
    await scene.snapshotAbort().catch(() => undefined);
    return { ok: false, changed: false, message: `${error instanceof Error ? error.message : String(error)}；已回滚场景参数` };
  }
}

interface SceneOperation {
  readonly target: SceneComponentTarget;
  readonly path: string;
  readonly next: number | boolean;
  readonly current: number | boolean | undefined;
  readonly label: string;
}

function operation(
  target: SceneComponentTarget,
  path: string,
  next: number | boolean,
  current: number | boolean | undefined,
  label: string,
): SceneOperation {
  return { target, path, next, current, label };
}

function findComponent(node: SceneNodeTree, type: string, classes: readonly SceneComponentClassInfo[]): SceneComponentInfo | null {
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate = { ...component, nodeUuid: component.nodeUuid ?? node.uuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return candidate;
  }
  return null;
}

function flattenTree(tree: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree, parent?: string): void => {
    result.push(node.parent === undefined && parent !== undefined ? { ...node, parent } : node);
    for (const child of node.children ?? []) visit(child, node.uuid);
  };
  visit(tree);
  return result;
}

async function readComponent(scene: SceneQueryPort, uuid: string): Promise<Record<string, unknown> | undefined> {
  const value = (await scene.queryComponent(uuid))?.value;
  const unwrapped = unwrap(value);
  return typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)
    ? unwrapped as Record<string, unknown>
    : undefined;
}

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = unwrap(record?.[key]);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = unwrap(record?.[key]);
  return typeof value === 'boolean' ? value : undefined;
}

function unwrap(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 4; index += 1) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !('value' in current)) return current;
    current = (current as { value: unknown }).value;
  }
  return current;
}
