import type { CrewDefinition } from '../game-core/CrewDefinition.ts';
import type { HullDefinition } from '../game-core/HullDefinition.ts';
import type { RoomDefinition } from '../game-core/RoomDefinition.ts';

/** 规则目录初始化输入；所有定义必须在进入目录前完成领域解析和校验。 */
export interface GameConfigCatalogInput {
  readonly configVersion: string;
  readonly hulls: readonly Readonly<HullDefinition>[];
  readonly rooms: readonly Readonly<RoomDefinition>[];
  readonly crews: readonly Readonly<CrewDefinition>[];
}

/** 开发期唯一规则目录；只接收已解析定义，不负责读取 JsonAsset、网络或发布安全。 */
export class GameConfigCatalog {
  public readonly configVersion: string;
  private readonly hulls: ReadonlyMap<string, Readonly<HullDefinition>>;
  private readonly rooms: ReadonlyMap<string, Readonly<RoomDefinition>>;
  private readonly crews: ReadonlyMap<string, Readonly<CrewDefinition>>;

  public constructor(input: GameConfigCatalogInput) {
    if (typeof input.configVersion !== 'string' || input.configVersion.trim().length === 0) {
      throw new RangeError('配置版本不能为空');
    }
    this.configVersion = input.configVersion;
    this.hulls = createUniqueMap(input.hulls, '船体');
    this.rooms = createUniqueMap(input.rooms, '房间');
    this.crews = createUniqueMap(input.crews, '船员');
  }

  public getHull(id: string): Readonly<HullDefinition> | null {
    return this.hulls.get(id) ?? null;
  }

  public getRoom(id: string): Readonly<RoomDefinition> | null {
    return this.rooms.get(id) ?? null;
  }

  public getCrew(id: string): Readonly<CrewDefinition> | null {
    return this.crews.get(id) ?? null;
  }
}

function createUniqueMap<T extends { readonly id: string }>(values: readonly T[], label: string): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const value of values) {
    if (map.has(value.id)) throw new RangeError(`${label}定义 ID 重复：${value.id}`);
    map.set(value.id, value);
  }
  return map;
}
