import { AppleFoundationModelsTransport, type AppleCompletionRequest } from "@vdt-studio/local-runner/apple-foundation-models";
import { validateGraph, VdtBuilderSession, type VdtDecompositionPlan } from "@vdt-studio/vdt-core";
import { describe, expect, it } from "vitest";
import { boundedMeasuredFacts, guide, projectArguments, repairFormulaGuide, type AppleNativeStructuralGuide } from "./apple-native-structural-guide";

function draft() {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Output", rootKpi: "Output", unit: "t/h" });
  return builder;
}

const plan = {
  tool: "vdt.set_decomposition_plan",
  plan: { goal: "Represent the independent measures", nodes: [
    { nodeId: "first" }, { nodeId: "second" }
  ] }
};

async function expectNativeGuideAccepted(stage: AppleNativeStructuralGuide) {
  const variants = stage.names.map(name => {
    const payload = stage.payloads.get(name);
    return { kind: "object", fields: [
      { name: "tool", shape: { kind: "choice", choices: [name] } },
      ...(payload ? [{ ...payload, optional: false }] : [])
    ] } as const;
  });
  const schema: AppleCompletionRequest["schema"] = { kind: "object", fields: [
    { name: "sessionState", shape: { kind: "string" } },
    { name: "action", shape: variants.length === 1 ? variants[0]! : { kind: "union", variants } }
  ] };
  const transport = new AppleFoundationModelsTransport({ helperPath: "/unused", helperSha256: "0".repeat(64) });
  // Cancellation is checked after the real shape validator and before helper access.
  await expect(transport.complete({
    locale: "en-US", prompt: "Validate the structural guide.", maxOutputTokens: 100, timeoutMs: 100,
    expectedIdentity: { model: "SystemLanguageModel.default", osBuild: "Test", profile: "vdt-native-guided-v1", modelRevision: null },
    schema, signal: AbortSignal.abort()
  }, () => null)).rejects.toMatchObject({ code: "cancelled" });
}

describe("Apple native structural guide", () => {
  it("projects exact quoted measurements atomically before the model proposes a formula", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Output", rootKpi: "Output" });
    const { rootNodeId } = builder.getProject();
    const facts = [
      { value: 0, quote: "First station observed 0 units per hour", unit: "unit/h" },
      { value: 12, quote: "Second station observed 12 units per hour", unit: "unit/h" }
    ];
    const unitGuide = guide(builder.getProject(), facts)!;
    await expectNativeGuideAccepted(unitGuide);
    expect(unitGuide.phase).toBe("unit");
    const unit = projectArguments(unitGuide, "vdt.update_node", { tool: "vdt.update_node", unit: "unit/h" });
    expect(unit).toEqual({ nodeId: rootNodeId, patch: { unit: "unit/h" } });
    builder.updateNode({ nodeId: rootNodeId, patch: { unit: "unit/h" } });
    const planning = guide(builder.getProject(), facts)!;
    expect(planning.instruction).toContain("one for each quoted measurement");
    const projected = projectArguments(planning, plan.tool, plan);
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: projected.plan as VdtDecompositionPlan } });
    for (const name of ["first", "second"]) builder.addDriver({
      nodeId: name, name, parentNodeId: rootNodeId, unit: "unit/h", relation: "formula_dependency"
    });
    const filling = guide(builder.getProject(), facts)!;
    await expectNativeGuideAccepted(filling);
    expect(filling.names).toEqual(["vdt.fill_input_values_batch", "user.ask", "vdt.inspect_hierarchy"]);
    const tool = "vdt.fill_input_values_batch";
    const bindings = [{ nodeId: "second", quantityId: "q2" }, { nodeId: "first", quantityId: "q1" }];
    expect(projectArguments(filling, tool, { tool, bindings })).toEqual({
      values: [
        { nodeId: "second", value: 12, note: facts[1]!.quote, provenance: "user_provided_value" },
        { nodeId: "first", value: 0, note: facts[0]!.quote, provenance: "user_provided_value" }
      ]
    });
    for (const bad of [
      [bindings[0]], [{ nodeId: "output", quantityId: "q2" }, bindings[1]],
      [bindings[0], { ...bindings[1], quantityId: "q2" }],
      [bindings[0], { nodeId: "second", quantityId: "q1" }],
      [{ ...bindings[0], value: 999 }, bindings[1]],
      [bindings[0], { ...bindings[1], quantityId: "stale" }]
    ]) expect(() => projectArguments(filling, tool, { tool, bindings: bad })).toThrow();
    for (const [index, nodeId] of ["first", "second"].entries()) builder.updateNode({ nodeId, patch: {
      baselineValue: facts[index]!.value, value: facts[index]!.value,
      valueStatus: "user_provided_value", valueSource: { sourceTier: "user_input", note: facts[index]!.quote }
    } });
    expect(guide(builder.getProject(), facts)?.phase).toBe("formula");
    builder.setFormula({ nodeId: rootNodeId, formula: "first + second" });
    expect(guide(builder.getProject(), facts)?.phase).toBe("finish");
    expect(guide(builder.getProject(), [{ ...facts[0]!, value: 5 }, facts[1]!])).toBeUndefined();
  });

  it("preserves ordinary handling for unbounded and ambiguous measurement sets", () => {
    const facts = [{ value: 12, quote: "Measured 12 units", unit: "unit" }, { value: 8, quote: "Measured 8 units", unit: "unit" }];
    expect(boundedMeasuredFacts(facts)).toEqual(facts);
    expect(boundedMeasuredFacts([{ value: 2, quote: "there are two stations" }])).toEqual([]);
    expect(boundedMeasuredFacts(facts.slice(0, 1))).toBeUndefined();
    expect(boundedMeasuredFacts([facts[0]!, { ...facts[0]!, value: 5 }])).toBeUndefined();
    expect(boundedMeasuredFacts(Array.from({ length: 9 }, (_, value) => ({ value, quote: `Counted ${value} units` })))).toBeUndefined();
  });

  it("projects one existing tool at a time and retains the model's explicit blank inputs and formula", async () => {
    await expectNativeGuideAccepted(guide(new VdtBuilderSession().getProject())!);
    const builder = draft();
    const { rootNodeId } = builder.getProject();
    const planning = guide(builder.getProject())!;
    await expectNativeGuideAccepted(planning);
    expect(planning.names).toEqual(["vdt.set_decomposition_plan", "user.ask", "vdt.inspect_hierarchy"]);
    expect(projectArguments(planning, "vdt.inspect_hierarchy", { tool: "vdt.inspect_hierarchy" })).toEqual({});
    const projected = projectArguments(planning, plan.tool, plan);
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: projected.plan as VdtDecompositionPlan } });

    const adding = guide(builder.getProject())!;
    await expectNativeGuideAccepted(adding);
    expect(adding.names).toEqual(["vdt.add_drivers_batch", "user.ask"]);
    expect(adding.missingNodeIds).toEqual(["first", "second"]);
    const add = projectArguments(adding, "vdt.add_drivers_batch", { tool: "vdt.add_drivers_batch", drivers: [
      { nodeId: "first", name: "First", unit: "t/h" },
      { nodeId: "second", name: "Second", unit: "t/h" }
    ] });
    expect(add.drivers).toEqual([
      { nodeId: "first", name: "First", parentNodeId: rootNodeId, type: "input", unit: "t/h", relation: "formula_dependency" },
      { nodeId: "second", name: "Second", parentNodeId: rootNodeId, type: "input", unit: "t/h", relation: "formula_dependency" }
    ]);
    for (const driver of add.drivers as Parameters<typeof builder.addDriver>[0][]) builder.addDriver(driver);
    expect(builder.getProject().graph.nodes.filter(node => node.id !== rootNodeId)
      .map(({ id, value, baselineValue }) => ({ id, value, baselineValue }))).toEqual([
      { id: "first", value: undefined, baselineValue: undefined },
      { id: "second", value: undefined, baselineValue: undefined }
    ]);

    const formulating = guide(builder.getProject())!;
    await expectNativeGuideAccepted(formulating);
    expect(formulating.names).toEqual(["vdt.set_formula", "user.ask"]);
    const formula = projectArguments(formulating, "vdt.set_formula", { tool: "vdt.set_formula", formula: "first + second" });
    expect(formula).toEqual({ nodeId: rootNodeId, formula: "first + second" });
    expect(formulating.instruction).toContain("one plain root expression");
    expect(formulating.instruction).toContain('{"rootUnit":"t/h","operands":[{"id":"first","name":"First","unit":"t/h"},{"id":"second","name":"Second","unit":"t/h"}]}');
    expect(formulating.formulaProbe?.operands.map(({ unit }) => unit)).toEqual(["t/h", "t/h"]);
    expect(projectArguments(formulating, "vdt.set_formula", { tool: "vdt.set_formula", formula: "min(first, second)" }))
      .toEqual({ nodeId: rootNodeId, formula: "min(first, second)" });
    const repair = repairFormulaGuide(formulating, "MISSING_FORMULA_REFERENCES");
    expect(repair.names).toEqual(["vdt.set_formula"]);
    expect(repair.instruction).toContain("Replace missing references by copying the exact IDs");
    expect(repair.instruction).toContain('{"id":"first","name":"First","unit":"t/h"}');
    await expectNativeGuideAccepted(repair);
    expect(projectArguments(repair, "vdt.set_formula", { tool: "vdt.set_formula", formula: "first_capacity + second" }))
      .toEqual({ nodeId: rootNodeId, formula: "first_capacity + second" });
    expect(repairFormulaGuide(formulating, "FORMULA_PARSE_ERROR").instruction).toContain("formula parser diagnostic");
    expect(repairFormulaGuide(formulating, "OTHER_ERROR")).toBe(formulating);
    for (const wrapped of [
      "```\nfirst + second\n```",
      "```formula\r\nfirst + second\r\n```",
      `${rootNodeId} = first + second`
    ]) {
      expect(projectArguments(formulating, "vdt.set_formula", { tool: "vdt.set_formula", formula: wrapped })).toEqual(formula);
    }
    for (const ambiguous of [
      "other = first + second", "first + second because both contribute", "first + second; first - second",
      "```\nfirst + second\n```\n```\nfirst - second\n```",
      `${rootNodeId} = ${rootNodeId} = first + second`,
      "```\nfirst + second because both contribute\n```"
    ]) {
      expect(projectArguments(formulating, "vdt.set_formula", { tool: "vdt.set_formula", formula: ambiguous }))
        .toEqual({ nodeId: rootNodeId, formula: ambiguous });
    }
    if (typeof formula.nodeId !== "string" || typeof formula.formula !== "string") throw new Error("Invalid formula projection.");
    builder.setFormula({ nodeId: formula.nodeId, formula: formula.formula });
    const finishing = guide(builder.getProject())!;
    await expectNativeGuideAccepted(finishing);
    expect(finishing.names).toEqual(["run.request_finish"]);
    expect(finishing.payloads.size).toBe(0);
    expect(() => projectArguments(finishing, "user.ask", { tool: "user.ask" })).toThrow("Ineligible structural action.");
    expect(projectArguments(finishing, "run.request_finish", { tool: "run.request_finish" })).toEqual({});
  });

  it("preserves distinct count and per-item units for blank operands and a plain product", async () => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Total work", rootKpi: "Total work", unit: "h" });
    const { rootNodeId } = builder.getProject();
    const projected = projectArguments(guide(builder.getProject())!, plan.tool, plan);
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: projected.plan as VdtDecompositionPlan } });

    const adding = guide(builder.getProject())!;
    expect(adding.instruction).toContain("count multiplied by h/item yields h");
    const { drivers } = projectArguments(adding, "vdt.add_drivers_batch", { tool: "vdt.add_drivers_batch", drivers: [
      { nodeId: "first", name: "Quantity", unit: "count" },
      { nodeId: "second", name: "Time per item", unit: "h/item" }
    ] });
    for (const driver of drivers as Parameters<typeof builder.addDriver>[0][]) builder.addDriver(driver);

    const formulating = guide(builder.getProject())!;
    await expectNativeGuideAccepted(formulating);
    expect(formulating.names).toEqual(["vdt.set_formula", "user.ask"]);
    expect(formulating.instruction).toContain("Do not use braces");
    expect(formulating.instruction).toContain('{"rootUnit":"h","operands":[{"id":"first","name":"Quantity","unit":"count"},{"id":"second","name":"Time per item","unit":"h/item"}]}');
    expect(formulating.formulaProbe).toBeUndefined();
    const formula = projectArguments(formulating, "vdt.set_formula", { tool: "vdt.set_formula", formula: "first * second" });
    expect(formula).toEqual({ nodeId: rootNodeId, formula: "first * second" });
    builder.setFormula({ nodeId: rootNodeId, formula: "first * second" });
    const validation = validateGraph(builder.getProject());
    expect([...validation.errors, ...validation.warnings].filter(({ type }) => type === "unit_mismatch")).toEqual([]);
    builder.updateNode({ nodeId: "second", patch: { unit: "h" } });
    expect(validateGraph(builder.getProject()).errors).toContainEqual(expect.objectContaining({ type: "unit_mismatch", nodeId: rootNodeId }));
  });

  it.each(["ambiguous", "malformed no-space"])("leaves %s typed root evidence to shared readiness and repair", marker => {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Total work", rootKpi: "Total work", unit: "h" });
    const { rootNodeId } = builder.getProject();
    const projected = projectArguments(guide(builder.getProject())!, plan.tool, plan);
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: projected.plan as VdtDecompositionPlan } });
    for (const [nodeId, unit] of [["first", "count"], ["second", "h/item"]] as const) {
      builder.addDriver({ nodeId, name: nodeId, unit, parentNodeId: rootNodeId, relation: "formula_dependency" });
    }
    const note = [
      "Decomposition assumption: Multiply the number by time per item",
      "Reconsider if: The item changes",
      `Confirmed user source: ${JSON.stringify(["submitted-message", "Multiply the number by time per item."])}`,
      `Decomposition relationship v2: ${JSON.stringify({ kind: "quantity_rate", operandNodeIds: ["first", "second"],
        operandUnits: ["count", "h/item"], unit: "h" })}`
    ].join("\n");
    builder.updateNode({ nodeId: rootNodeId, patch: { assumptions: marker === "ambiguous"
      ? [note, note.replace("The item changes", "The period changes")]
      : [note.replace("relationship v2: ", "relationship v2:")] } });
    expect(guide(builder.getProject())).toBeUndefined();
    builder.setFormula({ nodeId: rootNodeId, formula: "first * second" });
    expect(guide(builder.getProject())).toBeUndefined();
  });

  it("projects only direct editable inputs and retains the general hierarchy escape", () => {
    const project = draft().getProject();
    const planning = guide(project)!;
    const { rootNodeId } = project;
    expect(planning.instruction).toContain("Derive the final output at the existing root");
    expect(planning.instruction).toContain("Do not add a node for the root or a duplicate of its output");
    const operands = [{ nodeId: "first" }, { nodeId: "second", rationale: "Measured independently" }];
    const root = { nodeId: rootNodeId };
    const projectPlan = (nodes: unknown[]) =>
      projectArguments(planning, plan.tool, { ...plan, plan: { ...plan.plan, nodes } });
    expect(projectPlan([root, ...operands])).toEqual({
      plan: { version: 1, goal: plan.plan.goal, nodes: operands.map(operand => ({
        ...operand, parentNodeId: rootNodeId, kind: "input"
      })) }
    });
    for (const invalid of [
      [root, operands[0]], [root, root, ...operands],
      [{ ...root, parentNodeId: "first" }, ...operands],
      [{ nodeId: "total_output", kind: "calculated" }, ...operands]
    ]) {
      expect(() => projectPlan(invalid)).toThrow();
    }
    expect(projectArguments(planning, "vdt.inspect_hierarchy", { tool: "vdt.inspect_hierarchy" })).toEqual({});
  });

  it("rejects hybrid actions, unplanned IDs and proposed values", () => {
    const builder = draft();
    const project = builder.getProject();
    const planning = guide(project)!;
    expect(() => projectArguments(planning, plan.tool, { ...plan, focusedQuestion: { question: "Which?", reason: "Scope" } })).toThrow();
    expect(() => projectArguments(planning, plan.tool, {
      ...plan, plan: { ...plan.plan, nodes: [{ nodeId: "first", kind: "input", sharedWith: ["second"] }] }
    })).toThrow();
    expect(() => projectArguments(planning, "run.request_finish", { tool: "run.request_finish" })).toThrow();

    project.graph.nodes[0]!.decompositionPlan = {
      version: 1, goal: "Output", nodes: ["first", "second"].map(nodeId => ({
        nodeId, parentNodeId: project.rootNodeId, kind: "input"
      }))
    };
    const adding = guide(project)!;
    const tool = "vdt.add_drivers_batch";
    expect(() => projectArguments(adding, tool, { tool, drivers: [{ nodeId: "first", name: "First" }, { nodeId: "forged", name: "Forged" }] })).toThrow();
    expect(() => projectArguments(adding, tool, { tool, drivers: [
      { nodeId: "first", name: "First", relation: "additive_component" }, { nodeId: "second", name: "Second" }
    ] })).toThrow();
    expect(() => projectArguments(adding, tool, { tool, drivers: [{ nodeId: "first", name: "First", baselineValue: 0 }, { nodeId: "second", name: "Second" }] })).toThrow();
    expect(() => projectArguments(adding, tool, { tool, drivers: [{ nodeId: "first", name: "First" }, { nodeId: "first", name: "Second" }] })).toThrow();
  });

  it("leaves complex or partially built plans to general construction", () => {
    const builder = draft();
    const project = builder.getProject();
    project.graph.nodes[0]!.decompositionPlan = {
      version: 1, goal: "Output", nodes: [
        { nodeId: "branch", parentNodeId: project.rootNodeId, kind: "calculated" },
        { nodeId: "input", parentNodeId: "branch", kind: "input" }
      ]
    };
    expect(guide(project)).toBeUndefined();
  });
});
