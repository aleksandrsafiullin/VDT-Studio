"use client";

import type { VdtAgentRunSnapshot } from "@/lib/agent-client";
import { FileImportHandoffButton } from "@/components/data-import/file-import-handoff-button";
import { Button } from "@/components/ui/button";
import { editorHandoffSchema } from "@/lib/editor-handoff";
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
      {actions.map(({ id, data }) => {
        switch (data.action) {
          case "suggested_kpis": return <SuggestedKpiHandoffButton key={id} nodeId={data.nodeId} />;
          case "file_import": return <FileImportHandoffButton key={id} nodeId={data.nodeId} />;
          case "vdt_export": return (
            <Button key={id} size="sm" variant="secondary" onClick={openVdtExportMenu}>
              Open VDT export formats
            </Button>
          );
          case "project_workspace": return <ProjectWorkspaceHandoff key={id} projectId={projectId} vdtId={vdtId} />;
        }
      })}
    </div>
  );
}
