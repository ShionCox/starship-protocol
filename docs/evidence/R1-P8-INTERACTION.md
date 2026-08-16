# R1 P8.1 选择交互与逐格移动证据

日期：2026-08-13；补充复验：2026-08-14

## 范围

本批只收口 P8 体素系统的选择、右键操作、网格表现与逐节点移动。它不关闭 P7 的四职业动画绑定，也不代表 P8 建造/离线 Web 流程或完整 R1 已完成。

## 已实现

- 导航节点带纯逻辑锚点，地板、房间站位和连接器停靠点均可换算表现坐标。
- 普通边使用船员移动 Tick；电梯和楼梯纵向边分别使用 CSV 的 5/8 Tick，并以稳定 ID 进行加权最短路决胜。
- schema 6 保存 `currentNodeId`、玩家订单、巡逻启停与施工返工信息；普通地板可停留，连接器不能作为终点。
- `WorldInteractionController` 统一处理左键选择、空白/`Esc` 取消、右键菜单、UI 命中隔离和网格悬浮。
- `FloorView` 完整填满 24px 网格并使用 1px 内边界；创作工具升级入口会持久校正 ShipView 层级和 UIRoot 菜单结构。
- `CrewView` 使用 Cocos Tween 沿每个路径节点插值，缺少锚点时中文报错并停止本次表现刷新。

## 自动验证

2026-08-13 首轮、2026-08-14/15 收口复验实际执行：

- 根目录 `npm test`：GameCore / Application 159/159，扩展 clean build + test 108/108；新增测试直接解析 Creator 序列化资源，确认 Main/Battle 应用根唯一来源、全部 ShipView 同源、领域 Prefab 无本地来源、五房间/四 Crew 的持久 SpriteFrame/AnimationClip、拆除取消/退款/校验、未分配工程师建造不推进，以及三工程师在首选工地房间满员时稳定分散到其他工位并在标准双层布局最终到场。
- Creator 3.8.8 随附 TypeScript 5.8.2 对 `tsconfig.verify-p8.json --noEmit`：0 error。
- `git diff --check`：退出 0；仅报告既有中文规范文档 CRLF 将转换为 LF 的提示。
- GameCore 边界扫描：未发现真实 `cc`、DOM、localStorage/sessionStorage、Node 内置或系统时间调用；`HullDefinition` 的局部变量名 `document` 不是 DOM。
- `git ls-files extensions/starship-editor-tools/dist`：0，生成目录未被 Git 跟踪。

## Creator / Web 待验证

- [x] Creator 执行 P8.3 全新重建，总耗时 167822ms；MainScene 应用根持久显示完整九表来源和 Bootstrap 引用。证据：`R1-P8.3-creator-rebuild-timing.png`、`R1-P8.3-creator-app-root-config-source.png`。
- [x] Creator 预览 `http://localhost:7456/` 实测主页面导航、船员点击命中、空白/`Esc` 取消、右键菜单与已完成地板站立格。
- [x] 选中“长风”后移动到已完成地板上沿；移动中与到达后的选框均跟随，最终状态恢复空闲并继续闲逛。证据：`R1-P8-web-crew-floor-arrival.png`。
- [x] Main → Battle → Main 往返正常，Battle 同时显示 `ship-1` 与 `ship-enemy-1`；刷新后地板终点和船员状态恢复。证据：`R1-P8-web-battle-dual-ship.png`、`R1-P8-web-main-refresh-1280x720.png`。
- [x] 滚轮缩放时主导航保持屏幕空间不变，船员名称保持正向与近似恒定屏幕字号；1280×900 保持 16:9 内容并留黑边。证据：`R1-P8-web-zoom-out-labels.png`。
- [x] 首次启动因旧开发存档版本不兼容出现一次重置 warning；重置后的第二次刷新至本轮结束新增 Console 为 0 warning / 0 error。
- [x] 2026-08-14 16:15 新生成正式 `build/web-desktop`；通过独立 `localhost:7457` 实测页面切换、船员点击命中、右键地板移动、到达后空闲、刷新恢复、Main/Battle 往返及双舰显示，Console 0 warning / 0 error。证据：`R1-P8-web-formal-main-1280x720.png`、`R1-P8-web-formal-crew-page.png`、`R1-P8-web-formal-context-menu.png`、`R1-P8-web-formal-floor-arrival.png`、`R1-P8-web-formal-refresh-restored.png`、`R1-P8-web-formal-battle-dual-ship.png`。
- [x] 1280×900 正式构建保持 1280×720 内容并上下各 90px 黑边，Console 0 warning / 0 error。证据：`R1-P8-web-formal-letterbox-1280x900.png`。
- [x] 自动解析 Creator 序列化资源确认 Battle 应用根唯一九表来源、双方 ShipView 同源，且 Room/Crew/Ship Prefab 均无本地 `GameConfigCsvSource`。
- [x] 2026-08-14 最终正式构建通过全新来源 `localhost:7458` 冷启动；六名船员可见，三名工程师成功分散到稳定工位，医疗室施工由 0% 加速完成。证据：`R1-P8-web-final-cold-start.jpg`、`R1-P8-web-final-three-engineers-assigned.jpg`、`R1-P8-web-final-three-engineers-completed.jpg`。
- [x] 同一正式构建完成第二项目开工与取消，金属从 900 扣至 760 后按 500‰ 返还 70，最终为 830；刷新后余额、已完成医疗室与空队列恢复。证据：`R1-P8-web-final-construction-cancel-refund.jpg`、`R1-P8-web-final-refresh-restored.jpg`。
- [x] 工程师从下层房间经持久连接器路径到达上层已完成地板，移动文字保持正向、选框跟随；Main/Battle 往返保持双舰。证据：`R1-P8-web-final-cross-level-start.jpg`、`R1-P8-web-final-cross-level-mid.jpg`、`R1-P8-web-final-cross-level-arrival.jpg`、`R1-P8-web-final-battle-dual-ship.jpg`。
- [x] 最终构建再次通过 1920×1080、1280×900 SHOW_ALL 黑边和滚轮缩放检查；主导航固定屏幕空间，船员名称在世界缩放后保持可读。证据：`R1-P8-web-final-1920x1080.jpg`、`R1-P8-web-final-letterbox-1280x900.jpg`、`R1-P8-web-final-zoom-out-labels.jpg`。
- [x] 2026-08-15 Codex 内置浏览器实测楼梯边 `0/8 → 2/8 → 4/8 → 6/8` 连续移动；最新正式包在跨层完成后保留“最近连接器：电梯 5 Tick”遥测。证据：`R1-P8-web-final6-stairs-8tick.png`、`R1-P8-web-final7-elevator-5tick.png`。
- [x] 士兵巡逻被玩家移动订单抢占后，右键菜单可“停止移动”；停止后状态面板保留“恢复：已完成（10 Tick）”，最终 Web Console 0 warning / 0 error。证据：`R1-P8-web-final6-preempt-stop-menu.png`、`R1-P8-web-final7-patrol-resume-10tick.png`。
- [x] 2026-08-15 已补正式包施工进度画面（0%→3%→6%→73%）及施工状态下船员外观帧，游戏 Console 仍为 0 warning / 0 error。证据：`R1-P8-web-final8-construction-start.png`、`R1-P8-web-final8-construction-mid-1.png`、`R1-P8-web-final8-construction-mid-2.png`、`R1-P8-web-final8-construction-73pct.png`。
- [x] 2026-08-15 最新正式包验证多人施工收口：仅一名工程师到场时进度稳定停在 75%，未提前完成；Console 0 warning / 0 error。证据：`R1-P8-web-final9-multi-engineer-cap-75pct.png`。标准双层三工程师最终到场由 `ShipConstructionIntegration.test.ts` 覆盖；浏览器当前标准场景仍显示 1/3，故不将此项误记为 Web 三人到场通过。
- [x] 2026-08-15 最终正式包使用右侧分类卡拖放完成下层 `(18,1)` 地板开工，施工槽从 `0/6` 变为 `1/6`，自动安排一名工程师，游戏 Console 仍为 0 warning / 0 error。证据：`R1-P8-web-final12-floor-18-1-drag.png`。拖拽期间新增全局鼠标移动监听，离开卡片后仍持续刷新网格候选。
- [x] 2026-08-15 修正房间拖拽投影：`cc.Camera.screenToWorld` 按 Cocos 3.8 公开签名使用 `screenPos, out`，不再把旧输出向量当输入；正式包复测房间矩形候选会随指针更新并能提交合法施工，未新增游戏 Console warning/error。证据：`R1-P8-web-final13-room-drag-camera-projection.png`。
- [x] 2026-08-15 修复 Creator 编译后的 `Set` 集合兼容问题后，在全新正式包复验 `(18,1)`：未分配时保持 `0% / 工程师 0/0`，分配后按到场状态推进；长时电梯项目在 `83% / 工程师 3/3` 时完成，页面 Console 0 warning / 0 error。证据：`R1-P8-web-final10-unassigned-stalled.png`、`R1-P8-web-final10-one-engineer-cap.png`、`R1-P8-web-final10-three-engineers-onsite.png`、`R1-P8-web-final10-three-engineers-completed.png`。

## P8 页面/拆除/离线收口（本批新增）

- [x] `MainPageRouter` 已实现页面状态矩阵：任意时刻只激活一个 Page；设置弹窗关闭后恢复打开前页面；能源与船员状态面板按页面显隐。
- [x] 创作工具已增加“预览页面”和“打开页面 Prefab”，预览隔离在 UIRoot Prefab 上执行，重新连接场景引用时恢复主菜单默认状态。
- [x] `DEMOLISH` 右键动作、中文禁用原因、确认前置、施工队列拆除/退款显示和离线结算摘要 API 已实现；Creator 已持久保存两个弹窗引用，Web 拆除已有 final4/final5 证据。
- [x] CrewStatusPanel 已增加路径边 Tick、巡逻开关/恢复 Tick、施工项目与到场遥测字段；Codex 浏览器已确认页面矩阵和遥测显示，并保留正式包复验截图。

Creator 已完成“创建/升级共享基础”和“连接场景引用”，`UIRoot.prefab`、`MainScene.scene` 已保存页面路由、两个弹窗引用及 `r1-p8-close-1` 配置版本。7456 正式构建冷启动已通过 Bootstrap 绑定，错误数为 0；首次旧开发存档重置 warning 属于预期的一次性版本清理，后续刷新未重复出现。

- [x] 2026-08-15 已在同一浏览器上下文中制造可结算拆除项目，导航到 `about:blank` 后返回同一正式包来源，确认离线结算只弹出一次并显示“完成：拆除房间 x1 / 金属变化：-50”；关闭按钮可用，截图期间游戏 Console 为 0 warning / 0 error。证据：`R1-P8-web-final11-offline-settlement.png`。该证据关闭离线摘要视觉缺口；施工工程师抢占/返工仍未形成连续人工证据。

同批已保存 `(18,1)` 地板开工、三工程师长时房间施工、维修、治疗、供电循环、断电首帧、页面隔离预览、房间/船体/船员草稿取消和 EngineerCrew Prefab 冷打开截图。三工程师同时到场已在正式包复验通过；施工抢占/返工仍保持未通过，不以自动测试替代人工画面。施工 AnimationClip 连续画面已单独补入上方证据。

P8.1 的选择、逐格移动、5/8 Tick 与 10 Tick 恢复已收口；三工程师施工、施工抢占/返工、巡逻/施工动画和离线弹窗修复后视觉仍归 P7/P8 收口项，不因 P8.1 完成而提前勾选。
