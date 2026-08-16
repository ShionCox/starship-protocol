import {
  _decorator,
  Button,
  Component,
  error,
  Label,
} from 'cc';

import type { OfflineConstructionSummary } from '../application/PlayerStatePort';

const { ccclass, menu, property } = _decorator;

/**
 * 离线施工结算的一次性提示。摘要由 PlayerStatePort 产生，组件只负责把结果展示给玩家；
 * 关闭后本次运行不再重复弹出，也不会把 UI 状态写入玩家存档。
 */
@ccclass('OfflineSettlementDialog')
@menu('星舰协议/界面/离线结算弹窗')
export class OfflineSettlementDialog extends Component {
  @property({ type: Label, displayName: '标题', tooltip: '离线施工结算标题。', group: '持久引用' })
  public titleLabel: Label | null = null;

  @property({ type: Label, displayName: '摘要', tooltip: '显示完成项目、时间回拨和金属变化。', group: '持久引用' })
  public summaryLabel: Label | null = null;

  @property({ type: Button, displayName: '关闭按钮', tooltip: '关闭本次离线结算摘要。', group: '持久引用' })
  public closeButton: Button | null = null;

  private shownThisRun = false;

  public show(summary: OfflineConstructionSummary): void {
    if (this.shownThisRun) return;
    this.shownThisRun = true;
    if (this.summaryLabel !== null) {
      const completed = summarizeCompletedJobs(summary);
      const rollback = summary.clockRollback ? '；检测到时钟回拨，未推进负向时间' : '';
      this.summaryLabel.string = `完成：${completed}\n金属变化：${summary.metalDelta >= 0 ? '+' : ''}${summary.metalDelta}${rollback}`;
    }
    if (this.node.parent !== null) this.node.parent.active = true;
    this.node.active = true;
  }

  public close(): void {
    this.node.active = false;
    const parent = this.node.parent;
    if (parent !== null && parent.children.every((child) => child.active !== true)) parent.active = false;
  }

  protected onEnable(): void {
    if (this.titleLabel === null || this.summaryLabel === null || this.closeButton === null) {
      error('离线结算弹窗 Prefab 缺少持久标题、摘要或关闭按钮引用，运行时不会重建弹窗。');
    }
    this.closeButton?.node.on(Button.EventType.CLICK, this.close, this);
  }

  protected onDisable(): void {
    this.closeButton?.node.off(Button.EventType.CLICK, this.close, this);
  }
}

function summarizeCompletedJobs(summary: OfflineConstructionSummary): string {
  if (summary.completedJobs.length === 0) return '无项目完成';
  const labels: Record<OfflineConstructionSummary['completedJobs'][number]['operation'], string> = {
    BUILD_FLOOR: '建造地板',
    BUILD_ROOM: '建造房间',
    DEMOLISH_FLOOR: '拆除地板',
    DEMOLISH_ROOM: '拆除房间',
  };
  const counts = new Map<string, number>();
  for (const job of summary.completedJobs) {
    const label = labels[job.operation];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, count]) => `${label} ×${count}`).join('、');
}
