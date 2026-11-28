"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { smartKpiTargetIds } from "@/lib/smart-kpi-targets";
import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";
import type { EditorHandoffAttempt } from "@/lib/editor-handoff-controller";
import type { SmartKpiController } from "./use-smart-kpi";

const REVIEW_EVENT = "vdt:review-suggested-kpis";

interface ReviewRequest {
  projectId: string;
  vdtId: string;
  nodeId: string;
  trigger: HTMLButtonElement;
  handoff?: EditorHandoffAttempt | undefined;
}

type ReviewState = Pick<VdtStudioState, "project" | "selectNode"> & {
  workspace: Pick<VdtStudioState["workspace"], "activeProjectId" | "activeVdtId">;
};

export function requestSuggestedKpiReview(target: EventTarget, request: ReviewRequest): boolean {
  return !target.dispatchEvent(new CustomEvent(REVIEW_EVENT, { detail: request, cancelable: true }));
}

export function listenForSuggestedKpiReview(
  target: EventTarget,
  getCanvas: () => HTMLElement | null,
  getState: () => ReviewState,
  openReview: SmartKpiController["openReview"]
) {
  const receive = (event: Event) => {
    const request = (event as CustomEvent<ReviewRequest>).detail;
    const { project, workspace, selectNode } = getState();
    if (!request || workspace.activeProjectId !== request.projectId || workspace.activeVdtId !== request.vdtId
      || !smartKpiTargetIds(project).has(request.nodeId)) return;
    const button = getCanvas()?.querySelector<HTMLButtonElement>(
      `.react-flow__node[data-id="${CSS.escape(request.nodeId)}"] [data-smart-trigger]`
    );
    const rail = button?.closest<HTMLElement>('[data-testid="node-incoming-actions"]');
    if (!button || !rail) return;
    selectNode(request.nodeId);
    if (request.handoff) openReview(request.nodeId, rail, button, request.trigger, request.handoff);
    else openReview(request.nodeId, rail, button, request.trigger);
    event.preventDefault();
  };
  target.addEventListener(REVIEW_EVENT, receive);
  return () => target.removeEventListener(REVIEW_EVENT, receive);
}

export function SuggestedKpiHandoffButton({ nodeId, startHandoff }: { nodeId: string; startHandoff?: (() => EditorHandoffAttempt | undefined) | undefined }) {
  const projectId = useVdtStudioStore(state => state.workspace.activeProjectId);
  const vdtId = useVdtStudioStore(state => state.workspace.activeVdtId);
  const [unavailable, setUnavailable] = useState(false);

  return (
    <div>
      <Button type="button" variant="secondary" size="sm" onClick={(event) => {
        const handoff = startHandoff?.();
        if (startHandoff && !handoff) return;
        const opened = projectId && vdtId && requestSuggestedKpiReview(window, { projectId, vdtId, nodeId, trigger: event.currentTarget, handoff });
        setUnavailable(!opened);
        if (!opened) handoff?.cancel();
      }}>
        Review Suggested KPIs
      </Button>
      {unavailable ? <p role="status" className="mt-1 text-xs text-muted">
        Suggestions are available when the requested KPI is an undecomposed input in the open VDT.
      </p> : null}
    </div>
  );
}
