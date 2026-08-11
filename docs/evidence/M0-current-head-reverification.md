# 当前 HEAD：R0 场景与 Web Desktop 重新验证

日期：2026-08-12

## 修复结论

- `PrototypeScene.scene` 当前保留一个 `ReactorRoom`，并通过 Creator 持久保存 `ElevatorRoom`、`LaserRoom` 和 `ShieldRoom`。
- 四个房间均保存为真实 `cc.PrefabInstance`，激光/护盾实例保留红色/青蓝色外观覆盖；不接受只复制组件、`_prefab: null` 的普通节点结果。
- 房间实例 ID 为 `room-reactor-1`、`room-elevator-1`、`room-laser-1`、`room-shield-1`，固定逻辑布局由编辑器位置转换得到。
- 关闭并重新打开 `PrototypeScene.scene` 后，房间容器、四个实例、位置和 Prefab 标识仍存在；UIRoot 下能源面板及两个 PowerRoomRow Prefab 实例、飞船根下船员层也仍存在。

Creator 证据：[`M0-current-prototype-scene-restored.jpg`](M0-current-prototype-scene-restored.jpg)。

## 实现边界

- `src/shared/editor-scene.ts` 使用 Cocos 3.8.8 公开 `scene/create-node` 参数 `assetUuid`、`type: 'cc.Prefab'` 和 `unlinkPrefab: false`，并封装公开 `scene/query-nodes-by-asset-uuid`。
- `src/rooms/room-scene-authoring.ts` 在公开 Undo 录制中创建节点并写入实例 ID；提交前确认新节点仍关联目标 Prefab，不匹配时删除节点并取消录制。
- 新增自动测试覆盖保留 Prefab 关联的成功路径、关联缺失时的节点删除与录制取消，以及公开录制消息顺序。

## 自动验证

```text
根目录 npm test：GameCore/应用核心 55/55，发布安全 9/9，安全 API 3/3，通过。
扩展目录 npm test：TypeScript 构建成功，71/71 通过。
extensions/starship-editor-tools/node_modules/.bin/tsc -p tsconfig.json --noEmit --skipLibCheck：退出码 0。
```

## Web Desktop 构建与浏览器回归

- Creator 3.8.8 构建发布面板：2026-08-12 01:49:17 `web-desktop` build success in 19 s。
- 构建入口：`build/web-desktop/index.html`。
- 独立服务：`python -m http.server 7470 --directory build/web-desktop`。
- `http://127.0.0.1:7470/` 实际验证：四房间、能源分配、船员移动/容量拒绝、刷新恢复、滚轮缩放和空白区域平移均正常。
- 当前页面日志过滤结果：仅正常 `LoadScene` 日志，Error/Warning `[]`。
- 非法船体格与回滚由 `ShipGridModel` 自动测试和既有持久截图继续覆盖；本轮未把会被镜头手势干扰的额外截图计入证据。

持久证据：

- 构建成功：[`M0-current-web-desktop-build-success.jpg`](M0-current-web-desktop-build-success.jpg)
- 构建产物初始运行：[`M0-current-built-web-runtime.jpg`](M0-current-built-web-runtime.jpg)
- 合法拖动：[`M0-current-built-web-drag.jpg`](M0-current-built-web-drag.jpg)
- 刷新恢复：[`M0-current-built-web-refresh-restored.jpg`](M0-current-built-web-refresh-restored.jpg)
- 镜头缩放：[`M0-current-built-web-zoom.jpg`](M0-current-built-web-zoom.jpg)
- 镜头平移：[`M0-current-built-web-pan.jpg`](M0-current-built-web-pan.jpg)

## M0-007A 原子 Undo/Redo 补充验证

- Creator 3.8.8 中创建 `room-reactor-2` 后，一次 Undo 删除整个 Prefab 节点并清除场景脏标记，一次 Redo 完整恢复节点。
- 验证后再次 Undo，`scene-2d.scene` 回到磁盘的一房间干净状态。
- 证据：[`M0-007A-undo-redo-verification.md`](M0-007A-undo-redo-verification.md)。

仍未完成：由插件新建/补齐的全中文标准骨架截图。关闭插件后的重新打开工程、构建和运行回归已完成，证据见 [`M0-007A-plugin-disabled-regression.md`](M0-007A-plugin-disabled-regression.md)。
