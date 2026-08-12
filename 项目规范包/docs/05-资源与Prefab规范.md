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

Prefab 用于 `UIRoot`、页面、`ShipView`、船体外观、RoomView、CrewView、ProjectileView、ExplosionView、重复能源行和标准 UI。

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
- 设计人员可调整的视觉尺寸、颜色、间距、层级引用、Prefab 引用和交互开关必须暴露到 Inspector，不得散落为脚本硬编码常量；房间逻辑宽高等规则字段使用版本化 JSON 和插件表单，不在 View 上保留副本。
- 规则网格只允许一个来源：列数、行数、有效格 Mask、船员上限和房间上限来自 `HullDefinition`；`ShipView` 只暴露格子像素尺寸、颜色、层级引用和表现开关。
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
- 房间与船员模块从资源管理器菜单打开中文表单；场景、船体、飞船、房间、船员和校验统一从 Project / Panel 直接菜单打开同一个“星舰创作工具”面板。
- 表单创建 `assets/config/rooms/<room-id>.json` 和目标目录中的 Prefab 副本；创建前必须校验 ID、数值、路径和重名，禁止覆盖。
- 多资源创建必须有回滚：后续步骤失败时删除本次已经创建的资产，回滚失败也必须给出明确错误和残留路径。
- 插件通过 Asset DB `create-asset`、`copy-asset`、`delete-asset`、`open-asset` 等公开消息操作资源，不直接写 `.prefab` / `.meta` 序列化文本。
- 新 Prefab 创建后插件自动打开 Prefab，并用公开 Scene 消息把生成的 JsonAsset 绑定到 RoomView 的“房间定义”，校验 RoomView、UITransform、Graphics 后保存；设计人员仍可在 Inspector 复核或替换引用，绑定缺失、JSON 无效或稳定 ID 不匹配时不能验收。
- 房间建筑菜单不维护第二份清单：插件扫描房间 JSON 与 Prefab 的 Asset DB 真实依赖，只把“恰好一个有效定义 + RoomView”的 Prefab 放入可创建列表；无效、缺失或多重绑定进入中文校验警告，不进入菜单。
- 房间 JSON + Prefab 是项目级资源库，不绑定某个 Scene；扩展监听公开 `asset-db:asset-change`，资源新增、修改、删除或重新导入后自动重建目录并通知面板，面板不得要求设计人员手动刷新才能看到新资源。手动刷新只作为故障恢复入口。
- 创作面板只在明确选中的 `ShipView` 内创建房间，在明确选中的 RoomView 内创建船员；禁止回退到 Canvas、场景根或跨舰搜索。
- 房间实例由所属 ShipView 使用 HullDefinition 扫描首个合法空位，生成该飞船内唯一实例 ID；网格已满、目标冲突、引用缺失或组件无效时必须在单次 Undo 中回滚。
- 发现已有房间定义、坐标、实例 ID 或占用校验失败时必须 fail-closed，不能跳过非法房间继续寻找空位。
- 场景骨架只创建 Boot/Main/Battle 缺失的中文节点和组件；遇到重名或错误父级停止并回滚，不创建能源/船员等一次性玩法内容。
- 面板显示期间每 500ms 读取公开 Selection，隐藏/关闭时停止；执行创建前必须重新查询场景和选择，不能依赖缓存状态。禁止层级私有右键适配器、`cce.*` 和 DOM 注入。
- 创作面板采用左侧领域分页、分类筛选、资源列表和右侧中文属性检查器；已接入领域的规则字段必须支持直接编辑并通过公开 Asset DB `save-asset` 保存。稳定 ID、Prefab 引用和资源路径保持只读，保存前重新读取并校验 JSON，避免面板缓存覆盖外部修改。
- 面板选择联动只在 UUID 变化时自动切页；实例字段只读，定义字段通过白名单表单编辑。新增 NPC、关卡等类型必须先按 [`19-Cocos创作工具类型接入规范.md`](./19-Cocos创作工具类型接入规范.md) 显式注册，不得自动暴露全部组件字段。
- Prefab 保存颜色、组件、锚点与资源引用；JSON 保存版本、稳定 ID、分类、逻辑尺寸和规则数值，禁止写 Node 或世界坐标。
- R1 船员里程碑在同一插件内增加“船员”分页：扫描 `assets/config/crews/*.json` 与 Crew Prefab 的真实依赖，支持中文表单创建、定义编辑、Prefab 绑定、场景实例化、Selection 识别、单次 Undo 和失败回滚；不创建第二个插件。
- `CrewMember.prefab` 是船员模板，`EngineerCrew.prefab` 与 `GunnerCrew.prefab` 保存各自 JSON 引用和职业外观；Prefab 内实例 ID 必须为空，由飞船场景创作分配。`CrewView` 的实例 ID、初始房间、初始站位、主体颜色、边框颜色、选中描边和标记直径全部使用中文 Inspector。
- `PowerRoomRow.prefab` 是重复能源控制行的模板；正式 `PowerPanel` 只绑定场景中持久保存的行，不运行时创建或保留未知房间的幽灵行。
- `ShipView.prefab` 内实例 ID 为空，包含船体外观、网格根、房间容器、船员层和特效层；Main/Battle 的场景实例由插件生成唯一 `shipId` 并绑定 HullDefinition。
- `UIRoot.prefab` 是 Main/Battle 唯一公共 UI 源，包含 HUD、页面、弹窗、提示和加载层；业务 Page 均为独立 Prefab。
- 未进入里程碑的普通 NPC 和关卡仍不得添加空菜单、占位 Prefab 或万能实体配置。

### 领域创作入口映射

| 内容 | 规则源 | 表现源 | 主要创作入口 | 层级入口 |
| --- | --- | --- | --- | --- |
| 房间/建筑 | `assets/config/rooms/*.json` | 房间 Prefab | 资源管理器表单 + Inspector | 创作面板创建已发现实例 |
| 场景结构 | Boot/Main/Battle Scene 层级 | Scene + UIRoot Prefab | 创作面板初始化中文骨架 | 不生成一次性玩法内容 |
| 船体/飞船 | `assets/config/hulls/*.json` | 船体外观 + ShipView Prefab | “船体与飞船”分页 | 在明确挂载点创建唯一 shipId |
| 船员 | `assets/config/crews/*.json` | Crew Prefab | 创作面板“船员”分页 + 资源管理器菜单 | 发现、编辑并创建 CrewView 实例 |
| 其他 NPC | 定义资产 | NPC Prefab | 对应里程碑的定义表单 | 有可用实现后再加入 |
| 槽位装备、技能、奖励、AI 条件 | JSON/专用面板 | 绑定点或 UI | Inspector/专用面板 | 不创建空节点 |

其他 NPC、关卡和其他领域在进入对应里程碑前不得添加空菜单、占位 Prefab 或万能实体编辑器。

未来关卡仍以 Scene 作为可视化创作输入；插件导出 `schemaVersion`、`levelId`、`shipId`、`hullId`、定义 ID、实例 ID 和整数格坐标的逻辑布局 JSON，运行时不直接把 Scene 节点当作规则状态。

Inspector 装饰器和代码写法见 `15-编码与注释规范.md`；完成证据要求见 `16-测试-验收-DoD.md`。

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
