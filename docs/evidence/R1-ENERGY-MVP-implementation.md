# R1 能源纵切实现证据

> 历史证据（已冻结）：本文件记录 PrototypeScene 与独立能源 Key 阶段。2026-08-12 ADR-0004 已将运行时改为 ShipModel + 单一玩家状态 Envelope；旧 Bootstrap/Storage/fallback 已删除。当前完成状态只看 `R1-FOUNDATION-CHECKLIST.md`。

## 范围

本批次完成 R1 顺序中的第 3 项“能源”，仍保持 `ShipLayoutSnapshot` 为 R0 的纯布局快照；动态能源分配不写入房间布局存档。

## 实现

- `assets/scripts/game-core/EnergyModel.ts`：纯 TypeScript 能源模型。
  - 以稳定房间实例 ID 保存分配；`powerGeneration` 求和得到当前可用产能。
  - `SET_ROOM_POWER` / `RESET_ROOM_POWER` 在提交前校验最低/最高功率、未知 ID、总产能和整数约束。
  - 失败返回错误码且不改变旧状态；快照恢复使用临时模型，避免半恢复状态。
- `assets/scripts/game-core/RoomDefinition.ts`：schema 1 缺失 `powerGeneration` 按 0 兼容；负数、小数和非能源房间正产能拒绝。
- `assets/scripts/game-core/EnergyModel.ts`：`createEnergyRooms` 将稳定实例 ID 映射为能源房间，保持 GameCore 与 Cocos 解耦。
- `assets/scripts/bootstrap/PrototypeEnergyStorage.ts`：使用独立 key `starship-protocol:r1:energy` 保存/恢复能源快照，未知房间或非法快照整份回退。
- `assets/scripts/presentation/PowerPanel.ts`、`PowerRoomRow.ts`：只读状态 + Command Handler 边界；按钮生命周期在 `onEnable`/`onDisable` 注册和注销。
- `assets/scripts/bootstrap/PrototypeBootstrap.ts`：Web 初始化解析定义、恢复布局、装配能源模型、处理 Command 保存失败回滚。
- `assets/config/rooms/room-reactor.json`、`room-laser.json`、`room-shield.json`：反应堆产能 10，两个耗能房间最低 2、最高 6、产能 0。
- `extensions/starship-editor-tools`：产能字段贯通发现/创建/编辑/保存，分类选择显示中文，插件版本 1.5.0。
- 所有本批次新增/调整的 Creator Inspector 字段均使用中文 `displayName`、`tooltip` 和分组；创作面板的属性名、分类筛选、分类选项、按钮和状态提示均使用中文（稳定标识/预制体等术语也已中文化），JSON 仍保留稳定英文枚举值。

## Web Desktop 回归（本轮）

- 2026-08-12 使用 Creator 3.8.8“构建发布”界面执行 `web-desktop` 正常构建，01:49:17 显示 `build success in 19 s`；随后由本地静态服务器提供 `build/web-desktop/index.html`，验证对象是生成产物实际运行，不是 HTTP 状态。
- `PrototypeScene.scene` 当前包含单个反应堆 Prefab、激光室、护盾室、电梯、`UIRoot/HUD层/能源面板` 和两个 `PowerRoomRow.prefab` 关联实例；激光室保存红色 `fill/border/core` 覆盖，护盾室保存青蓝色覆盖。Creator 场景与层级证据见 [`R1-energy-creator-persisted-scene.png`](R1-energy-creator-persisted-scene.png)。
- 本轮 Codex 浏览器实测生成产物初始显示可用 10、已分配 0；能源面板按钮可实际点击。
- 实测得到激光 6、护盾 4；再次增加护盾显示“能源不足：需要 11，可用 10”，总量和两个房间保持 10、6/4，见 [`R1-energy-web-insufficient.png`](R1-energy-web-insufficient.png)。
- 激光断电后护盾升到 6；刷新生成产物后恢复为激光 0、护盾 6，见 [`R1-energy-web-refresh-restore.png`](R1-energy-web-refresh-restore.png)。刷新后的浏览器 Console 只有正常 `LoadScene` 日志，无 warning/error。

## 自动验证

- `npm run test:core`：55/55 通过。
- `npm test`：核心 55/55、发行安全 9/9、API 3/3 通过。
- `extensions/starship-editor-tools`：71/71 通过；根工程使用插件目录 TypeScript 编译器执行 `tsc -p tsconfig.json --noEmit --skipLibCheck` 通过。

覆盖点包括：能源产能求和、激光/护盾总量冲突、最低/最高分配、未知房间、重复 ID、原子失败、快照恢复和非法快照。

## 后续范围与剩余项

- 尚未实现能源状态惩罚、固定 Tick、船员加成、武器/护盾效果；这些属于后续 R1 顺序。
- 当前场景已移除重复反应堆，逻辑布局为反应堆、电梯、激光室、护盾室；可用产能仍严格为 10。
- 两条能源行已作为 `PowerRoomRow.prefab` 关联实例持久保存到场景，Bootstrap 只在兼容旧场景缺失节点时创建兜底。
- M0-007A 的完整中文新骨架和约 420px 窄面板截图已留存于 [`M0-007A-chinese-standard-skeleton-10-nodes.png`](M0-007A-chinese-standard-skeleton-10-nodes.png) 与 [`M0-007A-authoring-panel-420-css-px.png`](M0-007A-authoring-panel-420-css-px.png)。
