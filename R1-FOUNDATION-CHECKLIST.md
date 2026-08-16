# R1 客户端基础重构完成清单

> 唯一进度清单。R0 已冻结为历史基线；R2 正式发行与服务器仍是未来阶段。

## 完成规则

- 自动测试、Creator 人工验收、正式 Web Desktop 生成产物交互和持久证据全部通过后才能勾选阶段主项。
- 测试数量只记录命令实际输出，不在计划中预写。
- Scene、Prefab 和 Meta 必须通过 Creator 或项目插件生成，不手工编辑序列化文本。
- 所有 Inspector、Tooltip、下拉选项、面板字段和可见错误使用中文；稳定 ID、JSON 枚举和 TypeScript 标识符保持英文。

## [x] P0：清理与规范重基线

- [x] 删除 R2 可执行安全样例、Prototype Storage、旧空场景和一次性创作脚本。
- [x] 插件 `dist` 停止 Git 跟踪；P8.3 后插件与锁文件版本同步为 2.0.0。
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
- [x] （迁移前历史基线）`MainMenuPage`、`GalaxyMapPage`、`ShipMainPage`、`BuildPage`、`CrewPage`、`SettingsPopup` 曾以 Page Prefab 形式挂到 MainScene；当前收敛状态见下方 ADR-0006 项。
- [x] 两种不同 Mask 船体在编辑器可见；BattleScene 同时持久显示互不串联的我方/敌方 ShipView。
- [x] 三场景共用 Cocos 原生 1280×720 `SHOW_ALL` 适配；MainScene 预加载 BattleScene，不保留浏览器 CSS 放大低分辨率画布的单独逻辑。
- [x] 新三场景通过后删除 `PrototypeScene.scene`。

当前状态：MainScene 正式 Web 产物已验证 2D 相机、飞船、电梯、页面切换、能源、船员、镜头、全屏与本地恢复；BattleScene 已验证运行态双舰隔离、中文 BattleHUD 与正常往返。PrototypeScene 已删除。

## [x] P3：创作插件收敛

- [x] 删除 Prototype 英文别名、R1 一次性能源/船员搭建和 Prefab 替换消息。
- [x] 房间、船员、船体只通过公开 Asset DB / Scene API / Undo 操作。
- [x] 房间与船员创建共享最小资源清理事务，多个清理失败互不短路。
- [x] 增加船体定义创建/编辑/发现和飞船实例创建。
- [x] 场景页收敛为三个固定的一键创建/更新入口：启动界面、主界面、战斗界面；不再暴露迁移、挂载、连接、P8 重建或页面预览动作。
- [x] 识别器顺序为房间 → 船员 → 飞船 → 中文语义节点 → 普通节点。

## [x] P4：未来服务器与离线收益契约

- [x] 冻结未来请求/响应的 requestId、idempotencyKey、expectedRevision、configVersion、serverTime 与 revision。
- [x] 首版 Command 固定返回完整 State；Bootstrap 在实际离线结算时返回可选 `OfflineSettlementSummary`，不提前支持 Delta。
- [x] 冻结首批 API、最小数据库聚合与经济流水边界。
- [x] 冻结资源产出 12 小时封顶、计时完整推进、事务幂等和禁止离线战斗/AI/船员移动规则。
- [x] 当前仓库不含服务器、Redis、Launcher、Native 安全桥或生产部署伪实现。

## [x] P5：工程师维修最小可玩纵切

- [x] `CrewDefinition` schema 2 增加职业约束的 `repairHpPerTick`；工程师为 1，武器操作员为 0。
- [x] `ShipModel` 支持带 `shipId` 的开始/停止维修 Command、`REPAIRING` 快照、固定 Tick 叠加维修、满耐久自动停止和布局锁定。
- [x] 单一玩家 Envelope 保存维修 Command 与 Tick；保存失败整份回滚，旧配置版本不迁移。
- [x] `RoomView` 提供中文“初始耐久”和耐久条；`CrewStatusPanel` 提供持久中文维修按钮与房间耐久显示。
- [x] 创作插件 1.6.0 的船员创建、发现、编辑和面板共用 schema 2 维修字段校验。
- [x] Creator 中升级并保存 `UIRoot.prefab`，连接房间耐久、维修按钮及按钮文字引用。
- [x] Creator 中将 MainScene 激光室实例初始耐久设为 60，其他房间保持 -1；两个船员实例 ID、初始反应堆站位和 `r1-repair-1` 配置版本均已持久保存。
- [x] 22:10 正式 Web Desktop 完成移动、开始/停止维修、自动完成、刷新恢复、布局锁定及能源/页面回归；既有镜头、全屏与 16:9 门槛继续沿用 P2 证据。
- [x] Creator/Web 截图和实际交互结果已补入 `docs/evidence/R1-REPAIR-MVP.md`。

## [x] P6：医务员与医疗室最小可玩纵切

- [x] `CrewDefinition` schema 3 增加 `MEDIC`；`RoomDefinition` schema 2 增加 `healingHpPerTick`，旧定义不迁移。
- [x] `CrewModel` / `ShipModel` 支持显式病员与医务员配对、`HEALING` / `TREATING`、开始/停止治疗、满生命自动停止及双向配对快照校验。
- [x] 固定 Tick 顺序为移动 → 医疗 → 维修；同一 Tick 单舰 revision 只增加一次，玩家 Envelope 只保存一次，写盘失败整份回滚。
- [x] 医疗室要求分配 2 点能源；断电立即解除该房间全部治疗配对，双方恢复空闲。
- [x] `CrewView` 提供中文“初始生命”和生命条；`CrewStatusPanel` 持久显示船员生命、治疗按钮和中文禁用原因。
- [x] 创作插件 1.7.0 的船员/房间创建、发现、编辑和目录共用 schema 3 / schema 2 校验，并支持医务员与每 Tick 治疗量。
- [x] Creator 中持久保存 `MedicalRoom.prefab`、`MedicCrew.prefab`、`room-medbay-1`、`crew-medic-1`、医疗能源行和治疗控件；武器操作员初始生命设为 40。
- [x] 23:16 正式 Web Desktop Build 成功；浏览器实测供电、移动、配对、10Hz 治疗、断电停止、手动停止、刷新恢复、100/100 自动空闲和页面回归。
- [x] Creator/Web 事实、截图和实际交互结果已补入 `docs/evidence/R1-MEDICAL-MVP.md`。

## 自动门槛

- [x] 根目录 `npm test`：核心 161/161、编辑器扩展 106/106 通过（2026-08-17，包含未分配工程师建造不推进、Creator 序列化资源所有权、PSS 持久动画、P8 CSV、体素布局、跨层导航、巡逻、施工/拆除/离线存档、三工程师标准双层工位分配、施工快照一致性、UI 清晰度、站立格移动、船员命中及 Creator 重建竞态回归）。
- [x] Cocos Creator 3.8.8 内置 TypeScript `--noEmit` 通过。
- [x] `git diff --check` 通过。
- [x] GameCore 无 `cc`、DOM、localStorage 或 Node 内置 API；runtime 无 Prototype fallback 和旧 Key。
- [x] `git ls-files extensions/starship-editor-tools/dist` 为 0；本地 clean build 产物保留但已忽略。

## Creator / Web 完成门槛

- [x] 三场景和共享 Prefab 可打开、中文 Inspector 可调、无缺失脚本。
- [x] Main 页面切换、Battle 运行态双舰、镜头拖动/缩放、能源、船员移动与本地恢复均已通过浏览器验收。
- [x] 18:19 正式 Web Desktop Build 已复验：1280×720 与 1920×1080 渲染缓冲匹配窗口，1280×900 为上下各 90 像素纯黑边，Console 0 warning / 0 error；用户已确认普通浏览器全屏正常。
- [x] Creator / Web 实际交互结果已补入 `docs/evidence/R1-FOUNDATION-REBASELINE.md`。

## [x] P7：PSS 素材库、Cocos 原生动画与船员命名系统

- [x] 建立 `I:\WebProjects\pss_full` 只读全库索引、中文搜索/分类/分页和缺失源告警；运行时不依赖外部素材库。
- [x] 首批五个房间与三套船员部件素材复制到 `assets/textures/pss/source/`，manifest 记录稳定 visualId、帧矩形、Hash、FPS、来源和授权状态。
- [x] 新增 `RoomAppearance` 与 `CrewAppearance`，使用 Cocos `Sprite`、`SpriteFrame`、`Animation`、`AnimationClip`，支持静态/常驻循环/供电循环、最近邻、整数缩放、移动方向和 Graphics 回退。
- [x] 新增稳定中文代号系统，支持自动生成与 FIXED 指定名称；代号写入 Crew/Ship schema 4 快照，同舰去重且不使用 `Math.random()`。
- [x] 扩展素材库分页、manifest 校验和安全导入端口；插件版本升级为 1.8.0，dist 不纳入 Git。
- [x] Creator 中为五个房间和四个 Crew Prefab 持久绑定 Sprite、SpriteFrame、Animation/AnimationClip；重建后的序列化资源自动测试与正式 Web 画面确认组合锚点有效。
- [x] Web Desktop 实测船员移动时名称不镜像、选框跟随、代号刷新恢复、世界缩放恒定字号及 1280×720 / 1920×1080 / 1280×900 像素清晰度；证据已补入 `docs/evidence/R1-PSS-VISUAL-PIPELINE.md` 与 `R1-P8-INTERACTION.md`。
- [x] Web Desktop 已补房间供电循环/断电首帧、维修、治疗、士兵巡逻和施工 AnimationClip 连续状态截图；证据：`docs/evidence/R1-P7-web-final6-*.png`、`docs/evidence/R1-P7-web-final8-patrol-animation-frame-*.png`、`docs/evidence/R1-P8-web-final8-construction-*.png`。三名工程师同时到场属于 P8 施工验收，仍单独跟踪。

## [ ] P8：体素地板、多层导航、船员行为与建造系统

- [x] 权威配置迁入 `assets/config/csv/` 九张运行时 CSV（七张玩法表与两张视觉表），并增加仅编辑器使用的 `editor-prefabs.csv`；支持 BOM、CRLF、RFC4180 引号、严格英文表头、第二行中文说明、稳定 ID 和跨表整体校验。船体格已合并为 `hulls.cellMask`，视觉表包含显式帧矩形、画布尺寸、播放模式与帧率。
- [x] `HullDefinition` / `RoomDefinition` / `CrewDefinition` 升级为 schema 2 / 3 / 4；Crew/Ship/Player 快照升级为 schema 5 / 5 / 2，开发配置使用 `r1-p8-close-1`，旧开发存档直接重置。
- [x] 固定墙、地板支撑、楼梯/电梯停靠口和体素导航已进入纯 TypeScript GameCore；同层只左右连通，上下相邻不得形成捷径。
- [x] 施工 Command、金属、槽位、工程师加速、取消退款、拆除校验、显式时间结算、时钟回拨和离线施工已通过自动测试。
- [x] 船员支持 `PATROLLING` / `CONSTRUCTING`；士兵路线、游标、暂停和阻断图版本进入快照，玩家任务可抢占并在 10 Tick 后恢复。
- [x] Cocos 已提供 `FloorView`、`ConstructionGhostView`、`BuildPageController`、`BuildablePrefabCatalog` 和 `ShipContentViewSync`；插件 2.0.0 提供九张运行时 CSV、编辑器 Prefab 映射、房间实时草稿，并将场景补齐逻辑收敛到三个固定一键入口。
- [x] Creator 中已按最新标准演示重新装配下层 17 块、上层 17 块地板，下层 (18,1) 保留为建造/拆除回归空位、反应堆/激光/护盾/医疗/楼梯/电梯、四职业共六名船员（三名工程师）及士兵四点巡逻路线；MainScene 序列化与 2026-08-14 17:07 正式构建均已核对六个稳定船员 ID。
- [x] 全新来源 `localhost:7470` 冷启动实测士兵从下层激光室到上层医疗室、上层护盾室并经过连接器；UI 层级未再被飞船遮挡。
- [x] Web 手工完成房间建造、三工程师分配与加速、第二项目取消退款、刷新恢复；最终构建全过程游戏 Console 0 warning / 0 error。
- [x] Codex 内置浏览器已完成 `(18,1)` 地板新建，并在正式长时房间项目中确认三名工程师同时到场；离线拆除结算摘要已完成同源关闭/重开视觉复验。证据：`docs/evidence/R1-P8-web-final12-floor-18-1-drag.png`、`R1-P8-web-final10-three-engineers-onsite.png`、`R1-P8-web-final11-offline-settlement.png`。
- [ ] Web 尚缺施工工程师被玩家任务抢占、停止后 10 Tick 返工的同一项目连续画面；自动回归已覆盖，不能以自动测试替代该人工项。
- [x] 四个 Crew Prefab 已持久绑定 PSS SpriteFrame/AnimationClip；序列化测试、正式 Web 移动/施工画面和 Console 0 阻断错误已形成证据。
- [x] Web 已形成维修、治疗、供电循环、断电、巡逻和施工进度帧截图，并已补三工程师 `3/3` 到场帧；证据见 `docs/evidence/R1-P7-web-final6-*.png`、`R1-P7-web-final8-patrol-animation-frame-*.png`、`R1-P8-web-final8-construction-*.png`、`R1-P8-web-final10-three-engineers-onsite.png`。
- [ ] 仍需形成施工抢占/返工的连续 AnimationClip 状态切换截图；该项是 P8 主项剩余人工门槛。
- [x] 删除旧 JSON 创建/发现/编辑代码、消息、面板、测试和目录发现；旧 JSON 资产已通过 Creator Asset DB 清理，P8 运行与创作只剩 CSV 权威入口。
- [x] 当前实现、自动门槛、Creator 持久场景和 Web 冷启动事实已记录到 `docs/evidence/R1-VOXEL-CREW-CONSTRUCTION.md`；未完成项不得据此宣称 P8 或完整 R1 完成。

## [x] P8.1：选择交互、网格表现与逐格移动优化

- [x] `NavigationNode` 保存纯逻辑锚点和加权边；普通水平边使用船员移动 Tick，电梯/楼梯分别使用 CSV 的 5/8 Tick，路径按稳定节点 ID 确定。
- [x] Crew/Ship 快照升级为 schema 6；船员权威 `currentNodeId` 支持普通地板终点、唯一占用/预留、半格取消回退和持久玩家任务订单。
- [x] 新增显式移动、前往维修/医疗/施工、停止任务和巡逻启停 Command；玩家任务抢占后台行为，结束后 10 Tick 恢复巡逻或返工。
- [x] 新增 `WorldInteractionController`：左键切换、空白/`Esc` 取消、右键 Cocos 菜单、UI 命中隔离和单 Graphics 网格悬浮；Camera 仍只响应左键拖动。
- [x] `FloorView` 改为完整 24×24 格并保留 1px 内边界；ShipView 创作结构固定为网格→地板→高亮→房间→船员→施工→特效。
- [x] `CrewView` 解析 FLOOR / ROOM_STATION / CONNECTOR_STOP 锚点，Tween 不超过 0.1 秒；锚点缺失中文报错，不再静默跳到房间中心。
- [x] 共享基础升级逻辑已并入三个场景入口的固定分支，通过 Creator 公开 API 持久刷新 ShipView 分层和 UIRoot 世界交互菜单；运行时不补关键节点或组件。
- [x] 2026-08-16 自动门槛：根 `npm test` 核心 161/161、扩展 108/108；扩展 clean build、`git diff --check` 和 GameCore 边界扫描通过，插件 `dist` Git 跟踪数为 0。Creator/Web 人工验收仍单独记录。
- [x] Creator 已持久保存 ShipView/UIRoot/Main/Battle 引用；当前三场景更新分支只补齐缺失内容、修复失效引用并保留有效布局，不再执行破坏式 P8 全量重建；序列化资源测试确认应用根来源和 ShipView 接线，正式 Web 初始化 Console 0 warning / 0 error。
- [x] Web Desktop 实测左键/空白/Esc、右键禁用原因、网格悬浮、地板层级、普通地板停止、跨层连接器路径、刷新恢复，Console 0 warning / 0 error。
- [x] Codex 内置浏览器分别量测并持久截图电梯 5 Tick、楼梯 8 Tick；士兵巡逻被移动订单抢占后可停止，状态面板记录“恢复：已完成（10 Tick）”，最终 Web Console 0 warning / 0 error。
- [x] 当前已完成结果与截图补入 `docs/evidence/R1-P8-INTERACTION.md`；未勾项仍不得据此提前宣称 P7、P8 或完整 R1 完成。

## [x] P8.3：CSV 单链路创作工具、房间实时编辑与船体可视化重构

- [x] 运行时收敛为九张 CSV；`hulls.cellMask` 合并 `hull-cells.csv`；编辑器使用 `editor-prefabs.csv` 建立定义到 Prefab 的白名单映射。
- [x] 删除房间/船员/船体旧 JSON 创建、发现、编辑模块、旧创建面板、旧消息入口和对应测试；保留 PSS 来源 JSON 与存档/布局 JSON 的非配置用途。
- [x] 房间建筑页支持 CSV 草稿、150–240ms 防抖实时预览、非法输入保留最后合法表现、取消恢复、连接器校验、保存/reimport/全量回滚和实例一次 Undo。
- [x] 房间、船员、船体支持新建草稿、取消草稿和追加/覆盖 CSV；保存时自动补齐编辑器 Prefab 映射并再次执行整批校验。
- [x] 配置表页改为只读审计；旧 JSON 资产删除仅通过用户确认后的 Creator Asset DB 操作，不在运行时或启动时自动删除。
- [x] 九张 CSV 引用集中到 Main/Battle“应用根”的唯一来源；领域 Prefab 改用内存 DTO 预览，重建删除逐 Prefab 九表写入，并以资源状态与 650ms 静默窗口取代固定等待。
- [x] 2026-08-16 自动门槛：根 `npm test` 核心 161/161、扩展 108/108；扩展 2.0.0 clean build、TypeScript `--noEmit` 与 `git diff --check` 通过。
- [x] Creator 已持久化九张运行时 CSV、`editor-prefabs.csv`、共享 Prefab 与 Main/Battle 应用根引用，旧 `assets/config/rooms`、`crew`、`hulls` JSON/Meta 已从 Asset DB 结果中移除；后续场景更新沿用非破坏式固定分支。
- [x] Creator 已实测房间新建草稿与取消、船体 V/B/W Mask 草稿与取消、船员草稿与取消；页面预览统一由 `MainScreen` Inspector 的“编辑器预览页面”完成，场景页不再提供独立预览按钮。证据：`docs/evidence/R1-P8.3-creator-console-zero-after-cold-reopen.jpg`。
- [x] Web Desktop 实测持久房间、保存/刷新恢复、船体网格、选择/右键菜单和建造；正式构建 Console 0 warning / 0 error，证据已补入 `docs/evidence/R1-P8-INTERACTION.md`。
- [x] Creator 侧实时房间预览/取消/保存、V/B/W Mask、船员草稿、页面隔离与 Prefab 持久动画均已形成可见操作证据；P8.3 主项完成。巡逻与三工程师施工的连续动画证据仍归 P7/P8 收口，不在此重复扩大验收范围。

## [x] UI 三层核心 Prefab 与持久主页面迁移（ADR-0006）

- [x] `MainPageRouter` 改为五个持久页面 Node 引用，增加中文 Inspector 预览枚举；`UIRootController` 支持编辑器模式枚举实时切换；`MainSceneBootstrap` 直接持久引用 `BuildPageController`。
- [x] 创作工具预检收敛为 `UIRoot`、`MainScreen`、`BattleHUD`、`BuildOptionCard`、`PowerRoomRow` 五个正式 UI Prefab；扩展只公开 `create-or-update-scene` 一个场景消息，由三个固定分支执行分阶段 recording、失败取消和唯一 UIRoot 校验。
- [x] MainScreen 页面预览改为直接打开源 Prefab，按钮状态与视觉绑定入口指向 MainScreen；旧动态页面挂载/销毁入口已从运行时代码移除。
- [x] UI 收敛结果已保存五个 Prefab：MainScreen 持久包含五页、公共面板和导航贴图；UIRoot/MainScreen 组合已在编辑器中成功保存；旧单用途 Prefab 与 `SettingsPopup.ts` 已删除。证据：`docs/evidence/R1-UI-migration-backup-20260816.md`。
- [x] 生命周期/组合测试覆盖五页切换、重复点击、设置开关、建造页启停、卡片缓存、能源行动态增删和 Main/Battle 往返；BootScene-started Web Desktop build 在 1280×720 CSS 视口下 Console 0 warning / 0 error。证据：`docs/evidence/R1-UI-migration-backup-20260816.md`。
