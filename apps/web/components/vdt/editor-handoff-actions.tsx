"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { VdtAgentRunSnapshot } from "@/lib/agent-client";
import { FileImportHandoffButton } from "@/components/data-import/file-import-handoff-button";
import { Button } from "@/components/ui/button";
import { editorHandoffSchema, editorHandoffInstructions, type EditorHandoff } from "@/lib/editor-handoff";
import { editorHandoffController, editorHandoffView, matchingFileHandoffDraftReceipt } from "@/lib/editor-handoff-controller";
import { matchingSavedSmartHandoff, savedSmartHandoffHeadIsCurrent, type SmartKpiUndo } from "@/lib/smart-kpi-transaction";
import { useVdtStudioStore } from "./vdt-store";
import { ProjectWorkspaceHandoff } from "./project-workspace-handoff";
import { SuggestedKpiHandoffButton } from "./suggested-kpi-handoff";
import { openVdtExportMenu } from "./vdt-export-menu";

export function EditorHandoffActions({ run }: { run?: VdtAgentRunSnapshot | undefined }) {
  const projectId = useVdtStudioStore(state => state.workspace.activeProjectId);
  const vdtId = useVdtStudioStore(state => state.workspace.activeVdtId);
  if (!run || !projectId || !vdtId) return null;

  const actions = run.artifacts?.flatMap(({ id, type, runId, payload }) => {
    if (type !== "editor_handoff" || runId !== run.runId) return [];
    const parsed = editorHandoffSchema.safeParse(payload);
    if (!parsed.success || parsed.data.projectId !== projectId || parsed.data.vdtId !== vdtId) return [];
    return [{ id, data: parsed.data }];
  });
  if (!actions?.length) return null;

  return (
    <div className="flex flex-wrap gap-2" data-testid="agent-editor-handoffs">
      {actions.map(({ id, data }) => <HandoffAction key={id} id={id} runId={run.runId} handoff={data} />)}
    </div>
  );
}

function HandoffAction({ id, runId, handoff }: { id: string; runId: string; handoff: EditorHandoff }) {
  const status = useSyncExternalStore(editorHandoffController.subscribe, () => editorHandoffController.state(runId, id), () => undefined);
  const fileDraftReceipt = useVdtStudioStore(state => matchingFileHandoffDraftReceipt(state, { runId, id, handoff }));
  const savedSmart = useVdtStudioStore(state => matchingSavedSmartHandoff(state, runId, id, handoff));
  const [confirmedSmart, setConfirmedSmart] = useState<SmartKpiUndo>();
  useEffect(() => {
    let current = true;
    setConfirmedSmart(undefined);
    if (savedSmart) {
      const isStillCurrent = () => current && matchingSavedSmartHandoff(useVdtStudioStore.getState(), runId, id, handoff) === savedSmart;
      void savedSmartHandoffHeadIsCurrent(savedSmart, isStillCurrent).then(confirmed => {
        if (confirmed && isStillCurrent()) setConfirmedSmart(savedSmart);
      });
    }
    return () => { current = false; };
  }, [handoff, id, runId, savedSmart]);
  const [stale, setStale] = useState(false);
  const start = (targetNodeId?: string) => {
    const target = handoff.action === "file_import" && !handoff.nodeId && targetNodeId ? { ...handoff, nodeId: targetNodeId } : handoff;
    const attempt = editorHandoffController.start({ runId, id, handoff: target }, editorHandoffView(useVdtStudioStore.getState()));
    setStale(!attempt);
    return attempt;
  };
  if (fileDraftReceipt) return <p role="status" className="text-xs text-muted">The reviewed file mapping was applied to the draft.</p>;
  if (savedSmart && confirmedSmart === savedSmart) return <p role="status" className="text-xs text-muted">Suggested KPIs applied and saved.</p>;
  if (status && typeof status !== "string" && status.kind !== "file"
    && (status.kind !== "smart" || status.durability === "draft")) {
    const message = status.kind === "smart" ? "Suggested KPIs applied to the draft."
      : status.kind === "portable_download" ? `${status.format === "json" ? "JSON" : "Markdown"} download started.`
      : "Project workspace opened.";
    return <p role="status" className="text-xs text-muted">{message}</p>;
  }
  return <div className="space-y-1">
    {handoff.action === "suggested_kpis" ? <SuggestedKpiHandoffButton nodeId={handoff.nodeId} startHandoff={start} />
      : handoff.action === "file_import" ? <FileImportHandoffButton nodeId={handoff.nodeId} startHandoff={start} />
      : handoff.action === "vdt_export" ? <Button size="sm" variant="secondary" onClick={() => {
        const attempt = start();
        if (attempt && !openVdtExportMenu(attempt)) attempt.cancel();
      }}>Open VDT export formats</Button>
      : <ProjectWorkspaceHandoff projectId={handoff.projectId} vdtId={handoff.vdtId} startHandoff={start} />}
    <p role="status" className="text-xs text-muted">{stale ? "This control targets a different saved revision. Ask again from the current VDT."
      : status === "cancelled" ? "Cancelled. You can reopen this control." : editorHandoffInstructions[handoff.action]}</p>
  </div>;
}
