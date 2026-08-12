# R0 完成清单

> 依据：`项目规范包/docs/16-测试-验收-DoD.md` 与 `项目规范包/docs/17-里程碑与任务顺序.md`。
> 历史状态：**R0 基础步骤 12 / 12 已完成并冻结**。本文件中的 Prototype 名称、旧 localStorage Key、历史测试数量和截图只说明当时的技术验证，不再描述当前 R1 接口。
> 当前进度唯一入口：`R1-FOUNDATION-CHECKLIST.md`。禁止继续把 R1 实现或新测试计数追加到本文件。

## 勾选与证据规则

- 只有该步骤的实现、验证和必要的人工/视觉证据全部完成，才把主复选框改为 `[x]`。
- 每个步骤都必须记录实际文件、执行命令或测试结果；涉及 Cocos 表现的步骤还必须保存截图。
- 涉及设计人员调整的内容，截图必须证明无需运行即可在编辑器中看到结果，并能看到中文 Inspector 属性。
- 网格化内容还必须提供编辑器拖动吸附、保存并重开后位置不漂移的人工验证记录。
- 持久截图和其他证据统一保存到 `docs/evidence/`，不得只引用临时目录。
- 无法执行的检查必须写明“未验证”及原因，不能以计划或口头判断代替完成证据。

## [x] M0-001 创建工程和基线验证

验收项：

- [x] 使用 Cocos Creator 3.8.8。
- [x] 创建 Empty 2D 工程。
- [x] 工程已纳入 Git 仓库。
- [x] 编辑器能够打开工程，控制台无报错。
- [x] 完成一次 Web Desktop 基线构建。
- [x] 在浏览器打开构建结果并检查 Console。

证据：

- 工程配置：`package.json` 中 `creator.version` 为 `3.8.8`。
- Git 检查：`git rev-parse --show-toplevel` 返回本项目根目录。
- 人工验收：2026-08-09 用户确认“没任何报错”。
- 视觉证据：[`docs/evidence/M0-001-cocos-editor-no-errors.png`](docs/evidence/M0-001-cocos-editor-no-errors.png)，可见 Cocos Creator 3.8.8、2D 项目、资源管理器已加载，底部错误计数为 0。
- 构建前置条件证据：[`docs/evidence/M0-001-build-blocked-no-scene.png`](docs/evidence/M0-001-build-blocked-no-scene.png)，Cocos 构建面板明确提示“当前项目没有任何场景文件，请先新建场景”。这不是构建失败；保存 M0-003 场景后继续本项。
- 构建成功证据：[`docs/evidence/M0-001-build-success-and-scene-saved.png`](docs/evidence/M0-001-build-success-and-scene-saved.png)，通知显示 `web-desktop` 于 2026-08-09 02:27:11 构建成功，用时 45 秒，编辑器错误计数为 0。
- 构建产物：`build/web-desktop/index.html` 及其资源文件已存在。
- 浏览器证据：[`docs/evidence/M0-001-browser-running-console.png`](docs/evidence/M0-001-browser-running-console.png)，Web Desktop 页面正常加载，Console 显示 PrototypeScene 加载完成；未见游戏脚本错误或资源加载错误。
- Console 说明：截图中额外信息为 Microsoft Edge 语言检测提示，不属于游戏阻断错误。

## [x] M0-002 建立基础目录

验收项：

- [x] 建立 `assets/scenes/`。
- [x] 建立 `assets/prefabs/`。
- [x] 建立 `assets/scripts/`。
- [x] 建立 `assets/textures/`。
- [x] 建立 `assets/bundles/`。

证据：

- 持久文件：scenes/scripts 已包含正式文件；尚为空的 bundles/prefabs/textures 使用 `.gitkeep` 保持可跟踪。
- 文件系统验证：逐一执行 `test -d`，五个目录均存在，命令退出码为 0。
- Cocos 导入证据：[`docs/evidence/M0-001-build-success-and-scene-saved.png`](docs/evidence/M0-001-build-success-and-scene-saved.png) 的资源管理器中可见 bundles、prefabs、scenes、scripts、textures 五个目录。

## [x] M0-003 创建 PrototypeScene

验收项：

- [x] 创建并保存 `PrototypeScene.scene`。
- [x] 场景包含 MainCamera、Canvas、Background、WorldRoot、ShipRoot、GridRoot、房间容器、PreviewRoot、UIRoot 和 AppRoot；运行时与插件同时兼容旧英文 `RoomRoot`。
- [x] 场景可正常打开和运行，无阻断错误。

证据：

- 场景文件：`assets/scenes/PrototypeScene.scene` 及对应 `.meta` 已由 Cocos 创建。
- 保存证据：[`docs/evidence/M0-001-build-success-and-scene-saved.png`](docs/evidence/M0-001-build-success-and-scene-saved.png) 显示窗口标题和资源管理器中的 PrototypeScene。
- 层级证据：[`docs/evidence/M0-003-scene-hierarchy.png`](docs/evidence/M0-003-scene-hierarchy.png) 显示完整展开的目标节点结构，编辑器错误计数为 0。
- 文件验证：在 `assets/scenes/PrototypeScene.scene` 中检索到 9 个既有英文节点和新补齐的中文语义节点“房间容器”，合计 10 个目标节点。
- 运行证据：[`docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png`](docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png) 显示 PrototypeScene 已运行、网格已渲染，Console 无游戏阻断错误。

## [x] M0-004 实现 ShipGridModel

验收项：

- [x] 实现 20×10 纯 TypeScript 逻辑网格。
- [x] 网格只保存逻辑坐标和可序列化状态，不引用 `cc`。
- [x] 正常、边界和错误分支测试通过。

证据：

- 实现文件：`assets/scripts/game-core/ShipGridModel.ts`。
- 测试文件：`tests/game-core/ShipGridModel.test.ts`；测试位于 `assets/` 外，避免 Cocos 导入 Node 测试 API。
- 纯净边界：搜索 `assets/scripts/game-core/` 未发现 `cc` import 或 `cc.` 引用。
- 单元测试：2026-08-11 执行 `npm run test:core`，当前完整套件共 24 项，24 项通过、0 项失败；其中 ShipGridModel 的正常、边界和错误分支均通过。
- 隔离类型检查：使用 Cocos Creator 3.8.8 内置 TypeScript 5.8.2 对 GameCore 文件执行 `--strict --noEmit`，退出码为 0。

## [x] M0-005 显示逻辑网格

验收项：

- [x] 在 PrototypeScene 中显示并居中 20×10 网格。
- [x] 逻辑坐标到 Cocos 本地坐标的转换由 View 层负责。
- [x] 在目标桌面分辨率下网格清晰可见且位置正确。
- [x] PrototypeSceneSettings 已由编辑器持久挂载到 AppRoot，并引用 GridRoot。
- [x] GridRoot 已移除全部 ShipGridView，仅保留场景设置驱动的 UITransform/Graphics。
- [x] Inspector 使用中文属性、提示和分组，修改尺寸后预览立即刷新。

证据：

- 场景设置与表现实现：`assets/scripts/bootstrap/PrototypeSceneSettings.ts`，作为 AppRoot 上唯一网格参数入口并负责编辑器网格预览、坐标转换和吸附基准。
- 装配入口：`assets/scripts/bootstrap/PrototypeBootstrap.ts`，运行时读取场景设置创建纯 TS 网格并绑定既定实例。
- 静态检查：Cocos 类型声明下的严格 TypeScript 检查通过。
- 运行证据：[`docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png`](docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png) 显示 1280×720 预览中的完整 20×10 网格。
- 问题证据：[`docs/evidence/M0-editor-grid-duplicate-before-scene-settings.png`](docs/evidence/M0-editor-grid-duplicate-before-scene-settings.png) 显示 GridRoot 出现两个 ShipGridView，证明组件级配置会形成重复来源；同图还记录了冗余 Color `type` 装饰器警告。
- 修复实现：网格参数、外观和吸附已迁移到唯一 PrototypeSceneSettings；Color 属性已移除多余 `type` 声明。
- 场景挂载证据：[`docs/evidence/M0-scene-settings-grid-position-before-center.png`](docs/evidence/M0-scene-settings-grid-position-before-center.png) 显示单一 PrototypeSceneSettings 已挂载并引用 GridRoot。
- 二次问题证据：[`docs/evidence/M0-grid-position-after-zero-before-world-refresh.png`](docs/evidence/M0-grid-position-after-zero-before-world-refresh.png) 显示 WorldRoot、ShipRoot、GridRoot 坐标归零后网格仍落在 Canvas 左下方，排除了节点局部坐标错误。
- 修复前现场文件证据：场景曾保存为 30×10、48 像素，即 1440×480；修复后已恢复为 20×10、48 像素，即 960×480。
- 修复：`PrototypeSceneSettings` 在编辑态绘制与坐标换算前，从 Canvas 子树重新计算 Cocos 世界矩阵，不改动设计人员保存的节点坐标。
- 自动验证：Cocos 3.8.8 类型声明下的 TypeScript 检查通过；当前 GameCore/应用核心测试 36/36 通过。
- 居中预览证据（待保存）：[`docs/evidence/M0-005-grid-centered-before-save.png`](docs/evidence/M0-005-grid-centered-before-save.png) 显示 20×10 网格已在 1280×720 白框内水平、垂直居中；截图标题带 `*`，因此尚不作为持久场景完成证据。
- 最终持久证据：[`docs/evidence/M0-005-M0-007-editor-grid-room-saved.png`](docs/evidence/M0-005-M0-007-editor-grid-room-saved.png) 的标题不带 `*`，显示保存后的 20×10 居中网格；磁盘场景同时记录 `gridColumns=20`、`gridRows=10`、`cellSize=48` 和 GridRoot `960×480`。

## [x] M0-006 实现镜头控制

验收项：

- [x] 支持鼠标拖动视图。
- [x] 支持滚轮缩放。
- [x] 缩放具有最小值和最大值限制。
- [x] 镜头输入不修改 GameCore 状态。
- [x] CameraController 已由编辑器持久挂载到 AppRoot。
- [x] 缩放范围和步长以中文 Inspector 属性显示。

证据：

- 实现文件：`assets/scripts/input/CameraController.ts`。
- 引擎复用：直接使用 Cocos `Node.EventType`、`Node.setPosition()` 和 `Node.setScale()`；未自建输入或相机系统。
- 架构边界：组件只改变 `WorldRoot` 的位置和缩放，不修改 GameCore。
- 静态检查：Cocos 类型声明下的严格 TypeScript 检查通过。
- 初次失败证据：[`docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png`](docs/evidence/M0-003-M0-005-grid-running-M0-006-input-failed.png)，用于记录全局输入监听在该预览环境中没有响应。
- 修复与人工验收：监听改为 Cocos Canvas 节点鼠标事件；2026-08-09 用户复测确认点击拖动和缩放正常。
- 编辑器实现：CameraController 已配置中文组件菜单、中文属性名称、提示和分组；Bootstrap 不再运行时临时挂载该组件。
- 编辑器证据：[`docs/evidence/M0-005-grid-centered-before-save.png`](docs/evidence/M0-005-grid-centered-before-save.png) 显示 AppRoot 上持久挂载的 CameraController，以及“最小缩放”“最大缩放”“单次缩放步长”等中文 Inspector 字段；场景文件保存相同组件配置。

## [x] M0-007 创建 2×2 ReactorRoom

验收项：

- [x] 反应堆房间逻辑尺寸为 2×2。
- [x] 房间使用稳定字符串 ID 和可序列化配置。
- [x] 表现使用 Prefab/配置实例化，不把 Node 写入 GameCore。
- [x] ReactorRoom Prefab 实例已放入语义 RoomRoot（当前节点名“房间容器”），编辑器中可见且可拖动吸附。
- [x] RoomView 以中文 Inspector 绑定房间定义并调整外观；逻辑尺寸来自 JSON，吸附开关由场景设置统一提供中文字段。
- [x] 房间规则迁移为版本化 JSON，并由纯 TypeScript 解析器统一校验。
- [x] 项目扩展已实现“新建房间建筑”中文表单、重名保护和失败回滚。
- [x] Cocos 扩展管理器项目内扩展列表已显示并启用 `starship-editor-tools`；资源管理器右键菜单和中文表单已人工验证。
- [x] ReactorRoom Prefab 已在 Inspector 绑定 `room-reactor.json`，两个场景实例运行、拖放、保存与刷新恢复正常。
- [x] 禁用 `starship-editor-tools` 后重新执行 Web Desktop Build，游戏仍可运行。

证据：

- 配置：`assets/config/rooms/room-reactor.json` 是稳定 ID `room-reactor` 和 2×2 规则的唯一数据源；`RoomDefinition.ts` 只保留类型与不可信 JSON 解析器。
- 表现：`assets/scripts/presentation/RoomView.ts`，复用 Cocos Graphics/UITransform 绘制，不自建渲染系统。
- 实例化：`assets/scripts/bootstrap/PrototypeBootstrap.ts` 已使用 Cocos Prefab + `instantiate()`；场景中存在编辑器实例时优先复用，缺失时才走备用实例化。
- 测试：2026-08-12 执行根目录 `npm test`，当前 GameCore/Application 55/55、安全 9/9、安全 API 3/3 通过。
- 编辑器插件：`extensions/starship-editor-tools/` 使用 TypeScript `src → dist`；单一宿主注册房间与当前 R1 船员领域，未实现的普通 NPC/关卡没有空实现。
- 插件测试：2026-08-12 在扩展目录执行 `npm test`，当前 71/71 通过；覆盖资源事务、自动绑定、自动发现、公开创作面板、房间/船员语义实例、骨架快照、Cocos INode `__comps__` 归一化、公开 `set-property`、R1 能源与船员场景收口、Prefab 关联、能源行局部定位，以及单次原子 Undo。
- 自动证据：[`docs/evidence/M0-007-editor-tools-verification.md`](docs/evidence/M0-007-editor-tools-verification.md)。
- 扩展管理器证据：[`docs/evidence/R1-CREW-extension-manager-v1.5.0.png`](docs/evidence/R1-CREW-extension-manager-v1.5.0.png) 显示 Creator 3.8.8 已识别并启用 `starship-editor-tools v1.5.0`；禁用回归仍见 [`docs/evidence/M0-007-extension-manager-disabled.jpg`](docs/evidence/M0-007-extension-manager-disabled.jpg) 与 [`docs/evidence/M0-007-extension-manager-reenabled.jpg`](docs/evidence/M0-007-extension-manager-reenabled.jpg)。
- 插件菜单与表单：[`docs/evidence/M0-007-editor-plugin-menu.png`](docs/evidence/M0-007-editor-plugin-menu.png)、[`docs/evidence/M0-007-editor-plugin-form.png`](docs/evidence/M0-007-editor-plugin-form.png)。
- 创建与不覆盖：[`docs/evidence/M0-007-editor-plugin-create-success.png`](docs/evidence/M0-007-editor-plugin-create-success.png) 显示 AssetDB 已创建 `room-new.json + NewRoom.prefab`；[`docs/evidence/M0-007-editor-plugin-no-overwrite.png`](docs/evidence/M0-007-editor-plugin-no-overwrite.png) 显示重复创建明确拒绝，创建前后两份资源 SHA-256 相同。验收后已删除 4 个临时测试文件，正式资源未改动。
- 定义绑定：[`docs/evidence/M0-007-editor-prefab-definition-binding.png`](docs/evidence/M0-007-editor-prefab-definition-binding.png) 显示中文“房间定义”绑定 `room-reactor.json`。
- 重开与双实例：[`docs/evidence/M0-007-editor-cold-reopen-two-rooms.png`](docs/evidence/M0-007-editor-cold-reopen-two-rooms.png) 显示 Creator 冷启动后两个实例仍可见且 Console 为 0；[`docs/evidence/M0-007-two-rooms-runtime.png`](docs/evidence/M0-007-two-rooms-runtime.png) 显示两个房间同时运行。
- 运行证据：[`docs/evidence/M0-007-reactor-runtime.png`](docs/evidence/M0-007-reactor-runtime.png) 显示橙色 2×2 ReactorRoom 已按配置实例化。
- 编辑器问题证据：[`docs/evidence/M0-007-editor-preview-missing-before-fix.png`](docs/evidence/M0-007-editor-preview-missing-before-fix.png) 记录原实现只在运行时绘制、编辑器不可见的问题。
- 编辑器现状证据：[`docs/evidence/M0-editor-room-before-scene-settings.png`](docs/evidence/M0-editor-room-before-scene-settings.png) 显示房间已在编辑器可见且中文字段已生效；[`docs/evidence/M0-editor-hierarchy-before-scene-settings.png`](docs/evidence/M0-editor-hierarchy-before-scene-settings.png) 显示 ReactorRoom 已作为 Prefab 实例放入语义 RoomRoot。
- 编辑器可视化修复：RoomView 使用 Cocos `executeInEditMode` 和节点变换事件；吸附与格子尺寸统一读取 AppRoot 的 PrototypeSceneSettings；Bootstrap 优先复用语义 RoomRoot（中文或英文别名）中的 Prefab 实例。
- 拖动吸附证据（待保存）：[`docs/evidence/M0-007-room-snapped-before-save.png`](docs/evidence/M0-007-room-snapped-before-save.png) 显示 2×2 ReactorRoom 已拖入网格并吸附到 `(-288, -96)`；该坐标符合 48 像素网格步长，但截图标题仍带 `*`，暂不作为持久场景完成证据。
- 保存证据：[`docs/evidence/M0-005-M0-007-editor-grid-room-saved.png`](docs/evidence/M0-005-M0-007-editor-grid-room-saved.png) 标题不带 `*`，显示语义 RoomRoot 下的 Prefab 实例、中文 RoomView 属性和吸附后的房间；当前磁盘场景的最新复核见本节“当前 HEAD 复核”。
- 插件关闭回归：[`docs/evidence/M0-007-plugin-disabled-build-verification.md`](docs/evidence/M0-007-plugin-disabled-build-verification.md) 记录历史 Creator 3.8.8 重新构建、正式产物启动、双房间拖放、刷新恢复、镜头缩放/平移及浏览器日志检查；本轮更近期证据见 [`docs/evidence/M0-007A-plugin-disabled-regression.md`](docs/evidence/M0-007A-plugin-disabled-regression.md)。
- 当前 HEAD 复核：[`docs/evidence/M0-current-head-reverification.md`](docs/evidence/M0-current-head-reverification.md) 记录单反应堆与电梯/激光/护盾四个真实 Prefab 实例、Creator 重新打开场景、正式 Web Desktop 重建及构建产物回归。

## [x] M0-007A 语义化编辑器创作增强（不计入基础 R0 12 步）

验收项：

- [x] 资源管理器房间表单创建 JSON + Prefab，并在创建成功后自动绑定“房间定义”并保存。
- [x] 房间列表按 JSON + Prefab 真实依赖自动发现，非法 JSON、缺失绑定和多重绑定进入警告且不进入菜单。
- [x] 项目/Panel 菜单收敛为打开可停靠“星舰创作工具”，面板调用标准 Prototype 场景骨架补齐逻辑，重名/错误父级时停止并回滚。
- [x] 面板显示期间轮询公开 Selection，隐藏/关闭时停止；执行创建前重新校验选择和场景。
- [x] 房间实例创建使用语义 RoomRoot 路由、唯一 ID、GameCore 首个合法空位和失败回滚。
- [x] Cocos 可停靠创作面板、标准骨架、房间自动列表、自动绑定 Prefab 和一次 Undo/Redo 截图已取得并保存。
- [x] Cocos 新建/补齐标准骨架后，层级管理器实际显示中文节点：主相机、画布、背景层、世界根、飞船根、网格根、房间容器、预览根、界面根和应用根；证据为 [`docs/evidence/M0-007A-chinese-standard-skeleton-10-nodes.png`](docs/evidence/M0-007A-chinese-standard-skeleton-10-nodes.png)。
- [x] 关闭插件后重新打开工程、构建和运行的人工回归截图已补齐本增强项证据。

自动证据：

- 扩展构建与测试：2026-08-12 在 `extensions/starship-editor-tools/` 执行 `npm test`，71/71 通过；覆盖房间与船员资源事务、自动绑定、Prefab 发现、CID/类名识别、公开 Selection、可见期间轮询与隐藏清理、四页切换、中文属性编辑、语义父节点、唯一实例 ID、首个合法空位、R1 能源/船员场景收口、PowerRoomRow 局部定位、回滚、骨架和单次原子 Undo。
- 核心回归：根目录执行 `npm test`，GameCore/Application、安全、安全 API 套件全部通过（55 + 9 + 3 项）。
- 持久说明：[`docs/evidence/M0-007A-dockable-authoring-panel-implementation.md`](docs/evidence/M0-007A-dockable-authoring-panel-implementation.md)；10 节点中文骨架见 [`docs/evidence/M0-007A-chinese-standard-skeleton-10-nodes.png`](docs/evidence/M0-007A-chinese-standard-skeleton-10-nodes.png)；420px 窄面板见 [`docs/evidence/M0-007A-authoring-panel-420-css-px.png`](docs/evidence/M0-007A-authoring-panel-420-css-px.png)。
- UI 实现：面板源码统一中文文案，当前采用“场景 / 房间建筑 / 船员 / 校验”四页、分类筛选、资源列表和右侧直接编辑检查器；场景状态、领域内容和操作反馈拆成卡片/徽标/分级提示，并支持内容区滚动和约 420px 单列布局。
- 语义命名：创作面板新建骨架时实际写入中文 Node 名（“画布/世界根/飞船根/房间容器”等），运行时和插件通过语义别名兼容 `Canvas/WorldRoot/ShipRoot/RoomRoot` 等旧英文场景；已有英文场景不自动改名。

## [x] M0-008 实现 PlacementValidator

验收项：

- [x] 检查整数网格坐标。
- [x] 检查越界。
- [x] 检查非有效船体格。
- [x] 检查与已有房间重叠。
- [x] 合法与非法分支测试通过。

证据：

- 实现：`assets/scripts/game-core/ShipGridModel.ts` 中的 `validateRoomPlacement`，与占用写入共用同一校验入口。
- 覆盖分支：非整数、非正尺寸、越界、无效船体格、重叠、重复 ID、合法放置和移除。
- 测试结果：`npm run test:core` 当前完整套件通过 36/36，退出码为 0。

## [x] M0-009 实现拖放和预览

验收项：

- [x] 支持拖动 2×2 房间并对齐网格。
- [x] 编辑器中拖动初始房间会自动吸附最近逻辑格。
- [x] 合法位置显示合法预览并可放置。
- [x] 越界、无效格和重叠位置显示非法预览且不能放置。
- [x] 输入层只生成 Command，不直接篡改核心状态。

证据：

- 编辑器吸附：[`docs/evidence/M0-005-M0-007-editor-grid-room-saved.png`](docs/evidence/M0-005-M0-007-editor-grid-room-saved.png) 显示保存后的 2×2 房间已按 48 像素逻辑网格吸附。
- Command 边界：`RoomView` 只创建 `MOVE_ROOM` 并调用注入的预检/提交回调；原子校验与状态更新位于纯 TypeScript `ShipGridModel.validateRoomMove()` / `moveRoom()`。
- 输入协调：房间拖动开始时通过装配回调暂停 `CameraController` 镜头平移，结束或组件禁用时恢复，避免同一鼠标事件同时移动房间和镜头。
- 快速拖动修复：Canvas 监听移动和正常抬起、Cocos 全局 `input` 兜底 Canvas 外抬起，并移除会提前终止的 Canvas `MOUSE_LEAVE`；`http://localhost:7456/` 已完成正常拖动、快速拖动、松开后移鼠标与越界回滚验证，均未再出现粘着。
- 视觉证据：[`docs/evidence/M0-009-normal-drop-released.png`](docs/evidence/M0-009-normal-drop-released.png)、[`docs/evidence/M0-009-fast-drag-released.png`](docs/evidence/M0-009-fast-drag-released.png) 与 [`docs/evidence/M0-009-invalid-edge-rollback.png`](docs/evidence/M0-009-invalid-edge-rollback.png)。
- 无效格证据：SceneSettings 统一配置并绘制左上角 2×2 无效船体格，见 [`docs/evidence/M0-009-invalid-hull-cells-visible.png`](docs/evidence/M0-009-invalid-hull-cells-visible.png)；拖入后松开会回滚原位，见 [`docs/evidence/M0-009-invalid-hull-drop-rollback.png`](docs/evidence/M0-009-invalid-hull-drop-rollback.png)。
- 镜头回归：房间拖动结束后，空白区域平移与滚轮缩放仍正常，见 [`docs/evidence/M0-009-camera-pan-after-room-drop.png`](docs/evidence/M0-009-camera-pan-after-room-drop.png) 与 [`docs/evidence/M0-009-camera-zoom-after-room-drop.png`](docs/evidence/M0-009-camera-zoom-after-room-drop.png)。
- 坐标回归：先平移并缩放 WorldRoot 后继续拖动房间，仍能正确吸附和提交，见 [`docs/evidence/M0-009-drag-after-camera-transform.png`](docs/evidence/M0-009-drag-after-camera-transform.png)。
- 编辑器创建工作流：`ReactorRoom.prefab` 持久保存 `UITransform + Graphics + RoomView`；RoomView 缺组件时给出可执行中文错误，不再用装饰器向两个 Prefab 实例重复补组件。项目扩展通过 AssetDB 复制该完整模板。
- 合法预览：[`docs/evidence/M0-009-valid-green-preview.png`](docs/evidence/M0-009-valid-green-preview.png) 显示拖动过程中的绿色边框；松开后房间吸附到合法格。
- 重叠预览与回滚：[`docs/evidence/M0-009-overlap-red-preview.png`](docs/evidence/M0-009-overlap-red-preview.png) 显示两个房间重叠时红色边框；[`docs/evidence/M0-009-overlap-release-rollback.png`](docs/evidence/M0-009-overlap-release-rollback.png) 显示松开后回到原合法格。
- 双房间快速释放：[`docs/evidence/M0-009-two-room-fast-drag-released.png`](docs/evidence/M0-009-two-room-fast-drag-released.png) 显示快速拖动并把鼠标移远后，房间保持吸附且边框恢复黄色，不再粘着。
- 自动验证：[`docs/evidence/M0-009-implementation-verification.md`](docs/evidence/M0-009-implementation-verification.md) 保留拖放实现证据；当前完整 GameCore 套件为 36/36 通过。

## [x] M0-010 保存 JSON

验收项：

- [x] 布局可序列化为 JSON。
- [x] JSON 包含 `schemaVersion` 和稳定字符串 ID。
- [x] 保存到 localStorage，不包含 Cocos Node、Prefab 或世界坐标。
- [x] 保存失败具有可观察的错误处理。

证据：

- 快照实现：`assets/scripts/game-core/ShipGridModel.ts` 中的 `createShipLayoutSnapshot()`、`serializeShipLayout()` 和 `restoreShipLayout()`；GameCore 不引用 DOM、Cocos 或 localStorage。
- Web 适配：`assets/scripts/bootstrap/PrototypeLayoutStorage.ts` 使用浏览器原生 localStorage，读写和隐私模式访问异常均转换为可观察结果。
- 场景接线：`PrototypeBootstrap` 只在 `moveRoom()` 成功后保存；保存失败使用 Cocos `error()` 输出 `[SAVE]` 错误。
- 自动验证：[`docs/evidence/M0-010-M0-011-persistence-verification.md`](docs/evidence/M0-010-M0-011-persistence-verification.md) 保留持久化验证；当前完整 GameCore 套件为 36/36 通过。
- Web 端到端证据：[`docs/evidence/M0-010-browser-valid-drop-saved.png`](docs/evidence/M0-010-browser-valid-drop-saved.png) 记录成功放置后的布局；随后刷新捕获到 `[SAVE] 已从 localStorage 恢复 R0 飞船布局`，证明真实 localStorage 保存/读取链路已执行。
- 数据边界证据：存储键为 `starship-protocol:r0:ship-layout`；JSON 只包含 `schemaVersion`、逻辑网格尺寸与稳定房间 ID/整数逻辑坐标/逻辑尺寸，源码与往返测试均未包含 Cocos Node、Prefab 或世界坐标。

## [x] M0-011 刷新后恢复

验收项：

- [x] 页面刷新后可从 localStorage 恢复布局。
- [x] 恢复结果与保存前一致。
- [x] 损坏或不兼容数据不会导致黑屏，并有明确回退处理。

证据：

- 原子恢复：先把不可信 JSON 恢复到临时 `ShipGridModel`，全部房间通过统一放置校验后才返回；不会暴露半恢复状态。
- 兼容边界：校验 `schemaVersion=1`、网格尺寸、房间字段、整数坐标、稳定 ID、重复 ID、越界和重叠。
- 场景回退：空存档使用编辑器布局；损坏、不兼容或与当前场景房间实例集合不一致时记录 `[SAVE]` 警告并回退编辑器布局。
- 自动验证：[`docs/evidence/M0-010-M0-011-persistence-verification.md`](docs/evidence/M0-010-M0-011-persistence-verification.md) 记录 JSON 往返一致及损坏分支测试。
- 浏览器恢复证据：保存前截图 [`docs/evidence/M0-010-browser-valid-drop-saved.png`](docs/evidence/M0-010-browser-valid-drop-saved.png) 与单房间刷新证据 [`docs/evidence/M0-011-browser-refresh-restored.png`](docs/evidence/M0-011-browser-refresh-restored.png) 验证基础链路；当前双房间刷新证据 [`docs/evidence/M0-011-two-room-refresh-restored.png`](docs/evidence/M0-011-two-room-refresh-restored.png) 进一步证明场景实例集合可整体恢复。运行日志明确输出 `[SAVE] 已从 localStorage 恢复 R0 飞船布局`，干净预览页 Console 为 0 error/warning。

## [x] M0-012 Web Desktop 构建与最终验收

验收项：

- [x] Web Desktop 构建成功。
- [x] Edge 与内置浏览器可正常打开。
- [x] 刷新后仍可运行且布局恢复正确。
- [x] 资源路径正确，拖放、缩放和镜头拖动正常。
- [x] 浏览器 Console 无阻断级错误。
- [x] 对照 R0 验收清单逐项复核通过；M0-007 的插件启用与禁用回归也已取得独立证据。

证据：[`docs/evidence/M0-012-web-desktop-final-verification.md`](docs/evidence/M0-012-web-desktop-final-verification.md)；当前 HEAD 的重新构建与浏览器回归见 [`docs/evidence/M0-current-head-reverification.md`](docs/evidence/M0-current-head-reverification.md)。
