# Cocos客户端与UI架构

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 资源与 Prefab 的细节统一见 `05-资源与Prefab规范.md`；不要在本文件重复维护资源命名规则。

# 7. Cocos 客户端架构

## 7.1 场景设计

### BootScene

- R1 保持最小，Web Desktop 使用 Creator 内置 `main` Bundle，初始化开发期状态端口并进入 MainScene；
- R2 才增加登录、版本检查、网络和正式配置 Bootstrap；
- 不承载飞船、页面或业务 UI。

### LoginScene

R2 开启：登录、游客账号、服务器状态、公告、资源版本检查。

R0/R1 可以直接跳过。

### MainScene

主要经营场景。主菜单、星图、飞船、建造、船员和设置都作为 Page Prefab 放在同一 Scene，不为每个页面复制场景。

### BattleScene

只负责战斗表现：双方飞船、房间状态、船员、弹道、护盾、火焰、EMP、HUD、战斗速度、回放、结果界面。

### 固定运行层级

```text
MainScene
├─ 主相机
├─ 画布
│  ├─ 世界根
│  │  └─ 当前飞船挂载点 → ShipView.prefab
│  └─ UIRoot.prefab（主界面模式）
└─ 应用根 → MainSceneBootstrap

BattleScene
├─ 主相机
├─ 画布
│  ├─ 世界根
│  │  ├─ 战斗环境
│  │  ├─ 我方飞船挂载点 → ShipView.prefab
│  │  ├─ 敌方飞船挂载点 → ShipView.prefab
│  │  ├─ 弹道层
│  │  └─ 特效层
│  └─ 同一 UIRoot.prefab（战斗界面模式）
└─ 应用根 → BattleSceneBootstrap
```

一种船体不是一个 Scene。`ShipView.prefab` 依据 `{ shipId, HullDefinition, ShipSnapshot }` 绑定船体外观、网格、房间和船员；敌我双方使用同一个 View 实现。

每个运行场景只允许一套主 Canvas/Camera。`世界根` 与 `UIRoot.prefab` 同属主 Canvas，镜头控制只移动和缩放世界根，UIRoot 保持屏幕空间不变；ShipView 内禁止再保存 Canvas 或 Camera。

### 编辑器场景搭建入口

- 每个主场景必须在 Cocos 编辑器中保留可识别的根层级、相机、Canvas、世界层和 UI 层，不能由启动脚本在运行时从空场景临时拼装。
- 初始布局、静态背景、UI 骨架和设计人员需要反复调整的代表性内容使用 Scene/Prefab 实例搭建。
- 动态重复内容仍使用 Prefab + 配置实例化；对应 Prefab 必须能单独打开预览，必要时在测试场景放置一个代表实例。
- Bootstrap 负责连接编辑器实例与 GameCore，不替代场景搭建；场景中已有实例时必须优先复用，避免运行时重复生成。
- 船体规则网格来自 HullDefinition；ShipView 只持有格子像素尺寸、颜色和子节点引用等表现配置。
- 设计人员从项目菜单或 Panel 菜单打开“星舰创作工具”，在面板中补齐 Boot/Main/Battle 中文骨架、创建船体/飞船/房间/船员并刷新校验。
- 新骨架只识别中文语义名。旧 Prototype 英文别名和运行时兼容补齐链已经删除。
- Bootstrap 只连接已序列化引用。缺少 ShipView、UIRoot、Panel 或关键组件时中文报错并停止，不动态创建任何正式节点。
- MainScene 启动后通过 `director.preloadScene('BattleScene')` 低优先级预加载战斗场景；BootScene 与 BattleScene 启用场景资源自动释放，MainScene 保留常用页面资源。自定义 Asset Bundle 等动态资源和包体规模出现实际需求后再接入。
- Prefab、Inspector 中文字段、编辑器预览和吸附细则统一见 `05-资源与Prefab规范.md`；装饰器写法见 `15-编码与注释规范.md`。

## 7.2 UI 层级

```text
UIRoot.prefab
├─ HUD层
├─ 页面层
├─ 弹窗层
├─ 提示层
└─ 加载层
```

UIRoot 不包含飞船、房间、船员、弹道或战斗特效。MainScene 与 BattleScene 通过同一 Prefab 的“界面模式”选择主界面内容根或战斗内容根；公共层级和样式只维护一份。

## 7.3 UI 页面

### P0/R1

- `MainMenuPage`
- `GalaxyMapPage`
- `ShipMainPage`
- `BuildPage`
- `RoomDetailPopup`
- `CrewPage`
- `CrewDetailPopup`
- `PowerPanel`
- `AIRulePage`
- `BattleHUD`
- `BattleResultPopup`
- `SettingsPopup`

### P1/R2

- `InventoryPage`
- `EquipmentPage`
- `ResearchPage`
- `MissionPage`
- `MailPage`
- `ShopPage`
- `PvPPage`
- `RankingPage`
- `BattleHistoryPage`

### P2

- `FleetPage`
- `MarketPage`
- `SeasonPage`
- `EventPage`
- `SocialPage`

## 7.4 基础 UI 组件

按真实复用需求逐步抽取，不在 R1 重基线提前建立完整组件库。当前优先使用 Cocos `Button`、`Label`、`ProgressBar`、`Widget`、`Layout`、`ScrollView` 和 Prefab；同一种交互出现多处且规则稳定后再形成项目组件。

长期候选包括：

```text
GameButton
IconButton
GamePanel
GameModal
GameLabel
GameProgressBar
GameSlider
GameToggle
GameTabs
GameDropdown
GameTextInput
GameScrollView
VirtualList
VirtualGrid
ItemCard
CrewCard
RoomCard
Tooltip
Toast
ConfirmDialog
LoadingMask
ContextMenu
DragPreview
```

大数据列表成形后必须使用统一虚拟化，不允许一次创建几百个复杂节点。

---
