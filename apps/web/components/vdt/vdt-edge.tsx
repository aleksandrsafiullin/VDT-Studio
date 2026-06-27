"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode
} from "@xyflow/react";
import type { VdtEdgeRelation } from "@vdt-studio/vdt-core";
import { getEdgeRelationIcon, VdtIcon } from "./vdt-icons";

export interface VdtEdgeData extends Record<string, unknown> {
  relation: VdtEdgeRelation;
  aiGenerated: boolean;
  previousOperandNodeId?: string;
}

function getNodeCenterY(node: InternalNode): number {
  const height = node.measured?.height ?? node.height ?? 0;
  return node.internals.positionAbsolute.y + height / 2;
}

const STROKE_BY_RELATION: Partial<Record<VdtEdgeRelation, string>> = {
  subtractive_component: "#d97706",
  negative_driver: "#d97706"
};

export function VdtRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  source,
  target,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd
}: EdgeProps) {
  const edgeData = data as VdtEdgeData | undefined;
  const relation = edgeData?.relation ?? "formula_dependency";
  const previousOperandNodeId = edgeData?.previousOperandNodeId;
  const icon = getEdgeRelationIcon(relation);
  const [edgePath, labelX] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const previousOperandNode = useInternalNode(previousOperandNodeId ?? "");
  const targetNode = useInternalNode(target);
  const previousCenterY = previousOperandNode ? getNodeCenterY(previousOperandNode) : null;
  const targetCenterY = targetNode ? getNodeCenterY(targetNode) : targetY;

  const labelY =
    previousCenterY !== null
      ? (previousCenterY + targetCenterY) / 2
      : (sourceY + targetY) / 2;

  const stroke = STROKE_BY_RELATION[relation] ?? "#6b7a90";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{ ...style, stroke, strokeWidth: 1.5 }}
      />
      {relation !== "formula_dependency" ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            <span
              className="inline-flex items-center justify-center rounded border border-line bg-white px-1.5 py-0.5 shadow-sm"
              title={icon.label}
              aria-label={icon.label}
            >
              <VdtIcon display={icon} variant="edge" />
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
