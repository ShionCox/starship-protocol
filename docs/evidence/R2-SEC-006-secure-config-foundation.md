# R2-SEC-006：Secure ConfigRegistry 基础实现证据

> 历史实验记录：Secure ConfigRegistry、Native 桥和服务样例已在 2026-08-12 删除。未来 R2 重新实现前，本文件不构成当前能力证据。

- 日期：2026-08-09
- 范围：客户端加密包解析、唯一 ConfigRegistry、Cocos Windows Native AES-GCM 插件
- 结论：安全启动装配、Web 回归、Creator Windows 工程生成、MSVC Release 链接和真实 EXE 启动已验证；真实 HTTPS Bootstrap/CDN 正向链路尚未接通，因此 R2-SEC-006 主项保持未勾选。

## 实现证据

- `assets/scripts/application/SecureConfigPackage.ts`
  - 校验 AES-256-GCM 封装、无填充 Base64URL、12 字节 IV、16 字节标签；
  - 解密前后绑定 `buildId` 与 `configVersion`；
  - 拒绝路径穿越、重复文档、错误 payload 和部分加载。
- `assets/scripts/application/ConfigRegistry.ts`
  - 房间定义全部解析成功后才原子替换；
  - 拒绝重复稳定 ID、错误文件名和无房间配置包；
  - 不依赖 Cocos、网络或密码 API。
- `assets/scripts/adapters/CocosAesGcmDecryptor.ts`
  - Windows Native 走 `StarshipSecurity` 原生桥；
  - Web Crypto 只作为开发预览适配；
  - 原生返回空结果时明确失败。
- `assets/scripts/application/SecureConfigBootstrap.ts`
  - 从启动器上下文派生同源 Guest/Bootstrap 端点；
  - 依次取得玩家会话与 Bootstrap，校验 Build/Config、Key ID、IV 和配置 SHA-256；
  - 所有检查、AES-GCM 和文档解析成功后才原子替换 `ConfigRegistry`。
- `assets/scripts/adapters/CocosSecureConfigTransport.ts`
  - 使用 Cocos 3.8 公开 `fetch` 能力下载 HTTPS 响应；
  - Windows Native 通过 CNG 桥计算摘要，Web Crypto 只供开发回归。
- `assets/scripts/bootstrap/PrototypeBootstrap.ts`、`assets/scripts/presentation/RoomView.ts`
  - Native 正式路径按中文 Inspector 的“房间定义 ID”从 Registry 取规则，不读取 JsonAsset；
  - 编辑器/Web 继续由 JsonAsset 预览，并校验稳定 ID 与 JSON 一致。
- `native/security-config/`
  - 使用 Cocos Creator Native Plugin 的 `cc_plugin.json` / CMake 入口；
  - Windows CNG `BCrypt` 执行 AES-256-GCM 认证解密；
  - C++ 异常不会越过 JSB 边界，插件不保存密钥。
- `native/launcher/src/main.cpp`
  - 启动游戏时传入 Build/Config、安装 ID、已签名 Ticket URL 和短时 Ticket；
  - 不把内容密钥写入命令行、文件或脚本。

## 自动验证

```text
npm test
  application/GameCore: 24 passed, 0 failed
  release-security: 9 passed, 0 failed
  FastAPI release security: 3 passed, 0 failed

npm run test:security-native
  Cocos 3.8.8 headers + MSVC x64 Release compile: passed
  Windows CNG AES-256-GCM decrypt: passed
  Windows CNG SHA-256: passed
  modified authentication tag rejected: passed

npm run test:launcher
  Win32 launcher MSVC x64 Release compile: passed
  Node RSA-PSS signature -> Windows BCrypt verification: passed

Cocos 3.8.8 bundled TypeScript
  tsc --project tsconfig.json --noEmit --skipLibCheck: passed

Cocos Web Desktop regression
  builder:build-project-total: 7380ms
  build Task (web-desktop) Finished in 7s
  Codex 内置浏览器：双房间加载、快速拖放吸附、越界松开后再次拖动、刷新恢复、滚轮缩放、空白拖动画布均通过
  Console warning/error: 0

Cocos Windows Native Release
  Creator 3.8.8 Native Plugin parser: starship-security-config discovered
  generated plugin registry: 1 plugin
  build Task (windows) Finished in 39s
  CMake/MSVC x64 Release: starship_security.lib、plugin_registry.lib 和 starship-protocol.exe linked
  实际进程窗口：Responding=True、Hung=False、WM_NULL probe=True
```

Web 回归截图：[`R2-SEC-006-web-regression.png`](R2-SEC-006-web-regression.png)。

Creator CLI 与已打开的编辑器争用 `temp/logs/project.log`，外层进程最终退出 36；但 Web 与 Windows Builder 均明确完成，Windows 生成工程随后由 CMake/MSVC Release 成功编译，真实 EXE 也已启动并通过窗口响应探测。外层退出码未作为成功依据。

直接双击式无参数启动用于验证真实 EXE 与插件链接产物可运行；安全启动代码按设计拒绝缺失启动器上下文。由于尚无真实 HTTPS/CDN 与生产 Ticket，本次不能替代正向联网链路验收。

## 尚未验证且不得视为完成

- 未验证真实 Windows Native 进程从启动器上下文到 FastAPI/CDN 的端到端联网流程；
- 正式 staging 是否已移除源 JsonAsset 由 R2-SEC-007 发行审计验证，不得因运行时已停用就提前宣称完成；
- 未完成生产脚本加密、签名清单与启动器的整包正向启动；
- 未接触生产密钥、KMS、HTTPS/CDN 或 Authenticode 证书。
