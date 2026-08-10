# Cocos Windows 配置解密插件

该目录是 Cocos Creator 3.8.8 Native Plugin。Creator 在 Windows Native 构建时根据
`cc_plugin.json` 和 `windows/starship_security-config.cmake` 自动接入
`starship_security`，不需要修改生成目录中的 Visual Studio 或 CMake 文件。

插件只向脚本层暴露三个安全边界方法：

- `getLaunchContext()`：读取启动器传入的 Build/Config、安装 ID、短时 Ticket 与已签名 Ticket URL；
- `sha256Utf8(...)`：使用 Windows CNG 计算下载配置的 SHA-256；
- `decryptAesGcm(...)`：在原生内存中执行认证解密。

其中密码能力遵守以下规则：

- 使用 Windows CNG `BCrypt` 执行 AES-256-GCM；
- 密钥、12 字节 IV、16 字节认证标签和 AAD 均由调用方传入；
- 标签认证失败直接抛错，不返回部分明文；
- 插件不保存密钥，也不负责网络、版本选择或 GameCore 规则；
- `--offline` 或缺失启动参数时不生成启动上下文，TypeScript 启动流程必须停止，不能回退源 JSON。

正式密钥只能由通过启动器版本校验后取得的短时 Bootstrap 提供，并且只保存在进程内存。
该插件提高静态提取成本，但客户端仍不是服务端奖励、库存和战斗结果的权威来源。

## 验收

1. 使用 Creator 3.8.8 构建 Windows Native Release。
2. 在生成日志中确认 `starship_security` 被 CMake 收集并成功链接。
3. 用正确密钥解密测试包成功；修改密文或认证标签后启动必须失败。
4. 检查正式 staging 不包含源 JSON、密钥、source map 或私钥文件。

不要把测试密钥、生产密钥、解密后的 JSON 或生成的 Native 工程提交到仓库。

实现遵循 Cocos Creator 3.8 的公开 Native Plugin 机制：
[Native Plugin 简介](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/native-plugins/brief.html)、
[Native Plugin 教程](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/native-plugins/tutorial.html)。
