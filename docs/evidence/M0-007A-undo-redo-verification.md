# M0-007A：房间创建原子 Undo/Redo 验证

日期：2026-08-11

## 发现的问题

初次人工验证中，房间创建使用 `scene/create-node` 的 `snapshot: false`，后续属性写入和最终 `scene/snapshot` 没有把新节点创建纳入同一条完整 Undo。一次撤销只能回退部分属性，节点仍留在场景中；再次创建还会产生重复稳定实例 ID 风险。

## 最小修复

- `src/shared/editor-scene.ts` 封装 Cocos 3.8.8 公开 `scene/begin-recording`、`end-recording`、`cancel-recording`。
- `src/rooms/room-scene-authoring.ts` 在创建前以已存在的 RoomRoot 开始录制；节点创建、Prefab 关联校验和实例属性写入完成后一次提交。
- 失败路径先删除临时节点，再取消录制；不提交半成品 Undo。
- 扩展自动测试新增公开录制消息封装和调用顺序覆盖；本轮扩展完整测试 71/71 通过。

## Creator 3.8.8 人工结果

1. 在 `scene-2d.scene` 选择“房间容器”，停靠的“星舰创作工具”自动联动到房间建筑页。
2. 从自动发现的“反应堆”资源创建房间，生成真实 Prefab 节点 `房间-反应堆-001`，实例 ID 为 `room-reactor-2`，场景标题出现 `*`。
3. 通过“编辑 → 撤销”执行一次 Undo：新节点整体消失，层级恢复为一个房间，场景标题不再带 `*`。
4. 通过“编辑 → 重做”执行一次 Redo：`房间-反应堆-001` 整体恢复，场景重新标记为已修改。
5. 验证完成后再次 Undo；测试场景回到磁盘的一房间干净状态，没有保存临时节点。

## 持久截图

- 创建成功、Prefab Inspector 与 `room-reactor-2`：[`M0-007A-undo-redo-created.jpg`](M0-007A-undo-redo-created.jpg)
- 一次 Undo 后节点删除且标题无 `*`：[`M0-007A-undo-after-fix.jpg`](M0-007A-undo-after-fix.jpg)
- 一次 Redo 后节点恢复且标题重新带 `*`：[`M0-007A-redo-after-fix.jpg`](M0-007A-redo-after-fix.jpg)
- 现有标准语义骨架（含旧英文别名兼容）与停靠面板：[`M0-007A-chinese-skeleton.jpg`](M0-007A-chinese-skeleton.jpg)

结论：M0-007A 中“可停靠面板、标准骨架、自动列表、真实 Prefab、一次 Undo/Redo 截图和全中文新骨架截图”已满足；关闭插件回归已由 [`M0-007A-plugin-disabled-regression.md`](M0-007A-plugin-disabled-regression.md) 单独完成。
