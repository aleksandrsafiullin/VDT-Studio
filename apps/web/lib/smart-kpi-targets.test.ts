import { describe, expect, it } from "vitest";
import { createSmartKpiMeasuredFixture } from "../../../packages/vdt-core/src/suggestions/fixtures";
import { smartKpiTargetIds } from "./smart-kpi-targets";

describe("Suggested KPI target scope", () => {
  it("offers suggestions only for Input leaves, including sourced and unknown inputs", () => {
    const project = createSmartKpiMeasuredFixture();
    const base = project.graph.nodes[0]!;
    project.graph.nodes.push(
      { ...base, id: "measured", type: "input" },
      { ...base, id: "unknown", type: "input", baselineValue: undefined, valueStatus: "unknown" },
      { ...base, id: "calculated", type: "calculated" },
      { ...base, id: "mapped", type: "data_mapped" },
      { ...base, id: "assumption", type: "assumption" },
      { ...base, id: "rejected", type: "input", status: "rejected" },
      { ...base, id: "formula", type: "input", formula: "measured" }
    );
    project.graph.edges.push({ id: "root_measured", sourceNodeId: base.id, targetNodeId: "measured", relation: "formula_dependency", aiGenerated: false });
    expect([...smartKpiTargetIds(project)].sort()).toEqual(["measured", "unknown"]);
  });

  it.each(["formula_dependency", "contextual_influence"] as const)("excludes an Input with an incoming %s KPI, without excluding its leaf driver", relation => {
    const project = createSmartKpiMeasuredFixture(), base = project.graph.nodes[0]!;
    project.graph.nodes.push({ ...base, id: "parent", type: "input" }, { ...base, id: "driver", type: "input" });
    project.graph.edges.push({ id: "incoming", sourceNodeId: "parent", targetNodeId: "driver", relation, aiGenerated: false });
    expect([...smartKpiTargetIds(project)]).toEqual(["driver"]);
  });
});
