# 服务端、API、数据库与反作弊

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 客户端只发请求与 Command；服务端是联网数据和奖励的最终权威。

> **当前状态**：R1 只冻结契约和权威规则，仓库不实现服务器进程。FastAPI、MySQL、Redis 和 Node Battle Service 必须等本地战斗闭环完成后按真实部署条件开发。

# 30. 服务端架构

## 30.1 FastAPI

未来第一版采用一个 FastAPI 单体，先负责 Auth、玩家 Bootstrap、玩家 Command、配置版本和 PvE 编排。库存、任务、邮件、商店、排行和 GM 只有进入真实需求时才增加，不提前拆微服务。

## 30.2 Battle Service

Node.js + TypeScript。

只负责：加载共享 GameCore、创建战斗、权威 Tick、验证 Command、生成 Result、生成 Replay、State Hash。

不负责登录、商店、邮件和 GM。

## 30.3 Redis

Redis 只在真实需要时用于 Session、Rate Limit、短期幂等和战斗队列。玩家权威状态与经济流水不能只放 Redis。

---

---

# 31. 主要 API 草案

## Auth

```text
POST /api/v1/auth/guest
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/player/bootstrap
POST /api/v1/player/commands
```

## Battle

```text
POST /api/v1/battles/pve
GET  /api/v1/battles/{id}
GET  /api/v1/battles/{id}/replay
```

所有路径最终以实际接口设计文档为准。

玩家 Command 请求必须携带 `requestId`、`idempotencyKey`、`expectedRevision` 和 `configVersion`；首版响应固定携带 `serverTime`、权威 `revision`、完整 State、Event 与稳定错误码，不提前支持 Delta。客户端重试同一动作时复用同一幂等键。

---

---

# 32. 数据库核心表

第一版只建立必要聚合：

```text
users
player_profiles
player_saves
player_resources
resource_ledger
idempotency_records
config_versions
battle_records
battle_replay_refs
```

房间、船员和布局初期保存在版本化 `player_saves` JSON 聚合中；没有实际查询/运营需求前不拆几十张实例表。资源余额独立保存，每次经济变化必须写 `resource_ledger`。

---

---

# 33. 事务与数据安全

以下必须事务处理：领奖、升级、制造、购买、邮件领取、战斗结算、市场交易、稀有道具消耗。

必须防止：重复领奖、重放请求、双击购买、并发升级、负库存、负货币。

## 33.1 离线结算

1. 服务端以自身时间读取玩家 `lastSettledAt`，不信任客户端时钟。
2. 建造、升级和研究计时按完整真实离线时间推进。
3. 资源生产只计算 `min(serverNow - lastSettledAt, 12 小时)`；超出上限的产出时间丢弃。
4. 结算后把 `lastSettledAt` 推进到当前服务端时间。
5. 在同一数据库事务中锁定玩家聚合、计算产出、更新余额、写入 resource_ledger、更新 revision 和幂等记录。
6. 重复 Bootstrap、重试或并发请求不能重复结算。
7. `GET /api/v1/player/bootstrap` 在本次请求实际完成离线结算时返回可选的 `OfflineSettlementSummary`；客户端只显示该已入账摘要，不能提交资源数量。
8. 离线期间不执行战斗、任务胜负、船员移动、AI 或随机掉落。

---

---

# 41. 安全与反作弊

## 41.1 客户端永不可信

客户端显示的资源数不能作为数据库依据。

## 41.2 服务端校验

服务端必须校验：房间归属、船员归属、装备合法性、布局合法性、能源合法性、AI Rule 合法性、Command 条件、资源余额。

## 41.3 战斗

R2 PvP：服务端运行 GameCore；客户端结果仅供显示；最终奖励只由 FastAPI 事务发放。

## 41.4 客户端文件与版本验证

- 正式 Windows 客户端只由已签名独立启动器拉起；启动器公钥验证 RSA-PSS-SHA256 发布清单。
- 核心脚本、EXE、DLL 和 AES-GCM 规则包每次完整 SHA-256；普通资源可在同一签名 Build 内增量校验。
- 清单签名私钥、AES 内容密钥、Ticket/Session HMAC 密钥必须来自 Secret/KMS，不得存在仓库、镜像层或客户端包。
- 文件异常时 fail closed，不提供客户端内自动修复接口，统一引导玩家重新安装正式签名包。
- 启动器只证明安装文件与发布版本一致，不能证明运行进程未被调试或打补丁；所有真实收益仍由服务端重新校验。
- 完整架构决策见 `ADR-0002-Windows正式发行与服务端版本验证.md`。

---

---

# 42. 管理后台需求

Vue 3 + Tailwind CSS。

## P1

- 玩家查询；
- 用户封禁；
- 资源日志；
- 船体配置；
- 房间配置；
- 船员配置；
- 武器配置；
- AI 条件/动作；
- PvE 敌人；
- 配置发布；
- 公告；
- 邮件；
- 战斗查询。

## P2

- 活动；
- 商店；
- 礼包；
- 赛季；
- 经济分析；
- 留存；
- 战斗胜率；
- 房间使用率；
- AI Rule 使用率；
- 流派分析。

---
