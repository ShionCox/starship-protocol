# R2-SEC-007：Windows 加密 Release 与发行审计证据

- 日期：2026-08-09
- 范围：Creator 3.8.8 Windows Native 脚本加密、生成目录规则清理、MSVC Release 和静态审计
- 结论：脚本加密与发行审计子项已验证；正式 `.spcfg` 尚未由 Secret/KMS 生成并加入签名清单，因此 R2-SEC-007 主项保持未勾选。

## 实现证据

- `tools/release-security/build-cocos-windows-release.mjs`
  - 调用 Cocos Creator 3.8.8 Windows Native Release 构建；
  - 每次构建生成一次性 XXTEA 密钥，启用 Encrypt JS、ZIP 压缩并关闭 Source Map；
  - 构建配置写入系统临时目录并在结束后删除，Creator 日志中的一次性密钥会被脱敏；
  - 构建后执行 CMake/MSVC x64 Release 和独立 staging 审计。
- `tools/release-security/release-security.mjs`
  - 只在 Creator 生成目录中定向移除与已知稳定 ID 匹配的完整源房间规则；
  - 不编辑 `.scene`、`.prefab` 或 `.meta` 源文件；
  - 拒绝缺少加密脚本、`encrypted` 标记错误、明文项目脚本、Source Map、脚本备份、私钥材料和明文房间规则。
- `assets/scripts/presentation/RoomView.ts`
  - 源房间 `JsonAsset` Inspector 引用标记为编辑器专用；
  - Native 正式运行不从源 JsonAsset 解析规则，只接受安全启动后注入的 `ConfigRegistry`。

## 实际构建与审计

```text
npm run security:build-windows-native
  Creator 3.8.8 Windows Native Encrypt JS: enabled
  ZIP compression: enabled
  Source Map: disabled
  generated editor room definitions stripped: 1
  starship_security_crypto.lib: linked
  cocos_engine.lib: linked
  starship_security.lib: linked
  plugin_registry.lib: linked
  starship-protocol.exe: linked
  Windows Native encrypted Release audit: passed

npm run security:audit-windows-native -- --root build/secure/windows/proj/Release
  exit code: 0

staging inspection
  Resources/assets/internal/index.jsc: present
  Resources/assets/main/index.jsc: present
  Resources/assets/main/cc.config.json encrypted: true
  Resources/assets/main/cc.config.json debug: false
  *.map: 0
  *.pem/*.pfx/*.p12/*.key: 0
  plaintext room rule markers in JSON/JS: 0

encrypted EXE process probe
  Process: starship-protocol
  WindowTitle: starship-protocol
  Responding: True
  HasWindow: True
```

无参数启动只验证真实加密 EXE、Cocos 引擎与安全插件产物能够启动并响应。按设计，缺少启动器传入的短时 Ticket 与 HTTPS Bootstrap 上下文时，不应进入完整游戏初始化。

## 自动回归

```text
npm test
  application/GameCore: 24 passed, 0 failed
  release-security: 9 passed, 0 failed
  .jsc/.spcfg CORE classification and tamper rejection: passed
  FastAPI release security: 3 passed, 0 failed

npm run test:security-native
  Cocos Native plugin compile and Windows CNG AES-GCM/SHA-256 smoke: passed

npm run test:launcher
  Win32 launcher MSVC x64 Release compile: passed

Cocos 3.8.8 bundled TypeScript
  tsc --project tsconfig.json --noEmit --skipLibCheck: passed

Codex 内置浏览器 Web 回归
  双房间加载、快速拖动、越界松开后再次拖动、滚轮缩放、空白平移、刷新恢复: passed
  Console warning/error: 0
```

## 尚未验证且不得视为完成

- 未使用生产 Secret/KMS 生成正式 `.spcfg`；
- `.spcfg` 尚未加入离线私钥签名的 CORE 文件清单并由启动器完成整包复验；
- 未接通真实 HTTPS Bootstrap/CDN 和有效短时 Ticket 的 Native 正向安全启动；
- 未完成 Authenticode 和签名安装器人工验收。
