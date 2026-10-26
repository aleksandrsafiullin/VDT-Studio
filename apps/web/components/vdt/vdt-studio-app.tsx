"use client";

import { Suspense, useEffect } from "react";
import { clsx } from "clsx";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { NodeInspector } from "./node-inspector";
import { PanelResizeHandle } from "./panel-resize-handle";
import { ProjectManagementPanel } from "./project-management-panel";
import { ProjectVdtList } from "./project-vdt-list";
import { ProjectWorkspaceRouteState } from "./project-workspace-route-state";
import { SetupRail } from "./setup-rail";
import { TopBar } from "./top-bar";
import { useWorkspaceRouteSync } from "./use-workspace-route-sync";
import { VdtCanvas } from "./vdt-canvas";
import { WorkspaceModeRail } from "./workspace-mode-rail";
import styles from "./workspace-shell.module.css";
import { getScenarioHighlightColors } from "./scenario-highlight-color";
import {
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  hasActiveWorkspaceVdt,
  useVdtStudioStore
} from "./vdt-store";

const MODE_RAIL_WIDTH = 52;
const PROJECT_MANAGEMENT_PANEL_WIDTH = 360;

interface VdtStudioAppProps {
  projectId: string;
}

function VdtStudioAppContent({ projectId }: VdtStudioAppProps) {
  const ui = useVdtStudioStore((state) => state.ui);
  const highlightColors = getScenarioHighlightColors(ui.scenarioHighlightColor);
  const workspace = useVdtStudioStore((state) => state.workspace);
  const setPanelWidth = useVdtStudioStore((state) => state.setPanelWidth);
  const resumePersistedAgentRun = useVdtStudioStore((state) => state.resumePersistedAgentRun);
  const { openWorkspaceVdt, showProjectWorkspace, isBootstrapping, bootstrapError, retryWorkspace } = useWorkspaceRouteSync(projectId);
  const isDesktop = useDesktopLayout();
  const isProjectMode = workspace.activePanel === "project" || !hasActiveWorkspaceVdt(workspace);
  const leftCollapsed = !isProjectMode && isDesktop && ui.leftPanelCollapsed;
  const rightCollapsed = !isProjectMode && isDesktop && ui.rightPanelCollapsed;
  const leftWidth = isProjectMode ? PROJECT_MANAGEMENT_PANEL_WIDTH : leftCollapsed ? COLLAPSED_PANEL_WIDTH : ui.leftPanelWidth;
  const rightWidth = isProjectMode ? 0 : rightCollapsed ? COLLAPSED_PANEL_WIDTH : ui.rightPanelWidth;
  const leftHandleWidth = !isProjectMode && isDesktop && !leftCollapsed ? 6 : 0;
  const rightHandleWidth = !isProjectMode && isDesktop && !rightCollapsed ? 6 : 0;

  useEffect(() => {
    void resumePersistedAgentRun();
  }, [resumePersistedAgentRun]);

  if (isBootstrapping || bootstrapError) {
    return <ProjectWorkspaceRouteState error={bootstrapError} onRetry={retryWorkspace} />;
  }

  return (
    <main
      className={clsx(
        "flex min-h-screen flex-col text-ink lg:h-screen lg:overflow-hidden",
        "vdt-apple-workspace",
        isProjectMode ? "bg-apple-gray" : styles.shell
      )}
      style={{
        ["--vdt-font-scale" as string]: ui.fontScale,
        ["--vdt-scenario-highlight-fill" as string]: highlightColors.fill,
        ["--vdt-scenario-highlight-text" as string]: highlightColors.text,
        ["--vdt-scenario-highlight-border" as string]: highlightColors.border,
        ["--vdt-mode-rail" as string]: `${MODE_RAIL_WIDTH}px`,
        ["--vdt-left-panel" as string]: `${leftWidth}px`,
        ["--vdt-right-panel" as string]: `${rightWidth}px`,
        ["--vdt-left-handle" as string]: `${leftHandleWidth}px`,
        ["--vdt-right-handle" as string]: `${rightHandleWidth}px`
      }}
    >
      {isProjectMode ? (
        <div
          className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(47,111,237,0.08),transparent)]"
          aria-hidden="true"
        />
      ) : null}
      <TopBar projectId={projectId} onBackToWorkspace={showProjectWorkspace} />
      <div className={clsx("vdt-workspace-grid relative grid min-h-0 flex-1 grid-cols-1", isProjectMode ? "vdt-workspace-grid-project" : styles.editorGrid)}>
        <div className="min-h-0 lg:block">
          <WorkspaceModeRail appleStyle={isProjectMode} />
        </div>
        <div className="min-h-0 lg:block">
          {isProjectMode ? <ProjectManagementPanel urlScopedProjectId={projectId} /> : <SetupRail />}
        </div>
        {!isProjectMode && isDesktop && !leftCollapsed ? (
          <PanelResizeHandle
            side="left"
            currentWidth={ui.leftPanelWidth}
            testId="resize-left-panel"
            onResize={(width) => setPanelWidth("left", width)}
          />
        ) : !isProjectMode && isDesktop ? (
          <div className="hidden lg:block" aria-hidden />
        ) : null}
        <section
          className={clsx("flex min-h-0 flex-col overflow-hidden", !isProjectMode && styles.canvasFrame)}
          style={{ minHeight: isDesktop && !isProjectMode ? 0 : BASE_WORKSPACE_SECTION_MIN_HEIGHT }}
        >
          {isProjectMode ? <ProjectVdtList onOpenVdt={openWorkspaceVdt} /> : <VdtCanvas />}
        </section>
        {!isProjectMode && isDesktop && !rightCollapsed ? (
          <PanelResizeHandle
            side="right"
            currentWidth={ui.rightPanelWidth}
            testId="resize-right-panel"
            onResize={(width) => setPanelWidth("right", width)}
          />
        ) : !isProjectMode && isDesktop ? (
          <div className="hidden lg:block" aria-hidden />
        ) : null}
        {isProjectMode ? null : (
          <div className={clsx("min-h-0 lg:block", styles.inspectorSlot)}>
            <NodeInspector />
          </div>
        )}
      </div>
    </main>
  );
}

export function VdtStudioApp({ projectId }: VdtStudioAppProps) {
  return (
    <Suspense fallback={<ProjectWorkspaceRouteState />}>
      <VdtStudioAppContent projectId={projectId} />
    </Suspense>
  );
}
