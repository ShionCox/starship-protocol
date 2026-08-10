# AGENTS.md —— Starship Protocol 项目协作规则

> 适用范围：本仓库全部目录。任何开发人员或自动化编码代理开始工作前都必须先阅读本文件。

## 1. 规范入口与优先级

- 项目规范总览：`项目规范包/README.md`。
- 产品范围与版本路线：`项目规范包/docs/00-产品定位与版本路线.md`。
- 总体技术架构：`项目规范包/docs/01-总体技术架构.md`。
- 仓库与目录职责：`项目规范包/docs/02-仓库与目录规范.md`。
- 复用与依赖策略：`项目规范包/docs/03-复用优先与依赖策略.md`。
- Cocos 场景与 UI：`项目规范包/docs/04-Cocos客户端与UI架构.md`。
- Prefab、编辑器搭建与资源：`项目规范包/docs/05-资源与Prefab规范.md`。
- 编码与中文注释：`项目规范包/docs/15-编码与注释规范.md`。
- 测试与完成定义：`项目规范包/docs/16-测试-验收-DoD.md`。
- 任务顺序：`项目规范包/docs/17-里程碑与任务顺序.md`。
- Windows 正式发行与版本验证：`项目规范包/docs/ADR-0002-Windows正式发行与服务端版本验证.md`。

规则冲突时，按以下顺序处理：

1. 用户当前明确要求；
2. 本文件；
3. 对应主题的唯一主文档；
4. 既有代码惯例；
5. 一般开发习惯。

一个主题只在对应主文档维护。其他文档只引用，不复制整段规则。

## 2. 当前阶段

- 当前仓库是位于根目录的 Cocos Creator 3.8.8 工程，不要为了匹配未来 monorepo 蓝图提前搬迁目录。
- 当前目标是 R0 技术验证原型。
- R0 完成前，不开发登录、商城、任务、PvP、后端、舰队等外围系统。
- 第一条正式功能任务固定为：实现 20×10 飞船逻辑网格，支持 2×2 房间拖放、非法格与重叠判断、镜头缩放/拖动、JSON 保存与恢复，并成功构建 Web Desktop。
- R0 阶段允许把纯 TypeScript GameCore 放在 `assets/scripts/game-core/`；进入 R2 权威战斗服务前再评估抽取共享 package。
- Windows 正式发行安全属于 R2 前置能力；除非用户明确授权，不得借安全名义把 R2 登录、经济或战斗服务提前塞进 R0。

## 3. 固定技术栈

- 客户端：Cocos Creator 3.8.8 + TypeScript。
- 可见游戏画面和 UI：Cocos UI / Node / Prefab。
- 游戏规则：Pure TypeScript GameCore。
- 正式首发平台：Windows Native；Web Desktop 只用于 R0/R1 开发预览与自动回归。
- Windows 启动入口：C++20 + WinHTTP / WinTrust / BCrypt / Crypt32。
- R2 业务 API：FastAPI + MySQL 8 + Redis。
- R2 权威战斗：Node.js + TypeScript + 共享 GameCore。
- 运营后台：Vue 3 + TypeScript + Tailwind CSS。

未经明确架构决策，不替换上述技术栈。

## 4. 开工流程

每个任务按以下顺序执行：

1. 确认任务所属的 R0/R1/R2/R3 阶段，不提前实现后续阶段功能。
2. 阅读任务对应的 `项目规范包/docs/*.md` 唯一主文档。
3. 搜索工程中已有的 Component、Service、Adapter、工具、UI 组件、数据类型、配置和测试能力。
4. 确认 Cocos 内置能力或 JavaScript/TypeScript 标准能力是否已经满足需求。
5. 只有现有实现不能覆盖时，才增加最小范围的新代码、目录、抽象或依赖。
6. 实现后按对应里程碑和 DoD 验证，并报告实际执行结果。

不得把“未来可能需要”当作当前新增框架、接口或依赖的理由。

## 5. 架构边界

- GameCore 禁止引用 `cc`、DOM、浏览器专有 API、Node.js 内置 API。
- GameCore 只处理可序列化的数值、稳定字符串 ID、状态、Command、Event、Snapshot、Tick 和 Seed RNG。
- Cocos Node / Component 是表现与输入适配，不是权威游戏状态。
- 存档禁止序列化 Node、Sprite、Prefab 实例或世界像素坐标。
- 业务状态只能通过 Command 修改，View 不直接篡改 GameCore。
- 依赖方向固定为：Cocos View/UI → Application/Adapter → GameCore → Schema/共享工具。
- 禁止 GameCore 反向依赖 Cocos、UI、网络或服务端实现。
- 正式 Windows 客户端必须由独立签名启动器验证；Cocos 进程不能自行绕过发布清单或 Launch Ticket。
- 客户端加密、脚本混淆和文件 Hash 只建立发布完整性并提高修改成本；账号、库存、奖励、布局和战斗结果始终由服务端权威校验。
- 正式规则使用 AES-256-GCM 包，发布清单使用 RSA-PSS-SHA256；私钥和生产对称密钥禁止提交仓库或编译进 TypeScript。

## 6. 确定性规则

- 战斗逻辑使用固定 Tick；渲染帧率不得影响游戏结果。
- 同一规则版本、初始状态、Seed 和 Command 序列必须得到同一最终状态。
- 确定性逻辑禁止直接使用 `Math.random()`，统一使用 `SeededRandom` 或注入的 `RandomSource`。
- 核心逻辑不得把系统时间作为战斗依据。
- 战斗 Tick 顺序发布后不得随意修改；兼容性变化必须升级 `battleRuleVersion`。
- Replay、存档和配置变化必须考虑 `battleRuleVersion`、`configVersion`、`schemaVersion` 兼容。

## 7. 复用与依赖

新增通用能力前按以下顺序判断：

1. 复用或扩展项目内已有实现；
2. 使用 Cocos 内置能力；
3. 使用 JavaScript/TypeScript 标准能力；
4. 原生平台任务使用 WinHTTP、WinTrust、BCrypt 等系统能力；
5. 评估成熟、轻量且兼容 Cocos/Web/Native 的第三方库；
6. 最后才做项目实际需要的最小自研实现。

默认复用 Cocos 的 Node/Component 生命周期、Sprite、Label、Button、Widget、Layout、ScrollView、Mask、Tween、Animation、Prefab、Asset Bundle、Audio、输入事件和场景切换。

项目特有且可自研的能力包括：飞船网格、放置验证、船舱导航图、条件 AI、确定性战斗、Command/Event/Snapshot、Replay、状态 Hash、配置迁移和服务端权威校验。

全项目原则上只保留一个正式入口：Logger、AssetService、AudioService、InputMapper、HttpClient、WebSocketClient、PopupService、ToastService、TickScheduler、SeededRandom、ConfigRegistry、ReplayCodec、VirtualList 和 VirtualGrid。业务模块可以增加 Adapter，不得复制第二套核心实现。

新增第三方依赖必须说明：解决的问题、现有能力为何不足、ESM/Cocos/Web 兼容性、包体和维护状态。不得为少量项目特有逻辑引入重型依赖。

## 8. Cocos 与资源规则

- Component 只负责表现、输入、绑定和生命周期适配。
- 不在 `update()` 中执行完整游戏或战斗规则。
- `onEnable` 注册的事件必须在 `onDisable` 对应注销。
- 全局服务通过明确的 AppContext/DI 管理，避免无约束 Service Locator。
- 重复内容使用 Prefab + 配置数据 + `instantiate`。
- 高频对象优先对象池，避免持续 `instantiate()` / `destroy()`。
- 大型动态列表使用统一 VirtualList/VirtualGrid。
- 不盲目手工编辑大型 `.scene`、`.prefab` 或 `.meta` 序列化文件；确需修改时必须做针对性验证。
- 设计人员需要调整的场景、Prefab 和视觉参数必须在 Cocos 编辑器中可见、可选、可修改；数据驱动内容应提供 Prefab 或 `executeInEditMode` 编辑器预览，不能只在运行时临时生成。
- 场景初始布局必须通过 Scene/Prefab 实例搭建；Bootstrap 优先复用编辑器实例，不得用运行时 `addComponent()` 隐藏本应由设计人员配置的组件。
- 每个场景级规则只能有一个配置入口；网格列数、行数、格子尺寸、吸附开关和网格外观统一放在 AppRoot 的 SceneSettings，GridRoot 与房间组件不得再保存副本。
- 所有设计人员可调的 Inspector 属性必须使用中文 `displayName`、中文 `tooltip` 和必要的中文分组；TypeScript 标识符、Prefab/Scene 文件名和稳定业务 ID 仍使用英文规范。Prototype 标准场景骨架新创建的 Node 使用中文语义名（如“画布”“世界根”“房间容器”）；运行时和插件必须同时兼容旧英文 Node 名，已有英文场景不自动改名。
- 网格化内容在编辑器中拖动时应自动吸附到项目逻辑网格；吸附只改变表现坐标，保存和规则校验仍使用 GameCore 整数逻辑坐标。
- 批量内容创建、校验和未来关卡导出统一放在 `extensions/starship-editor-tools/` 项目扩展中；按房间、NPC、关卡分模块，不为每个领域复制插件宿主。
- 编辑器扩展不是运行时依赖；插件关闭或加载失败时，游戏运行、存档、测试和构建必须不受影响。
- 编辑器扩展只调用 Cocos 3.8 公开 Panel、Message、Asset DB 和 Scene API；禁止直接编辑 `.scene`、`.prefab`、`.meta` 序列化文本。资源管理器右键只创建 JSON + Prefab，场景骨架、房间实例和校验统一由可停靠“星舰创作工具”面板完成；层级选择只是面板读取的上下文，不是扩展入口。禁止私有 hierarchy API、`cce.*` 和 DOM 注入。
- 房间 Prefab 保存表现，`assets/config/rooms/*.json` 保存版本化规则；新增房间通过 JSON 接入，不新增第二份 TypeScript 配置常量。
- 房间资源由 JSON + Prefab 真实依赖自动发现；创作面板负责标准场景骨架和房间实例创建，不要求设计人员先创建空节点再手动挂组件。面板显示期间每 500ms 轮询公开 Selection，隐藏或关闭时停止，执行动作前必须重新校验选择。NPC、关卡等领域只有进入对应里程碑后才能注册菜单。
- 创作面板采用领域分页、分类筛选、资源列表和中文属性检查器；已接入领域的规则字段必须支持直接编辑并通过公开 Asset DB 保存。稳定 ID、Prefab 引用和资源路径只读，保存前重新读取并校验 JSON，避免面板缓存覆盖外部修改。
- 创作工具可识别类型的稳定 ID、识别器顺序、白名单 DTO、只读/可写边界和接入检查表统一遵循 `项目规范包/docs/19-Cocos创作工具类型接入规范.md`；选择联动只在 UUID 变化时自动切页，禁止把原始组件 dump 或未注册类型自动暴露给面板。
- `assets/config/**/*.json` 是创作与发布输入；R2 正式 Windows 运行时不得直接依赖源 JsonAsset，必须通过唯一 ConfigRegistry 消费已验证解密配置。
- Boot 首包保持最小；战斗资源按需预加载并及时释放。
- 业务输入统一映射为 Action；GameCore 只接收 Command，不接收鼠标或触摸坐标。
- 单个 Component 达到约 500～800 行时必须评估按职责拆分。

## 9. TypeScript、命名与注释

- 使用标准 ESM；类型重导出优先 `export type`。
- 避免 CommonJS/ESM 混用，不使用 Cocos Creator 3.8 不支持的 TypeScript 特性。
- 不使用 `const enum`。
- 稳定业务 ID 使用字符串，不把数组索引作为永久 ID。
- 配置数据与运行时状态分离。
- 新类型放在所属业务域，禁止建立无边界的 `types.ts`、`utils.ts` 大杂烩。
- TypeScript 类和 Cocos Component 文件使用 `PascalCase.ts`，类名与文件名一致。
- 纯函数使用 `camelCase.ts` 或明确职责名称。
- Prefab/Scene 使用 `PascalCase`；配置文件使用 `kebab-case.json`。
- 禁止 `common2.ts`、`utils_new.ts`、`temp-final.ts` 等含糊名称。

以下内容必须写中文注释：对外核心类/接口/枚举、非直观算法、复杂状态机、业务不变量、确定性约束、缓存失效、AI 优先级、数据兼容和临时兼容方案。

中文注释解释“为什么”和“不变量”，不要逐行翻译代码。TODO 必须注明阶段、原因和完成条件，例如 `TODO(R2): ...`。

## 10. 目录与抽象约束

新增目录前必须能回答：

1. 现有目录为什么不能容纳？
2. 新目录的唯一职责是什么？
3. 谁可以依赖它、它可以依赖谁？

无法回答时不创建目录。

`Controller` 只负责明确 UI/应用用例；`Service` 提供跨页面或跨组件的稳定能力；`Manager` 仅用于真正管理生命周期或资源集合；避免无业务语义的 `Utils` / `Helper`。

不要为单一实现创建接口、工厂或可配置框架。优先最少文件、最小正确改动，但不得省略输入校验、错误处理、安全边界和必要测试。

## 11. 测试与验收

- GameCore 规则必须有可运行单元测试，至少覆盖正常、边界和错误分支；随着对应模块实现，覆盖网格、放置、能源、伤害、护盾、武器、AI、路径、状态效果、胜负、RNG 和 Replay。
- 影响战斗、随机或 Replay 的改动必须做确定性测试。
- 同一 InitialState、Seed 和 Commands 重复运行 100 次时，FinalHash 必须一致。
- AI、路径或战斗模拟成形后增加 Fuzz Test，检查 NaN、死循环、不可达路径、负数状态、越界状态和战斗无法结束。
- Cocos 改动至少验证工程可打开、相关场景可运行、TypeScript 无阻断错误。
- 涉及场景、Prefab 或可调视觉参数时，还必须验证无需运行预览即可在编辑器看到结果、中文 Inspector 属性可修改、拖动吸附可用且运行时不重复生成编辑器实例。
- R0 交付必须完成 Web Desktop Build，并在浏览器验证运行、刷新、资源路径、缩放和 Console。
- R2 正式发行改动必须验证启动器 MSVC 编译、签名清单篡改拒绝、AES-GCM 认证失败、路径越界、服务端版本拒绝和离线冷启动；生产 Authenticode、TLS、KMS 与签名安装器没有实际证据时不得宣称完成。
- 不能用“构建命令启动了”或“HTTP 200”替代实际运行验证。
- 无法执行的验证必须明确标记“未验证”并说明原因，不得写成已通过。

核心功能完成定义以 `项目规范包/docs/16-测试-验收-DoD.md` 为准。

## 12. 文档与交付

- R0 进度以根目录 `R0-CHECKLIST.md` 为唯一完成清单；每完成一个步骤，必须在同一批修改中补齐实现、验证和人工/视觉证据后才能勾选。
- R2 Windows 发行安全进度以根目录 `R2-SECURITY-CHECKLIST.md` 为完成清单，不能挤占或提前勾选 R0 项目。
- 持久证据放在 `docs/evidence/`；不得只引用临时目录、口头结论或可能失效的外部路径。
- 修改业务规则时同步更新对应唯一主文档。
- README 只做总览和导航，不堆叠模块细节。
- 架构决策变化使用 `项目规范包/templates/ADR模板.md` 创建 ADR，避免多处散改。
- 不覆盖或回退与当前任务无关的用户改动。
- 交付时简要列出：完成内容、修改文件、已执行验证、未验证项或剩余风险。
