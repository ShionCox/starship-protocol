import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const roomViewSource = readFileSync(new URL('../../assets/scripts/presentation/RoomView.ts', import.meta.url), 'utf8');
const crewViewSource = readFileSync(new URL('../../assets/scripts/presentation/CrewView.ts', import.meta.url), 'utf8');
const shipViewSource = readFileSync(new URL('../../assets/scripts/presentation/ShipView.ts', import.meta.url), 'utf8');
const csvSource = readFileSync(new URL('../../assets/scripts/presentation/GameConfigCsvSource.ts', import.meta.url), 'utf8');
const mainBootstrapSource = readFileSync(new URL('../../assets/scripts/bootstrap/MainSceneBootstrap.ts', import.meta.url), 'utf8');
const battleBootstrapSource = readFileSync(new URL('../../assets/scripts/bootstrap/BattleSceneBootstrap.ts', import.meta.url), 'utf8');

test('房间视图清理定义预览覆盖并立即恢复权威 CSV 表现', () => {
  const method = extractClearMethod(roomViewSource);
  assert.match(method, /this\.authoringPreviewResult\s*=\s*null/);
  assert.match(method, /this\.editorPreviewSignature\s*=\s*''/);
  assert.match(method, /this\.editorRenderPositionSignature\s*=\s*''/);
  assert.match(method, /this\.refreshPreview\(\)/);
  assert.doesNotMatch(method, /save-scene|recording|undo/i);
});

test('船员视图清理定义预览覆盖并重新绑定权威 CSV 定义', () => {
  const method = extractClearMethod(crewViewSource);
  assert.match(method, /this\.authoringPreviewResult\s*=\s*null/);
  assert.match(method, /this\.previewSignature\s*=\s*''/);
  assert.match(method, /this\.resolveCrewDefinition\(\)/);
  assert.match(method, /this\.definition\s*=\s*authoritative\.ok\s*\?\s*authoritative\.definition\s*:\s*null/);
  assert.match(method, /this\.refreshEditorPreview\(\)/);
  assert.doesNotMatch(method, /save-scene|recording|undo/i);
});

test('飞船视图清理船体定义预览覆盖并立即重绘权威 CSV 网格', () => {
  const method = extractClearMethod(shipViewSource);
  assert.match(method, /this\.authoringPreviewResult\s*=\s*null/);
  assert.match(method, /this\.previewSignature\s*=\s*''/);
  assert.match(method, /this\.refreshGridPreview\(\)/);
  assert.doesNotMatch(method, /save-scene|recording|undo/i);
});

test('Creator 重建半绑定阶段保持静默，九张 CSV 齐备后再校验', () => {
  assert.match(csvSource, /public hasCompleteBinding\(\): boolean/);
  for (const source of [roomViewSource, crewViewSource, shipViewSource]) {
    assert.match(source, /hasCompleteBinding\(\)/);
    assert.match(source, /config-binding-pending/);
  }
  assert.match(roomViewSource, /EDITOR_NOT_IN_PREVIEW[\s\S]*config-binding-pending/);
  assert.match(shipViewSource, /EDITOR_NOT_IN_PREVIEW[\s\S]*config-binding-pending/);
});

test('权威 CSV 只由场景应用根持有，Room/Crew 从所属 ShipView 读取', () => {
  assert.doesNotMatch(roomViewSource, /public configSource\s*:/);
  assert.doesNotMatch(crewViewSource, /public configSource\s*:/);
  assert.match(roomViewSource, /this\.findShipView\(\)\?\.configSource/);
  assert.match(crewViewSource, /findOwningShipView\(this\.node\)\?\.configSource/);
  assert.match(shipViewSource, /public configSource: GameConfigCsvSource \| null/);
  assert.doesNotMatch(shipViewSource, /addComponent\(GameConfigCsvSource\)/);
  for (const source of [mainBootstrapSource, battleBootstrapSource]) {
    assert.match(source, /this\.getComponent\(GameConfigCsvSource\)/);
    assert.doesNotMatch(source, /getComponentsInChildren\(GameConfigCsvSource\)/);
  }
});

function extractClearMethod(source: string): string {
  const method = source.match(/public clearAuthoringDefinitionPreview\(\): void \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(method, 'View 必须提供 clearAuthoringDefinitionPreview()');
  return method;
}
