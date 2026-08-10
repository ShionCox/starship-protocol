# R2 发布安全 API

这是 FastAPI 的最小发布安全切片，不是完整账号、库存或战斗服务。

已实现：

- `GET /api/v1/client/manifests/latest`：返回签名清单原始字节；
- `POST /api/v1/client/launch-ticket`：只为当前受支持的 Build/Manifest 摘要签发短时凭证；
- `POST /api/v1/auth/guest`：开发阶段访客会话；
- `GET /api/v1/client/bootstrap`：同时验证 Launch Ticket 与玩家会话，返回加密配置描述和短时内容密钥。

生产密钥必须由 Secret/KMS 注入，清单和加密配置从只读发布卷加载。外部入口必须终止 TLS，并对 Ticket、Guest 和 Bootstrap 接口配置 Redis Rate Limit。客户端不能决定奖励、库存和战斗结果。

本地测试：

```powershell
npm run test:security-api
```

测试通过依赖注入临时密钥与发布文件，不读取生产环境变量。
