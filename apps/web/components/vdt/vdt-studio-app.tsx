"use client";

import { NodeInspector } from "./node-inspector";
import { ScenarioDrawer } from "./scenario-drawer";
import { SetupRail } from "./setup-rail";
import { TopBar } from "./top-bar";
import { VdtCanvas } from "./vdt-canvas";

export function VdtStudioApp() {
  return (
    <main className="flex min-h-screen flex-col bg-canvas text-ink lg:h-screen lg:overflow-hidden">
      <TopBar />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_328px]">
        <div className="min-h-0 lg:block">
          <SetupRail />
        </div>
        <section className="flex min-h-[820px] flex-col overflow-hidden lg:min-h-0">
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
