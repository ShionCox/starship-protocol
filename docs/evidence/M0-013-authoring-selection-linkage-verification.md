# M0-013 创作工具选择联动与类型接入验证

> 历史证据（已冻结）：测试数量和 Prototype 创作链是当时结果，当前插件状态只看 `R1-FOUNDATION-CHECKLIST.md`。

日期：2026-08-12

## 已验证

- 扩展 `npm test`：71/71 通过，包含识别器、CID/中文别名、普通节点回退、定义缺失、AppRoot 参数校验、Prefab 关联验证、写入失败回滚和公开录制消息组成的单次原子 Undo。
- 根项目 `npm test`：GameCore 55/55、安全 9/9、安全 API 3/3 通过。
- Cocos Creator 3.8.8 构建发布面板于 2026-08-12 01:49:17 完成 Web Desktop 构建，产物包含 `build/web-desktop/index.html`。
- 独立 HTTP 服务加载 `http://127.0.0.1:7470/` 成功；刷新后场景、能源和船员位置恢复，当前构建页面日志无 Error/Warning。
- Creator 中选择 RoomRoot 后，停靠面板在 1 秒内显示对应路径；从房间列表创建真实 Prefab 后，一次 Undo 删除整个节点且一次 Redo 完整恢复。证据见 `M0-007A-undo-redo-verification.md`。

## 尚未验证

- Creator 编辑器内依次选择三个房间、AppRoot、中文/英文标准骨架和普通节点后的面板截图。
- Creator 原生 Inspector 与创作面板参数同步截图。
- Creator 原生 Inspector 与创作面板参数同步截图。

上述 Inspector 同步人工项目不能用自动测试、命令行构建或历史截图替代，完成前不勾选对应验收项；插件关闭后的重开、构建和运行回归已由 [`M0-007A-plugin-disabled-regression.md`](M0-007A-plugin-disabled-regression.md) 单独记录。
