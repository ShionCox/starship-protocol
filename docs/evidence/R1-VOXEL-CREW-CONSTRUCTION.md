# R1 P8 体素、多层行为与建造纵切证据

> 记录日期：2026-08-13
> 范围：P8 权威 CSV、体素地板、多层导航、士兵巡逻、施工规则、Creator 双层演示和 Web 冷启动。
> 完成边界：本文只记录已经复现的事实；完整建造/拆除/离线 Web 流程和四职业动画仍未验收，因此 P8 主项保持未完成。

## 自动门槛

- 2026-08-15 根目录 `npm test`：核心 `159/159`、编辑器扩展 `108/108`，退出码 0。此前 `108/108`、`98/98` 是本纵切首轮历史计数，不再代表当前门槛。
- Cocos Creator 3.8.8 TypeScript 校验：`node extensions/starship-editor-tools/node_modules/typescript/bin/tsc -p tsconfig.verify-p8.json --pretty false`，退出码 0。
- `git diff --check`：退出码 0；仅显示两个既有规范文档的 CRLF 提示。
- `git ls-files extensions/starship-editor-tools/dist`：无输出，生成目录未被 Git 跟踪。
- 自动测试覆盖 CSV BOM/CRLF/RFC4180、跨表引用、固定墙、地板支撑、上下不直连、楼梯/电梯跨层、巡逻抢占恢复、施工槽/加速、金属/退款、离线结算、回拨和写盘回滚。

## Creator 持久资产

用户在 Creator 3.8.8 中重新执行 P8 双层演示装配、保存 `MainScene.scene` 并重新构建 Web Desktop。场景序列化可核对到：

- 下层 `floor-basic-1-1` ～ `floor-basic-17-1` 共 17 块地板，`(18,1)` 保留为空作为建造/拆除回归目标；
- 上层 `floor-basic-1-5` ～ `floor-basic-18-5` 共 18 块地板；
- `room-reactor-1`、`room-laser-1`、`room-shield-1`、`room-medbay-1`、`room-elevator-1`、`room-stairs-1`；
- `crew-engineer-1`、`crew-gunner-1`、`crew-medic-1`、`crew-soldier-1`；
- 士兵巡逻路线持久字段为 `room-laser-1 → room-medbay-1 → room-shield-1 → room-reactor-1`。

2026-08-14 收口调整：完整施工验收要求三名工程师。创作工具标准演示已额外装配 `crew-engineer-2`（激光室站位 1）和 `crew-engineer-3`（护盾室站位 0），总计四职业六名船员；用户完成 P8.3 全新重建后，MainScene 序列化与 17:07 正式 Web 包均已核对这六个稳定船员 ID。

巡逻路线使用隐藏 JSON 字符串持久字段，由插件通过公开 Scene `set-property` 写入；这是为了避开 Creator 对裸 `CCString[]` dump 的内部结构依赖。运行时仍只暴露只读字符串数组，不把编辑器序列化格式带入 GameCore。

## Web Desktop 冷启动实测

构建产物通过本地静态服务运行。先打开 `http://127.0.0.1:7470/` 时恢复了装配修复前、同一配置版本写下的开发存档，因此旧快照没有新增巡逻路线；这不是场景持久化失败。

使用同一构建的全新来源 `http://localhost:7470/` 冷启动后观察到：

1. BootScene 正常进入 MainScene，双层地板、六个房间、楼梯/电梯和 HUD 可见；
2. UIRoot 始终覆盖飞船画面，没有再次出现世界层遮挡导航、能源和船员面板；
3. 士兵从默认下层激光室开始后台巡逻，随后出现在上层医疗室、上层护盾室，并在连接器位置出现移动过渡；
4. 画面状态提示持续显示固定 Tick/船员状态变化，页面无阻断性白屏或启动失败。

开发期若同一 origin 已保存过缺少新初始字段的同版本快照，需要使用全新 origin 或显式清除该站点开发存档后再验收默认蓝图。正式规则仍以保存的玩家 Envelope 为权威，场景默认值不会静默覆盖已有玩家状态。

## 尚未关闭的验收

- BuildPage 已在正式包显示金属、施工槽、三名工程师和完整控制栏；医疗室/护盾室可在合法目标开工。`ShipConstructionIntegration.test.ts` 与正式 Web 复验均覆盖三工程师最终到场；单人到场时进度稳定封顶 `75%`，不会提前完成。施工工程师被玩家任务抢占、停止后 10 Tick 返工仍需连续 Web 画面。
- 最终正式构建已完成三工程师分散工位与加速施工：医疗室从 0% 推进至完成；第二个护盾室项目取消后按 500‰ 返还 70 金属，刷新恢复余额 830、完成房间和空队列，页面日志 0 warning / 0 error。
- Codex 内置浏览器已在唯一标签页关闭后以同一 origin 重开，得到一次性离线拆除完成摘要；代码与 UIRoot 已升级为中文聚合摘要和持久底板，`R1-P8-web-final11-offline-settlement.png` 已记录关闭/重开后的单次弹窗。
- 四个 Crew Prefab 的 SpriteFrame、AnimationClip 与共同脚底锚点已通过 Creator 重建、序列化资源测试和正式 Web 画面验证；维修、治疗、供电循环、断电首帧、巡逻、施工进度和三工程师 `3/3` 到场均已有截图；仅施工抢占/返工连续画面仍未关闭。
- P8 创作与运行时已统一使用九张权威 CSV（七张玩法表与两张视觉表），船体网格通过 `hulls.csv.cellMask` 表达；`editor-prefabs.csv` 仅用于编辑器 Prefab 映射。旧 JSON 创建/发现/编辑链及其回归测试已移除；素材库中的参考 JSON 不属于运行时配置。
- 正式 Web 截图已保存到 `docs/evidence/R1-P8-web-formal-*`、`R1-P8-web-final-*` 与 `R1-P8-web-final7-*`；内容拆除、5/8 Tick、巡逻抢占和 10 Tick 恢复、三工程师同时到场以及 `(18,1)` 拖放开工均已有人工证据；施工抢占/返工仍不得由自动测试替代。

完成以上项目并复验 Console 后，才能勾选 P8；本纵切不代表通用 AI、完整建造经济、武器、战斗或完整 R1 已完成。
