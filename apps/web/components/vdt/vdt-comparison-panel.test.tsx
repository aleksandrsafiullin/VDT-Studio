import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneProject, createVersionSnapshot, productionVolumeProject, type VdtProject } from "@vdt-studio/vdt-core";
import { VdtComparisonPanel } from "./vdt-comparison-panel";

describe("VdtComparisonPanel", () => {
  it("compares the active canvas with a saved snapshot and renders deterministic findings", () => {
    const snapshotted = createVersionSnapshot(cloneProject(productionVolumeProject), {
      name: "Before downtime change"
    });
    const current = lowerUnplannedDowntime(snapshotted);
    const html = renderToStaticMarkup(
      <VdtComparisonPanel
        project={current}
        defaultOpen
        defaultVersionId={snapshotted.versions[0]!.id}
      />
    );

    expect(html).toContain('data-testid="vdt-comparison-panel"');
    expect(html).toContain("Compare VDT snapshots");
    expect(html).toContain("Before downtime change");
    expect(html).toContain('data-testid="comparison-root-delta"');
    expect(html).toContain("Changed values");
    expect(html).toContain("unplanned_downtime");
    expect(html).toContain('data-testid="vdt-comparison-candidates"');
    expect(html).toContain("Unplanned Downtime");
  });

  it("shows an empty state when no baseline snapshot exists", () => {
    const html = renderToStaticMarkup(
      <VdtComparisonPanel project={cloneProject(productionVolumeProject)} defaultOpen />
    );

    expect(html).toContain("Apply an agent change-set preview to create a snapshot");
  });
});

function lowerUnplannedDowntime(project: VdtProject): VdtProject {
  return {
    ...project,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) =>
        node.id === "unplanned_downtime" ? { ...node, baselineValue: 60 } : node
      )
    }
  };
}
