# AGENTS.md —— GPT-5.6 / Codex / 开发人员项目规则

> 本文件优先级高于普通实现习惯。任何自动化编码代理开始工作前必须先阅读。

## 1. 固定技术栈

- 客户端：Cocos Creator 3.8.8。
- 客户端代码：TypeScript。
- 可见游戏 UI：Cocos UI / Node / Prefab。
- 游戏规则：Pure TypeScript GameCore。
- 业务 API：FastAPI。
- 数据库：MySQL 8。
- 缓存：Redis。
- 权威战斗：Node.js + TypeScript + 共享 GameCore。
- 运营后台：Vue 3 + TypeScript + Tailwind CSS。
- 首发：Web Desktop。

## 2. 开工前必须做的事

1. 阅读 `README.md`。
2. 找到任务对应的 `docs/*.md` 唯一主文档。
3. 搜索现有工程是否已有同类：
   - Component；
   - Service；
   - Manager；
   - Adapter；
   - Util；
   - UI组件；
   - 数据类型；
   - 配置项；
   - 测试工具。
4. 确认能否直接使用 Cocos 内置能力。
5. 确认是否真的需要新依赖或新抽象。
6. 再开始编码。

## 3. 禁止重复造轮子

### 优先复用 Cocos

以下能力默认使用 Cocos 已有能力或对其做薄封装，不自行从零重写：

- 节点与组件生命周期；
- Sprite / Label / UITransform；
- Button；
- Widget / Layout；
- ScrollView / Mask；
- Tween / Animation；
- Prefab / instantiate；
- SpriteAtlas；
- Asset Bundle / 资源加载；
- Audio；
- 输入事件；
- 场景切换。

### 可以自研的典型项目特有能力

- ShipGridModel；
- PlacementValidator；
- 船舱导航图；
- 条件 AI 解释器；
- 确定性战斗；
- Command / Event / Snapshot；
- Replay；
- 状态 Hash；
- 配置版本兼容；
- 服务端权威校验。

### 新建通用工具前

必须先全仓搜索类似名称和职责。若已有功能达到 70% 以上，优先扩展已有实现，而不是新增第二套。

禁止出现以下并行重复实现：

- `HttpService` / `ApiService` / `NetworkService` 各做一套 HTTP；
- `PopupManager` / `DialogManager` 各做一套弹窗；
- `EventBus` / `MessageBus` / `SignalCenter` 多套全局事件；
- 每个页面各自实现 VirtualList；
- 多套日期、随机数、ID、日志、对象池实现。

## 4. 架构边界

- GameCore **不得** `import ... from 'cc'`。
- GameCore 不得依赖 DOM。
- GameCore 不得依赖 Node.js 内置 API。
- Cocos Node 是 View State，不是权威状态。
- 存档中禁止序列化 Node、Sprite、Prefab 实例。
- 业务状态只能通过 Command 修改；View 不直接篡改 GameCore。
- 战斗必须固定 Tick。
- 确定性逻辑禁止 `Math.random()`。
- 所有确定性随机统一走 `SeededRandom`。
- Replay 兼容性变化必须升级 `battleRuleVersion`。

## 5. 中文注释规范

### 必须有中文注释

- 对外暴露的核心类、接口、枚举；
- 非直观算法；
- 复杂状态机；
- 确定性要求；
- 缓存失效规则；
- AI优先级；
- 数据兼容逻辑；
- 为什么不能使用某种更简单写法的地方；
- 临时兼容方案和 TODO 的原因。

示例：

```ts
/**
 * 船体逻辑网格。
 *
 * 注意：
 * 1. 这里只保存整数网格坐标，不保存 Cocos 世界坐标；
 * 2. 它属于 GameCore，可被客户端与战斗服务共同使用；
 * 3. 修改占用关系后必须递增 layoutRevision，用于导航缓存失效。
 */
export class ShipGridModel {
  // ...
}
```

### 不要写无意义注释

错误：

```ts
// hp 减 1
hp -= 1;
```

推荐：

```ts
// 先扣护盾再扣船体生命；该顺序属于战斗规则，不允许由表现层改变。
applyDamage(damage);
```

## 6. TypeScript规则

- 标准 ESM。
- 类型重导出优先 `export type`。
- 不使用 `const enum`。
- 不把 Node.js 专用包引入客户端共享代码。
- 新类型优先定义在其业务域目录，不建立无边界的 `types.ts` 大杂烩。
- 稳定业务 ID 使用字符串，不使用数组索引作为永久 ID。
- 配置数据与运行时状态分离。

## 7. Cocos规则

- Component 只负责表现、输入、绑定和生命周期适配。
- 不在 `update()` 内执行完整战斗规则。
- `onEnable` 注册事件，`onDisable` 对应注销。
- 重复内容使用 Prefab + 配置数据 + instantiate。
- 大型动态列表使用统一 VirtualList。
- 不盲目直接编辑大型 `.scene` / `.prefab` 序列化内容。
- 设计人员需要调整的 Scene、Prefab、节点层级和视觉参数必须能在 Cocos 编辑器中直接看到、选择和修改，不能只靠运行时脚本临时生成。
- 场景级网格参数和吸附规则必须集中在 AppRoot 的唯一 SceneSettings；GridRoot 只作为绘制目标，View/Prefab 不重复保存同一配置。
- 设计人员可调的 Inspector 属性使用中文名称、中文提示和中文分组；代码标识符、Prefab/Scene 文件名和稳定业务 ID 仍按英文命名规范执行。Prototype 标准场景骨架新创建的 Node 使用中文语义名；运行时和插件兼容旧英文 Node 名，已有英文场景不自动改名。
- 网格化 Scene/Prefab 内容应在编辑器拖动时自动吸附到逻辑网格，吸附不得绕过 GameCore 的放置校验。
- 资源管理器右键只创建定义 JSON + 表现 Prefab；场景骨架、房间实例和创作校验统一由可停靠“星舰创作工具”面板完成。
- 面板只使用公开 `Editor.Panel`、`Editor.Selection`、`Editor.Message`、Asset DB 和 Scene 消息；层级管理器选择只是上下文，禁止私有 hierarchy API、`cce.*` 和 DOM 注入。面板显示期间可轮询 Selection，隐藏/关闭时必须清理定时器。
- 一次面板场景操作必须通过公开 Scene 快照形成一次 Undo/Redo；失败时回滚并调用公开快照终止消息。
- 一个 Component 超过约 500～800 行时必须评估拆分。
- 高频对象避免反复创建销毁，优先对象池。

## 8. 修改文档规则

- 一个主题只能维护在一个唯一主文档。
- 其他文档只能链接引用，不复制整段规范。
- 修改业务规则时同步更新对应 `docs/*.md`。
- 不在 README 重复写模块细节。
- 架构决策变化应新增 ADR，而不是在多个文档同时散改。

## 9. 测试要求

核心玩法改动至少满足：

- 单元测试；
- 确定性测试（如影响战斗）；
- 错误分支测试；
- 不破坏已有 Replay（如要求兼容）；
- Web Desktop 可运行。

完成定义见：`docs/16-测试-验收-DoD.md`。

编辑器搭建、Prefab 和 Inspector 细则见：`docs/05-资源与Prefab规范.md` 与 `docs/15-编码与注释规范.md`。
