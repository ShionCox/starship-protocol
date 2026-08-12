# R1 船员移动最小可玩闭环证据

> 历史证据（已冻结）：本文件证明旧 PrototypeScene 纵切曾通过，不证明 ADR-0004 三场景/共享 UI 重基线已经完成。旧 PrototypeCrewStorage 与兼容 Bootstrap 已删除，当前状态只看 `R1-FOUNDATION-CHECKLIST.md`。

状态：2026-08-12 完成自动测试、Creator 3.8.8 人工验收、正式 Web Desktop 构建与生成产物实际运行。下一阶段可以进入维修系统；本批次未实现岗位加成、维修、武器开火、伤害、死亡、跨甲板电梯、AI、Replay 或 PvE。

## 已实现闭环

`船员 JSON → 创作插件 → Crew Prefab → 场景实例 → 房间站位 → NavigationGraph → MOVE_CREW → 10Hz 固定 Tick → PrototypeCrewStorage → 刷新恢复`

- 定义：`CrewDefinition` 使用 schema 1，职业只含 `ENGINEER` / `GUNNER`，所有 Creator Inspector、创作面板选项、提示和错误为中文；JSON 枚举、代码标识符和稳定 ID 保持英文。
- 场景：只保留 `room-reactor-1`，固定布局为反应堆 `(0,0)`、电梯 `(2,0)`、激光室 `(4,0)`、护盾室 `(6,0)`；激光为红色，护盾为青蓝色。
- 资源：`CrewMember.prefab` 派生 `EngineerCrew.prefab`、`GunnerCrew.prefab`；飞船根下持久保存“船员层”和两名 CrewView；HUD 持久保存能源面板、两个 `PowerRoomRow.prefab` 关联实例和船员状态面板。
- 核心：共享边建立双向出口边，角点不连通；稳定 ID 决定同代价路径；目标站位在 Command 接受时预留；移动中的船员拒绝新命令，其他船员可独立移动。
- 存档：`starship-protocol:r1:crew` 独立保存 schema 1 CrewSnapshot；Command、跨边、到达保存，保存失败回滚，跨边失败暂停 Tick。
- 运行：RoomView 区分点击和拖动；点击船员再点击房间发送 `MOVE_CREW`。Bootstrap 以 0.1 秒周期调用 `advanceOneTick()`，View 只做插值。

## 自动验证

- 根目录 `npm test`：GameCore/Application 55/55、安全 9/9、安全 API 3/3 全部通过。
- `extensions/starship-editor-tools/npm test`：构建 `dist` 后 71/71 通过。
- 根工程 `tsc --noEmit -p tsconfig.json`：通过；根配置启用 `skipLibCheck`，用于跳过 Cocos Creator 3.8.8 自带声明中的 WebGPU、PAL 和私有命名空间缺失，不跳过项目源码检查。
- `git diff --check`：通过。
- GameCore 边界搜索：无 `cc`、DOM、`localStorage` 或 Node 内置 API 代码引用。
- 确定性：相同初始状态、Command 和 Tick 序列重复 100 次结果一致。

## Creator 电脑验收

- 扩展管理器：[`R1-CREW-extension-manager-v1.5.0.png`](R1-CREW-extension-manager-v1.5.0.png) 显示 `starship-editor-tools v1.5.0` 已启用。
- Project / Panel 直接菜单：[`R1-CREW-project-direct-menu.png`](R1-CREW-project-direct-menu.png)、[`R1-CREW-panel-direct-menu.png`](R1-CREW-panel-direct-menu.png)。
- 场景与中文层级：[`R1-CREW-creator-scene-and-hierarchy.png`](R1-CREW-creator-scene-and-hierarchy.png) 显示单反应堆、电梯、激光、护盾、船员层、两名船员、能源面板和船员状态面板。
- 中文 Inspector：[`R1-CREW-engineer-chinese-inspector.png`](R1-CREW-engineer-chinese-inspector.png)。
- M0-007A 关闭项：[`M0-007A-chinese-standard-skeleton-10-nodes.png`](M0-007A-chinese-standard-skeleton-10-nodes.png)、[`M0-007A-authoring-panel-420-css-px.png`](M0-007A-authoring-panel-420-css-px.png)。
- 正式构建：[`R1-CREW-web-desktop-build-success.png`](R1-CREW-web-desktop-build-success.png) 显示 2026-08-12 01:49:17 构建成功，用时 19 秒。

## 正式产物浏览器验收

正式 `build/web-desktop` 由本地静态服务器运行于 `http://127.0.0.1:7470/`，以下均为 Cocos Canvas 实际点击、拖动、滚轮与刷新结果，不以 HTTP 200 代替验收：

1. 初始场景顺序和持久 UI 正确：[`R1-CREW-web-initial.png`](R1-CREW-web-initial.png)。
2. 能源由 0 分配为激光 6、护盾 4；继续增加护盾时显示“能源不足：需要 11，可用 10”，并保持 6/4：[`R1-CREW-energy-insufficient.png`](R1-CREW-energy-insufficient.png)。
3. 激光断电、护盾升到 6，刷新后恢复 0/6：[`R1-CREW-energy-refresh-restored.png`](R1-CREW-energy-refresh-restored.png)。
4. 工程师移动时可观察地经过电梯：[`R1-CREW-moving-via-elevator.png`](R1-CREW-moving-via-elevator.png)。
5. 工程师占用容量 1 的电梯后，武器操作员命令被原子拒绝并显示“目标房间已满”：[`R1-CREW-room-full.png`](R1-CREW-room-full.png)。
6. 移动期间拖动护盾室不生效：[`R1-CREW-room-drag-locked.png`](R1-CREW-room-drag-locked.png)。到达后可把护盾室移到合法空位并移回，中文提示“房间布局已更新，导航图已重建”：[`R1-CREW-room-drag-rebuilt.png`](R1-CREW-room-drag-rebuilt.png)。
7. 工程师到达激光室、武器操作员独立到达护盾室：[`R1-CREW-two-crews-arrived.png`](R1-CREW-two-crews-arrived.png)。刷新后两人位置和能源 0/6 同时恢复：[`R1-CREW-refresh-restored.png`](R1-CREW-refresh-restored.png)。
8. 镜头拖动与滚轮缩放继续工作：[`R1-CREW-camera-pan-zoom.png`](R1-CREW-camera-pan-zoom.png)。
9. 最终 Console 只有四次正常 `LoadScene` 日志，warning/error 数量均为 0。

## 完成判定

自动门槛、Creator 人工门槛、正式 Web Desktop Build、生成产物实际交互、刷新恢复和持久截图均已通过。未提交、未推送、未发布。
