# R0 / R1 DoD 收口审计

日期：2026-08-15

## 结论

- R0 已按 `R0-CHECKLIST.md` 的 12 个历史里程碑完成并冻结；当前三场景架构不再保留 Prototype 兼容链，不能用现行资源重新演示已删除的旧界面来否定历史证据。
- R1 当前已实现并通过自动门槛的是客户端重基线、能源、手动维修、手动医疗、P8 体素/跨层导航/巡逻/施工规则，以及 P8.1/P8.3 的主要实现。
- R1 当前仍未完成 P8 的施工抢占/返工连续 Web 证据；三工程师同时到场与离线结算弹窗同源关闭/重开视觉复验已在 2026-08-15 正式包完成。P7、P8.1、P8.3 的对应人工项已完成。武器、护盾效果、真实伤害、胜负、通用 AI、Battle UI、Replay 和 PvE 仍未实现，不能通过补截图或勾选清单关闭。

## 2026-08-15 自动门槛

- `npm test`：GameCore / Application 156/156，编辑器扩展 clean build + test 107/107。2026-08-14 的 149/149 为上一轮历史记录。
- Creator 随附 TypeScript 对 `tsconfig.verify-p8.json` 校验：退出 0。
- `git diff --check`：退出 0；仅有既有中文规范文档 CRLF 转换提示。
- 最终 `build/web-desktop` 已于 2026-08-14 17:23 重建，并通过独立 `localhost:7458` 完成主场景、施工、跨层移动、Battle、刷新、1920×1080 与 1280×900 黑边复验。

## 已取得的本轮人工证据

- Creator 完成 P8.3 全新重建，面板记录总耗时 167822ms，并显示各阶段耗时。
- MainScene 应用根持久显示唯一 `GameConfigCsvSource` 与九张 CSV；Creator 重建结果声明 Main/Battle 已连接共享来源。
- Creator Web 预览完成主页面导航、船员命中、普通地板上沿移动、选框跟随、闲逛、缩放文字、Main/Battle 往返与刷新恢复；清理旧开发存档后的复验 Console 新增 0 warning / 0 error。
- 正式 Web Desktop 重复完成页面切换、船员命中、右键地板移动、到达后空闲、刷新恢复和 Battle 双舰；1280×900 上下黑边正确，Console 0 warning / 0 error。
- 自动测试直接解析 Creator 序列化文件，确认 Main/Battle 应用根唯一九表来源、双方 ShipView 同源、领域 Prefab 无本地来源，以及五房间/四 Crew 的持久动画资产。
- 最终正式包完成三工程师分散工位、加速建造、取消退款、刷新恢复、跨层地板到达、Main/Battle 往返、1920×1080、1280×900 黑边和缩放文字复验；游戏页面日志 0 warning / 0 error。

## 仍需人工关闭

- P8 仍需在正式 Web 中完成施工抢占/返工连续交互与 AnimationClip 状态切换证据；三名工程师同时到场已由 `R1-P8-web-final10-three-engineers-onsite.png` 复验，离线结算弹窗已由 `R1-P8-web-final11-offline-settlement.png` 完成同源关闭/重开视觉复验，现有自动测试已覆盖相应规则。
- 2026-08-15 已通过 Codex 内置 Windows 控制冷重开六个 Room、四个 Crew，并依次切换 Battle/Boot/Main；Creator Console 0 warning / 0 error。证据：`R1-P8.3-creator-console-zero-after-cold-reopen.jpg`。
- 2026-08-15 已补士兵巡逻连续帧、施工进度连续帧、多人施工 75% 收口帧、三工程师 `3/3` 到场帧和离线结算弹窗；P7 视觉动画项已关闭，P8 仅剩施工工程师抢占/返工连续帧。
- 创作工具已完成房间修改/取消/新建、船体 V/B/W Mask、船员草稿与 Prefab 预览的可见操作证据。

## 尚未实现的 R1 路线能力

按唯一路线与 DoD，后续实现顺序保持：武器装填/目标/开火 → 护盾与命中 → 房间/船体/船员真实伤害 → 胜负 → 通用 AI → Battle UI → Replay → PvE。每个切片必须先有纯 GameCore、确定性测试和错误分支，再接 Cocos 持久实例与正式 Web 证据。
