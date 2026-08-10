# Cocos客户端与UI架构

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 资源与 Prefab 的细节统一见 `05-资源与Prefab规范.md`；不要在本文件重复维护资源命名规则。

# 7. Cocos 客户端架构

## 7.1 场景设计

### BootScene

- 初始化日志；
- 读取本地设置；
- 加载基础配置；
- 版本检查；
- 加载 common bundle；
- 初始化网络；
- 决定进入 LoginScene 或 MainScene。

### LoginScene

R2 开启：登录、游客账号、服务器状态、公告、资源版本检查。

R0/R1 可以直接跳过。

### MainScene

主要经营场景：飞船、星空背景、建造、船员、AI、装备、研究、任务、背包、战斗入口。

### BattleScene

只负责战斗表现：双方飞船、房间状态、船员、弹道、护盾、火焰、EMP、HUD、战斗速度、回放、结果界面。

### 编辑器场景搭建入口

- 每个主场景必须在 Cocos 编辑器中保留可识别的根层级、相机、Canvas、世界层和 UI 层，不能由启动脚本在运行时从空场景临时拼装。
- 初始布局、静态背景、UI 骨架和设计人员需要反复调整的代表性内容使用 Scene/Prefab 实例搭建。
- 动态重复内容仍使用 Prefab + 配置实例化；对应 Prefab 必须能单独打开预览，必要时在测试场景放置一个代表实例。
- Bootstrap 负责连接编辑器实例与 GameCore，不替代场景搭建；场景中已有实例时必须优先复用，避免运行时重复生成。
- 每个主场景在 AppRoot 上保留一个场景设置组件；场景级网格、吸附和表现参数从该组件读取，不散落到 GridRoot 或各个 Prefab。
- 设计人员从项目菜单或 Panel 菜单打开可停靠“星舰创作工具”，在面板中初始化标准场景骨架、刷新校验并创建已经校验过的房间 Prefab 实例；层级管理器只提供可视化选择和拖动，不注册右键扩展入口。
- Prototype 标准骨架由面板新建时使用中文 Node 名：`主相机`、`画布`、`背景层`、`世界根`、`飞船根`、`网格根`、`房间容器`、`预览根`、`界面根`、`应用根`。运行时路由按语义别名同时识别旧英文名；已有英文场景不自动改名，避免破坏用户布局。
- Prefab、Inspector 中文字段、编辑器预览和吸附细则统一见 `05-资源与Prefab规范.md`；装饰器写法见 `15-编码与注释规范.md`。

## 7.2 UI 层级

```text
Canvas
├─ BackgroundLayer
├─ WorldLayer
│  ├─ ShipLayer
│  ├─ RoomLayer
│  ├─ CrewLayer
│  ├─ ProjectileLayer
│  └─ EffectLayer
│
└─ UIRoot
   ├─ HudLayer
   ├─ PageLayer
   ├─ PopupLayer
   ├─ TooltipLayer
   ├─ DragLayer
   ├─ ToastLayer
   ├─ GuideLayer
   └─ LoadingLayer
```

层级规则：

```text
Hud < Page < Popup < Tooltip < Drag < Toast < Guide < Loading
```

## 7.3 UI 页面

### P0/R1

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

必须先建立统一组件库：

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

大数据列表必须使用虚拟化，不允许一次创建几百个复杂节点。

---
