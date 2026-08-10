# M0-009 拖放与预览自动验证

日期：2026-08-09

## 已验证

- `RoomView` 使用 Cocos `Node.EventType.MOUSE_DOWN / MOUSE_MOVE / MOUSE_UP` 与全局 `Input.EventType.MOUSE_UP` 接收运行时拖放输入。
- View 只生成 `MOVE_ROOM` Command；预检和提交通过 `PrototypeBootstrap` 注入纯 TypeScript `ShipGridModel`。
- `ShipGridModel.validateRoomMove()` 不修改状态；`moveRoom()` 只在校验通过后原子更新房间与占用，失败保留原状态。
- 房间拖动期间通过装配回调暂停 `CameraController` 镜头平移，拖动结束或组件禁用时恢复。
- Cocos 3.8.8 引擎自身的 UI 组件同样把 `EventMouse.getUILocation()` 交给 `UITransform` 做世界到节点坐标转换；当前拖放坐标路径与引擎用法一致。
- `ReactorRoom.prefab` 持久保存 `UITransform + Graphics + RoomView`；`RoomView` 不再用装饰器向场景实例自动补组件，缺少必需组件时输出可执行的中文错误。编辑器模板证据：[`M0-007-editor-prefab-definition-binding.png`](M0-007-editor-prefab-definition-binding.png)。
- 项目扩展 `extensions/starship-editor-tools` 使用官方 `contributions.assets.menu.createMenu` 与 `asset-db/copy-asset`，可从资源管理器“新建”菜单复制已验收的 `ReactorRoom.prefab` 模板；不复制 `.meta`，新资源 ID 由 AssetDB 生成。
- 快速拖动修复：房间节点接收拖动开始，Canvas 节点负责移动和正常抬起事件；删除会提前结束的 Canvas `MOUSE_LEAVE`，同时保留 Cocos 全局 `MOUSE_UP` 兜底 Canvas 外松开。Canvas 与全局抬起最终都进入同一个幂等结束函数，正常松开不再漏失，重复抬起也不会重复提交。
- 引擎核验：Cocos Creator 3.8 官方输入文档使用 `input.on/off(Input.EventType.MOUSE_UP, ...)`；3.8.8 Web 输入源把移动监听放在 GameCanvas、把抬起同时监听到 `window`，与当前混合监听方式一致。

## 自动测试结果

执行：

```text
npm run test:core
```

结果：当前完整套件 20 项通过、0 项失败，退出码 0；其中覆盖房间移动预检不改状态、合法移动原子更新、重叠移动失败回滚、不存在房间错误，以及恢复时按当前船体有效格重新校验。

执行 Cocos Creator 3.8.8 内置 TypeScript 5.8.2 隔离严格检查，包含：

- `PrototypeSceneSettings.ts`
- `RoomView.ts`
- `PrototypeBootstrap.ts`
- `CameraController.ts`
- `ShipGridModel.ts`
- `RoomDefinition.ts`

结果：无输出，退出码 0。

编辑器扩展现已迁移为 TypeScript `src → dist`；当前结构和创建事务验证统一记录在 `M0-007-editor-tools-verification.md`，不再使用旧的单文件复制脚本作为当前证据。

## 浏览器运行回归

测试地址：`http://localhost:7456/`，设计分辨率 `1280×720`。

- 修复前已复现：松开后房间仍保持绿色预览边框，证明拖动结束事件漏失。截图：[`M0-009-sticky-before-fix.png`](M0-009-sticky-before-fix.png)。
- 正常拖动：从原位置跨多个逻辑格拖动并松开，房间吸附到目标格，边框恢复正常黄色；再把鼠标移到远处，房间位置保持不变。截图：[`M0-009-normal-drop-released.png`](M0-009-normal-drop-released.png)。
- 快速拖动：用三个相距较远的采样点快速拖动并松开，再把鼠标移到其他位置，房间未继续跟随且边框为正常黄色。截图：[`M0-009-fast-drag-released.png`](M0-009-fast-drag-released.png)。
- 越界回滚：快速拖到画布右下越界位置并松开，房间回到上一次合法逻辑格，随后移动鼠标也不再粘着。截图：[`M0-009-invalid-edge-rollback.png`](M0-009-invalid-edge-rollback.png)。
- 无效船体格：SceneSettings 默认把左上角 2×2 标为无效格并用独立底色显示；拖入该区域松开后房间回到原合法格。截图：[`M0-009-invalid-hull-cells-visible.png`](M0-009-invalid-hull-cells-visible.png)、[`M0-009-invalid-hull-drop-rollback.png`](M0-009-invalid-hull-drop-rollback.png)。
- 输入协调：房间拖动结束后，在空白区域拖动可以继续平移镜头，滚轮也可以继续缩放，证明拖动锁已释放。截图：[`M0-009-camera-pan-after-room-drop.png`](M0-009-camera-pan-after-room-drop.png)、[`M0-009-camera-zoom-after-room-drop.png`](M0-009-camera-zoom-after-room-drop.png)。
- 镜头变换坐标：先平移并缩放 WorldRoot，再把房间跨格拖到新的合法位置，吸附和提交仍正确，Console 无错误；截图：[`M0-009-drag-after-camera-transform.png`](M0-009-drag-after-camera-transform.png)。
- 浏览器 Console：完成上述操作后读取 `error` 与 `warning`，结果均为 0 条。

## 拖放预览视觉验证

- 合法拖动过程显示绿色边框：[`M0-009-valid-green-preview.png`](M0-009-valid-green-preview.png)。
- 两个房间重叠时显示红色边框：[`M0-009-overlap-red-preview.png`](M0-009-overlap-red-preview.png)。
- 重叠位置松开后回到原合法格：[`M0-009-overlap-release-rollback.png`](M0-009-overlap-release-rollback.png)。
- 双房间快速拖动并松开后不再粘着：[`M0-009-two-room-fast-drag-released.png`](M0-009-two-room-fast-drag-released.png)。
