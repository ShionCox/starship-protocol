# M0-010 / M0-011 JSON 保存与恢复自动验证

日期：2026-08-09

## 数据边界

- `schemaVersion` 固定为 `1`。
- 快照只包含 `gridWidth`、`gridHeight` 和房间的稳定 ID、整数逻辑坐标、逻辑尺寸。
- 快照不包含 Cocos Node、Prefab、Sprite、世界坐标或像素坐标。
- localStorage 访问只存在于 `PrototypeLayoutStorage` Web 适配层；GameCore 不引用 DOM 或浏览器 API。

## 自动测试

执行：

```text
npm run test:core
```

结果：16 项通过、0 项失败，退出码 0。

持久化相关覆盖：

- 布局 JSON 往返后房间状态一致。
- JSON 中包含 `schemaVersion=1` 和稳定房间 ID。
- 损坏 JSON、未知版本、网格尺寸不匹配安全失败。
- 重叠、重复 ID、非整数坐标存档安全失败。
- 恢复先写临时网格，失败不会返回半恢复模型。
- 恢复时使用当前 SceneSettings 提供的有效船体格重新校验，旧存档不能绕过无效格。

## Cocos TypeScript 检查

使用 Cocos Creator 3.8.8 内置 TypeScript 5.8.2，对 GameCore、存储适配器、场景装配、房间表现、网格设置和镜头控制执行隔离 `--strict --noEmit` 检查。

结果：无输出，退出码 0。

## 浏览器运行证据

- 测试地址：`http://localhost:7456/`，设计分辨率 `1280×720`。
- 保存前置：AppRoot 已持久挂载 `PrototypeBootstrap`；房间拖到新的合法逻辑格并正常松开，截图：[`M0-010-browser-valid-drop-saved.png`](M0-010-browser-valid-drop-saved.png)。
- 刷新恢复：刷新页面后房间仍位于与保存截图相同的逻辑格，截图：[`M0-011-browser-refresh-restored.png`](M0-011-browser-refresh-restored.png)。
- 运行日志：刷新后捕获到 `[SAVE] 已从 localStorage 恢复 R0 飞船布局`，证明实际 Web 存储读取和恢复路径已执行。
- Console：保存、刷新和恢复完成后，`error` 与 `warning` 均为 0 条。
- 数据内容：存储键固定为 `starship-protocol:r0:ship-layout`；JSON 字段和禁止序列化对象的边界由本文件上方 16 项纯 TypeScript 测试与 `PrototypeLayoutStorage` 适配层共同验证。

## 补充异常验证

- 损坏 JSON、未知版本、网格不匹配、重复 ID 与重叠存档已由自动测试覆盖，均安全失败且不返回半恢复状态。
- 当前浏览器工具不写入页面 localStorage，因此未在真实预览中注入损坏数据；不影响正常保存与刷新恢复验收。
