"use client";

import { useDesktopLayout } from "@/lib/use-desktop-layout";
import { NodeInspector } from "./node-inspector";
import { ScenarioDrawer } from "./scenario-drawer";
import { SetupRail } from "./setup-rail";
import { TopBar } from "./top-bar";
import { VdtCanvas } from "./vdt-canvas";
import {
  BASE_LEFT_PANEL_WIDTH,
  BASE_RIGHT_PANEL_WIDTH,
  BASE_WORKSPACE_SECTION_MIN_HEIGHT,
  COLLAPSED_PANEL_WIDTH,
  scaledPanelWidth,
  useVdtStudioStore
} from "./vdt-store";

export function VdtStudioApp() {
  const ui = useVdtStudioStore((state) => state.ui);
  const isDesktop = useDesktopLayout();
  const leftCollapsed = isDesktop && ui.leftPanelCollapsed;
  const rightCollapsed = isDesktop && ui.rightPanelCollapsed;
  const leftWidth = leftCollapsed
    ? COLLAPSED_PANEL_WIDTH
    : scaledPanelWidth(BASE_LEFT_PANEL_WIDTH, ui.panelScale);
  const rightWidth = rightCollapsed
    ? COLLAPSED_PANEL_WIDTH
    : scaledPanelWidth(BASE_RIGHT_PANEL_WIDTH, ui.panelScale);
  return (
    <main
      className="flex min-h-screen flex-col bg-canvas text-ink lg:h-screen lg:overflow-hidden"
      style={{
        ["--vdt-font-scale" as string]: ui.fontScale,
        ["--vdt-left-panel" as string]: `${leftWidth}px`,
        ["--vdt-right-panel" as string]: `${rightWidth}px`
      }}
    >
      <TopBar />
      <div className="vdt-workspace-grid grid min-h-0 flex-1 grid-cols-1">
        <div className="min-h-0 lg:block">
          <SetupRail />
        </div>
        <section
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ minHeight: BASE_WORKSPACE_SECTION_MIN_HEIGHT }}
        >
          <VdtCanvas />
          <ScenarioDrawer />
        </section>
        <div className="min-h-0 lg:block">
          <NodeInspector />
        </div>
      </div>
    </main>
  );
}
