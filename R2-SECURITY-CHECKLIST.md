# R2 Windows 正式发行安全完成清单

> 当前进度：**0 / 10**。此前的 Launcher、Native 配置桥、发布工具和 FastAPI 实验切片已在 R1 客户端重基线中删除；旧自动测试和截图只作历史记录，不能作为未来正式完成证据。

## 完成规则

- R1 完整本地玩法闭环通过后才开始本清单。
- 每个 `[x]` 必须同时有当前实现、自动验证、真实部署或证书证据和 `docs/evidence/` 持久记录。
- 没有生产 TLS、Secret/KMS、Redis、代码签名证书、签名安装器或真实服务端权威证据时不得勾选。
- 客户端加密、混淆和 Hash 不等于不能作弊；账号、经济、布局、奖励与战斗结果必须由服务端权威。

- [ ] **R2-SEC-001：复核正式发行 ADR 与威胁模型**
  - 确认 Windows Native 为正式平台，Web 只作开发预览。
  - 确认客户端防篡改与服务端业务权威的边界。

- [ ] **R2-SEC-002：实现配置加密、签名清单和发布目录复验**
  - AES-256-GCM、RSA-PSS-SHA256、路径/符号链接/额外文件/大小/Hash 拒绝。
  - 私钥和内容密钥来自真实 Secret/KMS，不进入仓库或镜像。

- [ ] **R2-SEC-003：实现独立 Win32 签名启动器**
  - Authenticode、WinHTTP HTTPS、验签、核心全量 Hash、普通资源安全缓存和离线冷启动。

- [ ] **R2-SEC-004：实现真实 FastAPI 发布与会话接口**
  - Manifest、Launch Ticket、玩家 Session、Bootstrap、限流、审计和轮换。

- [ ] **R2-SEC-005：接入 Cocos Native 配置桥**
  - 正式运行移除源 JsonAsset 依赖，认证解密后原子更新 GameConfigCatalog。

- [ ] **R2-SEC-006：完成真实 HTTPS 正向启动链路**
  - Launcher → Ticket → Session → Bootstrap → CDN → Hash → AES-GCM → GameConfigCatalog。

- [ ] **R2-SEC-007：完成 Windows Release 脚本加密与 staging 审计**
  - 无 source map、调试入口、脚本备份、私钥或明文规则。

- [ ] **R2-SEC-008：部署 Secret/KMS、TLS、Redis 与密钥轮换**
  - 完成真实轮换、限流、审计和故障演练。

- [ ] **R2-SEC-009：完成 Authenticode 与签名安装器**
  - 启动器、游戏 EXE、DLL 和安装器签名有效，篡改后二进制被拒绝。

- [ ] **R2-SEC-010：完成端到端正式发行与服务端权威验收**
  - 覆盖全新安装、断网、无缓存、旧版本拒绝、文件篡改、重装、Ticket 过期、配置轮换和经济/战斗权威。
