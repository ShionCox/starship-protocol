# R2-SEC-001～005：Windows 发布安全基础证据

- 日期：2026-08-09
- 范围：发布密码学工具、独立 Win32 启动器、FastAPI 发布安全切片、规范与测试入口
- 结论：基础实现完成；生产 KMS/TLS、Cocos Native ConfigRegistry、脚本加密、Authenticode 和签名安装器尚未验证。

## 实现证据

- `tools/release-security/release-security.mjs`
  - Node 标准库 AES-256-GCM 配置打包；
  - RSA-PSS-SHA256 清单签名与复验；
  - 路径、符号链接、缺失/额外文件、大小和 SHA-256 校验；
  - 所有输出使用 `wx`，默认拒绝覆盖。
- `native/launcher/src/main.cpp`
  - WinTrust 自签名检查、WinHTTP HTTPS、Crypt32 公钥导入、BCrypt RSA-PSS/SHA-256；
  - CORE 每次完整 Hash、BULK 同 Build 增量缓存；
  - 断网缓存清单、服务端拒绝不可离线绕过、文件异常提示重装。
- `services/api/app/`
  - 签名清单原始字节发布；
  - 当前 Build/Manifest 绑定的短时 Launch Ticket；
  - Guest Session 与双凭证 Bootstrap；
  - AES 内容密钥、Ticket/Session Secret 通过依赖注入或环境变量提供。
- `项目规范包/docs/ADR-0002-Windows正式发行与服务端版本验证.md`
  - 正式 Windows Native、Web 仅开发预览、文件信任与服务端权威边界已接受。

## 自动验证

执行结果：

```text
npm run test:core
npm run test:security
npm run test:security-api
npm run test:launcher
```

```text
npm test
  application/GameCore: 20 passed, 0 failed
  release-security: 5 passed, 0 failed
  FastAPI release security: 3 passed, 0 failed

npm run test:launcher
  CMake configure: passed
  MSVC x64 Release compile: passed
  Node RSA-PSS signature -> Win32 BCrypt verification: passed

extensions/starship-editor-tools: npm test
  TypeScript build: passed
  editor extension tests: 10 passed, 0 failed

Cocos 3.8.8 bundled TypeScript strict check
  tsc --project tsconfig.json --noEmit --skipLibCheck: passed
```

FastAPI 测试输出有一条上游 `StarletteDeprecationWarning`（TestClient 的 httpx 适配迁移提示），不影响 3 项测试结果；正式依赖锁定时需按 FastAPI/Starlette 支持矩阵处理。

测试覆盖：

- 规则解析、网格、存档与恢复；
- AES 正确解密、错误密钥、密文和认证标签篡改；
- RSA 正确签名、payload 篡改和错误公钥；
- 发布目录文件篡改、额外文件和路径穿越；
- Manifest → Ticket → Session → Bootstrap 全流程；
- 未知 Build 和篡改 Ticket 拒绝；
- Cocos 3.8.8 RapidJSON + Windows SDK + MSVC Release 编译；
- 短时 Ticket 在精确到期时刻立即失效。

## 未验证且不得视为完成

- 未生成或接触生产 RSA 私钥、AES/HMAC 密钥、代码签名证书；
- 未部署真实 HTTPS、Redis Rate Limit、KMS/HSM 或 CDN；
- 未把 Cocos 正式运行时从源 JsonAsset 迁移到 Native Secure ConfigRegistry；
- 未在 Cocos Windows Release 中实际启用并检查脚本加密；
- 未生成、签名、安装和篡改测试正式安装器；
- 未实现完整 FastAPI 账号/经济服务和 Node Battle Service 权威战斗。
