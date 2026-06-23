"use client";

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { VdtEdgeRelation } from "@vdt-studio/vdt-core";
import { getEdgeRelationIcon, VdtIcon } from "./vdt-icons";

export interface VdtEdgeData extends Record<string, unknown> {
  relation: VdtEdgeRelation;
  aiGenerated: boolean;
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
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd
}: EdgeProps) {
  const edgeData = data as VdtEdgeData | undefined;
  const relation = edgeData?.relation ?? "formula_dependency";
  const icon = getEdgeRelationIcon(relation);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  });

  const stroke = STROKE_BY_RELATION[relation] ?? "#6b7a90";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        style={{ ...style, stroke, strokeWidth: 1.5 }}
      />
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
    </>
  );
}
