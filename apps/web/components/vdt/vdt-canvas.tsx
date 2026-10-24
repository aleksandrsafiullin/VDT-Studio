"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ReactFlow,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
  type ReactFlowInstance
} from "@xyflow/react";
import { VdtRelationEdge, type VdtEdgeData } from "./vdt-edge";
import {
  calculateGraph,
  calculateScenarioGraph,
  DEFAULT_CANVAS_LAYOUT,
  getFormulaReferenceOrder,
  getDecompositionContextGroupIds,
  layoutGraph,
  percentageChange,
  resolveFormulaEdgeRelation
} from "@vdt-studio/vdt-core";
import { DataImportWizard } from "@/components/data-import/data-import-wizard";
import { requestIncomingKpisFromFile } from "@/components/data-import/import-context";
import { CanvasControls, CANVAS_ARIA_LABEL_CONFIG } from "./canvas-controls";
import { VdtNodeCard, type VdtNodeCardData } from "./vdt-node-card";
import { collectExistingPositions } from "./layout-positions";
import { useVdtStudioStore } from "./vdt-store";
import { useSmartKpi } from "./use-smart-kpi";
import { SmartKpiPanel } from "./smart-kpi-panel";
import { visibleSmartKpiTargets } from "./smart-kpi-geometry";
import { clsx } from "clsx";
import styles from "./workspace-shell.module.css";

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
  const requestIncomingKpisWithAi = useVdtStudioStore((state) => state.requestIncomingKpisWithAi);
  const selectedNodeId = useVdtStudioStore((state) => state.selectedNodeId);
  const smart = useSmartKpi();
  const flow = useRef<ReactFlowInstance<Node<VdtNodeCardData, "vdtNode">, Edge<VdtEdgeData>> | undefined>(undefined);
  const [viewportRevision, setViewportRevision] = useState(0);
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
  const referenceGroups = useMemo(() => getDecompositionContextGroupIds(project.graph, project.rootNodeId), [project.graph, project.rootNodeId]);

  const storeNodes: Node<VdtNodeCardData, "vdtNode">[] = useMemo(
    () =>
      project.graph.nodes.map((node) => ({
        id: node.id,
        type: "vdtNode" as const,
        position: node.position ?? fallbackPositions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          node,
          rootRole: node.id === project.rootNodeId,
          referenceGroup: referenceGroups.has(node.id),
          value: calculation.values[node.id],
          mainScenarioValue: mainScenarioContext?.values[node.id],
          rootScenarioEffect:
            node.id === project.rootNodeId ? mainScenarioContext?.rootEffect : undefined,
          highlighted: highlightedSet.has(node.id),
          onSelect: selectNode,
          onAddManualIncomingKpi: smart.activateManual,
          onAddAiIncomingKpis: (nodeId) => {
            smart.close();
            void requestIncomingKpisWithAi(nodeId);
          },
          onAddFileIncomingKpis: (nodeId) => { smart.close(); requestIncomingKpisFromFile(nodeId); },
          smartOpen: smart.active?.targetNodeId === node.id,
          onSmartActivate: smart.activate,
          onSmartLeave: smart.leaveRail,
          onSmartBlur: smart.blurPanel
        }
      })),
    [
      smart.activateManual,
      calculation.values,
      fallbackPositions,
      highlightedSet,
      mainScenarioContext,
      project.graph.nodes,
      project.rootNodeId,
      referenceGroups,
      requestIncomingKpisWithAi,
      selectNode,
      smart.active?.targetNodeId,
      smart.activate,
      smart.leaveRail,
      smart.blurPanel,
      smart.close
    ]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const isDraggingRef = useRef(false);
  const prepareVisible = useCallback(() => {
    const instance = flow.current, element = canvasRef.current;
    if (!instance || !element) return;
    smart.prewarmVisible(visibleSmartKpiTargets(instance.getNodes().map(node => {
      const internal = instance.getInternalNode(node.id);
      return { id: node.id, x: internal?.internals.positionAbsolute.x ?? node.position.x, y: internal?.internals.positionAbsolute.y ?? node.position.y,
        width: node.measured?.width ?? node.width ?? 238, height: node.measured?.height ?? node.height ?? 140 };
    }), instance.getViewport(), { width: element.clientWidth, height: element.clientHeight }, useVdtStudioStore.getState().selectedNodeId));
  }, [smart.prewarmVisible]);

  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: Node<VdtNodeCardData>) => {
      updateNodePosition(node.id, node.position);
      isDraggingRef.current = false;
      prepareVisible();
    },
    [updateNodePosition, prepareVisible]
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
    // Keep measured dimensions when only card actions/selection change. Losing
    // them briefly hides controlled nodes and disrupts hover and restored focus.
    setNodes(previous => {
      const measured = new Map(previous.map(node => [node.id, node.measured]));
      return storeNodes.map(node => { const size = measured.get(node.id); return size ? { ...node, measured: size } : node; });
    });
  }, [setNodes, storeNodes]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;

    const updateAvailability = () => {
      setFlowCanRender(element.clientWidth > 0 && element.clientHeight > 0);
      prepareVisible();
    };

    updateAvailability();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateAvailability);
      return () => window.removeEventListener("resize", updateAvailability);
    }

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      setFlowCanRender(Boolean(size && size.width > 0 && size.height > 0));
      prepareVisible();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [prepareVisible]);
  useEffect(() => {
    const frame = requestAnimationFrame(prepareVisible);
    return () => cancelAnimationFrame(frame);
  }, [prepareVisible, project.graph.nodes, selectedNodeId]);

  return (
    <div
      ref={canvasRef}
      className={clsx("relative flex-1 min-h-0 w-full overflow-hidden", styles.canvas)}
      data-testid="vdt-canvas"
    >
      <DataImportWizard />
      <SmartKpiPanel controller={smart} viewportRevision={viewportRevision} />
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
            onInit={instance => { flow.current = instance; requestAnimationFrame(prepareVisible); }}
            onMove={() => setViewportRevision(revision => revision + 1)}
            onMoveEnd={prepareVisible}
            nodesDraggable
            panOnScroll
            ariaLabelConfig={CANVAS_ARIA_LABEL_CONFIG}
          >
            <Background color="var(--workspace-line-soft)" gap={24} size={0.8} />
            <CanvasControls onAutoDistribute={autoDistributeLayout} />
          </ReactFlow>
        </div>
      ) : null}
    </div>
  );
}
