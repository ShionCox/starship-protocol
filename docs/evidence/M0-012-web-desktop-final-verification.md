# M0-012 Web Desktop 最终验收

日期：2026-08-09

## 构建

- Cocos Creator 3.8.8 构建任务：`platform=web-desktop`、`debug=false`、启动场景 `PrototypeScene.scene`。
- 实际结果：`2026-8-9 20:12:41 build success in 8 s!`。
- 产物入口：`build/web-desktop/index.html`。
- 截图：[`M0-012-web-desktop-build-success.png`](M0-012-web-desktop-build-success.png)。

## 正式产物运行

- 使用 `python -m http.server 7460 --directory build/web-desktop` 单独服务构建目录，不使用 Creator 7456 预览页代替正式产物。
- `http://localhost:7460/` 正常加载两间房与 20×10 网格；截图：[`M0-012-built-web-runtime.png`](M0-012-built-web-runtime.png)。
- 房间拖放成功：[`M0-012-built-web-drag.png`](M0-012-built-web-drag.png)。
- 滚轮缩放成功：[`M0-012-built-web-zoom.png`](M0-012-built-web-zoom.png)。
- 空白区域镜头平移成功：[`M0-012-built-web-pan.png`](M0-012-built-web-pan.png)。
- 刷新后两个房间恢复到保存前逻辑格：[`M0-012-built-web-refresh-restored.png`](M0-012-built-web-refresh-restored.png)。
- 另在 Microsoft Edge 的 Creator 预览页完成双房间、快速拖动、平移、缩放及镜头变换后拖动回归：[`M0-012-edge-camera-pan.png`](M0-012-edge-camera-pan.png)、[`M0-012-edge-camera-zoom.png`](M0-012-edge-camera-zoom.png)、[`M0-012-edge-drag-after-camera-transform.png`](M0-012-edge-drag-after-camera-transform.png)。

## Console 与自动验证

- 正式产物初次加载和刷新后读取浏览器日志：`error=[]`、`warning=[]`。
- Creator 预览新标签页干净启动：`error=[]`、`warning=[]`，并记录 `[SAVE] 已从 localStorage 恢复 R0 飞船布局`；截图：[`M0-012-clean-refresh-runtime.png`](M0-012-clean-refresh-runtime.png)。
- `npm test`：GameCore/配置 20 项、发布安全 5 项、FastAPI 安全接口 3 项全部通过。
- `extensions/starship-editor-tools/npm test`：TypeScript 构建和 10 项插件测试全部通过。
- Cocos 3.8.8 内置 TypeScript 严格检查退出码 0。
- Windows 启动器编译 smoke test 和 Cocos Native Windows CNG AES-GCM smoke test 均通过。

## 后续独立回归

M0-012 已完成。随后 M0-007 也完成了扩展管理器启用证据与插件关闭状态下的独立重新构建/运行回归，详见 [`M0-007-plugin-disabled-build-verification.md`](M0-007-plugin-disabled-build-verification.md)。
