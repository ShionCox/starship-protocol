import { _decorator, Component, Prefab, SpriteFrame } from 'cc';

const { ccclass, menu, property } = _decorator;

/** 稳定 definitionId 到 Prefab 的持久目录；运行时绝不扫描 Asset DB。 */
@ccclass('BuildablePrefabCatalog')
@menu('星舰协议/场景表现/可建造预制体目录')
export class BuildablePrefabCatalog extends Component {
  @property({ type: Prefab, displayName: '基础地板', tooltip: 'floor-basic Prefab。', group: '地板' }) public floorBasic: Prefab | null = null;
  @property({ type: Prefab, displayName: '楼梯', tooltip: 'room-stairs Prefab。', group: '连接器' }) public roomStairs: Prefab | null = null;
  @property({ type: Prefab, displayName: '电梯', tooltip: 'room-elevator Prefab。', group: '连接器' }) public roomElevator: Prefab | null = null;
  @property({ type: Prefab, displayName: '反应堆', tooltip: 'room-reactor Prefab。', group: '房间' }) public roomReactor: Prefab | null = null;
  @property({ type: Prefab, displayName: '激光室', tooltip: 'room-laser Prefab。', group: '房间' }) public roomLaser: Prefab | null = null;
  @property({ type: Prefab, displayName: '护盾室', tooltip: 'room-shield Prefab。', group: '房间' }) public roomShield: Prefab | null = null;
  @property({ type: Prefab, displayName: '医疗室', tooltip: 'room-medbay Prefab。', group: '房间' }) public roomMedbay: Prefab | null = null;
  @property({ type: SpriteFrame, displayName: '基础地板预览', tooltip: 'visual-floor-basic 的代表性首帧。', group: '预览图' }) public floorBasicPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '楼梯预览', tooltip: 'visual-room-stairs-placeholder 的代表性首帧。', group: '预览图' }) public roomStairsPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '电梯预览', tooltip: 'visual-pss-room-elevator-83 的代表性首帧。', group: '预览图' }) public roomElevatorPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '反应堆预览', tooltip: 'visual-pss-room-reactor-808 的代表性首帧。', group: '预览图' }) public roomReactorPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '激光室预览', tooltip: 'visual-pss-room-laser-8285 的代表性首帧。', group: '预览图' }) public roomLaserPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '护盾室预览', tooltip: 'visual-pss-room-shield-8041 的代表性首帧。', group: '预览图' }) public roomShieldPreview: SpriteFrame | null = null;
  @property({ type: SpriteFrame, displayName: '医疗室预览', tooltip: 'visual-pss-room-medbay-1107 的代表性首帧。', group: '预览图' }) public roomMedbayPreview: SpriteFrame | null = null;

  public resolve(definitionId: string): Prefab | null {
    return ({
      'floor-basic': this.floorBasic,
      'room-stairs': this.roomStairs,
      'room-elevator': this.roomElevator,
      'room-reactor': this.roomReactor,
      'room-laser': this.roomLaser,
      'room-shield': this.roomShield,
      'room-medbay': this.roomMedbay,
    } as Readonly<Record<string, Prefab | null>>)[definitionId] ?? null;
  }

  public resolvePreviewFrame(definitionId: string): SpriteFrame | null {
    return ({
      'floor-basic': this.floorBasicPreview,
      'room-stairs': this.roomStairsPreview,
      'room-elevator': this.roomElevatorPreview,
      'room-reactor': this.roomReactorPreview,
      'room-laser': this.roomLaserPreview,
      'room-shield': this.roomShieldPreview,
      'room-medbay': this.roomMedbayPreview,
    } as Readonly<Record<string, SpriteFrame | null>>)[definitionId] ?? null;
  }

  public validateAuthoringCatalog(): { readonly ok: boolean; readonly message: string } {
    const missing = ['floor-basic', 'room-stairs', 'room-elevator', 'room-reactor', 'room-laser', 'room-shield', 'room-medbay'].filter((id) => this.resolve(id) === null);
    const missingPreviews = ['floor-basic', 'room-stairs', 'room-elevator', 'room-reactor', 'room-laser', 'room-shield', 'room-medbay'].filter((id) => this.resolvePreviewFrame(id) === null);
    if (missing.length > 0) return { ok: false, message: `可建造目录缺少：${missing.join('、')}` };
    if (missingPreviews.length > 0) return { ok: false, message: `可建造目录缺少预览图：${missingPreviews.join('、')}` };
    return { ok: true, message: '可建造目录有效：7 项及首帧预览' };
  }
}
