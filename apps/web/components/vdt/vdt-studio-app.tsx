"use client";

import { useEffect } from "react";
import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { NodeInspector } from "./node-inspector";
import { PanelResizeHandle } from "./panel-resize-handle";
import { ProjectManagementPanel } from "./project-management-panel";
import { ProjectVdtList } from "./project-vdt-list";
import { SetupRail } from "./setup-rail";
import { TopBar } from "./top-bar";
import { VdtCanvas } from "./vdt-canvas";
import { WorkspaceModeRail } from "./workspace-mode-rail";
import {
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  hasActiveWorkspaceVdt,
  useVdtStudioStore
} from "./vdt-store";

const MODE_RAIL_WIDTH = 52;
const PROJECT_MANAGEMENT_PANEL_WIDTH = 360;

export function VdtStudioApp() {
  const ui = useVdtStudioStore((state) => state.ui);
  const workspace = useVdtStudioStore((state) => state.workspace);
  const setPanelWidth = useVdtStudioStore((state) => state.setPanelWidth);
  const resumePersistedAgentRun = useVdtStudioStore((state) => state.resumePersistedAgentRun);
  const refreshWorkspace = useVdtStudioStore((state) => state.refreshWorkspace);
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

  useEffect(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  return (
    <main
      className="flex min-h-screen flex-col bg-canvas text-ink lg:h-screen lg:overflow-hidden"
      style={{
        ["--vdt-font-scale" as string]: ui.fontScale,
        ["--vdt-mode-rail" as string]: `${MODE_RAIL_WIDTH}px`,
        ["--vdt-left-panel" as string]: `${leftWidth}px`,
        ["--vdt-right-panel" as string]: `${rightWidth}px`,
        ["--vdt-left-handle" as string]: `${leftHandleWidth}px`,
        ["--vdt-right-handle" as string]: `${rightHandleWidth}px`
      }}
    >
      <TopBar />
      <div className={`vdt-workspace-grid grid min-h-0 flex-1 grid-cols-1 ${isProjectMode ? "vdt-workspace-grid-project" : ""}`}>
        <div className="min-h-0 lg:block">
          <WorkspaceModeRail />
        </div>
        <div className="min-h-0 lg:block">
          {isProjectMode ? <ProjectManagementPanel /> : <SetupRail />}
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
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ minHeight: BASE_WORKSPACE_SECTION_MIN_HEIGHT }}
        >
          {isProjectMode ? <ProjectVdtList /> : <VdtCanvas />}
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
          <div className="min-h-0 lg:block">
            <NodeInspector />
          </div>
        )}
      </div>
    </main>
  );
}
