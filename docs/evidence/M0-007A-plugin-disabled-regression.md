# M0-007A：关闭插件后的工程回归证据

日期：2026-08-11

## 验证范围

本回归确认 `starship-editor-tools` 关闭时，Creator 工程、Web Desktop 构建和运行时仍可独立工作。编辑器创作面板本身不属于运行时依赖。

## 实际步骤与结果

1. 在 Cocos Creator 3.8.8 扩展管理器中关闭 `starship-editor-tools`。
   证据：[`M0-007A-plugin-disabled.jpg`](M0-007A-plugin-disabled.jpg)。
2. 关闭并重新打开工程，打开 `scene-2d.scene`。
   场景可正常加载；插件菜单/面板不再出现；没有阻断性错误。
   证据：[`M0-007A-plugin-disabled-reopen.jpg`](M0-007A-plugin-disabled-reopen.jpg)。
3. 从 Creator 构建发布面板执行 Web Desktop 构建。
   结果：`2026-08-11 12:01:45 build success in 12 s!`。
   证据：[`M0-007A-plugin-disabled-build-success.jpg`](M0-007A-plugin-disabled-build-success.jpg)。
4. 使用独立 HTTP 服务启动 `build/web-desktop`，打开 `http://127.0.0.1:7460/`。
   首屏显示两个房间，拖动房间后位置更新；刷新页面后位置仍恢复；浏览器 Console 的 Error/Warning 过滤结果为空。
   证据：[`M0-007A-plugin-disabled-runtime.jpg`](M0-007A-plugin-disabled-runtime.jpg)、[`M0-007A-plugin-disabled-drag.jpg`](M0-007A-plugin-disabled-drag.jpg)、[`M0-007A-plugin-disabled-refresh-restored.jpg`](M0-007A-plugin-disabled-refresh-restored.jpg)。

## 结论

M0-007A“关闭插件后重新打开工程、构建和运行”证据已完成，满足插件不是运行时依赖的回归要求。当前交付工作区的 Creator 窗口仍保持插件关闭状态；本次会话后半段 Computer Use 未获 Cocos 窗口操作授权，因此没有把“重新启用插件”写成已验证事实。下次打开 Creator 后可在扩展管理器中手动重新启用，历史启用截图见 `M0-007-extension-manager-reenabled.jpg`。
