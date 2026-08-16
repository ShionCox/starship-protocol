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
import { CSV_CONFIG_DIRECTORY, CSV_CONFIG_TABLES, type CsvConfigTableName } from './config-csv';

const PROPERTY_BY_TABLE: Readonly<Record<CsvConfigTableName, string>> = {
  'game.csv': 'game',
  'hulls.csv': 'hulls',
  'rooms.csv': 'rooms',
  'connector-ports.csv': 'connectorPorts',
  'floors.csv': 'floors',
  'crews.csv': 'crews',
  'crew-traits.csv': 'crewTraits',
  'visuals.csv': 'visuals',
  'visual-frames.csv': 'visualFrames',
};

/** 把九张运行时权威 CSV 作为 TextAsset 持久绑定到当前打开 Prefab 的根节点；编辑器 Prefab 映射表不进入运行时组件。 */
export async function bindCsvConfigSourceToNode(
  assetDb: AssetDbPort,
  scene: SceneQueryPort,
  nodeUuid: string,
  options: { readonly record?: boolean } = {},
): Promise<SceneComponentTarget> {
  const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
  let target = findComponentOnNode(await scene.queryNodeTree(), nodeUuid, 'GameConfigCsvSource', classes);
  if (target === null) {
    await scene.createComponent(nodeUuid, 'GameConfigCsvSource');
    target = await waitForComponentOnNode(scene, nodeUuid, 'GameConfigCsvSource');
  }
  if (target === null) throw new Error('无法挂载权威 CSV 来源组件');
  for (const table of CSV_CONFIG_TABLES) {
    const url = `${CSV_CONFIG_DIRECTORY}/${table}`;
    const uuid = await assetDb.queryUuid(url);
    if (uuid === '') throw new Error(`权威配置表尚未由 Creator 导入：${table}`);
    const property = PROPERTY_BY_TABLE[table];
    if (!(await scene.setProperty(target, property, { type: 'cc.TextAsset', uuid }, options))) {
      throw new Error(`无法绑定权威配置表：${table}`);
    }
  }
  const valid = await scene.executeComponentMethod(target.uuid, 'invalidateAuthoringCache', []);
  if (valid !== true) throw new Error('九张权威 CSV 未通过运行时同源校验');
  return target;
}

async function waitForComponentOnNode(scene: SceneQueryPort, nodeUuid: string, type: string): Promise<SceneComponentTarget | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const classes = scene.queryComponents === undefined ? [] : await scene.queryComponents().catch(() => []);
    const target = findComponentOnNode(await scene.queryNodeTree(), nodeUuid, type, classes);
    if (target !== null) return target;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function findComponentOnNode(
  tree: SceneNodeTree,
  nodeUuid: string,
  type: string,
  classes: readonly SceneComponentClassInfo[],
): SceneComponentTarget | null {
  const node = flattenTree(tree).find((entry) => entry.uuid === nodeUuid);
  if (node === undefined) return null;
  for (const [index, component] of (node.components ?? []).entries()) {
    const candidate: SceneComponentInfo = { ...component, nodeUuid, index: component.index ?? index };
    if (componentTypeMatches(candidate, type, classes)) return getSceneComponentTarget(candidate) ?? null;
  }
  return null;
}

function flattenTree(root: SceneNodeTree): SceneNodeTree[] {
  const result: SceneNodeTree[] = [];
  const visit = (node: SceneNodeTree): void => { result.push(node); for (const child of node.children ?? []) visit(child); };
  visit(root);
  return result;
}
