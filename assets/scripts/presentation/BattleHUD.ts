import { _decorator, Button, Component, director, error, Label, Node } from 'cc';

const { ccclass, menu, property } = _decorator;

/** 战斗 HUD 只展示明确绑定的双方飞船作用域，不搜索场景中的 RoomView。 */
@ccclass('BattleHUD')
@menu('星舰协议/界面/战斗界面')
export class BattleHUD extends Component {
  @property({ type: Label, displayName: '我方飞船', tooltip: '显示我方飞船实例标识。', group: '显示' })
  public playerShipLabel: Label | null = null;

  @property({ type: Label, displayName: '敌方飞船', tooltip: '显示敌方飞船实例标识。', group: '显示' })
  public enemyShipLabel: Label | null = null;

  @property({ type: Label, displayName: '战斗状态', tooltip: '当前阶段仅显示战斗系统尚未开放。', group: '显示' })
  public statusLabel: Label | null = null;

  @property({ type: Button, displayName: '返回主场景按钮', tooltip: '返回 MainScene 的中文按钮。', group: '操作' })
  public backButton: Button | null = null;

  protected onEnable(): void {
    if (this.playerShipLabel === null || this.enemyShipLabel === null || this.statusLabel === null || this.backButton === null) {
      error('BattleHUD Prefab 缺少持久状态文字或返回按钮引用，运行时不会重建 HUD。');
    }
    this.backButton?.node.off(Node.EventType.TOUCH_END, this.returnToMain, this);
    this.backButton?.node.on(Node.EventType.TOUCH_END, this.returnToMain, this);
  }

  protected onDisable(): void {
    this.backButton?.node.off(Node.EventType.TOUCH_END, this.returnToMain, this);
  }

  public bind(playerShipId: string, enemyShipId: string): void {
    if (playerShipId.trim() === '' || enemyShipId.trim() === '' || playerShipId === enemyShipId) {
      error('[UI] 战斗界面必须绑定两个不同的非空飞船实例标识');
      return;
    }
    if (this.playerShipLabel !== null) this.playerShipLabel.string = `我方飞船：${playerShipId}`;
    if (this.enemyShipLabel !== null) this.enemyShipLabel.string = `敌方飞船：${enemyShipId}`;
    if (this.statusLabel !== null) this.statusLabel.string = '战斗规则将在后续 R1 切片开放';
  }

  private returnToMain(): void {
    director.loadScene('MainScene', (cause) => {
      if (cause !== null && cause !== undefined) error(`[UI] 无法返回主场景：${cause.message}`);
    });
  }
}
