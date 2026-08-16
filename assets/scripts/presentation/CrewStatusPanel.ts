import {
  _decorator,
  Button,
  Component,
  error,
  Label,
} from 'cc';

import { CREW_ROLE_LABELS } from '../game-core/CrewDefinition';
import type { CrewReadState } from '../game-core/CrewModel';

const { ccclass, menu, property } = _decorator;

export interface CrewStatusRoomState {
  readonly roomId: string;
  readonly displayName: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly minPower: number;
  readonly allocatedPower: number;
  readonly healingHpPerTick: number;
}

export interface CrewStatusTelemetry {
  readonly edgeLabel: '—' | '普通' | '电梯' | '楼梯';
  readonly edgeUsedTicks: number;
  readonly edgeTotalTicks: number;
  readonly patrolEnabled: boolean;
  readonly patrolResumeTicks: number;
  readonly constructionJobId: string | null;
  readonly constructionAtSite: boolean;
}

export type CrewTaskPanelCommand =
  | { readonly type: 'START_REPAIR'; readonly crewId: string; readonly roomId: string }
  | { readonly type: 'STOP_REPAIR'; readonly crewId: string }
  | { readonly type: 'START_HEAL'; readonly patientCrewId: string; readonly medicCrewId: string; readonly roomId: string }
  | { readonly type: 'STOP_HEAL'; readonly patientCrewId: string };

export type CrewTaskPanelHandler = (command: CrewTaskPanelCommand) => Promise<void>;

/** 船员状态面板只展示只读状态和发送 Command，不直接持有或修改 CrewModel。 */
@ccclass('CrewStatusPanel')
@menu('星舰协议/界面/船员状态面板')
export class CrewStatusPanel extends Component {
  @property({ type: Label, displayName: '当前选择', tooltip: '显示当前选中的船员及职业。', group: '显示' })
  public selectionLabel: Label | null = null;

  @property({ type: Label, displayName: '所在房间', tooltip: '显示当前逻辑房间实例 ID。', group: '显示' })
  public currentRoomLabel: Label | null = null;

  @property({ type: Label, displayName: '目标房间', tooltip: '显示移动或维修目标；空闲时显示“无”。', group: '显示' })
  public targetRoomLabel: Label | null = null;

  @property({ type: Label, displayName: '船员状态', tooltip: '显示空闲、移动中或维修中。', group: '显示' })
  public stateLabel: Label | null = null;

  @property({ type: Label, displayName: '房间耐久', tooltip: '显示当前船员所在或正在维修房间的耐久。', group: '维修' })
  public roomHpLabel: Label | null = null;

  @property({ type: Label, displayName: '船员生命', tooltip: '显示当前选中船员的生命值。', group: '医疗' })
  public crewHpLabel: Label | null = null;

  @property({ type: Button, displayName: '维修按钮', tooltip: '向当前飞船发送开始或停止维修 Command。', group: '维修' })
  public repairButton: Button | null = null;

  @property({ type: Label, displayName: '维修按钮文字', tooltip: '显示“开始维修”或“停止维修”。', group: '维修' })
  public repairButtonLabel: Label | null = null;

  @property({ type: Button, displayName: '治疗按钮', tooltip: '向当前飞船发送开始或停止治疗 Command。', group: '医疗' })
  public healButton: Button | null = null;

  @property({ type: Label, displayName: '治疗按钮文字', tooltip: '显示“开始治疗”或“停止治疗”。', group: '医疗' })
  public healButtonLabel: Label | null = null;

  @property({ type: Label, displayName: '状态提示', tooltip: '显示移动、维修或存档错误等中文反馈。', group: '显示' })
  public statusLabel: Label | null = null;

  @property({ type: Label, displayName: '路径与巡逻遥测', tooltip: '显示当前路径边 Tick、巡逻开关和抢占恢复 Tick。', group: '只读遥测' })
  public telemetryLabel: Label | null = null;

  @property({ type: Label, displayName: '施工遥测', tooltip: '显示当前施工项目以及是否已经到场。', group: '只读遥测' })
  public constructionTelemetryLabel: Label | null = null;

  private shipId = '';
  private selected: CrewReadState | null = null;
  private room: CrewStatusRoomState | null = null;
  private taskHandler: CrewTaskPanelHandler | null = null;
  private availableMedicId: string | null = null;
  private taskPending = false;
  private telemetryCrewId: string | null = null;
  private lastConnector: { readonly label: '电梯' | '楼梯'; readonly totalTicks: number } | null = null;
  private maxObservedPatrolResumeTicks = 0;
  private patrolResumeCompleted = false;

  protected onEnable(): void {
    if (this.selectionLabel === null || this.currentRoomLabel === null || this.targetRoomLabel === null || this.stateLabel === null || this.roomHpLabel === null || this.crewHpLabel === null || this.repairButton === null || this.repairButtonLabel === null || this.healButton === null || this.healButtonLabel === null || this.statusLabel === null || this.telemetryLabel === null || this.constructionTelemetryLabel === null) {
      error('船员状态面板 Prefab 缺少持久文字或按钮引用，运行时不会重建面板结构。');
    }
    this.repairButton?.node.on(Button.EventType.CLICK, this.handleRepairClick, this);
    this.healButton?.node.on(Button.EventType.CLICK, this.handleHealClick, this);
    this.refreshRepairButton();
    this.refreshHealButton();
  }

  protected onDisable(): void {
    this.repairButton?.node.off(Button.EventType.CLICK, this.handleRepairClick, this);
    this.healButton?.node.off(Button.EventType.CLICK, this.handleHealClick, this);
  }

  public bind(shipId: string, taskHandler: CrewTaskPanelHandler): void {
    if (shipId.trim() === '') {
      error('[UI] 船员状态面板绑定的飞船实例标识不能为空');
      return;
    }
    this.shipId = shipId;
    this.taskHandler = taskHandler;
  }

  public refresh(selected: CrewReadState | null, room: CrewStatusRoomState | null, availableMedicId: string | null, message = '', telemetry?: CrewStatusTelemetry): void {
    if (selected?.id !== this.telemetryCrewId) {
      this.telemetryCrewId = selected?.id ?? null;
      this.lastConnector = null;
      this.maxObservedPatrolResumeTicks = 0;
      this.patrolResumeCompleted = false;
    }
    if (telemetry?.edgeLabel === '电梯' || telemetry?.edgeLabel === '楼梯') {
      this.lastConnector = { label: telemetry.edgeLabel, totalTicks: telemetry.edgeTotalTicks };
    }
    if ((telemetry?.patrolResumeTicks ?? 0) > 0) {
      this.maxObservedPatrolResumeTicks = Math.max(this.maxObservedPatrolResumeTicks, telemetry?.patrolResumeTicks ?? 0);
      this.patrolResumeCompleted = false;
    } else if (this.maxObservedPatrolResumeTicks > 0) {
      this.patrolResumeCompleted = true;
    }
    this.selected = selected;
    this.room = room;
    this.availableMedicId = availableMedicId;
    if (this.selectionLabel !== null) {
      this.selectionLabel.string = selected === null
        ? '当前选择：无'
        : `当前选择：${selected.displayName}（${CREW_ROLE_LABELS[selected.role]}）`;
    }
    if (this.currentRoomLabel !== null) this.currentRoomLabel.string = `所在房间：${selected?.currentRoomId ?? '无'}`;
    if (this.targetRoomLabel !== null) this.targetRoomLabel.string = `目标房间：${selected?.targetRoomId ?? '无'}`;
    if (this.stateLabel !== null) this.stateLabel.string = `状态：${stateLabel(selected?.state)}`;
    if (this.crewHpLabel !== null) this.crewHpLabel.string = selected === null ? '船员生命：无' : `船员生命：${selected.hp}/${selected.maxHp}`;
    if (this.roomHpLabel !== null) this.roomHpLabel.string = room === null ? '房间耐久：无' : `房间耐久：${room.hp}/${room.maxHp}`;
    if (this.statusLabel !== null) this.statusLabel.string = message.length > 0 ? message : healingDisabledReason(selected, room, availableMedicId);
    if (this.telemetryLabel !== null) {
      const resumeText = telemetry === undefined || telemetry.patrolResumeTicks > 0
        ? `${telemetry?.patrolResumeTicks ?? 0} Tick`
        : this.patrolResumeCompleted ? `已完成（${this.maxObservedPatrolResumeTicks} Tick）` : '0 Tick';
      this.telemetryLabel.string = selected === null || telemetry === undefined
        ? '路径：—　巡逻：关闭　恢复：0 Tick'
        : telemetry.edgeTotalTicks > 0
          ? `路径：${telemetry.edgeLabel} ${telemetry.edgeUsedTicks}/${telemetry.edgeTotalTicks} Tick　巡逻：${telemetry.patrolEnabled ? '开启' : '关闭'}`
          : this.patrolResumeCompleted
            ? `恢复：已完成（${this.maxObservedPatrolResumeTicks} Tick）　巡逻：${telemetry.patrolEnabled ? '开启' : '关闭'}`
            : this.lastConnector !== null
              ? `最近连接器：${this.lastConnector.label} ${this.lastConnector.totalTicks} Tick　巡逻：${telemetry.patrolEnabled ? '开启' : '关闭'}`
              : `路径：—　巡逻：${telemetry.patrolEnabled ? '开启' : '关闭'}　恢复：${resumeText}`;
    }
    if (this.constructionTelemetryLabel !== null) {
      this.constructionTelemetryLabel.string = telemetry?.constructionJobId === null || telemetry?.constructionJobId === undefined
        ? '施工：无'
        : `施工：${telemetry.constructionJobId}（${telemetry.constructionAtSite ? '已到场' : '前往工地'}）`;
    }
    this.refreshRepairButton();
    this.refreshHealButton();
  }

  private readonly handleRepairClick = (): void => {
    const selected = this.selected;
    const room = this.room;
    if (this.taskPending || selected === null || room === null || this.taskHandler === null) return;
    const command: CrewTaskPanelCommand = selected.state === 'REPAIRING'
      ? { type: 'STOP_REPAIR', crewId: selected.id }
      : { type: 'START_REPAIR', crewId: selected.id, roomId: room.roomId };
    this.taskPending = true;
    this.refreshRepairButton();
    const finish = (): void => {
      this.taskPending = false;
      this.refreshRepairButton();
      this.refreshHealButton();
    };
    void this.taskHandler(command).then(finish, finish);
  };

  private readonly handleHealClick = (): void => {
    const selected = this.selected;
    const room = this.room;
    if (this.taskPending || selected === null || room === null || this.taskHandler === null) return;
    const command: CrewTaskPanelCommand | null = selected.state === 'HEALING'
      ? { type: 'STOP_HEAL', patientCrewId: selected.id }
      : this.availableMedicId === null ? null : {
        type: 'START_HEAL', patientCrewId: selected.id, medicCrewId: this.availableMedicId, roomId: room.roomId,
      };
    if (command === null) return;
    this.taskPending = true;
    this.refreshRepairButton();
    this.refreshHealButton();
    const finish = (): void => {
      this.taskPending = false;
      this.refreshRepairButton();
      this.refreshHealButton();
    };
    void this.taskHandler(command).then(finish, finish);
  };

  private refreshRepairButton(): void {
    if (this.repairButton === null || this.repairButtonLabel === null) return;
    const selected = this.selected;
    const room = this.room;
    const stopping = selected?.state === 'REPAIRING';
    this.repairButtonLabel.string = stopping ? '停止维修' : '开始维修';
    this.repairButton.interactable = !this.taskPending && selected !== null && room !== null && (
      stopping || (selected.state === 'IDLE' && selected.role === 'ENGINEER' && selected.repairHpPerTick > 0 && room.hp < room.maxHp)
    );
  }

  private refreshHealButton(): void {
    if (this.healButton === null || this.healButtonLabel === null) return;
    const selected = this.selected;
    const room = this.room;
    const stopping = selected?.state === 'HEALING';
    this.healButtonLabel.string = stopping ? '停止治疗' : '开始治疗';
    this.healButton.interactable = !this.taskPending && selected !== null && room !== null && (
      stopping || (selected.state === 'IDLE' && selected.hp < selected.maxHp && room.healingHpPerTick > 0 &&
        room.allocatedPower >= room.minPower && this.availableMedicId !== null)
    );
  }

}

function stateLabel(state: CrewReadState['state'] | undefined): string {
  if (state === 'MOVING') return '移动中';
  if (state === 'REPAIRING') return '维修中';
  if (state === 'HEALING') return '治疗中';
  if (state === 'TREATING') return '诊疗中';
  if (state === 'CONSTRUCTING') return '施工中';
  return '空闲';
}

function healingDisabledReason(selected: CrewReadState | null, room: CrewStatusRoomState | null, medicId: string | null): string {
  if (selected === null) return '请先点击一名船员';
  if (selected.state === 'HEALING') return '治疗进行中';
  if (selected.state === 'TREATING') return `正在诊疗：${selected.taskPartnerCrewId ?? '未知病员'}`;
  if (selected.state !== 'IDLE') return '船员正在执行其他任务';
  if (selected.hp >= selected.maxHp) return '船员生命已满';
  if (room === null || room.healingHpPerTick <= 0) return '请先前往医疗室';
  if (room.allocatedPower < room.minPower) return '医疗室能源不足';
  if (medicId === null) return '没有可用医务员';
  return '可以开始治疗';
}
