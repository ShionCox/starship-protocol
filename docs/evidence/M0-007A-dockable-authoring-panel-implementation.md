# M0-007A：可停靠创作面板实现证据

状态：自动实现与测试已完成；Cocos Creator 3.8.8 面板停靠、菜单、Undo/Redo 和关闭插件截图尚未完成，不能勾选新增人工验收项。

## 当前实现

- `extensions/starship-editor-tools/package.json`：`authoring` 面板使用 Cocos 官方 `type: "dockable"`；Project 和 Panel 菜单只打开 `open-authoring-panel`。
- `src/panels/authoring-panel.ts`：采用专业工作台布局，提供“场景 / 房间建筑 / 设备 / NPC / 校验”分页；当前已实现房间建筑分类筛选、搜索、资源选择、右侧中文属性检查器和创建实例操作。面板可见期间每 500ms 轮询公开 Selection，隐藏/关闭时清理定时器。
- 房间属性可直接编辑：中文名称、分类、网格宽高、等级、耐久、能源范围和船员容量通过 `update-room-definition` 调用公开 Asset DB `save-asset` 保存；稳定 ID、Prefab 和 JSON 路径保持只读，保存前重新读取并校验当前 JSON，避免面板缓存覆盖外部修改。
- 面板视觉层：场景状态、房间建筑和操作结果分为独立卡片；状态使用中文徽标、数量提示和分级反馈，选择项隐藏长 UUID（保留悬停提示），房间只显示名称、分类和尺寸，稳定 ID 放在悬停提示中；内容区支持面板内滚动，窄面板下自动改为单列布局。
- 标准骨架新创建的 Node 实际使用“画布/世界根/飞船根/房间容器”等中文名；运行时和插件通过语义别名兼容 `Canvas/WorldRoot/ShipRoot/RoomRoot` 等旧英文节点，已有英文场景不自动改名。
- `src/main.ts`：通过 `get-authoring-state` 和 `refresh-authoring-state` 提供当前选择、房间目标、有效房间和中文警告；执行操作前重新查询场景。
- `src/rooms/room-scene-authoring.ts`：复用 GameCore 首个合法空位、唯一实例 ID、Prefab 关联和失败回滚；成功后公开选中并聚焦新节点。
- `src/shared/editor-scene.ts`：节点创建和属性设置不生成分散快照，成功后调用一次公开 `scene/snapshot`，失败调用 `scene/snapshot-abort`。
- 兼容修复：Creator 3.8.8 的 `query-node-tree` 可能返回脚本压缩 `cid`、`components[].value` 或 INode 的 `__comps__` dump；现通过公开 `scene/query-components` 建立类名映射，归一化 `value/uuid`，并把组件属性写入公开 `__comps__.<index>.<property>` 路径（引用使用 Cocos dump 结构），避免重复挂载和“组件 UUID 不存在”导致初始化误回滚。
- `src/hierarchy/`：已删除；不再依赖私有 hierarchy API、`cce.*` 或 DOM 注入。

## 自动验证

在 `extensions/starship-editor-tools/` 执行：

```text
npm test
```

结果：TypeScript 构建成功，28/28 扩展测试通过。除上述覆盖外，新增公开 Asset DB `save-asset` 属性编辑、路径边界、保存失败提示和面板分页回归测试。

## Cocos 人工验收待办

1. 扩展管理器重新加载后，Project/Panel 菜单只显示“打开星舰创作工具”。
2. 面板可停靠到层级管理器旁边，切换节点后 1 秒内更新选择和 RoomRoot 状态。
3. 初始化骨架、创建房间、选中/聚焦和一次 Undo/Redo 均取得截图。
4. 资源管理器右键创建 JSON + Prefab 后，“房间定义”已自动绑定并可在 Inspector 修改。
5. 关闭插件后工程仍可打开、构建和运行。

以上项目必须在 Cocos Creator 3.8.8 中实际操作并把截图保存到 `docs/evidence/` 后，才能勾选 `R0-CHECKLIST.md` 的新增人工项。
