import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  buildKpiSuggestionContext, buildKpiSuggestionTaskInput, createSmartKpiMeasuredFixture,
  evaluateFormula, kpiSuggestionPromptInput, materializeKpiSuggestion, smartKpiInstruction
} from "@vdt-studio/vdt-core";
import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { runSuggestIncomingKpis } from "@vdt-studio/ai-harness";
import { loadDefaultSkillLibrary } from "@vdt-studio/vdt-agent";
import type { AppleNativePort } from "./apple-native-host";
import { appleSmartProposalDiagnostic, createAppleNativeSmartProvider } from "./apple-native-smart";

const selected = vi.hoisted(() => ({
  value: undefined as { pinned: AppleModelCapability; port: AppleNativePort } | undefined,
  verifySkill: vi.fn(async () => {})
}));
vi.mock("./apple-native-binding", () => ({ resolveAppleNativeTaskExecution: () => selected.value }));
vi.mock("./runtime", () => ({ agentExecutionBindingRegistry: {} }));
vi.mock("@/lib/smart-kpi-skill-host", () => ({ assertCurrentSmartKpiSkill: selected.verifySkill }));

it("compacts the Apple guide and prompt while retaining exact selected Skill, context and cancellation", async () => {
  const pinned: AppleModelCapability = {
    identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
    locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
  };
  const requests: AppleCompletionRequest[] = [];
  selected.value = { pinned, port: {
    discover: async () => pinned,
    async complete(request, validate) {
      requests.push(request);
      return { value: validate({ proposal: { kind: "empty", reason: "Unsupported source measurement." } }),
        context: { contextSize: 8192, inputTokens: 500, reservedOutputTokens: request.maxOutputTokens } };
    }
  } };
  const content = "# Service operations\nDefine event groups as complete, disjoint quantities.";
  const selectedSkill = { id: "custom.service_operations", title: "Service operations", version: 1,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`, content };
  const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(0), {
    workspaceId: "host-only-fixture", vdtId: null, targetNodeId: "measured_output",
    selectedSkill, period: { key: "2026-10", grain: "month" }
  });
  const input = buildKpiSuggestionTaskInput(context);
  const signal = new AbortController().signal;
  const result = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input, { signal });
  expect(result).toMatchObject({ status: "empty", groups: [] });
  expect(requests).toHaveLength(1);
  const request = requests[0]!;
  expect(request).toMatchObject({ expectedIdentity: pinned.identity, timeoutMs: 30_000, maxOutputTokens: 1_000 });
  expect(request.signal?.aborted).toBe(false);
  const legacyBytes = Buffer.byteLength(smartKpiInstruction("guided") + JSON.stringify(kpiSuggestionPromptInput(input)));
  expect(Buffer.byteLength(request.prompt)).toBeLessThan(legacyBytes * 0.75);
  const prompt = JSON.parse(request.prompt.split("\n").at(-1)!);
  expect(prompt.context).toMatchObject({ selectedSkill, target: context.target, period: context.period });
  expect(prompt.context).not.toHaveProperty("workspaceId");
  expect(prompt.responseContract.references).toMatchObject({ excludedTarget: input.responseContract.references.excludedTarget });
  const proposal = request.schema.fields[0]?.shape;
  expect(proposal).toMatchObject({ kind: "union", variants: [
    { kind: "object", fields: expect.arrayContaining([{ name: "kind", shape: { kind: "choice", choices: ["ready"] } }]) },
    { kind: "object", fields: expect.arrayContaining([{ name: "kind", shape: { kind: "choice", choices: ["empty"] } }]) },
    { kind: "object", fields: expect.arrayContaining([{ name: "kind", shape: { kind: "choice", choices: ["reduction"] } }]) }
  ] });
  if (proposal?.kind !== "union") throw new Error("Missing Smart proposal alternatives.");
  const [ready, empty, reduction] = proposal.variants;
  expect(ready?.fields.some(field => field.name === "recipeId")).toBe(input.responseContract.recipes.length > 0);
  expect(empty?.fields.some(field => field.name === "children" || field.name === "formula")).toBe(false);
  const children = ready?.fields.find(field => field.name === "children")?.shape;
  expect(children).toMatchObject({ kind: "array", maxItems: 20 });
  expect(children?.kind === "array" && children.element.kind === "object"
    && children.element.fields.some(field => field.name === "existingNodeId")).toBe(false);
  expect(reduction?.fields).toContainEqual(expect.objectContaining({
    name: "operation", shape: { kind: "choice", choices: ["sum", "min", "max"] }
  }));
  expect(reduction?.fields.some(field => field.name === "formula" || field.name === "recipeId")).toBe(false);
  const operands = reduction?.fields.find(field => field.name === "children")?.shape;
  expect(operands).toMatchObject({ kind: "array", maxItems: 16 });
  expect(operands?.kind === "array" && operands.element.kind === "object"
    && operands.element.fields.some(field => field.name === "key")).toBe(false);
  await runSuggestIncomingKpis(createAppleNativeSmartProvider({ timeoutMs: 18_000 }), input, { signal });
  expect(requests[1]).toMatchObject({ timeoutMs: 18_000 });
  expect(requests[1]?.signal?.aborted).toBe(false);
  await runSuggestIncomingKpis(createAppleNativeSmartProvider({ timeoutMs: 80_000 }), input, { signal });
  expect(requests[2]).toMatchObject({ timeoutMs: 30_000 });
  expect(requests[2]?.signal?.aborted).toBe(false);
});

it("classifies bounded canonical failures without retaining provider text", async () => {
  const pinned: AppleModelCapability = {
    identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture", modelRevision: null },
    locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
  };
  const children = [
    { key: "first", conceptKey: "primary_input", name: "First", unit: "t" },
    { key: "second", conceptKey: "secondary_input", name: "Second", unit: "t" }
  ];
  const cases = [
    [{ children, formula: "first + hidden_business_gap" }, "formula_references"],
    [{ children, formula: "first + second + 500" }, "formula_safety"],
    [{ children: [children[0], { ...children[1], conceptKey: "primary_input" }], formula: "first + second" }, "duplicate_factor"],
    [{ children: [{ ...children[0], key: "Not Canonical" }, children[1]], formula: "first + second" }, "factor_key"],
    [{ children, formula: "first + second", limitation: "x".repeat(301) }, "limitation"],
  ] as const;
  const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(0), {
    workspaceId: "validation", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" }
  });
  for (const [patch, expected] of cases) {
    let completions = 0;
    selected.value = { pinned, port: {
      discover: async () => pinned,
      async complete(_request, validate) {
        completions++;
        return { value: validate({ proposal: { kind: "ready", title: "Direct factors", rationale: "Review.", ...patch } }),
          context: { inputTokens: 100, contextSize: 8192, reservedOutputTokens: 1000 } };
      }
    } };
    const error = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), buildKpiSuggestionTaskInput(context))
      .catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "APPLE_SMART_CANONICAL_INVALID", message: "Apple Suggested KPI returned an invalid proposal." });
    expect(appleSmartProposalDiagnostic(error)).toBe(expected);
    expect(completions).toBe(expected === "duplicate_factor" || expected === "formula_references" ? 2 : 1);
  }
});

const retryPinned: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "retry fixture", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};
const retryChildren = [
  { key: "first", conceptKey: "first_admitted_input", name: "First", unit: "t" },
  { key: "second", conceptKey: "second_admitted_input", name: "Second", unit: "t" }
];
const validReady = { kind: "ready", title: "Factors", rationale: "Scoped proof.", formula: "first + second", children: retryChildren };
const rejectedReady = { ...validReady, children: [retryChildren[0], { ...retryChildren[1], conceptKey: "first_admitted_input",
  description: "redacted rejected provider text" }] };

async function retryInput(project = createSmartKpiMeasuredFixture(0)) {
  const content = "Use the stored measurement boundary.";
  return buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(project, {
    workspaceId: "shared_retry_scope", vdtId: "saved_retry_scope", targetNodeId: "measured_output",
    period: { key: "2026-10", grain: "month" },
    selectedSkill: { id: "fixture.skill", title: "Selected", version: 2, content,
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}` }
  }));
}

const reductionFactors = [
  { conceptKey: "first_source", name: "First source", unit: "t/month", description: "Measured lower bound." },
  { conceptKey: "second_source", name: "Second source", unit: "t/month" },
  { conceptKey: "third_source", name: "Third source", unit: "t/month" }
];
const reductionReady = { kind: "reduction", operation: "min", title: "Complete factors",
  rationale: "These independently measured factors share a unit basis.", children: reductionFactors };

function useProposal(proposal: unknown, correction = proposal) {
  const requests: AppleCompletionRequest[] = [];
  selected.value = { pinned: retryPinned, port: {
    discover: async () => retryPinned,
    async complete(request, validate) {
      requests.push(request);
      try {
        return { value: validate({ proposal: requests.length === 1 ? proposal : correction }), context: { inputTokens: 100, contextSize: 8192, reservedOutputTokens: 1000 } };
      } catch { throw new AppleTransportError("invalid_output"); }
    }
  } };
  return requests;
}

function materialize(output: unknown, context: Awaited<ReturnType<typeof retryInput>>["context"]) {
  return materializeKpiSuggestion(output, context, {
    proposalId: "encoded_smart", requestId: "encoded_smart", now: "2026-11-26T10:00:00.000Z",
    execution: { mode: "local_model", backendId: "apple_foundation_models", modelId: retryPinned.identity.model,
      bindingVersion: "fixture", credentialEpoch: "fixture" }
  })!;
}

it.each([
  ["sum", "p_1 + p_2 + p_3", 21], ["min", "min(p_1, p_2, p_3)", 3], ["max", "max(p_1, p_2, p_3)", 11]
] as const)("encodes the model's %s over every factor and preserves canonical materialization", async (operation, formula, expected) => {
  const input = await retryInput();
  const requests = useProposal({ ...reductionReady, operation });
  const result = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  const materialized = materialize(result, input.context);
  expect(materialized.groups[0]).toMatchObject({ formula, requiredKeys: ["p_1", "p_2", "p_3"],
    children: reductionFactors.map((factor, index) => ({ ...factor, key: `p_${index + 1}` })) });
  expect(materialized.groups[0]!.recipeBinding).toBeUndefined();
  expect(evaluateFormula(formula, { p_1: 7, p_2: 11, p_3: 3 })).toMatchObject({ value: expected, errors: [] });
  expect(requests).toHaveLength(1);
});

it.each([
  ["duplicate concept", { children: [reductionFactors[0], { ...reductionFactors[1], conceptKey: "first_source" }] }, "duplicate_factor", 2],
  ["duplicate normalized name", { children: [reductionFactors[0], { ...reductionFactors[1], name: "ＦＩＲＳＴ-source!" }] }, "duplicate_factor", 2],
  ["duplicate source ID", { children: reductionFactors.map(factor => ({ ...factor, existingNodeId: "same_source" })) }, "duplicate_factor", 2],
  ["foreign operation", { operation: "arbitrary_assembly" }, "reduction_operation", 1],
  ["foreign factor alias", { children: [{ ...reductionFactors[0], key: "forged" }, reductionFactors[1]] }, "factor_fields", 1],
  ["recipe fields", { recipeId: "production.time_rate" }, "ready_fields", 1],
  ["formula fields", { formula: "inserted" }, "ready_fields", 1],
  ["excess operands", { children: Array.from({ length: 17 }, () => reductionFactors[0]) }, "factor_count", 1]
] as const)("rejects a reduction with %s", async (_, patch, expected, attempts) => {
  const input = await retryInput();
  const requests = useProposal({ ...reductionReady, ...patch });
  const error = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input).catch((cause: unknown) => cause);
  expect(appleSmartProposalDiagnostic(error)).toBe(expected);
  expect(requests).toHaveLength(attempts);
});

it("preserves normal unit validation, custom expressions and exact audited recipe binding", async () => {
  const input = await retryInput();
  useProposal({ ...reductionReady, children: [reductionFactors[0], { ...reductionFactors[1], unit: "kg/month" }] });
  const mismatched = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(() => materialize(mismatched, input.context)).toThrow();

  const custom = { ...validReady, formula: "first - second",
    children: retryChildren.map(child => ({ ...child, unit: "t/month" })) };
  useProposal(custom);
  const expression = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(materialize(expression, input.context).groups[0]).toMatchObject({
    formula: custom.formula, requiredKeys: ["first", "second"]
  });

  const recipe = input.responseContract.recipes.find(item => item.id === "production.time_rate")!;
  expect(recipe).toBeDefined();
  const namedFactors = recipe.children.map(child => ({
    ...child, name: child.key === "working_time" ? "Effective working time" : "Average productivity"
  }));
  useProposal({ ...validReady, formula: recipe.formula, recipeId: recipe.id, children: namedFactors });
  const audited = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(materialize(audited, input.context).groups[0]).toMatchObject({
    formula: recipe.formula, children: namedFactors, recipeBinding: { recipeId: recipe.id, contextHash: input.context.contextHash }
  });
});

const serialDescription = "One continuous material stream goes through crushing and then screening. Each stage has an independently measured throughput capacity in tonnes per hour. The KPI is the throughput capacity of the combined line.";
const independentDescription = "The two stages produce independent, non-overlapping outputs. Both outputs count toward the total.";
const capacityChildren = [
  { key: "first", conceptKey: "stage_capacity_a", name: "Crushing capacity", unit: "t/h" },
  { key: "second", conceptKey: "stage_capacity_b", name: "Screening capacity", unit: "t/h" }
];
const additiveCapacity = { ...validReady, children: capacityChildren };
const serialCapacity = { ...additiveCapacity, formula: "min(second, first)" };

function relationshipInput(description?: string, businessContext?: string) {
  const project = createSmartKpiMeasuredFixture(0);
  const [target] = project.graph.nodes;
  target!.description = description;
  target!.unit = "t/h";
  if (businessContext) project.businessContext = businessContext;
  return retryInput(project);
}

it("offers a compact two-input minimum or empty for the measured serial fixture with the generic Skill", async () => {
  const project = createSmartKpiMeasuredFixture(70);
  const [target] = project.graph.nodes;
  Object.assign(target!, { id: "combined_production_capacity", name: "Combined production capacity",
    type: "input", unit: "t/h", description: serialDescription });
  project.rootNodeId = "serial_line_capacity_context";
  project.businessContext = serialDescription;
  project.graph.nodes.push({ id: project.rootNodeId, name: "Serial line capacity context", type: "root_kpi",
    status: "ai_suggested", unit: "t/h", formula: target!.id, aiGenerated: true,
    createdAt: project.createdAt, updatedAt: project.updatedAt });
  project.graph.edges.push({ id: "wrapper_capacity", sourceNodeId: project.rootNodeId, targetNodeId: target!.id, relation: "formula_dependency", aiGenerated: true });
  const bundled = (await loadDefaultSkillLibrary()).byId.get("generic.logical_kpi_decomposition")!;
  const selectedSkill = { id: bundled.id, title: bundled.title, version: 1,
    content: bundled.raw, contentHash: `sha256:${createHash("sha256").update(bundled.raw).digest("hex")}` };
  const context = await buildKpiSuggestionContext(project, {
    workspaceId: "smart_measured", vdtId: "smart_measured", targetNodeId: target!.id, selectedSkill,
    period: { key: "explicit:monthly", grain: "month" }
  });

  const children = capacityChildren.map(({ key: _key, ...child }) => child);
  const requests = useProposal({ ...reductionReady, children });
  await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({}), buildKpiSuggestionTaskInput(context)))
    .resolves.toMatchObject({ status: "ready", groups: [{ formula: "min(p_1, p_2)", children }] });
  expect(requests).toHaveLength(1);
  const { prompt, schema } = requests[0]!;
  expect(prompt).toContain("two distinct measurable stage capacities on the target's exact unit basis");
  expect(prompt).toContain("Leave both values blank");
  expect(prompt).toContain("The disjoint-output requirement applies to sums");
  expect(prompt).not.toContain("Keep the remaining causes complete, disjoint");
  expect(JSON.parse(prompt.split("\n").at(-1)!).context.selectedSkill).toEqual(selectedSkill);
  expect(schema.fields[0]?.shape).toMatchObject({ kind: "union", variants: [
    { fields: expect.arrayContaining([
      { name: "kind", shape: { kind: "choice", choices: ["reduction"] } },
      expect.objectContaining({ name: "operation", shape: { kind: "choice", choices: ["min"] } }),
      expect.objectContaining({ name: "children", shape: expect.objectContaining({ maxItems: 2 }) })
    ]) },
    { fields: expect.arrayContaining([{ name: "kind", shape: { kind: "choice", choices: ["empty"] } }]) }
  ] });

  const noDraft = useProposal({ kind: "empty", reason: "A distinct stage measurement cannot be identified." });
  await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({}), buildKpiSuggestionTaskInput(context)))
    .resolves.toMatchObject({ status: "empty", groups: [] });
  expect(noDraft).toHaveLength(1);
  expect(noDraft[0]!.schema).toEqual(schema);
});

it("retains the general guide and applicable recipe contract for a pinned authored Skill", async () => {
  const input = await relationshipInput(serialDescription);
  expect(input.context.selectedSkill?.id).toBe("fixture.skill");
  expect(input.responseContract.recipes.length).toBeGreaterThan(0);
  const requests = useProposal({ kind: "empty", reason: "The selected Skill lacks the needed inputs." });
  await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input)).resolves.toMatchObject({ status: "empty", groups: [] });
  expect(requests).toHaveLength(1);
  const { schema, prompt } = requests[0]!;
  expect(schema.fields[0]?.shape).toMatchObject({ kind: "union", variants: [{}, {}, {}] });
  expect(JSON.parse(prompt.split("\n").at(-1)!)).toMatchObject({
    context: { selectedSkill: input.context.selectedSkill }, responseContract: { recipes: input.responseContract.recipes }
  });
});

it("rejects the observed sum and offers one exact serial correction on the same Apple binding", async () => {
  selected.verifySkill.mockClear();
  const input = await relationshipInput(serialDescription);
  const requests = useProposal(additiveCapacity, serialCapacity);
  const output = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(output).toMatchObject({ status: "ready", groups: [{ formula: serialCapacity.formula, children: capacityChildren }] });
  expect(output.groups[0]?.children.every(child => !("value" in child) && !("baselineValue" in child))).toBe(true);
  expect(requests).toHaveLength(2);
  expect(requests[1]!.timeoutMs).toBeLessThan(requests[0]!.timeoutMs);
  expect(requests[1]!.expectedIdentity).toEqual(requests[0]!.expectedIdentity);
  expect(requests[1]!.signal).toBe(requests[0]!.signal);
  expect(requests[0]!.prompt).toContain("Use the minimum of the two capacities and leave both values blank.");
  expect(requests[1]!.prompt).toContain("Use the minimum of the two independently measured stage capacities");
  expect(requests[1]!.prompt.split("\n").at(-1)).toBe(requests[0]!.prompt.split("\n").at(-1));
  expect(selected.verifySkill.mock.calls).toEqual([[input.context], [input.context]]);
  const formula = materialize(output, input.context).groups[0]?.formula;
  if (!formula) throw new Error("Expected a materialized serial formula.");
  for (const [first, second, value] of [[70, 90, 70], [90, 70, 70], [70, 100, 70], [100, 100, 100], [0, 90, 0]] as const) {
    expect(evaluateFormula(formula, { first, second })).toMatchObject({ value, errors: [] });
  }
});

it.each([
  [serialDescription, additiveCapacity, "serial_capacity"],
  [independentDescription, serialCapacity, "independent_additive"]
] as const)("fails closed after one wrong relationship repair for %s", async (description, proposal, diagnostic) => {
  const input = await relationshipInput(description);
  const requests = useProposal(proposal);
  const error = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input).catch((cause: unknown) => cause);
  expect(appleSmartProposalDiagnostic(error)).toBe(diagnostic);
  expect(requests).toHaveLength(2);
});

it.each([
  ["ready count", { ...serialCapacity, formula: "min(first, second, third)", children: [
    ...capacityChildren, { key: "third", conceptKey: "stage_capacity_c", name: "Other capacity", unit: "t/h" }
  ] }],
  ["ready unit", { ...serialCapacity, children: [capacityChildren[0], { ...capacityChildren[1], unit: "kg/h" }] }],
  ["reduction count", { ...reductionReady, children: reductionFactors.map(child => ({ ...child, unit: "t/h" })) }],
  ["reduction unit", { ...reductionReady, children: [
    { ...reductionFactors[0], unit: "t/h" }, { ...reductionFactors[1], unit: "kg/h" }
  ] }]
] as const)("rejects an explicitly scoped serial proposal with a wrong %s", async (_, proposal) => {
  const input = await relationshipInput(serialDescription);
  const requests = useProposal(proposal);
  const error = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input).catch((cause: unknown) => cause);
  expect(appleSmartProposalDiagnostic(error)).toBe("serial_capacity");
  expect(requests).toHaveLength(2);
});

it.each([
  [serialDescription, "min", "min(p_1, p_2)"],
  [independentDescription, "sum", "p_1 + p_2"],
  [serialDescription.replace("tonnes per hour", "t / hour"), "min", "min(p_1, p_2)"]
] as const)("accepts a correct Apple reduction on the first attempt for %s", async (description, operation, formula) => {
  const input = await relationshipInput(description);
  const requests = useProposal({ ...reductionReady, operation, children: capacityChildren.map(({ key: _key, ...child }) => child) });
  const output = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(output).toMatchObject({ status: "ready", groups: [{ formula }] });
  expect(requests).toHaveLength(1);
});

it("preserves an explicit empty result for an anchored relationship", async () => {
  const input = await relationshipInput(serialDescription);
  const requests = useProposal({ kind: "empty", reason: "No defensible complete measurement layer." });
  await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input)).resolves.toMatchObject({ status: "empty", groups: [] });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.prompt).toContain("leave both values blank");
});

it.each([
  ["unspecified relationship", "Throughput is measured for crushing and then screening.", undefined],
  ["negated sequence", serialDescription.replace("goes through", "does not go through"), undefined],
  ["conditional sequence", "If the same stream is selected: " + serialDescription, undefined],
  ["parallel in a stage", serialDescription.replace("through crushing", "through crushing in parallel with washing"), undefined],
  ["optional stage", serialDescription.replace("then screening", "then optionally screening"), undefined],
  ["third stage", serialDescription.replace("then screening", "then screening and then washing"), undefined],
  ["conflicting scale", serialDescription.replace("tonnes per hour", "kg/hour"), undefined],
  ["unknown stated unit", serialDescription.replace("tonnes per hour", "palettes per watch"), undefined],
  ["competing scopes", independentDescription + " The same material can also flow through both stages in sequence.", undefined],
  ["truncated competing scope", serialDescription + " ".repeat(100) + independentDescription, undefined],
  ["project rather than target context", undefined, serialDescription]
] as const)("does not infer a reduction from %s", async (_, description, businessContext) => {
  const input = await relationshipInput(description, businessContext);
  const requests = useProposal(additiveCapacity);
  const output = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(output).toMatchObject({ status: "ready", groups: [{ formula: additiveCapacity.formula }] });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.prompt).toContain("Keep the remaining causes complete, disjoint");
  expect(requests[0]!.prompt).not.toContain("Use reduction with operation min.");
  expect(requests[0]!.schema.fields[0]?.shape).toMatchObject({ kind: "union", variants: [{}, {}, {}] });
});

it("retries a duplicate only once under the same deadline, source and selected Skill", async () => {
  selected.verifySkill.mockClear();
  const input = await retryInput();
  const requests: AppleCompletionRequest[] = [];
  selected.value = { pinned: retryPinned, port: {
    discover: async () => retryPinned,
    async complete(request, validate) {
      requests.push(request);
      try {
        return { value: validate({ proposal: requests.length === 1 ? rejectedReady : validReady }),
          context: { inputTokens: 100, contextSize: 8192, reservedOutputTokens: 1000 } };
      } catch { throw new AppleTransportError("invalid_output"); }
    }
  } };
  const result = await runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input);
  expect(result).toMatchObject({ status: "ready", groups: [{ children: retryChildren, formula: validReady.formula }] });
  expect(requests).toHaveLength(2);
  const [first, second] = requests;
  expect(first?.timeoutMs).toBe(30_000);
  expect(second!.timeoutMs).toBeGreaterThan(0);
  expect(second!.timeoutMs).toBeLessThan(first!.timeoutMs);
  expect(second).toMatchObject({ expectedIdentity: first?.expectedIdentity, schema: first?.schema, locale: first?.locale });
  expect(second?.signal).toBe(first?.signal);
  expect(second?.prompt.split("\n").at(-1)).toBe(first?.prompt.split("\n").at(-1));
  expect(second?.prompt).toContain("preceding proposal repeated a factor key or concept");
  expect(second?.prompt).not.toContain("redacted rejected provider text");
  expect(selected.verifySkill.mock.calls).toEqual([[input.context], [input.context]]);
});

it.each(["stale", "cancelled", "expired"] as const)("skips the Smart retry when %s", async reason => {
  selected.verifySkill.mockClear();
  if (reason === "stale") selected.verifySkill.mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Object.assign(new Error("Changed Skill."), { code: "STALE_SKILL" }));
  const controller = new AbortController();
  let completions = 0;
  selected.value = { pinned: retryPinned, port: {
    discover: async () => retryPinned,
    async complete(_request, validate) {
      completions++;
      if (reason === "expired") await new Promise(resolve => setTimeout(resolve, 60));
      if (reason === "cancelled") controller.abort();
      try {
        return { value: validate({ proposal: rejectedReady }),
          context: { inputTokens: 100, contextSize: 8192, reservedOutputTokens: 1000 } };
      } catch { throw new AppleTransportError("invalid_output"); }
    }
  } };
  const input = await retryInput();
  const errorCode = reason === "stale" ? "STALE_SKILL" : reason === "cancelled" ? "cancelled" : "TIMEOUT";
  await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({ timeoutMs: reason === "expired" ? 30 : 30_000 }),
    input, { signal: controller.signal })).rejects.toMatchObject({ code: errorCode });
  expect(completions).toBe(1);
  expect(selected.verifySkill).toHaveBeenCalledTimes(reason === "stale" ? 2 : 1);
});

it.each([1, 2])("checks the exact Skill after readiness for Smart attempt %i", async staleOn => {
  const input = await retryInput();
  let discoveries = 0;
  let stale = false;
  const requests: AppleCompletionRequest[] = [];
  selected.verifySkill.mockImplementation(async () => {
    if (stale) throw Object.assign(new Error("Changed Skill."), { code: "STALE_SKILL" });
  });
  selected.value = { pinned: retryPinned, port: {
    async discover() {
      await Promise.resolve();
      stale = ++discoveries === staleOn;
      return retryPinned;
    },
    async complete(request, validate) {
      requests.push(request);
      try {
        return { value: validate({ proposal: rejectedReady }),
          context: { inputTokens: 100, contextSize: 8192, reservedOutputTokens: 1000 } };
      } catch { throw new AppleTransportError("invalid_output"); }
    }
  } };
  try {
    await expect(runSuggestIncomingKpis(createAppleNativeSmartProvider({}), input)).rejects.toMatchObject({ code: "STALE_SKILL" });
    expect(discoveries).toBe(staleOn);
    expect(requests).toHaveLength(staleOn - 1);
    expect(selected.verifySkill).toHaveBeenLastCalledWith(input.context);
  } finally {
    selected.verifySkill.mockReset();
  }
});

it.each(["cancelled", "TIMEOUT"] as const)("interrupts the post-readiness Skill lookup with %s before starting generation", async code => {
  const input = await retryInput();
  const caller = new AbortController();
  let reachedLookup = () => {};
  const reading = new Promise<void>(resolve => { reachedLookup = resolve; });
  let releaseLookup = () => {};
  const lookup = new Promise<void>(resolve => { releaseLookup = resolve; });
  selected.verifySkill.mockImplementationOnce(async () => { reachedLookup(); await lookup; });
  const complete = vi.fn(async () => { throw new Error("Unexpected native completion."); });
  selected.value = { pinned: retryPinned, port: { discover: async () => retryPinned, complete } };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  try {
    const pending = runSuggestIncomingKpis(createAppleNativeSmartProvider({ timeoutMs: 100 }), input, { signal: caller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ code });
    await reading;
    if (code === "cancelled") caller.abort();
    else await vi.advanceTimersByTimeAsync(100);
    await rejected;
    releaseLookup();
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
  } finally {
    releaseLookup();
    vi.useRealTimers();
  }
});
