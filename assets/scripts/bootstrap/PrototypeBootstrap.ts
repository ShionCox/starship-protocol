import { _decorator, Component, error, instantiate, log, Prefab, warn } from 'cc';
import { NATIVE } from 'cc/env';

import { ConfigRegistry } from '../application/ConfigRegistry';
import { bootstrapSecureConfig } from '../application/SecureConfigBootstrap';
import { CocosAesGcmDecryptor } from '../adapters/CocosAesGcmDecryptor';
import {
  CocosSecureConfigTransport,
  readCocosLaunchContext,
} from '../adapters/CocosSecureConfigTransport';
import type { RoomDefinition } from '../game-core/RoomDefinition';
import {
  ShipGridModel,
  type MoveRoomCommand,
  type RoomPlacement,
} from '../game-core/ShipGridModel';
import { CameraController } from '../input/CameraController';
import { RoomView } from '../presentation/RoomView';
import { loadPrototypeLayout, savePrototypeLayout } from './PrototypeLayoutStorage';
import { PrototypeSceneSettings } from './PrototypeSceneSettings';
import { findPrototypeSceneNode, findPrototypeSceneNodePath } from './PrototypeSceneNodes';

const { ccclass, menu, property } = _decorator;

/**
 * R0 原型场景的最小装配入口。
 * 这里只连接编辑器中已经挂载的 Cocos 表现组件，不承载网格或房间规则。
 */
@ccclass('PrototypeBootstrap')
@menu('星舰协议/启动/原型场景装配')
export class PrototypeBootstrap extends Component {
  private readonly configRegistry = new ConfigRegistry();

  @property({
    type: Prefab,
    displayName: '反应堆房间预制体',
    tooltip: 'RoomRoot 中没有编辑器实例时使用的运行时备用 Prefab。',
    group: '场景资源',
  })
  public reactorRoomPrefab: Prefab | null = null;

  protected start(): void {
    void this.initialize().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      error(`[BOOT] 原型场景装配失败：${message}`);
    });
  }

  private async initialize(): Promise<void> {
    const scene = this.node.scene;
    const roomRoot = scene === null ? null : findPrototypeSceneNodePath(scene, 'canvas', 'worldRoot', 'shipRoot', 'roomRoot');
    const appRoot = scene === null ? null : findPrototypeSceneNode(scene, 'appRoot');

    if (roomRoot === null || appRoot === null) {
      error('[BOOT] PrototypeScene 节点结构不完整');
      return;
    }

    const sceneSettings = appRoot.getComponent(PrototypeSceneSettings);
    if (sceneSettings === null || sceneSettings.gridRoot === null || !sceneSettings.hasValidGridConfig()) {
      error('[BOOT] 请在 AppRoot 的原型场景设置中配置有效网格参数和 GridRoot 引用');
      return;
    }

    const cameraController = appRoot.getComponent(CameraController);
    if (cameraController === null) {
      error('[BOOT] 请在 Cocos 编辑器中给 AppRoot 挂载 CameraController');
      return;
    }

    let roomViews = roomRoot.getComponentsInChildren(RoomView);
    let createdAtRuntime = false;
    if (roomViews.length === 0) {
      if (this.reactorRoomPrefab === null) {
        warn('[BOOT] RoomRoot 中没有 ReactorRoom 实例，也未绑定 ReactorRoom Prefab');
        return;
      }
      const roomNode = instantiate(this.reactorRoomPrefab);
      roomRoot.addChild(roomNode);
      const roomView = roomNode.getComponent(RoomView);
      if (roomView === null) {
        roomNode.destroy();
        error('[BOOT] ReactorRoom Prefab 缺少 RoomView 组件');
        return;
      }
      roomViews = [roomView];
      createdAtRuntime = true;
    }

    const roomIds = roomViews.map((roomView) => roomView.roomInstanceId.trim());
    if (roomIds.some((roomId) => roomId.length === 0) || new Set(roomIds).size !== roomIds.length) {
      error('[BOOT] RoomRoot 中每个 RoomView 都必须配置非空且唯一的房间实例 ID');
      return;
    }
    const definitionsByRoomId = new Map<string, Readonly<RoomDefinition>>();
    if (NATIVE) {
      await bootstrapSecureConfig(
        readCocosLaunchContext(),
        new CocosSecureConfigTransport(),
        new CocosAesGcmDecryptor(),
        this.configRegistry,
      );
      for (let index = 0; index < roomViews.length; index += 1) {
        const definitionId = roomViews[index].getRoomDefinitionId();
        const definition = this.configRegistry.getRoomDefinition(definitionId);
        if (definition === null) {
          throw new Error(`安全配置缺少房间定义：${definitionId || '空'}`);
        }
        definitionsByRoomId.set(roomIds[index], definition);
      }
      log(
        `[CONFIG] 已加载受认证规则：Build=${this.configRegistry.buildId ?? ''} ` +
        `Config=${this.configRegistry.configVersion ?? ''}`,
      );
    } else {
      for (let index = 0; index < roomViews.length; index += 1) {
        const definitionResult = roomViews[index].resolveRoomDefinition();
        if (definitionResult.ok === false) {
          error(`[BOOT] 房间 ${roomIds[index]} 定义无效：${definitionResult.message}`);
          return;
        }
        definitionsByRoomId.set(roomIds[index], definitionResult.definition);
      }
    }

    const validHullCells = sceneSettings.getValidHullCells();
    const loadedLayout = loadPrototypeLayout(
      sceneSettings.gridColumns,
      sceneSettings.gridRows,
      validHullCells,
    );
    let gridModel = loadedLayout.status === 'loaded'
      ? loadedLayout.grid
      : new ShipGridModel(sceneSettings.gridColumns, sceneSettings.gridRows, validHullCells);
    let restoredPlacements = loadedLayout.status === 'loaded'
      ? this.getSupportedRestoredPlacements(gridModel, definitionsByRoomId)
      : null;
    if (loadedLayout.status === 'error') {
      warn(`[SAVE] 本地布局恢复失败，已回退编辑器布局：${loadedLayout.message}`);
    } else if (loadedLayout.status === 'loaded' && restoredPlacements === null) {
      warn('[SAVE] 本地布局不符合当前 R0 原型房间配置，已回退编辑器布局');
      gridModel = new ShipGridModel(sceneSettings.gridColumns, sceneSettings.gridRows, validHullCells);
    }

    for (let index = 0; index < roomViews.length; index += 1) {
      const roomView = roomViews[index];
      const definition = definitionsByRoomId.get(roomIds[index]);
      if (definition === undefined) {
        error(`[BOOT] 房间 ${roomIds[index]} 缺少已解析定义`);
        return;
      }
      const restoredPlacement = restoredPlacements?.get(roomIds[index]) ?? null;
      let gridPosition = restoredPlacement ?? { x: 1 + index * 3, y: 1 };
      if (restoredPlacement === null && !createdAtRuntime) {
        const authoredPosition = sceneSettings.worldCenterToGrid(
          roomView.node.worldPosition,
          definition.width,
          definition.height,
        );
        if (authoredPosition === null) {
          error(`[BOOT] 无法把编辑器房间 ${roomIds[index]} 的位置转换为逻辑网格`);
          return;
        }
        gridPosition = authoredPosition;
      }

      const placement: RoomPlacement = restoredPlacement ?? {
        id: roomIds[index],
        ...gridPosition,
        width: definition.width,
        height: definition.height,
      };
      if (restoredPlacement === null) {
        const validation = gridModel.placeRoom(placement);
        if (validation.ok === false) {
          error(`[BOOT] 初始房间 ${placement.id} 放置失败: ${validation.code}`);
          return;
        }
      }

      roomView.bind(
        definition,
        placement,
        sceneSettings,
        (command: MoveRoomCommand) => gridModel.validateRoomMove(command),
        (command: MoveRoomCommand) => {
          const result = gridModel.moveRoom(command);
          if (result.ok) {
            this.saveLayout(gridModel);
          }
          return result;
        },
        (blocked: boolean) => cameraController.setPanBlocked(blocked),
      );
    }

    if (restoredPlacements === null) {
      this.saveLayout(gridModel);
    } else {
      log('[SAVE] 已从 localStorage 恢复 R0 飞船布局');
    }
  }

  private getSupportedRestoredPlacements(
    grid: ShipGridModel,
    definitionsByRoomId: ReadonlyMap<string, Readonly<RoomDefinition>>,
  ): ReadonlyMap<string, RoomPlacement> | null {
    const rooms = grid.getRooms();
    if (rooms.length !== definitionsByRoomId.size) {
      return null;
    }

    const placements = new Map<string, RoomPlacement>();
    for (const placement of rooms) {
      const definition = definitionsByRoomId.get(placement.id);
      if (
        definition === undefined ||
        placement.width !== definition.width ||
        placement.height !== definition.height
      ) {
        return null;
      }
      placements.set(placement.id, placement);
    }
    return placements;
  }

  private saveLayout(grid: ShipGridModel): void {
    const saved = savePrototypeLayout(grid);
    if (saved.ok === false) {
      error(`[SAVE] 原型布局保存失败：${saved.message}`);
    }
  }
}
