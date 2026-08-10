# M0-013 创作工具选择联动与类型接入验证

日期：2026-08-11

## 已验证

- 扩展 `npm test`：39/39 通过，包含识别器、CID/中文别名、普通节点回退、定义缺失、AppRoot 参数校验、写入失败回滚和单次 Undo 快照逻辑。
- 根项目 `npm test`：GameCore 24/24、安全 9/9、安全 API 3/3 通过。
- Cocos Creator 3.8.8 命令行 Web Desktop 构建成功，产物包含 `build/web-desktop/index.html`。
- 本地浏览器加载 `http://localhost:7456/` 成功；刷新后场景恢复，房间拖放与镜头缩放操作后 Console 无 Error/Warning。

## 尚未验证

- Creator 编辑器内依次选择三个房间、AppRoot、中文/英文标准骨架和普通节点后的面板截图。
- Creator 原生 Inspector 与创作面板参数同步，以及一次 Undo/Redo 后的人工截图。
- 插件关闭后在同一 Creator 会话中的运行回归截图。

上述人工项目不能用自动测试、命令行构建或历史截图替代，完成前不勾选对应验收项。

