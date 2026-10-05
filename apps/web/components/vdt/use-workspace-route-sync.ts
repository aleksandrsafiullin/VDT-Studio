"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVdtStudioStore, type VdtWorkspaceState } from "./vdt-store";

interface BootstrapProjectWorkspaceRouteDeps {
  projectId: string;
  initialVdt?: string | undefined;
  refreshWorkspace: (options?: { scopedProjectId?: string | undefined }) => Promise<void>;
  selectWorkspaceProject: (projectId: string) => Promise<boolean>;
  selectWorkspaceVdt: (vdtId: string, options?: { expectedProjectId?: string | undefined }) => Promise<boolean>;
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
      const selected = await deps.selectWorkspaceVdt(deps.initialVdt, { expectedProjectId: deps.projectId });
      if (!selected) {
        deps.closeWorkspaceVdtEditor();
      }
    }
    return;
  }

  deps.closeWorkspaceVdtEditor();
}

export function shouldCloseWorkspaceVdtEditorForRoute(
  previousVdtParam: string | undefined,
  nextVdtParam: string | undefined,
  activeVdtId: string | undefined
): boolean {
  return Boolean(previousVdtParam && !nextVdtParam && activeVdtId);
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
  const pendingNavigationRef = useRef<{ projectId: string; vdtId?: string | undefined } | undefined>(undefined);
  const previousVdtParamRef = useRef<string | undefined>(vdtParam);
  const [syncVersion, setSyncVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    routeSyncRef.current = true;
    pendingNavigationRef.current = undefined;
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
        setSyncVersion((version) => version + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
  // Route bootstrap runs once per project; VDT param changes are handled separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid re-fetching workspace on query-only navigation
  }, [closeWorkspaceVdtEditor, projectId, refreshWorkspace, selectWorkspaceProject, selectWorkspaceVdt]);

  useEffect(() => {
    if (routeSyncRef.current) {
      return;
    }

    const pendingNavigation = pendingNavigationRef.current;
    if (pendingNavigation?.projectId === projectId) {
      // Keep the store's navigation intent until Next.js commits the new query.
      // A different route chosen through history supersedes that intent.
      if (vdtParam !== pendingNavigation.vdtId && vdtParam === previousVdtParamRef.current) {
        return;
      }
      pendingNavigationRef.current = undefined;
    }

    const previousVdtParam = previousVdtParamRef.current;
    previousVdtParamRef.current = vdtParam;

    // Route changes take precedence over the workspace snapshot of this render.
    // Do not also write that snapshot back to the URL in the same effect pass.
    if (previousVdtParam !== vdtParam) {
      if (vdtParam) {
        if (workspace.activeVdtId !== vdtParam || workspace.activePanel !== "vdt") {
          routeSyncRef.current = true;
          void selectWorkspaceVdt(vdtParam, { expectedProjectId: projectId }).finally(() => {
            routeSyncRef.current = false;
            setSyncVersion((version) => version + 1);
          });
        }
      } else if (shouldCloseWorkspaceVdtEditorForRoute(previousVdtParam, vdtParam, workspace.activeVdtId)) {
        closeWorkspaceVdtEditor();
      }
      return;
    }

    const inEditor = workspace.activePanel === "vdt" && Boolean(workspace.activeVdtId);
    if (inEditor && workspace.activeVdtId !== vdtParam) {
      pendingNavigationRef.current = { projectId, vdtId: workspace.activeVdtId };
      router.replace(`/projects/${projectId}?vdt=${encodeURIComponent(workspace.activeVdtId!)}`, { scroll: false });
      return;
    }
    if (!inEditor && vdtParam) {
      pendingNavigationRef.current = { projectId };
      router.replace(`/projects/${projectId}`, { scroll: false });
    }
  }, [closeWorkspaceVdtEditor, projectId, router, selectWorkspaceVdt, syncVersion, vdtParam, workspace.activePanel, workspace.activeVdtId]);

  const openWorkspaceVdt = useCallback(
    async (vdtId: string) => {
      routeSyncRef.current = true;
      try {
        const selected = await selectWorkspaceVdt(vdtId, { expectedProjectId: projectId });
        if (selected) {
          pendingNavigationRef.current = { projectId, vdtId };
          router.push(`/projects/${projectId}?vdt=${encodeURIComponent(vdtId)}`);
        }
      } finally {
        routeSyncRef.current = false;
        setSyncVersion((version) => version + 1);
      }
    },
    [projectId, router, selectWorkspaceVdt]
  );

  const showProjectWorkspace = useCallback(() => {
    pendingNavigationRef.current = { projectId };
    closeWorkspaceVdtEditor();
    router.push(`/projects/${projectId}`);
  }, [closeWorkspaceVdtEditor, projectId, router]);

  return { openWorkspaceVdt, showProjectWorkspace };
}
