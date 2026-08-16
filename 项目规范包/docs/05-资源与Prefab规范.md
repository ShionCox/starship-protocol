# 资源与Prefab规范

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


# 8. 资源架构

## 8.1 Asset Bundle

当前 R1 Web Desktop 基线使用 Creator 内置 `main` Bundle：BootScene 作为启动入口，MainScene 预加载 BattleScene；Boot/Battle 使用场景资源自动释放。Web Desktop 不提供小游戏平台的初始场景分包。下列自定义 Bundle 是资源规模增长后的目标拆分，不在只有少量持久场景资源时提前搬迁。

建议：

```text
bundle-common
bundle-login
bundle-main
bundle-ship
bundle-room
bundle-crew
bundle-battle
bundle-fx
bundle-audio
bundle-localization
```

原则：

- Boot 首包尽量小；
- 战斗资源进入战斗前预加载；
- 不使用的 bundle 可以释放；
- 大型音频单独分包；
- UI 公共资源避免重复打包；
- Scene / Prefab 作为主要 bundle 入口。

## 8.2 Prefab 策略

Prefab 用于 `assets/ui/prefabs/` 下的 `UIRoot`、页面、HUD、面板、弹窗，以及 `assets/prefabs/` 下的 `ShipView`、船体外观、RoomView、CrewView、ProjectileView、ExplosionView 和施工表现。

UI 资源统一放在 `assets/ui/`：`assets/ui/prefabs/` 保存可独立编辑的 UI Prefab，`assets/ui/textures/` 保存框架、按钮和导航图标。领域 Prefab 不随 UI 目录迁移，避免 CSV-Prefab 映射与运行时资源目录混杂。

禁止把运行期可能出现的所有房间和船员副本都手工摆在 Scene 中。初始布局、教学样例和设计校验允许并推荐放置代表性 Prefab 实例。

重复内容必须采用：

```text
Prefab + 配置数据 + instantiate
```

## 8.3 编辑器可视化与场景搭建

以下规则适用于所有需要设计人员调整的 Scene、Prefab、UI、房间、船体、特效锚点和视觉参数：

- 无需点击运行预览，就能在场景编辑器或 Prefab 编辑器中看到代表性外观、尺寸、锚点和层级。
- 需要长期保留的 Component 必须由编辑器挂载并序列化；Bootstrap 不得用运行时 `addComponent()` 隐藏设计配置入口。
- View 对 `UITransform`、`Graphics` 等必需组件使用 Cocos 原生 `@requireComponent` 声明；设计人员添加 View 时由引擎自动补齐依赖，Prefab 仍需把最终组件持久保存为可见资产。
- 设计人员可调整的视觉尺寸、颜色、间距、层级引用、Prefab 引用和交互开关必须暴露到 Inspector，不得散落为脚本硬编码常量；房间逻辑宽高等规则字段使用 P8 权威 CSV 和插件表单，不在 View 上保留副本。
- 规则网格只允许一个来源：列数、行数、`VOID / BUILDABLE / FIXED_WALL` 格类型、船员上限、房间上限和施工槽来自 `HullDefinition`；`ShipView` 只暴露格子像素尺寸、颜色、层级引用和表现开关。
- Inspector 的显示名称、工具提示和分组使用中文；代码属性名、类名、Prefab/Scene 文件名和稳定业务 ID 仍按英文命名规范执行。Boot/Main/Battle 新骨架只创建中文语义 Node。
- `executeInEditMode` 只用于轻量预览、尺寸刷新、锚点辅助和编辑器吸附，不在编辑器生命周期中运行完整 GameCore 或产生不可控资产修改。
- Bootstrap 只连接编辑器中已有的初始实例，不提供正式节点缺失时的运行时备用路径。动态生成只用于玩家 Command 确认后的内容和对象池对象。

### 网格内容拖动吸附

- 房间、船员站位、武器槽等网格化内容在编辑器中拖动时，必须吸附到最近的项目逻辑格或项目定义锚点。
- 优先使用 Cocos 节点变换事件、编辑器执行模式和 Transform 能力做薄适配，不建立第二套场景编辑器。
- 吸附结果必须在场景中立即可见，并支持撤销、保存和重新打开后保持一致。
- 编辑器世界/本地坐标只作为设计输入；装配时转换为整数逻辑坐标，再由 GameCore 检查越界、无效格和重叠。
- 多层父节点、缩放或位移存在时，必须通过世界坐标与目标父节点坐标转换，禁止假设 GridRoot 与 RoomRoot 坐标恒等。

### 编辑器资产验收

- Scene 可打开，层级完整，关键组件已持久挂载。
- ShipView 的 HullDefinition 引用有效；Scene/RoomView 不存在第二份规则网格配置。
- Prefab 可单独打开并看到外观，不依赖运行时 `bind()` 才出现。
- 中文 Inspector 字段可修改，修改后预览立即刷新。
- 网格对象拖动后自动吸附，保存并重开位置不漂移。
- 运行场景后不重复生成编辑器中已经存在的实例。
- 项目内高频创建的标准 Prefab 可以通过 Cocos 官方 `contributions.assets.menu` 扩展到资源管理器“新建”菜单；菜单只复制已验收模板，不自行拼装 `.prefab` / `.meta` 序列化内容。

### 项目级编辑器扩展

创作工具可识别类型的稳定 ID、识别器顺序、白名单 DTO、字段读写边界和接入检查表统一见 [`19-Cocos创作工具类型接入规范.md`](./19-Cocos创作工具类型接入规范.md)。本节只保留资源与 Prefab 的边界规则。

- 全项目只保留 `extensions/starship-editor-tools/` 一个创作工具宿主；房间、NPC、关卡按领域模块注册，不各建一套扩展生命周期。
- 场景、配置表、船体、飞船、房间、船员、素材与校验统一从同一个“星舰创作工具”面板进入；P8 新内容不再创建单项 JSON 定义。
- “配置表”分页审计九张运行时 CSV（七张玩法表与两张视觉表）及一张 `editor-prefabs.csv` 映射表；领域页编辑白名单行，写入前在内存中解析全部表并校验跨表引用，禁止部分合法时继续保存。
- 整批保存必须有回滚：中途失败时逆序恢复本批已写入的原内容，回滚失败也必须给出明确文件和残留状态。
- 插件通过 Asset DB `create-asset`、`copy-asset`、`delete-asset`、`open-asset` 等公开消息操作资源，不直接写 `.prefab` / `.meta` 序列化文本。
- 新领域 Prefab 创建后插件自动打开资源，用公开 Scene 消息写入稳定 `definitionId`，并从整批 CSV 生成白名单内存 DTO 驱动预览；DTO 不写回 Prefab。插件校验 View、UITransform、Graphics 后只保存代表性外观，CSV 无效或稳定 ID 不匹配时不能验收。
- 目录不维护第二份规则清单：插件只把“整批 CSV 中存在有效定义 + 有明确 Prefab 映射”的内容放入可创建列表；无效、缺失或重复映射进入中文校验警告。
- CSV + Prefab 是项目级资源库，不绑定某个 Scene；扩展监听公开 `asset-db:asset-change`，重新导入后重建目录并通知面板。手动刷新只作为故障恢复入口。
- 创作面板只在明确选中的 `ShipView` 内创建房间，在明确选中的 RoomView 内创建船员；禁止回退到 Canvas、场景根或跨舰搜索。
- 初始样例实例由所属 ShipView 在 `BUILDABLE` 格和已完成地板支撑约束下查找合法位置，生成该飞船内唯一实例 ID；网格已满、墙体/预留冲突、支撑缺失或组件无效时必须在单次 Undo 中回滚。
- 发现已有房间、地板、坐标、实例 ID 或占用校验失败时必须 fail-closed，不能跳过非法实例继续寻找空位。
- 场景骨架只创建 Boot/Main/Battle 缺失的中文节点和组件；遇到重名或错误父级停止并回滚，不创建能源/船员等一次性玩法内容。
- 面板显示期间每 500ms 读取公开 Selection，隐藏/关闭时停止；执行创建前必须重新查询场景和选择，不能依赖缓存状态。禁止层级私有右键适配器、`cce.*` 和 DOM 注入。
- 创作面板采用左侧领域分页、分类筛选、资源列表和右侧中文属性检查器；已接入领域的规则字段通过公开 Asset DB `save-asset` / `reimport-asset` 保存 CSV。稳定 ID、Prefab 引用和资源路径保持只读，保存前重新读取全部关联表，避免面板缓存覆盖外部修改。
- 面板选择联动只在 UUID 变化时自动切页；实例字段只读，定义字段通过白名单表单编辑。新增 NPC、关卡等类型必须先按 [`19-Cocos创作工具类型接入规范.md`](./19-Cocos创作工具类型接入规范.md) 显式注册，不得自动暴露全部组件字段。
- Prefab 保存颜色、组件、锚点与资源引用；CSV 保存版本、稳定 ID、分类、逻辑尺寸和规则数值，禁止写 Node 或世界坐标。
- 船员分页消费 `crews.csv` 与 `crew-traits.csv`，支持 Prefab 绑定、场景实例化、Selection 识别、单次 Undo 和失败回滚；不创建第二个插件。
- `CrewMember.prefab` 是船员模板，四职业 Prefab 保存各自 definitionId 与职业外观；Prefab 内实例 ID 必须为空，由飞船场景创作分配。巡逻路线属于士兵实例配置，不写回职业定义。
- `PowerRoomRow.prefab` 是重复能源控制行模板；`PowerPanel` 按快照在持久容器中复用/实例化模板，房间拆除后移除对应行，不保留未知房间幽灵行。
- `ShipView.prefab` 内实例 ID 为空，包含船体外观层、网格根、房间容器、地板容器、船员层、特效层和施工预览容器；船体外观以持久 `Sprite + HullAppearance` 消费视觉 CSV，Main/Battle 的场景实例由插件生成唯一 `shipId` 并绑定已验证 HullDefinition。
- 九张运行时 CSV 的 `TextAsset` 引用只保存于 MainScene/BattleScene“应用根”的唯一 `GameConfigCsvSource`。场景 ShipView 指向同场景来源，Room/Crew 从所属 ShipView 读取；ShipView/Room/Crew Prefab 不挂载该组件。独立 Prefab 由创作工具内存 DTO 预览，直接双击时显示最近一次保存的代表性外观。
- `UIRoot.prefab` 是 Main/Battle 唯一公共 UI 源，包含分层根节点和持久嵌套模块；业务 Page 均为独立 Prefab。
- `MainScreen.prefab` 保存主导航、顶栏、页面挂载点、`PowerPanel.prefab` 和 `CrewStatusPanel.prefab`；五个主页面只写入 `MainPageRouter` 的 Prefab 引用，页面挂载点保存时必须为空。
- `BattleHUD.prefab`、`WorldContextMenu.prefab`、`SettingsPopup.prefab`、`DemolitionConfirmDialog.prefab` 和 `OfflineSettlementDialog.prefab` 可单独打开、移动和保存，再作为 UIRoot 的嵌套 Prefab 实例使用。嵌套模块不通过运行时脚本补节点。
- 主页面的运行时生命周期固定为“校验 Prefab → instantiate → 挂载/绑定 → 停用并 destroy 旧页”；只销毁实例节点，不主动释放 `main` Bundle 中的 Prefab、贴图或其他资源。
- 未进入里程碑的普通 NPC 和关卡仍不得添加空菜单、占位 Prefab 或万能实体配置。

### 领域创作入口映射

| 内容 | 规则源 | 表现源 | 主要创作入口 | 层级入口 |
| --- | --- | --- | --- | --- |
| 房间/建筑 | `assets/config/csv/rooms.csv` | 房间 Prefab | “配置表”分页 + Inspector | 创作面板创建已发现实例 |
| 场景结构 | Boot/Main/Battle Scene 层级 | Scene + UIRoot Prefab | 创作面板初始化中文骨架 | 不生成一次性玩法内容 |
| 船体/飞船 | `assets/config/csv/hulls.csv`（含 `cellMask`） | 船体外观 + ShipView Prefab | “配置表/船体与飞船”分页 | 在明确挂载点创建唯一 shipId |
| 船员 | `assets/config/csv/crews.csv` + `crew-traits.csv` | Crew Prefab | 创作面板“配置表/船员”分页 | 发现、编辑并创建 CrewView 实例 |
| 地板/连接器 | `floors.csv` + `connector-ports.csv` | Floor/楼梯/电梯 Prefab | “配置表/建造”分页 | ShipView 地板与施工预览容器 |
| 其他 NPC | 定义资产 | NPC Prefab | 对应里程碑的定义表单 | 有可用实现后再加入 |
| 槽位装备、技能、奖励、AI 条件 | JSON/专用面板 | 绑定点或 UI | Inspector/专用面板 | 不创建空节点 |

其他 NPC、关卡和其他领域在进入对应里程碑前不得添加空菜单、占位 Prefab 或万能实体编辑器。

未来关卡仍以 Scene 作为可视化创作输入；插件导出 `schemaVersion`、`levelId`、`shipId`、`hullId`、定义 ID、实例 ID 和整数格坐标的逻辑布局 JSON，运行时不直接把 Scene 节点当作规则状态。

Inspector 装饰器和代码写法见 `15-编码与注释规范.md`；完成证据要求见 `16-测试-验收-DoD.md`。

## 8.4 P8 体素、动态建造与 CSV 资源边界

- P8 运行时只读取 `assets/config/csv/` 的九张权威表（七张玩法表与两张视觉表）；编辑器另读取 `editor-prefabs.csv` 建立 Prefab 白名单映射。表头为英文，第二行是以 `#稳定标识` 开始的中文说明，支持 UTF-8 BOM、CRLF 和 RFC4180 引号。
- `PSS manifest.json` 只记录视觉来源、裁切和 Hash，不参与玩法数值或跨表引用。
- `ShipView` 持久保存网格根、房间容器、地板容器、船员层、特效层和施工预览容器。缺少这些初始容器时中文报错停止，玩家 Command 确认后的动态内容由 `ShipContentViewSync` 按快照复用或实例化。
- `FloorView`、`ConstructionGhostView`、`BuildPageController`、`BuildablePrefabCatalog` 和 `ShipContentViewSync` 必须作为 Creator 可见组件/Prefab 引用持久保存；运行时不得为缺失基础层级补节点。
- 固定墙由 Hull 格类型绘制且不可建拆。地板一格一个实例；房间底边每格必须由已完成地板支撑；上下相邻内容不得形成隐式连接。
- 楼梯/电梯 Prefab 只通过 `connector-ports.csv` 声明的停靠口连接不同高度。楼梯允许 Graphics 占位，电梯复用已导入的 PSS 外观。
- 玩家新增/拆除耗能房间后，PowerPanel 从持久 `PowerRoomRow.prefab` 模板按快照同步；未知映射必须中文报错，不能保留幽灵行。

---

---

# 43. 美术与资源规范

## 43.1 视觉

建议保持 2D、横截面、清晰网格、高辨识度房间、船员体积小但状态可读、战斗效果不遮挡关键状态。

不要求复制 8-bit 风格，应形成独立美术方向。

## 43.2 锚点

统一船员脚底锚点、房间逻辑锚点、Projectile 中心和 UI 设计分辨率规则。

## 43.3 命名

```text
spr_room_reactor_lv1
spr_crew_xxx_idle_01
fx_laser_hit
ui_btn_primary
ui_icon_energy
snd_weapon_laser_fire
```

---

## 补充：中文注解要求

- Prefab 根节点建议在对应 Controller / View 脚本顶部用中文注释说明用途。
- 重要锚点、坐标基准、SpriteFrame 切换约束必须写中文注释。
- 不对显而易见的资源路径逐行注释。

## 43.4 PSS 参考素材与 Cocos 原生动画（R1 P7）

- `I:\\WebProjects\\pss_full` 只作为编辑器索引源，必须只读；运行时、存档和 GameCore 不得访问该路径。
- 首批实际采用的素材由 `assets/textures/pss/manifest.json` 记录稳定 `visualId`、来源相对路径、SHA-256、裁切帧矩形、播放模式、FPS 和授权状态。索引别名只用于搜索，不替代实体 ID。
- 导入范围必须由 manifest 白名单控制，目标只能落在 `assets/textures/pss/`；源文件变化、路径越界或目标冲突必须 fail-closed，并报告回滚残留。
- 房间和船员的逐帧播放统一使用 Cocos `Sprite`、`SpriteFrame`、`Animation` 和 `AnimationClip`。禁止在 `update()` 中手工按帧切图；缺少持久 SpriteFrame 时保留 Graphics 回退。
- `RoomAppearance` 只接收供电/维修表现状态：静态、常驻循环和供电循环的切换由 Cocos Animation 完成；断电的供电循环必须停在首帧。
- `CrewAppearance` 只接收 IDLE/MOVING/TASK 表现状态，移动位置仍由现有 Cocos Tween 插值；多部件角色必须在编辑器阶段校准共同脚底锚点，运行时不读取外部素材库。
- 像素素材默认使用最近邻过滤和整数缩放；Prefab 中的 Sprite、Animation、AnimationClip 和锚点引用必须通过 Creator 持久保存后才能作为完成证据。

## 43.5 P8.1 世界交互与网格表现 Prefab

- `ShipView.prefab` 的固定顺序为：船体外观层、网格根、地板容器、网格交互高亮层、房间容器、船员层、施工预览容器、特效层。地板完整占满一个 `cellSize × cellSize`，使用 1px 内边界分隔相邻格。
- 网格高亮层只保存一个 `Graphics` 节点，悬浮时重绘当前格；禁止为每个格子创建运行时 Node。VOID/固定墙和非法目标使用红灰色，右键目标使用黄色。
- `UIRoot.prefab` 持久保存 `WorldInteractionController`、上下文菜单根、Button、Label、Widget 和 `BlockInputEvents`。运行时只切换状态、文字和位置，不补节点或组件。
- 房间、船员和施工预览左键只切换选择；空白短点击或 `Esc` 取消。右键菜单发送应用层 Command，View 不直接修改 GameCore 或存档。
