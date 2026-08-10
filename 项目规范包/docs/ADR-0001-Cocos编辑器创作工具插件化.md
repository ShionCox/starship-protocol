# ADR-0001：Cocos 编辑器创作工具插件化

- 状态：替代（由 ADR-0003-Cocos编辑器创作入口收敛.md 替代入口部分）
- 日期：2026-08-09
- 影响范围：Cocos 编辑器扩展、房间内容配置、Prefab 创作、关卡布局导出

## 背景

R0 已证明房间可以在 Cocos 编辑器中预览和吸附，但仅靠 Component 字段与硬编码资源菜单，新增房间时仍需要同步修改 TypeScript 常量。后续还会出现更多房间、NPC 和关卡地图，需要统一且可验证的编辑器创作入口，同时保持 GameCore 纯 TypeScript 和运行时独立。

## 候选方案

### 方案 A：一个项目插件，按领域分模块

优点：
- 只维护一套扩展生命周期、菜单、错误处理和 Asset DB 适配；
- 房间、NPC、关卡仍可保持各自数据模型；
- 插件关闭时不影响运行时。

缺点：
- 需要维护最小模块注册契约。

### 方案 B：每个领域一个插件

优点：
- 各领域可独立发布。

缺点：
- 当前团队和内容量不需要独立发布；
- 会重复扩展配置、面板通信和资源事务代码。

### 方案 C：继续只使用 Component 与手工资源复制

优点：
- 当前代码最少。

缺点：
- 无法统一创建、校验和错误回滚；
- 新内容容易遗漏稳定 ID、JSON 或 Prefab 绑定。

## 决策

选择方案 A：保留一个项目级 `starship-editor-tools`，内部按房间、NPC、关卡分模块。本轮只实现房间建筑模块，不创建 NPC 和关卡空壳功能。

房间 Prefab 保存表现，`assets/config/rooms/*.json` 保存版本化规则。Scene 保存可视化初始布局；运行时规则和未来关卡导出只使用稳定 ID 与整数逻辑坐标。资源菜单创建成功后由插件自动绑定 JsonAsset 并校验，创作面板从真实 Asset DB 依赖发现可创建房间，不维护第二份房间清单。

## 原因

该方案复用 Cocos Creator 3.8 的 Panel、资源管理器菜单和 Asset DB 消息，只补充项目特有的内容创建与校验，不建立第二套场景编辑器。单插件减少重复基础设施，领域模块边界又避免把房间、NPC、关卡塞入万能实体模型。

## 影响

- 代码：编辑器扩展使用包内 TypeScript；GameCore 增加纯数据解析器；RoomView 从 JsonAsset 读取定义。
- 数据：房间定义增加 `schemaVersion`，稳定 ID 与 Prefab 表现分离。
- Replay：不改变 Command、Snapshot 和整数逻辑坐标边界。
- 性能：编辑器只在创建和轻量预览时读取定义；运行时不加载插件代码。
- 部署：Web/Native 构建不包含 `extensions/`。
- Cocos 编辑器搭建与 Inspector：新房间通过资源管理器菜单创建 JSON 与 Prefab 并自动绑定定义；场景骨架和房间实例统一由创作面板完成。
- 层级右键注册没有稳定公开消息，因此不再保留私有适配器；面板通过公开 Selection 读取选择，通过公开 Scene/Asset DB 消息修改场景。

## 迁移方案

1. 将反应堆规则迁移到 `room-reactor.json`。
2. ReactorRoom Prefab 的 RoomView 由插件绑定该 JsonAsset，并由编辑器校验组件和稳定 ID。
3. Bootstrap 按每个 RoomView 的定义装配，不再使用反应堆常量。
4. 保留两个场景实例的独立实例 ID 和位置，不直接编辑 `.scene` / `.prefab` 序列化文本。
