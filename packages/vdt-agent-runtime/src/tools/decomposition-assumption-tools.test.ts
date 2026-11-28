import { evaluateModelReadiness, productionVolumeProject, readDecompositionAssumptions, VdtBuilderSession,
  type DecompositionRelationship, type VdtProject } from "@vdt-studio/vdt-core";
import { describe, expect, it } from "vitest";
import type { AgentSessionBinding } from "../agent-execution-contracts";
import { verifyDeterministicRunFinish } from "../finish-verifier";
import { AgentRunStore } from "../run-store";
import { agentQuestionSchema } from "../schemas/agent-event";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createVdtBuilderTools } from "./vdt-builder-tools";
import { createDecompositionAssumptionTools } from "./decomposition-assumption-tools";

function setup(project = productionVolumeProject, autoApplyPatches = true) {
  const builder = new VdtBuilderSession({ project });
  const store = new AgentRunStore();
  const { runId, abortController } = store.createRun({
    mode: "continue_project", providerId: "mock",
    input: { rootKpi: "Output", project: builder.getProject() },
    options: { autoApplyPatches }
  });
  store.updateRun(runId, { builder, draftProject: builder.getProject() });
  const context: AgentToolContext = {
    runId, builder, store, signal: abortController.signal,
    emit: event => store.appendEvent(runId, event), getRun: () => store.getSnapshot(runId),
    updateRun: patch => { store.updateRun(runId, patch); }
  };
  const registry = new ToolRegistry();
  for (const tool of [...createDecompositionAssumptionTools(), ...createVdtBuilderTools()]) registry.register(tool);
  return { store, builder, context, registry, runId };
}

const toolName = "vdt.record_decomposition_assumption";
const statement = "Both stages are serial.";
const args = {
  nodeId: productionVolumeProject.rootNodeId, statement, previousNote: null,
  changesConclusionWhen: "Reconsider the bottleneck if the outputs are independent."
};

describe("decomposition assumption tools", () => {
  it("uses the mutation proposal flow and confirms the selected option from the user's answer", async () => {
    const { store, builder, context, registry, runId } = setup();
    store.appendChatMessage(runId, {
      role: "assistant", kind: "question",
      questions: [{ id: "relationship", question: "Which relationship holds?", reason: "It determines the formula.", required: true, expectedAnswerType: "single_choice", options: [
        { id: "serial", label: statement, value: "serial" },
        { id: "parallel", label: "The outputs are independent.", value: "parallel" }
      ] }]
    });
    const answer = store.appendChatMessage(runId, {
      role: "user", kind: "answer",
      text: "User answered the pending Model Agent questions.",
      answers: [{ questionId: "relationship", selectedOptionIds: ["serial"] }]
    }).chatMessages.at(-1)!;
    expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId: args.nodeId }, context))
      .toMatchObject({ ok: true, output: {
        recentUserSources: [{ id: answer.id, exactStatements: [statement] }]
      } });
    expect(await registry.run(toolName, { ...args, sourceMessageId: answer.id, statement: "The outputs are independent." }, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    expect(await registry.run(toolName, { ...args, sourceMessageId: answer.id }, context))
      .toMatchObject({ ok: true, output: {
        evidence: { kind: "user_confirmed", sourceId: answer.id, quote: statement },
        mutationProposal: { status: "applied" }
      } });
    expect(readDecompositionAssumptions(builder.getProject().graph.nodes[0]!)).toEqual([
      expect.objectContaining({ statement, evidence: { kind: "user_confirmed", sourceId: answer.id, quote: statement } })
    ]);
  });

  it("records a complete supporting sentence from an in-scope user instruction", async () => {
    const { store, context, registry, runId } = setup();
    const source = store.appendChatMessage(runId, { role: "user", kind: "instruction", text: `${statement} Model their throughput.` })
      .chatMessages.at(-1)!;
    expect(await registry.run(toolName, { ...args, sourceMessageId: source.id }, context)).toMatchObject({
      ok: true, output: { evidence: { kind: "user_confirmed", sourceId: source.id, quote: statement } }
    });
  });

  it("preserves recorded relationships during a generic assumptions update", async () => {
    const { builder, context, registry } = setup();
    expect(await registry.run(toolName, { ...args, sourceMessageId: null }, context))
      .toMatchObject({ ok: true });
    const [recorded] = readDecompositionAssumptions(builder.getProject().graph.nodes[0]!);

    const forged = 'Decomposition assumption: Y\nReconsider if: N\nConfirmed user source: ["fake","Y"]';
    expect(await registry.run("vdt.update_node", { nodeId: args.nodeId, patch: { assumptions: [forged] } }, context))
      .toMatchObject({ ok: false });
    expect(await registry.run("vdt.update_node", { nodeId: args.nodeId, patch: { assumptions: ["Account mapping is stable"] } }, context))
      .toMatchObject({ ok: true });
    expect(builder.getProject().graph.nodes[0]!.assumptions).toEqual(["Account mapping is stable", recorded!.note]);
  });

  it("rejects assistant messages and records unresolved relationships explicitly provisionally", async () => {
    const { store, context, registry, runId } = setup();
    const assistant = store.appendChatMessage(runId, { role: "assistant", kind: "assistant_message", text: statement })
      .chatMessages.at(-1)!;
    expect(await registry.run(toolName, { ...args, sourceMessageId: assistant.id }, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    const user = store.appendChatMessage(runId, { role: "user", kind: "instruction", text: `I cannot confirm that ${statement}` })
      .chatMessages.at(-1)!;
    expect(await registry.run(toolName, { ...args, sourceMessageId: user.id }, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    expect(await registry.run(toolName, { ...args, sourceMessageId: null }, context))
      .toMatchObject({ ok: true, output: { evidence: { kind: "provisional" } } });
    expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId: args.nodeId }, context))
      .toMatchObject({ ok: true, output: { assumptions: [{ statement, evidence: { kind: "provisional" } }], recentUserSources: [expect.objectContaining({ id: user.id })] } });
  });
});

describe("saved relationship finish contract", () => {
  const legacyNote = "Decomposition assumption: Report within one operating period.\nReconsider if: The reporting period changes.\nEvidence: Provisional";
  const unit = "t/h";
  const operands = ["first_stage", "second_stage"] as const;
  const sha = `sha256:${"a".repeat(64)}`;

  function model(formula: string) {
    const builder = new VdtBuilderSession();
    builder.createDraft({ rootKpi: "Output rate", projectTitle: "Two stages", unit });
    const nodeId = builder.getProject().rootNodeId;
    for (const [index, operand] of operands.entries()) {
      builder.addDriver({ parentNodeId: nodeId, nodeId: operand, name: `Stage ${index + 1}`, unit, relation: "formula_dependency" });
    }
    builder.updateNode({ nodeId, patch: { assumptions: [legacyNote], decompositionPlan: {
      version: 1, goal: "Model the output rate", nodes: operands.map(operand => ({ nodeId: operand, parentNodeId: nodeId, kind: "input" }))
    } } });
    builder.setFormula({ nodeId, formula });
    return setup(builder.getProject());
  }

  function finish(project: VdtProject, runId: string, revision: number) {
    const binding: AgentSessionBinding = {
      schemaVersion: 2, bindingId: "binding-1", runId, projectId: project.id, executionProfile: "model_agent",
      engineId: "model-engine", engineAdapterId: "structured-turn-v1", backendId: "fixture", modelId: "fixture-model",
      protocolVersion: "model-turn.v1", cliVersion: null, toolIsolation: "hard_verified", qualificationStatus: "qualified",
      capabilityEvidenceHash: sha, settingsHash: sha, capabilityProfileHash: sha, toolCatalogHash: sha,
      externalSessionId: null, sessionEpoch: 1, boundAt: "2026-11-25T00:00:00.000Z"
    };
    return verifyDeterministicRunFinish({ binding, project, currentRevision: revision, expectedHeadRevision: revision,
      mode: "continue_project", outcome: "structural_model", requireDerivedRoot: true, requireHierarchy: true,
      pendingQuestion: false, pendingApproval: false, pendingProposal: false, ambiguousOperation: false });
  }

  it.each([
    ["serial_capacity", "min(first_stage, second_stage)", true],
    ["serial_capacity", "first_stage + second_stage", false],
    ["independent_additive", "first_stage + second_stage", true]
  ] as const)("checks saved %s with %s after an exact user choice", async (kind, formula, accepted) => {
    const { builder, store, runId, registry, context } = model(formula);
    const nodeId = builder.getProject().rootNodeId;
    const relationship: DecompositionRelationship = { kind, operandNodeIds: [...operands], unit };
    const read = await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship }, context);
    if (!read.ok) throw new Error(read.error?.message ?? "Expected a relationship choice.");
    const choice = (read.output as { confirmationChoices: { en: { id: string; label: string; value: string } } }).confirmationChoices.en;
    const question = { id: "flow", question: "Which relationship holds?", reason: "It determines the output formula.", required: true,
      expectedAnswerType: "single_choice" as const, options: [choice] };
    store.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [question] });
    const answer = store.appendChatMessage(runId, { role: "user", kind: "answer",
      answers: [{ questionId: question.id, selectedOptionIds: [choice.id] }] }).chatMessages.at(-1)!;

    expect(await registry.run(toolName, { nodeId, relationship, statement: choice.label, sourceMessageId: answer.id,
      previousNote: null, changesConclusionWhen: "The stage routing or reporting basis changes." }, context)).toMatchObject({
      ok: true, output: { mutationProposal: { status: "applied" } }
    });
    expect(store.getState(runId).chatMessages.filter(message => message.kind === "question")).toHaveLength(1);
    const reopened: VdtProject = JSON.parse(JSON.stringify(builder.getProject()));
    const root = reopened.graph.nodes.find(node => node.id === nodeId)!;
    expect(readDecompositionAssumptions(root)).toMatchObject([
      { note: legacyNote, evidence: { kind: "provisional" } },
      { relationship, evidence: { kind: "user_confirmed", sourceId: answer.id, quote: choice.label } }
    ]);
    const before = structuredClone(reopened);
    expect(evaluateModelReadiness(reopened, { purpose: "structural_model" }).relationshipChecks).toMatchObject([
      { nodeId, result: { status: accepted ? "passed" : "mismatch" } }
    ]);
    const result = finish(reopened, runId, builder.getRevision());
    if (accepted) {
      expect(result).toMatchObject({ accepted: true, code: "FINISH_VERIFIED", finishReceipt: { missingInputCount: 2 } });
    } else {
      expect(result).toMatchObject({ accepted: false, code: "GRAPH_INVALID", payload: {
        readinessIssues: [expect.objectContaining({ code: "RELATIONSHIP_FORMULA_MISMATCH", nodeId })]
      } });
      expect(result.finishReceipt).toBeUndefined();
    }
    expect(reopened).toEqual(before);
  });

  it("preserves a submitted free-form answer without treating it as typed consent", async () => {
    const { builder, store, runId, registry, context } = model("first_stage + second_stage");
    const nodeId = builder.getProject().rootNodeId;
    const relationship: DecompositionRelationship = { kind: "serial_capacity", operandNodeIds: [...operands], unit };
    store.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [{
      id: "scope", question: "Does the material flow through both stages?", reason: "The relationship determines the formula.",
      required: true, expectedAnswerType: "text"
    }] });
    const statement = "The same material passes through both stages without bypass.";
    const answer = store.appendChatMessage(runId, { role: "user", kind: "answer",
      answers: [{ questionId: "scope", fields: { answer: statement } }] }).chatMessages.at(-1)!;
    const common = { nodeId, statement, sourceMessageId: answer.id, previousNote: null,
      changesConclusionWhen: "The routing changes." };
    expect(await registry.run(toolName, { ...common, relationship }, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    expect(await registry.run(toolName, common, context)).toMatchObject({ ok: true });
    const reopened: VdtProject = JSON.parse(JSON.stringify(builder.getProject()));
    const assumptions = readDecompositionAssumptions(reopened.graph.nodes.find(node => node.id === nodeId)!);
    expect(assumptions).toMatchObject([{ note: legacyNote }, { evidence: { kind: "user_confirmed", sourceId: answer.id, quote: statement } }]);
    expect(assumptions.every(assumption => assumption.relationship === undefined)).toBe(true);
    expect(evaluateModelReadiness(reopened, { purpose: "structural_model" }).relationshipChecks).toBeUndefined();
    expect(finish(reopened, runId, builder.getRevision())).toMatchObject({ accepted: true, code: "FINISH_VERIFIED" });
  });
});

it("records a typed relationship only after the user selects the matching KPI, unit and topology choice", async () => {
  const { builder, store, registry, context, runId } = setup();
  const nodeId = "effective_working_time";
  const relationship = { kind: "independent_additive", operandNodeIds: ["calendar_time", "planned_downtime"], unit: "hours/month" };
  const read = await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship }, context);
  if (!read.ok) throw new Error(read.error?.message ?? "Relationship choice was unavailable.");
  const choice = (read.output as { confirmationChoices: { en: { id: string; label: string; value: string } } }).confirmationChoices.en;
  const typedArgs = { ...args, nodeId, relationship, statement: choice.label };
  const question = {
    id: "flow", question: "How do these two KPIs combine?", reason: "The answer determines the formula.",
    required: true, expectedAnswerType: "single_choice" as const, options: [choice]
  };
  const before = structuredClone(builder.getProject());
  const suggestion = store.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [question] }).chatMessages.at(-1)!;
  expect(await registry.run(toolName, { ...typedArgs, sourceMessageId: suggestion.id }, context))
    .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
  expect(builder.getProject()).toEqual(before);

  const answer = store.appendChatMessage(runId, {
    role: "user", kind: "answer", answers: [{ questionId: question.id, selectedOptionIds: [choice.id] }]
  }).chatMessages.at(-1)!;
  expect(await registry.run(toolName, {
    ...typedArgs, sourceMessageId: answer.id, relationship: { ...relationship, kind: "serial_capacity" }
  }, context)).toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
  expect(await registry.run(toolName, {
    ...typedArgs, sourceMessageId: answer.id, relationship: { ...relationship, operandNodeIds: ["calendar_time", "unplanned_downtime"] }
  }, context)).toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
  expect(builder.getProject()).toEqual(before);

  expect(await registry.run(toolName, { ...typedArgs, sourceMessageId: answer.id }, context)).toMatchObject({ ok: true,
    output: { relationship, evidence: { kind: "user_confirmed", sourceId: answer.id, quote: choice.label }, mutationProposal: { status: "applied" } }
  });
  const recorded = readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!)[0]!;
  expect(recorded.relationship).toEqual(relationship);
  expect(await registry.run(toolName, { ...args, nodeId, previousNote: recorded.note, sourceMessageId: null }, context))
    .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });

  const correction = { ...relationship, kind: "serial_capacity" };
  const readCorrection = await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship: correction }, context);
  if (!readCorrection.ok) throw new Error(readCorrection.error?.message ?? "Corrected relationship choice was unavailable.");
  const newChoice = (readCorrection.output as { confirmationChoices: { en: typeof choice } }).confirmationChoices.en;
  store.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [{ ...question, id: "new-flow", options: [newChoice] }] });
  const newAnswer = store.appendChatMessage(runId, {
    role: "user", kind: "answer", answers: [{ questionId: "new-flow", selectedOptionIds: [newChoice.id] }]
  }).chatMessages.at(-1)!;
  const replaced = await registry.run(toolName, {
    ...typedArgs, relationship: correction, statement: newChoice.label, sourceMessageId: newAnswer.id, previousNote: recorded.note
  }, context);
  expect(replaced).toMatchObject({ ok: true, output: { relationship: correction } });
  const latest = readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!)[0]!;
  expect(await registry.run(toolName, { ...typedArgs, sourceMessageId: answer.id, previousNote: latest.note }, context))
    .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
});


describe("quantity-by-rate relationship confirmation", () => {
  const relationship = { kind: "quantity_rate", operandNodeIds: ["items", "hours_per_item"],
    operandUnits: ["count", "h/item"], unit: "h" };

  function model(autoApplyPatches: boolean) {
    const seed = new VdtBuilderSession();
    seed.createDraft({ rootKpi: "Total hours", projectTitle: "Capacity", unit: "h" });
    const nodeId = seed.getProject().rootNodeId;
    seed.addDriver({ parentNodeId: nodeId, nodeId: "items", name: "Item count", unit: "count", relation: "formula_dependency" });
    seed.addDriver({ parentNodeId: nodeId, nodeId: "hours_per_item", name: "Time per item", unit: "h/item", relation: "formula_dependency" });
    seed.setFormula({ nodeId, formula: "items * hours_per_item" });
    return { ...setup(seed.getProject(), autoApplyPatches), nodeId };
  }

  async function answerFor({ registry, context, store, nodeId, runId }: ReturnType<typeof model>, id: string) {
    const result = await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship }, context);
    if (!result.ok) throw new Error(result.error?.message ?? "Expected a quantity-rate choice.");
    const choice = (result.output as { confirmationChoices: { en: { id: string; label: string; value: string } } }).confirmationChoices.en;
    const question = agentQuestionSchema.parse({
      id, question: "How is the total calculated?", reason: "Confirm the two roles and their units.",
      required: true, expectedAnswerType: "single_choice", options: [choice]
    });
    store.appendChatMessage(runId, { role: "assistant", kind: "question", questions: [question] });
    const answer = store.appendChatMessage(runId, {
      role: "user", kind: "answer", answers: [{ questionId: id, selectedOptionIds: [choice.id] }]
    }).chatMessages.at(-1)!;
    return { choice, input: { ...args, nodeId, relationship, statement: choice.label, sourceMessageId: answer.id } };
  }

  it("checks ordered operands and their units and rejects old consent after the draft revision advances", async () => {
    const fixture = model(true);
    const { registry, context, nodeId, builder } = fixture;
    for (const invalid of [
      { ...relationship, operandNodeIds: ["hours_per_item", "items"] },
      { ...relationship, operandNodeIds: ["items", "items"] },
      { ...relationship, operandUnits: ["count", "min/item"] },
      { ...relationship, unit: "USD" }
    ]) {
      expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship: invalid }, context))
        .toMatchObject({ ok: false, error: { code: "INVALID_ASSUMPTION" } });
    }
    expect(await registry.run("vdt.read_decomposition_assumptions", {
      nodeId, relationship: { kind: "quantity_rate", operandNodeIds: relationship.operandNodeIds, unit: relationship.unit }
    }, context)).toMatchObject({ ok: false });

    const first = await answerFor(fixture, "first-choice");
    expect(first.choice.label).toContain("Item count [items] (count) × Time per item [hours_per_item] (h/item)");
    builder.updateNode({ nodeId, patch: { description: "A new draft revision." } });
    expect(await registry.run(toolName, first.input, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    const second = await answerFor(fixture, "current-choice");
    expect(second.choice.label).toBe(first.choice.label);
    expect(second.choice.id).not.toBe(first.choice.id);
    expect(await registry.run(toolName, second.input, context)).toMatchObject({
      ok: true, output: { relationship, mutationProposal: { status: "applied" } }
    });
    const [saved] = readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!);
    expect(saved).toMatchObject({ relationship, evidence: {
      kind: "user_confirmed", sourceId: second.input.sourceMessageId, quote: second.choice.label
    } });
    expect(saved?.note).toContain("\nDecomposition relationship v2: ");
  });

  it("requires the latest owned user input for both first records and replacements at an unchanged revision", async () => {
    const fixture = model(true);
    const { builder, context, nodeId, registry, runId, store } = fixture;
    const selected = await answerFor(fixture, "old-choice");
    const revision = builder.getRevision();
    store.appendChatMessage(runId, { role: "user", kind: "instruction", text: "Do not multiply. Keep the relationship open." });
    expect(builder.getRevision()).toBe(revision);
    expect(await registry.run(toolName, selected.input, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    expect(readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!)).toEqual([]);

    const repeated = await answerFor(fixture, "repeated-choice");
    expect(repeated.choice).toEqual(selected.choice);
    store.appendChatMessage(runId, { role: "assistant", kind: "status", text: "Reading the confirmed basis." });
    expect(await registry.run(toolName, repeated.input, context)).toMatchObject({ ok: true });
    const [saved] = readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!);
    expect(saved?.evidence).toMatchObject({ sourceId: repeated.input.sourceMessageId });

    const replacement = await answerFor(fixture, "replacement-choice");
    const replacementRevision = builder.getRevision();
    store.appendChatMessage(runId, {
      role: "user", kind: "answer", answers: [{ questionId: "replacement-choice", freeText: "Leave it unresolved." }]
    });
    expect(builder.getRevision()).toBe(replacementRevision);
    expect(await registry.run(toolName, { ...replacement.input, previousNote: saved!.note }, context))
      .toMatchObject({ ok: false, error: { code: "ASSUMPTION_SOURCE_UNCONFIRMED" } });
    expect(readDecompositionAssumptions(builder.getProject().graph.nodes.find(node => node.id === nodeId)!)).toEqual([saved]);
  });

  it("compacts spacing at the option limit and refuses labels that would lose identity", async () => {
    const fixture = model(true);
    const { builder, context, nodeId, registry } = fixture;
    const { choice } = await answerFor(fixture, "spaced-choice");
    const extraCharacters = 164 - choice.label.length;
    const name = `Total hours ${"x".repeat(extraCharacters - 1)}`;
    builder.updateNode({ nodeId, patch: { name } });
    const { choice: compact } = await answerFor(fixture, "compact-choice");
    expect(compact.label).toBe(`${name}[${nodeId}](h)=Item count[items](count)×Time per item[hours_per_item](h/item)`);
    expect(compact.label.length).toBeLessThanOrEqual(160);
    builder.updateNode({ nodeId, patch: { name: "x".repeat(165) } });
    expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship }, context))
      .toMatchObject({ ok: false, error: { code: "INVALID_ASSUMPTION" } });
  });

  it("keeps a confirmed relationship pending when the run requires visual approval", async () => {
    const fixture = model(false);
    const { registry, context, builder, store, runId } = fixture;
    const { input } = await answerFor(fixture, "approval-choice");
    const before = structuredClone(builder.getProject());
    expect(await registry.run(toolName, input, context)).toMatchObject({ ok: true });
    expect(store.getState(runId)).toMatchObject({ status: "waiting_approval", pendingMutationProposal: expect.any(Object) });
    expect(builder.getProject()).toEqual(before);
  });

  it("preserves a malformed typed note and requests manual repair before new confirmation", async () => {
    const { registry, context, nodeId, builder } = model(true);
    const malformed = "Decomposition relationship v2:{";
    builder.updateNode({ nodeId, patch: { assumptions: [malformed] } });
    expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId }, context))
      .toMatchObject({ ok: true, output: { invalidTypedNote: true } });
    expect(await registry.run("vdt.read_decomposition_assumptions", { nodeId, relationship }, context))
      .toMatchObject({ ok: false, error: { code: "INVALID_ASSUMPTION" } });
    expect(await registry.run("vdt.update_node", { nodeId, patch: { assumptions: ["Decomposition relationship v3:{}"] } }, context))
      .toMatchObject({ ok: false });
    expect(await registry.run("vdt.update_node", { nodeId, patch: { assumptions: ["Other premise"] } }, context))
      .toMatchObject({ ok: true });
    expect(builder.getProject().graph.nodes.find(node => node.id === nodeId)?.assumptions).toEqual(["Other premise", malformed]);
  });
});
