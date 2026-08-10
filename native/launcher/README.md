# Starship Protocol Windows 启动器

独立 Win32 启动器在游戏进程前建立发行信任链：

1. 验证启动器自身 Authenticode；
2. 通过 WinHTTP/HTTPS 请求最新签名文件清单；
3. 使用内嵌 RSA 公钥验证 RSA-PSS-SHA256 签名；
4. 每次完整校验核心文件，增量校验普通资源；
5. 请求短时 Launch Ticket 后启动 Cocos Windows 客户端；
6. 网络不可用时只接受本机已验签的缓存清单，并以 `--offline` 启动；安全配置离线缓存尚未完成时客户端会拒绝进入游戏；
7. 文件不一致、签名无效或服务端明确拒绝版本时禁止启动，不自动修复，提示重新安装。

实现只使用 Windows SDK、Cocos 3.8.8 随附 RapidJSON 和 C++ 标准库，没有额外运行库依赖。

启动游戏时会传递 `--build-id`、`--config-version`、`--install-id`、
`--launch-ticket-url` 和短时 `--launch-ticket`；Cocos 只能通过原生插件读取这些值。
内容密钥不会出现在命令行，由游戏使用 Ticket 与玩家会话向 Bootstrap 获取。

## 构建

先将发布 RSA 公钥转换为 DER/SPKI，再生成 Visual Studio 工程：

```powershell
npm run security:export-public-key -- --public-key D:\secure\manifest-public.pem --output release-security-output/manifest-public.der

& 'C:\ProgramData\cocos\editors\Creator\3.8.8\resources\tools\cmake\bin\cmake.exe' `
  -S native/launcher `
  -B build/launcher `
  -G 'Visual Studio 17 2022' -A x64 `
  -DSTARSHIP_MANIFEST_PUBLIC_KEY_DER=release-security-output/manifest-public.der `
  -DCOCOS_ENGINE_ROOT='C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine' `
  -DSTARSHIP_MANIFEST_URL='https://api.example.com/api/v1/client/manifests/latest' `
  -DSTARSHIP_GAME_EXECUTABLE='StarshipProtocol.exe' `
  -DSTARSHIP_REQUIRE_AUTHENTICODE=ON

& 'C:\ProgramData\cocos\editors\Creator\3.8.8\resources\tools\cmake\bin\cmake.exe' --build build/launcher --config Release
```

`STARSHIP_REQUIRE_AUTHENTICODE=OFF` 只用于临时编译测试；正式发行禁止关闭。

运行 `npm run test:launcher` 会生成临时 RSA 公钥并用本机 Cocos 3.8.8 + MSVC 编译启动器，产物随后删除。
