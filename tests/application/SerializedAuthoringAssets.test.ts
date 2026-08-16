import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CSV_FIELDS = [
  'game',
  'hulls',
  'rooms',
  'connectorPorts',
  'floors',
  'crews',
  'crewTraits',
  'visuals',
  'visualFrames',
] as const;

test('Main 与 Battle 持久保存唯一应用根 CSV 来源并让所有 ShipView 同源', () => {
  assertSceneConfigOwnership('MainScene.scene', 1);
  assertSceneConfigOwnership('BattleScene.scene', 2);
});

test('领域 Prefab 不再持有九表来源，ShipView 模板等待场景接线', () => {
  for (const name of [
    'ShipView.prefab',
    'ElevatorRoom.prefab',
    'ReactorRoom.prefab',
    'LaserRoom.prefab',
    'ShieldRoom.prefab',
    'MedicalRoom.prefab',
    'StairsRoom.prefab',
    'EngineerCrew.prefab',
    'GunnerCrew.prefab',
    'MedicCrew.prefab',
    'SoldierCrew.prefab',
  ]) {
    const data = readAsset(`../../assets/prefabs/${name}`);
    assert.equal(findCsvSources(data).length, 0, `${name} 不得保存本地九表来源`);
  }

  const shipView = readAsset('../../assets/prefabs/ShipView.prefab');
  const shipComponent = shipView.find((value) => isRecord(value) && 'shipId' in value && 'hullDefinitionId' in value);
  assert.ok(shipComponent && shipComponent.configSource === null, 'ShipView 模板必须等待场景应用根接线');
});

test('五个房间与四个 Crew Prefab 持久保存 SpriteFrame 和 AnimationClip', () => {
  const roomExpectations = new Map([
    ['ElevatorRoom.prefab', 'STATIC'],
    ['ReactorRoom.prefab', 'ALWAYS_LOOP'],
    ['LaserRoom.prefab', 'POWERED_LOOP'],
    ['ShieldRoom.prefab', 'POWERED_LOOP'],
    ['MedicalRoom.prefab', 'STATIC'],
  ] as const);
  for (const [name, mode] of roomExpectations) {
    const appearance = readAsset(`../../assets/prefabs/${name}`).find(
      (value) => isRecord(value) && 'mode' in value && 'sourceTexture' in value && 'staticFrame' in value,
    );
    assert.ok(appearance && isAssetReference(appearance.staticFrame), `${name} 缺少持久 SpriteFrame`);
    if (mode === 'ALWAYS_LOOP') assert.ok(isAssetReference(appearance.alwaysLoopClip), `${name} 缺少常驻 AnimationClip`);
    if (mode === 'POWERED_LOOP') assert.ok(isAssetReference(appearance.poweredClip), `${name} 缺少供电 AnimationClip`);
  }

  for (const name of ['EngineerCrew.prefab', 'GunnerCrew.prefab', 'MedicCrew.prefab', 'SoldierCrew.prefab']) {
    const appearance = readAsset(`../../assets/prefabs/${name}`).find(
      (value) => isRecord(value) && 'idleClip' in value && 'movingClip' in value && 'taskClip' in value,
    );
    assert.ok(appearance, `${name} 缺少 CrewAppearance`);
    for (const field of ['idleClip', 'movingClip', 'taskClip'] as const) {
      assert.ok(isAssetReference(appearance[field]), `${name}.${field} 未持久绑定`);
    }
    for (const field of ['idleFrames', 'movingFrames', 'taskFrames'] as const) {
      assert.equal(Array.isArray(appearance[field]) ? appearance[field].length : 0, 2, `${name}.${field} 必须有两帧`);
    }
  }
});

function assertSceneConfigOwnership(name: string, expectedShipCount: number): void {
  const data = readAsset(`../../assets/scenes/${name}`);
  const sources = findCsvSources(data);
  assert.equal(sources.length, 1, `${name} 必须恰好保存一个九表来源`);
  const sourceIndex = sources[0];
  const source = data[sourceIndex];
  assert.ok(isRecord(source) && isIdReference(source.node), `${name} 九表来源缺少所属节点`);
  const appRoot = data[source.node.__id__];
  assert.ok(isRecord(appRoot) && appRoot._name === '应用根', `${name} 九表来源必须挂在应用根`);
  for (const field of CSV_FIELDS) assert.ok(isAssetReference(source[field]), `${name}.${field} 未持久绑定`);

  const overrides = data.filter(
    (value) => isRecord(value) && Array.isArray(value.propertyPath) && value.propertyPath[0] === 'configSource',
  );
  assert.equal(overrides.length, expectedShipCount, `${name} ShipView 来源接线数量错误`);
  for (const override of overrides) {
    assert.ok(isIdReference(override.value) && override.value.__id__ === sourceIndex, `${name} ShipView 未指向应用根来源`);
  }
}

function readAsset(relativePath: string): unknown[] {
  const value: unknown = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
  assert.ok(Array.isArray(value), `${relativePath} 必须是 Creator 序列化数组`);
  return value;
}

function findCsvSources(data: readonly unknown[]): number[] {
  return data.flatMap((value, index) =>
    isRecord(value) && CSV_FIELDS.every((field) => field in value) ? [index] : [],
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAssetReference(value: unknown): value is { readonly __uuid__: string } {
  return isRecord(value) && typeof value.__uuid__ === 'string' && value.__uuid__.length > 0;
}

function isIdReference(value: unknown): value is { readonly __id__: number } {
  return isRecord(value) && Number.isInteger(value.__id__);
}
