# M0-007 插件关闭后的构建与运行回归

日期：2026-08-09

## 插件状态

- 历史构建截图中的 Cocos Creator 3.8.8 扩展版本为 v1.1.0；当前源包版本已为 v1.3.0。
- 启用状态：[`M0-007-extension-manager-enabled.jpg`](M0-007-extension-manager-enabled.jpg)。
- 构建测试时关闭状态：[`M0-007-extension-manager-disabled.jpg`](M0-007-extension-manager-disabled.jpg)。
- 测试结束后的恢复启用状态：[`M0-007-extension-manager-reenabled.jpg`](M0-007-extension-manager-reenabled.jpg)。

## Web Desktop 重新构建

插件关闭后执行 Cocos Creator 3.8.8 Web Desktop 构建：

```text
CocosCreator.exe --project G:/WebProjects/starship-protocol \
  --build "platform=web-desktop;debug=false;buildPath=G:/WebProjects/starship-protocol/build"
```

Creator 构建器实际输出：

```text
2026-8-9 21:31:57 - debug: builder:build-project-total (6980ms)
2026-8-9 21:31:57 - debug: build task(web-desktop) in 6980!
2026-8-9 21:31:57 - debug: build Task (web-desktop) Finished in (6 s)
```

- 新产物入口：`build/web-desktop/index.html`。
- 文件时间：`2026-08-09 21:31:57 +0800`。
- 产物文件数：27。
- 说明：工程当时仍被另一个 Creator 窗口打开，命令行进程无法独占 `temp/logs/project.log`，进程最终返回非零状态；但 Creator 构建任务本身明确完成，且新的 Web Desktop 产物已写入并通过下述浏览器运行验收。该进程级冲突不作为构建成功的唯一证据。

## Codex 内置浏览器运行验收

使用独立静态服务器打开本次新产物：

```text
python -m http.server 7461 --directory build/web-desktop
http://localhost:7461/
```

结果：

- 页面标题为 `Cocos Creator | starship-protocol`，20×10 网格、左上 2×2 无效船体格和两个房间均正常显示：[`M0-007-plugin-disabled-web-runtime.png`](M0-007-plugin-disabled-web-runtime.png)。
- 拖动右侧房间到新的合法网格位置后成功吸附：[`M0-007-plugin-disabled-drag.png`](M0-007-plugin-disabled-drag.png)。
- 刷新后两个房间恢复到保存前位置：[`M0-007-plugin-disabled-refresh-restore.png`](M0-007-plugin-disabled-refresh-restore.png)。
- 滚轮缩放和空白区域镜头平移均生效：[`M0-007-plugin-disabled-camera-controls.png`](M0-007-plugin-disabled-camera-controls.png)。
- 初次加载、拖放、刷新、缩放和平移后的浏览器日志均为 `error=[]`、`warning=[]`。

结论：编辑器插件仅参与创作流程；关闭或损坏插件不会进入 Web 运行时依赖，也不会阻断构建、拖放、存档恢复或镜头控制。
