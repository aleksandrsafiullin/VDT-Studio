"use client";

import { editorHandoffView, type EditorHandoffAttempt } from "@/lib/editor-handoff-controller";
import { useVdtStudioStore, type VdtStudioState } from "./vdt-store";
import { WorkspaceNavigationLink } from "./workspace-navigation-link";

export function ProjectWorkspaceHandoff({ projectId, vdtId, startHandoff }: { projectId: string; vdtId: string; startHandoff?: (() => EditorHandoffAttempt | undefined) | undefined }) {
  const matchesWorkspace = ({ workspace }: Pick<VdtStudioState, "workspace">) =>
    workspace.activePanel === "vdt" && workspace.activeProjectId === projectId && workspace.activeVdtId === vdtId
    && workspace.projectSummaries.some(({ project, vdts }) => project.id === projectId && vdts.some(({ vdt }) => vdt.id === vdtId));
  const isCurrent = useVdtStudioStore(matchesWorkspace);
  let cancelNavigation: (() => void) | undefined;
  let observeArrival: (() => void) | undefined;

  if (!isCurrent) return null;

  return (
    <WorkspaceNavigationLink
      href={`/projects/${encodeURIComponent(projectId)}`}
      isCurrent={() => matchesWorkspace(useVdtStudioStore.getState())}
      beforeNavigate={startHandoff ? () => {
        cancelNavigation?.();
        const attempt = startHandoff();
        if (!attempt) return false;
        const before = editorHandoffView(useVdtStudioStore.getState());
        cancelNavigation = attempt.cancel;
        observeArrival = () => {
          const stop = useVdtStudioStore.subscribe(state => {
            if (state.workspace.activePanel !== "project") return;
            if (attempt.complete(before, editorHandoffView(state), { kind: "workspace_opened", projectId })) {
              clearTimeout(timeout);
              stop();
            }
          });
          const timeout = setTimeout(() => { stop(); attempt.cancel(); }, 10_000);
          cancelNavigation = () => { clearTimeout(timeout); stop(); attempt.cancel(); };
        };
        return true;
      } : undefined}
      onNavigationDispatched={() => observeArrival?.()}
      onNavigationFailed={() => cancelNavigation?.()}
      className="inline-flex rounded-md border border-line px-3 py-2 text-xs font-medium text-ink hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      data-testid="chat-open-project-workspace"
    >
      Open project workspace
    </WorkspaceNavigationLink>
  );
}
