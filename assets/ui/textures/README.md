# 主界面 UI 素材

- `main-hud-frame.png`：第一版 R1 主界面装饰框架，保留作为历史视觉对照。
- `main-hud-frame-v2.png`：当前 1280×720 比例框架；底部只保留连续承重梁，不再绘制导航槽或橙色按钮槽，避免和独立按钮重复。
- 来源：2026-08-16 使用 OpenAI ImageGen，依据 `docs/evidence/R1-MAIN-UI-REDESIGN-OPTION-1.png` 的已选视觉方向生成。
- 处理：第二次生成移除了棋盘格假透明，输出为真实 RGBA PNG；运行时按 1280×720 缩放显示。
- 用途：仅作为表现层 SpriteFrame，不承载按钮文字、业务数值、交互命中区或规则数据。

`buttons/` 中的按钮均为独立 SpriteFrame，并由 Cocos `Button.Transition.SPRITE` 切换：

- `nav-v2-normal.png` / `nav-v2-hover.png` / `nav-v2-pressed.png`：具有凸起、悬浮和机械下压深度差异的主导航三态。
- `battle-v2-normal.png` / `battle-v2-hover.png` / `battle-v2-pressed.png`：独立的重型橙色战斗按钮三态。
- `nav-normal.png` / `nav-hover.png` / `nav-pressed.png`：仅保留给顶部全屏工具按钮使用。
- `icons/nav-*.png`：主界面、星图、飞船、建造、船员与设置六枚独立导航图标。
- 三态源图由 ImageGen 依据同一工业金属方向生成；导航源图为真实 RGBA，战斗源图的棋盘格背景经确定性透明化与统一尺寸归一处理。

该素材是本项目生成资产，不来自 `pss_full`，不进入 P8 CSV 规则源。
