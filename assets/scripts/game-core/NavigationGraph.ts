import type { ConnectorPortDefinition } from './CsvGameConfig.ts';
import type { RoomDefinition } from './RoomDefinition.ts';
import type { RoomPlacement } from './ShipGridModel.ts';

export type NavigationNodeKind = 'EXIT' | 'STATION' | 'FLOOR' | 'CONNECTOR_STOP';

export interface NavigationNode {
  readonly id: string;
  readonly roomId: string | null;
  readonly kind: NavigationNodeKind;
  readonly stationIndex?: number;
  /** 连续逻辑格坐标；整数表示格子中心，表现层再换算为本地像素。 */
  readonly anchor: Readonly<{ readonly x: number; readonly y: number }>;
}

export interface NavigationFloor {
  readonly instanceId: string;
  readonly x: number;
  readonly y: number;
  readonly completed: boolean;
}

export interface NavigationConnectorInstance {
  readonly roomInstanceId: string;
  readonly definitionId: string;
  readonly ports: readonly ConnectorPortDefinition[];
  readonly completed: boolean;
}

export interface VoxelNavigationInput {
  readonly floors: readonly NavigationFloor[];
  readonly connectors: readonly NavigationConnectorInstance[];
}

export type NavigationPathResult =
  | { readonly ok: true; readonly nodeIds: readonly string[] }
  | { readonly ok: false; readonly message: string };

/**
 * 单舰确定性导航图。P8 体素模式只连接同层水平地板，并通过显式楼梯/电梯停靠口跨层；
 * 兼容构造路径仅供旧测试蓝图使用。像素坐标始终只由表现层换算。
 */
export class NavigationGraph {
  public readonly version: string;
  private readonly nodes = new Map<string, NavigationNode>();
  private readonly neighbors = new Map<string, readonly string[]>();
  private readonly edgeTravelTicks = new Map<string, number>();
  private readonly roomPlacements = new Map<string, RoomPlacement>();
  private readonly pathCache = new Map<string, readonly string[]>();

  public constructor(
    placements: readonly RoomPlacement[],
    definitionsByRoomId: ReadonlyMap<string, Readonly<RoomDefinition>>,
    voxel?: VoxelNavigationInput,
  ) {
    const sorted = [...placements].sort((left, right) => left.instanceId.localeCompare(right.instanceId));
    if (sorted.length !== definitionsByRoomId.size) {
      throw new RangeError('导航图房间布局与定义数量不一致');
    }

    const mutableNeighbors = new Map<string, Set<string>>();
    if (voxel !== undefined) {
      this.buildVoxelGraph(sorted, definitionsByRoomId, voxel, mutableNeighbors);
      for (const [nodeId, values] of mutableNeighbors) {
        this.neighbors.set(nodeId, Object.freeze(Array.from(values).sort((left, right) => left.localeCompare(right))));
      }
      this.version = createVoxelVersion(sorted, definitionsByRoomId, voxel);
      return;
    }
    for (const placement of sorted) {
      const definition = definitionsByRoomId.get(placement.instanceId);
      if (definition === undefined) throw new RangeError(`导航图缺少房间定义：${placement.instanceId}`);
      if (definition.id !== placement.definitionId) throw new RangeError(`导航图房间定义不匹配：${placement.instanceId}`);
      if (this.roomPlacements.has(placement.instanceId)) throw new RangeError(`导航图房间 ID 重复：${placement.instanceId}`);
      if (placement.width !== definition.width || placement.height !== definition.height) {
        throw new RangeError(`导航图房间尺寸不匹配：${placement.instanceId}`);
      }
      this.roomPlacements.set(placement.instanceId, { ...placement });
      this.addNode({
        id: exitNodeId(placement.instanceId), roomId: placement.instanceId, kind: 'EXIT',
        anchor: roomCenterAnchor(placement),
      }, mutableNeighbors);
      for (let stationIndex = 0; stationIndex < definition.crewCapacity; stationIndex += 1) {
        const station: NavigationNode = {
          id: stationNodeId(placement.instanceId, stationIndex),
          roomId: placement.instanceId,
          kind: 'STATION',
          stationIndex,
          anchor: stationAnchor(placement, definition.crewCapacity, stationIndex),
        };
        this.addNode(station, mutableNeighbors);
        connect(mutableNeighbors, station.id, exitNodeId(placement.instanceId));
      }
    }

    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex];
        const right = sorted[rightIndex];
        if (shareSide(left, right)) connect(mutableNeighbors, exitNodeId(left.instanceId), exitNodeId(right.instanceId));
      }
    }

    for (const [nodeId, values] of mutableNeighbors) {
      this.neighbors.set(nodeId, Object.freeze(Array.from(values).sort((left, right) => left.localeCompare(right))));
    }
    this.version = sorted
      .map((room) => `${room.instanceId}:${room.definitionId}:${room.x},${room.y},${room.width},${room.height}:${definitionsByRoomId.get(room.instanceId)?.crewCapacity ?? -1}`)
      .join('|');
  }

  /**
   * P8 体素导航：水平边只来自同层相邻地板，房间站位连接到底边支撑地板，跨层边只来自连接器停靠口。
   */
  private buildVoxelGraph(
    placements: readonly RoomPlacement[],
    definitionsByRoomId: ReadonlyMap<string, Readonly<RoomDefinition>>,
    voxel: VoxelNavigationInput,
    neighbors: Map<string, Set<string>>,
  ): void {
    const floors = [...voxel.floors].filter((floor) => floor.completed)
      .sort((left, right) => left.y - right.y || left.x - right.x || left.instanceId.localeCompare(right.instanceId));
    const floorCoordinates = new Map<string, string>();
    for (const floor of floors) {
      if (!Number.isInteger(floor.x) || !Number.isInteger(floor.y)) throw new RangeError(`地板坐标无效：${floor.instanceId}`);
      const coordinate = `${floor.x},${floor.y}`;
      if (floorCoordinates.has(coordinate)) throw new RangeError(`地板坐标重复：${coordinate}`);
      const nodeId = floorNodeId(floor.x, floor.y);
      floorCoordinates.set(coordinate, nodeId);
      this.addNode({ id: nodeId, roomId: null, kind: 'FLOOR', anchor: { x: floor.x, y: floor.y } }, neighbors);
    }
    for (const floor of floors) {
      const current = floorCoordinates.get(`${floor.x},${floor.y}`) as string;
      const right = floorCoordinates.get(`${floor.x + 1},${floor.y}`);
      if (right !== undefined) connect(neighbors, current, right);
    }

    for (const placement of placements) {
      const definition = definitionsByRoomId.get(placement.instanceId);
      if (definition === undefined || definition.id !== placement.definitionId) throw new RangeError(`导航图房间定义不匹配：${placement.instanceId}`);
      this.roomPlacements.set(placement.instanceId, { ...placement });
      if (definition.verticalConnectorKind !== 'NONE') continue;
      for (let stationIndex = 0; stationIndex < definition.crewCapacity; stationIndex += 1) {
        const station = stationNodeId(placement.instanceId, stationIndex);
        this.addNode({
          id: station, roomId: placement.instanceId, kind: 'STATION', stationIndex,
          anchor: stationAnchor(placement, definition.crewCapacity, stationIndex),
        }, neighbors);
        const supportX = placement.x + (stationIndex % placement.width);
        const support = floorCoordinates.get(`${supportX},${placement.y - 1}`);
        if (support === undefined) throw new RangeError(`房间缺少完整地板支撑：${placement.instanceId}/${supportX},${placement.y - 1}`);
        connect(neighbors, station, support);
      }
    }

    for (const connector of [...voxel.connectors].sort((left, right) => left.roomInstanceId.localeCompare(right.roomInstanceId))) {
      if (!connector.completed) continue;
      const placement = this.roomPlacements.get(connector.roomInstanceId);
      const definition = placement === undefined ? undefined : definitionsByRoomId.get(connector.roomInstanceId);
      if (placement === undefined || definition === undefined || definition.id !== connector.definitionId || definition.verticalConnectorKind === 'NONE') {
        throw new RangeError(`连接器实例无效：${connector.roomInstanceId}`);
      }
      const stops: Array<{ readonly nodeId: string; readonly travelTicks: number }> = [];
      for (const port of [...connector.ports].sort((left, right) => left.stopY - right.stopY || left.id.localeCompare(right.id))) {
        if (port.roomDefinitionId !== definition.id) throw new RangeError(`连接器停靠口定义不匹配：${port.id}`);
        const stop = connectorStopNodeId(connector.roomInstanceId, port.id);
        this.addNode({
          id: stop,
          roomId: connector.roomInstanceId,
          kind: 'CONNECTOR_STOP',
          anchor: { x: placement.x + (placement.width - 1) / 2, y: port.stopY },
        }, neighbors);
        const entryX = port.entrySide === 'LEFT' ? placement.x - 1 : placement.x + placement.width;
        const floor = floorCoordinates.get(`${entryX},${port.stopY}`);
        if (floor === undefined) throw new RangeError(`连接器停靠口缺少地板入口：${port.id}`);
        connect(neighbors, stop, floor);
        stops.push({ nodeId: stop, travelTicks: port.verticalMoveTicks });
      }
      for (let index = 1; index < stops.length; index += 1) {
        const travelTicks = Math.max(stops[index - 1].travelTicks, stops[index].travelTicks);
        connect(neighbors, stops[index - 1].nodeId, stops[index].nodeId, this.edgeTravelTicks, travelTicks);
      }
    }
  }

  public getNode(nodeId: string): Readonly<NavigationNode> | null {
    return this.nodes.get(nodeId) ?? null;
  }

  public getNodeAnchor(nodeId: string): Readonly<{ readonly x: number; readonly y: number }> | null {
    return this.nodes.get(nodeId)?.anchor ?? null;
  }

  public getRoomPlacement(roomId: string): Readonly<RoomPlacement> | null {
    return this.roomPlacements.get(roomId) ?? null;
  }

  public hasRoom(roomId: string): boolean {
    return this.roomPlacements.has(roomId);
  }

  public getRoomStationCount(roomId: string): number {
    let count = 0;
    while (this.nodes.has(stationNodeId(roomId, count))) count += 1;
    return count;
  }

  public areConnected(fromNodeId: string, toNodeId: string): boolean {
    return (this.neighbors.get(fromNodeId)?.indexOf(toNodeId) ?? -1) !== -1;
  }

  /** 普通边使用船员基础移动 Tick；连接器纵向边使用 CSV 声明的固定耗时。 */
  public getEdgeTravelTicks(fromNodeId: string, toNodeId: string, moveTicksPerEdge: number): number {
    if (!this.areConnected(fromNodeId, toNodeId)) return 0;
    const override = this.edgeTravelTicks.get(edgeKey(fromNodeId, toNodeId));
    return override ?? moveTicksPerEdge;
  }

  public findPath(fromNodeId: string, toNodeId: string, moveTicksPerEdge = 1): NavigationPathResult {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) {
      return { ok: false, message: '导航起点或终点不存在' };
    }
    if (fromNodeId === toNodeId) return { ok: true, nodeIds: Object.freeze([fromNodeId]) };
    if (!Number.isInteger(moveTicksPerEdge) || moveTicksPerEdge <= 0) {
      return { ok: false, message: '船员基础移动 Tick 无效' };
    }
    const cacheKey = `${this.version}/${moveTicksPerEdge}/${fromNodeId}/${toNodeId}`;
    const cached = this.pathCache.get(cacheKey);
    if (cached !== undefined) return { ok: true, nodeIds: cached };

    const open = new Set<string>([fromNodeId]);
    const previous = new Map<string, string>();
    const costs = new Map<string, number>([[fromNodeId, 0]]);
    while (open.size > 0) {
      const current = Array.from(open).sort((left, right) => {
        const costDelta = (costs.get(left) ?? Number.POSITIVE_INFINITY) - (costs.get(right) ?? Number.POSITIVE_INFINITY);
        return costDelta || left.localeCompare(right);
      })[0];
      open.delete(current);
      if (current === toNodeId) {
        const path = reconstructPath(previous, current);
        this.pathCache.set(cacheKey, path);
        return { ok: true, nodeIds: path };
      }
      const currentCost = costs.get(current) ?? Number.POSITIVE_INFINITY;
      for (const neighbor of this.neighbors.get(current) ?? []) {
        const nextCost = currentCost + this.getEdgeTravelTicks(current, neighbor, moveTicksPerEdge);
        if (nextCost >= (costs.get(neighbor) ?? Number.POSITIVE_INFINITY)) continue;
        costs.set(neighbor, nextCost);
        previous.set(neighbor, current);
        open.add(neighbor);
      }
    }
    return { ok: false, message: '目标房间不可达' };
  }

  private addNode(node: NavigationNode, neighbors: Map<string, Set<string>>): void {
    if (this.nodes.has(node.id)) throw new RangeError(`导航节点 ID 重复：${node.id}`);
    this.nodes.set(node.id, Object.freeze({ ...node }));
    neighbors.set(node.id, new Set());
  }
}

export function exitNodeId(roomId: string): string {
  return `room:${roomId}:exit`;
}

export function stationNodeId(roomId: string, stationIndex: number): string {
  return `room:${roomId}:station:${stationIndex}`;
}

export function floorNodeId(x: number, y: number): string {
  return `floor:${x}:${y}`;
}

export function connectorStopNodeId(roomInstanceId: string, portId: string): string {
  return `connector:${roomInstanceId}:${portId}`;
}

function connect(
  neighbors: Map<string, Set<string>>,
  left: string,
  right: string,
  edgeTravelTicks?: Map<string, number>,
  travelTicks?: number,
): void {
  neighbors.get(left)?.add(right);
  neighbors.get(right)?.add(left);
  if (edgeTravelTicks !== undefined && travelTicks !== undefined) {
    edgeTravelTicks.set(edgeKey(left, right), travelTicks);
  }
}

function edgeKey(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? `${left}|${right}` : `${right}|${left}`;
}

function roomCenterAnchor(room: RoomPlacement): Readonly<{ readonly x: number; readonly y: number }> {
  return Object.freeze({ x: room.x + (room.width - 1) / 2, y: room.y + (room.height - 1) / 2 });
}

function stationAnchor(
  room: RoomPlacement,
  stationCount: number,
  stationIndex: number,
): Readonly<{ readonly x: number; readonly y: number }> {
  const center = roomCenterAnchor(room);
  return Object.freeze({
    x: center.x + (stationIndex - (stationCount - 1) / 2) * 0.42,
    // 站位锚点是脚底：房间底边正好接触支撑地板的上边缘。
    y: room.y - 0.5,
  });
}

function createVoxelVersion(
  rooms: readonly RoomPlacement[],
  definitions: ReadonlyMap<string, Readonly<RoomDefinition>>,
  voxel: VoxelNavigationInput,
): string {
  const floorPart = [...voxel.floors].sort((left, right) => left.instanceId.localeCompare(right.instanceId))
    .map((floor) => `${floor.instanceId}:${floor.x},${floor.y}:${floor.completed ? 1 : 0}`).join('|');
  const roomPart = rooms.map((room) => `${room.instanceId}:${room.definitionId}:${room.x},${room.y},${room.width},${room.height}:${definitions.get(room.instanceId)?.crewCapacity ?? -1}`).join('|');
  const connectorPart = [...voxel.connectors].sort((left, right) => left.roomInstanceId.localeCompare(right.roomInstanceId))
    .map((connector) => `${connector.roomInstanceId}:${connector.completed ? 1 : 0}:${connector.ports.map((port) => `${port.id}@${port.stopY}:${port.entrySide}:${port.verticalMoveTicks}`).join(',')}`).join('|');
  return `floors=${floorPart};rooms=${roomPart};connectors=${connectorPart}`;
}

function shareSide(left: RoomPlacement, right: RoomPlacement): boolean {
  const verticalOverlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  const horizontalOverlap = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const touchesVertically = left.x + left.width === right.x || right.x + right.width === left.x;
  const touchesHorizontally = left.y + left.height === right.y || right.y + right.height === left.y;
  return (touchesVertically && verticalOverlap > 0) || (touchesHorizontally && horizontalOverlap > 0);
}

function reconstructPath(previous: ReadonlyMap<string, string>, target: string): readonly string[] {
  const path = [target];
  let cursor = target;
  while (previous.has(cursor)) {
    cursor = previous.get(cursor) as string;
    path.push(cursor);
  }
  path.reverse();
  return Object.freeze(path);
}
