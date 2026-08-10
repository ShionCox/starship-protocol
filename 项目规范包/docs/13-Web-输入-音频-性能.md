# Web、输入、音频与性能

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 本文件维护目标设备、Web 发布、输入映射、音频与性能压力测试。调试和错误处理见 `14-调试-日志-错误处理.md`。

# 34. 性能需求

## 34.1 目标设备

首期重点：Windows + Chrome/Edge + 1920×1080。

同时测试：1280×720、2560×1440、3840×2160、Android Chrome、iOS Safari（R2 前必须验证）。

## 34.2 战斗压力目标

```text
2 艘飞船
总房间：60～100
总船员：40～60
同时 Projectile：50
临时 FX：100
逻辑：20 Tick/s
桌面：目标 60 FPS
移动中低端：目标 >= 30 FPS
```

## 34.3 性能约束

禁止：

- `update()` 内持续 `instantiate()`；
- 高频 `destroy()`；
- 每帧更新全部 Label；
- 每帧遍历所有配置表；
- 每帧创建大量临时数组；
- 每帧执行所有 AI；
- 使用 Cocos Node 作为核心状态。

必须：Object Pool、SpriteAtlas、VirtualList、Event-driven UI、Asset Bundle、资源释放、逻辑/渲染分离。

---

---

# 35. Web 需求

## 35.1 R0 必须完成 Web Desktop Build

验收：构建成功、浏览器打开、无阻断级 Console Error、刷新正常、资源路径正确、缩放正确。

## 35.2 Web 渲染

首版优先 WebGL2。

WebGPU 可作为后续实验能力，不作为 MVP 强依赖。

## 35.3 CDN

正式版：文件 Hash、长缓存、Bundle CDN、HTML 短缓存、配置版本可控、跨域正确。

---

---

# 36. 输入系统

统一 Action，不让业务代码直接绑定不同设备事件。

```ts
type InputAction =
  | 'CONFIRM'
  | 'CANCEL'
  | 'PAN_CAMERA'
  | 'ZOOM_CAMERA'
  | 'SELECT'
  | 'DRAG'
  | 'OPEN_BUILD'
  | 'PAUSE';
```

适配鼠标、键盘、触摸。

GameCore 只接收 Command，不接收鼠标坐标。

---

---

# 37. 音频系统

AudioManager 分组：Master、Music、SFX、UI、Ambient。

支持音量、静音、页面隐藏时策略、浏览器自动播放限制处理、对象池音效。

---

---

# 48. 性能测试

固定压力测试场景：

## PERF-01

```text
30 房间
20 船员
20 Projectile
```

## PERF-02

```text
60 房间
40 船员
50 Projectile
```

## PERF-03

```text
100 房间
60 船员
100 FX
```

记录 FPS、Tick ms、Node count、Draw calls、GC 和内存趋势。

---
