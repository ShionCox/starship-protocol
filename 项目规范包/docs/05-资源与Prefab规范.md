# 资源与Prefab规范

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


# 8. 资源架构

## 8.1 Asset Bundle

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

Prefab 用于 RoomView、CrewView、ProjectileView、ExplosionView、CrewCard、RoomCard、ItemCard、Popup、标准 UI。

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
- 同一场景级参数只允许一个来源：网格列数、行数、格子尺寸、吸附开关和网格外观统一配置在 AppRoot 的 SceneSettings；GridRoot 只保留 Node、UITransform、Graphics 等绘制目标能力。
- View 与 Prefab 只读取 SceneSettings，不得再次暴露同名场景参数，避免多个组件数值不一致。
- Inspector 的显示名称、工具提示和分组使用中文；代码属性名、类名、Prefab/Scene 文件名和稳定业务 ID 仍按英文命名规范执行。Prototype 标准骨架的新建 Node 使用中文语义名，旧英文 Node 名只作为兼容别名，已有场景不自动改名。
- `executeInEditMode` 只用于轻量预览、尺寸刷新、锚点辅助和编辑器吸附，不在编辑器生命周期中运行完整 GameCore 或产生不可控资产修改。
- 编辑器中已有的初始实例由运行时优先复用；动态生成仅用于玩家新增内容、对象池对象或场景未提供实例时的明确备用路径。

### 网格内容拖动吸附

- 房间、船员站位、武器槽等网格化内容在编辑器中拖动时，必须吸附到最近的项目逻辑格或项目定义锚点。
- 优先使用 Cocos 节点变换事件、编辑器执行模式和 Transform 能力做薄适配，不建立第二套场景编辑器。
- 吸附结果必须在场景中立即可见，并支持撤销、保存和重新打开后保持一致。
- 编辑器世界/本地坐标只作为设计输入；装配时转换为整数逻辑坐标，再由 GameCore 检查越界、无效格和重叠。
- 多层父节点、缩放或位移存在时，必须通过世界坐标与目标父节点坐标转换，禁止假设 GridRoot 与 RoomRoot 坐标恒等。

### 编辑器资产验收

- Scene 可打开，层级完整，关键组件已持久挂载。
- AppRoot 存在且只存在一个 SceneSettings；GridRoot 不存在重复的网格配置组件。
- Prefab 可单独打开并看到外观，不依赖运行时 `bind()` 才出现。
- 中文 Inspector 字段可修改，修改后预览立即刷新。
- 网格对象拖动后自动吸附，保存并重开位置不漂移。
- 运行场景后不重复生成编辑器中已经存在的实例。
- 项目内高频创建的标准 Prefab 可以通过 Cocos 官方 `contributions.assets.menu` 扩展到资源管理器“新建”菜单；菜单只复制已验收模板，不自行拼装 `.prefab` / `.meta` 序列化内容。

### 项目级编辑器扩展

- 全项目只保留 `extensions/starship-editor-tools/` 一个创作工具宿主；房间、NPC、关卡按领域模块注册，不各建一套扩展生命周期。
- 本轮房间模块从资源管理器“新建 → 星舰协议 → 新建房间建筑”打开中文表单；场景结构、校验和实例创建统一从“项目/Panel → 星舰协议 → 打开星舰创作工具”的可停靠面板完成。
- 表单创建 `assets/config/rooms/<room-id>.json` 和目标目录中的 Prefab 副本；创建前必须校验 ID、数值、路径和重名，禁止覆盖。
- 多资源创建必须有回滚：后续步骤失败时删除本次已经创建的资产，回滚失败也必须给出明确错误和残留路径。
- 插件通过 Asset DB `create-asset`、`copy-asset`、`delete-asset`、`open-asset` 等公开消息操作资源，不直接写 `.prefab` / `.meta` 序列化文本。
- 新 Prefab 创建后插件自动打开 Prefab，并用公开 Scene 消息把生成的 JsonAsset 绑定到 RoomView 的“房间定义”，校验 RoomView、UITransform、Graphics 后保存；设计人员仍可在 Inspector 复核或替换引用，绑定缺失、JSON 无效或稳定 ID 不匹配时不能验收。
- 房间建筑菜单不维护第二份清单：插件扫描房间 JSON 与 Prefab 的 Asset DB 真实依赖，只把“恰好一个有效定义 + RoomView”的 Prefab 放入可创建列表；无效、缺失或多重绑定进入中文校验警告，不进入菜单。
- 创作面板按当前选择上下文路由到唯一 `RoomRoot`，用 GameCore 放置校验扫描首个合法空位，生成唯一实例 ID，并保留 Prefab 关联；网格已满或场景结构冲突时不留下临时节点。
- 标准场景骨架只创建缺失节点和组件，遇到重名、错误父级或重复配置入口即停止并回滚本次创建；公开 Scene 消息负责节点、组件、属性、保存和一次 Undo/Redo 快照。
- 面板显示期间每 500ms 读取公开 Selection，隐藏/关闭时停止；执行创建前必须重新查询场景和选择，不能依赖缓存状态。禁止层级私有右键适配器、`cce.*` 和 DOM 注入。
- 创作面板采用左侧领域分页、分类筛选、资源列表和右侧中文属性检查器；已接入领域的规则字段必须支持直接编辑并通过公开 Asset DB `save-asset` 保存。稳定 ID、Prefab 引用和资源路径保持只读，保存前重新读取并校验 JSON，避免面板缓存覆盖外部修改。
- Prefab 保存颜色、组件、锚点与资源引用；JSON 保存版本、稳定 ID、分类、逻辑尺寸和规则数值，禁止写 Node 或世界坐标。
- NPC 和关卡只有在对应里程碑开始后才增加领域模块。本轮不创建不可用菜单或万能实体配置。

### 领域创作入口映射

| 内容 | 规则源 | 表现源 | 主要创作入口 | 层级入口 |
| --- | --- | --- | --- | --- |
| 房间/建筑 | `assets/config/rooms/*.json` | 房间 Prefab | 资源管理器表单 + Inspector | 创作面板创建已发现实例 |
| 场景结构 | Scene 层级 | Scene/Prefab | 场景编辑器或创作面板初始化骨架 | 创作面板补齐标准骨架 |
| 船体/关卡地图 | 版本化关卡 JSON | Scene 可视化布局 | Scene + 校验/导出面板 | 仅加入已经实现的语义对象 |
| NPC/船员 | 定义资产 | NPC Prefab | 对应里程碑的定义表单 | 有可用实现后再加入 |
| 槽位装备、技能、奖励、AI 条件 | JSON/专用面板 | 绑定点或 UI | Inspector/专用面板 | 不创建空节点 |

NPC、关卡和其他领域在进入对应里程碑前不得添加空菜单、占位 Prefab 或万能实体编辑器。

未来关卡仍以 Scene 作为可视化创作输入；插件导出 `schemaVersion`、`levelId`、`hullId`、定义 ID、实例 ID 和整数格坐标的逻辑布局 JSON，运行时不直接把 Scene 节点当作规则状态。

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
