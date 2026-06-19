"use client";

import { useMemo } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes
} from "@xyflow/react";
import { calculateGraph, type VdtGraph } from "@vdt-studio/vdt-core";
import { VdtNodeCard, type VdtNodeCardData } from "./vdt-node-card";
import { useVdtStudioStore } from "./vdt-store";

const nodeTypes: NodeTypes = {
  vdtNode: VdtNodeCard
};

function layoutGraph(graph: VdtGraph, rootNodeId: string) {
  const childIdsByParent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    childIdsByParent.set(edge.sourceNodeId, [...(childIdsByParent.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
  }

  const depthByNode = new Map<string, number>([[rootNodeId, 0]]);
  const queue = [rootNodeId];

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentDepth = depthByNode.get(parentId) ?? 0;
    for (const childId of childIdsByParent.get(parentId) ?? []) {
      if (!depthByNode.has(childId)) {
        depthByNode.set(childId, parentDepth + 1);
        queue.push(childId);
      }
    }
  }

  const levels = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const depth = depthByNode.get(node.id) ?? 0;
    levels.set(depth, [...(levels.get(depth) ?? []), node.id]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, nodeIds] of levels.entries()) {
    const yOffset = -((nodeIds.length - 1) * 53);
    nodeIds.forEach((nodeId, index) => {
      positions.set(nodeId, {
        x: depth * 245,
        y: yOffset + index * 106
      });
    });
  }

  return positions;
}

export function VdtCanvas() {
  const project = useVdtStudioStore((state) => state.project);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const calculation = useMemo(() => calculateGraph(project), [project]);

  const positions = useMemo(() => layoutGraph(project.graph, project.rootNodeId), [project.graph, project.rootNodeId]);

  const nodes: Node<VdtNodeCardData, "vdtNode">[] = useMemo(
    () =>
      project.graph.nodes.map((node) => ({
        id: node.id,
        type: "vdtNode" as const,
        position: node.position ?? positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          node,
          value: calculation.values[node.id],
          onSelect: selectNode
        },
      })),
    [calculation.values, positions, project.graph.nodes, selectNode]
  );

  const edges: Edge[] = useMemo(
    () =>
      project.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label,
        type: "smoothstep",
        animated: edge.aiGenerated,
        style: {
          stroke: edge.relation === "subtractive_component" ? "#d97706" : "#6b7a90",
          strokeWidth: 1.5
        },
        labelStyle: {
          fill: "#667085",
          fontSize: 11,
          fontWeight: 600
        }
      })),
    [project.graph.edges]
  );

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden bg-canvas">
      <div className="absolute left-4 top-4 z-10 rounded-md border border-line bg-white/95 px-3 py-2 text-xs text-muted shadow-sm backdrop-blur">
        Visual flow: root to drivers.
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 46, y: 194, zoom: 0.68 }}
        minZoom={0.34}
        maxZoom={1.5}
        onNodeClick={(_, node) => selectNode(node.id)}
        nodesDraggable
        panOnScroll
      >
        <Background color="#d8dee8" gap={22} size={1} />
        <Controls position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
