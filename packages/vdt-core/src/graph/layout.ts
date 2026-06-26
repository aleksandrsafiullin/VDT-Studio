import type { VdtGraph, VdtNode } from "../types";

export interface GraphLayoutOptions {
  margin?: number;
  cardWidth?: number;
  cardHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  /** @deprecated Use horizontalGap. Kept for older exported vdt-core callers. */
  xGap?: number;
  /** @deprecated Use verticalGap. Kept for older exported vdt-core callers. */
  yGap?: number;
  existingPositions?: ReadonlyMap<string, { x: number; y: number }>;
}

type ResolvedGraphLayoutOptions = Required<
  Pick<GraphLayoutOptions, "margin" | "cardWidth" | "cardHeight" | "horizontalGap" | "verticalGap">
> & {
  existingPositions?: ReadonlyMap<string, { x: number; y: number }>;
};

export interface GraphLayoutResult {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  cardWidth: number;
  cardHeight: number;
}

export const DEFAULT_CANVAS_LAYOUT: ResolvedGraphLayoutOptions = Object.freeze({
  margin: 48,
  cardWidth: 260,
  cardHeight: 132,
  horizontalGap: 220,
  verticalGap: 36
});

export const DEFAULT_SVG_LAYOUT: ResolvedGraphLayoutOptions = Object.freeze({
  margin: 48,
  cardWidth: 240,
  cardHeight: 120,
  horizontalGap: 180,
  verticalGap: 32
});

function byStableNodeOrder(nodesById: ReadonlyMap<string, VdtNode>, existing?: ReadonlyMap<string, { x: number; y: number }>) {
  return (a: string, b: string) => {
    const aPosition = existing?.get(a);
    const bPosition = existing?.get(b);
    if (aPosition && bPosition && aPosition.y !== bPosition.y) return aPosition.y - bPosition.y;
    if (aPosition && !bPosition) return -1;
    if (!aPosition && bPosition) return 1;
    const aNode = nodesById.get(a);
    const bNode = nodesById.get(b);
    return `${aNode?.name ?? ""}:${a}`.localeCompare(`${bNode?.name ?? ""}:${b}`);
  };
}

interface SubtreeLayout {
  positions: Map<string, { x: number; y: number }>;
  top: number;
  bottom: number;
}

function compareNodeOrder(nodesById: ReadonlyMap<string, VdtNode>) {
  return (a: string, b: string) => {
    const aNode = nodesById.get(a);
    const bNode = nodesById.get(b);
    return `${aNode?.name ?? ""}:${a}`.localeCompare(`${bNode?.name ?? ""}:${b}`);
  };
}

function orderSiblings(
  childIds: string[],
  nodesById: ReadonlyMap<string, VdtNode>,
  existing?: ReadonlyMap<string, { x: number; y: number }>
) {
  if (childIds.length <= 1) return [...childIds];
  const byName = compareNodeOrder(nodesById);

  if (!existing) return [...childIds].sort(byName);

  const positioned: string[] = [];
  const unpositioned: string[] = [];
  for (const childId of childIds) {
    if (existing.has(childId)) {
      positioned.push(childId);
    } else {
      unpositioned.push(childId);
    }
  }

  if (positioned.length === 0) return [...childIds].sort(byName);

  const positionedSorted = [...positioned].sort((a, b) => {
    const yDiff = existing.get(a)!.y - existing.get(b)!.y;
    return yDiff || byName(a, b);
  });

  return [...positionedSorted, ...unpositioned.sort(byName)];
}

function layoutSubtree(
  nodeId: string,
  depth: number,
  childrenBySource: ReadonlyMap<string, string[]>,
  nodesById: ReadonlyMap<string, VdtNode>,
  options: ResolvedGraphLayoutOptions,
  path: ReadonlySet<string>
): SubtreeLayout {
  const x = options.margin + depth * (options.cardWidth + options.horizontalGap);
  const nextPath = new Set(path);
  nextPath.add(nodeId);
  const childIds = orderSiblings(
    childrenBySource.get(nodeId) ?? [],
    nodesById,
    options.existingPositions
  ).filter((childId) => !nextPath.has(childId));

  if (childIds.length === 0) {
    return {
      positions: new Map([[nodeId, { x, y: 0 }]]),
      top: 0,
      bottom: options.cardHeight
    };
  }

  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  let childrenTop = Infinity;
  let childrenBottom = -Infinity;

  for (const childId of childIds) {
    const childLayout = layoutSubtree(childId, depth + 1, childrenBySource, nodesById, options, nextPath);
    const yOffset = cursor - childLayout.top;

    for (const [id, position] of childLayout.positions) {
      positions.set(id, { x: position.x, y: position.y + yOffset });
    }

    const shiftedTop = childLayout.top + yOffset;
    const shiftedBottom = childLayout.bottom + yOffset;
    childrenTop = Math.min(childrenTop, shiftedTop);
    childrenBottom = Math.max(childrenBottom, shiftedBottom);
    cursor = shiftedBottom + options.verticalGap;
  }

  if (childrenTop === Infinity) {
    return {
      positions: new Map([[nodeId, { x, y: 0 }]]),
      top: 0,
      bottom: options.cardHeight
    };
  }

  const y = (childrenTop + childrenBottom) / 2 - options.cardHeight / 2;
  positions.set(nodeId, { x, y });

  return {
    positions,
    top: Math.min(y, childrenTop),
    bottom: Math.max(y + options.cardHeight, childrenBottom)
  };
}

function resolveLayoutOptions(options: GraphLayoutOptions = {}): ResolvedGraphLayoutOptions {
  const resolved = {
    margin: options.margin ?? DEFAULT_CANVAS_LAYOUT.margin,
    cardWidth: options.cardWidth ?? DEFAULT_CANVAS_LAYOUT.cardWidth,
    cardHeight: options.cardHeight ?? DEFAULT_CANVAS_LAYOUT.cardHeight,
    horizontalGap: options.horizontalGap ?? options.xGap ?? DEFAULT_CANVAS_LAYOUT.horizontalGap,
    verticalGap: options.verticalGap ?? options.yGap ?? DEFAULT_CANVAS_LAYOUT.verticalGap
  };

  return options.existingPositions
    ? { ...resolved, existingPositions: options.existingPositions }
    : resolved;
}

export function layoutGraph(
  graph: VdtGraph,
  rootNodeId: string,
  options: GraphLayoutOptions = DEFAULT_CANVAS_LAYOUT
): GraphLayoutResult {
  const resolvedOptions = resolveLayoutOptions(options);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const childrenBySource = new Map<string, string[]>();

  for (const edge of graph.edges) {
    if (!nodesById.has(edge.sourceNodeId) || !nodesById.has(edge.targetNodeId)) continue;
    const children = childrenBySource.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childrenBySource.set(edge.sourceNodeId, children);
  }

  const rootLayout = nodesById.has(rootNodeId)
    ? layoutSubtree(rootNodeId, 0, childrenBySource, nodesById, resolvedOptions, new Set())
    : { positions: new Map<string, { x: number; y: number }>(), top: 0, bottom: 0 };
  const positions = new Map(rootLayout.positions);
  const sorter = byStableNodeOrder(nodesById, resolvedOptions.existingPositions);
  const unvisited = graph.nodes.filter((node) => !positions.has(node.id)).sort((a, b) => sorter(a.id, b.id));

  let cursor = positions.size > 0 ? rootLayout.bottom + resolvedOptions.verticalGap : 0;
  for (const node of unvisited) {
    positions.set(node.id, { x: resolvedOptions.margin, y: cursor });
    cursor += resolvedOptions.cardHeight + resolvedOptions.verticalGap;
  }

  let minY = Infinity;
  for (const position of positions.values()) {
    minY = Math.min(minY, position.y);
  }
  if (minY !== Infinity) {
    const yShift = resolvedOptions.margin - minY;
    for (const position of positions.values()) {
      position.y += yShift;
    }
  }

  let maxX = resolvedOptions.margin + resolvedOptions.cardWidth;
  let maxY = resolvedOptions.margin + resolvedOptions.cardHeight;
  for (const position of positions.values()) {
    maxX = Math.max(maxX, position.x + resolvedOptions.cardWidth + resolvedOptions.margin);
    maxY = Math.max(maxY, position.y + resolvedOptions.cardHeight + resolvedOptions.margin);
  }

  return {
    positions,
    width: maxX,
    height: maxY,
    cardWidth: resolvedOptions.cardWidth,
    cardHeight: resolvedOptions.cardHeight
  };
}
