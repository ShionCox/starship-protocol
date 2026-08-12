# R1 客户端基础重构完成清单

> 唯一进度清单。R0 已冻结为历史基线；R2 正式发行与服务器仍是未来阶段。

## 完成规则

- 自动测试、Creator 人工验收、正式 Web Desktop 生成产物交互和持久证据全部通过后才能勾选阶段主项。
- 测试数量只记录命令实际输出，不在计划中预写。
- Scene、Prefab 和 Meta 必须通过 Creator 或项目插件生成，不手工编辑序列化文本。
- 所有 Inspector、Tooltip、下拉选项、面板字段和可见错误使用中文；稳定 ID、JSON 枚举和 TypeScript 标识符保持英文。

## [x] P0：清理与规范重基线

- [x] 删除 R2 可执行安全样例、Prototype Storage、旧空场景和一次性创作脚本。
- [x] 插件 `dist` 停止 Git 跟踪，锁文件版本与 1.5.0 一致。
- [x] 根测试入口包含编辑器扩展 clean build 和测试。
- [x] ADR-0004 锁定三场景、共享 UIRoot、ShipView、单一玩家状态和未来服务器边界。
- [x] R2 安全清单重置为未来验收，旧实现证据标记为历史且已移除。

## [x] P1：GameCore 与单一玩家状态

- [x] `HullDefinition` 校验任意尺寸、非矩形 0/1 Mask、船员/房间上限和外观 ID。
- [x] `ShipGridModel` 不再依赖 20×10 全局常量，定义 ID 与实例 ID 分离。
- [x] `ShipModel` 聚合布局、能源、导航和船员，并要求 Command 携带 `shipId`。
- [x] 两艘飞船允许复用同一房间短 ID，状态互不影响。
- [x] `PlayerStatePort` 与本地实现只使用 `starship-protocol:dev:player-state:v1`。
- [x] 完整 Envelope 原子保存；写入失败回滚；损坏状态中文警告并重建开发默认状态。
- [x] 旧三个 localStorage Key 不读取、不迁移。
- [x] `GameConfigCatalog` 只保存已验证 Hull/Room/Crew 定义，不保留发布安全逻辑。

## [x] P2：Creator 场景、共享 UI 与多舰表现

- [x] 代码已提供 `BootSceneBootstrap`、`MainSceneBootstrap`、`BattleSceneBootstrap`、`ShipView`、`UIRootController` 和页面路由。
- [x] Bootstrap 源码不存在运行时 UI fallback、硬编码消费者房间或动态补节点/组件。
- [x] Creator 中持久保存 `BootScene.scene`、`MainScene.scene`、`BattleScene.scene`。
- [x] Creator 中持久保存 `ShipView.prefab` 与 `UIRoot.prefab`；Main/Battle 使用同一 UIRoot 源。
- [x] `MainMenuPage`、`GalaxyMapPage`、`ShipMainPage`、`BuildPage`、`CrewPage`、`SettingsPopup` 以 Page Prefab 形式挂到 MainScene。
- [x] 两种不同 Mask 船体在编辑器可见；BattleScene 同时持久显示互不串联的我方/敌方 ShipView。
- [x] 三场景共用 Cocos 原生 1280×720 `SHOW_ALL` 适配；MainScene 预加载 BattleScene，不保留浏览器 CSS 放大低分辨率画布的单独逻辑。
- [x] 新三场景通过后删除 `PrototypeScene.scene`。

当前状态：MainScene 正式 Web 产物已验证 2D 相机、飞船、电梯、页面切换、能源、船员、镜头、全屏与本地恢复；BattleScene 已验证运行态双舰隔离、中文 BattleHUD 与正常往返。PrototypeScene 已删除。

## [x] P3：创作插件收敛

- [x] 删除 Prototype 英文别名、R1 一次性能源/船员搭建和 Prefab 替换消息。
- [x] 房间、船员、船体只通过公开 Asset DB / Scene API / Undo 操作。
- [x] 房间与船员创建共享最小资源清理事务，多个清理失败互不短路。
- [x] 增加船体定义创建/编辑/发现和飞船实例创建。
- [x] 场景页支持启动、主、战斗三种中文骨架，不生成一次性玩法内容。
- [x] 识别器顺序为房间 → 船员 → 飞船 → 中文语义节点 → 普通节点。

## [x] P4：未来服务器与离线收益契约

- [x] 冻结未来请求/响应的 requestId、idempotencyKey、expectedRevision、configVersion、serverTime 与 revision。
- [x] 首版 Command 固定返回完整 State；Bootstrap 在实际离线结算时返回可选 `OfflineSettlementSummary`，不提前支持 Delta。
- [x] 冻结首批 API、最小数据库聚合与经济流水边界。
- [x] 冻结资源产出 12 小时封顶、计时完整推进、事务幂等和禁止离线战斗/AI/船员移动规则。
- [x] 当前仓库不含服务器、Redis、Launcher、Native 安全桥或生产部署伪实现。

## 自动门槛

- [x] 根目录 `npm test`：核心 59/59、编辑器扩展 68/68 通过（2026-08-12，包含存档重复飞船、全局输入注销、非法布局 fail-closed、按飞船实例 ID 和资源回滚回归测试）。
- [x] Cocos Creator 3.8.8 内置 TypeScript `--noEmit` 通过。
- [x] `git diff --check` 通过。
- [x] GameCore 无 `cc`、DOM、localStorage 或 Node 内置 API；runtime 无 Prototype fallback 和旧 Key。
- [x] `git ls-files extensions/starship-editor-tools/dist` 为 0；本地 clean build 产物保留但已忽略。

## Creator / Web 完成门槛

- [x] 三场景和共享 Prefab 可打开、中文 Inspector 可调、无缺失脚本。
- [x] Main 页面切换、Battle 运行态双舰、镜头拖动/缩放、能源、船员移动与本地恢复均已通过浏览器验收。
- [x] 18:19 正式 Web Desktop Build 已复验：1280×720 与 1920×1080 渲染缓冲匹配窗口，1280×900 为上下各 90 像素纯黑边，Console 0 warning / 0 error；用户已确认普通浏览器全屏正常。
- [x] Creator / Web 实际交互结果已补入 `docs/evidence/R1-FOUNDATION-REBASELINE.md`。
