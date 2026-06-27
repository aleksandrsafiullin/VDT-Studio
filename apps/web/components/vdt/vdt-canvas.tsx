"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid } from "lucide-react";
import {
  Background,
  Controls,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes
} from "@xyflow/react";
import { VdtRelationEdge, type VdtEdgeData } from "./vdt-edge";
import {
  calculateGraph,
  calculateScenarioGraph,
  DEFAULT_CANVAS_LAYOUT,
  getFormulaReferenceOrder,
  layoutGraph,
  percentageChange,
  resolveFormulaEdgeRelation
} from "@vdt-studio/vdt-core";
import { Button } from "@/components/ui/button";
import { KpiSpacingPopover } from "./kpi-spacing-popover";
import { VdtNodeCard, type VdtNodeCardData } from "./vdt-node-card";
import { collectExistingPositions } from "./layout-positions";
import { useVdtStudioStore } from "./vdt-store";

const nodeTypes: NodeTypes = {
  vdtNode: VdtNodeCard
};

const edgeTypes: EdgeTypes = {
  vdtEdge: VdtRelationEdge
};

export function VdtCanvas() {
  const project = useVdtStudioStore((state) => state.project);
  const highlightedNodeIds = useVdtStudioStore((state) => state.highlightedNodeIds);
  const kpiHorizontalGap = useVdtStudioStore((state) => state.ui.kpiHorizontalGap);
  const kpiVerticalGap = useVdtStudioStore((state) => state.ui.kpiVerticalGap);
  const selectNode = useVdtStudioStore((state) => state.selectNode);
  const autoDistributeLayout = useVdtStudioStore((state) => state.autoDistributeLayout);
  const updateNodePosition = useVdtStudioStore((state) => state.updateNodePosition);
  const calculation = useMemo(() => calculateGraph(project), [project]);
  const mainScenarioContext = useMemo(() => {
    const mainScenario = project.scenarios.find((scenario) => scenario.isMain === true);
    if (!mainScenario) {
      return undefined;
    }

    const scenarioResult = calculateScenarioGraph(project, mainScenario);
    if (Object.keys(scenarioResult.values).length === 0) {
      return undefined;
    }

    return {
      values: scenarioResult.values,
      rootEffect: {
        absoluteChange:
          calculation.rootValue !== undefined && scenarioResult.rootValue !== undefined
            ? scenarioResult.rootValue - calculation.rootValue
            : undefined,
        percentageChange: percentageChange(calculation.rootValue, scenarioResult.rootValue)
      }
    };
  }, [calculation.rootValue, project]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [flowCanRender, setFlowCanRender] = useState(false);

  const fallbackPositions = useMemo(() => {
    const existingPositions = collectExistingPositions(project.graph.nodes);
    return layoutGraph(project.graph, project.rootNodeId, {
      ...DEFAULT_CANVAS_LAYOUT,
      horizontalGap: kpiHorizontalGap,
      verticalGap: kpiVerticalGap,
      existingPositions
    }).positions;
  }, [kpiHorizontalGap, kpiVerticalGap, project.graph, project.rootNodeId]);

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
          mainScenarioValue: mainScenarioContext?.values[node.id],
          rootScenarioEffect:
            node.id === project.rootNodeId ? mainScenarioContext?.rootEffect : undefined,
          highlighted: highlightedSet.has(node.id),
          onSelect: selectNode
        }
      })),
    [calculation.values, fallbackPositions, highlightedSet, mainScenarioContext, project.graph.nodes, project.rootNodeId, selectNode]
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

  const nodeById = useMemo(
    () => new Map(project.graph.nodes.map((node) => [node.id, node])),
    [project.graph.nodes]
  );

  const edges: Edge<VdtEdgeData>[] = useMemo(() => {
    const formulaOrderCache = new Map<string, string[]>();

    return project.graph.edges.map((edge) => {
      const parentFormula = nodeById.get(edge.sourceNodeId)?.formula;
      const relation = resolveFormulaEdgeRelation(parentFormula, edge.targetNodeId, edge.relation);

      let previousOperandNodeId: string | undefined;
      if (relation !== "formula_dependency" && parentFormula?.trim()) {
        try {
          let order = formulaOrderCache.get(parentFormula);
          if (!order) {
            order = getFormulaReferenceOrder(parentFormula);
            formulaOrderCache.set(parentFormula, order);
          }
          const operandIndex = order.indexOf(edge.targetNodeId);
          if (operandIndex > 0) {
            previousOperandNodeId = order[operandIndex - 1];
          }
        } catch {
          // ignore invalid formulas; edge falls back to source/target midpoint
        }
      }

      return {
        id: edge.id,
        type: "vdtEdge",
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        data: {
          relation,
          aiGenerated: edge.aiGenerated,
          ...(previousOperandNodeId ? { previousOperandNodeId } : {})
        },
        animated: edge.aiGenerated
      };
    });
  }, [nodeById, project.graph.edges]);

  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }
    setNodes(storeNodes);
  }, [setNodes, storeNodes]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;

    const updateAvailability = () => {
      setFlowCanRender(element.clientWidth > 0 && element.clientHeight > 0);
    };

    updateAvailability();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateAvailability);
      return () => window.removeEventListener("resize", updateAvailability);
    }

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      setFlowCanRender(Boolean(size && size.width > 0 && size.height > 0));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={canvasRef}
      className="relative flex-1 min-h-0 w-full overflow-hidden bg-canvas"
      data-testid="vdt-canvas"
    >
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <Button
          size="sm"
          data-testid="auto-distribute-layout"
          icon={<LayoutGrid className="h-4 w-4" />}
          onClick={autoDistributeLayout}
        >
          Auto-distribute
        </Button>
        <KpiSpacingPopover />
      </div>
      {flowCanRender ? (
        <div className="absolute inset-0">
          <ReactFlow
            className="h-full w-full"
            style={{ height: "100%", width: "100%" }}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
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
      ) : null}
    </div>
  );
}
