import {
  _decorator,
  Button,
  Component,
  error,
  Label,
  Node,
} from 'cc';

import type { EnergyCommand } from '../game-core/EnergyModel';
import type { PowerPanelRoom } from './PowerPanel';

const { ccclass, menu, property } = _decorator;

/** 单个耗能房间的可见能源控制行；规则由场景装配注入的 Command Handler 执行。 */
@ccclass('PowerRoomRow')
@menu('星舰协议/界面/能源房间行')
export class PowerRoomRow extends Component {
  @property({ displayName: '房间实例标识', tooltip: '必须与房间视图组件的稳定实例标识一致。', group: '房间' })
  public roomInstanceId = '';

  @property({ type: Label, displayName: '房间名称', tooltip: '显示对应房间定义中的中文名称。', group: '显示' })
  public roomNameLabel: Label | null = null;

  @property({ type: Label, displayName: '当前能源', tooltip: '显示该房间当前分配的能源和最高能源。', group: '显示' })
  public powerLabel: Label | null = null;

  @property({ type: Button, displayName: '减少按钮', tooltip: '降低一格能源；降到最低运行能源时直接断电。', group: '操作' })
  public decreaseButton: Button | null = null;

  @property({ type: Button, displayName: '增加按钮', tooltip: '从断电状态开启到最低运行能源，之后每次增加一格。', group: '操作' })
  public increaseButton: Button | null = null;

  @property({ type: Button, displayName: '断电按钮', tooltip: '把该房间的能源分配重置为零。', group: '操作' })
  public resetButton: Button | null = null;

  private room: PowerPanelRoom | null = null;
  private power = 0;
  private dispatch: ((command: EnergyCommand) => void) | null = null;

  protected onEnable(): void {
    this.refreshSerializedReferences();
    if (this.roomNameLabel === null || this.powerLabel === null || this.decreaseButton === null || this.increaseButton === null || this.resetButton === null) {
      error('能源房间行 Prefab 缺少持久文字或按钮引用，运行时不会重建行结构。');
    }
    this.registerEvents();
  }

  protected onDisable(): void {
    this.unregisterEvents();
  }

  private registerEvents(): void {
    this.unregisterEvents();
    this.decreaseButton?.node.on(Node.EventType.TOUCH_END, this.handleDecrease, this);
    this.increaseButton?.node.on(Node.EventType.TOUCH_END, this.handleIncrease, this);
    this.resetButton?.node.on(Node.EventType.TOUCH_END, this.handleReset, this);
  }

  private unregisterEvents(): void {
    this.decreaseButton?.node.off(Node.EventType.TOUCH_END, this.handleDecrease, this);
    this.increaseButton?.node.off(Node.EventType.TOUCH_END, this.handleIncrease, this);
    this.resetButton?.node.off(Node.EventType.TOUCH_END, this.handleReset, this);
  }

  public bind(room: PowerPanelRoom, power: number, dispatch: (command: EnergyCommand) => void): void {
    this.refreshSerializedReferences();
    this.room = room;
    this.power = power;
    this.dispatch = dispatch;
    this.refresh();
  }

  public refreshPower(power: number): void {
    this.power = power;
    this.refresh();
  }

  private handleDecrease(): void {
    if (this.room === null || this.dispatch === null) return;
    const nextPower = this.power <= this.room.minPower ? 0 : this.power - 1;
    this.dispatch({ type: 'SET_ROOM_POWER', roomId: this.room.roomId, power: nextPower });
  }

  private handleIncrease(): void {
    if (this.room === null || this.dispatch === null || this.power >= this.room.maxPower) return;
    const nextPower = this.power === 0 ? this.room.minPower : this.power + 1;
    this.dispatch({ type: 'SET_ROOM_POWER', roomId: this.room.roomId, power: nextPower });
  }

  private handleReset(): void {
    if (this.room === null || this.dispatch === null) return;
    this.dispatch({ type: 'RESET_ROOM_POWER', roomId: this.room.roomId });
  }

  private refresh(): void {
    if (this.room === null) return;
    if (this.roomNameLabel !== null) this.roomNameLabel.string = this.room.displayName;
    if (this.powerLabel !== null) this.powerLabel.string = `${this.power} / ${this.room.maxPower}`;
    if (this.decreaseButton !== null) this.decreaseButton.interactable = this.power > 0;
    if (this.increaseButton !== null) this.increaseButton.interactable = this.power < this.room.maxPower;
    if (this.resetButton !== null) this.resetButton.interactable = this.power > 0;
  }

  /**
   * Prefab 实例化后，Creator 可能把跨 Prefab 的旧组件引用恢复为失效组件。
   * 运行时始终以当前行节点内的中文语义子节点重建引用，避免持有已销毁 Node。
   */
  private refreshSerializedReferences(): void {
    this.roomNameLabel = this.node.getChildByName('房间名称')?.getComponent(Label) ?? null;
    this.powerLabel = this.node.getChildByName('当前能源')?.getComponent(Label) ?? null;
    this.decreaseButton = this.node.getChildByName('减少按钮')?.getComponent(Button) ?? null;
    this.increaseButton = this.node.getChildByName('增加按钮')?.getComponent(Button) ?? null;
    this.resetButton = this.node.getChildByName('断电按钮')?.getComponent(Button) ?? null;
  }
}
