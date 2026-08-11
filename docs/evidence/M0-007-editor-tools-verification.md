# M0-007 插件化房间创作自动验证

日期：2026-08-09（当前实现复核：2026-08-11）

## 实现证据

- `assets/config/rooms/room-reactor.json`：版本化反应堆规则唯一数据源。
- `assets/scripts/game-core/RoomDefinition.ts`：纯 TypeScript 不可信 JSON 解析和字段校验，无 `cc`、DOM、Node API。
- `RoomView`：通过中文“房间定义”JsonAsset 属性读取规则，编辑器预览宽高不再保存副本。
- `PrototypeBootstrap`：逐个解析 RoomView 定义并按各自尺寸装配、恢复和绑定，不再硬编码反应堆规则。
- `extensions/starship-editor-tools/`：一个插件宿主、一个房间领域模块；资源菜单打开原生中文 Panel，使用公开 Asset DB 消息创建 JSON 与复制 Prefab；当前源包版本为 v1.3.0。
- 多资源写入先创建 JSON、再复制 Prefab；复制失败删除本次 JSON，回滚失败保留可观察错误。

## 已执行自动验证

### GameCore

```text
npm run test:core
tests 24
pass 24
fail 0
```

覆盖合法定义、未知版本、非法 ID、缺失名称、未知分类、非整数尺寸、非法数值，以及既有网格、移动、快照和有效船体格分支。

### Cocos 编辑器扩展

在 `extensions/starship-editor-tools/` 执行：

```text
npm test
tests 46
pass 46
fail 0
```

覆盖菜单聚合和目录传递、非法路径、非法名称、重名拒绝、JSON + Prefab 成功创建、Prefab 复制失败回滚、回滚失败可观察、RoomView 定义绑定、公开 Selection、标准骨架、真实 Prefab 关联、房间实例回滚，以及公开原子 Undo 录制。

### TypeScript 与边界

```text
Cocos 3.8.8 内置 tsc --project tsconfig.json --noEmit --skipLibCheck
exit 0

Cocos 3.8.8 内置 tsc --strict（RoomDefinition + ShipGridModel）
exit 0
```

- 根 `tsconfig.json` 明确排除 `extensions/` 和 `tests/`，避免 Cocos 把编辑器 Node 代码与 Node 测试导入游戏脚本。
- 扩展源码未发现私有 `cce.*`、直接 `.scene` / `.meta` 写入、`fs.writeFile` 或手工 Prefab 序列化。
- `assets/` 未引用 `starship-editor-tools` 或 `extensions/`，插件不进入运行时依赖。

## Cocos 人工证据

- [x] 历史截图记录扩展管理器识别并启用 `starship-editor-tools v1.1.0`；当前源包版本为 v1.3.0。证据：[`M0-007-extension-manager-enabled.jpg`](M0-007-extension-manager-enabled.jpg)；历史禁用回归后的恢复启用截图见 [`M0-007-extension-manager-reenabled.jpg`](M0-007-extension-manager-reenabled.jpg)。
- [x] 资源管理器“新建 → 星舰协议 → 新建房间建筑…”可打开中文表单。证据：[`M0-007-editor-plugin-menu.png`](M0-007-editor-plugin-menu.png)、[`M0-007-editor-plugin-form.png`](M0-007-editor-plugin-form.png)。
- [x] 表单成功创建一组 JSON + Prefab，且重复创建不会覆盖。证据：[`M0-007-editor-plugin-create-success.png`](M0-007-editor-plugin-create-success.png)、[`M0-007-editor-plugin-no-overwrite.png`](M0-007-editor-plugin-no-overwrite.png)；验收用临时资源随后已删除。
- [x] ReactorRoom Prefab 的 RoomView 绑定 `room-reactor.json` 后，无需运行即可显示 2×2 外观。证据：[`M0-007-editor-prefab-definition-binding.png`](M0-007-editor-prefab-definition-binding.png)、[`M0-007-editor-cold-reopen-two-rooms.png`](M0-007-editor-cold-reopen-two-rooms.png)。
- [x] 两个场景实例保留唯一实例 ID，运行、拖动、保存和刷新恢复正常。证据：[`M0-007-two-rooms-runtime.png`](M0-007-two-rooms-runtime.png)、[`M0-011-two-room-refresh-restored.png`](M0-011-two-room-refresh-restored.png)。
- [x] 禁用插件后，Web Desktop 仍可构建和运行。历史证据见 [`M0-007-plugin-disabled-build-verification.md`](M0-007-plugin-disabled-build-verification.md)；当前复核见 [`M0-007A-plugin-disabled-regression.md`](M0-007A-plugin-disabled-regression.md)。

M0-007 的实现、自动验证和 Cocos/Web 人工门禁均已完成，可在 R0 清单勾选。
