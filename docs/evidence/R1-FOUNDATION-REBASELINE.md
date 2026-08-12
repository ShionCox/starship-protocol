# R1 客户端基础重构证据

## 范围

本批按照 ADR-0004 将单一 PrototypeScene 重基线为 HullDefinition、ShipModel、PlayerStatePort 与 Boot/Main/Battle 场景架构。旧开发存档不迁移，R2 可执行安全样例删除。

## 已完成实现

- GameCore：HullDefinition、任意尺寸/非矩形 Mask、定义 ID/实例 ID 分离、ShipModel 单舰聚合、shipId 作用域 Command、双舰短 ID 隔离和完整快照原子恢复。
- Application：PlayerStatePort、GameConfigCatalog、未来服务器 Command/离线结算契约。
- 本地适配：只使用 `starship-protocol:dev:player-state:v1`，完整 Envelope 原子保存、写失败回滚、损坏数据中文警告并回到默认状态；旧三个 Key 不读取。
- Cocos：Boot/Main/Battle Bootstrap、ShipView、共享 UIRoot 模式控制、Main Page 路由、BattleHUD；所有可调 Inspector 字段和错误为中文。
- 显示：Web 模板使用 `cc_exact_fit_screen=true` 让 Cocos 按浏览器真实尺寸重建渲染缓冲；三个场景入口共用 1280×720 `ResolutionPolicy.SHOW_ALL` 留出黑边，不再用 CSS 放大固定 1280×720 Canvas。
- 资源：Web Desktop 的三个参与构建场景使用 Creator 内置 `main` Bundle；MainScene 通过 `director.preloadScene('BattleScene')` 预加载战斗场景。Web Desktop 不提供初始场景分包，自定义 Bundle 等动态资源或包体出现实际分包需求后再配置。
- Bootstrap：只连接 Creator 已保存引用，不包含运行时 UI fallback、硬编码激光/护盾补齐或旧英文骨架别名。
- 创作插件：船体与飞船分页、Boot/Main/Battle 中文骨架、ShipView 作用域房间/船员创建、公开 Asset DB/Scene API、单次 Undo 和独立清理回滚；一次性 R1 模板消息已删除，dist 不再作为源码维护。
- 删除：Prototype Storage/Planner/Bootstrap/SceneSettings/别名、scene-2d、R2 Launcher/Native/FastAPI/发布安全工具和对应测试。

## 自动验证

- 2026-08-12 根目录 `npm test`：核心 59/59、编辑器扩展 clean build 后 68/68 通过；包含本批审查修复回归测试。
- Cocos Creator 3.8.8 内置 TypeScript `--noEmit` 通过；`git diff --check` 通过。
- GameCore 边界扫描无 `cc`、DOM、localStorage 或 Node 内置 API；运行时无 Prototype/fallback/旧 Key；`git ls-files extensions/starship-editor-tools/dist` 为 0。
- 审查修复：ShipModel 不暴露可变子模型；开发存档拒绝重复/缺失飞船；镜头全局松开和页面事件精确注销；非法已有布局 fail-closed；房间实例 ID 按目标飞船分配；Foundation Prefab 清理失败显示残留路径和 Asset DB 错误。

## Creator / Web 状态

- 2026-08-12 登录阻断已由用户解除；Creator 可打开 BootScene、MainScene、BattleScene、ShipView 与共享 UIRoot。
- 通过实际画面定位并修正 MainScene 正交 2D 相机的 UI_2D 可见层、Canvas 相机绑定、清屏模式，以及 Canvas 下世界/界面节点层和飞船局部坐标。
- BattleScene 已通过 Creator 持久保存：场景只有一台正交 Camera 和一个 Canvas；我方挂载点为 `(-260,-40)`、`ship-1/hull-starter`，敌方挂载点为 `(260,40)`、`ship-2/hull-raider`，共享 BattleHUD 显示双方作用域。
- 18:19 Creator 正式 Web Desktop Build 已验证：1280×720 Canvas 与窗口一致；1920×1080 时渲染缓冲实际为 1920×1080，未使用 CSS 放大 1280×720 画布；1280×900 时游戏区域为 1280×720、上下各 90 像素纯黑。
- 能源实测完成：`0/10 → 激光6/护盾4 → 护盾再加1被拒绝且保持6/4 → 激光断电 → 护盾6 → 刷新恢复0/6`，中文错误为“能源不足：需要 11，可用 10”。
- 船员实测完成：选择工程师后点击目标房间，状态面板显示目标与“移动中”，固定 Tick 推进和到达可观察，刷新后所在房间保持。
- 船员移动表现修复：移除 `CrewView.bind()` 内先瞬移再 Tween 的重复位置刷新；逻辑仍为 10Hz 固定 Tick，画面按中文 Inspector“移动插值时长”使用 Cocos Tween 平滑过渡；用户已确认最新构建移动流畅。
- Main 的主菜单、星图、飞船、建造、船员页面切换正常；Battle 运行态同时显示 `ship-1` 与 `ship-2`，返回 Main 正常；镜头拖动和滚轮缩放正常。
- 浏览器 Console 全程 0 warning / 0 error；用户已在普通浏览器确认全屏正常。
- 持久截图：`R1-foundation-web-main-1280x720.png`、`R1-foundation-web-main-1920x1080.png`、`R1-foundation-web-battle-dual-ship.png`、`R1-foundation-web-energy-insufficient.png`、`R1-foundation-web-energy-refresh-restore.png`、`R1-foundation-web-crew-movement.png`、`R1-foundation-web-crew-refresh-restore.png`、`R1-foundation-web-camera-pan.png`、`R1-foundation-web-camera-zoom.png`、`R1-foundation-web-letterbox-1280x900.png`。
