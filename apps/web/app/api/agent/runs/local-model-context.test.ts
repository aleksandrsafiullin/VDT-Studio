import { describe, expect, it } from "vitest";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { compactLocalModelPrompt, compactOpenAiFirstPlanPrompt, localModelWorkingContext } from "./local-model-context";

describe("local model project inspection projection", () => {
  it("offers all current unfilled inputs in bounded native pages without assigning values", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Test", rootKpi: "Output", unit: "t" });
    for (let index = 0; index < 9; index += 1) builder.addDriver({ parentNodeId: builder.getProject().rootNodeId, nodeId: `input_${index}`, name: `Input ${index}` });
    const project = builder.getProject(); const before = JSON.stringify(project);
    const view = localModelWorkingContext(project, builder.getRevision(), true);
    expect(view.nativeInputBatch).toEqual({ schemaVersion: "values_by_node_id.v1", batches: [
      Array.from({ length: 8 }, (_, index) => `input_${index}`), ["input_8"]
    ] });
    expect(localModelWorkingContext(project, builder.getRevision())).not.toHaveProperty("nativeInputBatch");
    expect(JSON.stringify(project)).toBe(before);
  });

  it("reports transitive root inputs and disconnected inputs from formulas without treating graph placement as a dependency", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Test", rootKpi: "Output", unit: "t" });
    const root = builder.getProject().rootNodeId;
    builder.addDriver({ parentNodeId: root, nodeId: "capacity", name: "Capacity", type: "calculated", assumptions: ["Editable capacity estimate"] });
    builder.addDriver({ parentNodeId: "capacity", nodeId: "count", name: "Machines", baselineValue: 4 });
    builder.addDriver({ parentNodeId: root, nodeId: "unused", name: "Unconnected fact", baselineValue: 10, relation: "contextual_influence" });
    builder.setFormula({ nodeId: "capacity", formula: "count * 2" });
    builder.setFormula({ nodeId: root, formula: "capacity" });
    const project = builder.getProject();
    const before = JSON.stringify(project);
    const view = localModelWorkingContext(project, builder.getRevision(), true);
    expect(view).toMatchObject({ projectReadyForFinish: true, rootDependencyInputs: [{ id: "count", value: 4 }], unusedInputIds: ["unused"] });
    expect(view.calculationAssumptions.nodes).toEqual(expect.arrayContaining([{ id: "capacity", assumptions: ["Editable capacity estimate"], truncated: false }]));
    expect(JSON.stringify(project)).toBe(before);
  });

  it("does not mistake a finite placeholder constant for a completed new tree", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Test", rootKpi: "Output", unit: "t" });
    const root = builder.getProject().rootNodeId;
    builder.setFormula({ nodeId: root, formula: "0" });
    expect(localModelWorkingContext(builder.getProject(), builder.getRevision(), true)).toMatchObject({
      constructingTree: true, needsStructure: true, rootHasDriverReferences: false, projectReadyForFinish: false
    });
    builder.addDriver({ parentNodeId: root, nodeId: "volume", name: "Volume", baselineValue: 5 });
    builder.setFormula({ nodeId: root, formula: "volume * 2" });
    expect(localModelWorkingContext(builder.getProject(), builder.getRevision(), true)).toMatchObject({
      needsStructure: false, rootHasDriverReferences: true, projectReadyForFinish: true, calculation: { rootValue: 10 }
    });
  });

  it("refreshes confirmed IDs, formulas and zero values from the actual working draft without modifying it", () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Test", rootKpi: "Output", unit: "t" });
    const root = builder.getProject().rootNodeId;
    builder.addDriver({ parentNodeId: root, nodeId: "volume", name: "Volume", baselineValue: 0 });
    builder.setFormula({ nodeId: root, formula: "volume * 2" });
    const project = builder.getProject();
    const before = JSON.stringify(project);
    const view = localModelWorkingContext(project, builder.getRevision());
    expect(view).toMatchObject({ rootNodeId: root, nodeCount: 2, truncated: false, calculation: { rootValue: 0, errorCount: 0 } });
    expect(view.nodes[1]![0]).toBe("volume");
    expect(view.nodes[1]![view.nodeColumns.indexOf("baselineValue")]).toBe(0);
    expect(view.nodes[0]![view.nodeColumns.indexOf("formula")]).toBe("volume * 2");
    expect(JSON.stringify(project)).toBe(before);
    builder.addDriver({ parentNodeId: root, nodeId: "missing_input", name: "Unknown input", unit: "h" });
    builder.addDriver({ parentNodeId: root, nodeId: "missing_formula", name: "Unknown calculation", type: "calculated" });
    const next = localModelWorkingContext(builder.getProject(), builder.getRevision());
    expect(next.unresolvedInputs).toMatchObject({ count: 1, nodes: [{ id: "missing_input", name: "Unknown input", unit: "h" }] });
    expect(next.formulaBacklog).toMatchObject({ count: 1, nodes: [{ id: "missing_formula" }] });
  });

  it("keeps the brief and tool purposes while obtaining non-core argument schemas lazily", () => {
    const raw = { delta: { type: "initial_context", context: {
      brief: { goal: "Keep Excavation in tonnes", originalLanguage: "ru" }, toolCatalogHash: "immutable-hash",
      tools: [
        { name: "tools.describe", inputJsonSchema: { type: "object", properties: { toolNames: { type: "array" } } } },
        { name: "project.get_node", description: "Read a node", mutatesProject: false, inputJsonSchema: { type: "object", properties: { nodeId: { type: "string" } } } }
      ]
    } } };
    const projected = JSON.parse(compactLocalModelPrompt(JSON.stringify(raw)));
    expect(projected.delta.context.brief).toEqual(raw.delta.context.brief);
    expect(projected.delta.context.toolCatalogHash).toBe("immutable-hash");
    expect(projected.delta.context.tools[0]).toEqual({ name: "tools.describe", inputSchemaEnforcedBy: "native format" });
    expect(projected.delta.context.tools[1]).toEqual({ name: "project.get_node", description: "Read a node", inputSchemaAvailableVia: "tools.describe" });
    expect(raw.delta.context.tools[0]).toHaveProperty("inputJsonSchema");
    const old = { delta: { type: "initial_context", context: { tools: [raw.delta.context.tools[1]] } } };
    expect(JSON.parse(compactLocalModelPrompt(JSON.stringify(old)))).toEqual(old);
  });

  it("puts first-plan sources up front while preserving admitted tools, the selected Skill and result deltas", () => {
    const originalBrief = { prompt: "Calculate output from 120 items", selectedSkill: { id: "skill-1", version: "3", contentHash: "hash" } };
    const literalUserQuantities = [{ value: 120, quote: "120 items", unit: "items" }];
    const personalisation = { userInstructions: "Preserve the time period." };
    const availableTools = [{ name: "skill.read", inputJsonSchema: { type: "object", properties: { skillId: { type: "string" } } } }];
    const hostObservation = { rootNodeId: "root_kpi", nodeCount: 1, hasDecompositionPlan: false };
    const selectedNode = { id: "root_kpi", name: "Output" };
    const raw = { delta: { type: "initial_context", context: {
      brief: originalBrief, tools: [{ name: "unadmitted_tool", inputJsonSchema: { type: "object" } }],
      toolCatalogHash: "pinned-hash", selectedNode
    } }, originalBrief, personalisation, hostObservation, availableTools,
    confirmedKnowledge: { readSkills: [{ id: "skill-1", excerpt: "Verified text" }], literalUserQuantities } };
    const projected = JSON.parse(compactOpenAiFirstPlanPrompt(JSON.stringify(raw)));
    expect(Object.keys(projected).slice(0, 4)).toEqual(["originalBrief", "confirmedKnowledge", "personalisation", "hostObservation"]);
    expect(projected).toMatchObject({ originalBrief, personalisation, hostObservation, availableTools,
      confirmedKnowledge: raw.confirmedKnowledge, delta: { type: "initial_context", context: { selectedNode } } });
    expect(projected.delta.context).not.toHaveProperty("tools");
    expect(projected.delta.context).not.toHaveProperty("toolCatalogHash");
    expect(raw.delta.context.tools).toHaveLength(1);
    const delta = { type: "tool_results", results: [{ toolName: "vdt.set_decomposition_plan", resultCode: "INVALID_DECOMPOSITION_PLAN",
      payload: { error: { details: { calculatedNodesWithoutFactors: ["unfinished"] } } } }] };
    expect(JSON.parse(compactOpenAiFirstPlanPrompt(JSON.stringify({ ...raw, delta }))).delta).toEqual(delta);
  });

  it("reduces repeated keys while preserving every node/edge field, zero, formulas and receipt identity", () => {
    const project = {
      id: "project", rootNodeId: "node_0", nodeCount: 37, edgeCount: 36, truncated: false,
      nodes: Array.from({ length: 37 }, (_, index) => ({
        id: `node_${index}`, name: `Mining equipment driver ${index}`, type: index ? "input" : "root_kpi",
        unit: "t", status: "ai_suggested", childIds: index ? [] : ["node_1"],
        ...(index ? { baselineValue: index === 1 ? 0 : index } : { formula: "node_1 * node_2" })
      })),
      edges: Array.from({ length: 36 }, (_, index) => ({
        id: `edge_node_0_node_${index + 1}`, sourceNodeId: "node_0", targetNodeId: `node_${index + 1}`, relation: "positive_driver"
      }))
    };
    const result = { toolName: "project.get_current", resultHash: "original-hash", payload: { output: { project }, projectChanged: false } };
    const initial = { exchangeId: "exchange", sessionContinuation: { semanticState: "Preserve the mine goal" }, delta: { type: "tool_results", results: [result] } };
    const raw = JSON.stringify(initial);
    const compact = compactLocalModelPrompt(raw);
    expect(compact.length).toBeLessThan(raw.length * 0.8);
    const parsed = JSON.parse(compact);
    const projectedResult = parsed.delta.results[0];
    expect(projectedResult.resultHash).toBe("original-hash");
    expect(projectedResult.modelPayloadProjection).toBe("project-tables-v1");
    expect(parsed.sessionContinuation).toEqual(initial.sessionContinuation);
    const view = projectedResult.payload.output.project;
    const restore = (columns: string[], rows: unknown[][]) => rows.map((row) => Object.fromEntries(columns.map((key, index) => [key, row[index]]).filter(([, value]) => value !== null)));
    expect(restore(view.nodeColumns, view.nodes)).toEqual(project.nodes);
    expect(restore(view.edgeColumns, view.edges)).toEqual(project.edges);
    expect(view.truncated).toBe(false);
    expect(JSON.stringify(initial)).toBe(raw);
  });

  it("preserves queued human inputs, reconciliation and non-project feedback", () => {
    const input = { delta: { type: "checkpoint_inputs", inputs: [{ type: "user_instruction", text: "Keep my values" }], checkpointDelta: {
      type: "manual_reconciliation", results: [{ toolName: "vdt.set_formula", payload: { error: { code: "INVALID_TOOL_ARGS" } } }], reconciliation: { currentRevision: 9 }
    } } };
    expect(JSON.parse(compactLocalModelPrompt(JSON.stringify(input)))).toEqual(input);
    expect(compactLocalModelPrompt("ordinary user text")).toBe("ordinary user text");
  });
});
