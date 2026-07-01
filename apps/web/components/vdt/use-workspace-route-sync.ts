"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useVdtStudioStore, type VdtWorkspaceState } from "./vdt-store";

interface BootstrapProjectWorkspaceRouteDeps {
  projectId: string;
  initialVdt?: string | undefined;
  refreshWorkspace: (options?: { scopedProjectId?: string | undefined }) => Promise<void>;
  selectWorkspaceProject: (projectId: string) => Promise<boolean>;
  selectWorkspaceVdt: (vdtId: string) => Promise<boolean>;
  closeWorkspaceVdtEditor: () => void;
  getWorkspace: () => VdtWorkspaceState;
}

export async function bootstrapProjectWorkspaceRoute(deps: BootstrapProjectWorkspaceRouteDeps) {
  await deps.refreshWorkspace({ scopedProjectId: deps.projectId });
  const workspace = deps.getWorkspace();
  const alreadyOnProject = workspace.activeProjectId === deps.projectId;

  if (!alreadyOnProject) {
    await deps.selectWorkspaceProject(deps.projectId);
  }

  const syncedWorkspace = deps.getWorkspace();
  if (deps.initialVdt) {
    if (syncedWorkspace.activeVdtId !== deps.initialVdt || syncedWorkspace.activePanel !== "vdt") {
      await deps.selectWorkspaceVdt(deps.initialVdt);
    }
    return;
  }

  deps.closeWorkspaceVdtEditor();
}

export function useWorkspaceRouteSync(projectId: string) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const vdtParam = searchParams.get("vdt") ?? undefined;
  const workspace = useVdtStudioStore((state) => state.workspace);
  const refreshWorkspace = useVdtStudioStore((state) => state.refreshWorkspace);
  const selectWorkspaceProject = useVdtStudioStore((state) => state.selectWorkspaceProject);
  const selectWorkspaceVdt = useVdtStudioStore((state) => state.selectWorkspaceVdt);
  const closeWorkspaceVdtEditor = useVdtStudioStore((state) => state.closeWorkspaceVdtEditor);
  const routeSyncRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    routeSyncRef.current = true;
    const initialVdt = searchParams.get("vdt") ?? undefined;

    void (async () => {
      await bootstrapProjectWorkspaceRoute({
        projectId,
        initialVdt,
        refreshWorkspace,
        selectWorkspaceProject,
        selectWorkspaceVdt,
        closeWorkspaceVdtEditor,
        getWorkspace: () => useVdtStudioStore.getState().workspace
      });
      if (!cancelled) {
        routeSyncRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  // Route bootstrap runs once per project; VDT param changes are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-fetching workspace on query-only navigation
  }, [closeWorkspaceVdtEditor, projectId, refreshWorkspace, selectWorkspaceProject, selectWorkspaceVdt]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (routeSyncRef.current) {
      return;
    }
    if (vdtParam) {
      if (workspace.activeVdtId !== vdtParam) {
        void selectWorkspaceVdt(vdtParam);
      }
      return;
    }
    if (workspace.activeVdtId) {
      closeWorkspaceVdtEditor();
    }
  }, [closeWorkspaceVdtEditor, selectWorkspaceVdt, vdtParam, workspace.activeVdtId]);

  useEffect(() => {
    if (routeSyncRef.current) {
      return;
    }
    const inEditor = workspace.activePanel === "vdt" && Boolean(workspace.activeVdtId);
    if (inEditor && workspace.activeVdtId !== vdtParam) {
      router.replace(`/projects/${projectId}?vdt=${encodeURIComponent(workspace.activeVdtId!)}`, { scroll: false });
      return;
    }
    if (!inEditor && vdtParam) {
      router.replace(`/projects/${projectId}`, { scroll: false });
    }
  }, [projectId, router, vdtParam, workspace.activePanel, workspace.activeVdtId]);

  const openWorkspaceVdt = useCallback(
    async (vdtId: string) => {
      routeSyncRef.current = true;
      await selectWorkspaceVdt(vdtId);
      router.push(`/projects/${projectId}?vdt=${encodeURIComponent(vdtId)}`);
      routeSyncRef.current = false;
    },
    [projectId, router, selectWorkspaceVdt]
  );

  const showProjectWorkspace = useCallback(() => {
    routeSyncRef.current = true;
    closeWorkspaceVdtEditor();
    router.push(`/projects/${projectId}`);
    routeSyncRef.current = false;
  }, [closeWorkspaceVdtEditor, projectId, router]);

  return { openWorkspaceVdt, showProjectWorkspace };
}
