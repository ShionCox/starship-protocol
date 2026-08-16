# R1 工程师维修最小纵切证据

## 范围

本批只实现预损伤房间的手动工程师维修。真实伤害来源、AI 调度、火灾、能源消耗、医疗和完整战斗不属于本批完成范围。

## 已完成实现

- `CrewDefinition` schema 2 增加 `repairHpPerTick`；工程师为 1，武器操作员为 0。
- `CrewModel` 与 `ShipModel` 支持 `REPAIRING`、开始/停止维修、稳定顺序叠加、满耐久自动停止、维修期间布局锁定和 schema 2 原子恢复。
- `LocalPlayerStatePort` 使用既有单一 Envelope 保存维修 Command 与固定 Tick，写入失败恢复 Tick 前完整状态。
- `RoomView` 提供中文“初始耐久”和耐久条；`CrewStatusPanel` 提供中文房间耐久、开始/停止维修按钮和精确事件注销。
- 创作插件升级为 1.6.0，船员创建、发现和编辑共用 schema 2 解析，创作面板增加中文“每 Tick 维修量”。

## 自动验证

- 2026-08-12 根目录 `npm test`：核心 67/67、编辑器扩展 clean build 后 68/68 通过。
- Cocos Creator 3.8.8 内置 TypeScript `--noEmit`、`git diff --check`、GameCore 边界和插件 dist 跟踪状态在最终验收前统一复核。

## Creator 持久资源

- 2026-08-12 通过星舰创作工具升级并保存 `UIRoot.prefab`；Prefab 已持久包含“房间耐久”“维修按钮”和按钮文字，并连接 `CrewStatusPanel` 白名单引用。
- MainScene 激光室实例持久覆盖 `initialHp = 60`，其他房间保留 `-1`。
- MainScene 持久保存 `crew-engineer-1`、`crew-gunner-1`，两人初始房间均为 `room-reactor-1`、站位分别为 0/1；`MainSceneBootstrap.configVersion = r1-repair-1`。
- Creator 编辑态可见激光室受损耐久条和完整中文维修面板；上述资源均由 Creator/项目插件保存，没有手工编辑 Scene、Prefab 或 Meta。

## 正式 Web Desktop 验收

- 2026-08-12 22:10:45 正常构建成功（16 秒），初始场景为 BootScene，生成产物从本地 HTTP 服务实际运行。
- 1280×720 验收：激光室初始为 60/100；选择工程师后，路径可见地经过电梯并到达激光室。
- “开始维修”后状态变为“维修中”，房间耐久按 10Hz、每 Tick 1 点稳定增加；达到 100/100 后自动回到空闲并显示完成提示。
- 手动停止在 66/100 成功，等待后耐久保持；再次开始后刷新页面，未重新下达 Command 仍继续维修并最终恢复到 100/100，证明维修状态、HP 和 Tick 存档恢复有效。
- 维修开始后立即拖动护盾室，房间保持原位且未出现“房间位置已更新”，验证布局锁定；维修完成后既有房间移动规则恢复。
- 武器操作员移动到 60/100 的激光室后“开始维修”按钮不可用，点击不改变 HP，Console 无 warning/error。
- 能源回归通过：激光室从 0 直接开启到最低能源 2，总计显示 2/10；页面切换到“星图”正常。P2 已有镜头、全屏、16:9 与本地恢复证据继续有效。
- 四个独立本地端口分别验证主流程、停止/刷新、武器操作员拒绝和布局锁定；所有页面 Console 合计 0 warning / 0 error。

## 持久截图

- [工程师经电梯移动](R1-repair-moving-via-elevator.png)
- [维修进行中](R1-repair-in-progress.png)
- [手动停止维修](R1-repair-manual-stop.png)
- [刷新后继续并自动完成](R1-repair-refresh-complete.png)
- [武器操作员维修禁用](R1-repair-gunner-disabled.png)
- [维修期间布局锁定](R1-repair-layout-locked.png)
- [能源与页面切换回归](R1-repair-energy-page-regression.png)

## 完成边界

本证据只关闭手动工程师维修 D2。真实伤害来源 D1、AI 自动调度 D3、医疗、武器、护盾、胜负、Replay 和 PvE 仍未完成，不得据此宣称完整场景 D、完整战斗或完整 R1 已完成。
