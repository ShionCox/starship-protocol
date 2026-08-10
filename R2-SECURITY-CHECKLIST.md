# R2 Windows 正式发行安全完成清单

> 当前进度：**5 / 10**。本清单独立于 `R0-CHECKLIST.md`；自动实现证据不能替代生产证书、部署环境和安装器人工验收。

## 完成规则

- 每个 `[x]` 必须同时有实现、自动验证和 `docs/evidence/` 持久证据。
- 需要证书、KMS、HTTPS、Cocos 构建或安装器 UI 的步骤，没有真实环境证据不得勾选。
- “加密/混淆已启用”不等于“不能作弊”；正式完成必须同时验证服务端权威。

- [x] **R2-SEC-001：接受正式发行架构决策**
  - 证据：`项目规范包/docs/ADR-0002-Windows正式发行与服务端版本验证.md`
  - 证据：规范总览、架构、目录、配置、服务端、编码、DoD 和里程碑已同步。

- [x] **R2-SEC-002：实现配置加密和签名清单工具**
  - AES-256-GCM，12 字节随机 IV、16 字节认证标签，AAD 绑定 Build/Config/Key ID。
  - RSA-PSS-SHA256 签名原始规范化 payload；私钥只从环境指定文件读取。
  - 发布目录校验拒绝缺失、额外、路径穿越、符号链接、大小和 Hash 异常。
  - 证据：`docs/evidence/R2-SEC-001-release-security-foundation.md`

- [x] **R2-SEC-003：实现独立 Win32 签名启动器源码**
  - 自身 Authenticode、WinHTTP HTTPS、RSA 验签、CORE 全 Hash、BULK 增量缓存、短时 Ticket。
  - 断网只使用已验签缓存；服务端明确拒绝不降级；文件异常禁止启动并提示重装。
  - 证据：`native/launcher/README.md`
  - 证据：`docs/evidence/R2-SEC-001-release-security-foundation.md`

- [x] **R2-SEC-004：实现 FastAPI 发布安全最小切片**
  - Latest Manifest、Launch Ticket、Guest Session、Bootstrap 已实现。
  - Build/Manifest 不匹配、Ticket 篡改或缺失会被拒绝。
  - 证据：`services/api/README.md`
  - 证据：`docs/evidence/R2-SEC-001-release-security-foundation.md`

- [x] **R2-SEC-005：建立自动验证入口和密钥仓库边界**
  - 根测试串联 GameCore、发布密码学和 FastAPI；启动器有独立 MSVC 编译烟测。
  - `.pem/.pfx/.p12/.key/.spcfg/.spmanifest` 与发布输出默认忽略。
  - 证据：`package.json`、`.gitignore`、`docs/evidence/R2-SEC-001-release-security-foundation.md`

- [ ] **R2-SEC-006：Cocos Native 接入唯一 Secure ConfigRegistry**
  - 正式运行时移除源 JsonAsset 规则依赖；通过平台 AES-GCM 桥在内存中解密并校验 Build/Config。
  - 编辑器仍可读取源 JSON 做预览，插件与 GameCore 不依赖运行时密码层。
  - [x] 纯 TypeScript 加密封装解析、Build/Config 双重校验和原子 `ConfigRegistry` 已实现。
  - [x] Cocos Native Plugin + Windows CNG AES-GCM 桥已通过独立 MSVC 编译与认证解密烟测。
  - [x] Cocos 正式启动流程已接入 Guest Session、Bootstrap、配置 SHA-256、内存解密和 Registry 原子注入；自动测试与 Web 回归已通过。
  - [x] Creator 3.8.8 已生成 Windows 工程，MSVC Release 已链接安全插件，真实 EXE 已启动且窗口响应正常。
  - [ ] 尚未用真实 HTTPS Bootstrap/CDN 和有效短时 Ticket 完成 Native 正向安全启动。
  - 进度证据：`docs/evidence/R2-SEC-006-secure-config-foundation.md`

- [ ] **R2-SEC-007：启用 Cocos Windows Release 脚本加密与发行审计**
  - 正式 staging 不含 source map、调试入口或明文规则；`.jsc/.spcfg` 均进入 CORE 清单。
  - [x] Creator 3.8.8 已使用一次性构建密钥启用 Native Encrypt JS、ZIP 压缩并关闭 Source Map。
  - [x] 生成目录中的编辑器源房间规则已定向移除，未改写 `.scene`、`.prefab` 或 `.meta` 源文件。
  - [x] 加密 Windows Release 已完成 CMake/MSVC x64 编译，独立审计和真实 EXE 窗口响应检查均通过。
  - [x] 自动发布测试已证明 `.jsc` 与 `.spcfg` 均标记为 CORE，任一文件被篡改都会拒绝校验。
  - [ ] 正式 `.spcfg` 尚未由 Secret/KMS 密钥生成并加入已签名 CORE 清单，因此主项不得勾选。
  - 进度证据：`docs/evidence/R2-SEC-007-windows-release-audit.md`

- [ ] **R2-SEC-008：部署 HTTPS、Secret/KMS、Redis Rate Limit 与密钥轮换**
  - 生产私钥、AES/HMAC 密钥不落仓库、镜像层或日志。
  - 需要真实部署与轮换演练证据。

- [ ] **R2-SEC-009：完成 Authenticode 与签名安装器**
  - 启动器、游戏 EXE、DLL 和安装器签名链有效；篡改后二进制无法通过。
  - 需要正式代码签名证书与 Windows 人工验收证据。

- [ ] **R2-SEC-010：完成端到端正式发行与服务端权威验收**
  - 覆盖全新安装、断网冷启动、无缓存断网、旧版本拒绝、文件篡改、重装、Ticket 过期、配置轮换。
  - 修改本地客户端不得改变服务端账号、库存、奖励、布局或战斗结果。
  - 完成后才允许把 Windows 包标记为正式可发行。
