import type { RoomDefinition } from './RoomDefinition.ts';
import type { RoomPlacement } from './ShipGridModel.ts';

export type NavigationNodeKind = 'EXIT' | 'STATION';

export interface NavigationNode {
  readonly id: string;
  readonly roomId: string;
  readonly kind: NavigationNodeKind;
  readonly stationIndex?: number;
}

export type NavigationPathResult =
  | { readonly ok: true; readonly nodeIds: readonly string[] }
  | { readonly ok: false; readonly message: string };

/**
 * 单层飞船导航图。节点只使用逻辑房间和站位 ID；像素坐标仅由表现层换算。
 * 当前图规模很小，A* 的启发值取 0 以保证任意房间尺寸下都不会高估路径。
 */
export class NavigationGraph {
  public readonly version: string;
  private readonly nodes = new Map<string, NavigationNode>();
  private readonly neighbors = new Map<string, readonly string[]>();
  private readonly roomPlacements = new Map<string, RoomPlacement>();
  private readonly pathCache = new Map<string, readonly string[]>();

  public constructor(
    placements: readonly RoomPlacement[],
    definitionsByRoomId: ReadonlyMap<string, Readonly<RoomDefinition>>,
  ) {
    const sorted = [...placements].sort((left, right) => left.id.localeCompare(right.id));
    if (sorted.length !== definitionsByRoomId.size) {
      throw new RangeError('导航图房间布局与定义数量不一致');
    }

    const mutableNeighbors = new Map<string, Set<string>>();
    for (const placement of sorted) {
      const definition = definitionsByRoomId.get(placement.id);
      if (definition === undefined) throw new RangeError(`导航图缺少房间定义：${placement.id}`);
      if (this.roomPlacements.has(placement.id)) throw new RangeError(`导航图房间 ID 重复：${placement.id}`);
      if (placement.width !== definition.width || placement.height !== definition.height) {
        throw new RangeError(`导航图房间尺寸不匹配：${placement.id}`);
      }
      this.roomPlacements.set(placement.id, { ...placement });
      this.addNode({ id: exitNodeId(placement.id), roomId: placement.id, kind: 'EXIT' }, mutableNeighbors);
      for (let stationIndex = 0; stationIndex < definition.crewCapacity; stationIndex += 1) {
        const station: NavigationNode = {
          id: stationNodeId(placement.id, stationIndex),
          roomId: placement.id,
          kind: 'STATION',
          stationIndex,
        };
        this.addNode(station, mutableNeighbors);
        connect(mutableNeighbors, station.id, exitNodeId(placement.id));
      }
    }

    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex];
        const right = sorted[rightIndex];
        if (shareSide(left, right)) connect(mutableNeighbors, exitNodeId(left.id), exitNodeId(right.id));
      }
    }

    for (const [nodeId, values] of mutableNeighbors) {
      this.neighbors.set(nodeId, Object.freeze(Array.from(values).sort((left, right) => left.localeCompare(right))));
    }
    this.version = sorted
      .map((room) => `${room.id}:${room.x},${room.y},${room.width},${room.height}:${definitionsByRoomId.get(room.id)?.crewCapacity ?? -1}`)
      .join('|');
  }

  public getNode(nodeId: string): Readonly<NavigationNode> | null {
    return this.nodes.get(nodeId) ?? null;
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

  public findPath(fromNodeId: string, toNodeId: string): NavigationPathResult {
    if (!this.nodes.has(fromNodeId) || !this.nodes.has(toNodeId)) {
      return { ok: false, message: '导航起点或终点不存在' };
    }
    if (fromNodeId === toNodeId) return { ok: true, nodeIds: Object.freeze([fromNodeId]) };
    const cacheKey = `${this.version}/${fromNodeId}/${toNodeId}`;
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
        const nextCost = currentCost + 1;
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

function connect(neighbors: Map<string, Set<string>>, left: string, right: string): void {
  neighbors.get(left)?.add(right);
  neighbors.get(right)?.add(left);
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
