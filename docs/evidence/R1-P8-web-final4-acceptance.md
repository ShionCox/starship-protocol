# R1 P8 Web 验收记录（final4）

日期：2026-08-14  运行地址：`http://localhost:7456/`  视口：1280×720

本记录只覆盖本轮实际操作到的项目，不替代仍需长时间或 Creator 逐项人工复核的条目。

## 已实测

- 冷启动进入 MainScene，主菜单默认激活；控制台 warning/error 为 0。
- 设置入口打开持久 `SettingsPopup`，显示“设置”、设计分辨率、SHOW_ALL 和关闭提示；再次点击设置关闭并恢复主菜单。
- 页面隔离：星图无能源/船员状态面板；飞船页显示能源和船员状态；建造页只显示建造内容；船员页显示船员状态且不显示能源面板。各次切页控制台 warning/error 为 0。
- 选择工程师后右键地板，显示“开始拆除”；确认后拆除完成，建造页施工队列恢复为空且金属从 1050 回到 1052，控制台 warning/error 为 0。
- 进入 BattleScene 显示我方/敌方双舰；点击“返回主场景”回到 MainScene，控制台 warning/error 为 0。
- 最新构建（21:15:25 产物）再次验证设置弹窗、页面切换、Battle 往返与刷新；游戏控制台 warning/error 均为 0。设置弹窗背景、边框和文字在最新构建中可见。
- 最新构建再次完成一次拆除确认→完成→建造页复核：队列为空、金属显示 1054，游戏控制台 warning/error 为 0。
- Creator 面板实测页面隔离入口：选择“星图”后可打开 `GALAXY_MAP` 页面 Prefab；随后取消预览并执行“连接场景引用”，面板返回 MainScene 默认上下文并提示“主场景引用已连接并保存”。

截图：

- `R1-P8-web-final4-cold-start.png`
- `R1-P8-web-final4-settings.png`
- `R1-P8-web-final4-page-galaxy.png`
- `R1-P8-web-final4-page-ship.png`
- `R1-P8-web-final4-page-build.png`
- `R1-P8-web-final4-page-crew.png`
- `R1-P8-web-final4-demolition-confirm.png`
- `R1-P8-web-final4-demolition-done.png`
- `R1-P8-web-final4-battle.png`
- `R1-P8-web-final4-main-return.png`
- `R1-P8-web-final4-refresh.png`
- `R1-P8-web-final5-settings.png`
- `R1-P8-web-final5-galaxy.png`
- `R1-P8-web-final5-ship.png`
- `R1-P8-web-final5-build.png`
- `R1-P8-web-final5-crew.png`
- `R1-P8-web-final5-battle.png`
- `R1-P8-web-final5-main-return.png`
- `R1-P8-web-final5-refresh.png`
- `R1-P8-web-final5-demolition-confirm.png`
- `R1-P8-web-final5-demolition-done.png`
- `R1-P8-web-final5-demolition-build.png`
- `R1-P8-creator-page-isolation.png`

## 本轮自动门槛

- `npm test`：core 149/149、editor-tools 107/107，通过。
- `node extensions/starship-editor-tools/node_modules/typescript/bin/tsc -p tsconfig.verify-p8.json --pretty false`：通过。
- `git diff --check`：通过；仅保留已有文档 CRLF 转换提示。
- Cocos Web Desktop Build：构建任务完成；最新产物 `build/web-desktop/index.html` 与 `application.js` 时间戳为 2026-08-14 21:15:25（CLI 进程返回码 36，但日志明确 `build Task (web-desktop) Finished`，Creator 窗口占用 `temp/logs/project.log`）。

## 尚未关闭

P8/P8.1/P8.3 中需要真实等待或逐项 Creator/Web 证据的完整施工抢占、楼梯 8 Tick/电梯 5 Tick 截图、四职业动画状态、关闭页面后的离线完成回拨、房间草稿/MASK 和完整 Creator 冷重开仍保持未勾选。
