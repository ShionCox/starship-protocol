const assert = require('node:assert/strict');
const test = require('node:test');

const {
  editorSceneQuery,
  getSceneComponentTarget,
  normalizeSceneNodeTree,
  readSceneReferenceUuid,
  saveAuthoringScene,
} = require('../dist/shared/editor-scene.js');
const { markCurrentAuthoringAsset } = require('../dist/shared/editor-asset-db.js');

test('归一化 Cocos INode 的 __comps__ 并保留 set-property 所需节点与索引', () => {
  const tree = normalizeSceneNodeTree({
    uuid: 'scene',
    name: { value: 'PrototypeScene' },
    __comps__: [],
    children: [{
      uuid: 'grid-root',
      name: { value: 'GridRoot' },
      __comps__: [{ type: 'cc.UITransform', value: { uuid: { value: 'ui-transform' } } }],
      children: [],
    }],
  });
  const component = tree.children[0].components[0];
  assert.equal(component.type, 'cc.UITransform');
  assert.deepEqual(getSceneComponentTarget(component), {
    uuid: 'ui-transform',
    nodeUuid: 'grid-root',
    index: 0,
  });
});

test('从 Creator 多层属性 dump 中识别已有引用 UUID', () => {
  assert.equal(readSceneReferenceUuid({ uuid: 'direct' }), 'direct');
  assert.equal(readSceneReferenceUuid({ value: { uuid: 'nested' } }), 'nested');
  assert.equal(readSceneReferenceUuid({ value: { __uuid__: 'asset' } }), 'asset');
  assert.equal(readSceneReferenceUuid({ value: { uuid: { value: 'wrapped' } } }), 'wrapped');
  assert.equal(readSceneReferenceUuid({ value: null }), undefined);
});

test('Scene 属性写入失败会报告精确组件路径', async () => {
  global.Editor = { Message: { request: async () => { throw new Error('decodePatch'); } } };
  try {
    await assert.rejects(
      editorSceneQuery.setProperty({ uuid: 'router', nodeUuid: 'main-screen', index: 1 }, 'mainMenuPage', { type: 'cc.Node', uuid: 'page' }),
      /Creator 写入属性失败（__comps__\.1\.mainMenuPage）：decodePatch/,
    );
  } finally {
    delete global.Editor;
  }
});

test('组件属性通过公开 Scene 消息写入 __comps__ 路径和引用 dump', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  await editorSceneQuery.setProperty(
    { uuid: 'settings', nodeUuid: 'app-root', index: 2 },
    'gridRoot',
    { type: 'cc.Node', uuid: 'grid-root' },
  );
  assert.deepEqual(calls[0], ['scene', 'set-property', {
    uuid: 'app-root',
    path: '__comps__.2.gridRoot',
    dump: { type: 'cc.Node', value: { uuid: 'grid-root' } },
    record: true,
  }]);
  delete global.Editor;
});

test('场景回滚可显式关闭 Undo 记录', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  await editorSceneQuery.setProperty('node', 'position', { x: 0, y: 0, z: 0 }, { record: false });
  assert.equal(calls[0][2].record, false);
  delete global.Editor;
});

test('颜色属性通过公开 Scene 消息保留 cc.Color 类型 dump', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return true; } } };
  await editorSceneQuery.setProperty(
    { uuid: 'room-view', nodeUuid: 'room', index: 2 },
    'fillColor',
    { type: 'cc.Color', value: { r: 170, g: 45, b: 55, a: 245 } },
  );
  assert.deepEqual(calls[0][2].dump, { type: 'cc.Color', value: { r: 170, g: 45, b: 55, a: 245 } });
  delete global.Editor;
});

test('公开 recording 消息组成单次原子 Undo', async () => {
  const calls = [];
  global.Editor = { Message: { request: async (...args) => { calls.push(args); return args[1] === 'begin-recording' ? 'undo-1' : undefined; } } };
  const undoId = await editorSceneQuery.beginRecording('room-root');
  await editorSceneQuery.endRecording(undoId);
  await editorSceneQuery.cancelRecording(undoId);
  assert.deepEqual(calls, [
    ['scene', 'begin-recording', 'room-root'],
    ['scene', 'end-recording', 'undo-1'],
    ['scene', 'cancel-recording', 'undo-1'],
  ]);
  delete global.Editor;
});

test('自定义组件挂载后查询节点，失效 CID 自动回退 className', async () => {
  const calls = [];
  let attempts = 0;
  global.Editor = { Message: { request: async (...args) => {
    calls.push(args);
    if (args[1] === 'query-components') return [{ name: 'FloorView', cid: 'stale-floor-cid', path: 'FloorView' }];
    if (args[1] === 'create-component') { attempts += 1; return undefined; }
    if (args[1] === 'query-node') return {
      uuid: 'floor-node',
      __comps__: attempts < 2 ? [] : [{ type: 'FloorView', value: { uuid: { value: 'floor-view' } } }],
      children: [],
    };
    return undefined;
  } } };
  await editorSceneQuery.createComponent('floor-node', 'FloorView');
  assert.deepEqual(calls.filter((call) => call[1] === 'create-component').map((call) => call[2].component), [
    'stale-floor-cid',
    'FloorView',
  ]);
  delete global.Editor;
});

test('Prefab 切换后的瞬时文件占用会有限重试保存', async () => {
  const calls = [];
  let failures = 2;
  global.Editor = { Message: { request: async (...args) => {
    calls.push(args);
    if (failures > 0) {
      failures -= 1;
      throw new Error("UNKNOWN: unknown error, open 'EngineerCrew.prefab'");
    }
    return true;
  } } };
  try {
    await saveAuthoringScene({ quietMs: 0, retryDelayMs: 0 });
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => call[0] === 'scene' && call[1] === 'save-scene'));
  } finally {
    delete global.Editor;
  }
});

test('统一保存入口在 save-scene 前后等待当前编辑资源导入稳定', async () => {
  const calls = [];
  markCurrentAuthoringAsset('db://assets/scenes/MainScene.scene');
  global.Editor = { Message: { request: async (...args) => {
    calls.push(args);
    if (args[0] === 'asset-db' && args[1] === 'query-asset-info') {
      return { uuid: 'main-scene', url: args[2], imported: true, invalid: false };
    }
    if (args[0] === 'scene' && args[1] === 'save-scene') return true;
    throw new Error(`unexpected message ${args[0]}/${args[1]}`);
  } } };
  try {
    await saveAuthoringScene({ quietMs: 0, retryDelayMs: 0 });
    assert.deepEqual(calls.map((call) => [call[0], call[1]]), [
      ['asset-db', 'query-asset-info'],
      ['scene', 'save-scene'],
      ['asset-db', 'query-asset-info'],
    ]);
  } finally {
    markCurrentAuthoringAsset('');
    delete global.Editor;
  }
});

test('非文件占用类保存错误立即失败', async () => {
  let calls = 0;
  global.Editor = { Message: { request: async () => {
    calls += 1;
    throw new Error('场景结构校验失败');
  } } };
  try {
    await assert.rejects(saveAuthoringScene({ quietMs: 0, retryDelayMs: 0 }), /场景结构校验失败/);
    assert.equal(calls, 1);
  } finally {
    delete global.Editor;
  }
});
