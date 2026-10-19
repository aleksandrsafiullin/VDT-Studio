import { expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { localModelWorkingContext } from "./local-model-context";

it("does not direct an agent to fill or delete a non-numerical reference container", () => {
  const b = new VdtBuilderSession(); b.createDraft({ rootKpi: "Output", projectTitle: "Reference context", unit: "t" });
  b.addDriver({ nodeId: "rate", parentNodeId: "output", name: "Rate", baselineValue: 2 }); b.setFormula({ nodeId: "output", formula: "rate * 3" });
  b.addDriver({ nodeId: "refs", parentNodeId: "output", name: "References", type: "external_factor", relation: "contextual_influence" });
  b.addDriver({ nodeId: "spec", parentNodeId: "refs", name: "Specification", baselineValue: 10, relation: "contextual_influence" });
  b.updateNode({ nodeId: "output", patch: { decompositionPlan: { version: 1, goal: "Production and references", nodes: [
    { nodeId: "rate", parentNodeId: "output", kind: "input" },
    { nodeId: "refs", parentNodeId: "output", kind: "context", rationale: "Group" },
    { nodeId: "spec", parentNodeId: "refs", kind: "context", rationale: "Reference" }
  ] } } });
  const context = localModelWorkingContext(b.getProject(), b.getRevision(), true, true);
  expect(context).toMatchObject({ projectReadyForFinish: true, referenceGroupIds: ["refs"], unresolvedInputs: { count: 0 }, formulaBacklog: { count: 0 }, calculation: { rootValue: 6, errorCount: 0 } });
});
