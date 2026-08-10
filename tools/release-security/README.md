# Windows 发布安全工具

本目录只使用 Node.js 标准库，负责正式 Windows 发行前的配置加密、文件清单签名和离线复验。它不进入 Cocos 运行时，也不保存生产密钥。

## 信任边界

- AES-256-GCM 保护规则包的静态内容；密钥必须由 Secret/KMS 注入，禁止提交仓库。
- RSA-PSS-SHA256 私钥只在发布环境使用；启动器只嵌入 DER/SPKI 公钥。
- 文件清单签名用于证明版本和文件 Hash 来自发布方。
- 客户端仍是不可信环境；奖励、库存和战斗结果最终由服务端校验。

## 命令

以下示例中的输出目录必须是一次性 staging 目录，工具默认拒绝覆盖已有输出。

```powershell
npm run security:build-windows-native
npm run security:audit-windows-native -- --root build/secure/windows/proj/Release

$env:STARSHIP_CONFIG_AES_KEY_BASE64 = '<Secret/KMS 注入的 32 字节密钥 Base64>'
npm run security:pack-config -- --input assets/config --output release-security-output/rules.spcfg --build-id windows-0.1.0 --config-version config-1 --key-id content-key-1

$env:STARSHIP_MANIFEST_PRIVATE_KEY_FILE = 'D:\secure\manifest-private.pem'
npm run security:create-manifest -- --root build/windows-release --output release-security-output/windows-0.1.0.spmanifest --build-id windows-0.1.0 --config-version config-1 --minimum-launcher-version 1.0.0 --launch-ticket-url https://api.example.com/api/v1/client/launch-ticket --reinstall-url https://download.example.com/starship-protocol-installer.exe

npm run security:verify-release -- --root build/windows-release --manifest release-security-output/windows-0.1.0.spmanifest --public-key D:\secure\manifest-public.pem
npm run security:export-public-key -- --public-key D:\secure\manifest-public.pem --output release-security-output/manifest-public.der
```

`security:build-windows-native` 使用 Cocos Creator 3.8.8 公开 Native 构建参数，自动生成一次性 XXTEA 构建密钥、启用脚本加密和 ZIP 压缩、清除生成目录中的编辑器源房间规则，再执行 CMake/MSVC Release 与静态审计。临时配置会删除，Creator 日志中的一次性密钥会脱敏；该密钥最终仍会进入客户端二进制，因此只属于混淆层，不能替代 AES-GCM 配置密钥或服务端权威。

如 Creator/CMake 不在默认安装位置，可通过 `STARSHIP_COCOS_CREATOR_EXE`、`STARSHIP_COCOS_CMAKE_EXE` 指定；`STARSHIP_WINDOWS_BUILD_ROOT` 可覆盖默认的 `build/secure` 隔离输出目录。

`create-manifest` 将 `.exe`、`.dll`、`.jsc`、`.spcfg` 标记为 `CORE`，启动器每次完整计算 SHA-256；其余资源标记为 `BULK`，在签名清单版本、大小和修改时间未变化时复用本地校验缓存。

## 发布门槛

正式包必须同时满足：

1. Cocos Windows Native Release 构建已启用脚本加密；
2. 客户端配置已从正式运行时的明文 JsonAsset 依赖中移除；
3. `rules.spcfg` 已加入发布目录并进入签名清单；
4. 启动器和游戏 EXE 已做 Authenticode 签名；
5. 签名清单由离线私钥/KMS 签名；
6. `verify-release` 通过，安装器也已签名。

当前 R0 Web 预览仍使用明文创作 JSON，不得作为正式发行包。
