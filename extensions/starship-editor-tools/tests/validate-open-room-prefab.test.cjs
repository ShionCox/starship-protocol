const assert = require('node:assert/strict');
const test = require('node:test');

const {
  findRoomComponentUuids,
  validateOpenRoomPrefab,
} = require('../dist/rooms/validate-open-room-prefab.js');

test('递归查找当前编辑内容中的 RoomView 组件', () => {
  assert.deepEqual(findRoomComponentUuids({
    children: [
      { components: [{ type: 'cc.UITransform', value: 'a' }] },
      { components: [{ type: 'RoomView', value: 'room-view-1' }] },
    ],
  }), ['room-view-1']);
});

test('缺少 RoomView 时返回可执行提示', async () => {
  const result = await validateOpenRoomPrefab({
    async queryNodeTree() { return { name: 'Scene' }; },
    async validateRoomComponent() { throw new Error('不应调用'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /没有 RoomView/);
});

test('聚合 RoomView 的定义绑定校验结果', async () => {
  const result = await validateOpenRoomPrefab({
    async queryNodeTree() {
      return {
        components: [
          { type: 'RoomView', value: 'valid' },
          { type: 'RoomView', value: 'invalid' },
        ],
      };
    },
    async validateRoomComponent(uuid) {
      return uuid === 'valid'
        ? { ok: true, message: '定义有效' }
        : { ok: false, message: '定义 ID 不匹配' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, '定义 ID 不匹配');
});
