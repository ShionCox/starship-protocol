import {
  parseRoomDefinition,
  type RoomDefinition,
} from '../game-core/RoomDefinition.ts';
import type { SecureConfigPayload } from './SecureConfigPackage.ts';

/**
 * 运行时唯一规则注册入口。
 *
 * 新配置先完整解析到临时 Map，全部通过后才替换现有状态；调用方永远不会看到
 * 半份新版本。该类不持有 Cocos、网络或密码 API。
 */
export class ConfigRegistry {
  private rooms = new Map<string, Readonly<RoomDefinition>>();
  private loadedBuildId: string | null = null;
  private loadedConfigVersion: string | null = null;

  public replaceFromSecurePayload(payload: SecureConfigPayload): void {
    const nextRooms = new Map<string, Readonly<RoomDefinition>>();
    for (const entry of payload.documents) {
      if (!entry.path.startsWith('rooms/')) {
        continue;
      }
      const parsed = parseRoomDefinition(entry.document);
      if (parsed.ok === false) {
        throw new Error(`房间定义 ${entry.path} 无效：${parsed.message}`);
      }
      const expectedFileName = `${parsed.definition.id}.json`;
      const actualFileName = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      if (actualFileName !== expectedFileName) {
        throw new Error(`房间定义文件名与稳定 ID 不一致：${entry.path}`);
      }
      if (nextRooms.has(parsed.definition.id)) {
        throw new Error(`房间稳定 ID 重复：${parsed.definition.id}`);
      }
      nextRooms.set(parsed.definition.id, parsed.definition);
    }
    if (nextRooms.size === 0) {
      throw new Error('安全配置包不包含房间定义');
    }

    this.rooms = nextRooms;
    this.loadedBuildId = payload.buildId;
    this.loadedConfigVersion = payload.configVersion;
  }

  public getRoomDefinition(id: string): Readonly<RoomDefinition> | null {
    return this.rooms.get(id) ?? null;
  }

  public get buildId(): string | null {
    return this.loadedBuildId;
  }

  public get configVersion(): string | null {
    return this.loadedConfigVersion;
  }
}
