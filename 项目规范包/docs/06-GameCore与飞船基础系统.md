# GameCore与飞船基础系统

> **文档规则**：本文件是该主题的唯一主文档；其他文档如需使用本主题规则，应通过链接引用，不复制整段内容。  
> **中文注释**：涉及关键数据结构、算法、不变量、兼容逻辑的代码必须使用中文注释解释原因。  


> 本文件覆盖逻辑坐标、船体、房间、能源和飞船基础规则。船员移动见 `07-船员与寻路系统.md`。

# 9. 逻辑坐标与飞船网格

## 9.1 逻辑坐标

核心逻辑只保存：

```ts
interface GridPos {
  x: number;
  y: number;
}

interface GridSize {
  width: number;
  height: number;
}
```

不要保存 Cocos 世界像素坐标。

转换由 View 层负责：

```text
Grid Position
↓
ShipView / 船体局部坐标适配
↓
Local Position
↓
Cocos Node
```

网格列数、行数和 `VOID / BUILDABLE / FIXED_WALL` 格类型只来自 `HullDefinition`；ShipView 只配置格子像素尺寸、颜色与子节点引用。世界/局部坐标不是权威状态。

## 9.2 船体定义

```ts
interface HullDefinition {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly cellTypes: readonly ('VOID' | 'BUILDABLE' | 'FIXED_WALL')[];
  readonly baseConstructionSlots: number;
  readonly maxCrew: number;
  readonly maxRooms: number;
  readonly visualId: string;
}
```

必须支持非矩形船体；`cellTypes.length` 必须等于宽×高。固定墙不能建造、移动或拆除；虚空格不能占用。`ShipGridModel` 和 `VoxelLayoutModel` 构造时必须传入已验证 HullDefinition，不保留第二份网格规则。

## 9.3 船实例快照

```ts
interface RoomInstanceSnapshot {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly hp: number;
}

interface ShipSnapshot {
  readonly schemaVersion: 5;
  readonly shipId: string;
  readonly hullId: string;
  readonly revision: number;
  readonly rooms: readonly RoomInstanceSnapshot[];
  readonly floors: readonly FloorInstanceSnapshot[];
  readonly constructionJobs: readonly ConstructionJobSnapshot[];
  readonly energy: EnergySnapshot;
  readonly crews: CrewSnapshot;
}
```

定义 ID 与实例 ID 必须分开。房间、船员实例短 ID 只在所属 `shipId` 内唯一；跨模型引用和 Command 必须同时携带 shipId。

ShipModel 是唯一修改入口；不得向应用层暴露可变的网格、能源、导航或船员子模型，查询统一使用只读快照。

## 9.4 占用表

内部优先使用 BitSet、Uint8Array 或二维扁平数组，不要每次检测都遍历所有房间 Node。

---

---

# 10. 飞船系统需求

## FR-SHIP-001 飞船船体

支持不同船体 ID、不同可用网格、不同船员上限、不同初始能力、不同升级等级、不同外观资源。

优先级：P0。

## FR-SHIP-002 飞船镜头

支持：

- 鼠标拖动；
- 触摸拖动；
- 滚轮缩放；
- 双指缩放（移动端阶段）；
- 最小缩放限制；
- 最大缩放限制；
- 自动聚焦；
- 返回默认视角。

优先级：P0。

## FR-SHIP-003 多布局方案

后续支持布局 A/B/C，保存房间、船员、AI 并可快速切换。

优先级：P1。

---

---

# 11. 房间系统需求

## 11.1 房间定义

```ts
interface RoomDefinition {
  id: string;
  displayName: string;
  category: RoomCategory;
  width: number;
  height: number;
  maxLevel: number;
  maxHp: number;
  minPower: number;
  maxPower: number;
  powerGeneration: number;
  crewCapacity: number;
  healingHpPerTick: number;
  verticalConnectorKind: 'NONE' | 'ELEVATOR' | 'STAIRS';
  visualId: string;
  metalCost: number;
  buildDurationMs: number;
  demolishDurationMs: number;
  refundPermille: number;
}
```

P8 `RoomDefinition` 使用 schema 3，权威行来自 `rooms.csv`。非移动房间的 `verticalConnectorKind` 必须为 `NONE`；楼梯和电梯的停靠层、左右入口和纵向耗时由 `connector-ports.csv` 单独声明。

## 11.2 房间分类

| 房间 | 类型 | 优先级 |
|---|---|---|
| 反应堆 | 能源 | P0 |
| 激光室 | 武器 | P0 |
| 导弹室 | 武器 | P0 |
| 护盾室 | 防御 | P0 |
| 引擎室 | 机动 | P0 |
| 医疗室 | 支援 | P0 |
| 电梯 | 移动 | P0 |
| 传送室 | 战术 | P1 |
| 维修增强房 | 支援 | P1 |
| 机库 | 无人机 | P1 |
| 仓库 | 经营 | P1 |
| 指挥/桥接房 | 特殊 | P1 |

## FR-ROOM-001 放置

必须检测：整数网格、越界、有效船体格、与已有房间重叠、解锁条件、船体等级。

Cocos 编辑器中的初始房间必须可直接拖动并吸附到最近逻辑格；编辑器位置只用于生成初始整数网格坐标，最终合法性仍由同一放置校验处理。

优先级：P0。

## FR-ROOM-002 拆除

需要处理：战斗中不可拆、拆除确认、资源返还规则、布局重新计算、导航图重建。

优先级：P0。

## FR-ROOM-003 升级

支持等级、HP、能力值、能源、冷却、建造时间和升级成本。

R1 可先本地即时升级，R2 服务端权威。

---

---

# 12. 能源系统需求

## 12.1 核心规则

```text
可用能源 = 所有有效能源房间产出 - 状态惩罚
```

R1 纵切使用 `powerGeneration` 表示能源房间实例的基础产能；未提供该字段的旧房间定义按 0 处理。`minPower` / `maxPower` 仍表示该房间可接受的当前分配范围，动态分配不写入 R0 的布局快照。

每个耗能房间具有：当前分配能源、最低运行能源、最大能源、不同能源档位效果。

## FR-POWER-001 手动分配

玩家可以增减指定房间能源。P0。

## FR-POWER-002 能源不足

当总分配大于可用能源时，Command 必须失败，UI 提示原因，不允许进入非法状态。P0。

R1 当前通过纯 TypeScript `EnergyModel` 执行 `SET_ROOM_POWER` / `RESET_ROOM_POWER`，失败保持旧状态；状态快照只保存稳定房间 ID 与当前分配，产能由有效房间定义重新计算。

R1 运行时把所属飞船中的 `roomInstanceId → RoomDefinition` 组成只读映射，再由 `createEnergyRooms` 生成 EnergyRoom；映射不读取 Node、Prefab 或像素坐标，任一实例 ID、定义或非能源产能非法时整艘飞船恢复失败。能源快照现在属于 ShipSnapshot，不再独立读写旧 Prototype Key。

玩家界面只消费带 shipId 的 `PowerPanelState`，按钮动作通过 `PlayerStatePort` 转换为船舰作用域 Command；完整玩家 Envelope 保存失败时恢复 Command 前聚合状态。当前纵切只提供基础产能和手动分配，不实现状态惩罚、Tick、武器开火、护盾效果或 AI 调电。

## FR-POWER-003 房间断电

断电后按房间类型停用或降低效率。P0。

## FR-POWER-004 AI 调电

AI 可根据战况自动修改能源。P1。

---

---

# 13. 船员系统需求

## 13.1 船员属性

建议基础属性：

```text
HP
Attack
Repair
Weapon
Science
Pilot
Medical
Speed
FireResistance
Ability
```

不要在第一版设计过多属性。

## 13.2 船员运行状态

R1 P8 启用 `IDLE`、`MOVING`、`REPAIRING`、`HEALING`、`TREATING`、`PATROLLING` 和 `CONSTRUCTING`；其余状态仍是后续岗位和战斗里程碑的扩展目标，不得提前写入运行时快照。

```ts
type CrewState =
  | 'IDLE'
  | 'MOVING'
  | 'OPERATING'
  | 'REPAIRING'
  | 'HEALING'
  | 'TREATING'
  | 'PATROLLING'
  | 'CONSTRUCTING'
  | 'FIGHTING'
  | 'EXTINGUISHING'
  | 'CASTING'
  | 'DEAD';
```

## FR-CREW-001 分配

玩家可以将船员分配到合法房间。P0。

## FR-CREW-002 房间岗位

房间拥有站位数量，超过容量时按统一规则排队或拒绝 Command。P0。

R1 当前选择“拒绝 Command”：`CrewModel` 在移动前预留目标房间最低编号空闲站位，移动中的船员继续占用目标预留站位；目标已满、船员忙碌、房间未知或路径不存在时整条 `MOVE_CREW` 失败且旧状态不变。路径经过的中间房间不占用岗位。

## 13.3 R1 船员移动、巡逻与施工纵切

- `CrewDefinition` 使用 `schemaVersion = 4`，职业为 `ENGINEER` / `GUNNER` / `MEDIC` / `SOLDIER`；定义还保存稀有度、外观 ID 和白名单词条 ID。稀有度本身不隐式产生数值，所有施工效果只来自 `crew-traits.csv`。
- `CrewModel` 消费 `NavigationGraph`、初始站位和显式 Command；`advanceOneTick()` 是唯一船员任务时钟入口，快照按稳定船员实例 ID 排序，并保存移动路径、边内进度、维修/医疗配对、巡逻路线与游标、阻断图版本或施工项目 ID。
- CrewSnapshot 属于所属 ShipSnapshot，完整玩家 Envelope 在 Command 或固定 Tick 成功后原子保存。未知船员、未知房间、重复实例、容量冲突、断开路径或版本错误会让整艘飞船恢复失败。
- 写盘失败恢复前一份完整玩家状态；跨边失败同时暂停时钟并显示中文错误。
- Cocos `CrewView` 只负责中文 Inspector、选择、高亮和只读插值；`CrewStatusPanel` 通过 shipId 绑定所选飞船。MainScene Bootstrap 以 10Hz 调用核心 Tick，不在渲染 `update()` 中执行船员规则，也不搜索其他 ShipView。
- P8 当前边界包含四名可见船员、体素地板跨层移动、手动维修/医疗、士兵后台巡逻和工程师施工分配；不实现岗位战斗加成、实际伤害来源、死亡、敌人响应、自动维修/送医、通用 AI 或 Replay。

## 13.4 R1 工程师维修纵切

- `START_REPAIR` 要求工程师已经空闲地位于受损目标房间；`STOP_REPAIR` 只接受正在维修的船员。失败不改变旧状态。
- 维修不隐式移动、不消耗能源。多名工程师按稳定实例 ID 顺序叠加，每次固定 Tick 增加定义中的维修量并封顶到房间最大耐久。
- 房间修满后，同一 Tick 内该房间的所有维修船员自动回到 `IDLE`。任意船员移动或维修期间禁止调整房间布局。
- `CrewSnapshot` 与 `ShipSnapshot` 均升级为 schema 2；开发存档通过 `configVersion = r1-repair-1` 重置旧状态，不迁移旧开发数据。

## 13.5 R1 医疗纵切

- `RoomDefinition` 使用 `schemaVersion = 2`，新增非负整数 `healingHpPerTick`。只有 `SUPPORT` 房间可以大于 0；医疗室为 1 点/Tick、容量 2、最低/最大能源均为 2。
- `START_HEAL` 显式携带病员、医务员和医疗室实例 ID。病员必须受伤且空闲，医务员必须是同房间的空闲 `MEDIC`，医疗室必须具备医疗能力并达到最低供电。
- 病员进入 `HEALING`、医务员进入 `TREATING`，双方快照通过 `taskPartnerCrewId` 双向配对。单边、循环、同一实例、跨房间、错误职业或无效医疗室快照会让整艘飞船恢复失败。
- 每个固定 Tick 先推进移动，再按稳定医务员实例 ID 结算医疗，最后按稳定工程师实例 ID 结算维修。生命封顶后双方同 Tick 回到 `IDLE`。
- 医疗室断电立即终止其中全部治疗配对。治疗期间不隐式移动、不消耗医疗物资；任意船员非 `IDLE` 时禁止调整房间布局。
- `CrewSnapshot` 与 `ShipSnapshot` 均升级为 schema 4；P7 细网格调整后开发存档通过 `configVersion = r1-visual-2` 重置旧状态，不迁移旧开发数据。

## 13.6 P8 体素地板与建造

- `HullDefinition` schema 2 使用三态船体格；外圈固定墙不可建拆，地板是一格一个 `FloorInstanceSnapshot`，只有已完成地板才进入水平导航。
- 普通房间底边每格都必须由已完成地板支撑。房间与上下相邻地板不产生捷径；跨层只能经过 `connector-ports.csv` 声明的楼梯或电梯停靠口。
- `ShipSnapshot`、`CrewSnapshot` 升级为 schema 5，`PlayerStateSnapshot` 升级为 schema 2；玩家 Envelope 保存金属，单舰快照保存地板与施工队列。开发配置为 `r1-voxel-construction-1`，旧开发状态整份重建，不迁移。
- 建造 Command 为 `START_BUILD_FLOOR`、`START_BUILD_ROOM`、`ASSIGN_BUILDERS`、`CANCEL_CONSTRUCTION` 和 `START_DEMOLITION`。开工时扣金属并预留目标；失败返回完整旧快照。
- 船体基础施工槽与工程师 `CONSTRUCTION_SLOT_BONUS` 相加并封顶 8；同一项目最多三名工程师。到场工程师的 `CONSTRUCTION_SPEED_PERMILLE` 相加，连同基础速度封顶 3.0 倍。
- GameCore 不读取系统时间。应用层显式传入 `nowUnixMs`，施工按秒结算并最多保存一次 Envelope；时钟回拨按零进度。离线只推进施工，未到场工程师不提供离线加速，船员移动/维修/医疗/巡逻不离线推进。
- 取消零进度项目返还全部已付金属；已有进度按定义 `refundPermille` 返还。固定墙、承重地板、有人/供电/任务中的房间和活动施工目标必须拒绝拆除并返回中文原因。

## 13.7 P8.1 逐格位置与玩家任务订单

- `CrewSnapshot` 与 `ShipSnapshot` 升级为 schema 6；`PlayerStateSnapshot` 保持 schema 2。本地配置版本为 `r1-voxel-interaction-1`，旧体素施工开发状态整体重建，不迁移。
- 船员权威位置使用 `currentNodeId`。`FLOOR` 可以成为最终位置，`ROOM_STATION` 同时推导房间与站位；`CONNECTOR_STOP` 只能经过，不能成为玩家移动终点。像素坐标与 Tween 进度不进入快照。
- 普通地板终点只允许一名船员占用或预留。移动中取消订单时回到最后一个完整到达的节点，清零边内进度，不保存半格位置。
- 玩家订单为显式移动、前往维修、前往医疗、前往施工、取消当前订单和巡逻启停。订单进入快照；维修、医疗和施工只在参与者到达现场后开始。
- 玩家订单优先于巡逻与施工返工。被抢占的士兵或工程师在玩家任务结束后等待 10 Tick，再恢复巡逻或返回已分配工地；已经开始的维修、医疗仍需显式停止。

## FR-CREW-003 房间加成

船员属性可以影响武器装填、护盾恢复、引擎、维修和医疗。P0。

## FR-CREW-004 船员战斗

敌对船员处于同一房间时，按固定 Tick 进行战斗并产生伤害事件。P1。

## FR-CREW-005 装备

装备提供属性和特殊效果。P1。

---
