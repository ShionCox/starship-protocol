# ADR-0005：UI 模块 Prefab 拆分与动态页面生命周期

## 状态

R1 实施中。

## 背景

`UIRoot.prefab` 同时保存了主导航、公共状态面板、弹窗、BattleHUD 和五个主页面实例。设计人员无法独立编辑页面，运行时切页也只能反复启停一棵持久节点树。页面与公共 HUD 的生命周期边界不清晰，建造页控制器还需要由场景 Bootstrap 持久引用。

## 决策

1. MainScene 与 BattleScene 继续共用一个 `UIRoot.prefab`，不创建第二套根或 Page Scene。
2. `MainScreen.prefab` 保存主导航、顶栏、页面挂载点、`PowerPanel.prefab` 和 `CrewStatusPanel.prefab`。`BattleHUD.prefab`、`WorldContextMenu.prefab` 和弹窗作为可独立编辑的嵌套 Prefab 实例挂入 UIRoot。
3. `MainMenuPage`、`GalaxyMapPage`、`ShipMainPage`、`BuildPage`、`CrewPage` 只作为 `MainPageRouter` 的 Prefab 引用；页面挂载点保存时为空。切页固定为：校验 Prefab → `instantiate` 新页 → 挂载并绑定 → 停用、解绑并 `destroy` 旧页 → 更新当前页与公共 UI。
4. 任何时刻页面挂载点最多一个活动实例。实例化或绑定失败时销毁新实例并保持旧页面。重复点击当前页不重新实例化，缺少 Prefab、挂载点或建造控制器时中文报错并保持可用页面。
5. 页面实例销毁只释放 Node，不主动释放 `main` Bundle 的 Prefab、贴图或其他资源；不新增异步资源加载、页面缓存、对象池或 Asset Bundle。
6. `MainSceneBootstrap` 只持久引用 `MainPageRouter`。建造页挂载时从新实例获取 `BuildPageController`，按最新玩家快照绑定；离开时清空引用并执行 `onDisable()`，再次进入重置分类、滚动位置和卡片缓存。
7. 创作工具使用 Cocos 3.8 公开 Asset DB/Scene API 创建、嵌套和校验模块；迁移前预检全部模块 Prefab，失败时 fail-closed，不保存半迁移 UIRoot，也不覆盖设计人员手动布局。

## 结果与取舍

- 页面可以单独打开、移动和保存，组合效果仍在 MainScene/Web 预览中验证。
- 页面切换的节点数量稳定为 1，公共面板、BattleHUD 和弹窗保持引用有效。
- 不做资源释放与缓存，换取实现简单和 `main` Bundle 资源引用稳定；若未来页面资源规模超出首包预算，另行提交 Asset Bundle ADR。

## 验收

- 静态检查确认 UIRoot 只有模块 Prefab 实例，MainScreen 的挂载点为空且五个页面引用完整。
- 生命周期测试覆盖首次进入、五页循环、重复/快速切换、绑定失败回滚和缺失资源。
- 组合测试覆盖设置弹窗、公共能源/船员面板、Main/Battle 往返及建造页卸载重置。
- 每个模块在 Creator 中独立打开并保存后位置不漂移；1280×720 Web 视觉基线和 Console 0 warning / 0 error 通过后，更新 R1 清单。
