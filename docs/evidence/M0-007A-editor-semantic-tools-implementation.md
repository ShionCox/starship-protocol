# M0-007A 语义化编辑器创作增强：历史实现证据

状态：历史证据，入口部分已被 `ADR-0003-Cocos编辑器创作入口收敛.md` 替代；当前验收以 `M0-007A-dockable-authoring-panel-implementation.md` 为准。

## 已实现

- `extensions/starship-editor-tools/src/rooms/create-room-content.ts`：房间定义 JSON 与 Prefab 的事务创建、重名拒绝和失败回滚。
- `extensions/starship-editor-tools/src/rooms/bind-room-prefab.ts`：创建成功后通过公开 Scene 消息自动绑定 JsonAsset、校验 RoomView 并保存 Prefab。
- `extensions/starship-editor-tools/src/rooms/discover-room-prefabs.ts`：扫描 Asset DB 真实依赖，只返回恰好绑定一个有效定义且包含 RoomView 的 Prefab。
- `discover-room-prefabs.ts` 对 Creator 导入期间暂时为空的 `query-uuid` 使用公开 Asset DB 脚本列表回退；仍无法定位时 fail closed。
- `extensions/starship-editor-tools/src/scene/prototype-skeleton.ts`：只创建缺失的 Prototype 场景节点/组件，冲突时停止并回滚。
- `extensions/starship-editor-tools/src/rooms/room-scene-authoring.ts`：当前入口使用公开面板调用语义 RoomRoot 路由、GameCore 首个合法空位、唯一实例 ID、Prefab 实例创建和失败回滚。
- 旧的 `src/hierarchy/` 私有适配器、层级菜单生成函数和直接主菜单降级入口已删除，不再作为当前实现证据。

## 自动验证

在 `extensions/starship-editor-tools/` 执行：

```text
npm test
```

结果：历史版本 TypeScript 构建成功，26/26 扩展测试通过；当前版本见新证据。

根目录执行：

```text
npm test
```

结果：GameCore/安全/安全 API 套件全部通过（24 + 9 + 3 项）。

## 未验证项

以下历史入口不再验收：

1. 层级管理器中文右键菜单及房间建筑子菜单。

原因：Cocos 3.8.8 未提供稳定公开的第三方层级右键注册消息，入口已迁移到可停靠创作面板。
