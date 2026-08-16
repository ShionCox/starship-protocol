# ADR-0006：三层核心 Prefab 与持久页面节点

## 状态

R1 实施中；取代 ADR-0005 中关于动态页面挂载与单用途 UI Prefab 的部分。

## 背景

迁移前 UI 由 16 个 Prefab 组成：MainScreen 只保存页面挂载点和公共面板实例，
MainPageRouter 在运行时实例化/销毁五个页面，UIRoot 还通过嵌套实例保存多个一次性弹窗。
这种结构让设计人员必须切换多个资源才能看到组合效果，也会让 UIRoot 的深层覆盖遮住
MainScreen 源资源中的有效视觉调整。

## 决策

1. 正式 UI Prefab 只保留 `UIRoot`、`MainScreen`、`BattleHUD`、`BuildOptionCard`、`PowerRoomRow` 五个资源。
2. `UIRoot` 负责主/战斗内容根、弹窗层、提示层和加载层，并保持唯一 `MainScreen` 与 `BattleHUD` 核心实例。设置、世界交互、拆除确认和离线结算均为 UIRoot 弹窗层普通节点。
3. `MainScreen` 保存主导航、顶栏、能源/船员公共面板和页面层。页面层固定包含主菜单、星图、飞船、建造、船员五个普通节点，切页只改变 active；禁止运行时 instantiate/destroy 页面。
4. `BuildOptionCard` 与 `PowerRoomRow` 是唯一保留的重复模板。能源面板可以按快照动态增删 `PowerRoomRow` 实例，建造目录可以按配置缓存 `BuildOptionCard` 实例；代表性行/卡片必须在编辑器中可见。
5. `MainPageRouter` 序列化五个页面 Node 引用、公共面板和设置节点，保留 `MainPageId` 与五个 `show*` 方法。`editorPreviewPage` 使用中文 Inspector 枚举并配合 `executeInEditMode` 刷新；运行时无条件从主菜单开始，不读取编辑器预览值。
6. `MainSceneBootstrap` 直接持久引用 `BuildPageController`。建造页面隐藏时由 `onDisable` 注销分类/取消拖拽；重新显示时重置分类与滚动位置，但保留已创建卡片缓存。
7. 迁移必须在备份当前未提交的 MainScreen、UIRoot 和 HUD 贴图后执行。Creator 扩展通过公开 Asset DB/Scene API 展开旧页面/模块、建立普通节点、重连引用，并用每个 Prefab/Scene 文档的公开 recording 取消当前阶段；删除旧资源前反向扫描 Asset DB 外部依赖，不能手改大型序列化文件。跨文档已保存内容不能由单一 Scene snapshot 伪装成全局事务，失败必须 fail-closed 并提示按备份复核。
8. 场景创作工具的“场景”页只保留 `一键创建/更新启动界面`、`一键创建/更新主界面`、`一键创建/更新战斗界面` 三个入口。三按钮统一串行队列，扩展只公开 `create-or-update-scene` 消息并由 `createOrUpdateScene(kind)` 分派 `BOOT`、`MAIN`、`BATTLE` 固定分支；新增场景能力必须追加到对应分支，不得新增面板按钮或公开消息。
9. 三个分支均先打开目标 Scene、补齐中文骨架、保存并重开校验；更新只补缺失节点/组件/引用和失效资源，保留已有节点的手工位置、缩放、尺寸、布局和有效自定义贴图。发现重复稳定 ID、错误父节点或已有子节点却缺少布局组件时，在写入前停止并返回场景类型、阶段和冲突对象；已保存阶段不会伪装成跨资源事务回滚。面板存在未保存领域草稿时禁止启动场景更新。

## 结果与取舍

- 设计人员可以直接打开 MainScreen 并在 Inspector 选择页面预览，调整结果会由 UIRoot 的无深层覆盖实例直接显示。
- inactive 页面会占用少量内存，换取稳定节点引用、简单生命周期和可保存的编辑器布局。
- 旧单用途 Prefab 不再作为运行时依赖；未来若页面规模超过首包预算，应另行提交资源分包 ADR，不在本决策中重新引入动态页面缓存。

## 验收

- 静态资源检查只剩五个正式 UI Prefab，旧 Prefab 与 `SettingsPopup.ts` 不存在，源码无页面挂载/动态销毁入口。
- 场景工具静态检查恰好存在三个动作按钮和一个 `create-or-update-scene` 消息，旧迁移、P8 重建、挂载/连接和页面预览消息均不存在；三分支连续执行两次不产生重复 Canvas、UIRoot、ShipView、能源行或稳定实例。
- Prefab 检查确认 MainScreen 五个页面、公共面板和导航贴图持久存在；UIRoot 的 MainScreen 实例无组件替换与深层视觉覆盖，弹窗可直接选中调整。
- 自动测试覆盖五页切换、重复点击、设置往返、建造页启停/卡片缓存、能源行动态增删和 Main/Battle 往返。
- Creator 检查 Inspector 预览枚举、保存重开、MainScreen → UIRoot 组合画面和 1280×720 Web 运行画面；Console 要求 0 warning / 0 error。
