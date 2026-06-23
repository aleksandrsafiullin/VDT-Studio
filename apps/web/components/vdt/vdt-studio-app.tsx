"use client";

import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { NodeInspector } from "./node-inspector";
import { PanelResizeHandle } from "./panel-resize-handle";
import { ScenarioDrawer } from "./scenario-drawer";
import { SetupRail } from "./setup-rail";
import { TopBar } from "./top-bar";
import { VdtCanvas } from "./vdt-canvas";
import {
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  useVdtStudioStore
} from "./vdt-store";

export function VdtStudioApp() {
  const ui = useVdtStudioStore((state) => state.ui);
  const setPanelWidth = useVdtStudioStore((state) => state.setPanelWidth);
  const isDesktop = useDesktopLayout();
  const leftCollapsed = isDesktop && ui.leftPanelCollapsed;
  const rightCollapsed = isDesktop && ui.rightPanelCollapsed;
  const leftWidth = leftCollapsed ? COLLAPSED_PANEL_WIDTH : ui.leftPanelWidth;
  const rightWidth = rightCollapsed ? COLLAPSED_PANEL_WIDTH : ui.rightPanelWidth;
  const leftHandleWidth = isDesktop && !leftCollapsed ? 6 : 0;
  const rightHandleWidth = isDesktop && !rightCollapsed ? 6 : 0;

  return (
    <main
      className="flex min-h-screen flex-col bg-canvas text-ink lg:h-screen lg:overflow-hidden"
      style={{
        ["--vdt-font-scale" as string]: ui.fontScale,
        ["--vdt-left-panel" as string]: `${leftWidth}px`,
        ["--vdt-right-panel" as string]: `${rightWidth}px`,
        ["--vdt-left-handle" as string]: `${leftHandleWidth}px`,
        ["--vdt-right-handle" as string]: `${rightHandleWidth}px`
      }}
    >
      <TopBar />
      <div className="vdt-workspace-grid grid min-h-0 flex-1 grid-cols-1">
        <div className="min-h-0 lg:block">
          <SetupRail />
        </div>
        {isDesktop && !leftCollapsed ? (
          <PanelResizeHandle
            side="left"
            currentWidth={ui.leftPanelWidth}
            testId="resize-left-panel"
            onResize={(width) => setPanelWidth("left", width)}
          />
        ) : isDesktop ? (
          <div className="hidden lg:block" aria-hidden />
        ) : null}
        <section
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ minHeight: BASE_WORKSPACE_SECTION_MIN_HEIGHT }}
        >
          <VdtCanvas />
          <ScenarioDrawer />
        </section>
        {isDesktop && !rightCollapsed ? (
          <PanelResizeHandle
            side="right"
            currentWidth={ui.rightPanelWidth}
            testId="resize-right-panel"
            onResize={(width) => setPanelWidth("right", width)}
          />
        ) : isDesktop ? (
          <div className="hidden lg:block" aria-hidden />
        ) : null}
        <div className="min-h-0 lg:block">
          <NodeInspector />
        </div>
      </div>
    </main>
  );
}
