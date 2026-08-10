const assert = require('node:assert/strict');
const test = require('node:test');

const {
  editorSceneQuery,
  getSceneComponentTarget,
  normalizeSceneNodeTree,
} = require('../dist/shared/editor-scene.js');

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
