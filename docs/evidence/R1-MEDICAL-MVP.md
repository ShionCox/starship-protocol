# R1 P6 医务员与医疗室最小可玩纵切证据

> 日期：2026-08-12。本文只证明手动供电医疗纵切；真实船员伤害、死亡、医疗 AI、自动返岗、医疗物资和 BattleScene 战斗操作仍未完成。

## 1. 持久资源与规则

- `room-medbay.json`：schema 2，`room-medbay`，支援房间，2×2，耐久 100，容量 2，最低/最大能源 2，治疗量 1/Tick。
- `crew-medic.json`：schema 3，`crew-medic`，职业 `MEDIC`，最大生命 100，移动 5 Tick/边，维修量 0。
- Creator 3.8.8 通过项目创作插件创建并保存 `MedicalRoom.prefab`、`MedicCrew.prefab`、`room-medbay-1` 和 `crew-medic-1`；医疗室使用首个合法逻辑空位 `(4,0)`，未写死世界像素坐标。
- `UIRoot.prefab` 持久包含医疗室能源行、船员生命 Label 和治疗按钮；MainScene 武器操作员初始生命为 40，医务员位于医疗室站位 0。
- 创作插件及锁文件版本为 1.7.0，`dist` 只由 clean build 生成且不被 Git 跟踪。

## 2. 自动门槛

- 根目录 `npm test`：GameCore/Application 76/76，编辑器扩展 72/72。
- Cocos Creator 3.8.8 内置 TypeScript `--noEmit`：通过。
- `git diff --check`：通过。
- GameCore 边界扫描：无 `cc`、DOM、localStorage 或 Node 内置 API。
- `git ls-files extensions/starship-editor-tools/dist`：0。

测试覆盖 schema 版本与职业/分类约束、初始生命、显式配对、开始/停止、满生命自动结束、无效医务员/房间/能源、断电解对、双向快照校验、医疗先于维修、单 Tick 单 revision、双舰隔离、刷新恢复、写盘失败回滚和 100 次确定性。

## 3. Creator 与正式构建

- 扩展管理器确认 `starship-editor-tools v1.7.0` 已启用，创作工具重新校验为 0 项错误。
- MainScene 持久包含五个房间和三名船员；医疗能源行绑定 `room-medbay-1`，武器操作员 Inspector 初始生命保存为 40。
- Web Desktop 正式构建于 23:16:44 完成，耗时 18 秒；实际从 `build/web-desktop` 生成产物运行，而非只检查 HTTP 状态。

## 4. Web 实测

使用隔离本地端口运行同一正式构建，避免旧开发存档影响固定演示：

1. 初始能源 `0/10`，医疗室 `0/2`，武器操作员 `40/100`。
2. 医疗室加电一次后为 `2/2`；武器操作员从反应堆移动到 `room-medbay-1`，医务员已在同房站位 0。
3. 点击“开始治疗”后病员为“治疗中”，按钮切换为“停止治疗”，生命按 10Hz、1 点/Tick 增长。
4. 治疗到 `47/100` 时断开医疗室能源，状态立即回到空闲，生命保持 `47/100`，顶部提示“医疗室已断电，治疗已停止”。
5. 恢复供电后重新治疗；手动停止于 `55/100`，等待后仍为 `55/100`。
6. 再次开始并刷新页面，恢复后仍为“治疗中”，生命从持久状态继续增长（截图为 `54/100`）。
7. 到达 `100/100` 后病员和医务员自动空闲，顶部提示“治疗完成：武器操作员已恢复至 100/100”。
8. 主菜单与船员页面切换正常；最终浏览器 Console 为 0 warning / 0 error。

持久截图：

- `R1-medical-web-initial.png`
- `R1-medical-web-treating.png`
- `R1-medical-web-power-off-stop.png`
- `R1-medical-web-manual-stop.png`
- `R1-medical-web-refresh-restored.png`
- `R1-medical-web-completed.png`
- `R1-medical-creator-main-scene.jpg`
- `R1-medical-creator-build-success.jpg`

## 5. 完成边界

P6 只关闭场景 E2“手动供电医疗”。E1 真实船员伤害来源、E3 AI 送医与返岗以及完整武器、护盾、伤害、胜负、AI、Battle UI、Replay 和 PvE 均未完成。下一模块进入武器系统，不得据此宣称完整医疗场景、完整战斗或完整 R1 已完成。
