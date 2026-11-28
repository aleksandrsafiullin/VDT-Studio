import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { applyDecompositionAssumptionOperation, VdtBuilderSession, type VdtDecompositionPlan } from "@vdt-studio/vdt-core";
import { AgentToolError, createDefaultToolRegistry, modelAgentStructuredTurnSchema, type ModelAgentTurnRequest } from "@vdt-studio/vdt-agent-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  APPLE_NATIVE_PROVIDER_ID,
  APPLE_NATIVE_SURFACES,
  completeAppleNativeBoundedTask,
  packagedAppleNativePort,
  type AppleNativePort
} from "./apple-native-host";
import { AppleNativeTurnTransport, type AppleNativeStage } from "./apple-native-turn";
import * as scopedMethodReview from "./apple-native-scoped-skill-question";
import { guide as structuralGuideFor } from "./apple-native-structural-guide";
import { OUTCOME_ADMISSION_PROMPT, PROPOSE_OUTCOME, registerOutcomeAdmission } from "./outcome-admission";

const pinned: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "test", modelRevision: null },
  locale: "en-US", contextSize: 8192, tokenBudgetVerified: true
};
const initial: ModelAgentTurnRequest = {
  binding: { backendId: APPLE_NATIVE_PROVIDER_ID, modelId: pinned.identity.model, projectId: "project-1", runId: "run-1" } as ModelAgentTurnRequest["binding"],
  exchangeId: "exchange-1",
  stableCallKey: "confirmed-1",
  previousCursor: null,
  delta: {
    type: "initial_context",
    contextHash: `sha256:${"a".repeat(64)}`,
    context: {
      brief: { prompt: "100 units at 20 USD per unit, keep the full original wording.",
        businessContext: "100 units at 20 USD per unit, keep the full original wording.",
        selectedNodeId: "root-1", selectedSkill: { id: "skill-1", version: 3 } },
      skillResolutionPolicy: "Supply the readReceiptId and nextOffset yourself.",
      conversationContext: { topic: "recognized revenue", source: "submitted answer" }
    }
  },
  responseSchema: modelAgentStructuredTurnSchema,
  signal: new AbortController().signal
};

function fixture() {
  const calls: AppleCompletionRequest[] = [];
  let capability = pinned;
  let proposal: unknown = { sessionState: "Need to inspect the model.", tool: "project.get_current", argumentsJson: "{}" };
  const queuedProposals: unknown[] = [];
  let review: (() => unknown) | undefined;
  let outcomeReview: (() => unknown) | undefined;
  let fitReview: ((request: AppleCompletionRequest) => unknown) | undefined;
  let catalogScreen = (_request: AppleCompletionRequest): unknown => ({ plausibleCard: "no_plausible_card" });
  const discover = vi.fn(async () => capability);
  const port: AppleNativePort = {
    discover,
    async complete(request, validate) {
      calls.push(request);
      const first = request.schema.fields[0]?.name;
      const candidate = first === "plausibleCard" ? catalogScreen(request)
        : first === "conclusion" && review ? review() : first === "outcome" && outcomeReview ? outcomeReview()
        : first === "fit" && fitReview ? fitReview(request) : queuedProposals.length ? queuedProposals.shift() : proposal;
      const value = typeof candidate === "function" ? candidate(request) : candidate;
      if (value instanceof AppleTransportError) throw value;
      try {
        return { value: validate(value), context: { contextSize: capability.contextSize, inputTokens: 800, reservedOutputTokens: request.maxOutputTokens } };
      } catch { throw new AppleTransportError("invalid_output", "canonical_validation"); }
    }
  };
  const readStage = vi.fn<() => AppleNativeStage>(() => ({
    observation: { selectedNode: "root-1", revision: 1 },
    tools: [{
      name: "project.get_current",
      summary: "Inspect current draft.",
      arguments: { type: "object", properties: {} },
      validateArguments: (args: unknown) => {
        if (JSON.stringify(args) !== "{}") throw new Error("Unexpected arguments");
        return {};
      }
    }]
  }));
  const turn = new AppleNativeTurnTransport({ port, pinned, projectId: "project-1", runId: "run-1", readStage });
  return { turn, port, calls, readStage, discover, setCapability: (next: AppleModelCapability) => { capability = next; },
    propose: (next: unknown) => { proposal = next; }, proposeOnce: (next: unknown) => { queuedProposals.push(next); },
    reviewWith: (next: () => unknown) => { review = next; },
    reviewOutcomeWith: (next: () => unknown) => { outcomeReview = next; },
    reviewFitWith: (next: (request: AppleCompletionRequest) => unknown) => { fitReview = next; },
    screenCatalogWith: (next: (request: AppleCompletionRequest) => unknown) => { catalogScreen = next; } };
}

function proposedFit(request: AppleCompletionRequest, conclusion: string) {
  const prompt = JSON.parse(request.prompt);
  return { fit: "proposed_method_matches", conclusion, methodSpanId: prompt.proposedMethod.spans[0].id,
    scopeSpanId: prompt.scopeSpans[0].id, reasonLanguage: "en" };
}

function automaticFixture() {
  const f = fixture();
  const tools = createDefaultToolRegistry();
  registerOutcomeAdmission(tools);
  f.readStage.mockReturnValue({
    observation: { outcomeAdmissionPending: true },
    tools: [PROPOSE_OUTCOME, "user.ask"].map(name => tools.list().find(tool => tool.name === name)!).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: args => tool.inputSchema.parse(args) as Record<string, unknown>
    }))
  });
  const request: ModelAgentTurnRequest = {
    ...initial, delta: { type: "initial_context", contextHash: "initial",
      context: { brief: { prompt: "Export the saved Plan scenario to Excel from revision rev_17." }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT } }
  };
  return { ...f, request };
}

function guided(sessionState: string, action: Record<string, unknown>) {
  return { sessionState, action };
}

describe("first full structural construction argument repair", () => {
  const planName = "vdt.set_decomposition_plan";
  const skillId = "flow_method";
  const registry = createDefaultToolRegistry();
  const planTool = registry.list().find(tool => tool.name === planName)!;
  const planArgs = { plan: { version: 1, goal: "Water by duration and rate", nodes: [
    { nodeId: "duration", parentNodeId: "root_1", kind: "input" },
    { nodeId: "rate", parentNodeId: "root_1", kind: "input" }
  ] } };
  const invalidFieldArgs = { plan: { ...planArgs.plan, nodes: [{ ...planArgs.plan.nodes[0], nodeId: 25 }, planArgs.plan.nodes[1]] } };
  const mixedArgs = { plan: { ...planArgs.plan, nodes: [{ ...invalidFieldArgs.plan.nodes[0], kind: true }, planArgs.plan.nodes[1]] } };
  const surplusArgs = { plan: { ...planArgs.plan, nodes: [{ ...planArgs.plan.nodes[0], note: "No field for this." }, planArgs.plan.nodes[1]] } };
  const populatedCollectionArgs = { plan: { ...planArgs.plan, nodes: [
    { ...planArgs.plan.nodes[0], sharedWith: Array.from({ length: 21 }, (_, i) => `node_${i}`) }, planArgs.plan.nodes[1]
  ] } };
  const action = (argumentsJson: string, tool = planName) => ({ sessionState: "Construct.", tool, argumentsJson });
  const signedRead = { toolName: "skill.read", externalCallId: "exchange-1:call", status: "succeeded", resultCode: "OK",
    payload: { output: { id: skillId }, projectChanged: false } } as const;

  it.each(["schema", "malformed JSON", "non-object", "bad repair", "switch tool", "nested field", "multiple fields",
    "surplus field", "populated collection", "oversize", "invalid fragment", "decline", "foreign receipt", "late revision",
    "changed scope", "changed project", "authority error", "invalid envelope", "cancelled", "ineligible tool", "clean"] as const)(
    "keeps the authorized first construction bound for %s", async kind => {
      const { turn, calls, readStage, proposeOnce } = fixture();
      const readTool = { name: "skill.read", summary: "Read pinned method.", arguments: {},
        validateArguments: (args: unknown) => args as Record<string, unknown> };
      readStage.mockReturnValue({ skillDiscovery: true, skillReadableIds: [skillId],
        observation: { outcome: "structural_model", skillResolution: { pinnedSkillId: skillId } }, tools: [readTool] });
      proposeOnce(guided("Read pinned method.", { tool: "skill.read", skillRead: { skillId } }));
      await turn.completeTurn(initial);

      const parse = vi.fn((args: unknown) => {
        if (kind === "authority error") throw new AgentToolError("MUTATION_SCOPE_VIOLATION", "The workspace scope changed.");
        return planTool.inputSchema.parse(args) as Record<string, unknown>;
      });
      const context = { revision: kind === "late revision" ? 1 : 0, rootNodeId: "root_1", nodeCount: 1,
        outcome: "structural_model", skillResolution: { outcome: "selected", selectedSkillId: skillId } };
      const other = { name: "project.get_subtree", summary: "Inspect.", arguments: {},
        validateArguments: vi.fn((args: unknown) => args as Record<string, unknown>) };
      readStage.mockReturnValue({ observation: context, tools: [
        { name: planName, summary: planTool.description, arguments: { type: "object", required: ["plan"] }, validateArguments: parse }, other
      ] });
      const valid = JSON.stringify(planArgs);
      const fragmentRepair = kind === "nested field" || kind === "invalid fragment" || kind === "decline";
      const abort = new AbortController();
      proposeOnce(() => {
        if (kind === "cancelled") abort.abort();
        if (kind === "invalid envelope") return { ...action("{}"), unknown: true };
        if (kind === "ineligible tool") return action("{}", "vdt.reparent_branch");
        const json = fragmentRepair ? JSON.stringify(invalidFieldArgs)
          : kind === "oversize" ? valid.padEnd(12_289, " ")
          : kind === "multiple fields" ? JSON.stringify(mixedArgs) : kind === "surplus field" ? JSON.stringify(surplusArgs)
          : kind === "populated collection" ? JSON.stringify(populatedCollectionArgs)
          : kind === "malformed JSON" ? '{"plan":' : kind === "non-object" ? '[]'
          : kind === "authority error" || kind === "clean" ? valid : '{"plan":{}}';
        return action(json);
      });
      proposeOnce((native: AppleCompletionRequest) => {
        expect(native.expectedIdentity).toEqual(pinned.identity);
        expect(native.schema.fields.find(field => field.name === "tool")?.shape).toEqual({ kind: "choice", choices: [planName] });
        const prompt = JSON.parse(native.prompt);
        expect(prompt.tools.map((tool: { name: string }) => tool.name)).toEqual([planName]);
        expect(prompt.observation.rootNodeId).toBe("root_1");
        expect(prompt.sessionState).toBeUndefined();
        expect(prompt.revisionInstruction).toContain("was not executed");
        if (fragmentRepair) {
          const field = ["plan", "nodes", 0, "nodeId"];
          expect(native.schema.fields.find(field => field.name === "replacementValue")?.shape).toEqual({ kind: "string" });
          expect(prompt.formatFeedback).toEqual({
            issues: [{ field, requirement: "Required type: string." }],
            replacePaths: [field], omitPaths: [],
            priorDraftArguments: invalidFieldArgs
          });
          if (kind === "decline") return { sessionState: "Hold.", tool: planName, repairDecision: "decline" };
          return { sessionState: "Construct.", tool: planName, repairDecision: "repair",
            replacementValue: kind === "nested field" ? "duration" : planArgs };
        } else if (kind === "multiple fields") {
          expect(prompt.formatFeedback.replacePaths).toEqual([["plan", "nodes", 0, "nodeId"], ["plan", "nodes", 0, "kind"]]);
          expect(prompt.formatFeedback.priorDraftArguments).toEqual(mixedArgs);
        } else if (kind === "surplus field") {
          const field = ["plan", "nodes", 0, "note"];
          expect(native.schema.fields.map(({ name }) => name)).toEqual(["sessionState", "tool", "repairDecision"]);
          expect(prompt.formatFeedback).toMatchObject({ replacePaths: [], omitPaths: [field], issues: [{ field }] });
          return { sessionState: "Construct.", tool: planName, repairDecision: "repair" };
        } else if (kind === "malformed JSON" || kind === "non-object") {
          expect(prompt.formatFeedback.replacePaths).toEqual([[]]);
          expect(prompt.formatFeedback.priorDraftArguments).toBeUndefined();
        } else {
          expect(prompt.formatFeedback.replacePaths).toEqual([["plan", "version"], ["plan", "goal"], ["plan", "nodes"]]);
          expect(prompt.formatFeedback.priorDraftArguments).toEqual({ plan: {} });
        }
        const fragmentJson = kind === "bad repair" ? "{}"
          : kind === "schema" || kind === "switch tool" ? JSON.stringify([planArgs.plan.version, planArgs.plan.goal, planArgs.plan.nodes])
          : kind === "multiple fields" ? JSON.stringify(["duration", "input"]) : valid;
        return { sessionState: "Construct.", tool: kind === "switch tool" ? other.name : planName, repairDecision: "repair", fragmentJson };
      });
      const result = kind === "foreign receipt" ? { ...signedRead, externalCallId: "foreign:call" }
        : kind === "changed project" ? { ...signedRead, payload: { ...signedRead.payload, projectChanged: true } } : signedRead;
      const checkpoint = { type: "tool_results", batchId: "pinned-read", results: [result] } as const;
      const next: ModelAgentTurnRequest = { ...initial, exchangeId: "first-plan", signal: abort.signal,
        delta: kind === "changed scope" ? { type: "checkpoint_inputs", checkpointDelta: checkpoint,
          inputs: [{ type: "user_instruction", text: "Switch to a different deliverable." }] } : checkpoint
      };
      const pending = turn.completeTurn(next);
      if (["clean", "schema", "malformed JSON", "non-object", "nested field", "multiple fields", "surplus field"].includes(kind)) {
        await expect(pending).resolves.toMatchObject({ output: { action: { batch: { calls: [
          { externalCallId: "first-plan:call", toolName: planName, args: planArgs }
        ] } } } });
        expect(calls).toHaveLength(kind === "clean" ? 2 : 3);
      } else {
        const repaired = fragmentRepair || kind === "bad repair" || kind === "switch tool";
        await expect(pending).rejects.toMatchObject({ stage: repaired ? "FIRST_CONSTRUCTION_ARGUMENTS_RETRY" : "TOOL_ACTION" });
        expect(calls).toHaveLength(repaired ? 3 : 2);
      }
      expect(other.validateArguments).not.toHaveBeenCalled();
      if (kind === "schema") expect(parse.mock.calls).toEqual([[{ plan: {} }], [planArgs]]);
      if (kind === "nested field") expect(parse.mock.calls).toEqual([[invalidFieldArgs], [planArgs]]);
      if (kind === "multiple fields") expect(parse.mock.calls).toEqual([[mixedArgs], [planArgs]]);
      if (kind === "surplus field") expect(parse.mock.calls).toEqual([[surplusArgs], [planArgs]]);
      if (kind === "decline") expect(parse.mock.calls).toEqual([[invalidFieldArgs]]);
      if (kind === "populated collection") expect(parse.mock.calls).toEqual([[populatedCollectionArgs]]);
      if (kind === "oversize") expect(parse).not.toHaveBeenCalled();
    }
  );
});

describe("staged Apple native analytical adapter", () => {
  it("keeps Apple registration disabled and makes unregistered surfaces explicit", () => {
    expect(packagedAppleNativePort({ VDT_APP_MODE: "desktop" })).toBeNull();
    expect(APPLE_NATIVE_SURFACES).toMatchObject({ agent_run: "adapter_ready", suggested_kpi: "adapter_ready", file_analysis: "adapter_ready" });
  });

  const archiveDeliverable = "Build an editable factor tree for the reviewer-hours we spend each month reviewing already-digitized archival recordings.";
  const archiveBrief = `${archiveDeliverable} Each recording is reviewed once by one reviewer. Count only active review time for the recordings reviewed that month. The measurements we track are the number of recordings reviewed and the average active review time in hours per recording for the same month. Exclude scanning, digitization, transcription, rework and approvals. Leave both measurement values blank so I can enter them later.`;
  const archiveProposal = (evidenceQuote: string, outcome = "structural_model") =>
    guided("Archive outcome.", { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome, evidenceQuote } });

  const withArchiveBrief = (request: ModelAgentTurnRequest, prompt = archiveBrief): ModelAgentTurnRequest => ({
    ...request, delta: { type: "initial_context", contextHash: "initial", context: {
      brief: { prompt, businessContext: "Earlier assistant wording does not qualify." }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT
    } }
  });
  const chooseQuote = (text: string, branch = "outcomeProposal", extra = {}) => (request: AppleCompletionRequest) => {
    const choices = Object.entries(JSON.parse(request.prompt).quoteChoices);
    expect(choices.every(([, value]) => typeof value === "string" && value.length <= 400)).toBe(true);
    const id = choices.find(([, value]) => value === text)?.[0];
    expect(id).toMatch(/^q_[a-f0-9]+$/);
    return guided("Selected excerpt.", { tool: PROPOSE_OUTCOME, [branch]: {
      outcome: "structural_model", evidenceQuoteId: id, ...extra
    } });
  };

  it.each(["exact ID", "translated text", "unknown ID", "clarification"] as const)(
    "bounds a verified ordinary quote rejection to one current-evidence retry with %s", async selection => {
      const { turn, request, proposeOnce, calls } = automaticFixture();
      const original = "Build an editable factor tree.";
      const current = "Построй дерево выручки от тарифа «Плюс». Измерения оставь пустыми.";
      const first = withArchiveBrief(request, original);
      proposeOnce(archiveProposal(original));
      await turn.completeTurn(first);
      proposeOnce(archiveProposal("Build the revenue tree for the Plus plan."));
      const updated: ModelAgentTurnRequest = { ...first, exchangeId: "exchange-updated", delta: {
        type: "human_input", input: { type: "user_instruction", text: current }
      } };
      const updatedResult = modelAgentStructuredTurnSchema.parse((await turn.completeTurn(updated)).output).action;
      if (updatedResult.type !== "action_batch") throw new Error("Expected the model's previous proposal.");
      const rejected = (exchangeId: string, externalCallId: string): ModelAgentTurnRequest => ({
        ...first, exchangeId, delta: { type: "tool_results", batchId: "quote-rejected", results: [{
          toolName: PROPOSE_OUTCOME, externalCallId, status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
        }] }
      });
      proposeOnce((native: AppleCompletionRequest) => {
        const prompt = JSON.parse(native.prompt);
        expect(prompt.latestUserInstruction).toBe(current);
        expect(Object.values(prompt.quoteChoices)).toContain(current);
        expect(Object.values(prompt.quoteChoices).every(quote => typeof quote === "string" && current.includes(quote))).toBe(true);
        expect(prompt.sessionState).toBeUndefined();
        if (selection === "clarification") return guided("Clarify the deliverable.", { tool: "user.ask",
          focusedQuestion: { question: "Нужно дерево тарифа или общей выручки?", reason: "Объём модели зависит от выбранного показателя." } });
        if (selection === "translated text") return archiveProposal("Build a revenue tree.");
        if (selection === "unknown ID") return guided("Invented ID.", { tool: PROPOSE_OUTCOME,
          outcomeProposal: { outcome: "structural_model", evidenceQuoteId: "q_unknown" } });
        return chooseQuote(current)(native);
      });
      const retry = turn.completeTurn(rejected("exchange-retry", updatedResult.batch.calls[0]!.externalCallId));
      if (selection === "translated text" || selection === "unknown ID") {
        await expect(retry).rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY" });
      } else if (selection === "clarification") {
        expect((await retry).output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
      } else {
        const response = modelAgentStructuredTurnSchema.parse((await retry).output).action;
        if (response.type !== "action_batch") throw new Error("Expected the corrected outcome proposal.");
        expect(response.batch.calls[0]?.args).toMatchObject({ outcome: "structural_model", evidenceQuote: current });
        await expect(turn.completeTurn(rejected("exchange-third", response.batch.calls[0]!.externalCallId)))
          .rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY", reason: "HOST_EVIDENCE" });
      }
      expect(calls).toHaveLength(3);
    }
  );

  it.each(["submitted answer", "unavailable answer", "mismatched receipt"] as const)(
    "uses only available retained evidence after %s", async source => {
      const { turn, request, proposeOnce, calls } = automaticFixture();
      const first = withArchiveBrief(request, "Please help with this dashboard.");
      proposeOnce(guided("Clarify first.", { tool: "user.ask", focusedQuestion: {
        question: "What would you like to accomplish?", reason: "The deliverable is unclear."
      } }));
      await turn.completeTurn(first);
      const answer = "Нужно редактируемое дерево «Доходы».";
      const answers = source === "unavailable answer" ? { structuredAnswers: [
        { questionId: "scope", fields: { project: "Доходы", goal: "Модель" } }
      ] } : { scope: answer };
      proposeOnce(archiveProposal("I need an editable revenue tree."));
      const proposal = await turn.completeTurn({ ...first, exchangeId: "answered", delta: {
        type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers }
      } });
      const action = modelAgentStructuredTurnSchema.parse(proposal.output).action;
      if (action.type !== "action_batch") throw new Error("Expected an outcome proposal.");
      proposeOnce((native: AppleCompletionRequest) => {
        const prompt = JSON.parse(native.prompt);
        if (source === "mismatched receipt") {
          expect(prompt.quoteChoices).toBeUndefined();
        } else if (source === "submitted answer") {
          expect(prompt.submittedOutcomeInputs).toEqual([{ type: "user_answer", questionSetId: "questions-exchange-1:call", answers }]);
          return chooseQuote(answer)(native);
        } else {
          expect(prompt.quoteChoices).toEqual({});
          expect(JSON.stringify(native.schema)).not.toContain('"name":"outcomeProposal"');
        }
        return guided("Clarify the goal.", { tool: "user.ask", focusedQuestion: {
          question: "What deliverable would you like?", reason: "The submitted answer did not settle the scope."
        } });
      });
      const result = await turn.completeTurn({ ...first, exchangeId: "answer-retry", delta: {
        type: "tool_results", batchId: "outcome", results: [{
          toolName: PROPOSE_OUTCOME, externalCallId: source === "mismatched receipt" ? "unrelated:call" : action.batch.calls[0]!.externalCallId,
          status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
        }]
      } });
      expect(result.output).toMatchObject({ action: { batch: { calls: [source === "submitted answer"
        ? { toolName: PROPOSE_OUTCOME, args: { evidenceQuote: answer, outcome: "structural_model" } }
        : { toolName: "user.ask" }] } } });
      expect(calls).toHaveLength(3);
    }
  );

  it.each(["new scope", "same scope"] as const)("keeps quotation repair bounded across %s", async scope => {
    const { turn, request, proposeOnce, calls } = automaticFixture();
    const first = withArchiveBrief(request, "Build a dashboard.");
    const oldScope = "Build a revenue tree and let me approve the method before you build it.";
    const newScope = scope === "new scope" ? "Build an operating cost tree. Use the method you select." : oldScope;
    proposeOnce(archiveProposal("Build it."));
    await turn.completeTurn(first);
    const instruction = (exchangeId: string, text: string): ModelAgentTurnRequest => ({
      ...first, exchangeId, delta: { type: "human_input", input: { type: "user_instruction", text } }
    });
    const reject = async (exchangeId: string, output: unknown) => {
      const action = modelAgentStructuredTurnSchema.parse(output).action;
      if (action.type !== "action_batch") throw new Error("Expected an outcome proposal.");
      return turn.completeTurn({ ...first, exchangeId, delta: { type: "tool_results", batchId: exchangeId, results: [{
        toolName: PROPOSE_OUTCOME, externalCallId: action.batch.calls[0]!.externalCallId,
        status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
      }] } });
    };
    proposeOnce(guided("Unverified confirmation proposal.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "structural_model", evidenceQuote: "Build revenue.", confirmSkillMethod: true
    } }));
    const previous = await turn.completeTurn(instruction("old", oldScope));
    proposeOnce((native: AppleCompletionRequest) => {
      expect(JSON.parse(native.prompt).methodConfirmationPolicy).toContain("Preserve the pending method confirmation request.");
      return chooseQuote(oldScope)(native);
    });
    expect((await reject("reject-old", previous.output)).output).toMatchObject({ action: { batch: { calls: [{
      toolName: PROPOSE_OUTCOME, args: { evidenceQuote: oldScope, confirmSkillMethod: true }
    }] } } });

    proposeOnce(archiveProposal("Use this for the model."));
    const current = await turn.completeTurn(instruction("current", newScope));
    if (scope === "same scope") {
      await expect(reject("reject-current", current.output))
        .rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY", reason: "HOST_EVIDENCE" });
      expect(calls).toHaveLength(4);
    } else {
      proposeOnce((native: AppleCompletionRequest) => {
        const prompt = JSON.parse(native.prompt);
        expect(prompt.methodConfirmationPolicy).toBeUndefined();
        expect(Object.values(prompt.quoteChoices)).not.toContain(oldScope);
        return chooseQuote(newScope)(native);
      });
      const result = modelAgentStructuredTurnSchema.parse((await reject("reject-current", current.output)).output).action;
      if (result.type !== "action_batch") throw new Error("Expected a corrected outcome proposal.");
      expect(result.batch.calls[0]?.args).toMatchObject({ outcome: "structural_model", evidenceQuote: newScope });
      expect(result.batch.calls[0]?.args).not.toHaveProperty("confirmSkillMethod");
      expect(calls).toHaveLength(5);
    }
  });

  it("re-proposes an overlong Automatic quote once and emits only the accepted literal evidence", async () => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    expect(archiveBrief).toHaveLength(514);
    proposeOnce(archiveProposal(archiveBrief));
    propose(chooseQuote(archiveDeliverable));
    const result = await turn.completeTurn(withArchiveBrief(request));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ locale: calls[0]!.locale, expectedIdentity: calls[0]!.expectedIdentity });
    expect(JSON.stringify(calls[0]!.schema).match(/at most 400 characters/g)).toHaveLength(2);
    expect(JSON.parse(calls[1]!.prompt).revisionInstruction).toMatch(/too long.*evidenceQuoteId/);
    expect(JSON.stringify(calls[1]!.schema)).toContain('"name":"evidenceQuoteId"');
    expect(JSON.stringify(calls[1]!.schema)).not.toContain('"name":"evidenceQuote"');
    expect(Object.values(JSON.parse(calls[1]!.prompt).quoteChoices).every(text => typeof text === "string" && archiveBrief.includes(text))).toBe(true);
    expect(result.output).toMatchObject({ action: { type: "action_batch", batch: { calls: [
      { toolName: PROPOSE_OUTCOME, args: { outcome: "structural_model", evidenceQuote: archiveDeliverable } }
    ] } } });
  });

  it.each([
    ["unrelated canonical issue", archiveProposal("")],
    ["multiple canonical issues", archiveProposal(archiveBrief, "wrong_outcome")],
    ["invalid session state with an overlong quote", { ...archiveProposal(archiveBrief), sessionState: " " }],
    ["native failure", new AppleTransportError("invalid_output", "native_output")],
    ["cancellation", new AppleTransportError("cancelled")]
  ])("does not retry Automatic %s", async (_label, proposal) => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    proposeOnce(proposal);
    propose(archiveProposal(archiveDeliverable));
    await expect(turn.completeTurn(request)).rejects.toBeInstanceOf(AppleTransportError);
    expect(calls).toHaveLength(1);
  });

  it("fails closed when the retry sends a free-text quote instead of a choice", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    propose(archiveProposal(archiveBrief));
    await expect(turn.completeTurn(withArchiveBrief(request))).rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(2);
  });

  it("rejects invented excerpt IDs with no further attempt", async () => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    proposeOnce(archiveProposal(archiveBrief));
    propose(guided("Invented excerpt.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "structural_model", evidenceQuoteId: "q_invented"
    } }));
    await expect(turn.completeTurn(withArchiveBrief(request))).rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY" });
    expect(calls).toHaveLength(2);
  });

  it("does not retry when the only complete excerpt is overlong", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const longSentence = "Request " + "words ".repeat(85) + "here.";
    propose(archiveProposal(longSentence));
    await expect(turn.completeTurn(withArchiveBrief(request, longSentence)))
      .rejects.toMatchObject({ stage: "OUTCOME_ACTION", reason: "OUTCOME_QUOTE_TOO_LONG" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the focused question alternative available in the closed quote retry", async () => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    proposeOnce(archiveProposal(archiveBrief));
    const focusedQuestion = { question: "Should the tree describe review work or forecast it?", reason: "The deliverable changes." };
    propose(guided("Clarification.", { tool: "user.ask", focusedQuestion }));
    const result = await turn.completeTurn(withArchiveBrief(request));
    expect(calls).toHaveLength(2);
    expect(result.output).toMatchObject({ action: { batch: { calls: [
      { toolName: "user.ask", args: { questions: [{ ...focusedQuestion, required: true }] } }
    ] } } });
  });

  it.each(["plain", "structured text", "structured field"])("offers exact current %s answers without adding other brief fields", async kind => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    proposeOnce(guided("Clarification.", { tool: "user.ask", focusedQuestion: {
      question: "What deliverable do you want?", reason: "Clarify the scope."
    } }));
    const asked = await turn.completeTurn(withArchiveBrief(request));
    const answer = "Build the editable tree for active review hours only.";
    const answers = kind === "plain" ? { outcome: answer } : { structuredAnswers: [{
      questionId: "outcome", ...(kind === "structured text" ? { freeText: answer } : { fields: { answer } })
    }] };
    proposeOnce(archiveProposal(archiveBrief));
    propose(chooseQuote(answer));
    const result = await turn.completeTurn({ ...request, exchangeId: "archive-answered", previousCursor: asked.cursor,
      delta: { type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers } } });
    expect(calls).toHaveLength(3);
    expect(Object.values(JSON.parse(calls[2]!.prompt).quoteChoices)).not.toContain("Earlier assistant wording does not qualify.");
    expect(result.output).toMatchObject({ action: { batch: { calls: [
      { toolName: PROPOSE_OUTCOME, args: { evidenceQuote: answer } }
    ] } } });
  });

  it("withholds the original excerpts after an invalid newer instruction", async () => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    proposeOnce(guided("Clarification.", { tool: "user.ask", focusedQuestion: {
      question: "What deliverable do you want?", reason: "Clarify the scope."
    } }));
    const asked = await turn.completeTurn(withArchiveBrief(request));
    const newer = "Amended " + "word ".repeat(450);
    propose(archiveProposal(newer));
    await expect(turn.completeTurn({ ...request, exchangeId: "archive-amended", previousCursor: asked.cursor,
      delta: { type: "human_input", input: { type: "user_instruction", text: newer } } }))
      .rejects.toMatchObject({ stage: "OUTCOME_ACTION", reason: "OUTCOME_QUOTE_TOO_LONG" });
    expect(calls).toHaveLength(2);
  });

  it("projects the exact selected workbook excerpt and leaves selectors for the normal Gateway", async () => {
    const { turn, request, proposeOnce, propose, calls } = automaticFixture();
    const excerpt = "Export the saved Plan scenario to Excel from revision rev_17.";
    const prompt = `${excerpt} ${archiveBrief}`;
    const artifact = { kind: "excel_workbook", scenarioName: "Plan", revisionId: "rev_17" };
    proposeOnce(guided("Overlong workbook quote.", { tool: PROPOSE_OUTCOME, workbookProposal: {
      outcome: "structural_model", evidenceQuote: prompt, artifact
    } }));
    propose(chooseQuote(excerpt, "workbookProposal", { artifact }));
    const result = await turn.completeTurn(withArchiveBrief(request, prompt));
    expect(calls).toHaveLength(2);
    expect(result.output).toMatchObject({ action: { batch: { calls: [
      { toolName: PROPOSE_OUTCOME, args: { outcome: "structural_model", evidenceQuote: excerpt, artifact } }
    ] } } });
  });

  it("keeps the pending method confirmation during an intent correction with an overlong quote", async () => {
    const { turn, request, proposeOnce, propose, calls, reviewOutcomeWith } = automaticFixture();
    proposeOnce(guided("Initial classification.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "answer", evidenceQuote: archiveDeliverable, confirmSkillMethod: true
    } }));
    reviewOutcomeWith(() => ({ outcome: "structural_model" }));
    proposeOnce(guided("Corrected classification.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "structural_model", evidenceQuote: archiveBrief, confirmSkillMethod: true
    } }));
    propose(chooseQuote(archiveDeliverable));
    await expect(turn.completeTurn(withArchiveBrief(request))).rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(4);
    const retry = JSON.parse(calls[3]!.prompt);
    expect(retry.revisionInstruction).toContain("Propose structural_model");
    expect(retry.methodConfirmationPolicy).toContain("confirmSkillMethod to true");
  });

  it("maps Automatic guided workbook intent and confirmation through the existing proposal schema", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const artifact = { kind: "excel_workbook", scenarioName: "Plan", revisionId: "rev_17" };
    const workbookProposal = { outcome: "structural_model", evidenceQuote: "Export the saved Plan scenario to Excel", confirmSkillMethod: true, artifact };
    propose(guided("The user named a saved revision.", { tool: PROPOSE_OUTCOME, workbookProposal }));
    const result = await turn.completeTurn(request);
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME, args: workbookProposal }] } } });
    expect(JSON.parse(calls[0]!.prompt)).toMatchObject({ outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT });
    expect(calls[0]?.schema.fields.map(field => field.name)).toEqual(["sessionState", "action"]);
    expect(calls[0]?.schema.fields[1]?.shape).toMatchObject({ kind: "union", variants: [
      { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: [PROPOSE_OUTCOME] } }, { name: "outcomeProposal", optional: false }] },
      { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: [PROPOSE_OUTCOME] } }, { name: "workbookProposal", optional: false }] },
      { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: ["user.ask"] } }, { name: "focusedQuestion", optional: false }] }
    ] });
    propose({ ...guided("Try a second branch.", { tool: PROPOSE_OUTCOME, workbookProposal }),
      focusedQuestion: { question: "Which revision?", reason: "An extra branch." } });
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("forwards the user-supplied workbook version name for canonical resolution", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const workbookProposal = { outcome: "answer", evidenceQuote: "Из сохранённой версии «Проверка линии»",
      artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "Проверка линии" } };
    propose(guided("The user named a saved version.", { tool: PROPOSE_OUTCOME, workbookProposal }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: {
      calls: [{ toolName: PROPOSE_OUTCOME, args: workbookProposal }]
    } } });
    expect(JSON.stringify(calls[0]?.schema)).toContain('"name":"versionName"');
  });

  it("admits an ordinary structural outcome with method confirmation and offers no artifact fields", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const outcomeProposal = { outcome: "structural_model", evidenceQuote: "Build a tree and leave measurements blank.", confirmSkillMethod: true };
    propose(guided("Build editable structure.", { tool: PROPOSE_OUTCOME, outcomeProposal }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: {
      calls: [{ toolName: PROPOSE_OUTCOME, args: { ...outcomeProposal, artifact: null } }]
    } } });
    const shape = calls[0]?.schema.fields[1]?.shape;
    expect(shape?.kind === "union" && JSON.stringify(shape.variants[0])).not.toContain("artifact");
    expect(JSON.parse(calls[0]!.prompt).instruction).toContain("Deferred measurements still allow an editable structure");
    expect(shape?.kind === "union" && shape.variants[0]?.kind === "object" && shape.variants[0].fields[1]?.shape).toMatchObject({
      kind: "object", fields: [{ name: "evidenceQuote" }, { name: "outcome", description: expect.stringContaining("read-only") },
        { name: "confirmSkillMethod" }].map(field => expect.objectContaining(field))
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    { prompt: "Постройте дерево затрат. Измерения внесу позже.", first: "answer", expected: "structural_model" },
    { prompt: "Create the editable cost model and leave the current inputs blank.", first: "calculated_baseline", expected: "structural_model" },
    { prompt: "How should I build a model of monthly service costs? Please explain.", first: "answer", expected: "answer" },
    { prompt: "Calculate the verified cost from four hours at 50 USD per hour.", first: "calculated_baseline", expected: "calculated_baseline" }
  ])("checks $first against the actual deliverable and permits $expected", async ({ prompt, first, expected }) => {
    const { turn, request, propose, calls, reviewOutcomeWith } = automaticFixture();
    const context = { brief: { prompt }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT };
    const proposal = (outcome: string) => guided("Classify deliverable.", { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome, evidenceQuote: prompt } });
    propose(proposal(first));
    reviewOutcomeWith(() => {
      propose(proposal(expected));
      return { outcome: expected };
    });
    const completed = await turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "initial", context } });
    expect(completed.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME,
      args: { outcome: expected, evidenceQuote: prompt, artifact: null }
    }] } } });
    expect(calls).toHaveLength(first === expected ? 2 : 3);
    const review = JSON.parse(calls[1]!.prompt);
    expect(review.originalBrief.prompt).toBe(prompt);
    expect(review).not.toHaveProperty("proposedOutcome");
    if (first !== expected) expect(JSON.parse(calls[2]!.prompt).revisionInstruction).toContain(expected);
  });

  it("uses the full submitted clarification and refuses a second contradictory classification", async () => {
    const { turn, request, propose, calls, reviewOutcomeWith } = automaticFixture();
    const init = { ...request, delta: { type: "initial_context", contextHash: "initial",
      context: { brief: { prompt: "Help with the cost model." }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT } } } as const;
    propose(guided("Ask which result.", { tool: "user.ask", focusedQuestion: { question: "What would you like to receive?", reason: "The deliverable scopes this run." } }));
    const first = await turn.completeTurn(init);
    const answer = "Постройте редактируемое дерево затрат. Исходные данные я внесу позже.";
    const input = { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { structuredAnswers: [
      { questionId: "deliverable", fields: { answer } }
    ] } } as const;
    propose(guided("Misclassify twice.", { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "answer", evidenceQuote: answer } }));
    reviewOutcomeWith(() => ({ outcome: "structural_model" }));
    await expect(turn.completeTurn({ ...request, exchangeId: "exchange-2", previousCursor: first.cursor,
      delta: { type: "human_input", input } })).rejects.toMatchObject({ code: "invalid_output",
      message: "The native Apple model returned invalid output. [APPLE_OUTCOME_INTENT_HOST_EVIDENCE]" });
    expect(JSON.parse(calls[2]!.prompt).submittedInputs).toEqual([input]);
    expect(JSON.parse(calls[3]!.prompt).checkpoint.input).toEqual(input);
    expect(calls).toHaveLength(4);
  });

  it.each([undefined, false])("rejects a corrected build outcome that drops method confirmation (%s)", async confirmSkillMethod => {
    const { turn, request, propose, calls, reviewOutcomeWith } = automaticFixture();
    const prompt = "Build the cost model. Ask me to approve the method first.";
    const context = { brief: { prompt }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT };
    propose(guided("Classify the request.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "answer", evidenceQuote: prompt, confirmSkillMethod: true
    } }));
    reviewOutcomeWith(() => {
      propose(guided("Correct the deliverable.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
        outcome: "structural_model", evidenceQuote: prompt, ...(confirmSkillMethod !== undefined ? { confirmSkillMethod } : {})
      } }));
      return { outcome: "structural_model" };
    });
    await expect(turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "initial", context } }))
      .rejects.toMatchObject({ code: "invalid_output" });
    expect(JSON.parse(calls[2]!.prompt).methodConfirmationPolicy).toContain("confirmSkillMethod to true");
  });

  it("preserves method confirmation if the corrected exchange first asks about the deliverable", async () => {
    const { turn, request, propose, calls, reviewOutcomeWith } = automaticFixture();
    const prompt = "Help with the cost model. Let me approve the method before any changes.";
    const context = { brief: { prompt }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT };
    propose(guided("Classify the request.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "answer", evidenceQuote: prompt, confirmSkillMethod: true
    } }));
    reviewOutcomeWith(() => {
      propose(guided("Clarify the outcome.", { tool: "user.ask", focusedQuestion: {
        question: "Should I explain or build the model?", reason: "The requested deliverable is unclear."
      } }));
      return { outcome: "unclear" };
    });
    const asked = await turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "initial", context } });
    const answer = "Build the editable model.";
    propose(guided("Classify the clarified request.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
      outcome: "structural_model", evidenceQuote: answer
    } }));
    await expect(turn.completeTurn({ ...request, exchangeId: "exchange-2", previousCursor: asked.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { outcome: answer } }
    } })).rejects.toMatchObject({ code: "invalid_output" });
    expect(JSON.parse(calls[3]!.prompt).methodConfirmationPolicy).toContain("confirmSkillMethod to true");
  });

  it("maps a focused Automatic question to the normal required user.ask interaction", async () => {
    const { turn, request, propose } = automaticFixture();
    const focusedQuestion = { question: "Which revision should I export?", reason: "The revision changes the workbook content." };
    propose(guided("Ask which revision.", { tool: "user.ask", focusedQuestion }));
    const result = await turn.completeTurn(request);
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask", args: { questions: [
      { ...focusedQuestion, id: expect.stringMatching(/^apple_automatic_scope_/), required: true, expectedAnswerType: "text" }
    ] } }] } } });
  });

  it.each([
    { tool: "vdt.create_draft" },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "structural_model" } },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "guess", evidenceQuote: "Original quote" } },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "answer", evidenceQuote: "Original quote", artifact: { kind: "excel_workbook", revisionId: "??" } } },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "structural_model", evidenceQuote: "Original quote", artifact: { kind: "excel_workbook", scenarioName: "Fabricated" } } },
    { tool: PROPOSE_OUTCOME, workbookProposal: { outcome: "answer", evidenceQuote: "Original quote", artifact: { kind: "excel_workbook", revisionId: "??" } } },
    { tool: PROPOSE_OUTCOME, workbookProposal: { outcome: "answer", evidenceQuote: "Original quote" } },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "structural_model", evidenceQuote: "Original quote" }, argumentsJson: "{}" },
    { tool: PROPOSE_OUTCOME, outcomeProposal: { outcome: "structural_model", evidenceQuote: "Original quote" }, focusedQuestion: { question: "What?", reason: "Missing scope." } },
    { tool: "user.ask", outcomeProposal: { outcome: "answer", evidenceQuote: "Original quote" }, focusedQuestion: { question: "What?", reason: "Missing scope." } }
  ])("fails closed on an invalid guided Automatic proposal %o", async proposal => {
    const { turn, request, propose } = automaticFixture();
    propose(guided("Resolve the request.", proposal));
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("carries full original brief, selected Skill and host scope through continuation and emits a canonical tool proposal", async () => {
    const { turn, calls, discover } = fixture();
    const started = await turn.completeTurn(initial);
    expect(started.output).toMatchObject({
      turnId: "exchange-1",
      action: { type: "action_batch", batch: { calls: [{ externalCallId: "exchange-1:call", toolName: "project.get_current", args: {} }] } }
    });
    await turn.completeTurn({
      ...initial, exchangeId: "exchange-2", previousCursor: started.cursor,
      delta: { type: "human_input", input: { type: "user_instruction", text: "Use the most recent reporting period." } }
    });
    expect(discover).toHaveBeenCalledTimes(2);
    expect(JSON.parse(calls[1]!.prompt)).toMatchObject({
      responseLocale: "en-US",
      originalBrief: { prompt: "100 units at 20 USD per unit, keep the full original wording.", selectedNodeId: "root-1", selectedSkill: { id: "skill-1", version: 3 } },
      confirmedConversation: { source: "submitted answer" },
      checkpoint: { input: { text: "Use the most recent reporting period." } },
      observation: { selectedNode: "root-1" }
    });
    const continuation = JSON.parse(calls[1]!.prompt);
    expect(continuation).not.toHaveProperty("skillResolutionPolicy");
    expect(continuation.originalBrief).not.toHaveProperty("businessContext");
  });

  it.each([
    { tool: "research.search_web", argumentsJson: "{}" },
    { tool: "project.get_current", argumentsJson: "[]" },
    { tool: "project.get_current", argumentsJson: '{"projectId":"outside-run"}' },
    { tool: "project.get_current", argumentsJson: "{}", finishReceiptId: "invented" }
  ])("rejects noncanonical native tool actions", async proposal => {
    const { turn, propose } = fixture();
    propose({ sessionState: "Do work.", ...proposal });
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("still rejects null arguments when the selected tool requires input", async () => {
    const { turn, propose, readStage } = fixture();
    const validateArguments = vi.fn((args: unknown) => {
      if (JSON.stringify(args) === "{}") throw new Error("A required argument is missing.");
      return {};
    });
    readStage.mockReturnValue({
      observation: { selectedNode: "root-1", revision: 1 },
      tools: [{ name: "project.get_subtree", summary: "Read a subtree.", arguments: { type: "object", properties: {} }, validateArguments }]
    });
    propose({ sessionState: "Read the relevant subtree.", tool: "project.get_subtree", argumentsJson: null });
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
    expect(validateArguments).toHaveBeenCalledWith({});
  });

  it.each([{}, { offset: 16 }])("uses only the trusted Skill list arguments %o", async skillListArguments => {
    const { turn, propose, readStage, calls } = fixture();
    const validateArguments = vi.fn((args: unknown) => {
      expect(args).toEqual(skillListArguments);
      return skillListArguments;
    });
    readStage.mockReturnValue({
      observation: {}, skillDiscovery: true, skillListArguments,
      tools: [
        { name: "skill.list", summary: "Browse the next page.", arguments: {}, validateArguments },
        { name: "user.ask", summary: "Ask a material question.", arguments: {}, validateArguments: () => ({}) }
      ]
    });
    propose(guided("Review available guidance.", { tool: "skill.list",
      focusedQuestion: { question: "Are the stages in series?", reason: "The process connection changes the capacity formula." } }));
    const result = await turn.completeTurn(initial);
    expect(result.output).toMatchObject({ action: { batch: {
      calls: [{ toolName: "skill.list", args: skillListArguments }]
    } } });
    expect(validateArguments).toHaveBeenCalledOnce();
    expect(calls[0]?.schema.fields[1]?.shape).toMatchObject({ kind: "union", variants: [
      { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: ["skill.list"] } }] },
      { kind: "object", fields: [{ name: "tool", shape: { kind: "choice", choices: ["user.ask"] } }, { name: "focusedQuestion" }] }
    ] });
    propose(guided("Try choosing a cursor.", { tool: "skill.list", argumentsJson: '{"offset":2000}' }));
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it.each(["exact", "unread"])("uses a host Skill receipt only for the exact proposed ID (%s)", async skillId => {
    const { turn, propose, readStage, calls } = fixture();
    const validateArguments = vi.fn((args: unknown) => args as Record<string, unknown>);
    readStage.mockReturnValue({
      observation: {}, skillDiscovery: true, skillSelectReceipts: new Map([["exact", "current-receipt"]]),
      tools: [{ name: "skill.select", summary: "Select an exact Skill.", arguments: {}, validateArguments }]
    });
    const skillSelection = { skillId, reason: "This method fits the requested boundary.", confirmMethod: true };
    propose(guided("Propose a relevant method.", { tool: "skill.select", skillSelection }));
    const result = await turn.completeTurn(initial);
    const args = { ...skillSelection, ...(skillId === "exact" ? { readReceiptId: "current-receipt" } : {}) };
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.select", args }] } } });
    expect(validateArguments).toHaveBeenCalledExactlyOnceWith(args);
    expect(calls[0]?.schema.fields[1]?.shape).toMatchObject({ kind: "object", fields: [
      { name: "tool", shape: { kind: "choice", choices: ["skill.select"] } },
      { name: "skillSelection", optional: false, shape: { kind: "object", fields: [
        { name: "skillId", shape: { kind: "choice", choices: ["exact"] } }, { name: "reason" }, { name: "confirmMethod" }
      ] } }
    ] });
    propose(guided("Try copying a receipt.", { tool: "skill.select", skillSelection: { ...skillSelection, readReceiptId: "wrong" } }));
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("keeps exact text and receipt validation for a custom Skill ID beyond the guide limit", async () => {
    const { turn, propose, readStage, calls } = fixture();
    const skillId = `user.${"custom".repeat(17)}`;
    const tool = createDefaultToolRegistry().list().find(tool => tool.name === "skill.select")!;
    readStage.mockReturnValue({
      observation: {}, skillDiscovery: true, skillSelectReceipts: new Map([[skillId, "custom-receipt"]]),
      tools: [{ name: tool.name, summary: tool.description, arguments: {},
        validateArguments: value => tool.inputSchema.parse(value) as Record<string, unknown> }]
    });
    const skillSelection = { skillId, reason: "The reviewed custom Skill covers this scope." };
    propose(guided("Use the reviewed custom Skill.", { tool: "skill.select", skillSelection }));
    expect((await turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [
      { toolName: "skill.select", args: { ...skillSelection, readReceiptId: "custom-receipt" } }
    ] } } });
    expect(calls[0]?.schema.fields[1]?.shape).toMatchObject({ kind: "object", fields: [
      { name: "tool" }, { name: "skillSelection", shape: { kind: "object", fields: [
        { name: "skillId", shape: { kind: "string" } }, { name: "reason" }, { name: "confirmMethod" }
      ] } }
    ] });
  });

  it("projects guided search, read, gap and one process-scope question through exact canonical validators", async () => {
    const { turn, propose, readStage, calls } = fixture();
    const names = ["skill.search", "skill.read", "skill.report_gap", "user.ask"];
    readStage.mockReturnValue({
      observation: {}, skillDiscovery: true, skillReadableIds: ["example"],
      tools: createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {}, validateArguments: args => tool.inputSchema.parse(args) as Record<string, unknown>
      }))
    });
    const question = { question: "Are the stages in series?", reason: "The relationship changes which method applies." };
    const cases = [
      ["skill.search", { skillSearch: { rootKpi: "Throughput", industry: null, businessContext: "Same reporting basis" } },
        { rootKpi: "Throughput", businessContext: "Same reporting basis" }],
      ["skill.read", { skillRead: { skillId: "example" } }, { skillId: "example" }],
      ["skill.report_gap", { skillGap: { reason: "No reviewed method fits." } }, { reason: "No reviewed method fits." }],
      ["user.ask", { focusedQuestion: question }, { questions: [{ ...question, id: "skill_scope", required: true, expectedAnswerType: "text" }] }]
    ] as const;
    for (const [toolName, fields, args] of cases) {
      propose(guided("Review the business scope.", { tool: toolName, ...fields }));
      expect((await turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{ toolName, args }] } } });
    }
    expect(calls[0]?.schema.fields.map(field => field.name)).not.toContain("argumentsJson");
    for (const proposal of [
      { tool: "skill.read", skillRead: { skillId: "example" }, skillGap: { reason: "mixed" } },
      { tool: "skill.read", skillRead: { skillId: "example", maxChars: 800 } },
      { tool: "skill.read", skillRead: { skillId: "already-read" } },
      { tool: "skill.search", skillSearch: { rootKpi: "Scope", maxSkills: 2 } },
      { tool: "skill.search", skillSearch: { rootKpi: "Scope", approval: true } },
      { tool: "user.ask", focusedQuestion: { ...question, id: "fake" } },
      { tool: "skill.select", skillSelection: { skillId: "example", reason: "invented" } }
    ]) {
      propose(guided("Untrusted proposal.", proposal));
      await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
    }
  });

  it.each([
    { reason: "The reviewed method matches the submitted flow and measurement basis. ".repeat(15),
      expected: /^The reviewed method matches the submitted flow and measurement basis\..*…$/u },
    { reason: `${"А".repeat(498)}й${"Б".repeat(300)}`, expected: /^А{498}…$/u }
  ])("bounds only the selected Skill's display reason without changing its receipt or confirmation", async ({ reason, expected }) => {
    const { turn, propose, readStage } = fixture();
    const tool = createDefaultToolRegistry().list().find(tool => tool.name === "skill.select")!;
    readStage.mockReturnValue({
      observation: {}, skillDiscovery: true, skillSelectReceipts: new Map([["exact", "receipt-exact"]]),
      tools: [{ name: tool.name, summary: tool.description, arguments: {},
        validateArguments: value => tool.inputSchema.parse(value) as Record<string, unknown> }]
    });
    propose(guided("Explain the fit.", { tool: "skill.select", skillSelection: { skillId: "exact", reason, confirmMethod: true } }));
    const result = modelAgentStructuredTurnSchema.parse((await turn.completeTurn(initial)).output);
    expect(result.action.type).toBe("action_batch");
    if (result.action.type !== "action_batch") throw new Error("Expected Skill selection.");
    const args = result.action.batch.calls[0]?.args;
    expect(args).toEqual({ skillId: "exact", reason: expect.stringMatching(expected), confirmMethod: true, readReceiptId: "receipt-exact" });
    expect(String(args?.reason).length).toBeLessThanOrEqual(500);
    expect(reason.startsWith(String(args?.reason).slice(0, -1))).toBe(true);
  });

  it.each([
    { kind: "bounded choice", skillReadableIds: ["unread"] },
    { kind: "exact validation fence", skillReadableIds: Array.from({ length: 25 }, (_, index) => `unread_${index}`) }
  ])("uses $kind for the unread set", async ({ skillReadableIds }) => {
      const { turn, propose, readStage, calls } = fixture();
      readStage.mockReturnValue({
        observation: {}, skillDiscovery: true, skillReadableIds,
        tools: [{ name: "skill.read", summary: "Read an unread Skill.", arguments: {}, validateArguments: args => args as Record<string, unknown> }]
      });
      propose(guided("Read an eligible candidate.", { tool: "skill.read", skillRead: { skillId: skillReadableIds[0] } }));
      const result = await turn.completeTurn(initial);
      expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.read", args: { skillId: skillReadableIds[0] } }] } } });
      expect(calls[0]?.schema.fields[1]?.shape).toMatchObject({ kind: "object", fields: [
        { name: "tool" }, { name: "skillRead", shape: { kind: "object", fields: [
          { name: "skillId", shape: skillReadableIds.length > 24 ? { kind: "string" } : { kind: "choice", choices: skillReadableIds } }
        ] } }
      ] });
      propose(guided("Try outside the shortlist.", { tool: "skill.read", skillRead: { skillId: "outside" } }));
      await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("compacts catalog cards while keeping real read contents and queued user facts", async () => {
    const { turn, calls } = fixture();
    const first = await turn.completeTurn(initial);
    const browse = { toolName: "skill.list", status: "succeeded", payload: { output: { nextOffset: 16, skills: [{
      id: "example", title: "Example Scope", description: "Relevant description", scope: ["boundary"], scopeGuidance: ["Avoid guessing"],
      requiredInputs: ["Deferred quantity"], outputs: ["A formula"]
    }] } } };
    const read = { toolName: "skill.read", status: "succeeded", payload: { output: {
      id: "example", excerpt: "Full read content remains available.", formulaTemplates: ["total = a + b"]
    } } };
    const queued = { type: "user_instruction", text: "Use the confirmed discharge boundary." } as const;
    await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: first.cursor,
      delta: { type: "checkpoint_inputs", checkpointDelta: { type: "tool_results", batchId: "batch", results: [browse, read] }, inputs: [queued] }
    });
    const checkpoint = JSON.parse(calls[1]!.prompt).checkpoint;
    expect(checkpoint.checkpointDelta.results[0].payload.output).toEqual({ nextOffset: 16,
      skills: [{ id: "example", title: "Example Scope", description: "Relevant description", scope: ["boundary"], scopeGuidance: ["Avoid guessing"] }] });
    expect(checkpoint.checkpointDelta.results[1]).toEqual(read);
    expect(checkpoint.inputs).toEqual([queued]);
    expect(browse.payload.output.skills[0]?.requiredInputs).toEqual(["Deferred quantity"]);
  });

  it("keeps the current read excerpt in its checkpoint and carries prior method evidence without duplication", async () => {
    const { turn, calls, propose, readStage } = fixture();
    const first = await turn.completeTurn(initial);
    const method = { skillId: "current", readReceiptId: "read-current", excerpt: "Evaluate the confirmed process boundary." };
    const other = { skillId: "earlier", readReceiptId: "read-earlier", excerpt: "An alternative scope." };
    const observation = { outcome: "structural_model", readSkillMethods: [method, other] };
    const ask = createDefaultToolRegistry().list().find(tool => tool.name === "user.ask")!;
    readStage.mockReturnValue({ observation, skillDiscovery: true, tools: [{
      name: ask.name, summary: ask.description, arguments: {},
      validateArguments: args => ask.inputSchema.parse(args) as Record<string, unknown>
    }] });
    propose(guided("Ask a material scope question.", { tool: "user.ask", focusedQuestion: {
      question: "Do both stages share the same material flow?", reason: "The answer changes the applicable method."
    } }));
    const current = { toolName: "skill.read", status: "succeeded", payload: { output: {
      id: method.skillId, readReceiptId: method.readReceiptId, excerpt: method.excerpt
    } } };
    await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: first.cursor,
      delta: { type: "tool_results", batchId: "read", results: [current] }
    });
    const prompt = JSON.parse(calls[1]!.prompt);
    expect(prompt.checkpoint.results).toEqual([current]);
    expect(prompt.observation.readSkillMethods).toEqual([other]);
    expect(observation.readSkillMethods).toEqual([method, other]);
    expect(prompt.instruction).toContain("Names and order alone do not establish those relationships.");
    expect(prompt.instruction).toContain("Use the user's business terms");
    expect(prompt.instruction).toContain("if choosing would require clarification, ask instead");
  });

  it.each([
    { kind: "answered archive question with unavailable catalog projection", review: "anchored", permitsGap: true, tool: undefined },
    { kind: "answered question with a prior method but unavailable catalog projection", review: "anchored", permitsGap: true, priorRead: true, tool: undefined },
    { kind: "genuine missing reporting boundary", review: "unresolved", permitsGap: true, tool: "user.ask" },
    { kind: "unsupported continuation", review: "unanchored", permitsGap: true, tool: "user.ask" },
    { kind: "native review timeout", review: "timeout", permitsGap: true, tool: "user.ask" },
    { kind: "incomplete catalog", review: "skip", permitsGap: false, tool: "user.ask" },
    { kind: "empty search superseded by steering", review: "skip", permitsGap: false, stale: true, tool: "user.ask" },
    { kind: "explicit pin", review: "skip", permitsGap: false, pinnedMethod: true, tool: "user.ask" },
    { kind: "model refuses the one re-proposal", review: "repeat", permitsGap: true, tool: undefined }
  ])("reviews only a currently gap-eligible first question for $kind", async ({ review, permitsGap, stale, pinnedMethod, priorRead, tool }) => {
    const { turn, calls, readStage, propose, reviewWith } = fixture();
    const { cursor } = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "archive-original",
      context: { brief: { prompt: review === "unresolved"
        ? "Build an editable tree for monthly archival review hours. I have not decided whether waiting time counts."
        : "Build an editable tree for monthly review hours from already-digitized archival recordings. Each recording is reviewed once. Count only active review hours. Measure recordings reviewed that month and average active review hours per recording. Leave both values blank." } }
    } });
    const question = review === "unresolved"
      ? "Should the KPI count waiting time or active review time alone?"
      : "What defines the monthly allocation of reviewer time for each archived recording?";
    const ask = guided("Clarify the calculation scope.", {
      tool: "user.ask", focusedQuestion: { question, reason: "It determines the calculation boundary." }
    });
    const allowed = permitsGap ? ["user.ask", "skill.report_gap"] : ["user.ask"];
    const prior = { skillId: "reviewed-method", readReceiptId: "existing-read", version: 1,
      contentHash: "existing-hash", excerpt: "Review the asset inventory for maintenance hours." };
    if (priorRead) allowed.push("skill.select");
    readStage.mockReturnValue({ skillDiscovery: true,
      observation: { outcome: "structural_model", skillResolution: pinnedMethod ? { pinnedSkillId: "explicit" } : {},
        ...(priorRead ? { readSkillMethods: [prior] } : {}) },
      ...(priorRead ? { skillSelectReceipts: new Map([[prior.skillId, prior.readReceiptId]]) } : {}),
      tools: createDefaultToolRegistry().list().filter(value => allowed.includes(value.name)).map(value => ({
        name: value.name, summary: value.description, arguments: {},
        validateArguments: args => value.inputSchema.parse(args) as Record<string, unknown>
      }))
    });
    propose(ask);
    const reviewer = vi.fn(() => {
      const evidence = JSON.parse(calls.at(-1)!.prompt);
      expect(evidence.proposedQuestion.question).toBe(question);
      expect(evidence.submittedUserAnswers).toEqual([]);
      expect(evidence.scopeSpans[0].text).toBe(evidence.originalBrief.prompt);
      if (review === "timeout") return new AppleTransportError("timeout");
      if (review === "unresolved") return { conclusion: "Waiting time may or may not count.", readiness: "distinct_material_gap" };
      if (review === "anchored") propose(guided("Continue with the stated relationship.", {
        tool: "skill.report_gap", skillGap: { reason: "The reviewed catalog has no archival review-time method." }
      }));
      return { conclusion: "The request states which monthly reviewer time counts.", readiness: "continue_with_current_evidence",
        scopeSpanId: review === "unanchored" ? "not-an-exposed-span" : evidence.scopeSpans[0].id };
    });
    reviewWith(reviewer);
    const checkpoint = { type: "tool_results", batchId: "search", results: [{
      toolName: "skill.search", status: "succeeded", payload: { output: { candidates: [] } }
    }] } as const;
    const decision = turn.completeTurn({ ...initial, exchangeId: "exchange-gap", previousCursor: cursor, delta: stale
      ? { type: "checkpoint_inputs", checkpointDelta: checkpoint, inputs: [{ type: "user_instruction", text: "Use the updated reporting scope." }] }
      : checkpoint });
    if (tool) expect((await decision).output).toMatchObject({ action: { batch: { calls: [{ toolName: tool }] } } });
    else await expect(decision).rejects.toMatchObject({ code: "invalid_output" });
    expect(reviewer).toHaveBeenCalledTimes(review === "skip" ? 0 : 1);
    expect(calls).toHaveLength(review === "skip" ? 2 : review === "anchored" ? 5 : review === "repeat" ? 4 : 3);
    if (review === "anchored" || review === "repeat") {
      expect(JSON.parse(calls[3]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["skill.report_gap"]);
      if (review === "anchored") expect(JSON.parse(calls[4]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
    }
  });

  it.each([
    { initialAudit: "verified", repairedAudit: undefined, change: false, write: true },
    { initialAudit: "reject_q2", repairedAudit: "verified", change: true, write: true },
    { initialAudit: "hold", repairedAudit: undefined, change: false, write: false },
    { initialAudit: "malformed", repairedAudit: "verified", change: false, write: true },
    { initialAudit: "hold", repairedAudit: "hold", change: true, write: false }
  ])("requires affirmative audit of each measured fill ($initialAudit / $repairedAudit / $change)", async ({
    initialAudit, repairedAudit, change, write
  }) => {
    const { turn, readStage, propose, calls } = fixture();
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Shelf inventory", rootKpi: "Shelf inventory", unit: "unit" });
    const root = builder.getProject().rootNodeId;
    const facts = [{ value: 10, quote: "Top shelf contains 10 units" }, { value: 14, quote: "Bottom shelf contains 14 units" }];
    const tools = createDefaultToolRegistry().list();
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Count shelf inventory",
      nodes: ["top", "bottom"].map(nodeId => ({ nodeId, parentNodeId: root, kind: "input" })) } } });
    for (const [nodeId, name] of [["top", "Top shelf"], ["bottom", "Bottom shelf"]] as const) {
      builder.addDriver({ nodeId, name, parentNodeId: root, unit: "unit", relation: "formula_dependency" });
    }
    const structuralGuide = structuralGuideFor(builder.getProject(), facts)!;
    readStage.mockReturnValue({ observation: { outcome: "structural_model" }, structuralGuide,
      tools: tools.filter(tool => structuralGuide.names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {},
        validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      })) });
    const proposedPairs = (swapped: boolean) => [
      { nodeId: "top", quantityId: swapped ? "q2" : "q1" }, { nodeId: "bottom", quantityId: swapped ? "q1" : "q2" }
    ];
    const initiallySwapped = initialAudit === "reject_q2" || initialAudit === "hold";
    let audits = 0;
    propose((request: AppleCompletionRequest) => {
      const prompt = JSON.parse(request.prompt);
      if (request.schema.fields[0]?.name === "measurementBindings") {
        const first = ++audits === 1;
        const swapped = first ? initiallySwapped : initiallySwapped && !change;
        expect(prompt.pairs).toEqual(proposedPairs(swapped));
        expect(prompt.writes.map(({ value, note }: { value: number; note: string }) => [value, note]))
          .toEqual((swapped ? [...facts].reverse() : facts).map(fact => [fact.value, fact.quote]));
        return { measurementBindings: first ? initialAudit : repairedAudit };
      }
      if (audits) {
        expect(prompt.tools.map(({ name }: { name: string }) => name)).toEqual(["vdt.fill_input_values_batch"]);
        expect(JSON.parse(prompt.scopeAnalysis)).toEqual({ rejectedPairs: proposedPairs(initiallySwapped),
          ...(initialAudit === "reject_q2" ? { unsupportedPair: proposedPairs(true)[0] } : {}) });
      }
      return guided("Match the measured inputs.", {
        tool: "vdt.fill_input_values_batch", bindings: proposedPairs(initiallySwapped && (!audits || !change))
      });
    });
    const result = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "measured",
      context: { brief: { prompt: facts.map(({ quote }) => quote).join(". ") } } } });
    expect(calls.map(call => call.schema.fields[0]?.name)).toEqual(["sessionState", "measurementBindings",
      ...(initialAudit === "verified" ? [] : ["sessionState"]), ...(repairedAudit ? ["measurementBindings"] : [])]);
    expect(result.output).toMatchObject({ action: { batch: { calls: [!write
      ? { toolName: "vdt.inspect_hierarchy", args: {} }
      : { toolName: "vdt.fill_input_values_batch", args: { values: [
        { nodeId: "top", value: 10, provenance: "user_provided_value", note: facts[0]!.quote },
        { nodeId: "bottom", value: 14, provenance: "user_provided_value", note: facts[1]!.quote }
      ] } }
    ] } } });
  });

  it.each(["settled draft", "material prerequisite", "substituted receipt", "early complete scope", "early catalog gap",
    "existing baseline", "existing formula", "edited draft", "generation with existing factors"] as const)(
    "routes a single exact automatic method at the discovery checkpoint for %s", async scenario => {
      const { turn, readStage, propose, calls } = fixture();
      const earlyGap = scenario === "early catalog gap";
      const early = scenario === "early complete scope" || earlyGap;
      const originalMode = scenario === "generation with existing factors" ? "generate_vdt"
        : early || (["existing baseline", "existing formula", "edited draft"] as readonly string[]).includes(scenario)
          ? "continue_project" : undefined;
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {},
        validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      const method = { skillId: "consignment_capacity", version: 2, contentHash: `sha256:${"c".repeat(64)}`, readReceiptId: "exact-read",
        excerpt: earlyGap ? "Count departed shipments when handed to an outside carrier. This method measures completed shipments."
          : "Take the smaller capacity if one consignment passes both stations. Sum capacities if consignments are dispatched independently." };
      const card = { id: method.skillId, title: earlyGap ? "Completed shipments" : "Consignment capacity", description: "", scope: ["consignments"],
        version: method.version, contentHash: method.contentHash };
      const observation = { outcome: "structural_model", skillResolution: {},
        ...(originalMode ? { revision: scenario === "edited draft" ? 1 : 0,
          nodeCount: originalMode === "generate_vdt" ? 2 : 1, selectedNode: null, rootNodeId: "root",
          nodeColumns: ["id", "type", "formula", "baselineValue", "value"],
          nodes: [["root", "root_kpi", scenario === "existing formula" ? "1" : null, scenario === "existing baseline" ? 0 : null, null],
            ...(originalMode === "generate_vdt" ? [["child", "input", null, null, null]] : [])] } : {}) };
      const question = { question: "Do the same consignments pass through both stations, or do the stations dispatch independently?",
        reason: "The operating relationship determines the formula." };
      const prompt = `Build an editable daily consignment capacity tree for two stations. Leave both capacities blank.${
        scenario === "settled draft" || early ? " The stations dispatch separate consignments independently." : ""}`;
      readStage.mockReturnValue({ observation, skillDiscovery: true, skillListArguments: {}, tools: tools(["skill.list"]) });
      propose(guided("Browse.", { tool: "skill.list" }));
      const listed = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "capacity",
        context: { brief: { prompt, ...(originalMode ? { mode: originalMode } : {}) } } } });
      const checkpoint = (previous: { cursor: string }, exchangeId: string, toolName: string, externalCallId: string, output: unknown) =>
        ({ ...initial, exchangeId, previousCursor: previous.cursor, delta: { type: "tool_results", batchId: exchangeId,
          results: [{ toolName, externalCallId, resultCode: "OK", status: "succeeded", payload: { output } }] } }) as const;
      readStage.mockReturnValue({ observation, skillDiscovery: true, tools: tools(["skill.search"]) });
      propose(guided("Find the method.", { tool: "skill.search", skillSearch: { rootKpi: "Daily consignment capacity" } }));
      const searched = await turn.completeTurn(checkpoint(listed, "before-search", "skill.list", `${initial.exchangeId}:call`, { skills: [card], nextOffset: null }));
      readStage.mockReturnValue({ observation, skillDiscovery: true, skillReadableIds: [card.id], tools: tools(["skill.read"]) });
      propose(guided("Read the exact method.", { tool: "skill.read", skillRead: { skillId: card.id } }));
      const read = await turn.completeTurn(checkpoint(searched, "before-read", "skill.search", "before-search:call", {
        candidates: [{ ...card, ...(scenario === "substituted receipt" ? { contentHash: `sha256:${"d".repeat(64)}` } : {}) }]
      }));
      readStage.mockReturnValue({ observation: { ...observation, readSkillMethods: [method] }, skillDiscovery: true,
        skillSelectReceipts: new Map([[card.id, method.readReceiptId]]),
        tools: tools(["user.ask", "skill.select", ...(earlyGap ? ["skill.report_gap"] : [])]) });
      if (early) {
        const before = calls.length;
        propose((request: AppleCompletionRequest) => {
          const field = request.schema.fields[0]?.name;
          const evidence = JSON.parse(request.prompt);
          if (field === "measurementBoundary") return {
            measurementBoundary: earlyGap ? "outside" : "matches", userBoundarySpanId: evidence.witnessSpans[0].id,
            methodBoundarySpanId: evidence.method.spans[0].id
          };
          if (earlyGap && field === "sessionState") {
            return evidence.tools.length === 1
              ? guided("Propose a gap.", { tool: "skill.report_gap", skillGap: { reason: "The exact reviewed method measures shipments after departure." } })
              : guided("Propose a question.", { tool: "user.ask", focusedQuestion: {
                question: "Which outside carrier is used?", reason: "The method counts shipments after handing them to a carrier."
              } });
          }
          if (earlyGap && field === "scopeQuestionFit") return { scopeQuestionFit: "hold" };
          if (earlyGap && field === "gapFit") {
            expect(evidence.cards).toEqual([card]);
            expect(evidence.reads).toMatchObject([{ skillId: card.id, readReceiptId: method.readReceiptId }]);
            return { gapFit: "no_fit_with_resolved_scope",
              scopeSpanId: evidence.sourceSpans.find(({ text }: { text: string }) => text.startsWith("Build an editable")).id,
              relationshipSpanId: evidence.sourceSpans.find(({ text }: { text: string }) => text.includes("consignments independently")).id };
          }
          expect(field).toBe("initialFixedScope");
          expect(evidence.methodExcerpt).toBe(method.excerpt);
          expect(evidence.userSources.originalRequest).toBe(prompt);
          return { initialFixedScope: "verified_en" };
        });
        const decision = await turn.completeTurn(checkpoint(read, "decide", "skill.read", "before-read:call", { ...method, id: method.skillId }));
        if (earlyGap) {
          expect(decision.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.report_gap" }] } } });
          expect(calls.slice(before).map(call => call.schema.fields[0]?.name)).toEqual([
            "measurementBoundary", "sessionState", "measurementBoundary", "scopeQuestionFit", "sessionState", "gapFit"
          ]);
          return;
        }
        expect(decision.output).toMatchObject({ action: { batch: { calls: [
          { toolName: "skill.select", args: { skillId: card.id, readReceiptId: method.readReceiptId } }
        ] } } });
        expect(calls.slice(before).map(call => call.schema.fields[0]?.name)).toEqual(["measurementBoundary", "initialFixedScope"]);
        return;
      }
      const selection = { skillId: card.id, readReceiptId: method.readReceiptId, reason: "Exact method fits the submitted operating relationship." };
      propose(guided("Review the scope.", scenario === "settled draft" ? { tool: "user.ask", focusedQuestion: question }
        : { tool: "skill.select", skillSelection: { skillId: card.id, reason: "This covers both stations." } }));
      const review = vi.spyOn(scopedMethodReview, "reviewScopedSkillQuestion")
        .mockResolvedValueOnce(scenario === "settled draft" ? selection : { groundedQuestion: question });
      try {
        const decision = turn.completeTurn(checkpoint(read, "decide", "skill.read", "before-read:call", { ...method, id: method.skillId }));
        if (scenario === "substituted receipt") {
          await expect(decision).rejects.toThrow("APPLE_INITIAL_METHOD_FIT_HOST_EVIDENCE");
          expect(review).toHaveBeenCalledTimes(0);
          return;
        }
        const decided = await decision;
        expect(review).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          currentSearchCandidates: [card], reads: [method], selectableReceipts: new Map([[card.id, method.readReceiptId]]),
          originalBrief: { prompt, ...(originalMode ? { mode: originalMode } : {}) },
          ...(scenario === "settled draft" ? { question } : {})
        }));
        expect(review.mock.calls[0]?.[0].initialFixedScopeOnly).toBeUndefined();
        if (scenario === "settled draft") {
          expect(decided.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.select", args: selection }] } } });
          return;
        }
        expect(review.mock.calls[0]?.[0].question).toBeUndefined();
        expect(decided.output).toMatchObject({ action: { batch: { calls: [{
          toolName: "user.ask", args: { questions: [{ ...question, id: "skill_scope", required: true }] }
        }] } } });
        const answer = "The same consignments pass both stations in order.";
        readStage.mockReturnValue({ observation: { ...observation, readSkillMethods: [method] }, skillDiscovery: true,
          skillSelectReceipts: new Map([[card.id, method.readReceiptId]]), tools: tools(["user.ask", "skill.select", "skill.search"]) });
        review.mockResolvedValueOnce(selection);
        const resumed = await turn.completeTurn({ ...initial, exchangeId: "resumed", previousCursor: decided.cursor, delta: {
          type: "human_input", input: { type: "user_answer", questionSetId: "questions-decide:call", answers: { skill_scope: answer } }
        } });
        expect(review).toHaveBeenNthCalledWith(2, expect.objectContaining({
          submittedUserAnswers: [{ question: question.question, answer: [answer] }], currentSearchCandidates: [card], reads: [method]
        }));
        expect(resumed.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.select", args: selection }] } } });
      } finally {
        review.mockRestore();
      }
    }
  );

  it.each(["resolved root definition", "material scope gap"] as const)(
    "reviews the draft after a complete browse when the Supervisor offers search but no gap for %s", async scenario => {
      const { turn, calls, readStage, propose, proposeOnce, reviewWith } = fixture();
      const prompt = scenario === "resolved root definition" ? archiveBrief
        : "Build an editable tree for monthly active review hours. We report active time for each reviewer and each recording. Leave all measurements blank.";
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {},
        validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      const observation = { outcome: "structural_model", skillResolution: {} };
      const card = { id: "discount_sales", title: "Discounted sales", description: "", version: 1, contentHash: `sha256:${"e".repeat(64)}`, scope: ["retail"] };
      const method = { skillId: card.id, readReceiptId: "read-catalog-card", version: 1, contentHash: card.contentHash,
        excerpt: "Calculate net retail revenue from sold quantity, retail price and discounts." };
      readStage.mockReturnValue({ observation, skillDiscovery: true, skillListArguments: {}, tools: tools(["skill.list"]) });
      propose(guided("Browse.", { tool: "skill.list" }));
      const listed = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "catalog-gap",
        context: { brief: { prompt } } } });
      readStage.mockReturnValue({ observation, skillDiscovery: true, skillReadableIds: [card.id], tools: tools(["skill.search", "skill.read"]) });
      proposeOnce(guided("Read the plausible card.", { tool: "skill.read", skillRead: { skillId: card.id } }));
      proposeOnce(new AppleTransportError("invalid_output", "native_output"));
      const read = await turn.completeTurn({ ...initial, exchangeId: "inspect-card", previousCursor: listed.cursor, delta: {
        type: "tool_results", batchId: "listed", results: [{ toolName: "skill.list", externalCallId: `${initial.exchangeId}:call`, resultCode: "OK",
          status: "succeeded", payload: { output: { skills: [card], nextOffset: null } } }]
      } });
      const draft = scenario === "resolved root definition"
        ? { question: "What does the requested root KPI measure?", reason: "The definition determines the inputs." }
        : { question: "Do you want the aggregate reported per reviewer or for the full team?", reason: "The reporting boundary determines which hours are combined." };
      propose(guided("Clarify the measurement boundary.", { tool: "user.ask", focusedQuestion: draft }));
      const afterReadStage = { observation: { ...observation, readSkillMethods: [method] }, skillDiscovery: true as const,
        skillSelectReceipts: new Map([[card.id, method.readReceiptId]]) };
      readStage.mockReturnValue({ ...afterReadStage, tools: tools(["user.ask", "skill.select", "skill.search"]) });
      const gapProof = vi.fn(allowCatalogGap);
      reviewWith(() => {
        const evidence = JSON.parse(calls.at(-1)!.prompt);
        expect(evidence.proposedQuestion).toEqual(draft);
        expect(evidence.catalogCards).toBeUndefined();
        expect(prompt).toContain(evidence.scopeSpans[0].text);
        if (scenario === "material scope gap") return { readiness: "distinct_material_gap", conclusion: "Team reporting granularity could change the formula." };
        propose((request: AppleCompletionRequest) => {
          const search = JSON.parse(request.prompt);
          expect(search.tools.map(({ name }: { name: string }) => name)).toEqual(["skill.search"]);
          expect(search.originalBrief.prompt).toBe(prompt);
          return guided("Search the current measurement boundary.", { tool: "skill.search", skillSearch: {
            rootKpi: "Monthly active archival review hours", businessContext: "Active review time across recordings reviewed that month."
          } });
        });
        return { readiness: "continue_with_current_evidence", conclusion: "The user defines monthly active review time.",
          scopeSpanId: evidence.scopeSpans[0].id };
      });
      const decision = await turn.completeTurn({ ...initial, exchangeId: "review-draft", previousCursor: read.cursor, delta: {
        type: "tool_results", batchId: "read", results: [{ toolName: "skill.read", externalCallId: "inspect-card:call", resultCode: "OK", status: "succeeded",
          payload: { output: { ...method, id: card.id } } }]
      } });
      expect(gapProof).toHaveBeenCalledTimes(0);
      if (scenario === "material scope gap") {
        expect(decision.output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask", args: { questions: [expect.objectContaining(draft)] } }] } } });
        return;
      }
      expect(decision.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.search", externalCallId: "review-draft:call" }] } } });
      readStage.mockReturnValue({ ...afterReadStage, tools: tools(["user.ask", "skill.select", "skill.report_gap"]) });
      propose((request: AppleCompletionRequest) => request.schema.fields[0]?.name === "gapFit" ? gapProof(request)
        : guided("Report the reviewed gap.", { tool: "skill.report_gap", skillGap: { reason: "The reviewed catalog lacks an active review-time rule." } }));
      const emptySearch = await turn.completeTurn({ ...initial, exchangeId: "after-search", previousCursor: decision.cursor, delta: {
        type: "tool_results", batchId: "empty-search", results: [{ toolName: "skill.search", externalCallId: "review-draft:call",
          resultCode: "OK", status: "succeeded", payload: { output: { candidates: [] } } }]
      } });
      expect(gapProof).toHaveBeenCalledOnce();
      expect(emptySearch.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.report_gap" }] } } });
    });

  function allowCatalogGap(request: AppleCompletionRequest, sourceIndex = 0) {
    const spans = (JSON.parse(request.prompt).sourceSpans as { id: string; relationship: boolean; sourceIndex: number; start: number; end: number }[])
      .filter(span => span.sourceIndex >= sourceIndex);
    for (const relation of spans.filter(span => span.relationship)) {
      const scope = spans.find(span => span.sourceIndex !== relation.sourceIndex || span.end <= relation.start || relation.end <= span.start);
      if (scope) return { gapFit: "no_fit_with_resolved_scope", scopeSpanId: scope.id, relationshipSpanId: relation.id };
    }
    throw new Error("Expected independent user scope and relationship spans.");
  }

  const catalogReadCases: {
    receipt: string; choice: string | undefined; action: string; narrowed: boolean; followFit?: string;
    forgedRead?: boolean; unresolved?: boolean; stale?: boolean; pinned?: boolean; confirmationRequired?: boolean;
    screenLead?: boolean;
    proof?: "archive" | "forged" | "overflow" | "overflow overlaps" | "wrong search" | "serial";
  }[] = [
    { receipt: "full", choice: "no_applicable_skill", action: "skill.report_gap", narrowed: true },
    { receipt: "full", choice: "no_applicable_skill", action: "skill.report_gap", narrowed: true, proof: "archive", screenLead: true },
    ...(["archive", "forged", "overflow", "overflow overlaps", "wrong search"] as const).map(proof =>
      ({ receipt: "full", choice: "no_applicable_skill", action: "skill.report_gap", narrowed: true, proof })),
    { receipt: "full", choice: "no_applicable_skill", action: "user.ask", narrowed: false, unresolved: true, proof: "serial" },
    ...["no_fit", "no_fit_read", "applicable", "applicable_read", "distinct_scope_gap", "uncertain", "unanchored", "timeout", "forged_receipt", "wrong_call", "wrong_content", "failed_read", "stale_read", "no_gap", "pin", "confirmation"].map(followFit =>
      ({ receipt: "full", choice: "other", action: "skill.read", narrowed: true, followFit })),
    { receipt: "full", choice: "other", action: "skill.read", narrowed: true, forgedRead: true },
    { receipt: "full", choice: "uncertain", action: "skill.read", narrowed: false, followFit: "ordinary_read" },
    { receipt: "full", choice: "forged", action: "skill.read", narrowed: false },
    { receipt: "full", choice: "no_applicable_skill", action: "user.ask", narrowed: false, unresolved: true },
    { receipt: "partial", choice: undefined, action: "skill.read", narrowed: false },
    { receipt: "forged", choice: undefined, action: "skill.read", narrowed: false },
    { receipt: "malformed", choice: undefined, action: "skill.read", narrowed: false },
    { receipt: "full", choice: undefined, action: "user.ask", narrowed: false, stale: true },
    { receipt: "full", choice: undefined, action: "user.ask", narrowed: false, pinned: true },
    { receipt: "full", choice: undefined, action: "user.ask", narrowed: false, confirmationRequired: true },
    { receipt: "oversized", choice: undefined, action: "skill.read", narrowed: false }
  ];
  it.each(catalogReadCases)("uses the authenticated catalog frontier for $receipt / $choice / $action / $followFit / $proof / $screenLead", async ({
    receipt, choice, action, narrowed, forgedRead, unresolved, stale, pinned, confirmationRequired, followFit, proof, screenLead
  }) => {
    const { turn, calls, readStage, propose, proposeOnce, reviewWith, screenCatalogWith } = fixture();
    const ids = ["other", "unrelated"];
    const card = (id: string) => ({ id, title: id, description: receipt === "oversized" ? "x".repeat(5_000) : "",
      scope: ["work hours"], ...(id === "other" ? {
        scopeGuidance: receipt === "malformed" ? "Model the work-time relationship."
          : screenLead ? ["Work-hours from the count of activities and average hours per activity."] : ["Model the work-time relationship."]
      } : {}),
      version: 1, contentHash: `sha256:${"a".repeat(64)}` });
    const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({ skillDiscovery: true, skillListArguments: {}, observation: { outcome: "structural_model" }, tools: tools(["skill.list"]) });
    propose(guided("Browse.", { tool: "skill.list" }));
    const originalPrompt = proof === "serial"
      ? "Build an editable capacity tree for two production stages, crushing and screening. I will enter the capacity measurements later."
      : proof?.startsWith("overflow")
        ? `${archiveBrief} Count each reviewer once per shift. Count each qualifying shift only once. Count every completed session per calendar month.`
        : proof ? archiveBrief : "Build a monthly review-hours tree. Count each recording once. Leave measurements blank.";
    const first = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "catalog",
      context: { brief: { prompt: originalPrompt } } } });
    readStage.mockReturnValue({ skillDiscovery: true, observation: { outcome: "structural_model" }, tools: tools(["skill.search"]) });
    propose(guided("Search.", { tool: "skill.search", skillSearch: { rootKpi: "recording review hours" } }));
    const listed = await turn.completeTurn({ ...initial, exchangeId: "search-catalog", previousCursor: first.cursor, delta: {
      type: "tool_results", batchId: "catalog-result", results: [{
        externalCallId: receipt === "forged" ? "forged:call" : `${initial.exchangeId}:call`, toolName: "skill.list", status: "succeeded", resultCode: "OK",
        payload: { output: { skills: ids.map(card), nextOffset: receipt === "partial" ? 2 : null } }
      }]
    } });
    const ask = guided("Clarify.", { tool: "user.ask", focusedQuestion: proof === "serial"
      ? { question: "Do the stages process the same material in sequence or have independent outputs?", reason: "The relationship determines the formula." }
      : { question: "How many reviews per recording?", reason: "Count basis." } });
    propose(ask);
    readStage.mockReturnValue({ skillDiscovery: true, skillReadableIds: ids, observation: {
      outcome: "structural_model", skillResolution: { ...(pinned ? { pinnedSkillId: "other" } : {}), confirmationRequired }
    }, tools: tools(["user.ask", "skill.read", "skill.report_gap"]) });
    const fallback = vi.fn(allowCatalogGap);
    if (screenLead) screenCatalogWith(request => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.sourceSpans.some((span: { text: string }) => span.text.includes("hours per recording"))).toBe(true);
      expect(prompt.cards).toMatchObject([{ choice: "card_1", title: "other" }, { choice: "card_2", title: "unrelated" }]);
      expect(prompt.reason).toBeUndefined();
      return { plausibleCard: "card_1" };
    });
    const reviewer = vi.fn(() => {
      const prompt = JSON.parse(calls.at(-1)!.prompt);
      if (receipt === "full") expect(prompt.catalogCards).toEqual(ids.map(card));
      else expect(prompt.catalogCards).toBeUndefined();
      if (action !== "user.ask") propose((request: AppleCompletionRequest) => request.schema.fields[0]?.name === "gapFit"
        ? fallback(request)
        : guided("Continue.", action === "skill.read" ? { tool: action, skillRead: { skillId: forgedRead ? "unrelated" : "other" } }
          : { tool: action, skillGap: { reason: "No relevant relationship." } }));
      if (action === "user.ask" && unresolved) propose((request: AppleCompletionRequest) => {
        const evidence = JSON.parse(request.prompt);
        expect(request.schema.fields[0]?.name).toBe("scopeQuestionFit");
        return proof === "serial" ? { scopeQuestionFit: "material_question", scopeSpanId: evidence.scopeSpans[0].id }
          : { scopeQuestionFit: "hold" };
      });
      const businessSpans = prompt.gapBusinessSpans as { id: string; relationship: boolean; sourceIndex: number; start: number; end: number; text: string }[] | undefined;
      const pairs = prompt.gapAnchorPairs as { id: string; outputSpanId: string; relationshipSpanId: string }[] | undefined;
      const schema = calls.at(-1)!.schema.fields;
      if (proof === "serial" || proof === "wrong search") expect(businessSpans).toBeUndefined();
      const relationship = businessSpans?.find(span => span.text.includes("hours per recording"));
      const output = businessSpans?.find(span => span.text.includes("editable factor tree"));
      let anchors = {};
      if (proof === "archive" || proof === "forged") {
        expect(pairs).toHaveLength(16);
        expect(schema.filter(field => field.name.startsWith("gap")).map(field => field.name)).toEqual(["gapPairId"]);
        for (const pair of pairs!) {
          const left = businessSpans?.find(span => span.id === pair.outputSpanId);
          const right = businessSpans?.find(span => span.id === pair.relationshipSpanId);
          expect(left?.sourceIndex).toBe(0);
          expect(right?.relationship).toBe(true);
          expect(left!.end <= right!.start || right!.end <= left!.start).toBe(true);
        }
        const chosen = pairs!.find(pair => pair.outputSpanId === output?.id && pair.relationshipSpanId === relationship?.id);
        expect(chosen).toBeDefined();
        anchors = { gapPairId: proof === "forged" ? "invented-pair" : chosen!.id };
      } else if (proof?.startsWith("overflow")) {
        expect(pairs).toBeUndefined();
        expect(schema.filter(field => field.name.startsWith("gap")).map(field => field.name)).toEqual(["gapOutputSpanId", "gapRelationshipSpanId"]);
        expect(relationship).toBeDefined();
        expect(output).toBeDefined();
        anchors = { gapOutputSpanId: proof === "overflow overlaps" ? relationship!.id : output!.id, gapRelationshipSpanId: relationship!.id };
      }
      return { conclusion: "The brief specifies one review.", readiness: unresolved ? "distinct_material_gap" : "continue_with_current_evidence",
        scopeSpanId: prompt.scopeSpans[0].id, ...(choice ? { catalogFit: choice } : {}), ...anchors };
    });
    reviewWith(reviewer);
    const search = { type: "tool_results", batchId: "search-result", results: [{
      toolName: "skill.search", externalCallId: proof === "wrong search" ? "stale:call" : "search-catalog:call", resultCode: "OK",
      status: "succeeded", payload: { output: { candidates: [] } }
    }] } as const;
    const run = turn.completeTurn({ ...initial, exchangeId: "after-search", previousCursor: listed.cursor, delta: stale
      ? { type: "checkpoint_inputs", checkpointDelta: search, inputs: [{ type: "user_instruction", text: "Use a different review scope." }] }
      : search });
    const alreadyAnswered = unresolved && proof !== "serial";
    const result = forgedRead || alreadyAnswered ? undefined : await run;
    if (forgedRead) await expect(run).rejects.toMatchObject({ code: "invalid_output" });
    else if (alreadyAnswered) await expect(run).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
    else expect(result?.output).toMatchObject({ action: { batch: { calls: [
      screenLead ? { toolName: "skill.read", args: { skillId: "other" } } : { toolName: action }
    ] } } });
    if (screenLead) {
      expect(reviewer).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      expect(calls.filter(request => request.schema.fields[0]?.name === "plausibleCard")).toHaveLength(1);
      return;
    }
    expect(reviewer).toHaveBeenCalledTimes(stale || pinned || confirmationRequired ? 0 : 1);
    const earlyProof = proof === "archive" || proof === "overflow";
    if (action === "skill.report_gap") {
      expect(fallback).toHaveBeenCalledTimes(earlyProof ? 0 : 1);
      expect(calls.filter(request => request.schema.fields[0]?.name === "plausibleCard")).toHaveLength(proof === "wrong search" ? 0 : 1);
    }
    const guidedCalls = calls.filter(request => request.schema.fields[0]?.name !== "plausibleCard");
    if (action !== "user.ask") expect(JSON.parse(guidedCalls.at(action === "skill.report_gap" && !earlyProof ? -2 : -1)!.prompt).tools.map(({ name }: { name: string }) => name))
      .toEqual(narrowed ? [action] : ["skill.read", "skill.report_gap"]);
    if (!followFit || !result) return;
    const chosen = { skillId: "other", version: 1, contentHash: card("other").contentHash,
      readReceiptId: "exact-read", excerpt: "This Skill models physical production output from equipment capacity." };
    const gapPermitted = followFit !== "no_gap";
    const proposedRead = followFit.endsWith("_read") && ["no_fit_read", "applicable_read"].includes(followFit);
    const noFit = followFit === "no_fit" || followFit === "no_fit_read";
    const offScopeQuestion = { question: "Is the target revenue, gross profit, operating profit, EBITDA, or net profit?",
      reason: "The financial method needs the requested monetary output." };
    const genuineQuestion = { question: "Should waiting time count toward the reported review hours?",
      reason: "It determines which intervals contribute to the total." };
    const proposedQuestion = followFit === "distinct_scope_gap" ? genuineQuestion : offScopeQuestion;
    const postRead = proposedRead ? guided("Read the next card.", { tool: "skill.read", skillRead: { skillId: "unrelated" } })
      : guided("Ask about scope.", { tool: "user.ask", focusedQuestion: proposedQuestion });
    readStage.mockReturnValue({ skillDiscovery: true, skillSelectReceipts: new Map([["other", chosen.readReceiptId]]),
      ...(proposedRead ? { skillReadableIds: ["unrelated"] } : {}),
      observation: { outcome: "structural_model", readSkillMethods: [chosen], skillResolution: {
        ...(followFit === "pin" ? { pinnedSkillId: "other" } : {}),
        ...(followFit === "confirmation" ? { confirmationRequired: true } : {})
      } }, tools: tools(["user.ask", "skill.select", ...(proposedRead ? ["skill.read"] : []), ...(gapPermitted ? ["skill.report_gap"] : [])]) });
    const fitProposed = vi.fn((request: AppleCompletionRequest) => {
      const prompt = JSON.parse(request.prompt);
      expect(prompt.cards).toEqual(ids.map(card));
      expect(prompt.read.readReceiptId).toBe(chosen.readReceiptId);
      expect(prompt.read.spans[0].text).toBe(chosen.excerpt);
      expect(prompt.scopeSpans[0].text).toContain("Count each recording once");
      expect(prompt.originalBrief).toContain("Build a monthly review-hours tree");
      expect(prompt.proposal).toEqual(proposedRead ? { tool: "skill.read", card: card("unrelated") }
        : { tool: "user.ask", ...proposedQuestion });
      return followFit === "timeout" ? new AppleTransportError("timeout") : {
        catalogReadFit: followFit === "unanchored" || noFit ? "no_fit" : followFit === "applicable_read" ? "applicable" : followFit,
        scopeSpanId: followFit === "unanchored" ? "forged-span" : prompt.scopeSpans[0].id,
        methodSpanId: prompt.read.spans[0].id
      };
    });
    const canReview = !["forged_receipt", "wrong_call", "wrong_content", "failed_read", "stale_read", "no_gap", "pin", "confirmation", "ordinary_read"].includes(followFit);
    if (canReview) {
      proposeOnce(postRead);
      proposeOnce(fitProposed);
    }
    propose((request: AppleCompletionRequest) => {
      const stageName = request.schema.fields[0]?.name;
      if (stageName === "scopeQuestionFit") {
        const evidence = JSON.parse(request.prompt);
        return followFit === "distinct_scope_gap" ? { scopeQuestionFit: "material_question", scopeSpanId: evidence.scopeSpans[0].id }
          : { scopeQuestionFit: "hold" };
      }
      if (!noFit) return postRead;
      return stageName === "gapFit" ? allowCatalogGap(request)
        : guided("Report the gap.", { tool: "skill.report_gap", skillGap: { reason: "No method applies." } });
    });
    const read = { type: "tool_results", batchId: "read-result", results: [{
      externalCallId: followFit === "wrong_call" ? "wrong:call" : "after-search:call",
      toolName: "skill.read", resultCode: followFit === "failed_read" ? "REJECTED" : "OK",
      status: followFit === "failed_read" ? "failed" : "succeeded",
      payload: { output: { ...chosen, id: chosen.skillId,
        contentHash: followFit === "wrong_content" ? "wrong" : chosen.contentHash,
        readReceiptId: followFit === "forged_receipt" ? "forged" : chosen.readReceiptId } }
    }] } as const;
    const afterRead = turn.completeTurn({ ...initial, exchangeId: "after-reviewed-read", previousCursor: result.cursor,
      delta: followFit === "stale_read" ? { type: "checkpoint_inputs", checkpointDelta: read,
        inputs: [{ type: "user_instruction", text: "Change the requested scope." }] } : read });
    const blockedDraft = !proposedRead && !noFit && !["distinct_scope_gap", "failed_read", "stale_read", "pin", "confirmation"].includes(followFit);
    if (blockedDraft) {
      await expect(afterRead).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
    } else {
      const expectedTool = noFit ? "skill.report_gap" : proposedRead ? "skill.read" : "user.ask";
      await expect(afterRead).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: expectedTool }] } } } });
    }
    expect(fitProposed).toHaveBeenCalledTimes(canReview ? 1 : 0);
    if (noFit) {
      const beforeScreen = calls.filter(request => request.schema.fields[0]?.name !== "plausibleCard");
      const frontier = JSON.parse(beforeScreen.at(-2)!.prompt).tools.map(({ name }: { name: string }) => name);
      expect(frontier).toEqual(["skill.report_gap"]);
    }

  });

  it.each(["serial read", "forged card", "substituted read", "deferred anchor", "timeout", "archive", "single clause", "stale anchors", "acknowledgment",
    "screen lead", "screen no lead", "screen forged"])(
    "reviews the actual empty-search gap before it can authorize writes for %s", async mode => {
      const { turn, calls, readStage, propose, proposeOnce, screenCatalogWith } = fixture();
      const serial = "Build an editable factor tree for two production stages, crushing and screening. I will enter the capacity measurements later";
      const screen = mode.startsWith("screen ");
      const parallel = "Build a tree for total daily finishing capacity. A pair of independent lines each complete separate jobs and both send finished output directly to dispatch. Count the sum of their separate outputs.";
      const single = "Model the work hours for inspected sheets using the number of completed sheets multiplied by the active hours per inspected sheet within the same period.";
      const brief = ["archive", "stale anchors", "acknowledgment", "screen no lead"].includes(mode) ? archiveBrief
        : screen ? parallel : mode === "single clause" ? single : serial;
      const permitsGap = screen || ["archive", "single clause", "acknowledgment"].includes(mode);
      const id = "operations.process_capacity";
      const card = { id, title: "Process capacity", description: "Model stages, capacity and throughput.", scope: ["throughput"],
        version: 1, contentHash: `sha256:${"a".repeat(64)}` };
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      readStage.mockReturnValue({ skillDiscovery: true, skillListArguments: {}, observation: { outcome: "structural_model" }, tools: tools(["skill.list"]) });
      propose(guided("Browse.", { tool: "skill.list" }));
      const first = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "real-serial-gap",
        context: { brief: { prompt: brief } } } });
      readStage.mockReturnValue({ skillDiscovery: true, observation: { outcome: "structural_model" }, tools: tools(["skill.search"]) });
      propose(guided("Search.", { tool: "skill.search", skillSearch: { rootKpi: "Requested factor tree" } }));
      const searched = await turn.completeTurn({ ...initial, exchangeId: "gap-catalog", previousCursor: first.cursor, delta: {
        type: "tool_results", batchId: "browse", results: [{ toolName: "skill.list", externalCallId: "exchange-1:call", status: "succeeded",
          resultCode: "OK", payload: { output: { skills: [card], nextOffset: null } } }]
      } });
      readStage.mockReturnValue({ skillDiscovery: true, skillReadableIds: [id], observation: { outcome: "structural_model" },
        tools: tools(["skill.read", "skill.report_gap", "user.ask"]) });
      proposeOnce(guided("Gap.", { tool: "skill.report_gap", skillGap: { reason: "Search found nothing." } }));
      proposeOnce((request: AppleCompletionRequest) => {
        const evidence = JSON.parse(request.prompt);
        expect(evidence.cards).toEqual([card]);
        expect(evidence.reason).toBe("Search found nothing.");
        if (mode === "timeout") return new AppleTransportError("timeout");
        if (mode === "stale anchors") return allowCatalogGap(request, 1);
        if (permitsGap) return allowCatalogGap(request);
        expect(evidence.sourceSpans).toHaveLength(1);
        expect(evidence.sourceSpans[0].text).not.toMatch(/measurements later/i);
        expect(request.schema.fields.some(field => field.name === "relationshipSpanId")).toBe(false);
        if (mode === "deferred anchor") return { gapFit: "no_fit_with_resolved_scope", scopeSpanId: evidence.sourceSpans[0].id, relationshipSpanId: "deferred-values" };
        return { gapFit: "read_candidate", scopeSpanId: evidence.sourceSpans[0].id, readSkillId: mode === "forged card" ? "forged-card" : id };
      });
      propose((request: AppleCompletionRequest) => {
        if (request.schema.fields[0]?.name === "scopeQuestionFit") {
          const evidence = JSON.parse(request.prompt);
          return mode === "stale anchors" ? { scopeQuestionFit: "hold" }
            : { scopeQuestionFit: "material_question", scopeSpanId: evidence.scopeSpans[0].id };
        }
        return mode === "serial read" || mode === "substituted read"
          ? guided("Read a capacity method.", { tool: "skill.read", skillRead: { skillId: mode === "serial read" ? id : "unreviewed-card" } })
          : guided("Clarify material flow.", { tool: "user.ask", focusedQuestion: {
            question: "Do the stages process the same material in series or have separate outputs?", reason: "The answer changes the relationship."
          } });
      });
      const screenFit = vi.fn((request: AppleCompletionRequest) => {
        const prompt = JSON.parse(request.prompt);
        expect(prompt.cards).toEqual([{ choice: "card_1", title: card.title, description: card.description, scope: card.scope }]);
        expect(prompt.sourceSpans.some((span: { text: string }) => brief.includes(span.text))).toBe(true);
        expect(prompt.reason).toBeUndefined();
        return { plausibleCard: mode === "screen lead" ? "card_1" : mode === "screen forged" ? "card_2" : "no_plausible_card" };
      });
      screenCatalogWith(screenFit);
      const checkpoint = {
        type: "tool_results", batchId: "empty-search", results: [{ toolName: "skill.search", status: "succeeded",
          ...(screen ? { externalCallId: "gap-catalog:call", resultCode: "OK" } : {}),
          payload: { output: { candidates: [] } } }]
      } as const;
      const newerText = mode === "stale anchors" ? "Change the business scope to equipment inspections." : mode === "acknowledgment" ? "Please proceed." : undefined;
      const completed = turn.completeTurn({ ...initial, exchangeId: "actual-gap", previousCursor: searched.cursor,
        delta: newerText ? { type: "checkpoint_inputs", checkpointDelta: checkpoint,
          inputs: [{ type: "user_instruction", text: newerText }] } : checkpoint });
      if (mode === "substituted read") {
        await expect(completed).rejects.toMatchObject({ reason: "CANONICAL_VALIDATION" });
      } else if (mode === "stale anchors") {
        await expect(completed).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
      } else if (mode === "screen forged") {
        await expect(completed).rejects.toMatchObject({ stage: "CATALOG_UNREAD_FIT", reason: "CANONICAL_VALIDATION" });
      } else {
        const expected = mode === "screen lead" ? { toolName: "skill.read", args: { skillId: id } }
          : { toolName: permitsGap ? "skill.report_gap" : mode === "serial read" ? "skill.read" : "user.ask" };
        await expect(completed).resolves.toMatchObject({ output: { action: { batch: { calls: [expected] } } } });
      }
      expect(screenFit).toHaveBeenCalledTimes(screen ? 1 : 0);
      const expectedCalls = permitsGap ? 4 + Number(screen) : ["serial read", "substituted read"].includes(mode) ? 5 : 6;
      expect(calls).toHaveLength(expectedCalls);
      if (mode === "archive") {
        const plan = { version: 1, goal: "Measure active review hours", nodes: [
          { nodeId: "reviewed_recordings", parentNodeId: "root_1", kind: "input" },
          { nodeId: "hours_per_recording", parentNodeId: "root_1", kind: "input" }
        ] };
        const name = "vdt.set_decomposition_plan";
        readStage.mockReturnValue({ observation: { revision: 0, outcome: "structural_model", rootNodeId: "root_1", nodeCount: 1,
          skillResolution: { outcome: "no_applicable_skill" } }, tools: tools([name]) });
        proposeOnce({ sessionState: "Build from the recorded gap.", tool: name, argumentsJson: '{"goal":"Review hours"}' });
        proposeOnce((native: AppleCompletionRequest) => {
          const { formatFeedback } = JSON.parse(native.prompt);
          expect(formatFeedback.replacePaths).toEqual([["plan"]]);
          expect(formatFeedback.omitPaths).toEqual([["goal"]]);
          return { sessionState: "Submit the first validated plan.", tool: name, repairDecision: "repair", fragmentJson: JSON.stringify(plan) };
        });
        await expect(turn.completeTurn({ ...initial, exchangeId: "post-gap", previousCursor: (await completed).cursor, delta: {
          type: "tool_results", batchId: "confirmed-gap", results: [{
            toolName: "skill.report_gap", externalCallId: "actual-gap:call", status: "succeeded", resultCode: "OK",
            payload: { output: { outcome: "no_applicable_skill" }, projectChanged: false }
          }]
        } })).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: name, args: { plan } }] } } } });
        expect(calls).toHaveLength(expectedCalls + 2);
      }
    }
  );

  it.each(["displaces read", "displaces question", "wrong receipt", "new scope", "same scope budget", "material wait",
    "answered empty search", "reject stale selection on answer", "wrong question set on answer", "pinned on answer"])(
    "uses one recovery screen on authentic empty search for %s", async mode => {
      const { turn, calls, readStage, propose, screenCatalogWith } = fixture();
      const brief = "Build an editable tree for finishing capacity per hour. The first operation finishes coated panels. The second checks panels before dispatch. I will enter measurements later.";
      const card = (id: string, title: string) => ({
        id, title, description: title, scope: [title], version: 1, contentHash: `sha256:${"a".repeat(64)}`
      });
      const relevant = card("process", "Process capacity across stages");
      const unrelated = card("accounts", "Monthly account renewals");
      const scope = { outcome: "structural_model", skillResolution: { confirmationRequired: false } };
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      const stage = (names: string[], readable?: string[]) => ({
        skillDiscovery: true as const, observation: scope, tools: tools(names), ...(readable ? { skillReadableIds: readable } : {})
      });
      const result = (toolName: string, externalCallId: string, output: Record<string, unknown>) => ({
        type: "tool_results", batchId: externalCallId, results: [{ toolName, externalCallId, resultCode: "OK", status: "succeeded", payload: { output } }]
      } as const);
      const expectCall = (output: unknown, toolName: string, args?: object) => expect(output).toMatchObject({
        action: { batch: { calls: [{ toolName, ...(args ? { args } : {}) }] } }
      });
      readStage.mockReturnValue({ ...stage(["skill.list"]), skillListArguments: {} });
      propose(guided("Browse.", { tool: "skill.list" }));
      const first = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "empty-recovery",
        context: { brief: { prompt: brief } } } });
      readStage.mockReturnValue(stage(["skill.search"]));
      const searchProposal = guided("Search.", { tool: "skill.search", skillSearch: { rootKpi: "Finishing capacity" } });
      propose(searchProposal);
      const searched = await turn.completeTurn({ ...initial, exchangeId: "recover-search", previousCursor: first.cursor,
        delta: result("skill.list", "exchange-1:call", { skills: [unrelated, relevant], nextOffset: null }) });

      const screened = vi.fn((request: AppleCompletionRequest) => {
        const evidence = JSON.parse(request.prompt);
        expect(evidence.cards.map(({ title }: { title: string }) => title)).toEqual([unrelated.title, relevant.title]);
        expect(evidence.sourceSpans.some(({ text }: { text: string }) => text.includes("finishing capacity"))).toBe(true);
        return { plausibleCard: mode === "same scope budget" ? "no_plausible_card" : "card_2" };
      });
      screenCatalogWith(screened);
      readStage.mockReturnValue(stage(["skill.read", "user.ask"], [unrelated.id, relevant.id]));
      const unrelatedRead = guided("Read renewals.", { tool: "skill.read", skillRead: { skillId: unrelated.id } });
      propose(mode === "displaces question" ? guided("Ask about renewals.", { tool: "user.ask", focusedQuestion: {
        question: "Which accounts renew this month?", reason: "It determines net renewals."
      } }) : unrelatedRead);
      const emptyResult = result("skill.search", mode === "wrong receipt" ? "other:call" : "recover-search:call", { candidates: [] });
      const recovered = await turn.completeTurn({ ...initial, exchangeId: "recover-guidance", previousCursor: searched.cursor,
        delta: mode === "new scope" ? { type: "checkpoint_inputs", checkpointDelta: emptyResult,
          inputs: [{ type: "user_instruction", text: "Use a different reporting scope." }] } : emptyResult });
      const canScreen = mode !== "wrong receipt" && mode !== "new scope";
      expect(screened).toHaveBeenCalledTimes(canScreen ? 1 : 0);
      expectCall(recovered.output, "skill.read", { skillId: canScreen && mode !== "same scope budget" ? relevant.id : unrelated.id });

      if (mode === "same scope budget") {
        readStage.mockReturnValue(stage(["skill.search"]));
        propose(searchProposal);
        const again = await turn.completeTurn({ ...initial, exchangeId: "same-scope-search", previousCursor: recovered.cursor,
          delta: result("skill.read", "recover-guidance:call", {}) });
        readStage.mockReturnValue(stage(["skill.read", "user.ask"], [unrelated.id, relevant.id]));
        propose(unrelatedRead);
        const repeated = await turn.completeTurn({ ...initial, exchangeId: "second-empty", previousCursor: again.cursor,
          delta: result("skill.search", "same-scope-search:call", { candidates: [] }) });
        expectCall(repeated.output, "skill.read", { skillId: unrelated.id });
        expect(screened).toHaveBeenCalledTimes(1);
      }
      const resume = mode === "answered empty search" || mode === "reject stale selection on answer"
        || mode === "wrong question set on answer" || mode === "pinned on answer";
      if (mode === "material wait" || resume) {
        const method = { skillId: relevant.id, readReceiptId: "read-process", version: relevant.version,
          contentHash: relevant.contentHash, excerpt: "Use a bottleneck for serial flow and sum separate finished output streams." };
        readStage.mockReturnValue({ ...stage(["user.ask", "skill.select"]),
          observation: { ...scope, readSkillMethods: [method] }, skillSelectReceipts: new Map([[relevant.id, method.readReceiptId]]) });
        const question = "Do all panels pass through both operations, or does each produce separate finished panels?";
        const audit = vi.fn((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          expect(evidence.draft.question).toBe(question);
          expect(evidence.userSources.originalRequest).toBe(brief);
          return { scopeQuestionFit: "material_question", scopeSpanId: evidence.scopeSpans[0].id };
        });
        propose((request: AppleCompletionRequest) => request.schema.fields[0]?.name === "scopeQuestionFit" ? audit(request)
          : guided("Clarify flow.", { tool: "user.ask", focusedQuestion: { question, reason: "It determines how operation capacities combine." } }));
        const waiting = await turn.completeTurn({ ...initial, exchangeId: "verified-wait", previousCursor: recovered.cursor,
          delta: result("skill.read", "recover-guidance:call", { ...method, id: relevant.id }) });
        expectCall(waiting.output, "user.ask", { questions: [{ question, id: "skill_scope", required: true }] });
        expect(audit).toHaveBeenCalledTimes(1);
        expect(screened).toHaveBeenCalledTimes(1);
        if (!resume) return;

        const pinnedOnAnswer = mode === "pinned on answer";
        const staleSelection = guided("Reuse the earlier method.", { tool: "skill.select",
          skillSelection: { skillId: relevant.id, reason: "Use the prior provisional read." } });
        const answer = "All panels flow through both operations in series.";
        readStage.mockReturnValue({ ...stage(["skill.search", "skill.select", "user.ask"]),
          observation: { ...scope, readSkillMethods: [method], skillResolution: { ...scope.skillResolution,
            ...(pinnedOnAnswer ? { pinnedSkillId: relevant.id } : {}) } },
          skillSelectReceipts: new Map([[relevant.id, method.readReceiptId]]) });
        propose((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          const available = evidence.tools.map(({ name }: { name: string }) => name).sort();
          if (mode === "wrong question set on answer" || pinnedOnAnswer) {
            expect(available).toEqual(["skill.search", "skill.select", "user.ask"]);
            return pinnedOnAnswer ? staleSelection : searchProposal;
          }
          expect(available).toEqual(["skill.search"]);
          expect(evidence.originalBrief.prompt).toBe(brief);
          expect(evidence.submittedUserAnswers).toEqual([{ question, answer: [answer] }]);
          expect(evidence.revisionInstruction).toContain("current business scope");
          return mode === "reject stale selection on answer" ? staleSelection : guided("Search the clarified scope.", {
            tool: "skill.search", skillSearch: { rootKpi: "Finishing capacity", businessContext: answer }
          });
        });
        const beforeAnswer = calls.length;
        const answered = turn.completeTurn({ ...initial, exchangeId: "answered-recovery", previousCursor: waiting.cursor,
          delta: { type: "human_input", input: { type: "user_answer",
            questionSetId: mode === "wrong question set on answer" ? "unrelated-questions" : "questions-verified-wait:call",
            answers: { structuredAnswers: [{ questionId: "skill_scope", fields: { answer } }] } } } });
        if (mode === "reject stale selection on answer") {
          await expect(answered).rejects.toMatchObject({ reason: "GUIDED_ENVELOPE" });
          expect(calls).toHaveLength(beforeAnswer + 1);
          return;
        }
        const resumed = await answered;
        if (pinnedOnAnswer || mode === "wrong question set on answer") {
          expectCall(resumed.output, pinnedOnAnswer ? "skill.select" : "skill.search");
          return;
        }
        expectCall(resumed.output, "skill.search", { businessContext: answer });
        expect(calls).toHaveLength(beforeAnswer + 1);
        readStage.mockReturnValue(stage(["skill.read"], [relevant.id]));
        propose(guided("Read the current candidate.", { tool: "skill.read", skillRead: { skillId: relevant.id } }));
        const refreshed = await turn.completeTurn({ ...initial, exchangeId: "current-result", previousCursor: resumed.cursor,
          delta: result("skill.search", "answered-recovery:call", { candidates: [relevant] }) });
        expectCall(refreshed.output, "skill.read", { skillId: relevant.id });
      }
    }
  );

  it.each(["archive", "repeat rejected", "fits", "ambiguity", "wrong search", "wrong tool", "failed search", "malformed search", "nonempty", "nonempty pivot", "wrong content", "wrong receipt", "partial catalog", "stale", "mixed stale", "pinned", "confirming", "timeout",
    "foreign premise corrected", "correction audit hold", "settled after search", "settled surplus relationship", "repaired settled span", "unverified settled span",
    "material surplus relationship", "material surplus declined", "material surplus invalid span", "hold surplus relationship",
    "incompatible coverage", "unresolved coverage", "unresolved hold coverage", "repaired coverage", "forged coverage"])(
    "reviews the exact provisional selection after a complete current empty search for %s", async mode => {
      const { turn, calls, propose, proposeOnce, readStage, reviewFitWith, reviewWith } = fixture();
      const ordinary = mode === "nonempty" || mode === "nonempty pivot";
      const correction = mode === "foreign premise corrected" || mode === "correction audit hold";
      const settled = ["settled after search", "settled surplus relationship", "repaired settled span", "unverified settled span"].includes(mode);
      const surplus = mode.includes("surplus");
      const rejectsSurplus = mode === "material surplus declined" || mode === "material surplus invalid span" || mode === "hold surplus relationship";
      const positive = mode === "fits" || mode === "repaired coverage" || ordinary;
      const openCoverage = mode.startsWith("unresolved");
      const falsePositive = mode.endsWith(" coverage");
      const id = openCoverage ? "operations.review_time" : positive ? "operations.process_capacity" : falsePositive ? "logistics.cargo_handling" : "mining.mine_production_system";
      const brief = positive
        ? "Build a capacity tree for varnished frames released by the workshop. Each frame goes through curing and then sealing. The lower of those two finishing rates limits the released frames."
        : mode === "ambiguity" || openCoverage || correction || (surplus && !settled) ? "Build an editable review hours tree. I record active review and waiting time separately."
          : archiveBrief;
      const card = { id, title: id, description: "", scope: [], version: 1, contentHash: `sha256:${"a".repeat(64)}` };
      const method = { skillId: id, version: card.version, contentHash: mode === "wrong content" ? `sha256:${"b".repeat(64)}` : card.contentHash,
        readReceiptId: "exact-read", excerpt: positive
          ? "The lower capacity of consecutive stages on one material flow determines capacity."
          : openCoverage ? "Report review hours from recorded active intervals. Include waiting intervals when the reporting boundary counts elapsed time."
            : falsePositive ? "Model only loaded cargo released at a seaport. Use the handling rate for the active cranes, in items each hour."
            : "Model metallic-ore production across drilling, loading and haulage in the mine-wide system." };
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      const step = (exchangeId: string, previousCursor: string, toolName: string, externalCallId: string, output: Record<string, unknown>, failed = false) =>
        turn.completeTurn({ ...initial, exchangeId, previousCursor, delta: { type: "tool_results", batchId: exchangeId,
          results: [{ toolName, externalCallId, resultCode: failed ? "FAILED" : "OK", status: failed ? "failed" : "succeeded", payload: { output } }] } });
      readStage.mockReturnValue({ skillDiscovery: true, skillListArguments: {}, observation: { outcome: "structural_model" }, tools: tools(["skill.list"]) });
      propose(guided("Browse.", { tool: "skill.list" }));
      const first = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "provisional-fit",
        context: { brief: { prompt: brief } } } });
      readStage.mockReturnValue({ skillDiscovery: true, observation: { outcome: "structural_model" }, tools: tools(["skill.search"]) });
      propose(guided("Search.", { tool: "skill.search", skillSearch: { rootKpi: "Requested tree" } }));
      const searched = await step("provisional-search", first.cursor, "skill.list", "exchange-1:call", { skills: [card], nextOffset: mode === "partial catalog" ? 1 : null });
      readStage.mockReturnValue({ skillDiscovery: true, skillReadableIds: [id], observation: { outcome: "structural_model" },
        tools: tools(["skill.read", "skill.report_gap", "user.ask"].filter(name => name !== "skill.report_gap" || mode !== "partial catalog")) });
      if (settled) {
        const draft = { question: "Does waiting time count toward reported review hours?", reason: "The answer determines which intervals are included." };
        const gap = vi.fn(allowCatalogGap);
        reviewWith(() => ({ readiness: "distinct_material_gap", conclusion: "Uncertain in initial review." }));
        proposeOnce(guided("Ask about the measurement boundary.", { tool: "user.ask", focusedQuestion: draft }));
        const audit = vi.fn((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          const relationshipQuote = "Count only active review time for the recordings reviewed that month.";
          const witness = evidence.scopeSpans.find(({ text }: { text: string }) => text.includes(relationshipQuote));
          return { scopeQuestionFit: "settled_by_current_scope", scopeSpanId: mode === "settled after search" || surplus ? witness.id : "invented",
            ...(surplus ? { openRelationship: "Surplus field from another branch." } : {}) };
        });
        proposeOnce(audit);
        if (mode !== "settled after search") proposeOnce((request: AppleCompletionRequest) => {
          const { formatFeedback, originalTask } = JSON.parse(request.prompt);
          const { scopeSpans } = JSON.parse(originalTask);
          const witness = scopeSpans.find(({ text }: { text: string }) => text.includes("Count only active review time"));
          if (surplus) {
            expect(formatFeedback.preserved).toEqual({ scopeQuestionFit: "settled_by_current_scope", scopeSpanId: witness.id });
            expect(formatFeedback.replaceFields).toEqual([]);
            expect(formatFeedback.issues).toEqual([expect.objectContaining({ field: ["openRelationship"] })]);
            return { repairDecision: "repair" };
          }
          expect(formatFeedback.preserved).toEqual({ scopeQuestionFit: "settled_by_current_scope" });
          expect(formatFeedback.replaceFields).toEqual(["scopeSpanId"]);
          return { repairDecision: "repair", fragment: { scopeSpanId: mode === "repaired settled span" ? witness.id : "still-invented" } };
        });
        propose((request: AppleCompletionRequest) => request.schema.fields[0]?.name === "gapFit" ? gap(request)
          : guided("Report a catalog candidate gap.", { tool: "skill.report_gap", skillGap: { reason: "The card concerns another operation." } }));
        const decision = step("empty-search-ask", searched.cursor, "skill.search", "provisional-search:call", { candidates: [] });
        if (mode === "unverified settled span") {
          await expect(decision).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
          expect(gap).toHaveBeenCalledTimes(0);
        } else {
          await expect(decision).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: "skill.report_gap" }] } } } });
          expect(gap).toHaveBeenCalledTimes(1);
        }
        expect(audit).toHaveBeenCalledTimes(1);
        return;
      }
      propose(guided("Read the card.", { tool: "skill.read", skillRead: { skillId: id } }));
      const completeRead = mode === "mixed stale" ? await turn.completeTurn({ ...initial, exchangeId: "provisional-read", previousCursor: searched.cursor,
        delta: { type: "checkpoint_inputs", inputs: [{ type: "user_instruction", text: "Use independently measured outputs instead." }],
          checkpointDelta: { type: "tool_results", batchId: "mixed", results: [{ toolName: "skill.search", externalCallId: "provisional-search:call",
            resultCode: "OK", status: "succeeded", payload: { output: { candidates: [] } } }] } } })
        : mode === "nonempty pivot" ? undefined
        : await step("provisional-read", searched.cursor, mode === "wrong tool" ? "skill.list" : "skill.search",
          mode === "wrong search" ? "forged:call" : "provisional-search:call",
          { candidates: mode === "malformed search" ? [{}] : mode === "nonempty" ? [card] : [] }, mode === "failed search");
      let read = completeRead;
      if (!read) {
        readStage.mockReturnValue({ skillDiscovery: true, observation: { outcome: "structural_model" }, tools: tools(["skill.search"]) });
        propose(guided("Search again.", { tool: "skill.search", skillSearch: { rootKpi: "Current output" } }));
        const pivot = await step("provisional-pivot", searched.cursor, "skill.search", "provisional-search:call", {}, true);
        readStage.mockReturnValue({ skillDiscovery: true, skillReadableIds: [id], observation: { outcome: "structural_model" },
          tools: tools(["skill.read", "user.ask"]) });
        propose(guided("Read the exact candidate.", { tool: "skill.read", skillRead: { skillId: id } }));
        read = await step("provisional-read", pivot.cursor, "skill.search", "provisional-pivot:call", { candidates: [card] });
      }
      const readiness = vi.fn(() => ({ conclusion: "The same material advances in sequence.", readiness: "method_ready" }));
      reviewWith(readiness);
      readStage.mockReturnValue({ skillDiscovery: true, skillSelectReceipts: new Map([[id, mode === "wrong receipt" ? "different-read" : method.readReceiptId]]),
        ...(mode === "repeat rejected" ? { skillReadableIds: [id] } : {}),
        observation: { outcome: "structural_model", readSkillMethods: [method], ...(mode === "pinned"
          ? { skillResolution: { pinnedSkillId: id } } : mode === "confirming" ? { skillResolution: { pendingMethod: { skillId: id } } } : {}) },
        tools: tools(["skill.select", "user.ask", ...(mode === "partial catalog" ? [] : ["skill.report_gap"]),
          ...(mode === "repeat rejected" ? ["skill.read"] : [])]) });
      if (correction) {
        const foreign = { question: "Which mineral sales should count toward review hours?", reason: "Ore sales could change the output." };
        const revised = { question: "Does waiting time count toward reported review hours?", reason: "The answer determines which intervals are included." };
        const openRelationship = "Whether reported review hours include waiting time alongside active review.";
        const assess = vi.fn((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          expect(evidence.userSources.originalRequest).toBe(brief);
          expect(evidence.method).toBeUndefined();
          expect(evidence.draft).toEqual(evidence.intendedRelationship ? revised : foreign);
          return evidence.intendedRelationship
            ? { scopeQuestionFit: mode === "correction audit hold" ? "hold" : "material_question", scopeSpanId: evidence.scopeSpans[0].id }
            : { scopeQuestionFit: "unrelated_with_open_relationship", scopeSpanId: evidence.scopeSpans[0].id, openRelationship };
        });
        const repair = vi.fn((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          expect(evidence.tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
          expect(evidence.scopeAnalysis).toBe(openRelationship);
          return guided("Ask about actual review time.", { tool: "user.ask", focusedQuestion: revised });
        });
        proposeOnce(guided("Ask about sales.", { tool: "user.ask", focusedQuestion: foreign }));
        proposeOnce(assess);
        proposeOnce(repair);
        proposeOnce(assess);
        const decision = step("provisional-ask", read.cursor, "skill.read", "provisional-read:call", { ...method, id });
        if (mode === "correction audit hold") {
          await expect(decision).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
        } else {
          await expect(decision).resolves.toMatchObject({ output: { action: { batch: { calls: [{
            toolName: "user.ask", args: { questions: [expect.objectContaining(revised)] }
          }] } } } });
        }
        expect(assess).toHaveBeenCalledTimes(2);
        expect(repair).toHaveBeenCalledTimes(1);
        return;
      }
      proposeOnce(guided("Select the method.", { tool: "skill.select", skillSelection: { skillId: id,
        reason: "It describes production-like stages." } }));
      const fit = vi.fn((request: AppleCompletionRequest) => {
        const evidence = JSON.parse(request.prompt);
        expect(evidence.emptySearchFitPolicy).toContain("actual operation, output boundary and governing relationship");
        expect(evidence.proposedMethod).toMatchObject({ skillId: id, readReceiptId: method.readReceiptId });
        if (positive || falsePositive) return proposedFit(request, "It covers the requested output.");
        if (mode === "timeout") return new AppleTransportError("timeout", undefined, "PARENT_DEADLINE");
        return { fit: mode === "ambiguity" || surplus ? "material_scope_missing" : "no_reviewed_method_matches", conclusion: "The actual operation differs." };
      });
      reviewFitWith(fit);
      const corroboration = vi.fn((request: AppleCompletionRequest) => {
        const evidence = JSON.parse(request.prompt);
        expect(Object.keys(evidence).sort()).toEqual(["instruction", "methodSpans", "sourceSpans"]);
        expect(evidence.methodSpans.map(({ text }: { text: string }) => text).join("")).toBe(method.excerpt);
        expect(evidence.sourceSpans[0].text).toBe(brief.split(". ")[0] + ".");
        if (mode.startsWith("unresolved")) return { methodCoverage: "unresolved" };
        return {
          methodCoverage: mode === "incompatible coverage" ? "incompatible" : "applicable",
          scopeSpanId: evidence.sourceSpans[0].id,
          methodSpanId: ["repaired coverage", "forged coverage"].includes(mode) ? "invented-id" : evidence.methodSpans[0].id
        };
      });
      if (mode === "fits" || falsePositive) proposeOnce(corroboration);
      if (mode === "repaired coverage" || mode === "forged coverage") proposeOnce((request: AppleCompletionRequest) => {
        const { formatFeedback, originalTask } = JSON.parse(request.prompt);
        const { sourceSpans, methodSpans } = JSON.parse(originalTask);
        expect(formatFeedback.preserved).toEqual({ methodCoverage: "applicable", scopeSpanId: sourceSpans[0].id });
        expect(formatFeedback.replaceFields).toEqual(["methodSpanId"]);
        return { repairDecision: "repair", fragment: {
          methodSpanId: mode === "repaired coverage" ? methodSpans[0].id : "still-invented"
        } };
      });
      if (ordinary) proposeOnce({ measurementBoundary: "not_established" });
      if (mode === "archive" || mode === "repeat rejected" || mode === "incompatible coverage") {
        proposeOnce(guided("Report the gap.", { tool: "skill.report_gap", skillGap: { reason: "Review activity differs from mine production." } }));
        proposeOnce((request: AppleCompletionRequest) => {
          const evidence = JSON.parse(request.prompt);
          expect(evidence.rejectedMethods).toEqual([{ skillId: id, readReceiptId: method.readReceiptId, version: card.version, contentHash: card.contentHash }]);
          if (mode === "repeat rejected") {
            expect(request.schema.fields.some(field => field.name === "readSkillId")).toBe(false);
            return { gapFit: "read_candidate", scopeSpanId: evidence.sourceSpans[0].id, readSkillId: id };
          }
          return allowCatalogGap(request);
        });
      }
      const omission = vi.fn((request: AppleCompletionRequest) => {
        const { formatFeedback, originalTask } = JSON.parse(request.prompt);
        expect(formatFeedback.preserved).toEqual({ scopeQuestionFit: "material_question", scopeSpanId: JSON.parse(originalTask).scopeSpans[0].id });
        expect(formatFeedback.replaceFields).toEqual([]);
        expect(formatFeedback.issues).toEqual([expect.objectContaining({ field: ["openRelationship"] })]);
        return { repairDecision: mode === "material surplus declined" ? "decline" : "repair" };
      });
      if (mode === "ambiguity" || surplus || openCoverage || mode === "repeat rejected") propose((request: AppleCompletionRequest) => {
        if (request.schema.fields[0]?.name === "repairDecision") return omission(request);
        if (request.schema.fields[0]?.name === "scopeQuestionFit") {
          const evidence = JSON.parse(request.prompt);
          return mode === "repeat rejected" || mode === "unresolved hold coverage" ? { scopeQuestionFit: "hold" }
            : { scopeQuestionFit: mode === "hold surplus relationship" ? "hold" : "material_question",
              scopeSpanId: mode === "material surplus invalid span" ? "invented" : evidence.scopeSpans[0].id,
              ...(surplus ? { openRelationship: "Whether waiting time belongs in total review hours." } : {}) };
        }
        if (openCoverage) expect(JSON.parse(request.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
        return guided("Clarify scope.", { tool: "user.ask", focusedQuestion: {
          question: "Should waiting time count toward reported review hours?", reason: "The boundary determines which intervals are included."
        } });
      });
      const answer = mode === "stale" ? turn.completeTurn({ ...initial, exchangeId: "provisional-steer", previousCursor: read.cursor,
        delta: { type: "human_input", input: { type: "user_instruction", text: "Use independently measured outputs instead." } } })
        : step("provisional-select", read.cursor, "skill.read", "provisional-read:call", {});
      const fenced = mode.startsWith("wrong") || mode.endsWith("stale") || ["partial catalog", "failed search", "malformed search"].includes(mode);
      const exempt = mode === "pinned" || mode === "confirming" || ordinary;
      if (fenced || ordinary) {
        await expect(answer).rejects.toMatchObject({ reason: "HOST_EVIDENCE" });
        expect(fit).not.toHaveBeenCalled();
      } else if (mode === "timeout") {
        await expect(answer).rejects.toMatchObject({ code: "timeout" });
        expect(fit).toHaveBeenCalledTimes(1);
      } else if (mode === "repeat rejected" || mode === "unresolved hold coverage" || rejectsSurplus) {
        await expect(answer).rejects.toMatchObject({ stage: "CATALOG_SCOPE_QUESTION", reason: "HOST_EVIDENCE" });
        expect(fit).toHaveBeenCalledTimes(1);
      } else if (mode === "forged coverage") {
        await expect(answer).rejects.toMatchObject({ stage: "PROVISIONAL_METHOD_COVERAGE", reason: "CANONICAL_VALIDATION" });
        expect(fit).toHaveBeenCalledTimes(1);
      } else {
        const expected = positive || exempt ? { toolName: "skill.select", args: { skillId: id, readReceiptId: method.readReceiptId } }
          : { toolName: mode === "archive" || mode === "incompatible coverage" ? "skill.report_gap" : "user.ask" };
        await expect(answer).resolves.toMatchObject({ output: { action: { batch: { calls: [expected] } } } });
        expect(fit).toHaveBeenCalledTimes(exempt ? 0 : 1);
      }
      expect(omission).toHaveBeenCalledTimes(mode === "material surplus relationship" || mode === "material surplus declined" ? 1 : 0);
      expect(corroboration).toHaveBeenCalledTimes(mode === "fits" || falsePositive ? 1 : 0);
      expect(readiness).not.toHaveBeenCalled();
      expect(calls.filter(request => request.schema.fields[0]?.name === "measurementBoundary")).toHaveLength(ordinary ? 1 : 0);
      expect(calls.filter(request => request.schema.fields[0]?.name === "fit")).toHaveLength(fenced || exempt ? 0 : 1);
    }
  );

  it.each(["observed", "twice invalid", "ineligible retry", "mixed", "invalid state", "failed list", "wrong list call", "partial list",
    "no search", "no preceding list", "new scope", "pinned", "native failure", "cancelled"])(
    "bounds a missing guided action after catalog browse for %s", async mode => {
      const { turn, calls, propose, proposeOnce, readStage } = fixture();
      const tools = (names: string[]) => createDefaultToolRegistry().list().filter(tool => names.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      readStage.mockReturnValue({ skillDiscovery: true, skillListArguments: {}, observation: { outcome: "structural_model" }, tools: tools(["skill.list"]) });
      propose(guided("Browse.", { tool: "skill.list" }));
      const listed = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "drop-after-catalog",
        context: { brief: { prompt: archiveBrief } } } });
      const allowed = mode === "no search" ? ["user.ask"] : ["skill.search", "user.ask"];
      readStage.mockReturnValue({ skillDiscovery: true, observation: { outcome: "structural_model",
        ...(mode === "pinned" ? { skillResolution: { pinnedSkillId: "exact" } } : {}) }, tools: tools(allowed) });
      const abort = new AbortController();
      const missing = { sessionState: "s".repeat(567) };
      proposeOnce(mode === "cancelled" ? () => { abort.abort(); return missing; }
        : mode === "mixed" ? { ...missing, extra: true } : mode === "invalid state" ? { sessionState: "   " }
          : mode === "native failure" ? new AppleTransportError("invalid_output", "native_output") : missing);
      propose(mode === "twice invalid" ? missing : mode === "ineligible retry" ? guided("Read anyway.", { tool: "skill.read", skillRead: { skillId: "exact" } })
        : guided("Search current scope.", { tool: "skill.search", skillSearch: { rootKpi: "Review hours" } }));
      const checkpoint = { type: "tool_results", batchId: "browse-result", results: [{
        externalCallId: mode === "wrong list call" ? "wrong:call" : "exchange-1:call", toolName: "skill.list",
        resultCode: mode === "failed list" ? "FAILED" : "OK", status: mode === "failed list" ? "failed" : "succeeded",
        payload: { output: { nextOffset: mode === "partial list" ? 1 : null, skills: [{ id: "exact", title: "Exact", description: "",
          scope: [], version: 1, contentHash: `sha256:${"a".repeat(64)}` }] } }
      }] } as const;
      const answer = turn.completeTurn({ ...initial, exchangeId: "after-browse", previousCursor: listed.cursor, signal: abort.signal,
        delta: mode === "no preceding list" ? { type: "tool_results", batchId: "unrelated", results: [] }
          : mode === "new scope" ? { type: "checkpoint_inputs", checkpointDelta: checkpoint,
            inputs: [{ type: "user_instruction", text: "Use the day instead of the month." }] } : checkpoint });
      if (mode === "observed") {
        await expect(answer).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: "skill.search", externalCallId: "after-browse:call" }] } } } });
      } else {
        await expect(answer).rejects.toMatchObject({ code: mode === "cancelled" ? expect.stringMatching(/^(cancelled|invalid_output)$/) : "invalid_output" });
      }
      const retried = ["observed", "twice invalid", "ineligible retry"].includes(mode);
      expect(calls).toHaveLength(retried ? 3 : 2);
      if (retried) {
        const ordinary = JSON.parse(calls[1]!.prompt);
        const repair = JSON.parse(calls[2]!.prompt);
        expect(repair.tools).toEqual(ordinary.tools);
        expect(repair.originalBrief).toEqual(ordinary.originalBrief);
        expect(repair.checkpoint).toEqual(ordinary.checkpoint);
        expect(repair.sessionState).toEqual(ordinary.sessionState);
      }
    });

  function compactPlanFixture(noSkill = false) {
    const f = fixture();
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Output", rootKpi: "Output", unit: "h" });
    const registry = createDefaultToolRegistry();
    const setStage = (skillResolution = noSkill ? { outcome: "no_applicable_skill" } as Record<string, unknown> : undefined) => {
      const structuralGuide = structuralGuideFor(builder.getProject())!;
      f.readStage.mockReturnValue({
        structuralGuide,
        observation: { outcome: "structural_model", ...(skillResolution ? { skillResolution } : {}) },
        tools: structuralGuide.names.map(name => {
          const tool = registry.list().find(tool => tool.name === name)!;
          return { name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) =>
            tool.inputSchema.parse(args) as Record<string, unknown> };
        })
      });
    };
    setStage();
    expect(structuralGuideFor(builder.getProject())?.phase).toBe("plan");
    return { ...f, builder, setStage };
  }

  const sizePlan = (goal: string, nodes: unknown[] = [{ nodeId: "quantity" }, { nodeId: "duration" }], sessionState = "Continue.") =>
    guided(sessionState, { tool: "vdt.set_decomposition_plan", plan: { goal, nodes } });
  const oversizedPlanNodes = Array.from({ length: 9 }, (_value, index) => ({ nodeId: `operand_${index}` }));

  it.each([
    ["goal", sizePlan("g".repeat(501))],
    ["nodes", sizePlan("A plan", oversizedPlanNodes)],
    ["rationale", sizePlan("A plan", [{ nodeId: "quantity", rationale: "r".repeat(301) }, { nodeId: "duration" }])]
  ])("re-proposes a compact plan once on its sole oversized %s", async (_field, oversized) => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture();
    proposeOnce(oversized);
    const revisedGoal = "Keep the two user inputs editable";
    propose(sizePlan(revisedGoal));
    const result = await turn.completeTurn(initial);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ schema: calls[0]!.schema, expectedIdentity: calls[0]!.expectedIdentity, locale: calls[0]!.locale });
    const first = JSON.parse(calls[0]!.prompt);
    const revised = JSON.parse(calls[1]!.prompt);
    expect(revised.tools).toEqual(first.tools);
    expect(revised.originalBrief).toEqual(first.originalBrief);
    expect(revised.revisionInstruction).toContain("500 characters for goal, 8 nodes, and 300 characters per rationale");
    expect(result.output).toMatchObject({ action: { batch: { calls: [{
      toolName: "vdt.set_decomposition_plan", args: { plan: { goal: revisedGoal, nodes: [{ nodeId: "quantity" }, { nodeId: "duration" }] } }
    }] } } });
  });

  it.each([
    ["multiple issues", sizePlan("g".repeat(501), oversizedPlanNodes)],
    ["node ID", sizePlan("A plan", [{ nodeId: "x".repeat(161) }, { nodeId: "duration" }])],
    ["invalid session state", sizePlan("g".repeat(501), undefined, " ")],
    ["native failure", new AppleTransportError("invalid_output", "native_output")],
    ["cancellation", new AppleTransportError("cancelled")]
  ])("leaves compact plan %s fail-closed without retry", async (_label, output) => {
    const { turn, calls, propose } = compactPlanFixture();
    propose(output);
    await expect(turn.completeTurn(initial)).rejects.toBeInstanceOf(AppleTransportError);
    expect(calls).toHaveLength(1);
  });

  it("does not retry another size error after the one canonical plan re-proposal", async () => {
    const { turn, calls, propose } = compactPlanFixture();
    propose(sizePlan("g".repeat(501)));
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ stage: "COMPACT_PLAN_SIZE_RETRY", reason: "PLAN_GOAL_TOO_LONG" });
    expect(calls).toHaveLength(2);
  });

  const aggregateRationale = "Combine the two stage capacities using the formula min(crushing_capacity, screening_capacity) to determine the final production capacity, ensuring no overcounting due to independent stage measurements.";
  const stageInputs = [
    { nodeId: "crushing_capacity", rationale: "The crushing stage reports capacity per operating hour." },
    { nodeId: "screening_capacity", rationale: "The screening stage reports capacity per operating hour." }
  ];

  async function answeredCompactPlanFixture() {
    const f = compactPlanFixture();
    const stage = f.readStage();
    f.readStage.mockReturnValue({ ...stage, observation: { ...stage.observation,
      selectedMethod: { id: "selected-method", readReceiptId: "exact-method-read", excerpt: "Use the lower serial stage capacity." }
    } });
    f.propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: {
      question: "Do the two stages share one material flow?", reason: "The relationship changes the calculation."
    } }));
    const first = await f.turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "answered-structure",
      context: { brief: { prompt: "Build an editable capacity tree for crushing and screening." } } } });
    const action = modelAgentStructuredTurnSchema.parse(first.output).action;
    if (action.type !== "action_batch") throw new Error("Expected a focused question.");
    const questionId = (action.batch.calls[0]?.args.questions as { id: string }[])[0]!.id;
    const resume = () => f.turn.completeTurn({ ...initial, exchangeId: "confirmed-plan", previousCursor: first.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: {
        [questionId]: "The same material passes through both stages in series, and only the final screened output counts. Keep capacities blank."
      } }
    } });
    return { ...f, resume };
  }

  it.each(["corrected", "unchanged", "size then semantic", "semantic then size", "inspect hierarchy"])(
    "handles the observed computed input rationale before dispatch for %s", async mode => {
      const { calls, proposeOnce, propose, resume } = await answeredCompactPlanFixture();
      const wrong = sizePlan("Capacity from the stated stage measures.", [...stageInputs, { nodeId: "min_capacity", rationale: aggregateRationale }]);
      const right = sizePlan("Capacity from the stated stage measures.", stageInputs);
      if (mode === "size then semantic") proposeOnce(sizePlan("x".repeat(501), stageInputs));
      proposeOnce(wrong);
      if (mode !== "size then semantic") proposeOnce(mode === "unchanged" ? wrong
        : mode === "semantic then size" ? sizePlan("x".repeat(501), stageInputs)
          : mode === "inspect hierarchy" ? guided("Inspect.", { tool: "vdt.inspect_hierarchy" }) : right);
      propose({ planFit: "matches_scope", conclusion: "Both independently measured stage capacities drive the result." });
      if (mode === "corrected") {
        const output = (await resume()).output;
        expect(output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes: stageInputs } } }] } } });
        expect(calls).toHaveLength(4);
      } else if (mode === "inspect hierarchy") {
        expect((await resume()).output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.inspect_hierarchy" }] } } });
        expect(calls).toHaveLength(3);
      } else {
        await expect(resume()).rejects.toMatchObject({ stage: "COMPACT_PLAN" });
        expect(calls).toHaveLength(3);
      }
      if (mode !== "size then semantic") {
        const prompt = JSON.parse(calls[2]!.prompt);
        expect(prompt.scopeAnalysis).toContain("The proposed input min_capacity describes a calculation over all the other direct operands");
        expect(prompt.tools.map(({ name }: { name: string }) => name)).toEqual(["vdt.set_decomposition_plan", "vdt.inspect_hierarchy"]);
      }
    }
  );

  it.each([
    "The conveyor capacity is independently measured by its own meter.",
    "Compare against the context formula min(crushing_capacity, screening_capacity), and record the actual independent reading.",
    "Calculate as min(crushing_capacity) to inspect one dependency.",
    "Calculate as min(crushing_capacity, screening_capacity) + external_adjustment.",
    "Calculate as min(crushing_capacity, screening_capacity) ^ external_adjustment.",
    "Calculate as max(min(crushing_capacity, screening_capacity), measured_capacity)."
  ])("keeps the selected-method assessment for a genuine or non-aggregate rationale %s", async rationale => {
    const { calls, propose, proposeOnce, resume } = await answeredCompactPlanFixture();
    const nodes = [...stageInputs, { nodeId: "measured_capacity", rationale }];
    proposeOnce(sizePlan("Review three proposed inputs.", nodes));
    propose({ planFit: "matches_scope", conclusion: "The submitted scope supports the required direct measures." });
    expect((await resume()).output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }] } } });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.schema.fields[0]?.name).toBe("planFit");
  });

  it("checks nested explicit aggregate expressions with the full sibling reference set", async () => {
    const { calls, proposeOnce, propose, resume } = await answeredCompactPlanFixture();
    const nodes = [...stageInputs, { nodeId: "third_input" }, { nodeId: "computed_total",
      rationale: "Calculate as max(min(crushing_capacity, screening_capacity), third_input) before showing the result." }];
    const wrong = sizePlan("Plan.", nodes);
    proposeOnce(wrong);
    propose(wrong);
    await expect(resume()).rejects.toMatchObject({ stage: "COMPACT_PLAN", reason: "HOST_EVIDENCE" });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.prompt).scopeAnalysis).toContain("computed_total");
  });

  const productBrief = "Multiply the number of items checked by the active time in hours per checked item. Leave both measurements blank.";
  const productEvidence = (request: AppleCompletionRequest, override: Readonly<Record<string, unknown>> = {}) => {
    const { spans } = JSON.parse(request.prompt) as { spans: { id: string; text: string }[] };
    return {
      kind: "quantity_rate", roleOrder: "first_is_quantity",
      quantitySpanId: spans.find(({ text }) => /number of items checked|число проверенных/i.test(text))?.id,
      rateSpanId: spans.find(({ text }) => /active time in|среднее время/i.test(text))?.id,
      rateBasis: "same_as_output", ...override
    };
  };

  function directProductAnchors(request: AppleCompletionRequest, archive = false) {
    const prompt = JSON.parse(request.prompt) as { spans: { id: string; text: string }[] };
    const quantity = prompt.spans.find(span => archive ? span.text.includes("the number of recordings reviewed") : span.text.includes("number of items checked"));
    const rate = prompt.spans.find(span => archive ? span.text.includes("the average active review time in hours per recording") : span.text.includes("active time in hours per checked item"));
    expect(quantity && rate).toBeTruthy();
    return { quantitySpanId: quantity?.id, rateSpanId: rate?.id, rateBasis: "same_as_output" };
  }

  it.each(["archival brief", "held-out inspections"])("checks the actual three-input plan before any write for %s", async example => {
    const archive = example === "archival brief";
    const { turn, calls, proposeOnce, propose, builder, setStage } = compactPlanFixture(true);
    const prompt = archive ? archiveBrief : productBrief;
    const third = { nodeId: archive ? "active_review_sessions" : "individual_check_sessions" };
    const inputs = [{ nodeId: "qty" }, { nodeId: "duration" }];
    proposeOnce((request: AppleCompletionRequest) => {
      const evidence = JSON.parse(request.prompt);
      expect(evidence.sources).toEqual([prompt]);
      expect(evidence).not.toHaveProperty("planned");
      expect(request.prompt).not.toContain(third.nodeId);
      return { planFit: "complete_quantity_rate_pair", ...directProductAnchors(request, archive) };
    });
    proposeOnce(sizePlan("Plan.", [third, ...inputs]));
    proposeOnce(sizePlan("Correct the scope.", inputs));
    propose((request: AppleCompletionRequest) => {
      expect(JSON.parse(request.prompt).planned).toEqual(inputs);
      return { kind: "quantity_rate", roleOrder: "first_is_quantity", ...directProductAnchors(request, archive) };
    });

    const first = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "grounded-product-plan",
      context: { brief: { prompt } } } });
    expect(calls).toHaveLength(4);
    expect(JSON.parse(calls[1]!.prompt).revisionInstruction).toContain("Plan exactly two editable blank inputs");
    expect(JSON.parse(calls[1]!.prompt).revisionInstruction).toContain("one short factual phrase per rationale");
    expect(JSON.parse(calls[2]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["vdt.set_decomposition_plan"]);
    const action = modelAgentStructuredTurnSchema.parse(first.output).action;
    if (action.type !== "action_batch") throw new Error("Expected a plan action.");
    const firstCall = action.batch.calls[0]!;
    expect(firstCall).toMatchObject({ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes: inputs } } });
    const { rootNodeId } = builder.getProject();
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: firstCall.args.plan as VdtDecompositionPlan } });
    setStage();
    const drivers = [{ nodeId: "qty", name: "Quantity", unit: "count" }, { nodeId: "duration", name: "Time per item", unit: "h/item" }];
    propose(guided("Add blank inputs.", { tool: "vdt.add_drivers_batch", drivers: {
      quantity: { operand: "quantity_input", name: drivers[0]!.name }, rate: { operand: "rate_input", name: drivers[1]!.name }
    } }));
    const added = await turn.completeTurn({ ...initial, exchangeId: "after-plan", previousCursor: first.cursor,
      delta: { type: "tool_results", batchId: "plan", results: [{ toolName: "vdt.set_decomposition_plan", status: "succeeded" }] } });
    expect(calls).toHaveLength(5);
    expect(added.output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.add_drivers_batch", args: { drivers } }] } } });
    for (const driver of drivers) builder.addDriver({ ...driver, parentNodeId: rootNodeId, relation: "formula_dependency" });
    setStage();
    proposeOnce(guided("Wrong operator.", { tool: "vdt.set_formula", formula: "min(qty, duration)" }));
    propose(guided("Product.", { tool: "vdt.set_formula", formula: "qty * duration" }));
    const formula = await turn.completeTurn({ ...initial, exchangeId: "after-add", previousCursor: added.cursor,
      delta: { type: "tool_results", batchId: "add", results: [{ toolName: "vdt.add_drivers_batch", status: "succeeded" }] } });
    expect(calls).toHaveLength(7);
    expect(formula.output).toMatchObject({ action: { batch: { calls: [
      { toolName: "vdt.set_formula", args: { formula: "qty * duration" } }
    ] } } });
  });

  it.each(["unchanged", "oversized", "failed grounding"])("rejects a %s re-proposed pair before the original plan can write", async mode => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
    const original = sizePlan("Plan.", [{ nodeId: "qty" }, { nodeId: "duration" }, { nodeId: "sessions" }]);
    proposeOnce((request: AppleCompletionRequest) => ({ planFit: "complete_quantity_rate_pair", ...directProductAnchors(request) }));
    proposeOnce(original);
    proposeOnce(mode === "unchanged" ? original : mode === "oversized" ? sizePlan("x".repeat(501)) : sizePlan("Two leaves"));
    propose({ kind: "other" });
    await expect(turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "rejected-product-plan",
      context: { brief: { prompt: productBrief } } } })).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN" });
    expect(calls).toHaveLength(mode === "failed grounding" ? 4 : 3);
  });

  it("does not emit an excessive plan or re-propose again after a size correction", async () => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
    proposeOnce((request: AppleCompletionRequest) => ({
      planFit: "complete_quantity_rate_pair", ...directProductAnchors(request)
    }));
    proposeOnce(sizePlan("g".repeat(501)));
    propose(sizePlan("Three direct inputs.", [{ nodeId: "qty" }, { nodeId: "duration" }, { nodeId: "sessions" }]));
    await expect(turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "no-stacked-plan-retry",
      context: { brief: { prompt: productBrief } } } })).rejects.toMatchObject({
      stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE"
    });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.prompt).revisionInstruction).toContain("canonical size limit");
  });

  it.each(["pinnedSkillId", "pendingMethod", "confirmationRequired"])("does not invoke gap-plan review with active %s", async field => {
    const { turn, calls, propose, setStage } = compactPlanFixture(true);
    setStage({ outcome: "no_applicable_skill", [field]: field === "confirmationRequired" ? true : "reviewed-skill" });
    propose(sizePlan("Three direct inputs.", [{ nodeId: "qty" }, { nodeId: "duration" }, { nodeId: "setup" }]));
    const result = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "excluded-gap-plan-review",
      context: { brief: { prompt: productBrief } } } });
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_decomposition_plan" }] } } });
    expect(calls).toHaveLength(1);
  });

  it.each(["steering", "paired answer"])("fails closed on an excessive plan after unavailable newer %s", async unavailable => {
    const { turn, calls, propose, proposeOnce } = compactPlanFixture(true);
    const opening: ModelAgentTurnRequest = { ...initial, delta: { type: "initial_context", contextHash: "prior-product-evidence",
      context: { brief: { prompt: productBrief } } } };
    proposeOnce({ planFit: "material_scope_unresolved" });
    propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: {
      question: "Which checks should count?", reason: "It changes the underlying population."
    } }));
    const first = await turn.completeTurn(opening);
    const action = modelAgentStructuredTurnSchema.parse(first.output).action;
    if (action.type !== "action_batch") throw new Error("Expected a question call.");
    const questionId = (action.batch.calls[0]?.args.questions as { id: string }[])[0]!.id;
    const unavailableText = "x".repeat(2_001);
    propose(sizePlan("Three direct inputs.", [{ nodeId: "qty" }, { nodeId: "duration" }, { nodeId: "setup" }]));
    await expect(turn.completeTurn({ ...opening, previousCursor: first.cursor, exchangeId: "unavailable-newer-product-scope",
      delta: { type: "human_input", input: unavailable === "steering" ? { type: "user_instruction", text: unavailableText }
        : { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { [questionId]: unavailableText } } }
    })).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE" });
    expect(calls).toHaveLength(2);
  });

  it("does not authorize a plan rewrite from missing or fabricated pair evidence", async () => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
    propose((request: AppleCompletionRequest) => ({ planFit: "complete_quantity_rate_pair", ...directProductAnchors(request),
      quantitySpanId: "forged-pair-evidence" }));
    await expect(turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "forged-product-plan",
      context: { brief: { prompt: productBrief } } } }))
      .rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(1);
  });

  it.each(["other_or_more", "uncertain", "material_scope_unresolved"])("enforces the higher-arity assessment %s", async planFit => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
    const prompt = "Estimate total checking hours from the number of items checked and the active time in hours per checked item, plus the independent setup time in hours. Leave all measurements blank.";
    const nodes = [{ nodeId: "qty" }, { nodeId: "duration" }, { nodeId: "setup" }];
    proposeOnce({ planFit });
    propose(planFit === "other_or_more" ? sizePlan("Three distinct measures.", nodes)
      : guided("Clarify.", { tool: "user.ask", focusedQuestion: {
        question: "Does setup time count within the same reporting period?", reason: "It changes the scope of the direct measure."
      } }));
    const result = turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "larger-product-plan",
      context: { brief: { prompt } } } });
    if (planFit === "material_scope_unresolved") {
      await expect(result).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: "user.ask" }] } } } });
      expect(JSON.parse(calls[1]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
    } else if (planFit === "uncertain") {
      await expect(result).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE" });
      expect(calls).toHaveLength(1);
    } else {
      await expect(result).resolves.toMatchObject({ output: { action: { batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }] } } } });
      expect(calls).toHaveLength(2);
    }
  });

  it.each(["accept compact repair", "reject repeated size", "accept first plan", "reject swapped anchors"])(
    "uses source-first archive roles and one bounded plan proposal repair for %s", async mode => {
      const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
      const inputs = [{ nodeId: "recording_count", rationale: "Count reviewed recordings" },
        { nodeId: "avg_review_duration", rationale: "Active hours per recording" }];
      const grounded = (request: AppleCompletionRequest) => directProductAnchors(request, true);
      proposeOnce((request: AppleCompletionRequest) => ({ planFit: "complete_quantity_rate_pair", ...grounded(request) }));
      const compact = sizePlan("Monthly reviewer-hours", inputs);
      const tooLong = mode === "accept compact repair" || mode === "reject repeated size";
      proposeOnce(tooLong ? sizePlan("g".repeat(337), [{ ...inputs[0]!, rationale: "r".repeat(785) }, inputs[1]!]) : compact);
      if (tooLong) proposeOnce(mode === "reject repeated size" ? sizePlan("g".repeat(785), inputs) : compact);
      propose((request: AppleCompletionRequest) => {
        const anchors = grounded(request);
        expect(JSON.parse(request.prompt).expectedRoles).toEqual({ quantitySpanId: anchors.quantitySpanId, rateSpanId: anchors.rateSpanId });
        return { kind: "quantity_rate", roleOrder: "first_is_quantity", ...anchors, ...(mode === "reject swapped anchors"
          ? { quantitySpanId: anchors.rateSpanId, rateSpanId: anchors.quantitySpanId } : {}) };
      });
      const result = turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "first-compact-archive-plan",
        context: { brief: { prompt: archiveBrief } } } });
      if (mode === "reject repeated size") await expect(result).rejects.toMatchObject({ stage: "COMPACT_PLAN_SIZE_RETRY", reason: "PLAN_GOAL_TOO_LONG" });
      else if (mode === "reject swapped anchors") await expect(result).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE" });
      else await expect(result).resolves.toMatchObject({ output: { action: { batch: { calls: [
        { toolName: "vdt.set_decomposition_plan", args: { plan: { nodes: inputs } } }
      ] } } } });
      expect(calls[0]?.schema.fields[0]?.name).toBe("planFit");
      const firstPlan = JSON.parse(calls[1]!.prompt);
      expect(firstPlan.revisionInstruction).toContain("one short factual phrase per rationale");
      expect(firstPlan.revisionInstruction).toContain("500 characters for goal");
      expect(firstPlan.revisionInstruction).toContain("300 characters per rationale");
      if (tooLong) expect(JSON.parse(calls[2]!.prompt).revisionInstruction).toContain("canonical size limit");
      expect(calls).toHaveLength(mode === "accept compact repair" ? 4 : 3);
    }
  );

  it("keeps a single-sentence additive plan available with source-only scope", async () => {
    const { turn, calls, proposeOnce, propose } = compactPlanFixture(true);
    const prompt = "Total review hours equals transcription hours plus preparation hours plus reconciliation hours.";
    const nodes = [{ nodeId: "transcription" }, { nodeId: "preparation" }, { nodeId: "reconciliation" }];
    proposeOnce((request: AppleCompletionRequest) => {
      expect(JSON.parse(request.prompt).sources).toEqual([prompt]);
      return { planFit: "other_or_more" };
    });
    propose(sizePlan("Sum three components.", nodes));
    const result = await turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "plain-compound",
      context: { brief: { prompt } } } });
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }] } } });
    expect(calls).toHaveLength(2);
  });

  it("does not propose a plan from product anchors superseded by a newer negated role", async () => {
    const { turn, calls, propose, proposeOnce } = compactPlanFixture(true);
    const opening: ModelAgentTurnRequest = { ...initial, delta: { type: "initial_context", contextHash: "superseded-role-source",
      context: { brief: { prompt: productBrief } } } };
    proposeOnce({ planFit: "material_scope_unresolved" });
    propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: {
      question: "Which activities have to count?", reason: "It defines the reporting boundary."
    } }));
    const first = await turn.completeTurn(opening);
    const correction = "Do not use per-item time for this result. Use the recorded batch total as an independent measure.";
    propose((request: AppleCompletionRequest) => {
      expect(JSON.parse(request.prompt).sources[0]).toBe(correction);
      return { planFit: "complete_quantity_rate_pair", ...directProductAnchors(request) };
    });
    await expect(turn.completeTurn({ ...opening, previousCursor: first.cursor, exchangeId: "scope-replaced", delta: {
      type: "human_input", input: { type: "user_instruction", text: correction }
    } })).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE" });
    expect(calls).toHaveLength(3);
  });

  it.each(["negated hours", "suffix exclusion", "repeated exclusion", "affirmative contrast", "minutes outside recipe", "minutes mislabeled same basis", "affirmative hours"])(
    "requires a current affirmative compatible rate before specializing a mixed-source archive plan for %s", async mode => {
      const { turn, calls, propose, proposeOnce } = compactPlanFixture(true);
      const opening: ModelAgentTurnRequest = { ...initial, delta: { type: "initial_context", contextHash: "archive-mixed-rate",
        context: { brief: { prompt: archiveBrief } } } };
      proposeOnce({ planFit: "material_scope_unresolved" });
      propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: {
        question: "Which measure defines the work per item?", reason: "It changes the plan."
      } }));
      const first = await turn.completeTurn(opening);
      const currentRate = "Use active time in hours per recording";
      const correction = mode === "negated hours" ? "Do not use active time in hours per recording."
        : mode === "suffix exclusion" ? `${currentRate}, which is not included in this measure.`
          : mode === "repeated exclusion" ? `${currentRate}, as discussed earlier. ${currentRate}, which is not included in this measure.`
            : mode === "affirmative contrast" ? `Exclude scanning, but ${currentRate}, which the measure includes.`
              : mode === "affirmative hours" ? `${currentRate}.` : "Use active time in minutes per recording.";
      const affirmative = mode === "affirmative hours" || mode === "affirmative contrast";
      const evidence = (request: AppleCompletionRequest) => {
        const { spans, sources, closedRoles } = JSON.parse(request.prompt) as {
          sources: string[]; spans: { id: string; sourceIndex: number; text: string }[]; closedRoles?: unknown
        };
        expect(sources[0]).toBe(correction);
        expect(closedRoles).toBeUndefined();
        const quantity = spans.find(span => span.sourceIndex === 1 && span.text.includes("the number of recordings reviewed"));
        const roleText = ["suffix exclusion", "affirmative contrast", "repeated exclusion"].includes(mode)
          ? mode === "affirmative contrast" ? `but ${currentRate}` : currentRate : correction;
        const rate = spans.find(span => span.sourceIndex === 0 && span.text === roleText);
        expect(quantity && rate).toBeTruthy();
        return { quantitySpanId: quantity!.id, rateSpanId: rate!.id,
          rateBasis: mode === "minutes outside recipe" ? "different_or_unclear" : "same_as_output" };
      };
      proposeOnce((request: AppleCompletionRequest) => ({ planFit: "complete_quantity_rate_pair", ...evidence(request) }));
      const nodes = [{ nodeId: "qty" }, { nodeId: "duration" }];
      proposeOnce(sizePlan("Plan two inputs.", nodes));
      propose((request: AppleCompletionRequest) => ({ kind: "quantity_rate", roleOrder: "first_is_quantity", ...evidence(request) }));
      const result = turn.completeTurn({ ...opening, previousCursor: first.cursor, exchangeId: "archive-mixed-rate-new-scope",
        delta: { type: "human_input", input: { type: "user_instruction", text: correction } } });
      if (affirmative) {
        await expect(result).resolves.toMatchObject({ output: { action: { batch: { calls: [
          { toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }
        ] } } } });
      } else {
        await expect(result).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN",
          reason: mode === "minutes mislabeled same basis" ? "CANONICAL_VALIDATION" : "HOST_EVIDENCE" });
      }
      expect(calls).toHaveLength(affirmative ? 5 : 3);
    }
  );

  it.each([
    { mode: "observed archive", brief: archiveBrief, protected: true },
    { mode: "other measured entity", brief: "The only tracked inputs are the count of labels printed and the mean hours per label. Leave both blank.", protected: true },
    { mode: "third measure in another sentence", brief: `${archiveBrief} Add fixed setup hours as a separate input to the result.`, protected: false },
    { mode: "alternate formula in another sentence", brief: `${archiveBrief} Total hours equals active hours plus fixed setup hours.`, protected: false },
    { mode: "excluded third in another sentence", brief: `${archiveBrief} Do not add fixed setup hours as a separate input to the result.`, protected: true },
    { mode: "different denominator", brief: "The measurements we track are the number of items checked and the average time in hours per batch.", protected: false },
    { mode: "explicit third", brief: "The measurements we track are the number of items checked and the average time in hours per item and the setup hours.", protected: false },
    { mode: "hedged two", brief: "The measurements we track are the number of items checked and maybe the average time in hours per item.", protected: false },
    { mode: "negated rate", brief: "The measurements we track are the number of items checked and not the average time in hours per item.", protected: false }
  ])("blocks the ungrounded extra operand only when the exact inventory is closed for $mode", async ({ brief, protected: closed }) => {
    const { turn, calls, propose, proposeOnce } = compactPlanFixture(true);
    const nodes = [{ nodeId: "recording_count" }, { nodeId: "avg_review_duration" }, { nodeId: "month_context" }];
    proposeOnce((request: AppleCompletionRequest) => {
      const prompt = JSON.parse(request.prompt);
      const planFit = request.schema.fields.find(field => field.name === "planFit");
      expect(planFit?.shape.kind).toBe("choice");
      if (planFit?.shape.kind !== "choice") throw new Error("Expected closed plan fit.");
      expect(planFit.shape.choices.includes("other_or_more")).toBe(!closed);
      if (closed) {
        expect(prompt.closedRoles).toMatchObject({ quantitySpanId: expect.any(String), rateSpanId: expect.any(String) });
        for (const name of ["quantitySpanId", "rateSpanId"]) {
          const field = request.schema.fields.find(field => field.name === name);
          expect(field?.shape).toEqual({ kind: "choice", choices: [prompt.closedRoles[name]] });
        }
      } else expect(prompt.closedRoles).toBeUndefined();
      return { planFit: "other_or_more" };
    });
    propose(sizePlan("Overfilled candidate.", nodes));
    const result = turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "closed-source-inventory",
      context: { brief: { prompt: brief } } } });
    if (closed) await expect(result).rejects.toMatchObject({ stage: "COMPACT_DIRECT_PRODUCT_PLAN", reason: "HOST_EVIDENCE" });
    else await expect(result).resolves.toMatchObject({ output: { action: { batch: { calls: [
      { toolName: "vdt.set_decomposition_plan", args: { plan: { nodes } } }
    ] } } } });
    expect(calls).toHaveLength(closed ? 1 : 2);
  });

  function productFixture(phase: "add" | "formula" | "finish", badUnits = false, durable?: "same" | "stale_ids") {
    const f = fixture();
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Total inspection hours", rootKpi: "Total inspection hours", unit: "h" });
    const root = builder.getProject().rootNodeId;
    builder.updateNode({ nodeId: root, patch: { decompositionPlan: {
      version: 1, goal: "Two direct measures", nodes: [
        { nodeId: "qty", parentNodeId: root, kind: "input", rationale: "Quantity checked" },
        { nodeId: "duration", parentNodeId: root, kind: "input", rationale: "Duration for one item" }
      ]
    } } });
    if (phase !== "add") for (const [nodeId, unit] of [["qty", badUnits ? "h" : "count"], ["duration", badUnits ? "h" : "h/item"]] as const) {
      builder.addDriver({ nodeId, name: nodeId, unit, parentNodeId: root, relation: "formula_dependency" });
    }
    if (phase === "finish") builder.setFormula({ nodeId: root, formula: badUnits ? "min(qty, min(duration))" : "duration * qty" });
    const relationship = { kind: "quantity_rate", operandNodeIds: [durable === "stale_ids" ? "retired_qty" : "qty", "duration"],
      operandUnits: ["count", "h/item"], unit: "h" };
    if (durable) builder.updateNode({ nodeId: root, patch: { assumptions: [[
      "Decomposition assumption: Count times hours per item",
      "Reconsider if: The counted population changes",
      `Confirmed user source: ${JSON.stringify(["current-input", productBrief])}`,
      `Decomposition relationship v2: ${JSON.stringify(relationship)}`
    ].join("\n")] } });
    const structural = structuralGuideFor(builder.getProject())!;
    expect(structural.phase).toBe(phase);
    const registry = createDefaultToolRegistry();
    const setStage = (skillResolution: Record<string, unknown> = { outcome: "no_applicable_skill" }) =>
      f.readStage.mockReturnValue({ structuralGuide: structural, observation: { outcome: "structural_model", skillResolution },
        tools: structural.names.map(name => ({
          name, summary: name, arguments: {}, validateArguments: (args: unknown) =>
            (registry.list().find(tool => tool.name === name)?.inputSchema.parse(args) ?? args) as Record<string, unknown>
        })) });
    setStage();
    const request: ModelAgentTurnRequest = { ...initial, delta: { type: "initial_context", contextHash: "product",
      context: { brief: { prompt: productBrief } } } };
    return { ...f, request, root, setStage, structural, relationship };
  }

  it("rejects the prior free-form wrong-unit add without another attempt", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("add");
    proposeOnce(productEvidence);
    propose(guided("Add blank leaves.", { tool: "vdt.add_drivers_batch", drivers: [
      { nodeId: "qty", name: "Number checked", unit: "h" }, { nodeId: "duration", name: "Time per item", unit: "h" }
    ] }));
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ stage: "GUIDED_ACTION", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]!.prompt).sources).toEqual([productBrief]);
  });

  it.each(["forged", "same"])("blocks %s closed evidence IDs before any Gateway action", async mode => {
    const { request, turn, calls, propose } = productFixture("add");
    propose((request: AppleCompletionRequest) => {
      const valid = productEvidence(request);
      return { ...valid, rateSpanId: mode === "same" ? valid.quantitySpanId : "p_forged" };
    });
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ stage: "PRODUCT_RECIPE", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(1);
  });

  it.each([undefined, "forged", 0])("rejects malformed closed role order %s without a Gateway action", async roleOrder => {
    const { request, turn, calls, propose } = productFixture("add");
    propose((request: AppleCompletionRequest) => productEvidence(request, { roleOrder }));
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ stage: "PRODUCT_RECIPE", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(1);
  });

  it("assigns the other exact planned ID to the rate from one reversed role-order choice", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("add");
    proposeOnce((request: AppleCompletionRequest) => productEvidence(request, { roleOrder: "second_is_quantity" }));
    propose(guided("Add blank leaves.", { tool: "vdt.add_drivers_batch", drivers: {
      quantity: { operand: "quantity_input", name: "Number checked" }, rate: { operand: "rate_input", name: "Time per item" }
    } }));
    const action = modelAgentStructuredTurnSchema.parse((await turn.completeTurn(request)).output).action;
    expect(action).toMatchObject({ type: "action_batch", batch: { calls: [{ toolName: "vdt.add_drivers_batch", args: { drivers: [
      { nodeId: "duration", unit: "count" }, { nodeId: "qty", unit: "h/item" }
    ] } }] } });
    const fields = calls[0]!.schema.fields;
    expect(fields.find(field => field.name === "roleOrder")?.shape).toEqual({
      kind: "choice", choices: ["first_is_quantity", "second_is_quantity"]
    });
    expect(fields.some(field => field.name === "quantityId" || field.name === "rateId")).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("cannot certify a minutes-per-item excerpt as equivalent to an hours root", async () => {
    const { request, turn, calls, propose } = productFixture("add");
    propose(productEvidence);
    const wrongBasis = productBrief.replace("hours per checked item", "minutes per checked item");
    await expect(turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "minutes",
      context: { brief: { prompt: wrongBasis } } } })).rejects.toMatchObject({ stage: "PRODUCT_RECIPE", reason: "CANONICAL_VALIDATION" });
    expect(calls).toHaveLength(1);
  });

  it.each(["reviewer's", "reviewer’s"])("recognizes hours after %s without reading its possessive as seconds", async possessive => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    const prompt = productBrief.replace("the active time", `the ${possessive} active time`);
    proposeOnce(productEvidence);
    propose(guided("Formula.", { tool: "vdt.set_formula", formula: "duration * qty" }));
    const result = await turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "possessive",
      context: { brief: { prompt } } } });
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_formula" }] } } });
    expect(calls).toHaveLength(2);
  });

  it("offers separate exact bilingual clauses from a coordinated sentence", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    const source = "Рассчитайте число проверенных изделий и среднее время в часах на изделие.";
    proposeOnce(productEvidence);
    propose(guided("Formula.", { tool: "vdt.set_formula", formula: "duration * qty" }));
    await turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "bilingual", context: { brief: { prompt: source } } } });
    const spans = JSON.parse(calls[0]!.prompt).spans as { id: string; text: string }[];
    expect(spans.every(({ text }) => source.includes(text))).toBe(true);
    expect(spans.map(({ text }) => text)).toEqual(expect.arrayContaining([
      "Рассчитайте число проверенных изделий", "среднее время в часах на изделие."
    ]));
  });

  it("offers both exact role clauses from the complete archived brief", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    proposeOnce((request: AppleCompletionRequest) => {
      const { spans } = JSON.parse(request.prompt) as { spans: { id: string; text: string }[] };
      const quantity = spans.find(({ text }) => text.includes("the number of recordings reviewed"));
      const rate = spans.find(({ text }) => text.includes("the average active review time in hours per recording"));
      expect(quantity?.text).toBe("The measurements we track are the number of recordings reviewed");
      expect(rate?.text).toBe("the average active review time in hours per recording for the same month.");
      expect(request.schema.fields.find(field => field.name === "rateSpanId")?.shape).toMatchObject({
        kind: "choice", choices: expect.arrayContaining([quantity?.id, rate?.id])
      });
      return productEvidence(request, { quantitySpanId: quantity?.id, rateSpanId: rate?.id });
    });
    propose(guided("Formula.", { tool: "vdt.set_formula", formula: "duration * qty" }));
    await turn.completeTurn({ ...request, delta: { type: "initial_context", contextHash: "archival-spans", context: {
      brief: { prompt: archiveBrief }
    } } });
    expect(calls).toHaveLength(2);
  });

  it.each(["accepted", "crossed", "duplicate", "forged input", "extra unit", "extra value", "ordinary compound"])(
    "binds only the two grounded operand-unit pairs while keeping model-authored names for %s", async mode => {
      const { request, turn, calls, proposeOnce, propose, root } = productFixture("add");
      proposeOnce(mode === "ordinary compound" ? { kind: "other" } : productEvidence);
      const ordinary = [{ nodeId: "qty", name: "Clocked work", unit: "h" }, { nodeId: "duration", name: "Setup work", unit: "h" }];
      const quantity = { operand: mode === "crossed" || mode === "duplicate" ? "rate_input" : mode === "forged input" ? "other" : "quantity_input",
        name: "Completed checks", ...(mode === "extra unit" ? { unit: "h" } : {}) };
      const rate = { operand: mode === "crossed" ? "quantity_input" : "rate_input", name: "Time per check",
        ...(mode === "extra value" ? { value: 2 } : {}) };
      propose(guided("Add input layer.", { tool: "vdt.add_drivers_batch",
        drivers: mode === "ordinary compound" ? ordinary : { quantity, rate } }));
      const result = turn.completeTurn(request);
      if (mode === "accepted" || mode === "ordinary compound") {
        const drivers = mode === "ordinary compound" ? ordinary : [
          { nodeId: "qty", name: "Completed checks", unit: "count" },
          { nodeId: "duration", name: "Time per check", unit: "h/item" }
        ];
        const actual = modelAgentStructuredTurnSchema.parse((await result).output).action;
        expect(actual).toMatchObject({ type: "action_batch", batch: { calls: [{ toolName: "vdt.add_drivers_batch", args: { drivers: drivers.map(driver => ({
          ...driver, type: "input", parentNodeId: root, relation: "formula_dependency"
        })) } }] } });
        if (actual.type !== "action_batch") throw new Error("Expected driver additions.");
        for (const driver of actual.batch.calls[0]!.args.drivers as Array<Record<string, unknown>>) expect(driver).not.toHaveProperty("value");
      } else {
        await expect(result).rejects.toMatchObject({ reason: "CANONICAL_VALIDATION" });
      }
      expect(calls).toHaveLength(2);
      const payload = calls[1]!.schema.fields[1];
      if (mode !== "ordinary compound") {
        expect(JSON.stringify(payload)).toContain("Planned input qty with unit count.");
        expect(JSON.stringify(payload)).toContain("Planned input duration with unit h/item.");
        expect(JSON.stringify(payload)).not.toContain('"name":"unit"');
      }
    }
  );

  it("keeps an incompatible basis unresolved instead of authorizing conversion", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("add");
    proposeOnce((request: AppleCompletionRequest) => productEvidence(request, { rateBasis: "different_or_unclear" }));
    propose(guided("Clarify basis.", { tool: "user.ask", focusedQuestion: {
      question: "Which unit should the average time use?", reason: "The units need to match the output basis."
    } }));
    await turn.completeTurn(request);
    expect(JSON.parse(calls[1]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
  });

  it("keeps a distinct unresolved product scope in the existing ask tool", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("add");
    proposeOnce({ kind: "unresolved" });
    propose(guided("Clarify distinct population.", { tool: "user.ask", focusedQuestion: {
      question: "Do the time and count cover the same set of items?", reason: "The averaging base must match."
    } }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
    expect(JSON.parse(calls[1]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
  });

  it("rejects the false finished min of two hour-labeled operands before an eligible finish", async () => {
    const { request, turn, calls, propose } = productFixture("finish", true);
    propose(productEvidence);
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ stage: "PRODUCT_RECIPE", reason: "HOST_EVIDENCE" });
    expect(calls).toHaveLength(1);
  });

  it.each(["min(qty, min(duration))", "min(qty, 13) * duration"])("rejects %s and permits an equivalent reversed product", async wrongFormula => {
    const { request, turn, calls, proposeOnce, propose, root } = productFixture("formula");
    proposeOnce(productEvidence);
    proposeOnce(guided("Formula.", { tool: "vdt.set_formula", formula: wrongFormula }));
    propose(guided("Formula.", { tool: "vdt.set_formula", formula: "(duration) * qty" }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: { calls: [
      { toolName: "vdt.set_formula", args: { nodeId: root, formula: "(duration) * qty" } }
    ] } } });
    expect(calls).toHaveLength(3);
  });

  it.each([
    ["add", "vdt.add_drivers_batch"],
    ["formula", "vdt.set_formula"]
  ] as const)("offers only the already-authorized %s tool after accepting a product recipe", async (phase, toolName) => {
    const { request, turn, calls, proposeOnce, propose } = productFixture(phase);
    proposeOnce(productEvidence);
    propose(guided("Ask anyway.", { tool: "user.ask", focusedQuestion: {
      question: "What is the count?", reason: "The count is a deferred measurement."
    } }));
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ reason: "GUIDED_ENVELOPE" });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual([toolName]);
  });

  it("leaves the question available for an assessed non-product relationship", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    proposeOnce({ kind: "other" });
    propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: {
      question: "Are the two inputs measured separately?", reason: "The relationship remains uncertain."
    } }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
    expect(JSON.parse(calls[1]!.prompt).tools.map(({ name }: { name: string }) => name)).toContain("user.ask");
  });

  it("allows ordinary verified-finish handoff for a grounded product already on the draft", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("finish");
    proposeOnce(productEvidence);
    propose(guided("Finish.", { tool: "run.request_finish" }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: { calls: [{ toolName: "run.request_finish", args: {} }] } } });
    expect(calls).toHaveLength(2);
  });

  it("does not reuse an anchored product after unavailable newer steering", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    proposeOnce(productEvidence);
    propose(guided("Product.", { tool: "vdt.set_formula", formula: "qty * duration" }));
    const { cursor } = await turn.completeTurn(request);
    propose(guided("Get current scope.", { tool: "user.ask", focusedQuestion: {
      question: "What should the updated input roles be?", reason: "The submitted steering needs clarification."
    } }));
    const next = await turn.completeTurn({ ...request, previousCursor: cursor, exchangeId: "steered-product",
      delta: { type: "human_input", input: { type: "user_instruction", text: "x".repeat(2_001) } } });
    expect(next.output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
  });

  it("presents newer steering ahead of the brief while a social go-ahead can retain earlier facts", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    const product = guided("Product.", { tool: "vdt.set_formula", formula: "qty * duration" });
    proposeOnce(productEvidence);
    propose(product);
    const { cursor } = await turn.completeTurn(request);
    proposeOnce(productEvidence);
    await turn.completeTurn({ ...request, exchangeId: "approved-product", previousCursor: cursor,
      delta: { type: "human_input", input: { type: "user_instruction", text: "Go ahead." } } });
    const reviewer = JSON.parse(calls[2]!.prompt);
    expect(reviewer.sources).toEqual(["Go ahead.", productBrief]);
    expect(reviewer.instruction).toContain("Newer instructions replace older facts");
    expect(reviewer.instruction).toContain("Acknowledgments alone do not replace prior facts");
  });

  it("orders a newly paired answer ahead of older steering in the same delivery", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    proposeOnce({ kind: "unresolved" });
    propose(guided("Clarify.", { tool: "user.ask", focusedQuestion: { question: "Which population?", reason: "Match both inputs." } }));
    const first = await turn.completeTurn(request);
    const action = modelAgentStructuredTurnSchema.parse(first.output).action;
    if (action.type !== "action_batch") throw new Error("Expected a question call.");
    const questionId = (action.batch.calls[0]?.args.questions as { id: string }[])[0]!.id;
    const answer = "Use the same completed checks for both inputs.";
    proposeOnce(productEvidence);
    propose(guided("Proceed.", { tool: "vdt.set_formula", formula: "duration * qty" }));
    await turn.completeTurn({ ...request, exchangeId: "current-answer", previousCursor: first.cursor, delta: {
      type: "human_inputs", inputs: [
        { type: "user_instruction", text: "Use only the current month." },
        { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { [questionId]: answer } }
      ]
    } });
    expect(JSON.parse(calls[2]!.prompt).sources).toEqual([answer, "Use only the current month.", productBrief]);
  });

  it("does not review stale product evidence after an unrenderable exact pending answer", async () => {
    const { request, turn, calls, proposeOnce, propose } = productFixture("formula");
    const ask = guided("Clarify.", { tool: "user.ask", focusedQuestion: { question: "Which population?", reason: "Match both inputs." } });
    proposeOnce({ kind: "unresolved" });
    propose(ask);
    const first = await turn.completeTurn(request);
    const action = modelAgentStructuredTurnSchema.parse(first.output).action;
    if (action.type !== "action_batch") throw new Error("Expected a question call.");
    const questionId = (action.batch.calls[0]?.args.questions as { id: string }[])[0]!.id;
    await turn.completeTurn({ ...request, exchangeId: "invalid-current-answer", previousCursor: first.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { [questionId]: "x".repeat(2_001) } }
    } });
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[2]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["user.ask"]);
  });

  it("verifies saved v2 quantity-rate through the shared relationship checker without inferring it again", async () => {
    const { request, turn, calls, propose, proposeOnce, structural, relationship } = productFixture("formula", false, "same");
    expect(structural.savedQuantityRate).toEqual(relationship);
    expect(structural.formulaProbe?.operands.map(operand => operand.unit)).toEqual(["count", "h/item"]);
    proposeOnce(guided("Incorrect.", { tool: "vdt.set_formula", formula: "min(qty, duration)" }));
    propose(guided("Product.", { tool: "vdt.set_formula", formula: "(duration) * qty" }));
    const result = await turn.completeTurn(request);
    expect(result.output).toMatchObject({ action: { batch: { calls: [
      { toolName: "vdt.set_formula", args: { formula: "(duration) * qty" } }
    ] } } });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.schema.fields[0]?.name === "sessionState")).toBe(true);
    expect(JSON.parse(calls[1]!.prompt).scopeAnalysis).toContain("contradicts the quantity_rate relationship");
  });

  it.each(["units", "ids"])("fails explicitly when the saved v2 product %s are stale", async stale => {
    const { request, turn, calls, propose, structural, relationship } = productFixture("formula", stale === "units", stale === "ids" ? "stale_ids" : "same");
    expect(structural.savedQuantityRate).toEqual(relationship);
    expect(structural.formulaProbe).toBeDefined();
    propose(guided("Product.", { tool: "vdt.set_formula", formula: "duration * qty" }));
    await expect(turn.completeTurn(request)).rejects.toMatchObject({ stage: "COMPACT_FORMULA", reason: "HOST_EVIDENCE" });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.schema.fields[0]?.name === "sessionState")).toBe(true);
    expect(JSON.parse(calls[1]!.prompt).scopeAnalysis).toContain("confirmed unit basis");
  });

  it("leaves explicit pin and existing selected-method compact paths alone", async () => {
    const { request, turn, calls, propose, setStage } = productFixture("formula", true);
    setStage({ outcome: "selected", selectedSkillId: "explicit-pin" });
    propose(guided("Serial relation.", { tool: "vdt.set_formula", formula: "min(qty, duration)" }));
    expect((await turn.completeTurn(request)).output).toMatchObject({ action: { batch: { calls: [
      { toolName: "vdt.set_formula", args: { formula: "min(qty, duration)" } }
    ] } } });
    expect(calls).toHaveLength(1);
  });

  it.each([
    { next: "matching receipt", answer: "The same material passes through both stations in series. No separate output counts." },
    { next: "redirected search", answer: "Both stations make independent outputs. Both count at the reporting boundary." },
    { next: "new scope question", answer: "Both stations use the same material. I have not chosen the reporting boundary." },
    { next: "fresh catalog gap", answer: "This request measures an allocation across a shared inventory pool." }
  ])("keeps an answered discovery on reviewed receipts or one fresh search for $next", async ({ next, answer }) => {
    const { turn, propose, proposeOnce, readStage, calls, reviewFitWith, reviewWith } = fixture();
    const makeMethod = (skillId: string, excerpt: string) => ({ skillId, readReceiptId: `receipt-${skillId}`,
      version: 2, contentHash: `hash-${skillId}`, excerpt });
    const serial = makeMethod("series-method", "For a shared material stream in series, apply the lower station capacity.");
    const parallel = makeMethod("parallel-method", "For independent non-overlapping outputs, sum both on the same basis.");
    const unrelated = makeMethod("unrelated-method", "Estimate track mileage from the locomotive's booked shifts.");
    const registry = createDefaultToolRegistry();
    const stage = (allowed: string[], methods: typeof serial[] = [], unread: string[] = []) => readStage.mockReturnValue({
      skillDiscovery: true,
      observation: { outcome: "structural_model", skillResolution: { candidateIds: unread, reads: methods },
        readSkillMethods: methods },
      tools: registry.list().filter(tool => allowed.includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {},
        validateArguments: args => tool.inputSchema.parse(args) as Record<string, unknown>
      })),
      ...(allowed.includes("skill.read") ? { skillReadableIds: unread } : {}),
      ...(allowed.includes("skill.select") ? { skillSelectReceipts: new Map(methods.map(method => [method.skillId, method.readReceiptId])) } : {})
    });
    const successfulSearch = (externalCallId: string, ...methods: typeof serial[]): ModelAgentTurnRequest["delta"] => ({
      type: "tool_results", batchId: "search", results: [{ toolName: "skill.search", externalCallId, resultCode: "OK", status: "succeeded",
        payload: { output: { candidates: methods.map(({ skillId, version, contentHash }) => ({ id: skillId, version, contentHash })) } } }]
    });
    const successfulRead = (method: typeof serial): ModelAgentTurnRequest["delta"] => ({
      type: "tool_results", batchId: "read", results: [{ toolName: "skill.read", status: "succeeded",
        payload: { output: { ...method, id: method.skillId } } }]
    });
    const search = (businessContext: string) => guided("Look for the matching method.", {
      tool: "skill.search", skillSearch: { rootKpi: "Station output", businessContext }
    });
    const select = (skillId: string) => guided("Use the matching method.", {
      tool: "skill.select", skillSelection: { skillId, reason: "The method fits the confirmed process." }
    });
    const ask = (question: string) => guided("Clarify the process.", {
      tool: "user.ask", focusedQuestion: { question, reason: "It changes which outputs belong in the KPI." }
    });
    const read = (skillId: string) => guided("Read a method.", { tool: "skill.read", skillRead: { skillId } });
    stage(["skill.search"]);
    propose(search("Two processing stations with an unspecified relationship"));
    const started = await turn.completeTurn(initial);
    const advance = (index: number, previous: { cursor?: string | null }, delta: ModelAgentTurnRequest["delta"]) => turn.completeTurn({
      ...initial, exchangeId: `exchange-${index}`, previousCursor: previous.cursor ?? null, delta
    });
    stage(["skill.read"], [], [serial.skillId]);
    propose(read(serial.skillId));
    const initialRead = await advance(2, started, successfulSearch("exchange-1:call", serial));
    const question = "Does the same flow pass through both stations, or do they produce independent outputs?";
    stage(["user.ask", "skill.select"], [serial]);
    propose(ask(question));
    const asked = await advance(3, initialRead, successfulRead(serial));

    const resumeIndex = calls.length;
    // This is the signed ordering: the old scoped search is invalidated, the
    // exact read survives, and the Supervisor now exposes broad unread cards.
    stage(["skill.search", "skill.read", "skill.select", "user.ask"], [unrelated, serial], [parallel.skillId, "broad-card"]);
    if (next === "matching receipt") {
      proposeOnce(read("broad-card"));
      propose(select(serial.skillId));
      reviewFitWith(request => proposedFit(request, "The answer supports the existing series method."));
    } else if (next === "new scope question") {
      propose(ask("Is the reporting boundary measured before or after the second station?"));
      reviewWith(() => ({ readiness: "distinct_material_gap", conclusion: "The measurement point is still open." }));
    } else propose(search(answer));
    const resumed = await advance(4, asked, { type: "human_input", input: {
      type: "user_answer", questionSetId: "questions-exchange-3:call", answers: { structuredAnswers: [
        { questionId: "skill_scope", fields: { answer } }
      ] }
    } });
    const prompt = JSON.parse(calls[resumeIndex]!.prompt);
    expect(prompt.tools.map(({ name }: { name: string }) => name).sort()).toEqual(["skill.search", "skill.select", "user.ask"]);
    expect(prompt.observation.readSkillMethods).toEqual([serial]);
    expect(calls[resumeIndex]!.prompt).not.toContain("broad-card");
    expect(calls[resumeIndex]!.prompt).not.toContain(unrelated.skillId);
    expect(prompt.submittedUserAnswers).toEqual([{ question, answer: [answer] }]);

    if (next === "matching receipt") {
      expect(JSON.parse(calls[resumeIndex + 1]!.prompt).revisionInstruction).toContain("one permitted tool");
      expect(resumed.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.select",
        args: { skillId: serial.skillId, readReceiptId: serial.readReceiptId } }] } } });
      return;
    }
    if (next === "new scope question") {
      expect(resumed.output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask",
        args: { questions: [{ question: "Is the reporting boundary measured before or after the second station?" }] } }] } } });
      return;
    }
    expect(resumed.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.search", args: { businessContext: answer } }] } } });
    if (next === "fresh catalog gap") {
      stage(["skill.report_gap", "skill.select"], [serial]);
      propose(guided("The confirmed current search produced no match.", {
        tool: "skill.report_gap", skillGap: { reason: "The reviewed methods do not cover shared inventory allocation." }
      }));
      await expect(advance(5, resumed, successfulSearch("exchange-4:call"))).rejects.toMatchObject({ stage: "CATALOG_GAP_FIT", reason: "HOST_EVIDENCE" });
      return;
    }

    stage(["skill.read", "skill.select"], [serial], [parallel.skillId]);
    propose(read(parallel.skillId));
    const newRead = await advance(5, resumed, successfulSearch("exchange-4:call", parallel));
    expect(newRead.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.read", args: { skillId: parallel.skillId } }] } } });
    stage(["skill.select"], [parallel, serial]);
    propose(select(parallel.skillId));
    reviewFitWith(request => proposedFit(request, "The exact scope now requires independent outputs."));
    expect((await advance(6, newRead, successfulRead(parallel))).output).toMatchObject({
      action: { batch: { calls: [{ toolName: "skill.select", args: { skillId: parallel.skillId, readReceiptId: parallel.readReceiptId } }] } }
    });
  });

  it.each([
    { kind: "browser field", question: "Do the stages share a material stream?", answer: "The same material follows both stages in one stream.", browserField: true },
    { kind: "legacy Russian", question: "Этапы обрабатывают один поток материала?", answer: "Один поток материала проходит оба этапа.", browserField: false }
  ])("carries a $kind scope answer through search, selection and construction", async ({ question, answer, browserField }) => {
    const { turn, propose, readStage, calls, reviewFitWith } = fixture();
    const names = ["skill.search", "skill.select", "user.ask"];
    const registry = createDefaultToolRegistry();
    const readSkillMethods = [{ skillId: "example", readReceiptId: "receipt-exact", version: 1,
      contentHash: "sha256:" + "a".repeat(64), excerpt: "This method applies to stages on a common flow." }];
    reviewFitWith(request => proposedFit(request, "The method covers the shared flow."));
    const tools = (allowed: readonly string[]) => registry.list().filter(tool => allowed.includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    const setStage = (allowed: readonly string[]) => readStage.mockReturnValue({
      observation: { outcome: "structural_model", readSkillMethods,
        confirmedUserAnswers: [{ question: "An earlier unpaired question", answer: ["A stale projected value"] }] }, skillDiscovery: true,
      ...(allowed.includes("skill.select") ? { skillSelectReceipts: new Map([["example", "receipt-exact"]]) } : {}),
      tools: tools(allowed)
    });
    setStage(["user.ask"]);
    propose(guided("The process flow is unconfirmed.", { tool: "user.ask", focusedQuestion: { question, reason: "The method depends on the flow." } }));
    const asked = await turn.completeTurn(initial);
    setStage(names);
    propose(guided("The process flow is unconfirmed.", { tool: "skill.search", skillSearch: { rootKpi: "Throughput", businessContext: answer } }));
    const unrelated = await turn.completeTurn({ ...initial, exchangeId: "exchange-unrelated", previousCursor: asked.cursor,
      delta: { type: "human_input", input: { type: "user_answer", questionSetId: "different-question-set", answers: { skill_scope: "Do not apply." } } }
    });
    expect(JSON.parse(calls[1]!.prompt)).not.toHaveProperty("submittedUserAnswers");
    const searched = await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: unrelated.cursor,
      delta: { type: "checkpoint_inputs", checkpointDelta: { type: "human_input", input: {
        type: "user_answer", questionSetId: "questions-exchange-1:call", answers: browserField
          ? { structuredAnswers: [{ questionId: "skill_scope", fields: { answer } }] } : { skill_scope: answer }
      } }, inputs: [{ type: "user_instruction", text: "Keep the requested unit." }] } });
    propose(guided("Use the verified scope.", { tool: "skill.select",
      skillSelection: { skillId: "example", reason: "It covers the confirmed shared material stream." } }));
    const selected = await turn.completeTurn({ ...initial, exchangeId: "exchange-3", previousCursor: searched.cursor,
      delta: { type: "tool_results", batchId: "ranked", results: [{ toolName: "skill.search", externalCallId: "exchange-2:call",
        resultCode: "OK", status: "succeeded", payload: { output: { candidates: readSkillMethods.map(({ skillId, version, contentHash }) =>
          ({ id: skillId, version, contentHash })) } } }] } });
    expect(selected.output).toMatchObject({ action: { batch: { calls: [
      { toolName: "skill.select", args: { skillId: "example", readReceiptId: "receipt-exact" } }
    ] } } });
    readStage.mockReturnValue({ observation: {}, tools: tools(["user.ask"]), structuralGuide: {
      phase: "plan", names: ["user.ask"], rootNodeId: "root", missingNodeIds: [], instruction: "Plan the confirmed factors.",
      payloads: new Map([["user.ask", { name: "focusedQuestion", shape: { kind: "object", fields: [
        { name: "question", shape: { kind: "string" } }, { name: "reason", shape: { kind: "string" } }
      ] } }]])
    } });
    propose(guided("Ask a distinct follow-up.", { tool: "user.ask", focusedQuestion: {
      question: "Which material bypass feeds the additional branch?", reason: "The new branch may use a separate stream."
    } }));
    const constructionDelta = { type: "tool_results", batchId: "selected", results: [{ toolName: "skill.select", status: "succeeded" }] } as const;
    const compact = await turn.completeTurn({ ...initial, exchangeId: "exchange-4", previousCursor: selected.cursor, delta: constructionDelta });
    readStage.mockReturnValue({ observation: {}, tools: tools(["project.get_current"]) });
    propose({ sessionState: "Continue with confirmed facts.", tool: "project.get_current", argumentsJson: "{}" });
    await turn.completeTurn({ ...initial, exchangeId: "exchange-5", previousCursor: compact.cursor, delta: constructionDelta });
    for (const invocation of calls.slice(2)) {
      const prompt = JSON.parse(invocation.prompt);
      expect(prompt.submittedUserAnswers).toEqual([{ question, answer: [answer] }]);
      expect(prompt).not.toHaveProperty("sessionState");
    }
    const afterSearch = JSON.parse(calls[3]!.prompt);
    expect(afterSearch.observation.readSkillMethods).toEqual(readSkillMethods);
    expect(afterSearch.instruction).toContain("Select when they settle the method.");
    expect(afterSearch.instruction).toContain("thresholds");
  });

  it("preserves normal generic singleton driver proposals", async () => {
    const { turn, propose, readStage } = fixture();
    const tool = createDefaultToolRegistry().list().find(tool => tool.name === "vdt.add_driver")!;
    readStage.mockReturnValue({ observation: {}, tools: [{
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: args => tool.inputSchema.parse(args) as Record<string, unknown>
    }] });
    const args = { parentNodeId: "root", nodeId: "driver", name: "Stage capacity", type: "input" };
    propose({ sessionState: "Add the verified driver.", tool: tool.name, argumentsJson: JSON.stringify(args) });
    expect((await turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{ toolName: tool.name, args }] } } });
  });

  it.each([
    { kind: "ambiguous", readiness: "material_scope_missing", scope: {}, expected: "user.ask", nativeCalls: 3 },
    { kind: "clear", readiness: "method_ready", scope: {}, expected: "skill.select", nativeCalls: 2 },
    { kind: "explicitly pinned", readiness: "material_scope_missing", scope: { pinnedSkillId: "example" }, expected: "skill.select", nativeCalls: 1 },
    { kind: "awaiting exact method confirmation", readiness: "material_scope_missing", scope: { pendingMethod: { skillId: "example" } },
      expected: "skill.select", nativeCalls: 1 }
  ])("checks an initial $kind structural method selection only when appropriate", async ({ readiness, scope, expected, nativeCalls }) => {
    const { turn, calls, readStage, propose, reviewWith } = fixture();
    const method = { skillId: "example", readReceiptId: "read-exact", excerpt: "Independent and shared material flows use different driver logic." };
    const other = { skillId: "other", readReceiptId: "read-other", excerpt: "A different reviewed scope." };
    const former = { skillId: "former", readReceiptId: "read-former", excerpt: "Another reviewed scope." };
    const tools = createDefaultToolRegistry().list().filter(tool => ["skill.select", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({
      skillDiscovery: true, skillSelectReceipts: new Map([[method.skillId, method.readReceiptId]]), tools,
      observation: { outcome: "structural_model", skillResolution: scope, readSkillMethods: [other, former, method] }
    });
    const explanation = "The reviewed method covers the process if the two stages share one flow.";
    const confirmation = { confirmMethod: true };
    propose(guided("Select a reviewed method.", { tool: "skill.select",
      skillSelection: { skillId: method.skillId, reason: explanation, ...confirmation } }));
    const scopeAnalysis = "The relationship between the two stages is unsettled.";
    reviewWith(() => {
      if (readiness === "material_scope_missing") propose(guided("Clarify the flow.", { tool: "user.ask", focusedQuestion: {
        question: "Does the same material pass through both stages?", reason: "The relationship determines the method."
      } }));
      return { conclusion: readiness === "method_ready" ? "The user defined one shared flow." : scopeAnalysis, readiness };
    });
    const response = await turn.completeTurn(initial);
    expect(response.output).toMatchObject({ action: { batch: { calls: [{ toolName: expected, ...(expected === "skill.select"
      ? { args: { skillId: method.skillId, readReceiptId: method.readReceiptId, reason: explanation, ...confirmation } } : {})
    }] } } });
    expect(calls).toHaveLength(nativeCalls);
    expect(JSON.parse(calls[0]!.prompt).observation.readSkillMethods).toEqual([other, former]);
    if (nativeCalls === 1) return;
    expect(JSON.parse(calls[1]!.prompt)).toMatchObject({ submittedUserAnswers: [],
      readMethods: [{ skillId: method.skillId, excerpt: method.excerpt }] });
    expect(JSON.parse(calls[1]!.prompt).initialScopePolicy).toContain("Names, order and industry examples alone do not establish those relationships");
    expect(calls[1]!.prompt).not.toContain(explanation);
    if (expected === "user.ask") {
      const revised = JSON.parse(calls[2]!.prompt);
      expect(revised.tools.map((tool: { name: string }) => tool.name)).toEqual(["user.ask"]);
      expect(revised).toMatchObject({ scopeAnalysis });
      expect(revised.revisionInstruction).toContain("never as a user fact");
    }
  });

  it.each(["missing exact excerpt", "overlong steering"])("fails closed before initial selection with %s", async issue => {
    const { turn, calls, readStage, propose, reviewWith } = fixture();
    const opened = await turn.completeTurn(initial);
    const method = { skillId: "example", readReceiptId: issue === "missing exact excerpt" ? "different-receipt" : "exact-receipt",
      excerpt: "A reviewed method requires a confirmed process relationship." };
    const tools = createDefaultToolRegistry().list().filter(tool => ["skill.select", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({
      skillDiscovery: true, skillSelectReceipts: new Map([["example", "exact-receipt"]]), tools,
      observation: { outcome: "structural_model", readSkillMethods: [method] }
    });
    propose(guided("Select a reviewed method.", { tool: "skill.select",
      skillSelection: { skillId: "example", reason: "It may cover the given process." } }));
    const reviewer = vi.fn(() => ({ conclusion: "No evidence available.", readiness: "method_ready" }));
    reviewWith(reviewer);
    await expect(turn.completeTurn({ ...initial, exchangeId: "exchange-blocked", previousCursor: opened.cursor, delta: {
      type: "human_input", input: { type: "user_instruction", text: issue === "overlong steering" ? "x".repeat(2_001) : "Keep the existing scope." }
    } })).rejects.toMatchObject({ code: "invalid_output" });
    expect(reviewer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it.each([
    { caseName: "shared flow with excluded bypass", answer: "They share a single material flow. There is no bypass or parallel stream.",
      conclusion: "One shared flow, with bypass explicitly excluded.", readiness: "continue_with_current_evidence", expectedTool: "skill.select" },
    { caseName: "independent streams", answer: "The final output counts both independent streams, which have no shared limit.",
      conclusion: "Both independent final streams count without a shared limit.", readiness: "continue_with_current_evidence", expectedTool: "skill.select" },
    { caseName: "material gap", answer: "I do not know whether the stages handle the same flow.",
      conclusion: "The output counting boundary affects the result and remains unresolved.", readiness: "distinct_material_gap", expectedTool: "user.ask" },
    { caseName: "overlong steering", answer: "They share a single material flow.", conclusion: "",
      readiness: "skip", expectedTool: "user.ask" },
    { caseName: "malformed assessment", answer: "They share a single material flow.", conclusion: "",
      readiness: "continue_with_current_evidence", expectedTool: undefined }
  ])("assesses $caseName only after an exact submitted answer", async ({ caseName, answer, conclusion, readiness, expectedTool }) => {
    const { turn, calls, readStage, propose, reviewWith, reviewFitWith } = fixture();
    const method = { skillId: "example", readReceiptId: "read-receipt", version: 1,
      contentHash: "sha256:" + "a".repeat(64), excerpt: "Use the shared-flow method for sequential stages." };
    reviewFitWith(request => proposedFit(request, "The reviewed method covers the stated scope."));
    const tools = createDefaultToolRegistry().list().filter(tool => ["skill.select", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({
      skillDiscovery: true, skillSelectReceipts: new Map([["example", "read-receipt"]]), tools,
      observation: { outcome: "structural_model", readSkillMethods: [method] }
    });
    const question = "Do both stages share the same material flow?";
    const followUp = readiness === "distinct_material_gap"
      ? { question: "Is output counted at the discharge or at the packaging line?", reason: "The answer changes the output counting boundary." }
      : caseName === "shared flow with excluded bypass"
        ? { question: "How would adding a bypass change the flow?", reason: "The current model has no bypass." }
        : { question: "What is the capacity threshold?", reason: "The result could be compared with a target." };
    const reviewer = vi.fn(() => {
      if (readiness === "continue_with_current_evidence") {
        propose(guided("Proceed using the confirmed flow.", { tool: "skill.select", skillSelection: {
          skillId: "example", reason: "The method applies to the confirmed output boundary."
        } }));
      }
      return { conclusion, readiness };
    });
    reviewWith(reviewer);
    propose(guided("Ask and wait.", { tool: "user.ask", focusedQuestion: { question, reason: "This establishes the process scope." } }));
    const asked = await turn.completeTurn(initial);
    expect(reviewer).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    propose(guided("Consider a follow-up.", { tool: "user.ask", focusedQuestion: followUp }));
    const latestUserInstruction = readiness === "skip" ? "x".repeat(2_001) : "Keep the units unchanged.";
    const resumed = turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: asked.cursor,
      delta: { type: "checkpoint_inputs", checkpointDelta: {
        type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
      }, inputs: [{ type: "user_instruction", text: latestUserInstruction }] }
    });
    if (expectedTool) {
      expect((await resumed).output).toMatchObject({ action: { batch: { calls: [{ toolName: expectedTool,
        ...(expectedTool === "skill.select" ? { args: { skillId: "example", readReceiptId: "read-receipt" } } : {})
      }] } } });
    } else {
      await expect(resumed).rejects.toMatchObject({ code: "invalid_output",
        message: "The native Apple model returned invalid output. [APPLE_ANSWERED_SCOPE_CANONICAL_VALIDATION]" });
    }
    if (readiness === "skip") {
      expect(reviewer).not.toHaveBeenCalled();
      expect(calls).toHaveLength(2);
      return;
    }
    expect(reviewer).toHaveBeenCalledOnce();
    const reviewRequest = calls[2]!;
    expect(reviewRequest.schema.fields.map(field => [field.name, field.shape])).toEqual([
      ["conclusion", { kind: "string" }], ["readiness", { kind: "choice", choices: ["continue_with_current_evidence", "distinct_material_gap"] }]
    ]);
    expect(reviewRequest).toMatchObject({ maxOutputTokens: 180, timeoutMs: 18_000 });
    const evidence = JSON.parse(reviewRequest.prompt);
    expect(evidence).toMatchObject({
      submittedUserAnswers: [{ question, answer: [answer] }], latestUserInstruction,
      readMethods: [{ skillId: method.skillId, excerpt: method.excerpt }], proposedQuestion: followUp
    });
    expect(evidence.instruction).toContain("distinct unresolved fact");
    expect(JSON.parse(calls[1]!.prompt).latestUserInstruction).toBe(latestUserInstruction);
    expect(calls).toHaveLength(expectedTool === "skill.select" ? 5 : 3);
    if (expectedTool === "skill.select") {
      const revised = JSON.parse(calls[3]!.prompt);
      expect(revised.latestUserInstruction).toBe(latestUserInstruction);
      expect(revised.tools.map((tool: { name: string }) => tool.name)).toEqual(["skill.select"]);
      expect(calls[3]!.prompt).not.toContain(conclusion);
      const { excerpt, ...identity } = method;
      expect(JSON.parse(calls[4]!.prompt)).toMatchObject({
        proposedMethod: { ...identity, spans: [{ id: expect.any(String), text: excerpt }] }
      });
    }
  });

  it("reviews a repeated scope question before Skill search without selecting an unread method", async () => {
    const { turn, calls, readStage, propose, reviewWith } = fixture();
    const tools = createDefaultToolRegistry().list().filter(tool => ["skill.search", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({ skillDiscovery: true, tools, observation: { outcome: "structural_model" } });
    const question = "Welche Kostenstelle soll das Modell verwenden?";
    const reason = "Die Antwort bestimmt die Eingaben.";
    const answer = "Verwenden Sie die Kostenstelle für den technischen Service. Werte ergänze ich später.";
    propose(guided("Scope the model.", { tool: "user.ask", focusedQuestion: { question, reason } }));
    const first = await turn.completeTurn(initial);
    const proposedQuestion = { question: "Welche Kostenstelle ist gemeint?", reason };
    propose(guided("Try another question.", { tool: "user.ask", focusedQuestion: proposedQuestion }));
    reviewWith(() => {
      propose(guided("Find the applicable method.", { tool: "skill.search", skillSearch: { rootKpi: "Servicekosten" } }));
      return { readiness: "continue_with_current_evidence", conclusion: "Die Kostenstelle für den technischen Service ist festgelegt." };
    });
    const result = await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: first.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
    } });
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.search", args: { rootKpi: "Servicekosten" } }] } } });
    expect(calls).toHaveLength(4);
    expect(JSON.parse(calls[2]!.prompt)).toMatchObject({ proposedQuestion, submittedUserAnswers: [{ question, answer: [answer] }], readMethods: [] });
    expect(JSON.parse(calls[3]!.prompt).tools.map(({ name }: { name: string }) => name)).toEqual(["skill.search"]);
  });

  it.each([
    { scenario: "native output", invalid: "native", retry: true },
    { scenario: "mixed guided envelope", invalid: "mixed", retry: true },
    { scenario: "invalid again", invalid: "mixed", retry: true, terminal: "APPLE_GUIDED_ACTION_RETRY_GUIDED_ENVELOPE" },
    { scenario: "stale candidate content", invalid: "canonical", terminal: "APPLE_GUIDED_ACTION_CANONICAL_VALIDATION" },
    { scenario: "pinned method", invalid: "native", terminal: "APPLE_GUIDED_ACTION_NATIVE_OUTPUT" },
    { scenario: "no search match", invalid: "native", terminal: "APPLE_GUIDED_ACTION_NATIVE_OUTPUT" },
    { scenario: "new steering", invalid: "native", terminal: "APPLE_GUIDED_ACTION_NATIVE_OUTPUT" },
    { scenario: "unclassified output", invalid: "unclassified", terminal: "APPLE_GUIDED_ACTION_UNCLASSIFIED" },
    { scenario: "guided timeout", invalid: "timeout", terminal: "The Apple model request timed out." },
    { scenario: "method-fit timeout", invalid: "fit-timeout", terminal: "The Apple model request timed out." }
  ])("retries only a generated rejection after an answered exact search ($scenario)", async ({ scenario, invalid, retry, terminal }) => {
    const { turn, calls, readStage, propose, proposeOnce, reviewFitWith } = fixture();
    const registry = createDefaultToolRegistry();
    const parsedSelection = vi.fn();
    const tools = (names: string[]) => registry.list().filter(tool => names.includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {}, validateArguments: (args: unknown) => {
        const parsed = tool.inputSchema.parse(args) as Record<string, unknown>;
        if (tool.name === "skill.select") parsedSelection(parsed);
        return parsed;
      }
    }));
    const question = "Is the charge per visit or by time spent?";
    const answer = "Charge for billable hours only. Leave the rate blank.";
    const method = { skillId: "hourly_service", readReceiptId: "read-hourly-service", version: 1,
      contentHash: "sha256:" + "a".repeat(64), excerpt: "Multiply billable service hours by the hourly rate." };
    readStage.mockReturnValue({ observation: { outcome: "structural_model" }, skillDiscovery: true, tools: tools(["user.ask"]) });
    propose(guided("Ask the billing basis.", { tool: "user.ask", focusedQuestion: { question, reason: "The basis determines the formula." } }));
    const opened = await turn.completeTurn(initial);
    readStage.mockReturnValue({ observation: { outcome: "structural_model" }, skillDiscovery: true, tools: tools(["skill.search"]) });
    propose(guided("Find the hourly method.", { tool: "skill.search", skillSearch: { rootKpi: "Service cost" } }));
    const searched = await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: opened.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
    } });
    const gapTools = ["skill.report_gap", "user.ask"];
    readStage.mockReturnValue({ skillDiscovery: true, tools: tools([...gapTools, "skill.select"]),
      skillSelectReceipts: new Map([[method.skillId, method.readReceiptId]]), observation: {
        outcome: "structural_model", readSkillMethods: [method], skillResolution: scenario === "pinned method" ? { pinnedSkillId: method.skillId } : {}
      }
    });
    const candidate = { id: method.skillId, version: method.version,
      contentHash: scenario === "stale candidate content" ? "sha256:" + "b".repeat(64) : method.contentHash };
    const checkpoint = { type: "tool_results", batchId: "scoped-search", results: [{ toolName: "skill.search", externalCallId: "exchange-2:call", resultCode: "OK", status: "succeeded",
      payload: { output: { candidates: scenario === "no search match" ? [] : [candidate] } }
    }] } as const;
    const detail = "private fixture content";
    const invalidResponses: Record<string, unknown> = {
      native: new AppleTransportError("invalid_output", "native_output"), unclassified: new AppleTransportError("invalid_output"),
      timeout: new AppleTransportError("timeout", undefined, "PARENT_DEADLINE"), mixed: guided(detail, { tool: "skill.select", skillSelection: {}, unexpected: detail }),
      canonical: guided(detail, { tool: "skill.select", skillSelection: { skillId: method.skillId, reason: 2 } })
    };
    const fitTimeout = invalid === "fit-timeout";
    const timedOut = invalid === "timeout" || fitTimeout;
    if (!fitTimeout) proposeOnce(invalidResponses[invalid]);
    const args = { skillId: method.skillId, reason: "It covers hourly billing." };
    propose(terminal && !fitTimeout ? null : guided("Select the exact method.", { tool: "skill.select", skillSelection: args }));
    const fit = vi.fn((request: AppleCompletionRequest) => fitTimeout
      ? new AppleTransportError("timeout", undefined, "HELPER_REPLY")
      : proposedFit(request, "Hourly billing is confirmed."));
    reviewFitWith(fit);
    const warning = timedOut ? vi.spyOn(console, "warn").mockImplementation(() => {}) : undefined;
    const completed = turn.completeTurn({ ...initial, exchangeId: "exchange-3", previousCursor: searched.cursor,
      delta: scenario === "new steering" ? { type: "checkpoint_inputs", checkpointDelta: checkpoint,
        inputs: [{ type: "user_instruction", text: "Keep the terms already confirmed." }] } : checkpoint
    });
    if (terminal) {
      try {
        await expect(completed).rejects.toMatchObject({
          code: timedOut ? "timeout" : "invalid_output",
          message: timedOut ? terminal : expect.stringContaining(terminal)
        });
        if (warning) {
          expect(warning).toHaveBeenCalledExactlyOnceWith("[vdt-apple] Native task timed out.", {
            stage: fitTimeout ? "ANSWERED_METHOD_FIT" : "GUIDED_ACTION",
            origin: fitTimeout ? "HELPER_REPLY" : "PARENT_DEADLINE",
            afterScopeAnswer: true
          });
        }
      } finally {
        warning?.mockRestore();
      }
      const error = await completed.catch(reason => reason);
      expect(error).toBeInstanceOf(AppleTransportError);
      expect(error.message).not.toContain(detail);
      expect(error.message).not.toContain(answer);
      expect(fit).toHaveBeenCalledTimes(fitTimeout ? 1 : 0);
      expect(parsedSelection).toHaveBeenCalledTimes(fitTimeout ? 1 : 0);
    } else {
      const grounded = { ...args, readReceiptId: method.readReceiptId, reason: `This method fits the scope you specified: «${answer}»` };
      expect((await completed).output).toMatchObject({ action: { batch: { calls: [{ externalCallId: "exchange-3:call",
        toolName: "skill.select", args: grounded
      }] } } });
      expect(fit).toHaveBeenCalledOnce();
      expect(parsedSelection).toHaveBeenCalledTimes(2);
      expect(parsedSelection).toHaveBeenNthCalledWith(1, { ...args, readReceiptId: method.readReceiptId });
      expect(parsedSelection).toHaveBeenNthCalledWith(2, grounded);
    }
    expect(calls).toHaveLength(fitTimeout ? 4 : retry ? terminal ? 4 : 5 : 3);
    if (retry) {
      const original = JSON.parse(calls[2]!.prompt), revised = JSON.parse(calls[3]!.prompt);
      expect(revised).toMatchObject({ checkpoint, submittedUserAnswers: [{ question, answer: [answer] }], tools: original.tools });
      expect(revised.revisionInstruction).toContain("exact guided object");
      expect(calls[3]?.timeoutMs).toBe(18_000);
      expect(calls[3]!.prompt).not.toContain(detail);
    }
  });

  it.each(["repeat", "repeat after revision", "distinct gap", "noncompact"] as const)(
    "handles an answered-scope question at the formula frontier (%s)", async scenario => {
      const { turn, calls, readStage, propose, reviewWith } = fixture();
      const tools = createDefaultToolRegistry().list().filter(tool => ["vdt.set_formula", "user.ask"].includes(tool.name)).map(tool => ({
        name: tool.name, summary: tool.description, arguments: {},
        validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
      }));
      const ask = (question: string, reason: string) => guided("Ask about the billing boundary.", {
        tool: "user.ask", focusedQuestion: { question, reason }
      });
      const question = "Is on-site support billed by time or per visit?";
      const answer = "Bill only the time spent on site, at a single hourly rate. Leave both values blank for later entry.";
      const selectedMethod = { id: "hourly_service", readReceiptId: "read-receipt", excerpt: "Multiply covered time by the hourly rate." };
      readStage.mockReturnValue({ observation: { outcome: "structural_model" }, skillDiscovery: true,
        tools: tools.filter(tool => tool.name === "user.ask") });
      propose(ask(question, "The billing basis changes the calculation."));
      const first = await turn.completeTurn(initial);
      const structuralGuide: NonNullable<AppleNativeStage["structuralGuide"]> = {
        phase: "formula", rootNodeId: "total", names: ["vdt.set_formula", "user.ask"], missingNodeIds: [], instruction: "Return the root expression.",
        payloads: new Map([
          ["vdt.set_formula", { name: "formula", shape: { kind: "string" } }],
          ["user.ask", { name: "focusedQuestion", shape: { kind: "object", fields: [
            { name: "question", shape: { kind: "string" } }, { name: "reason", shape: { kind: "string" } }
          ] } }]
        ])
      };
      readStage.mockReturnValue({ observation: { outcome: "structural_model", selectedMethod }, tools,
        ...(scenario === "noncompact" ? {} : { structuralGuide }) });
      const proposedQuestion = scenario === "distinct gap"
        ? { question: "Is the requested total inclusive of tax?", reason: "Tax changes the total billed." }
        : { question: "Should only on-site time be billed at the one hourly rate?", reason: "Confirm whether the billing basis remains unresolved." };
      const repeated = ask(proposedQuestion.question, proposedQuestion.reason);
      const formula = "onsite_hours * hourly_rate";
      const formulaProposal = guided("Apply the confirmed hourly relationship.", { tool: "vdt.set_formula", formula });
      const reviewer = vi.fn(() => {
        if (scenario === "repeat") propose(formulaProposal);
        return { readiness: scenario === "distinct gap" ? "distinct_material_gap" : "continue_with_current_evidence",
          conclusion: scenario === "distinct gap" ? "Tax inclusion is separate and unset." : "The hourly billing basis is already confirmed." };
      });
      reviewWith(reviewer);
      propose(scenario === "noncompact" ? { sessionState: "Ask about default operations.", tool: "user.ask", argumentsJson: JSON.stringify({
        questions: [{ id: "generic_scope", ...proposedQuestion, required: true, expectedAnswerType: "text" }]
      }) } : repeated);
      const resumed = turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: first.cursor, delta: {
        type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
      } });
      if (scenario === "repeat after revision") {
        await expect(resumed).rejects.toMatchObject({ code: "invalid_output" });
      } else {
        const second = await resumed;
        const { action } = modelAgentStructuredTurnSchema.parse(second.output);
        expect(action.type).toBe("action_batch");
        if (action.type !== "action_batch") throw new Error("Expected an action batch.");
        const [call] = action.batch.calls;
        if (scenario === "repeat") {
          expect(call).toMatchObject({ toolName: "vdt.set_formula", args: { nodeId: "total", formula } });
        } else {
          expect(call).toMatchObject({ toolName: "user.ask", args: { questions: [expect.objectContaining(proposedQuestion)] } });
        }
        if (scenario === "distinct gap") {
          const id = (call?.args.questions as { id: string }[] | undefined)?.[0]?.id;
          expect(id).toMatch(/^structural_scope_/);
          const currentAnswer = "Exclude tax from the total.";
          propose(formulaProposal);
          const continued = await turn.completeTurn({ ...initial, exchangeId: "exchange-3", previousCursor: second.cursor, delta: {
            type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-2:call", answers: { structuredAnswers: [
              { questionId: "unrelated", fields: { answer: "Never use this field." } }, { questionId: id, fields: { answer: currentAnswer } }
            ] } }
          } });
          expect(continued.output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_formula", args: { nodeId: "total", formula } }] } } });
          expect(JSON.parse(calls[3]!.prompt).submittedUserAnswers).toEqual([
            { question: proposedQuestion.question, answer: [currentAnswer] }, { question, answer: [answer] }
          ]);
        }
      }
      if (scenario === "noncompact") {
        expect(reviewer).not.toHaveBeenCalled();
        expect(calls).toHaveLength(2);
      } else {
        expect(reviewer).toHaveBeenCalledOnce();
        expect(JSON.parse(calls[2]!.prompt)).toMatchObject({ proposedQuestion, submittedUserAnswers: [{ question, answer: [answer] }],
          readMethods: [{ skillId: selectedMethod.id, excerpt: selectedMethod.excerpt }] });
        expect(calls).toHaveLength(4);
        if (scenario !== "distinct gap") expect(JSON.parse(calls[3]!.prompt).tools).toMatchObject([{ name: "vdt.set_formula" }]);
      }
    }
  );

  it.each([
    { scenario: "serial equivalence repair", kind: "serial_capacity", revised: "first_rate + second_rate - max(first_rate, second_rate)" },
    { scenario: "serial contradiction persists", kind: "serial_capacity", revised: "first_rate + second_rate", failure: "COMPACT_FORMULA_HOST_EVIDENCE" },
    { scenario: "parallel sum", kind: "independent_additive" },
    { scenario: "unresolved bypass", kind: "unverified" },
    { scenario: "different numerical unit basis" },
    { scenario: "unverbatim scope", kind: "serial_capacity", failure: "COMPACT_RELATIONSHIP_CANONICAL_VALIDATION" },
    { scenario: "existing typed relationship", revised: "min(first_rate, second_rate)" }
  ])("checks the compact formula prospectively ($scenario)", async ({ scenario, kind, revised, failure }) => {
    const { turn, calls, readStage, propose, proposeOnce } = fixture();
    const tools = createDefaultToolRegistry().list().filter(tool => ["vdt.set_formula", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    const question = "Do the stations serve the same flow or separate outputs?";
    const answer = scenario === "parallel sum" ? "The stations serve independent, non-overlapping outputs. Both outputs count."
      : scenario === "unresolved bypass" ? "The stations usually serve the same flow. I do not know whether the bypass counts."
        : "The same flow passes through both stations in order, with no bypass, on the same reporting basis.";
    readStage.mockReturnValue({ observation: { outcome: "structural_model" }, skillDiscovery: true,
      tools: tools.filter(tool => tool.name === "user.ask") });
    propose(guided("Ask for the operative scope.", { tool: "user.ask", focusedQuestion: { question, reason: "The arrangement changes the output formula." } }));
    const started = await turn.completeTurn(initial);
    const builder = new VdtBuilderSession();
    builder.createDraft({ rootKpi: "Service output", projectTitle: "Stations", unit: "items/h" });
    const { rootNodeId } = builder.getProject();
    const ids: [string, string] = ["first_rate", "second_rate"];
    builder.updateNode({ nodeId: rootNodeId, patch: { decompositionPlan: { version: 1, goal: "Use both station rates",
      nodes: ids.map(nodeId => ({ nodeId, parentNodeId: rootNodeId, kind: "input" })) } } });
    builder.addDriver({ nodeId: ids[0], name: "First station", parentNodeId: rootNodeId, unit: "items/h", relation: "formula_dependency" });
    builder.addDriver({ nodeId: ids[1], name: "Second station", parentNodeId: rootNodeId,
      unit: scenario === "different numerical unit basis" ? "items/min" : "items/h", relation: "formula_dependency" });
    let project = builder.getProject();
    if (scenario === "existing typed relationship") {
      const saved = applyDecompositionAssumptionOperation(project, { nodeId: rootNodeId, statement: answer,
        changesConclusionWhen: "The stations change their routing.", evidence: { kind: "user_confirmed", sourceId: "accepted-choice", quote: answer },
        relationship: { kind: "serial_capacity", operandNodeIds: ids, unit: "items/h" }
      }, { operationId: "existing-choice", now: "2026-11-25T00:00:00.000Z" });
      if (saved.status !== "ok") throw new Error(saved.message);
      project = saved.project;
    }
    const before = structuredClone(project);
    const guide = structuralGuideFor(project)!;
    expect(guide.phase).toBe("formula");
    if (scenario === "different numerical unit basis") expect(guide.formulaProbe).toBeUndefined();
    else expect(guide.formulaProbe?.operands.map(node => node.id)).toEqual(ids);
    const sequentialMethod = "For one serial flow, take the lower station capacity without bypass.";
    const independentMethod = "For independent non-overlapping output, sum the two rates.";
    const selectedMethod = { id: "operation_method", readReceiptId: "exact-skill-read", excerpt: `${sequentialMethod}\n${independentMethod}` };
    readStage.mockReturnValue({ observation: { outcome: "structural_model", selectedMethod }, tools, structuralGuide: guide });
    const sum = "first_rate + second_rate";
    const formulate = (formula: string) => guided("Propose the expression.", { tool: "vdt.set_formula", formula });
    proposeOnce(formulate(sum));
    if (kind) proposeOnce(kind === "unverified" ? { relationship: kind } : {
      relationship: kind, scopeQuote: scenario === "unverbatim scope" ? "Invented user evidence." : answer,
      methodQuote: kind === "serial_capacity" ? sequentialMethod : independentMethod
    });
    if (revised) proposeOnce(formulate(revised));
    const result = turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: started.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
    } });
    if (failure) await expect(result).rejects.toMatchObject({ code: "invalid_output", message: expect.stringContaining(failure) });
    else expect((await result).output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_formula", args: {
      formula: revised ?? sum, nodeId: rootNodeId
    } }] } } });
    expect(calls).toHaveLength(2 + Number(Boolean(kind)) + Number(Boolean(revised)));
    if (kind) {
      const review = JSON.parse(calls[2]!.prompt);
      expect(review).toMatchObject({ submittedUserAnswers: [{ question, answer: [answer] }],
        selectedMethod: { skillId: selectedMethod.id, readReceiptId: selectedMethod.readReceiptId, excerpt: selectedMethod.excerpt },
        output: { id: rootNodeId, unit: "items/h" }, operands: ids.map(id => ({ id, unit: "items/h" })) });
      expect(calls[2]!.prompt).not.toContain(sum);
    }
    if (revised) {
      const repair = JSON.parse(calls.at(-1)!.prompt);
      expect(repair.tools.map(({ name }: { name: string }) => name)).toEqual(["vdt.set_formula"]);
      expect(repair.scopeAnalysis).toContain("required 0 items/h, but the formula gave 11");
    }
    expect(project).toEqual(before);
    expect(guide.formulaProbe?.root.formula).toBeUndefined();
  });

  it.each(["exact IDs", "repaired ID", "unverified", "unoffered replacement"] as const)(
    "checks measured formula relationships with %s", async scenario => {
      const { turn, calls, readStage, propose } = fixture();
      const builder = new VdtBuilderSession();
      builder.createDraft({ rootKpi: "Transfer capacity", projectTitle: "Transfer stations", unit: "items/h" });
      const root = builder.getProject().rootNodeId;
      const facts = [{ value: 4, quote: "Intake can transfer 4 items an hour" }, { value: 6, quote: "Exit can transfer 6 items an hour" }];
      const ids = ["intake_rate", "exit_rate"];
      builder.updateNode({ nodeId: root, patch: { decompositionPlan: { version: 1, goal: "Represent transfer capacity",
        nodes: ids.map(nodeId => ({ nodeId, parentNodeId: root, kind: "input" })) } } });
      for (const [index, nodeId] of ids.entries()) {
        const { value, quote } = facts[index]!;
        builder.addDriver({ nodeId, name: nodeId, parentNodeId: root, unit: "items/h", relation: "formula_dependency" });
        builder.updateNode({ nodeId, patch: { value, baselineValue: value, valueStatus: "user_provided_value",
          valueSource: { sourceTier: "user_input", note: quote } } });
      }
      const structuralGuide = structuralGuideFor(builder.getProject(), facts)!;
      expect(structuralGuide.phase).toBe("formula");
      const prompt = "One unchanged flow goes through intake and then exit. There is no bypass.";
      const excerpt = "For consecutive stations serving one flow, use the lower rate.";
      const selectedMethod = { id: "measure_flow", readReceiptId: "exact-measured-read", excerpt };
      readStage.mockReturnValue({ observation: { outcome: "structural_model", selectedMethod }, structuralGuide,
        tools: createDefaultToolRegistry().list().filter(tool => structuralGuide.names.includes(tool.name)).map(tool => ({
          name: tool.name, summary: tool.description, arguments: {},
          validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
        })) });
      const sum = "intake_rate + exit_rate";
      const minimum = "min(intake_rate, exit_rate)";
      propose((request: AppleCompletionRequest) => {
        const body = JSON.parse(request.prompt);
        const field = request.schema.fields[0]?.name;
        if (field === "relationship") {
          expect(body.originalBrief.prompt).toBe(prompt);
          expect(body.selectedMethod).toMatchObject({ readReceiptId: selectedMethod.readReceiptId, excerpt });
          expect(body.scopeSpans.find(({ text }: { text: string }) => text === prompt)).toBeDefined();
          expect(body.methodSpans[0].text).toBe(excerpt);
          expect(request.schema.fields.map(item => item.name)).toEqual(["relationship", "scopeSpanId", "methodSpanId"]);
          if (scenario === "unverified") return { relationship: "unverified" };
          return { relationship: "serial_capacity", methodSpanId: body.methodSpans[0].id,
            scopeSpanId: scenario === "exact IDs" ? body.scopeSpans[0].id : "not-offered" };
        }
        if (field === "repairDecision") {
          expect(body.formatFeedback.replaceFields).toEqual(["scopeSpanId"]);
          return { repairDecision: "repair", fragment: { scopeSpanId: scenario === "unoffered replacement" ? "foreign-span"
            : JSON.parse(body.originalTask).scopeSpans[0].id } };
        }
        return guided("Propose an expression.", { tool: "vdt.set_formula", formula: body.scopeAnalysis ? minimum : sum });
      });
      const result = turn.completeTurn({ ...initial, delta: { type: "initial_context", contextHash: "measured-relationship",
        context: { brief: { prompt, businessContext: facts.map(({ quote }) => quote).join(". ") } } } });
      if (scenario === "unoffered replacement") {
        await expect(result).rejects.toMatchObject({ code: "invalid_output", message: expect.stringContaining("COMPACT_RELATIONSHIP_CANONICAL_VALIDATION") });
        expect(calls.map(call => call.schema.fields[0]?.name)).toEqual(["sessionState", "relationship", "repairDecision"]);
      } else {
        expect((await result).output).toMatchObject({ action: { batch: { calls: [{ toolName: "vdt.set_formula", args: {
          nodeId: root, formula: scenario === "unverified" ? sum : minimum
        } }] } } });
        expect(calls.map(call => call.schema.fields[0]?.name)).toEqual(["sessionState", "relationship",
          ...(scenario === "repaired ID" ? ["repairDecision"] : []), ...(scenario === "unverified" ? [] : ["sessionState"])]);
      }
    });

  it.each([
    { scenario: "the proposed span in a maximum-size Unicode excerpt", fit: "proposed_method_matches", spanFrom: "proposedMethod", result: "skill.select" },
    { scenario: "matching alternative", fit: "other_reviewed_method_matches", spanFrom: "otherReviewedMethod", revised: "skill.select", result: "skill.select" },
    { scenario: "repeated incompatible method", fit: "other_reviewed_method_matches", spanFrom: "otherReviewedMethod", revised: "same", result: undefined },
    { scenario: "a stale span ID", fit: "proposed_method_matches", spanFrom: "proposedMethod", malformed: "stale", result: undefined },
    { scenario: "a span from another method", fit: "proposed_method_matches", spanFrom: "otherReviewedMethod", result: undefined },
    { scenario: "a ref attached to a non-match", fit: "no_reviewed_method_matches", spanFrom: "proposedMethod", result: undefined },
    { scenario: "a legacy quote field", fit: "proposed_method_matches", malformed: "legacy", result: undefined },
    { scenario: "a repaired missing span", fit: "proposed_method_matches", spanFrom: "proposedMethod", malformed: "missing", result: "skill.select" },
    { scenario: "a repaired non-string span", fit: "proposed_method_matches", spanFrom: "proposedMethod", malformed: "type", result: "skill.select" },
    { scenario: "a repaired malformed shape", fit: "proposed_method_matches", spanFrom: "proposedMethod", malformed: "shape", result: "skill.select" },
    { scenario: "an unrepaired missing span", fit: "proposed_method_matches", malformed: "missing_permanent", result: undefined },
    { scenario: "native fit failure without retry", fit: "proposed_method_matches", malformed: "native", result: undefined },
    { scenario: "fit timeout without retry", fit: "proposed_method_matches", malformed: "timeout", result: undefined },
    { scenario: "fit cancellation without retry", fit: "proposed_method_matches", malformed: "cancelled", result: undefined },
    { scenario: "no matching methods", fit: "no_reviewed_method_matches", revised: "skill.search", result: "skill.search" },
    { scenario: "a distinct material gap", fit: "material_scope_missing", revised: "user.ask", result: "user.ask" },
    { scenario: "an already authorized catalog gap", fit: "no_reviewed_method_matches", revised: "skill.report_gap", result: "skill.report_gap" },
    { scenario: "a stale user scope ref", fit: "proposed_method_matches", spanFrom: "proposedMethod", malformed: "stale_scope", result: undefined },
    { scenario: "a user pin", fit: "skip", revised: "same", result: "skill.select" }
  ])("checks the exact answered-scope selection for $scenario", async ({ fit, spanFrom, revised, malformed, result }) => {
    const { turn, calls, readStage, propose, reviewFitWith } = fixture();
    const controller = new AbortController();
    const method = { skillId: "count_based", readReceiptId: "read-count", version: 2, contentHash: "sha256:" + "a".repeat(64),
      excerpt: " " + "Use service counts when each visit bears the same charge.\r\n".padEnd(238, "x") + "🚚 " + "abc ".repeat(600).slice(0, 2_158) };
    const alternative = { skillId: "duration_based", readReceiptId: "read-duration", version: 1, contentHash: "sha256:" + "b".repeat(64),
      excerpt: "Multiply billable service hours by the hourly rate. ".repeat(8).slice(0, 377) };
    expect(method.excerpt).toHaveLength(2_400);
    const unbound = { ...alternative, readReceiptId: "stale-read", excerpt: "Unverified excerpt." };
    const extra = { skillId: "fixed_charge", readReceiptId: "read-fixed", version: 1, contentHash: "sha256:" + "c".repeat(64),
      excerpt: "Charge independent of duration or count." };
    const allowed = ["skill.select", "user.ask", revised === "skill.report_gap" ? "skill.report_gap" : "skill.search"];
    const tools = createDefaultToolRegistry().list().filter(tool => allowed.includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({ skillDiscovery: true, tools,
      skillSelectReceipts: new Map([method, alternative, extra].map(read => [read.skillId, read.readReceiptId])),
      observation: { outcome: "structural_model", readSkillMethods: [unbound, alternative, extra, method],
        skillResolution: fit === "skip" ? { pinnedSkillId: method.skillId } : {} }
    });
    const question = "Is the service charged per visit or by time spent?";
    const answer = spanFrom === "proposedMethod" ? "Charge per visit and leave the price blank for now."
      : "Charge in billable hours. Keep the hourly rate blank until invoicing confirms it.";
    const ask = (question: string, reason: string) => guided("Clarify the method.", { tool: "user.ask", focusedQuestion: { question, reason } });
    const select = (skillId: string) => guided("Select a method.", { tool: "skill.select", skillSelection: {
      skillId, reason: "The reviewed method applies to the service billing boundary."
    } });
    propose(ask(question, "The billing basis determines the formula."));
    const first = await turn.completeTurn(initial);
    propose(select(method.skillId));
    let fitCalls = 0;
    const reviewer = vi.fn((request: AppleCompletionRequest) => {
      fitCalls += 1;
      const prompt = JSON.parse(request.prompt);
      const methodSpanId = spanFrom ? prompt[spanFrom].spans[0].id as string : undefined;
      const assessment = { fit, conclusion: "The approved billing basis determines the applicable method.", ...(methodSpanId ? {
        methodSpanId, scopeSpanId: malformed === "stale_scope" ? "stale_scope" : prompt.scopeSpans[0].id, reasonLanguage: "en"
      } : {}) };
      if (malformed === "native") return new AppleTransportError("invalid_output", "native_output");
      if (malformed === "timeout") return new AppleTransportError("timeout");
      if (malformed === "cancelled") {
        controller.abort();
        return new AppleTransportError("cancelled");
      }
      if (malformed === "stale") return { ...assessment, methodSpanId: "p1_old_read_identity" };
      if (malformed === "legacy") return { ...assessment, methodQuote: method.excerpt };
      if (malformed === "missing_permanent" || (fitCalls === 1 && malformed === "missing")) return { ...assessment, methodSpanId: null };
      if (fitCalls === 1 && malformed === "type") return { ...assessment, methodSpanId: 377 };
      if (fitCalls === 1 && malformed === "shape") return { ...assessment, extra: "Private malformed output." };
      if (revised === "skill.select") propose(select(alternative.skillId));
      if (revised === "skill.search") propose(guided("Find a matching method.", { tool: "skill.search", skillSearch: { rootKpi: "Hourly service costs" } }));
      if (revised === "skill.report_gap") propose(guided("Report the reviewed gap.", { tool: "skill.report_gap",
        skillGap: { reason: "The permitted catalog was reviewed and no method covers the stated billing basis." } }));
      if (revised === "user.ask") propose(ask("Are callout fees included?", "The fee would add a separate term."));
      return assessment;
    });
    reviewFitWith(reviewer);
    const resumed = turn.completeTurn({ ...initial, signal: controller.signal, exchangeId: "exchange-2", previousCursor: first.cursor, delta: {
      type: "human_input", input: { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } }
    } });
    if (result === "skill.report_gap") await expect(resumed).rejects.toMatchObject({ code: "invalid_output" });
    else if (result) expect((await resumed).output).toMatchObject({ action: { batch: { calls: [{ toolName: result,
      ...(result === "skill.select" ? { args: fit === "other_reviewed_method_matches"
        ? { skillId: alternative.skillId, readReceiptId: alternative.readReceiptId }
        : { skillId: method.skillId, readReceiptId: method.readReceiptId } } : {})
    }] } } });
    else {
      const error = await resumed.catch(reason => reason);
      if (malformed === "timeout" || malformed === "cancelled") expect(error).toMatchObject({ code: malformed });
      else expect(error).toMatchObject({ code: "invalid_output", message: expect.stringContaining(
        revised === "same" ? "APPLE_GUIDED_ACTION_CANONICAL_VALIDATION" : malformed === "native" ? "APPLE_ANSWERED_METHOD_FIT_NATIVE_OUTPUT"
          : `APPLE_ANSWERED_METHOD_FIT_RETRY_${malformed === "missing_permanent" ? "FIT_SPAN_MISSING"
            : malformed === "legacy" ? "FIT_SHAPE" : malformed === "stale_scope" ? "FIT_SCOPE_SPAN" : "FIT_SPAN_MISMATCH"}`
      ) });
      expect(error.message).not.toContain(method.excerpt);
      expect(error.message).not.toContain("p1_old_read_identity");
    }
    if (fit === "skip") {
      expect(reviewer).not.toHaveBeenCalled();
      return;
    }
    const retried = malformed ? !["native", "timeout", "cancelled"].includes(malformed) : !result && revised !== "same";
    expect(reviewer).toHaveBeenCalledTimes(retried ? 2 : 1);
    const firstReview = JSON.parse(calls[2]!.prompt);
    expect(firstReview.submittedUserAnswers).toEqual([{ question, answer: [answer] }]);
    for (const [key, reviewed] of [["proposedMethod", method], ["otherReviewedMethod", alternative]] as const) {
      const { excerpt, ...identity } = reviewed;
      const { spans, ...actualIdentity } = firstReview[key] as typeof identity & { spans: { id: string; text: string }[] };
      expect(actualIdentity).toEqual(identity);
      expect(spans.map(span => span.text).join("")).toEqual(excerpt);
      expect(spans.every(span => Array.from(span.text).length <= 240)).toBe(true);
    }
    const proposedIds = firstReview.proposedMethod.spans.map((span: { id: string }) => span.id) as string[];
    const alternativeIds = firstReview.otherReviewedMethod.spans.map((span: { id: string }) => span.id) as string[];
    expect(proposedIds).toHaveLength(10);
    expect(alternativeIds).toHaveLength(2);
    expect(new Set([...proposedIds, ...alternativeIds]).size).toBe(12);
    expect(firstReview.proposedMethod.spans[0].text.endsWith("🚚")).toBe(true);
    expect(calls[2]).toMatchObject({ timeoutMs: 18_000, schema: { fields: expect.arrayContaining([
      { name: "methodSpanId", optional: true, shape: { kind: "choice", choices: [...proposedIds, ...alternativeIds] }, description: expect.any(String) }
    ]) } });
    expect(calls[2]!.prompt).not.toContain(unbound.excerpt);
    expect(calls[2]!.prompt).not.toContain(extra.excerpt);
    if (retried) {
      const { revisionInstruction, ...sameEvidence } = JSON.parse(calls[3]!.prompt);
      expect(revisionInstruction).toContain("previous response supplies no evidence");
      expect(sameEvidence).toEqual(firstReview);
      expect(calls[3]!.prompt).not.toContain("Private malformed output.");
    }
    if (revised === "skill.select" || revised === "same") {
      expect(JSON.parse(calls[3]!.prompt)).toMatchObject({ reviewedSkillChoice: alternative, tools: [{ name: "skill.select" }] });
      expect(JSON.stringify(calls[3]!.schema)).toContain(`"choices":["${alternative.skillId}"]`);
    }
    if (revised === "skill.search" || revised === "skill.report_gap" || revised === "user.ask") {
      expect(JSON.parse(calls[3]!.prompt).tools).toMatchObject([{ name: revised }]);
    }
  });

  it.each([
    {
      scenario: "a negated independent branch",
      answer: "The same material runs through both stages in series. Only the final screened output counts. There is no independent secondary output.",
      steering: "Please go ahead.",
      rejectedClaim: "The secondary output counts separately.",
      selectedId: "serial_capacity"
    },
    {
      scenario: "affirmative independent outputs",
      answer: "Две установки дают независимые потоки без двойного учёта. Оба потока входят в итог на одной часовой базе.",
      rejectedClaim: "Only the final screened output counts.",
      selectedId: "independent_output"
    },
    {
      scenario: "a correction superseding a submitted answer",
      answer: "The two stages produce independent outputs.",
      steering: "Correction. The same material runs through both stages, and only final screened output counts.",
      rejectedClaim: "Both independent outputs count.",
      useSteering: true,
      selectedId: "serial_capacity"
    },
    {
      scenario: "an answer too long to quote without dropping a qualification",
      answer: "There are two potential lines to evaluate. ".repeat(3)
        + "The same material runs through both stages in series. The secondary line must be excluded. "
        + "Leave the measurements blank until we have the sensor report. ".repeat(7),
      rejectedClaim: "The secondary output counts separately.",
      selectedId: "serial_capacity"
    }
  ])("quotes the user scope after an exact method fit for $scenario", async ({ answer, rejectedClaim, selectedId, steering, useSteering }) => {
    const { turn, readStage, propose, reviewFitWith } = fixture();
    const methods = [
      { skillId: "serial_capacity", readReceiptId: "read-serial", version: 2, contentHash: "hash-serial",
        excerpt: "For a single material flow in series, the lower stage capacity determines final output." },
      { skillId: "independent_output", readReceiptId: "read-independent", version: 1, contentHash: "hash-independent",
        excerpt: "Sum non-overlapping outputs at the same reporting boundary and on the same basis." }
    ];
    const tools = createDefaultToolRegistry().list().filter(tool => ["skill.select", "user.ask"].includes(tool.name)).map(tool => ({
      name: tool.name, summary: tool.description, arguments: {},
      validateArguments: (args: unknown) => tool.inputSchema.parse(args) as Record<string, unknown>
    }));
    readStage.mockReturnValue({ skillDiscovery: true, tools,
      skillSelectReceipts: new Map(methods.map(read => [read.skillId, read.readReceiptId])),
      observation: { outcome: "structural_model", readSkillMethods: methods }
    });
    propose(guided("Ask which outputs count.", { tool: "user.ask", focusedQuestion: {
      question: "Do both stages handle the same material flow?", reason: "The relationship determines the capacity method."
    } }));
    const first = await turn.completeTurn(initial);
    const select = (skillId: string) => guided("Select the method.", {
      tool: "skill.select", skillSelection: { skillId, reason: rejectedClaim }
    });
    propose(select("serial_capacity"));
    let acceptedQuote = "";
    reviewFitWith(request => {
      const prompt = JSON.parse(request.prompt);
      const source = useSteering ? "latest_instruction" : "submitted_answer_1";
      const scope = prompt.scopeSpans.find((span: { source: string; text: string }) => span.source === source
        && (answer.length < 450 || span.text.includes("The secondary line must be excluded.")));
      acceptedQuote = scope.text;
      if (selectedId === "serial_capacity") return { ...proposedFit(request, rejectedClaim), scopeSpanId: scope.id };
      propose(select(selectedId));
      return { fit: "other_reviewed_method_matches", conclusion: rejectedClaim,
        methodSpanId: prompt.otherReviewedMethod.spans[0].id, scopeSpanId: scope.id, reasonLanguage: "ru" };
    });
    const input = { type: "user_answer", questionSetId: "questions-exchange-1:call", answers: { skill_scope: answer } } as const;
    const response = await turn.completeTurn({ ...initial, exchangeId: "exchange-2", previousCursor: first.cursor, delta: {
      ...(steering ? { type: "human_inputs" as const, inputs: [input, { type: "user_instruction" as const, text: steering }] }
        : { type: "human_input" as const, input })
    } });
    expect(acceptedQuote).toBeTruthy();
    expect(useSteering ? steering : answer).toContain(acceptedQuote);
    expect(response.output).toMatchObject({ action: { batch: { calls: [{ toolName: "skill.select", args: {
      skillId: selectedId, readReceiptId: methods.find(method => method.skillId === selectedId)?.readReceiptId,
      reason: selectedId === "serial_capacity" ? `This method fits the scope you specified: «${acceptedQuote}»`
        : `Метод подходит для указанного вами процесса: «${acceptedQuote}»`
    } }] } } });
    expect(JSON.stringify(response.output)).not.toContain(rejectedClaim);
  });

  it("fences mismatched run scope, locale/readiness and revision before an inference", async () => {
    const { turn, setCapability, calls, discover } = fixture();
    await expect(turn.completeTurn({ ...initial, binding: { ...initial.binding, runId: "other-run" } }))
      .rejects.toMatchObject({ code: "stale_identity" });
    setCapability({ ...pinned, identity: { ...pinned.identity, osBuild: "new build" } });
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "stale_identity" });
    discover.mockRejectedValueOnce(new AppleTransportError("unsupported_locale"));
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "unsupported_locale" });
    setCapability({ ...pinned, tokenBudgetVerified: false });
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ code: "token_api_unavailable" });
    expect(calls).toHaveLength(0);
  });

  describe("compact structural finish handoff", () => {
    const formulaResult = { toolName: "vdt.set_formula", status: "succeeded", resultCode: "OK" } as const;
    const formulaCheckpoint = { type: "tool_results", batchId: "batch-1", results: [formulaResult] } as const;
    const steering = { type: "user_instruction", text: "Use the revised screening boundary." } as const;

    async function finishFixture(compact = true) {
      const { turn, calls, readStage, propose, discover } = fixture();
      const first = await turn.completeTurn(initial);
      const validateArguments = vi.fn((args: unknown) => {
        if (JSON.stringify(args) !== "{}") throw new AppleTransportError("invalid_output");
        return {};
      });
      readStage.mockReturnValue({ observation: { outcome: "structural_model" }, tools: [{
        name: "run.request_finish", summary: "Request verified finish.", arguments: {}, validateArguments
      }], ...(compact ? { structuralGuide: {
        phase: "finish", names: ["run.request_finish"], payloads: new Map(),
        instruction: "Request verified finish.", rootNodeId: "root-1", missingNodeIds: []
      } } : {}) });
      const request = { ...initial, exchangeId: "exchange-2", previousCursor: first.cursor, delta: formulaCheckpoint };
      return { turn, request, calls, propose, discover, validateArguments };
    }

    it.each(["succeeded", "replayed"])("projects one validated finish request after a %s formula without inference", async status => {
      const { turn, request, calls, propose, discover, validateArguments } = await finishFixture();
      propose(null);
      const result = await turn.completeTurn({ ...request,
        delta: { ...formulaCheckpoint, results: [{ ...formulaResult, status }] }
      });
      expect(result).toEqual({
        cursor: expect.stringMatching(/^turn:exchange-2:[a-f0-9]{32}$/),
        output: { turnId: "exchange-2", sessionState: "Need to inspect the model.", assistantMessage: null,
          action: { type: "action_batch", batch: { calls: [{
            externalCallId: "exchange-2:call", toolName: "run.request_finish", args: {}
          }] } }
        }
      });
      expect(validateArguments).toHaveBeenCalledExactlyOnceWith({});
      expect(discover).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(1);
    });

    it.each([
      { name: "without the compact guide", compact: false, delta: formulaCheckpoint },
      { name: "with newly delivered steering", compact: true, delta: {
        type: "checkpoint_inputs", checkpointDelta: formulaCheckpoint, inputs: [steering]
      } },
      { name: "after stale-revision reconciliation", compact: true, delta: {
        ...formulaCheckpoint, type: "manual_reconciliation", reconciliation: { currentRevision: 8 },
        results: [{ ...formulaResult, status: "failed", resultCode: "STALE_REVISION" }]
      } },
      { name: "after an approval pause", compact: true, delta: {
        ...formulaCheckpoint, results: [{ ...formulaResult, status: "waiting_approval" }]
      } }
    ] satisfies { name: string; compact: boolean; delta: ModelAgentTurnRequest["delta"] }[])("keeps native proposal validation $name", async ({ compact, delta }) => {
      const { turn, request, calls, propose, validateArguments } = await finishFixture(compact);
      propose(compact ? guided("Request verification.", { tool: "run.request_finish" })
        : { sessionState: "Request verification.", tool: "run.request_finish" });
      await turn.completeTurn({ ...request, delta });
      expect(calls).toHaveLength(2);
      const prompt = JSON.parse(calls[1]!.prompt);
      expect(prompt.checkpoint).toEqual(delta);
      if (delta.type === "checkpoint_inputs") expect(prompt.latestUserInstruction).toBe(steering.text);
      expect(validateArguments).toHaveBeenCalledExactlyOnceWith({});
    });

    it("observes cancellation before proposing compact finish", async () => {
      const { turn, request, calls, validateArguments } = await finishFixture();
      const controller = new AbortController();
      controller.abort();
      await expect(turn.completeTurn({ ...request, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
      expect(validateArguments).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
    });
  });

  it("retains host finish receipt and verified text despite different native text", async () => {
    const { turn, propose } = fixture();
    const started = await turn.completeTurn(initial);
    propose({ sessionState: "Finished.", text: "An unrelated figure." });
    const finished = await turn.completeTurn({
      ...initial, exchangeId: "exchange-2", previousCursor: started.cursor,
      delta: {
        type: "tool_results", batchId: "batch-1",
        results: [{ toolName: "run.request_finish", status: "succeeded", payload: { receiptId: "receipt-1", verifiedFinalText: "Verified revenue is 2,000 USD." } }]
      }
    });
    expect(finished.output).toMatchObject({
      action: { type: "final", finishReceiptId: "receipt-1", text: "Verified revenue is 2,000 USD." }
    });
  });

  it("uses the same port with a task-specific bounded prompt, and rejects unverified context drift", async () => {
    const { port, propose, setCapability, calls } = fixture();
    propose({ value: 5 });
    const run = () => completeAppleNativeBoundedTask({
      port, pinned, input: 5,
      task: {
        schema: { kind: "object", fields: [{ name: "value", shape: { kind: "integer" } }] },
        maxOutputTokens: 32, timeoutMs: 5_000,
        buildPrompt: input => String(input),
        validateCanonical(proposal) {
          if (JSON.stringify(proposal) !== '{"value":5}') throw new Error("Mismatch.");
          return 5;
        }
      }
    });
    await expect(run()).resolves.toMatchObject({ value: 5 });
    setCapability({ ...pinned, contextSize: 16384 });
    await expect(run()).rejects.toMatchObject({ code: "stale_identity" });
    expect(calls).toHaveLength(1);
  });
});

describe("typed Apple update on an existing selected input", () => {
  const update = "vdt.update_node";
  const fill = "vdt.fill_input_values_batch";
  const selected = "east_dispatches";
  const typed = { sessionState: "Edit only the selection.", action: { tool: update, nodeId: selected, patch: { baselineValue: 24 } } };

  function editorFixture(selectedInputUpdateId = selected) {
    const harness = fixture();
    const registry = createDefaultToolRegistry();
    harness.readStage.mockReturnValue({
      selectedInputUpdateId,
      observation: { selectedNode: { id: selected, type: "input", baselineValue: 18 }, selectedInputBaselineState: "populated" },
      tools: [update, fill, "user.ask"].map(name => {
        const tool = registry.list().find(candidate => candidate.name === name)!;
        return { name, summary: tool.description, arguments: {}, validateArguments: value => tool.inputSchema.parse(value) as Record<string, unknown> };
      })
    });
    return harness;
  }

  it("offers a typed update and keeps the other canonical actions selectable", async () => {
    const harness = editorFixture();
    harness.propose(typed);
    expect((await harness.turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{
      toolName: update, args: { nodeId: selected, patch: { baselineValue: 24 } }
    }] } } });
    const field = harness.calls[0]?.schema.fields.find(field => field.name === "action");
    expect(field?.shape.kind).toBe("union");
    if (field?.shape.kind !== "union") throw new Error("Missing action alternatives.");
    expect(field.shape.variants.map(variant => variant.fields[0]?.shape)).toEqual([
      { kind: "choice", choices: [update] }, { kind: "choice", choices: [update, fill, "user.ask"] }
    ]);
    expect(field.shape.variants[0]?.fields.find(field => field.name === "patch")?.shape).toEqual({ kind: "object", fields: [
      { name: "baselineValue", shape: { kind: "number" }, description: expect.any(String) }
    ] });
    expect(JSON.parse(harness.calls[0]!.prompt).observation.selectedInputBaselineState).toBe("populated");

    harness.propose({ sessionState: "A genuine question.", action: { tool: "user.ask", argumentsJson:
      JSON.stringify({ questions: [{ id: "unit", question: "Which unit should the baseline use?", reason: "The units differ.", required: true, expectedAnswerType: "text" }] }) } });
    expect((await harness.turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
  });

  it.each([selected, "west_dispatches"])("keeps the generic canonical update for a request naming %s", async target => {
    const harness = editorFixture();
    const current = { ...initial, delta: { ...initial.delta, context: { brief: {
      prompt: `Rename the ${target} node to Reviewed tally.`, selectedNodeId: selected
    } } } } as ModelAgentTurnRequest;
    harness.propose({ sessionState: "Explicit node metadata update.", action: {
      tool: update, argumentsJson: JSON.stringify({ nodeId: target, patch: { name: "Reviewed tally" } })
    } });
    expect((await harness.turn.completeTurn(current)).output).toMatchObject({ action: { batch: { calls: [{
      toolName: update, args: { nodeId: target, patch: { name: "Reviewed tally" } }
    }] } } });
  });

  it("preserves explicitly requested source metadata changes on the existing generic update", async () => {
    const harness = editorFixture();
    const source = { sourceTier: "user_input", note: "24 from revised Dispatch sheet" };
    harness.propose({ sessionState: "Requested value and source.", action: { tool: update, argumentsJson:
      JSON.stringify({ nodeId: selected, patch: { baselineValue: 24, valueSource: source } }) } });
    expect((await harness.turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{
      toolName: update, args: { nodeId: selected, patch: { baselineValue: 24, valueSource: source } }
    }] } } });
  });

  it("keeps the ordinary wire shape when a selection exceeds the Swift choice byte limit", async () => {
    const choiceId = "я".repeat(51);
    const harness = editorFixture(choiceId);
    harness.propose({ sessionState: "Explicit update.", tool: update,
      argumentsJson: JSON.stringify({ nodeId: choiceId, patch: { baselineValue: 24 } }) });
    expect((await harness.turn.completeTurn(initial)).output).toMatchObject({ action: { batch: { calls: [{ toolName: update }] } } });
    expect(harness.calls[0]?.schema.fields.map(field => field.name)).toEqual(["sessionState", "tool", "argumentsJson"]);
  });

  it.each([
    { ...typed, action: { ...typed.action, nodeId: "west_dispatches" } },
    { ...typed, action: { ...typed.action, nodeId: "missing" } },
    { ...typed, action: { ...typed.action, patch: { baselineValue: "24" } } },
    { ...typed, action: { ...typed.action, patch: { hiddenOperation: "other" } } },
    { ...typed, action: { ...typed.action, patch: { baselineValue: null } } },
    { ...typed, action: { ...typed.action, patch: { baselineValue: 24, formula: "null" } } },
    { ...typed, action: { ...typed.action, patch: { name: "null", description: "null", unit: "null", formula: "null", status: "edited", valueSource: null } } },
    { ...typed, action: { ...typed.action, argumentsJson: '{"nodeId":"west_dispatches","patch":{"baselineValue":24}}' } },
    { ...typed, action: { tool: fill, argumentsJson: '{"values":' } },
    { sessionState: "Malformed old output.", tool: fill, argumentsJson: '{"values":' }
  ])("rejects an untrusted proposal %j without issuing a canonical action", async proposal => {
    const harness = editorFixture();
    harness.propose(proposal);
    await expect(harness.turn.completeTurn(initial)).rejects.toMatchObject({ code: "invalid_output" });
    expect(harness.calls).toHaveLength(1);
  });
});

describe("Apple baseline checkpoint after an exact reviewed replay", () => {
  const update = "vdt.update_node";
  const finish = "run.request_finish";
  const nodeId = "east_dispatches";
  const appliedId = "run:mutation:1";
  const baselineValue = 24;
  const checkpoint = {
    toolName: update, externalCallId: "replayed-update:call", status: "succeeded", resultCode: "OK",
    payload: { projectChanged: false, mutationProposal: { id: appliedId, status: "applied" },
      output: { changed: false, appliedProposalId: appliedId, nodeId, baselineValue, revision: 1 } }
  } as const;
  const typed = { sessionState: "Selected edit.", action: { tool: update, nodeId, patch: { baselineValue } } };
  const guided = (tool: string, args?: unknown) => ({
    sessionState: "Continue.", action: { tool, ...(args === undefined ? {} : { argumentsJson: JSON.stringify(args) }) }
  });
  const updateArgs = (target: string, patch: Record<string, unknown>) =>
    guided(update, { nodeId: target, patch });

  async function afterTypedUpdate() {
    const harness = fixture();
    const registry = createDefaultToolRegistry();
    const tool = registry.list().find(candidate => candidate.name === update)!;
    const stage = (revision: number, value: number, selection = nodeId, finishEligible = true): AppleNativeStage => ({
      selectedInputUpdateId: selection,
      observation: { revision, selectedNode: { id: selection, type: "input", value, baselineValue: value } },
      tools: [
        { name: update, summary: tool.description, arguments: {},
          validateArguments: input => tool.inputSchema.parse(input) as Record<string, unknown> },
        ...["project.get_subtree", "user.ask"].map(name => {
          const ordinary = registry.list().find(candidate => candidate.name === name)!;
          return { name, summary: ordinary.description, arguments: {},
            validateArguments: (input: unknown) => ordinary.inputSchema.parse(input) as Record<string, unknown> };
        }),
        ...(finishEligible ? [{ name: finish, summary: "Request verification.", arguments: {}, validateArguments(input: unknown) {
          expect(input).toEqual({});
          return {};
        } }] : [])
      ]
    });
    harness.readStage.mockReturnValue(stage(0, 18));
    harness.propose(typed);
    const first = await harness.turn.completeTurn(initial);
    harness.readStage.mockReturnValue(stage(1, baselineValue));
    const next = (delta: ModelAgentTurnRequest["delta"]): ModelAgentTurnRequest => ({
      ...initial, exchangeId: "second", stableCallKey: "second", previousCursor: first.cursor, delta
    });
    const replay = (result: Extract<ModelAgentTurnRequest["delta"], { type: "tool_results" }>["results"][number] = checkpoint) =>
      next({ type: "tool_results", batchId: "reviewed-replay", results: [result] });
    return { ...harness, stage, next, replay };
  }

  it("removes the duplicate typed choice and requests finish only when the model chooses the ordinary tool", async () => {
    const harness = await afterTypedUpdate();
    harness.propose(guided(finish));
    expect((await harness.turn.completeTurn(harness.replay())).output).toMatchObject({
      action: { type: "action_batch", batch: { calls: [{ toolName: finish, args: {} }] } }
    });
    const request = harness.calls.at(-1)!;
    expect(request.schema.fields.map(field => field.name)).toEqual(["sessionState", "action"]);
    const actionField = request.schema.fields[1];
    expect(actionField?.shape.kind).toBe("union");
    if (actionField?.shape.kind !== "union") throw new Error("Missing checkpoint alternatives.");
    expect(actionField.shape.variants.map(variant => variant.fields.map(field => field.name))).toEqual([
      ["tool"], ["tool", "argumentsJson"]
    ]);
    expect(actionField.shape.variants.map(variant => variant.fields[0]?.shape)).toEqual([
      { kind: "choice", choices: [finish] }, { kind: "choice", choices: [update, "project.get_subtree", "user.ask"] }
    ]);
    expect(JSON.parse(request.prompt).instruction).toContain("Do not propose the same selected baseline again");
  });

  it.each([{ baselineValue }, { value: baselineValue }, { baselineValue, value: baselineValue }])(
    "rejects exact same-builder baseline writes in the generic branch, %j", async patch => {
      const harness = await afterTypedUpdate();
      harness.propose(updateArgs(nodeId, patch));
      await expect(harness.turn.completeTurn(harness.replay())).rejects.toMatchObject({ code: "invalid_output" });
    }
  );

  it.each([
    [nodeId, { baselineValue: 26 }],
    [nodeId, { baselineValue, name: "Reviewed East dispatches" }],
    ["west_dispatches", { baselineValue }]
  ] as const)("keeps a genuinely different generic update to %s", async (target, patch) => {
    const harness = await afterTypedUpdate();
    harness.propose(updateArgs(target, patch));
    expect((await harness.turn.completeTurn(harness.replay())).output).toMatchObject({
      action: { batch: { calls: [{ toolName: update, args: { nodeId: target, patch } }] } }
    });
  });

  it("reopens the typed choice with a new user turn or a changed revision", async () => {
    for (const cause of ["instruction", "revision"] as const) {
      const harness = await afterTypedUpdate();
      harness.propose(guided(finish));
      await harness.turn.completeTurn(harness.replay());
      if (cause === "revision") harness.readStage.mockReturnValue(harness.stage(2, baselineValue));
      const delta = cause === "instruction"
        ? { type: "human_input", input: { type: "user_instruction", text: "Use the updated operating estimate." } }
        : { type: "tool_results", batchId: "other-tool", results: [] };
      harness.propose(typed);
      await expect(harness.turn.completeTurn(harness.next(delta as ModelAgentTurnRequest["delta"]))).resolves.toMatchObject({
        output: { action: { batch: { calls: [{ toolName: update }] } } }
      });
    }
  });

  it("gives one short corrective turn without substituting a finish choice", async () => {
    const harness = await afterTypedUpdate();
    harness.proposeOnce(updateArgs(nodeId, { baselineValue }));
    harness.propose(updateArgs("west_dispatches", { baselineValue: 25 }));
    const response = await harness.turn.completeTurn(harness.replay());
    expect(response.output).toMatchObject({ action: { batch: { calls: [{
      toolName: update, args: { nodeId: "west_dispatches", patch: { baselineValue: 25 } }
    }] } } });
    expect(harness.calls).toHaveLength(3);
    expect(harness.calls.at(-1)).toMatchObject({ timeoutMs: 18000 });
    expect(JSON.parse(harness.calls.at(-1)!.prompt).revisionInstruction).toContain("repeated the exact baseline");
    expect(harness.calls.at(-1)!.schema).toEqual(harness.calls.at(-2)!.schema);
  });

  it("stops on a second duplicate at the same checkpoint", async () => {
    const harness = await afterTypedUpdate();
    harness.propose(updateArgs(nodeId, { baselineValue }));
    await expect(harness.turn.completeTurn(harness.replay())).rejects.toThrow("APPLE_SELECTED_BASELINE_REPLAY_RETRY_SELECTED_BASELINE_REPLAY");
    expect(harness.calls).toHaveLength(3);
  });

  it("does not use the replay retry for unrelated argument validation", async () => {
    const harness = await afterTypedUpdate();
    harness.propose(updateArgs(nodeId, { baselineValue: "wrong type" }));
    await expect(harness.turn.completeTurn(harness.replay())).rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_CANONICAL_VALIDATION");
    expect(harness.calls).toHaveLength(2);
  });

  it("does not start a correction when cancellation follows the rejected duplicate", async () => {
    const harness = await afterTypedUpdate();
    const abort = new AbortController();
    harness.propose(() => {
      abort.abort();
      return updateArgs(nodeId, { baselineValue });
    });
    await expect(harness.turn.completeTurn({ ...harness.replay(), signal: abort.signal })).rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_SELECTED_BASELINE_REPLAY");
    expect(harness.calls).toHaveLength(2);
  });

  it.each([
    ["project.get_subtree", { rootNodeId: nodeId }],
    ["user.ask", { questions: [{ id: "scope", question: "Which period applies?", reason: "The period changes the requested work.",
      required: true, expectedAnswerType: "text" }] }]
  ] as const)("allows the normal %s instead of finish", async (name, args) => {
    const harness = await afterTypedUpdate();
    harness.propose(guided(name, args));
    expect((await harness.turn.completeTurn(harness.replay())).output).toMatchObject({
      action: { batch: { calls: [{ toolName: name, args }] } }
    });
  });

  it("rejects finish payload fields and retains the ordinary wire when finish is ineligible", async () => {
    const malformed = await afterTypedUpdate();
    malformed.propose(guided(finish, {}));
    await expect(malformed.turn.completeTurn(malformed.replay())).rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_GUIDED_ENVELOPE");
    expect(malformed.calls).toHaveLength(2);
    const unavailable = await afterTypedUpdate();
    unavailable.readStage.mockReturnValue(unavailable.stage(1, baselineValue, nodeId, false));
    unavailable.propose({ sessionState: "Attempt to finish.", tool: finish });
    await expect(unavailable.turn.completeTurn(unavailable.replay())).rejects.toThrow("APPLE_TOOL_ACTION_CANONICAL_VALIDATION");
    expect(unavailable.calls.at(-1)?.schema.fields.map(field => field.name)).toEqual(["sessionState", "tool", "argumentsJson"]);
  });

  const malformed = (tool: string) => ({
    sessionState: "Continue.", action: { tool, argumentsJson: "{" }
  });

  it.each([update, "unknown_action"])("repairs malformed generic JSON once on the exact protected checkpoint (%s)", async name => {
    const harness = await afterTypedUpdate();
    harness.proposeOnce(malformed(name));
    harness.propose({ sessionState: "Inspect.", action: { tool: "project.get_subtree", inspection: { rootNodeId: nodeId } } });
    await expect(harness.turn.completeTurn(harness.replay())).resolves.toMatchObject({
      output: { action: { batch: { calls: [{ toolName: "project.get_subtree", args: { rootNodeId: nodeId } }] } } }
    });
    const request = harness.calls.at(-1)!;
    expect(request).toMatchObject({ timeoutMs: 18000, maxOutputTokens: 400 });
    expect(JSON.parse(request.prompt)).toMatchObject({
      observation: { appliedBaselineCheckpoint: { nodeId, baselineValue, revision: 1 } },
      tools: [{ name: "project.get_subtree" }, { name: "user.ask" }, { name: finish }]
    });
    expect(JSON.parse(request.prompt).checkpoint).toBeUndefined();
    expect(JSON.stringify(request.schema)).not.toContain("argumentsJson");
    expect(harness.calls).toHaveLength(3);
    harness.propose(malformed(name));
    const afterRead = harness.next({ type: "tool_results", batchId: "read", results: [] });
    await expect(harness.turn.completeTurn(afterRead)).rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_SELECTED_BASELINE_GENERIC_JSON");
    expect(harness.calls).toHaveLength(4);
  });

  it("lets the corrective model choose a focused question rather than finish", async () => {
    const harness = await afterTypedUpdate();
    harness.proposeOnce(malformed("unknown_action"));
    harness.propose({ sessionState: "Clarify.", action: { tool: "user.ask",
      focusedQuestion: { question: "Which period applies?", reason: "The period changes the requested work." } } });
    await expect(harness.turn.completeTurn(harness.replay())).resolves.toMatchObject({
      output: { action: { batch: { calls: [{ toolName: "user.ask", args: { questions: [{
        question: "Which period applies?", reason: "The period changes the requested work."
      }] } }] } } }
    });
  });

  it.each([
    { sessionState: "Inspect another node.", action: { tool: "project.get_subtree", inspection: { rootNodeId: "west_dispatches" } } },
    { sessionState: "Unexpected shape.", action: { tool: finish, argumentsJson: "{}" } },
    { sessionState: "Unissued tool.", action: { tool: "unknown_action" } }
  ])("rejects an unsupported corrective selector without another call", async proposal => {
    const harness = await afterTypedUpdate();
    harness.proposeOnce(malformed("unknown_action"));
    harness.propose(proposal);
    await expect(harness.turn.completeTurn(harness.replay())).rejects.toThrow("APPLE_SELECTED_BASELINE_SHAPE_RETRY_GUIDED_ENVELOPE");
    expect(harness.calls).toHaveLength(3);
  });

  it("keeps valid JSON with an unknown tool and malformed JSON outside the checkpoint fail closed", async () => {
    const harness = await afterTypedUpdate();
    harness.propose(guided("unknown_action", {}));
    await expect(harness.turn.completeTurn(harness.replay())).rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_GUIDED_ENVELOPE");
    expect(harness.calls).toHaveLength(2);
    const outside = await afterTypedUpdate();
    outside.propose(malformed("unknown_action"));
    await expect(outside.turn.completeTurn(outside.next({ type: "tool_results", batchId: "unrelated", results: [] })))
      .rejects.toMatchObject({ code: "invalid_output" });
    expect(outside.calls).toHaveLength(2);
  });

  it("does not offer a corrective turn with finish as its only possible action", async () => {
    const harness = await afterTypedUpdate();
    const current = harness.stage(1, baselineValue);
    harness.readStage.mockReturnValue({ ...current, tools: current.tools.filter(tool =>
      tool.name !== "project.get_subtree" && tool.name !== "user.ask") });
    harness.propose(malformed("unknown_action"));
    await expect(harness.turn.completeTurn(harness.replay())).rejects
      .toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_SELECTED_BASELINE_GENERIC_JSON");
    expect(harness.calls).toHaveLength(2);
  });

  it("shares the recovery budget with the exact duplicate and respects cancellation", async () => {
    const harness = await afterTypedUpdate();
    harness.proposeOnce(updateArgs(nodeId, { baselineValue }));
    harness.propose(guided("project.get_subtree", { rootNodeId: nodeId }));
    await harness.turn.completeTurn(harness.replay());
    harness.propose(malformed("unknown_action"));
    await expect(harness.turn.completeTurn(harness.next({ type: "tool_results", batchId: "other-tool", results: [] })))
      .rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_SELECTED_BASELINE_GENERIC_JSON");
    expect(harness.calls).toHaveLength(4);
    const cancelled = await afterTypedUpdate();
    const abort = new AbortController();
    cancelled.propose(() => {
      abort.abort();
      return malformed("unknown_action");
    });
    await expect(cancelled.turn.completeTurn({ ...cancelled.replay(), signal: abort.signal }))
      .rejects.toThrow("APPLE_SELECTED_BASELINE_CHECKPOINT_SELECTED_BASELINE_GENERIC_JSON");
    expect(cancelled.calls).toHaveLength(2);
  });

  it("does not bind a stale or unmatched applied receipt", async () => {
    const harness = await afterTypedUpdate();
    const stale = { ...checkpoint, payload: { ...checkpoint.payload,
      mutationProposal: { id: "other-applied-proposal", status: "applied" } } };
    harness.propose(typed);
    await expect(harness.turn.completeTurn(harness.replay(stale))).resolves.toMatchObject({
      output: { action: { batch: { calls: [{ toolName: update }] } } }
    });
  });
});

describe("saved workbook actions", () => {
  it("offers verbatim evidence IDs after the host rejects a previous workbook quotation", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const evidence = "Export an Excel workbook for Recovery from the saved version “LINE CHECK”.";
    const first: ModelAgentTurnRequest = { ...request, delta: {
      type: "initial_context", contextHash: "workbook",
      context: { brief: { prompt: evidence }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT }
    } };
    const artifact = { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" };
    propose(guided("First proposal", { tool: PROPOSE_OUTCOME, workbookProposal: {
      outcome: "answer", evidenceQuote: 'Export an Excel workbook for Recovery from the saved version "LINE CHECK".', artifact
    } }));
    await turn.completeTurn(first);
    propose((call: AppleCompletionRequest) => {
      const selection = Object.entries(JSON.parse(call.prompt).quoteChoices).find(([, text]) => text === evidence);
      expect(selection).toBeDefined();
      return guided("Exact evidence", { tool: PROPOSE_OUTCOME, workbookProposal: {
        outcome: "answer", evidenceQuoteId: selection![0], artifact
      } });
    });
    const result = await turn.completeTurn({ ...first, exchangeId: "export-retry", delta: {
      type: "tool_results", batchId: "first", results: [{
        toolName: PROPOSE_OUTCOME, externalCallId: "exchange-1:call", status: "failed",
        resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
      }]
    } });
    expect(calls).toHaveLength(2);
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME,
      args: { outcome: "answer", evidenceQuote: evidence, artifact } }] } } });
  });

  it.each(["guided", "generic", "guided workbook", "generic workbook"])("rejects a structural downgrade in %s corrective output", async format => {
    const { turn, request, propose, calls } = automaticFixture();
    const evidence = "Export an Excel workbook for Recovery from the saved version “LINE CHECK”.";
    const first: ModelAgentTurnRequest = { ...request, delta: {
      type: "initial_context", contextHash: "workbook",
      context: { brief: { prompt: evidence }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT }
    } };
    propose(guided("First proposal", { tool: PROPOSE_OUTCOME, workbookProposal: {
      outcome: "answer", evidenceQuote: "Unverified", artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" }
    } }));
    const proposed = await turn.completeTurn(first);
    const { action } = modelAgentStructuredTurnSchema.parse(proposed.output);
    if (action.type !== "action_batch") throw new Error("Expected a workbook proposal.");
    propose((call: AppleCompletionRequest) => {
      const schema = JSON.stringify(call.schema);
      expect(schema).toContain('"name":"workbookProposal"');
      expect(schema).toContain('"name":"focusedQuestion"');
      expect(schema).not.toContain('"name":"outcomeProposal"');
      const evidenceQuoteId = Object.keys(JSON.parse(call.prompt).quoteChoices)[0];
      expect(schema).toContain('"name":"outcome","shape":{"kind":"choice","choices":["answer"]}');
      const structural = { outcome: "structural_model", evidenceQuoteId };
      const argumentsValue = format.endsWith("workbook") ? { ...structural, artifact: {
        kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK"
      } } : structural;
      return format.startsWith("guided")
        ? guided("Attempted downgrade", { tool: PROPOSE_OUTCOME,
          [format.endsWith("workbook") ? "workbookProposal" : "outcomeProposal"]: argumentsValue })
        : { sessionState: "Attempted downgrade", tool: PROPOSE_OUTCOME, argumentsJson: JSON.stringify(argumentsValue) };
    });
    await expect(turn.completeTurn({ ...first, exchangeId: "export-retry", delta: {
      type: "tool_results", batchId: "first", results: [{
        toolName: PROPOSE_OUTCOME, externalCallId: action.batch.calls[0]!.externalCallId,
        status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
      }]
    } })).rejects.toMatchObject({ stage: "OUTCOME_QUOTE_RETRY", reason: "GUIDED_ENVELOPE" });
    expect(calls).toHaveLength(2);
  });

  it("keeps an ordinary build-and-workbook proposal on the normal admission path after quote rejection", async () => {
    const { turn, request, propose, calls } = automaticFixture();
    const evidence = "Build an editable dispatch model and export the result to Excel.";
    const first: ModelAgentTurnRequest = { ...request, delta: {
      type: "initial_context", contextHash: "mixed-workbook",
      context: { brief: { prompt: evidence }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT }
    } };
    const artifact = { kind: "excel_workbook", scenarioName: null };
    const workbook = (evidenceQuote: string) => guided("Build and export.", { tool: PROPOSE_OUTCOME,
      workbookProposal: { outcome: "structural_model", evidenceQuote, artifact } });
    propose(workbook("Unverified"));
    const proposed = await turn.completeTurn(first);
    const { action } = modelAgentStructuredTurnSchema.parse(proposed.output);
    if (action.type !== "action_batch") throw new Error("Expected a workbook proposal.");
    propose((chooseQuote: AppleCompletionRequest) => guided("Build and export.", { tool: PROPOSE_OUTCOME, workbookProposal: {
      outcome: "structural_model", evidenceQuoteId: Object.keys(JSON.parse(chooseQuote.prompt).quoteChoices)[0], artifact
    } }));
    const result = await turn.completeTurn({ ...first, exchangeId: "mixed-workbook-retry", delta: {
      type: "tool_results", batchId: "first", results: [{
        toolName: PROPOSE_OUTCOME, externalCallId: action.batch.calls[0]!.externalCallId,
        status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
      }]
    } });
    expect(Object.values(JSON.parse(calls[1]!.prompt).quoteChoices)).toEqual([evidence]);
    expect(JSON.stringify(calls[1]!.schema)).toContain('"name":"outcomeProposal"');
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME,
      args: { outcome: "structural_model", evidenceQuote: evidence, artifact } }] } } });
  });

  it("uses the existing tool with empty arguments and retains the generic finish branch", async () => {
    const { turn, readStage, propose, calls } = fixture();
    const validate = vi.fn(args => args);
    const tool = (name: string) => ({ name, summary: name, arguments: {}, validateArguments: validate });
    const boundWorkbook = { scenarioId: "historical_recovery", scenarioName: "Recovery", revisionId: "archived_line_check" };
    readStage.mockReturnValue({ observation: { outcome: "answer" }, boundWorkbook,
      tools: ["export.excel", "user.ask", "run.request_finish"].map(tool) });
    propose(guided("Export exactly what was requested.", { tool: "export.excel" }));
    const result = await turn.completeTurn(initial);
    expect(validate).toHaveBeenCalledWith({});
    expect(JSON.parse(calls[0]!.prompt).boundWorkbook).toEqual(boundWorkbook);
    expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "export.excel", args: {} }] } } });
    propose(guided("Wait for verified finish.", { tool: "run.request_finish", argumentsJson: "{}" }));
    const finish = await turn.completeTurn({ ...initial, exchangeId: "next", delta: {
      type: "tool_results", batchId: "workbook", results: []
    } });
    expect(finish.output).toMatchObject({ action: { batch: { calls: [{ toolName: "run.request_finish", args: {} }] } } });
    propose(guided("Attempt another target.", { tool: "export.excel", argumentsJson: '{"scenarioId":"current_recovery"}' }));
    await expect(turn.completeTurn(initial)).rejects.toMatchObject({ stage: "GUIDED_ACTION", reason: "GUIDED_ENVELOPE" });
  });
});

describe("read-only workbook intent omitted on exact outcome retry", () => {
  it.each(["saved_workbook", "ordinary", "mixed", "unverified", "disallowed", "timeout",
    "context_exceeded", "malformed", "cancellation", "long_mixed"] as const)
    ("keeps the workbook selection grounded for %s assessment", async diagnosis => {
      const { turn, request, proposeOnce, calls } = automaticFixture();
      const savedRequest = "Export an Excel workbook for Recovery from the saved version “LINE CHECK”.";
      const editRequest = "First change the east dispatch baseline to 55 dispatches.";
      const brief = diagnosis === "ordinary" ? "How would I export an Excel workbook from a saved version?"
        : diagnosis === "mixed" ? "Edit the Recovery scenario, then export an Excel workbook."
        : diagnosis === "long_mixed" ? [savedRequest,
          ...Array.from({ length: 15 }, (_, index) => `Dispatch note ${index}: keep the weekly calculation period explicit.`),
          editRequest].join(" ")
          : savedRequest;
      const cancel = new AbortController();
      const first: ModelAgentTurnRequest = { ...request, signal: cancel.signal, delta: {
        type: "initial_context", contextHash: "workbook",
        context: { brief: { mode: "continue_project", prompt: brief }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT }
      } };
      proposeOnce(guided("Initial proposal.", { tool: PROPOSE_OUTCOME,
        outcomeProposal: { outcome: "structural_model", evidenceQuote: "Inexact quote" } }));
      const original = await turn.completeTurn(first);
      const action = modelAgentStructuredTurnSchema.parse(original.output).action;
      if (action.type !== "action_batch") throw new Error("Expected preceding proposal.");
      const guidedQuote = (native: AppleCompletionRequest, text: string, outcome: string) =>
        guided("Ordinary outcome.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
          outcome, evidenceQuoteId: Object.entries(JSON.parse(native.prompt).quoteChoices).find(([, excerpt]) => excerpt === text)?.[0]
        } });
      proposeOnce((native: AppleCompletionRequest) => guidedQuote(native, diagnosis === "long_mixed" ? savedRequest : brief, "answer"));
      proposeOnce((native: AppleCompletionRequest) => {
        const parsed = JSON.parse(native.prompt);
        if (diagnosis === "long_mixed") {
          expect(native.schema.fields[0]?.name).toBe("outcome");
          expect(parsed.originalBrief.prompt).toBe(brief);
          expect(parsed.quoteChoices).toBeUndefined();
          return { outcome: "structural_model" };
        }
        const { quoteChoices } = parsed;
        expect(Object.values(quoteChoices)).toEqual([brief]);
        const id = Object.keys(quoteChoices)[0];
        if (diagnosis === "cancellation") {
          cancel.abort(new AppleTransportError("cancelled"));
          return new AppleTransportError("cancelled");
        }
        if (diagnosis === "timeout" || diagnosis === "context_exceeded") return new AppleTransportError(diagnosis);
        if (diagnosis === "malformed") return { unexpected: true };
        if (diagnosis === "disallowed") return { delivery: "ordinary", evidenceQuoteId: id };
        return diagnosis === "unverified" ? { delivery: "saved_workbook", evidenceQuoteId: "invented" }
          : diagnosis === "saved_workbook" ? { delivery: diagnosis, evidenceQuoteId: id } : { delivery: diagnosis };
      });
      if (diagnosis === "saved_workbook") proposeOnce((native: AppleCompletionRequest) => {
        const { quoteChoices } = JSON.parse(native.prompt);
        expect(Object.values(quoteChoices)).toEqual([brief]);
        return guided("Propose historical delivery.", { tool: PROPOSE_OUTCOME, workbookProposal: {
          outcome: "answer", evidenceQuoteId: Object.keys(quoteChoices)[0],
          artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" }
        } });
      });
      if (diagnosis === "mixed" || diagnosis === "unverified" || diagnosis === "disallowed") proposeOnce(guided("Clarify.", { tool: "user.ask",
        focusedQuestion: { question: "Would you like the current saved workbook or should I edit the project first?",
          reason: "The edit changes which workbook to export." } }));
      if (diagnosis === "ordinary" || diagnosis === "timeout" || diagnosis === "context_exceeded" || diagnosis === "malformed") {
        proposeOnce({ outcome: "answer" });
      }
      if (diagnosis === "long_mixed") proposeOnce((native: AppleCompletionRequest) => guidedQuote(native, editRequest, "structural_model"));
      const retry: ModelAgentTurnRequest = { ...first, exchangeId: "outcome-retry", delta: {
        type: "tool_results", batchId: "attempt", results: [{
          toolName: PROPOSE_OUTCOME, externalCallId: action.batch.calls[0]!.externalCallId, status: "failed",
          resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
        }]
      } };
      if (diagnosis === "cancellation") {
        const failure = await turn.completeTurn(retry).catch(error => error);
        expect(failure).toBe(cancel.signal.reason);
        expect(failure).toMatchObject({ code: "cancelled" });
        expect(calls).toHaveLength(3);
        return;
      }
      const result = await turn.completeTurn(retry);
      expect(calls).toHaveLength(4);
      const requested = diagnosis === "mixed" || diagnosis === "unverified" || diagnosis === "disallowed"
        ? { toolName: "user.ask" }
        : { toolName: PROPOSE_OUTCOME, args: {
          outcome: diagnosis === "long_mixed" ? "structural_model" : "answer",
          evidenceQuote: diagnosis === "long_mixed" ? editRequest : brief,
          artifact: diagnosis === "saved_workbook" ? { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" } : null
        } };
      expect(result.output).toMatchObject({ action: { batch: { calls: [requested] } } });
    });
});

describe("whole-source workbook assessment scheduled only by explicit format", () => {
  it.each([
    { name: "zero rejected quotes", rejectedQuotes: 0, decision: "saved_workbook" },
    { name: "one rejected quote", rejectedQuotes: 1, decision: "saved_workbook" },
    { name: "XLSX rather than Excel", rejectedQuotes: 0, decision: "saved_workbook", format: "XLSX" },
    { name: "ordinary structure", rejectedQuotes: 1, source: "Build a weekly dispatch factor tree and leave measurements blank." },
    { name: "embedded format letters", rejectedQuotes: 0, source: "Build a factor tree for excellence in dispatch." },
    { name: "ordinary work that uses Excel", rejectedQuotes: 0, decision: "ordinary", source: "Build a factor tree using the measures from our Excel source." },
    { name: "information only", rejectedQuotes: 0, decision: "informational", source: "How can I export an Excel workbook from a saved version?" },
    { name: "mixed work", rejectedQuotes: 0, decision: "mixed", source: "Edit Recovery dispatches, then export the saved Excel workbook." },
    { name: "optional timeout", rejectedQuotes: 0, decision: "timeout" },
    { name: "pending method confirmation", rejectedQuotes: 0, confirmSkillMethod: true }
  ] as const)("gates only the independent assessment for $name", async scenario => {
    const { turn, request, proposeOnce, calls } = automaticFixture();
    const brief = "source" in scenario ? scenario.source
      : `Export an ${"format" in scenario ? scenario.format : "Excel"} workbook for Recovery from the saved version “LINE CHECK”.`;
    const decision = "decision" in scenario ? scenario.decision : undefined;
    const question = decision === "mixed" || decision === "informational";
    const first: ModelAgentTurnRequest = { ...request, delta: { type: "initial_context", contextHash: "r03-format",
      context: { brief: { mode: "continue_project", prompt: brief }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT } } };
    const structural = (quote: string) => guided("Ordinary structural proposal.", { tool: PROPOSE_OUTCOME,
      outcomeProposal: { outcome: "structural_model", evidenceQuote: quote,
        ...("confirmSkillMethod" in scenario ? { confirmSkillMethod: true } : {}) } });
    const rejected = (sequence: number, id: string): ModelAgentTurnRequest => ({ ...first, exchangeId: `exchange-${sequence}`, delta: {
      type: "tool_results", batchId: `batch-${sequence}`, results: [{
        toolName: PROPOSE_OUTCOME, externalCallId: id, status: "failed", resultCode: "OUTCOME_QUOTE_UNVERIFIED", payload: {}
      }]
    } });
    const nextRejection = (sequence: number, output: unknown) => {
      const action = modelAgentStructuredTurnSchema.parse(output).action;
      if (action.type !== "action_batch") throw new Error("Expected an ordinary outcome proposal.");
      return rejected(sequence, action.batch.calls[0]!.externalCallId);
    };
    let next = first;
    for (let index = 0; index < scenario.rejectedQuotes; index++) {
      proposeOnce(structural("A nonverbatim quote."));
      next = nextRejection(index + 2, (await turn.completeTurn(next)).output);
    }
    proposeOnce(scenario.rejectedQuotes === 0 ? structural(brief) : (native: AppleCompletionRequest) => guided(
      "Exact outcome evidence.", { tool: PROPOSE_OUTCOME, outcomeProposal: {
        outcome: "structural_model", evidenceQuoteId: Object.keys(JSON.parse(native.prompt).quoteChoices)[0]
      } }
    ));
    if (decision) proposeOnce((completion: AppleCompletionRequest) => {
      const { quoteChoices } = JSON.parse(completion.prompt);
      expect(Object.values(quoteChoices)).toEqual([brief]);
      if (decision === "saved_workbook") return { delivery: decision, evidenceQuoteId: Object.keys(quoteChoices)[0] };
      if (decision === "timeout") return new AppleTransportError("timeout");
      return { delivery: decision };
    });
    if (decision === "saved_workbook") proposeOnce((completion: AppleCompletionRequest) => {
      const { quoteChoices } = JSON.parse(completion.prompt);
      expect(Object.values(quoteChoices)).toEqual([brief]);
      return guided("Historical workbook.", { tool: PROPOSE_OUTCOME, workbookProposal: {
        outcome: "answer", evidenceQuoteId: Object.keys(quoteChoices)[0],
        artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" }
      } });
    });
    if (question) proposeOnce(guided("Clarify.", { tool: "user.ask",
      focusedQuestion: { question: "Could you clarify the scope of your request?", reason: "The deliverable depends on scope." } }));
    const result = await turn.completeTurn(next);
    expect(calls).toHaveLength(scenario.rejectedQuotes + 1 + Number(!!decision) + Number(decision === "saved_workbook" || question));
    if (question) {
      expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: "user.ask" }] } } });
    } else {
      expect(result.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME, args: {
        outcome: decision === "saved_workbook" ? "answer" : "structural_model", evidenceQuote: brief,
        artifact: decision === "saved_workbook" ? { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK" } : null
      } }] } } });
    }
    if (decision === "timeout") {
      proposeOnce((native: AppleCompletionRequest) => guided("Exact evidence after optional review timeout.", {
        tool: PROPOSE_OUTCOME, outcomeProposal: {
          outcome: "structural_model", evidenceQuoteId: Object.keys(JSON.parse(native.prompt).quoteChoices)[0]
        }
      }));
      const retried = await turn.completeTurn(nextRejection(9, result.output));
      expect(calls).toHaveLength(3);
      expect(retried.output).toMatchObject({ action: { batch: { calls: [{ toolName: PROPOSE_OUTCOME,
        args: { outcome: "structural_model", artifact: null } }] } } });
    }
  });
});

it("rejects a raw opaque revision ID when the exact workbook evidence supplies only a version title", async () => {
  const { turn, request, proposeOnce, calls } = automaticFixture();
  const brief = "Export an Excel workbook for Recovery from the saved version “LINE CHECK”.";
  const initial: ModelAgentTurnRequest = { ...request, delta: { type: "initial_context", contextHash: "named-scope",
    context: { brief: { mode: "continue_project", prompt: brief }, outcomeAdmissionPolicy: OUTCOME_ADMISSION_PROMPT } } };
  proposeOnce(guided("Ordinary proposal.", { tool: PROPOSE_OUTCOME,
    outcomeProposal: { outcome: "structural_model", evidenceQuote: brief } }));
  proposeOnce((completion: AppleCompletionRequest) => {
    const { quoteChoices } = JSON.parse(completion.prompt);
    return { delivery: "saved_workbook", evidenceQuoteId: Object.keys(quoteChoices)[0] };
  });
  proposeOnce((completion: AppleCompletionRequest) => {
    const schema = JSON.stringify(completion.schema);
    expect(schema).toContain('"name":"versionName"');
    expect(schema).not.toContain('"name":"revisionId"');
    const { quoteChoices } = JSON.parse(completion.prompt);
    return guided("Propose a fabricated ID.", { tool: PROPOSE_OUTCOME, workbookProposal: {
      outcome: "answer", evidenceQuoteId: Object.keys(quoteChoices)[0],
      artifact: { kind: "excel_workbook", scenarioName: "Recovery", versionName: "LINE CHECK", revisionId: "invented_revision" }
    } });
  });
  await expect(turn.completeTurn(initial)).rejects.toMatchObject({ stage: "OUTCOME_WORKBOOK_CORRECTION", reason: "GUIDED_ENVELOPE" });
  expect(calls).toHaveLength(3);
});
