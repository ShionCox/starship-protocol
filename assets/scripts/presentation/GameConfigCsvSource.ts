import { _decorator, Component, TextAsset } from 'cc';

import { parseGameConfigCsvBundle, type CsvGameConfigResult, type ParsedGameConfig } from '../game-core/CsvGameConfig';
import {
  parseVisualConfigCsv,
  type VisualConfigResult,
  type VisualDefinition,
  type VisualFrameDefinition,
} from './VisualConfigCsv';

const { ccclass, executeInEditMode, menu, property } = _decorator;

/** Creator 持久绑定的权威 CSV 入口；运行时和编辑器预览共用同一次全表校验。 */
@ccclass('GameConfigCsvSource')
@executeInEditMode
@menu('星舰协议/配置/权威 CSV 来源')
export class GameConfigCsvSource extends Component {
  @property({ type: TextAsset, displayName: '全局配置表', tooltip: 'assets/config/csv/game.csv', group: '权威配置表' })
  public game: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '船体配置表', tooltip: 'assets/config/csv/hulls.csv', group: '权威配置表' })
  public hulls: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '房间配置表', tooltip: 'assets/config/csv/rooms.csv', group: '权威配置表' })
  public rooms: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '连接器停靠口表', tooltip: 'assets/config/csv/connector-ports.csv', group: '权威配置表' })
  public connectorPorts: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '地板配置表', tooltip: 'assets/config/csv/floors.csv', group: '权威配置表' })
  public floors: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '船员配置表', tooltip: 'assets/config/csv/crews.csv', group: '权威配置表' })
  public crews: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '船员词条表', tooltip: 'assets/config/csv/crew-traits.csv', group: '权威配置表' })
  public crewTraits: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '视觉定义表', tooltip: 'assets/config/csv/visuals.csv', group: '表现配置表' })
  public visuals: TextAsset | null = null;

  @property({ type: TextAsset, displayName: '视觉帧表', tooltip: 'assets/config/csv/visual-frames.csv', group: '表现配置表' })
  public visualFrames: TextAsset | null = null;

  private signature = '';
  private result: CsvGameConfigResult | null = null;
  private visualResult: VisualConfigResult | null = null;

  /** 创作工具逐张连接资源时允许 View 保持静默，全部引用齐备后再做真实校验。 */
  public hasCompleteBinding(): boolean {
    return [this.game, this.hulls, this.rooms, this.connectorPorts, this.floors, this.crews, this.crewTraits, this.visuals, this.visualFrames]
      .every((asset) => asset != null);
  }

  public resolve(): CsvGameConfigResult {
    const assets = [this.game, this.hulls, this.rooms, this.connectorPorts, this.floors, this.crews, this.crewTraits, this.visuals, this.visualFrames];
    // Creator 反序列化未绑定的 TextAsset 可能给出 undefined；两者都表示断开的来源。
    if (!this.hasCompleteBinding()) return { ok: false, message: '请完整绑定 9 张权威 CSV 配置表' };
    const signature = assets.map((asset) => asset?.text ?? '').join('\u0000');
    if (this.result !== null && this.visualResult?.ok === true && signature === this.signature) return this.result;
    this.signature = signature;
    this.result = parseGameConfigCsvBundle({
      game: this.game?.text ?? '',
      hulls: this.hulls?.text ?? '',
      rooms: this.rooms?.text ?? '',
      connectorPorts: this.connectorPorts?.text ?? '',
      floors: this.floors?.text ?? '',
      crews: this.crews?.text ?? '',
      crewTraits: this.crewTraits?.text ?? '',
    });
    this.visualResult = parseVisualConfigCsv(this.visuals?.text ?? '', this.visualFrames?.text ?? '');
    if (this.visualResult.ok === false) return { ok: false, message: this.visualResult.message };
    return this.result;
  }

  public getConfig(): Readonly<ParsedGameConfig> {
    const resolved = this.resolve();
    if (resolved.ok === false) throw new RangeError(resolved.message);
    return resolved.config;
  }

  /** 表现组件只读取已经和九张配置一起通过校验的视觉定义，不建立第二套 CSV 解析。 */
  public getVisualDefinition(visualId: string): {
    readonly visual: Readonly<VisualDefinition>;
    readonly frames: readonly Readonly<VisualFrameDefinition>[];
  } | null {
    const resolved = this.resolve();
    if (resolved.ok === false || this.visualResult?.ok !== true) return null;
    const visual = this.visualResult.visuals.find((entry) => entry.visualId === visualId.trim());
    if (visual === undefined) return null;
    return {
      visual,
      frames: this.visualResult.frames
        .filter((frame) => frame.visualId === visual.visualId)
        .sort((left, right) => left.frameIndex - right.frameIndex),
    };
  }

  /** 创作工具 reimport 后调用，确保当前上下文下一次读取使用新文本。 */
  public invalidateAuthoringCache(): boolean {
    this.signature = '';
    this.result = null;
    this.visualResult = null;
    return this.resolve().ok;
  }
}
