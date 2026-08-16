# R1 UI 收敛迁移保护记录

日期：2026-08-16

## 迁移前保护

在修改 UI 运行时代码和 Creator 创作入口前，已把当时未提交的三份资源复制到外部临时目录，并生成二进制差异补丁：

- 备份目录：`C:\Users\liao\AppData\Local\Temp\starship-ui-migration-backup-20260816`
- 二进制补丁：`C:\Users\liao\AppData\Local\Temp\starship-ui-migration-backup-20260816\ui-dirty.patch`
- `assets/ui/prefabs/MainScreen.prefab` SHA-256：`f23ea1183cf01010d39bcda90c6efcc0de2880bea16addb5ab05faf9d52187c4`
- `assets/ui/prefabs/UIRoot.prefab` SHA-256：`559b3d5291376d56a198fa9af8e6f7e668fb4c2a96f3a1bc8216e16d46dd41c0`
- `assets/ui/textures/main-hud-frame-v2.png` SHA-256：`9cbfd4ec7d55704da835b216e1144488aba3d0e8fb08200bd0b12b58a2192368`

上述三份工作区资源未被迁移脚本或运行时代码覆盖；Creator 迁移入口重新建立了无覆盖 MainScreen 实例。外部备份仍保留，便于人工验收后按需恢复。

## Creator 执行结果

- 2026-08-16 用户在 Cocos Creator 3.8.8 中执行迁移入口并保存成功；Creator 面板显示绿色成功结果。
- Asset DB 当前只剩五个正式 UI Prefab：`UIRoot`、`MainScreen`、`BattleHUD`、`BuildOptionCard`、`PowerRoomRow`。
- 旧单用途 UI Prefab 与 `SettingsPopup.ts` / `.meta` 已删除；`npm test` 的架构边界检查通过。

## Web Desktop 验证结果

- 使用 Cocos Creator 3.8.8 CLI 生成独立验证产物，启动场景使用 BootScene UUID `ca7ad1db-2855-44f1-b0ef-2dfce2e5f84d`；构建任务日志显示 `build Task (web-desktop) Finished`。CLI 进程因已打开 Creator 占用 `temp/logs/project.log` 返回 36，但产物已完整写入。
- 通过本地静态服务 `http://127.0.0.1:7464/web-desktop/` 实际打开产物，首屏从 BootScene 进入主界面；依次验证星图、飞船、建造、船员、设置开关、Battle 进入/返回主界面，截图均为 Canvas/WebGL 实际画面。
- 1280×720 浏览器视口下 CSS Canvas 为 1280×720，运行过程中新增 Console `error` / `warning` 为 0；建造页卡片缓存和导航切页没有新增错误。
