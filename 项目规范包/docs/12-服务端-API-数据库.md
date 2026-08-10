# 服务端、API、数据库与反作弊

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 客户端只发请求与 Command；服务端是联网数据和奖励的最终权威。

# 30. 服务端架构

## 30.1 FastAPI

负责：Auth、Player、Ship、Layout、Crew、Inventory、Equipment、Research、Mission、Mail、Shop、Matchmaking、Ranking、Config、Battle Orchestration、Replay Metadata、GM。

## 30.2 Battle Service

Node.js + TypeScript。

只负责：加载共享 GameCore、创建战斗、权威 Tick、验证 Command、生成 Result、生成 Replay、State Hash。

不负责登录、商店、邮件和 GM。

## 30.3 Redis

用途：Session、Config Cache、Distributed Lock、Rate Limit、Match Queue、Ranking、Battle Job Queue、Online Presence、Idempotency Key。

---

---

# 31. 主要 API 草案

## Auth

```text
POST /api/v1/auth/guest
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

## Client Release Security

```text
GET  /api/v1/client/manifests/latest
POST /api/v1/client/launch-ticket
GET  /api/v1/client/bootstrap
```

- `manifests/latest` 返回发布流水线生成的签名清单原始字节，不由请求参数拼装清单。
- `launch-ticket` 只接受当前支持的 `buildId + manifestSha256 + installId`，签发 90 秒级短时凭证；服务端明确拒绝时客户端不得降级离线绕过。
- `bootstrap` 同时验证 Launch Ticket 和玩家 Session，返回与当前 Build 匹配的加密配置描述和短时内容密钥。
- 上述接口必须使用 HTTPS、`Cache-Control: no-store`、Redis Rate Limit、可观察审计日志和密钥轮换；不得在日志中打印 Ticket、Session 或内容密钥。

## Player

```text
GET /api/v1/player/me
GET /api/v1/player/resources
```

## Ship

```text
GET  /api/v1/ships/current
PUT  /api/v1/ships/current/layout
POST /api/v1/ships/current/rooms/build
POST /api/v1/ships/current/rooms/upgrade
POST /api/v1/ships/current/rooms/remove
```

## Crew

```text
GET  /api/v1/crew
GET  /api/v1/crew/{id}
PUT  /api/v1/crew/{id}/assignment
PUT  /api/v1/crew/{id}/ai
POST /api/v1/crew/{id}/equip
```

## Battle

```text
POST /api/v1/battles/pve
POST /api/v1/battles/pvp/match
POST /api/v1/battles/pvp/start
GET  /api/v1/battles/{id}
GET  /api/v1/battles/{id}/replay
```

所有路径最终以实际接口设计文档为准。

---

---

# 32. 数据库核心表

建议逻辑实体：

```text
users
player_profiles
player_resources
resource_ledger

ship_definitions
player_ships
ship_layouts
player_rooms

crew_definitions
player_crew
crew_ai_rule_sets

equipment_definitions
player_equipment
inventory_items

research_definitions
player_research

mission_definitions
player_missions

battle_records
battle_participants
battle_replay_refs

mail
mail_rewards

config_versions
```

原则：Definition 配置可不全部存在 MySQL，可使用 JSON 配置 + 后台发布；PlayerInstance 数据必须持久化；货币必须有 ledger。

---

---

# 33. 事务与数据安全

以下必须事务处理：领奖、升级、制造、购买、邮件领取、战斗结算、市场交易、稀有道具消耗。

必须防止：重复领奖、重放请求、双击购买、并发升级、负库存、负货币。

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
