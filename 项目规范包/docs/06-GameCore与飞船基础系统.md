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
PrototypeSceneSettings / 场景坐标适配
↓
Local Position
↓
Cocos Node
```

场景中的网格列数、行数、格子尺寸和吸附开关由 AppRoot 上唯一的 SceneSettings 提供；GridRoot 只是绘制目标，不拥有第二份网格配置。

## 9.2 船体定义

```ts
interface HullDefinition {
  id: string;
  name: string;
  level: number;
  width: number;
  height: number;
  validCells: number[];
  maxCrew: number;
  maxRooms?: number;
}
```

必须支持非矩形船体。

## 9.3 占用表

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
  category: RoomCategory;
  width: number;
  height: number;
  maxLevel: number;
  maxHp: number;
  minPower: number;
  maxPower: number;
  powerGeneration?: number; // 能源房间的基础产能；旧配置缺省为 0
  crewCapacity: number;
}
```

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

R1 运行时把场景中每个 `RoomView.roomInstanceId` 与已解析的 `RoomDefinition` 组成只读映射，再由 `createEnergyRooms` 生成 `EnergyRoom`；映射不读取 Node、Prefab 或像素坐标，任一实例 ID、定义或非能源产能非法时整次能源装配失败。能源快照独立保存于 Web `localStorage` 的 `starship-protocol:r1:energy`，不改变 R0 布局存档；版本不兼容、未知房间、重复分配或非法数值会整份回退为零并输出警告。

玩家界面只消费 `PowerPanelState`，按钮动作转换为 `EnergyCommand` 交给 Bootstrap 的 Handler；EnergyModel 成功后立即保存，保存失败恢复 Command 前快照，面板继续显示旧状态。当前纵切只提供基础产能和手动分配，不实现状态惩罚、Tick、武器开火、护盾效果或 AI 调电。

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

R1 船员移动纵切只启用 `IDLE` 和 `MOVING`；其余状态是后续维修、岗位、战斗和医疗里程碑的扩展目标，当前不得提前写入运行时快照。

```ts
type CrewState =
  | 'IDLE'
  | 'MOVING'
  | 'OPERATING'
  | 'REPAIRING'
  | 'FIGHTING'
  | 'HEALING'
  | 'EXTINGUISHING'
  | 'CASTING'
  | 'DEAD';
```

## FR-CREW-001 分配

玩家可以将船员分配到合法房间。P0。

## FR-CREW-002 房间岗位

房间拥有站位数量，超过容量时按统一规则排队或拒绝 Command。P0。

R1 当前选择“拒绝 Command”：`CrewModel` 在移动前预留目标房间最低编号空闲站位，移动中的船员继续占用目标预留站位；目标已满、船员忙碌、房间未知或路径不存在时整条 `MOVE_CREW` 失败且旧状态不变。路径经过的中间房间不占用岗位。

## 13.3 R1 船员移动纵切

- `CrewDefinition` 使用 `schemaVersion = 1`，当前职业只有 `ENGINEER` / `GUNNER`，中文显示分别为“工程师”和“武器操作员”；定义只保存稳定 ID、中文名称、最大生命和每条导航边的固定 Tick 数。
- `CrewModel` 只消费 `NavigationGraph`、初始站位和 `MOVE_CREW`；`advanceOneTick()` 是唯一移动时钟入口，快照按稳定船员实例 ID 排序，并保存当前房间、目标房间、站位、完整活动路径和边内 Tick 进度。
- Web 原型船员快照独立保存到 `starship-protocol:r1:crew`，不写入布局或能源快照。空存档使用编辑器初始站位；新增船员补默认状态；未知旧船员、未知房间、重复实例、容量冲突、断开路径或版本错误会整份回退。
- Command 接受、跨越导航边和最终到达均保存；写盘失败恢复前一份持久快照，跨边失败同时暂停时钟并显示中文错误。
- Cocos `CrewView` 只负责中文 Inspector、选择、高亮和只读插值；`CrewStatusPanel` 只展示选择、当前房间、目标房间、状态与中文提示。Bootstrap 以 10Hz 调用核心 Tick，不在渲染 `update()` 中执行船员规则。
- 当前边界只包含两名可见船员和单层房间移动，不实现岗位加成、维修、伤害、死亡、排队、跨甲板电梯、AI 或 Replay。

## FR-CREW-003 房间加成

船员属性可以影响武器装填、护盾恢复、引擎、维修和医疗。P0。

## FR-CREW-004 船员战斗

敌对船员处于同一房间时，按固定 Tick 进行战斗并产生伤害事件。P1。

## FR-CREW-005 装备

装备提供属性和特殊效果。P1。

---
