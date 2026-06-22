"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { LayoutGrid } from "lucide-react";
import {
  Background,
  Controls,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeTypes
} from "@xyflow/react";
import { calculateGraph, DEFAULT_CANVAS_LAYOUT, layoutGraph } from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { VdtNodeCard, type VdtNodeCardData } from "./vdt-node-card";
import { collectExistingPositions } from "./layout-positions";
import { useVdtStudioStore } from "./vdt-store";

const nodeTypes: NodeTypes = {
  vdtNode: VdtNodeCard
};

export function VdtCanvas() {
  const project = useVdtStudioStore((state) => state.project);
  const highlightedNodeIds = useVdtStudioStore((state) => state.highlightedNodeIds);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const autoDistributeLayout = useVdtStudioStore((state) => state.autoDistributeLayout);
  const updateNodePosition = useVdtStudioStore((state) => state.updateNodePosition);
  const calculation = useMemo(() => calculateGraph(project), [project]);

  const fallbackPositions = useMemo(() => {
    const existingPositions = collectExistingPositions(project.graph.nodes);
    return layoutGraph(project.graph, project.rootNodeId, {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    }).positions;
  }, [project.graph, project.rootNodeId]);

  const highlightedSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);

  const storeNodes: Node<VdtNodeCardData, "vdtNode">[] = useMemo(
    () =>
      project.graph.nodes.map((node) => ({
        id: node.id,
        type: "vdtNode" as const,
        position: node.position ?? fallbackPositions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          node,
          value: calculation.values[node.id],
          highlighted: highlightedSet.has(node.id),
          onSelect: selectNode
        }
      })),
    [calculation.values, fallbackPositions, highlightedSet, project.graph.nodes, selectNode]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const isDraggingRef = useRef(false);

  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node<VdtNodeCardData>) => {
      updateNodePosition(node.id, node.position);
      isDraggingRef.current = false;
    },
    [updateNodePosition]
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

  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }
    setNodes(storeNodes);
  }, [setNodes, storeNodes]);

  return (
    <div className="relative h-full min-h-[360px] flex-1 overflow-hidden bg-canvas" data-testid="vdt-canvas">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <div className="rounded-md border border-line bg-white/95 px-3 py-2 text-xs text-muted shadow-sm backdrop-blur">
          Visual flow: root to drivers.
        </div>
        <Button
          size="sm"
          data-testid="auto-distribute-layout"
          icon={<LayoutGrid className="h-4 w-4" />}
          onClick={autoDistributeLayout}
        >
          Auto-distribute
        </Button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 46, y: 194, zoom: 0.68 }}
        minZoom={0.34}
        maxZoom={1.5}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => selectNode(node.id)}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable
        panOnScroll
      >
        <Background color="#d8dee8" gap={22} size={1} />
        <Controls position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
