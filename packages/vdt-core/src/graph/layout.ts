import type { VdtGraph } from "../types";

export interface LayoutOptions {
  cardWidth?: number;
  cardHeight?: number;
  xGap?: number;
  yGap?: number;
  margin?: number;
  existingPositions?: Map<string, { x: number; y: number }>;
  subtreePadding?: number;
}

export interface LayoutResult {
  cardWidth: number;
  cardHeight: number;
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

const DEFAULT_SUBTREE_PADDING = 12;

export type ResolvedCoreLayoutOptions = Required<
  Pick<LayoutOptions, "cardWidth" | "cardHeight" | "xGap" | "yGap" | "margin">
>;

export const DEFAULT_CANVAS_LAYOUT: ResolvedCoreLayoutOptions = {
  cardWidth: 238,
  cardHeight: 88,
  xGap: 300,
  yGap: 130,
  margin: 0
};

export const DEFAULT_SVG_LAYOUT: ResolvedCoreLayoutOptions = {
  cardWidth: 260,
  cardHeight: 118,
  xGap: 315,
  yGap: 156,
  margin: 48
};

type ResolvedLayoutOptions = ResolvedCoreLayoutOptions & {
  subtreePadding: number;
  existingPositions?: Map<string, { x: number; y: number }>;
};

interface SubtreeLayout {
  positions: Map<string, { x: number; y: number }>;
  top: number;
  bottom: number;
  height: number;
}

/**
 * Assigns left-to-right canvas positions from a root KPI through its driver tree.
 *
 * Depth is computed with BFS from `rootNodeId` along edges (source → target).
 * Each depth maps to a column: `x = margin + depth * xGap`, so deeper drivers sit
 * further to the right. Children of the same parent are stacked vertically in the
 * next column; sibling subtrees are packed by bounding-box height without
 * interleaving cousins from different branches.
 *
 * Nodes unreachable from `rootNodeId` fall back to depth 0 and are appended below
 * the rooted subtree rather than being omitted from the layout.
 */
export function layoutGraph(graph: VdtGraph, rootNodeId: string, options: LayoutOptions = {}): LayoutResult {
  const resolved: ResolvedLayoutOptions = {
    cardWidth: options.cardWidth ?? DEFAULT_CANVAS_LAYOUT.cardWidth,
    cardHeight: options.cardHeight ?? DEFAULT_CANVAS_LAYOUT.cardHeight,
    xGap: options.xGap ?? DEFAULT_CANVAS_LAYOUT.xGap,
    yGap: options.yGap ?? DEFAULT_CANVAS_LAYOUT.yGap,
    margin: options.margin ?? DEFAULT_CANVAS_LAYOUT.margin,
    subtreePadding: options.subtreePadding ?? DEFAULT_SUBTREE_PADDING,
    ...(options.existingPositions ? { existingPositions: options.existingPositions } : {})
  };

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const childrenByParent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    childrenByParent.set(edge.sourceNodeId, [...(childrenByParent.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }
  for (const childIds of childrenByParent.values()) {
    childIds.sort((a, b) => compareSiblingOrder(a, b, nodeById));
  }

  const depthByNode = new Map<string, number>([[rootNodeId, 0]]);
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentDepth = depthByNode.get(parentId) ?? 0;
    const childIds = childrenByParent.get(parentId) ?? [];
    for (const childId of childIds) {
      if (!depthByNode.has(childId)) {
        depthByNode.set(childId, parentDepth + 1);
        queue.push(childId);
      }
    }
  }

  const rootLayout = layoutSubtree(rootNodeId, 0, childrenByParent, resolved, nodeById, new Set());
  const positions = new Map(rootLayout.positions);

  const unpositioned = graph.nodes
    .filter((node) => !positions.has(node.id))
    .map((node) => node.id)
    .sort((a, b) => compareSiblingOrder(a, b, nodeById));

  if (unpositioned.length > 0) {
    let cursor = rootLayout.bottom + resolved.yGap;
    for (const nodeId of unpositioned) {
      positions.set(nodeId, {
        x: resolved.margin,
        y: cursor
      });
      cursor += resolved.cardHeight + resolved.yGap;
    }
  }

  let minY = Infinity;
  let maxY = -Infinity;
  let maxDepth = 0;
  for (const [nodeId, position] of positions) {
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y + resolved.cardHeight);
    maxDepth = Math.max(maxDepth, depthByNode.get(nodeId) ?? 0);
  }

  if (positions.size === 0) {
    minY = 0;
    maxY = resolved.cardHeight;
  }

  const yShift = resolved.margin - minY;
  for (const position of positions.values()) {
    position.y += yShift;
  }

  const treeHeight = maxY - minY;

  return {
    cardWidth: resolved.cardWidth,
    cardHeight: resolved.cardHeight,
    positions,
    width: resolved.margin * 2 + resolved.cardWidth + maxDepth * resolved.xGap,
    height: resolved.margin * 2 + treeHeight
  };
}

function layoutSubtree(
  nodeId: string,
  depth: number,
  childrenByParent: Map<string, string[]>,
  options: ResolvedLayoutOptions,
  nodeById: Map<string, { id: string; name: string }>,
  inPath: Set<string>
): SubtreeLayout {
  const { cardHeight, xGap, margin } = options;
  const siblingGap = siblingSubtreeGap(options);
  const x = margin + depth * xGap;
  const childIds = orderSiblings(childrenByParent.get(nodeId) ?? [], options.existingPositions, nodeById);

  if (childIds.length === 0) {
    const positions = new Map<string, { x: number; y: number }>([[nodeId, { x, y: 0 }]]);
    return {
      positions,
      top: 0,
      bottom: cardHeight,
      height: cardHeight
    };
  }

  const positions = new Map<string, { x: number; y: number }>();
  let cursor = 0;
  let childrenTop = Infinity;
  let childrenBottom = -Infinity;
  const nextPath = new Set(inPath);
  nextPath.add(nodeId);

  for (const childId of childIds) {
    if (nextPath.has(childId)) {
      continue;
    }

    const childLayout = layoutSubtree(childId, depth + 1, childrenByParent, options, nodeById, nextPath);
    const yOffset = cursor - childLayout.top;

    for (const [id, pos] of childLayout.positions) {
      positions.set(id, { x: pos.x, y: pos.y + yOffset });
    }

    const shiftedTop = childLayout.top + yOffset;
    const shiftedBottom = childLayout.bottom + yOffset;
    childrenTop = Math.min(childrenTop, shiftedTop);
    childrenBottom = Math.max(childrenBottom, shiftedBottom);

    cursor = shiftedBottom + siblingGap;
  }

  if (childrenTop === Infinity) {
    const leafPositions = new Map<string, { x: number; y: number }>([[nodeId, { x, y: 0 }]]);
    return {
      positions: leafPositions,
      top: 0,
      bottom: cardHeight,
      height: cardHeight
    };
  }

  const parentY = (childrenTop + childrenBottom) / 2 - cardHeight / 2;
  positions.set(nodeId, { x, y: parentY });

  const top = Math.min(parentY, childrenTop);
  const bottom = Math.max(parentY + cardHeight, childrenBottom);

  return {
    positions,
    top,
    bottom,
    height: bottom - top
  };
}

function siblingSubtreeGap(options: ResolvedLayoutOptions): number {
  return Math.max(options.yGap, options.cardHeight + options.subtreePadding);
}

/**
 * Orders sibling child ids before subtree packing.
 *
 * Mixed positioned/unpositioned: siblings with `existingPositions` entries are
 * sorted by stored `y` (tie-break name/id); siblings without positions are
 * appended after that group in stable name/id order.
 */
function orderSiblings(
  childIds: string[],
  existingPositions: Map<string, { x: number; y: number }> | undefined,
  nodeById: Map<string, { id: string; name: string }>
): string[] {
  if (childIds.length <= 1) {
    return [...childIds];
  }

  if (!existingPositions) {
    return [...childIds].sort((a, b) => compareSiblingOrder(a, b, nodeById));
  }

  const positioned: string[] = [];
  const unpositioned: string[] = [];
  for (const childId of childIds) {
    if (existingPositions.has(childId)) {
      positioned.push(childId);
    } else {
      unpositioned.push(childId);
    }
  }

  if (positioned.length === 0) {
    return [...childIds].sort((a, b) => compareSiblingOrder(a, b, nodeById));
  }

  const positionedSorted = [...positioned].sort((a, b) => {
    const yDiff = existingPositions.get(a)!.y - existingPositions.get(b)!.y;
    if (yDiff !== 0) {
      return yDiff;
    }
    return compareSiblingOrder(a, b, nodeById);
  });

  if (unpositioned.length === 0) {
    return positionedSorted;
  }

  const unpositionedSorted = [...unpositioned].sort((a, b) => compareSiblingOrder(a, b, nodeById));
  return [...positionedSorted, ...unpositionedSorted];
}

function compareSiblingOrder(
  a: string,
  b: string,
  nodeById: Map<string, { id: string; name: string }>
): number {
  const nameCompare = (nodeById.get(a)?.name ?? a).localeCompare(nodeById.get(b)?.name ?? b);
  if (nameCompare !== 0) {
    return nameCompare;
  }
  return a.localeCompare(b);
}
