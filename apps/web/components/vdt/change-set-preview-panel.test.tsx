import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { productionVolumeProject, type VdtChangeSet } from "@vdt-studio/vdt-core";
import { ChangeSetPreviewPanel } from "./change-set-preview-panel";

describe("ChangeSetPreviewPanel", () => {
  it("shows a calculated file baseline and unit for an incoming KPI", () => {
    const changeSet: VdtChangeSet = {
      id: "changeset_file_baseline",
      taskType: "analyze_raw_dataset",
      backendId: "data_harness",
      createdAt: "2026-08-10T00:00:00.000Z",
      additions: [{
        id: "add_repair",
        nodeId: "repair_downtime",
        parentNodeId: productionVolumeProject.rootNodeId,
        relation: "formula_dependency",
        name: "Repair",
        type: "data_mapped",
        unit: "hour",
        baselineValue: 2,
        valueStatus: "calculated"
      }],
      updates: [],
      deletions: [],
      edgeChanges: [],
      assumptions: [],
      questions: [],
      warnings: []
    };

    const html = renderToStaticMarkup(
      <ChangeSetPreviewPanel
        project={productionVolumeProject}
        changeSet={changeSet}
        selection={new Set(["add_repair"])}
        onToggle={vi.fn()}
        onApply={vi.fn()}
        onDiscard={vi.fn()}
      />
    );

    expect(html).toContain("Baseline: 2 hour");
  });
});
