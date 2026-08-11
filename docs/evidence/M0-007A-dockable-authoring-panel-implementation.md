# M0-007A：可停靠创作面板实现证据

状态：完成。自动实现与测试、Creator 可停靠面板、标准骨架、房间/船员列表、真实 Prefab 创建、单次原子 Undo/Redo、关闭插件回归、10 节点中文骨架和 420px 窄面板均已取得持久证据。

## 当前实现

- `extensions/starship-editor-tools/package.json`：`authoring` 面板使用 Cocos 官方 `type: "dockable"`；Project 和 Panel 菜单只打开 `open-authoring-panel`。
- `src/panels/authoring-panel.ts`：采用工作台布局，提供“场景 / 房间建筑 / 船员 / 校验”四页；房间与船员均支持分类筛选、搜索、资源选择、右侧中文属性检查器和创建实例操作。面板可见期间每 500ms 轮询公开 Selection，隐藏/关闭时清理定时器。
- 房间属性可直接编辑：中文名称、分类、网格宽高、等级、耐久、能源范围和船员容量通过 `update-room-definition` 调用公开 Asset DB `save-asset` 保存；稳定 ID、Prefab 和 JSON 路径保持只读，保存前重新读取并校验当前 JSON，避免面板缓存覆盖外部修改。
- 面板视觉层：场景状态、房间建筑和操作结果分为独立卡片；状态使用中文徽标、数量提示和分级反馈，选择项隐藏长 UUID（保留悬停提示），房间只显示名称、分类和尺寸，稳定 ID 放在悬停提示中；内容区支持面板内滚动，窄面板下自动改为单列布局。
- 标准骨架新创建的 Node 实际使用“画布/世界根/飞船根/房间容器”等中文名；运行时和插件通过语义别名兼容 `Canvas/WorldRoot/ShipRoot/RoomRoot` 等旧英文节点，已有英文场景不自动改名。
- `src/main.ts`：通过 `get-authoring-state` 和 `refresh-authoring-state` 提供当前选择、房间目标、有效房间和中文警告；执行操作前重新查询场景。
- `src/rooms/room-scene-authoring.ts`：复用 GameCore 首个合法空位和唯一实例 ID；通过公开 `scene/create-node` 的 `assetUuid + type: 'cc.Prefab' + unlinkPrefab: false` 创建实例，并用公开 `query-nodes-by-asset-uuid` 确认关联，关联缺失时删除临时节点并取消录制；成功后公开选中并聚焦新节点。
- `src/shared/editor-scene.ts`：封装公开 `scene/begin-recording`、`end-recording` 和 `cancel-recording`；创建房间前录制已有 RoomRoot，创建与属性写入不生成分散记录，成功时一次提交，失败时删除临时节点并取消录制。
- 兼容修复：Creator 3.8.8 的 `query-node-tree` 可能返回脚本压缩 `cid`、`components[].value` 或 INode 的 `__comps__` dump；现通过公开 `scene/query-components` 建立类名映射，归一化 `value/uuid`，并把组件属性写入公开 `__comps__.<index>.<property>` 路径（引用使用 Cocos dump 结构），避免重复挂载和“组件 UUID 不存在”导致初始化误回滚。
- `src/hierarchy/`：已删除；不再依赖私有 hierarchy API、`cce.*` 或 DOM 注入。

## 自动验证

在 `extensions/starship-editor-tools/` 执行：

```text
npm test
```

结果：2026-08-12 TypeScript 构建成功，71/71 扩展测试通过。除上述覆盖外，包含船员发现/创建/编辑、CID 识别、Crew Prefab、PowerRoomRow Prefab 局部定位、公开 Asset DB `save-asset`、路径边界、保存失败提示、分页、Prefab 关联丢失时的原子回滚，以及公开录制消息顺序测试。

## Cocos 人工验收进度

1. [x] 扩展重新加载后，Panel 菜单可打开“星舰创作工具”。
2. [x] 面板已停靠在 Inspector 下方，选择 RoomRoot 后 1 秒内更新选择和网格放置状态。
3. [x] 标准骨架、房间列表、真实 Prefab 创建，以及一次 Undo 删除与一次 Redo 恢复均已取得截图。
4. [x] 既有证据已覆盖资源管理器创建 JSON + Prefab 后自动绑定“房间定义”。
5. [x] 插件在未保存空场景新建/补齐后，层级管理器显示 10 个全中文标准节点；截图后关闭且未保存测试场景。
6. [x] 关闭插件后工程仍可打开、构建和运行；证据见 `M0-007A-plugin-disabled-regression.md`。

最新全中文骨架见 `M0-007A-chinese-standard-skeleton-10-nodes.png`，420px 窄面板见 `M0-007A-authoring-panel-420-css-px.png`；原子创建/撤销/重做见 `M0-007A-undo-redo-verification.md`，关闭插件回归见 `M0-007A-plugin-disabled-regression.md`。
