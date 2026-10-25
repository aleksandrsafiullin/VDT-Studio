"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getViewportForBounds, useNodes, useReactFlow, ViewportPortal } from "@xyflow/react";
import { placeSmartKpiPreview } from "./smart-kpi-geometry";

/** A presentation-only layer in the graph's viewport, outside its node store. */
export function SmartKpiCanvasPreview({ targetNodeId, expanded, reveal, revealKey, children }: {
  targetNodeId: string;
  expanded: boolean;
  reveal: boolean;
  revealKey: string;
  children: ReactNode;
}) {
  const flow = useReactFlow();
  const nodes = useNodes();
  const content = useRef<HTMLDivElement>(null);
  const revealed = useRef("");
  const [measurement, setMeasurement] = useState({ height: 360, anchors: [] as number[], ready: false });
  const width = expanded ? 360 : 238;
  const targetBounds = useMemo(() => {
    const target = nodes.find(node => node.id === targetNodeId);
    return target ? { left: target.position.x, top: target.position.y, width: target.measured?.width ?? 238, height: target.measured?.height ?? 140 } : undefined;
  }, [nodes, targetNodeId]);
  const placement = useMemo(() => targetBounds ? placeSmartKpiPreview(targetBounds, { width, height: measurement.height },
    nodes.filter(node => node.id !== targetNodeId).map(node => ({ left: node.position.x, top: node.position.y, width: node.measured?.width ?? 238, height: node.measured?.height ?? 140 }))) : undefined,
  [nodes, targetNodeId, targetBounds, width, measurement.height]);

  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => {
      const zoom = flow.getViewport().zoom, rect = element.getBoundingClientRect();
      const anchors = [...element.querySelectorAll<HTMLElement>("[data-smart-kpi-card]")].map(card => {
        const bounds = card.getBoundingClientRect(); return Math.round((bounds.top + bounds.height / 2 - rect.top) / zoom * 100) / 100;
      });
      const height = element.offsetHeight;
      setMeasurement(before => before.ready && before.height === height && JSON.stringify(before.anchors) === JSON.stringify(anchors) ? before : { height, anchors, ready: true });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [flow, children]);

  useLayoutEffect(() => {
    if (!reveal || !placement || !targetBounds || !content.current || !measurement.ready || content.current.offsetHeight !== measurement.height) return;
    const key = `${targetNodeId}/${revealKey}/${expanded}`;
    if (revealed.current === key) return;
    revealed.current = key;
    const canvas = content.current.closest('[data-testid="vdt-canvas"]')?.getBoundingClientRect();
    if (!canvas) return;
    const viewport = flow.getViewport();
    const left = Math.min(targetBounds.left, placement.left), top = Math.min(targetBounds.top, placement.top);
    const right = Math.max(targetBounds.left + targetBounds.width, placement.left + placement.width);
    const bottom = Math.max(targetBounds.top + targetBounds.height, placement.top + placement.height);
    // Reveal once per source/expansion, only when necessary. Later user zoom
    // and pan remain under their control and never change saved positions.
    if (viewport.x + placement.left * viewport.zoom < 16 || viewport.x + right * viewport.zoom > canvas.width - 16 ||
      viewport.y + placement.top * viewport.zoom < 80 || viewport.y + bottom * viewport.zoom > canvas.height - 16) {
      const next = getViewportForBounds({ x: left - 24, y: top - 80, width: right - left + 48, height: bottom - top + 104 }, canvas.width, canvas.height, 0.34, viewport.zoom, 0.08);
      void flow.setViewport(next, { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180 });
    }
  }, [flow, placement, targetBounds, targetNodeId, reveal, revealKey, expanded, measurement.ready, measurement.height]);

  if (!placement || !targetBounds) return null;
  const sourceX = targetBounds.left + targetBounds.width, sourceY = targetBounds.top + targetBounds.height / 2;
  return <ViewportPortal>
    <svg aria-hidden="true" className="absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ pointerEvents: "none" }}>
      {measurement.anchors.map((anchor, index) => {
        const endX = placement.left, endY = placement.top + anchor, bendX = sourceX + (endX - sourceX) / 2;
        const path = `M ${sourceX} ${sourceY} C ${bendX} ${sourceY}, ${bendX} ${endY}, ${endX} ${endY}`;
        return <path key={index} d={path} fill="none" stroke="var(--workspace-line, #d4d4d8)" strokeWidth="1.5" strokeDasharray="4 5" />;
      })}
    </svg>
    <div ref={content} className="absolute nodrag nopan nowheel" style={{ left: placement.left, top: placement.top, width, pointerEvents: "all", zIndex: 40 }}>
      {children}
    </div>
  </ViewportPortal>;
}
