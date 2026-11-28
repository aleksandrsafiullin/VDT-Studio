import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore, createDefaultToolRegistry, InMemoryVdtToolGatewayLedger, modelAgentStructuredTurnSchema, VdtToolGateway, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalModelAgentBinding } from "./local-model-bindings";
import { estimateOllamaAgentRequest } from "./local-model-budget";
import { createLocalModelAgentProvider } from "./local-model-provider";
import { registerOutcomeAdmission } from "./outcome-admission";
import { toProviderJsonSchema } from "./provider-json-schema";
import { ollamaRelationshipDecision } from "./structural-relationship-question";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("local Model Agent structured transport", () => {
  it("requires exact user wording before treating an Ollama relationship as settled", () => {
    const quote = "Both lines operate independently.";
    expect(ollamaRelationshipDecision({ relationship: "stated", userQuote: quote }, ["There are two lines."])).toBeUndefined();
    expect(ollamaRelationshipDecision({ question: null }, ["There are two lines."])).toBeUndefined();
    expect(ollamaRelationshipDecision({ relationship: "stated", userQuote: quote }, [quote])).toEqual({ question: null });
    expect(ollamaRelationshipDecision({ relationship: "immaterial", reason: "Only one rate is modeled." }, ["Model one line."]))
      .toEqual({ question: null });
  });

  it.each([false, true, "medium"])("pins %s from the immutable binding on local chat turns", async (think) => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null,
      action: { type: "question", messageId: "question", questionSetId: "questions", questions: [
        { id: "goal", question: "Which KPI?", reason: "Scope needs clarification.", expectedAnswerType: "text", required: true }
      ] } };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "local-model", `sha256:${"e".repeat(64)}`, think);
    const provider = createLocalModelAgentProvider(binding);
    await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: "Clarify goal" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).think).toBe(think);
  });
  it("honors explicit binding sampling and prediction limits instead of generic caller defaults", async () => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null,
      action: { type: "question", messageId: "question", questionSetId: "questions", questions: [
        { id: "goal", question: "Which KPI?", reason: "Scope needs clarification.", expectedAnswerType: "text", required: true }
      ] } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "local-model", `sha256:${"e".repeat(64)}`);
    const provider = createLocalModelAgentProvider({ ...binding,
      modelEngineAdapter: { ...binding.modelEngineAdapter, temperature: 0.6, maxTokens: 3_000 }
    });
    await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: "Clarify goal", temperature: 0.2, maxTokens: 8_000 });
    const request = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(request.options).toMatchObject({ temperature: 0.6, num_predict: 3_000 });
  });

  const proposedOutcome = (outcome: "answer" | "structural_model" | "calculated_baseline", evidenceId = "q1") => ({
    decision: "propose_outcome", outcome, evidenceId, artifact: null, confirmSkillMethod: false
  });
  const uncertainQuestion = { decision: "ask_user", question: "What deliverable would you like?", reason: "The deliverable changes the work." };
  const auditedQuestion = { ...uncertainQuestion, question: "Would you like an explanation of current throughput or an editable throughput tree?",
    firstAlternative: "an explanation of current throughput", secondAlternative: "an editable throughput tree" };
  const outcomeRejection = (step: number, resultCode: string) => ({ type: "tool_results", results: [{
    externalCallId: `exchange-${step}:call:1`, toolName: "run.propose_outcome", status: "failed",
    resultCode, resultHash: `sha256:${"f".repeat(64)}`, payload: null
  }] });

  function automaticFixture(mode: "continue_project" | "generate_vdt", prompt: string, replies: object[]) {
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Process", rootKpi: "Output", unit: "t" });
    const initial = builder.getProject();
    const store = new AgentRunStore();
    const skillResolution = { selectionRevision: 0, confirmationRequired: false };
    const run = store.createRun({
      mode, outcomeSelection: "automatic", providerId: "vdt_builder", input: { project: initial, prompt },
      skillResolution
    });
    store.updateRun(run.runId, { status: "running", builder, draftProject: initial });
    store.appendChatMessage(run.runId, { role: "user", kind: "instruction", text: prompt });
    const tools = createDefaultToolRegistry();
    registerOutcomeAdmission(tools);
    const binding = createLocalModelAgentBinding("ollama", "bound-local-model", `sha256:${"c".repeat(64)}`, false);
    const recorded: { body: Record<string, unknown>; prompt: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):11434\/api\/chat$/u);
      const body = JSON.parse(String(init?.body));
      recorded.push({ body, prompt: JSON.parse(body.messages.at(-1).content) });
      const response = replies[recorded.length - 1];
      if (!response) throw new Error("Unexpected additional model request.");
      return Response.json({ done: true, message: { content: JSON.stringify(response) } });
    }));
    const provider = createLocalModelAgentProvider(binding, () => {
      const { request, chatMessages } = store.getState(run.runId);
      const instruction = chatMessages.filter(message => message.role === "user" && message.kind === "instruction").at(-1);
      return { constructingTree: true, nodeCount: 1, rootNodeId: initial.rootNodeId, needsStructure: true,
        readinessPurpose: request.outcome, skillMethodConfirmationRequired: request.skillResolution?.confirmationRequired,
        outcomeAdmissionPending: request.outcome === undefined,
        outcomeAdmissionInstruction: instruction && { id: instruction.id, text: instruction.text } };
    });
    const complete = (step: number, delta: object) => provider.completeStructured<unknown, ReturnType<typeof modelAgentStructuredTurnSchema.parse>>({
      taskType: "agent_decision", input: { exchangeId: `exchange-${step}` }, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "fixture", userPrompt: JSON.stringify({ exchangeId: `exchange-${step}`, delta })
    });
    const start = () => complete(1, { type: "initial_context", context: {
      brief: { mode, prompt, businessContext: "Separate workspace metadata", outcomeSelection: "automatic", skillResolution: "agent_semantic" },
      tools: tools.list().filter(tool => ["run.propose_outcome", "user.ask", "skill.list", "vdt.set_formula"].includes(tool.name))
        .map(tool => ({ name: tool.name, inputJsonSchema: tool.inputJsonSchema ?? toProviderJsonSchema(tool.inputSchema) }))
    } });
    const pin = async (turn: Awaited<ReturnType<typeof complete>>) => {
      if (turn.action.type !== "action_batch" || !turn.action.batch.calls[0]) throw new Error("Expected an outcome proposal");
      const { toolName, args } = turn.action.batch.calls[0];
      return tools.run(toolName, args, { store, builder, runId: run.runId, getRun: () => store.getSnapshot(run.runId),
        updateRun: patch => { store.updateRun(run.runId, patch); }, emit: event => { store.appendEvent(run.runId, event); },
        signal: store.getState(run.runId).abortController.signal });
    };
    return { binding, recorded, start, complete, pin, state: () => store.getState(run.runId), store };
  }

  it.each([
    ["continue_project", "Set up an editable carton packing capacity tree. The lines run independently. I’ll enter the measurements next week. Let me approve the method first.", uncertainQuestion],
    ["generate_vdt", "Собери редактируемое дерево пропускной способности склада. Участки работают независимо; замеры внесу позже. Сначала покажи методику на утверждение.", proposedOutcome("answer")]
  ] as const)("reviews a coarse Automatic decision before normal structural Skill discovery (%s)", async (mode, prompt, initialDraft) => {
    const fixture = automaticFixture(mode, prompt, [
      initialDraft,
      { ...proposedOutcome("structural_model"), confirmSkillMethod: true },
      { turnId: "exchange-2", assistantMessage: null, sessionState: "Find a Skill", action: {
        type: "action_batch", batch: { calls: [{ externalCallId: "exchange-2:call:1", toolName: "skill.list", args: {} }] }
      } }
    ]);
    const proposal = await fixture.start();
    expect(fixture.recorded.map(({ body }) => body.model)).toEqual([fixture.binding.modelId, fixture.binding.modelId]);
    expect(fixture.recorded[0]?.prompt).toEqual({ workspaceOperation: mode, submittedRequest: prompt, submittedAnswers: [], evidence: { q1: prompt } });
    expect(JSON.stringify(fixture.recorded[0]?.body.format)).not.toMatch(/skill\.list|vdt\.set_formula|action_batch|externalCallId/u);
    expect(fixture.recorded[1]?.prompt.review).toEqual("question" in initialDraft
      ? { proposedQuestion: initialDraft.question }
      : { previousDecision: initialDraft, instruction: expect.any(String) });
    expect(proposal).toMatchObject({ action: { batch: { calls: [{ args: { evidenceQuote: prompt, outcome: "structural_model", confirmSkillMethod: true } }] } } });
    const admitted = await fixture.pin(proposal);
    expect(admitted).toMatchObject({ ok: true, output: { outcome: "structural_model" } });
    expect(fixture.state().request.skillResolution?.confirmationRequired).toBe(true);
    const next = await fixture.complete(2, { type: "tool_results", results: [{ toolName: "run.propose_outcome", status: "succeeded", payload: { output: admitted.output } }] });
    expect(next.action).toMatchObject({ batch: { calls: [{ toolName: "skill.list" }] } });
    expect(fixture.recorded[2]?.prompt).toMatchObject({ originalBrief: { prompt, outcome: "structural_model" },
      skillMethodConfirmationRequired: true, toolSchemasAvailable: ["skill.list"] });
  });

  it("retains a verifiable numerical-baseline decision and preserves a genuinely material question", async () => {
    const prompt = "Build and calculate a verified weekly output baseline in tonnes. Use the provided 11 tonnes per shift and 4 shifts per week.";
    const calculated = automaticFixture("continue_project", prompt, [proposedOutcome("calculated_baseline")]);
    expect(await calculated.pin(await calculated.start())).toMatchObject({ ok: true, output: { outcome: "calculated_baseline" } });
    expect(calculated.recorded).toHaveLength(1);

    const unclear = automaticFixture("continue_project", "Could you help me with the current throughput situation?", [uncertainQuestion, auditedQuestion]);
    expect((await unclear.start()).action).toMatchObject({ type: "question", questions: [{ question: auditedQuestion.question }] });
    expect(unclear.state().request.outcome).toBeUndefined();
    expect(unclear.recorded).toHaveLength(2);
  });

  it("audits a clarification that mistakes editable measurements for a separate numerical deliverable", async () => {
    const prompt = "Build an editable auditorium ticket-revenue tree. There are 24 seats at 70 dollars per ticket.";
    const fixture = automaticFixture("continue_project", prompt, [
      { ...uncertainQuestion, question: "Should I create a tree or calculate a result?" }, proposedOutcome("structural_model")
    ]);
    expect(await fixture.pin(await fixture.start())).toMatchObject({ ok: true, output: { outcome: "structural_model" } });
    expect(fixture.recorded).toHaveLength(2);
    expect(fixture.recorded[1]?.prompt).toMatchObject({ review: { proposedQuestion: "Should I create a tree or calculate a result?" } });
    expect(JSON.stringify(fixture.recorded[1]?.body.messages)).toContain("measured inputs is not a request");
  });

  it("does not publish an audited clarification with overlapping or unevidenced alternatives", async () => {
    const prompt = "Can you help with the line?";
    const fixture = automaticFixture("continue_project", prompt, [uncertainQuestion,
      { ...auditedQuestion, secondAlternative: "explanation of current throughput" }]);
    await expect(fixture.start()).rejects.toThrow("offers distinct alternatives");
    expect(fixture.state().request.outcome).toBeUndefined();
    expect(fixture.recorded).toHaveLength(2);
  });

  it("preserves method confirmation when a read-only proposal is corrected to an editable model", async () => {
    const prompt = "Build an editable cost tree and ask me to confirm your method before proceeding.";
    const fixture = automaticFixture("continue_project", prompt, [
      { ...proposedOutcome("answer"), confirmSkillMethod: true }, proposedOutcome("structural_model")
    ]);
    const proposal = await fixture.start();
    expect(proposal).toMatchObject({ action: { batch: { calls: [{ args: {
      outcome: "structural_model", confirmSkillMethod: true
    } }] } } });
    expect((await fixture.pin(proposal)).ok).toBe(true);
    expect(fixture.state().request.skillResolution?.confirmationRequired).toBe(true);
  });

  it("retains a read-only request to receive an Excel workbook after reviewing the deliverable", async () => {
    const prompt = "Export the existing plan as an Excel workbook.";
    const draft = { ...proposedOutcome("answer"), artifact: { kind: "excel_workbook", scenarioName: null } };
    const fixture = automaticFixture("continue_project", prompt, [draft, draft,
      { delivery: "workbook_requested", requestQuote: "Export the existing plan as an Excel workbook" }]);
    const proposal = await fixture.start();
    expect(fixture.recorded).toHaveLength(3);
    expect(proposal).toMatchObject({ action: { batch: { calls: [{ args: { outcome: "answer", evidenceQuote: prompt,
      artifact: draft.artifact } }] } } });
    expect(await fixture.pin(proposal)).toMatchObject({ ok: true, output: { outcome: "answer", artifactIntent: { kind: "excel_workbook" } } });
    expect(fixture.state().request.skillResolution).toBeUndefined();
  });

  it("removes an unsolicited workbook only after an independent selected-model audit", async () => {
    const prompt = "Build a cost tree. Fuel was 32 litres per shift. Keep the values editable.";
    const artifact = { kind: "excel_workbook", scenarioName: null, revisionId: "fabricated" };
    const fixture = automaticFixture("continue_project", prompt, [
      uncertainQuestion, { ...proposedOutcome("structural_model"), artifact }, { delivery: "no_workbook" }
    ]);
    const proposal = await fixture.start();
    expect(proposal).toMatchObject({ action: { batch: { calls: [{ args: { outcome: "structural_model", artifact: null } }] } } });
    expect(await fixture.pin(proposal)).toMatchObject({ ok: true, output: { outcome: "structural_model" } });
    expect(fixture.recorded).toHaveLength(3);
    expect(fixture.recorded[2]?.prompt).toEqual({ workspaceOperation: "continue_project", submittedRequest: prompt,
      submittedAnswers: [], evidence: { q1: prompt } });
  });

  it.each(["Send me the workbook", "Build a fuel cost tree"])("rejects unsupported workbook evidence %s", async requestQuote => {
    const prompt = "Build a fuel cost tree.";
    const fixture = automaticFixture("continue_project", prompt, [
      { ...proposedOutcome("structural_model"), artifact: { kind: "excel_workbook", scenarioName: null } },
      { delivery: "workbook_requested", requestQuote }
    ]);
    await expect(fixture.start()).rejects.toThrow("workbook request against submitted wording");
    expect(fixture.state().request.outcome).toBeUndefined();
  });

  it("allows one Gateway workbook selector correction after the question audit and rejects a second failure", async () => {
    const workbookRequest = "Export the result as an Excel workbook.";
    const prompt = `Build an editable cost tree using 32 litres per shift and let me approve your method. ${workbookRequest}`;
    const artifact = { kind: "excel_workbook", scenarioName: null };
    const audit = { delivery: "workbook_requested", requestQuote: workbookRequest };
    const fixture = automaticFixture("continue_project", prompt, [
      uncertainQuestion, { ...proposedOutcome("structural_model"), confirmSkillMethod: true, artifact: { ...artifact, revisionId: "fabricated" } },
      audit, { decision: "repair_workbook", artifact, evidenceId: "q1" }, audit
    ]);
    const original = await fixture.start();
    expect(await fixture.pin(original)).toMatchObject({ ok: false, error: { code: "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED" } });
    const repaired = await fixture.complete(2, outcomeRejection(1, "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED"));
    expect(repaired).toMatchObject({ action: { batch: { calls: [{ args: {
      outcome: "structural_model", confirmSkillMethod: true, artifact
    } }] } } });
    await expect(fixture.complete(3, outcomeRejection(2, "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED"))).rejects.toThrow("rejected the bounded");
    expect(fixture.recorded).toHaveLength(5);
    expect(await fixture.pin(repaired)).toMatchObject({ ok: true, output: { outcome: "structural_model", artifactIntent: { kind: "excel_workbook" } } });
  });

  it("holds a selector correction that would silently drop a confirmed workbook request", async () => {
    const workbookRequest = "Export the result as an Excel workbook.";
    const fixture = automaticFixture("continue_project", `Build an editable cost tree. ${workbookRequest}`, [
      { ...proposedOutcome("structural_model"), artifact: { kind: "excel_workbook", scenarioName: null, revisionId: "fabricated" } },
      { delivery: "workbook_requested", requestQuote: workbookRequest },
      { decision: "repair_workbook", artifact: null, evidenceId: "q1" }
    ]);
    await fixture.start();
    await expect(fixture.complete(2, outcomeRejection(1, "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED"))).rejects.toThrow("retained the requested workbook");
    expect(fixture.recorded).toHaveLength(3);
    expect(fixture.state().request.outcome).toBeUndefined();
  });

  it("does not use the Gateway correction budget to bypass a stale revision", async () => {
    const fixture = automaticFixture("continue_project", "Build an editable cost tree.", [proposedOutcome("structural_model")]);
    await fixture.start();
    await expect(fixture.complete(2, outcomeRejection(1, "STALE_REVISION"))).rejects.toThrow("rejected the bounded");
    expect(fixture.recorded).toHaveLength(1);
  });

  it("retains a grounded workbook and method when correcting a different Gateway field", async () => {
    const prompt = "Build an editable cost tree and ask me to approve your method. Export the result as an Excel workbook.";
    const artifact = { kind: "excel_workbook", scenarioName: null };
    const fixture = automaticFixture("continue_project", prompt, [
      { ...proposedOutcome("structural_model"), confirmSkillMethod: true, artifact },
      { delivery: "workbook_requested", requestQuote: "Export the result as an Excel workbook" },
      proposedOutcome("structural_model")
    ]);
    await fixture.start();
    const repaired = await fixture.complete(2, outcomeRejection(1, "OUTCOME_SCOPE_MISMATCH"));
    expect(repaired).toMatchObject({ action: { batch: { calls: [{ args: {
      outcome: "structural_model", confirmSkillMethod: true, artifact
    } }] } } });
    expect(await fixture.pin(repaired)).toMatchObject({ ok: true, output: { artifactIntent: { kind: "excel_workbook" } } });
    expect(fixture.recorded).toHaveLength(3);
  });

  it("uses one correction to replace a fabricated evidence ID without changing the submitted wording", async () => {
    const prompt = "Map the constraints as an editable cost tree; pricing can wait.";
    const fixture = automaticFixture("generate_vdt", prompt, [proposedOutcome("structural_model", "fabricated"), proposedOutcome("structural_model")]);
    expect(await fixture.pin(await fixture.start())).toMatchObject({ ok: true, output: { outcome: "structural_model" } });
    expect(fixture.recorded).toHaveLength(2);
    expect(fixture.recorded[1]?.prompt.review).toMatchObject({ instruction: expect.stringContaining("did not match") });
  });

  it("repairs a matching Gateway quote rejection without reopening the proposed outcome or requested method", async () => {
    const first = "Build an editable factor tree. ";
    const remaining = "Keep the evidence recorded in one place. ".repeat(10);
    const last = "Leave measurements blank and ask me to approve the method before building.";
    const prompt = first + remaining + last;
    const fixture = automaticFixture("continue_project", prompt, [
      { ...proposedOutcome("structural_model"), confirmSkillMethod: true }, { decision: "replace_quote", evidenceId: "q2" }
    ]);
    expect(await fixture.start()).toMatchObject({ action: { batch: { calls: [{ args: { evidenceQuote: first.trim() } }] } } });
    const rejection = (step: number) => ({ type: "tool_results", results: [{
      externalCallId: `exchange-${step}:call:1`, toolName: "run.propose_outcome", status: "failed",
      resultCode: "OUTCOME_QUOTE_UNVERIFIED", resultHash: `sha256:${"f".repeat(64)}`, payload: null
    }] });
    const corrected = await fixture.complete(2, rejection(1));
    expect(corrected).toMatchObject({ action: { batch: { calls: [{ args: {
      evidenceQuote: last, outcome: "structural_model", confirmSkillMethod: true
    } }] } } });
    expect(fixture.recorded[1]?.prompt.review).toMatchObject({ gatewayResult: "OUTCOME_QUOTE_UNVERIFIED" });
    const format = JSON.stringify(fixture.recorded[1]?.body.format);
    expect(format).toContain("replace_quote");
    expect(format).not.toContain("structural_model");
    await expect(fixture.complete(3, rejection(2))).rejects.toThrow("rejected the bounded");
    expect(fixture.recorded).toHaveLength(2);
  });

  it("uses authenticated text from a newer instruction and carries it into downstream Skill discovery", async () => {
    const original = "What affects throughput?";
    const update = "Prepare an editable throughput tree for the bottling line. I will measure the rates next week.";
    const fixture = automaticFixture("continue_project", original, [
      uncertainQuestion, auditedQuestion, proposedOutcome("structural_model"),
      { turnId: "exchange-3", assistantMessage: null, sessionState: "Find a Skill", action: {
        type: "action_batch", batch: { calls: [{ externalCallId: "exchange-3:call:1", toolName: "skill.list", args: {} }] }
      } }
    ]);
    await fixture.start();
    fixture.store.appendChatMessage(fixture.state().runId, { role: "user", kind: "instruction", text: update });
    const proposal = await fixture.complete(2, { type: "human_inputs", inputs: [{ type: "user_instruction",
      text: `Current editor scenario selection: Base\n\nCurrent user request:\n${update}` }] });
    expect(fixture.recorded[2]?.prompt).toMatchObject({ submittedRequest: update, evidence: { q1: update } });
    expect(JSON.stringify(fixture.recorded[2]?.prompt)).not.toMatch(/Current editor|What affects throughput/u);
    const admitted = await fixture.pin(proposal);
    expect(admitted.ok).toBe(true);
    await fixture.complete(3, { type: "tool_results", results: [{ toolName: "run.propose_outcome", status: "succeeded", payload: { output: admitted.output } }] });
    expect(fixture.recorded[3]?.prompt).toMatchObject({ originalBrief: { prompt: update, outcome: "structural_model" } });
    expect(JSON.stringify(fixture.recorded[3]?.prompt)).not.toContain(original);
  });

  it("offers the exact submitted clarification from a structured text answer", async () => {
    const prompt = "Could you help with throughput?";
    const answer = "Build an editable tree. We can measure later.";
    const fixture = automaticFixture("continue_project", prompt, [uncertainQuestion, auditedQuestion, proposedOutcome("structural_model", "q2")]);
    await fixture.start();
    fixture.store.updateRun(fixture.state().runId, { answers: { scope: answer } });
    const proposal = await fixture.complete(2, { type: "human_inputs", inputs: [{ type: "user_answer", questionSetId: "scope-set",
      answers: { structuredAnswers: [{ questionId: "scope", freeText: answer }] } }] });
    expect(fixture.recorded[2]?.prompt).toMatchObject({ submittedRequest: prompt, submittedAnswers: [answer],
      evidence: { q1: prompt, q2: answer } });
    expect(await fixture.pin(proposal)).toMatchObject({ ok: true, output: { outcome: "structural_model" } });
  });

  it("normalizes native input keys into canonical public arguments without choosing numeric values", async () => {
    const output = { turnId: "turn", sessionState: "Fill", assistantMessage: { messageId: "first", text: "Build the tree." }, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "vdt.fill_input_values_batch", args: { values: { count: { value: 4, provenance: "user_provided_value", note: "4 machines" } } } }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"d".repeat(64)}`), () => ({
      constructingTree: true, needsStructure: false,
      nativeInputBatch: { schemaVersion: "values_by_node_id.v1", batches: [["count"]] }
    }));
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "initial_context", context: { brief: { prompt: "4 machines" }, tools: [{
        name: "vdt.fill_input_values_batch", inputJsonSchema: { type: "object", properties: { values: { type: "array", items: {
          type: "object", properties: { nodeId: { type: "string" }, value: { type: "number" }, provenance: { type: "string" }, note: { type: "string" } },
          required: ["nodeId", "value", "provenance", "note"], additionalProperties: false
        } } } }
      }] } } }) });
    expect(result).toMatchObject({ action: { batch: { calls: [{ args: { values: [{ nodeId: "count", value: 4, provenance: "user_provided_value", note: "4 machines" }] } }] } } });
    const request = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    const args = request.format.properties.action.anyOf.find((option: { properties: { batch?: unknown } }) => option.properties.batch).properties.batch.properties.calls.items.anyOf[0].properties.args;
    expect(args).toHaveProperty("properties.values.anyOf.0.properties.count");
    expect(JSON.stringify(args)).not.toContain('"nodeId"');
  });

  it.each(["corrected", "second_rejection", "unadmitted", "queued", "stale", "aborted", "question", "question_continues", "question_review_aborted", "envelope_retry"] as const)(
    "bounds an Ollama numeric plan correction after a canonical Gateway rejection (%s)", async (variant) => {
      const hash = `sha256:${"a".repeat(64)}`;
      const pin = { id: "mining.load_and_haul", version: 1,
        contentHash: "sha256:1d388e2245abffe85d85e20a985d60ec5f62bf68c4208ff9b5ce69c293878ec3", source: "user" };
      const brief = {
        // Historical Load & Haul library rehearsal.
        prompt: "Построй и доведи до конечного годового расчёта VDT Excavation для рудника. Дано пользователем: 4 экскаватора, 10 автосамосвалов; откатка 2 км в одну сторону; скорость гружёным 10 км/ч, порожним 7 км/ч; плановый ремонт каждого самосвала 15 дней/год. Для чернового расчёта согласованы явные изменяемые допущения, а не подтверждённые данные рудника: 2 смены по 12 часов в сутки; в каждой смене 15 минут пересменки и 1 час обеда; плановый ремонт каждого экскаватора 10 дней/год. Эти допущения также сохрани как default_assumption. Нужно учесть транспорт и экскавацию, погрузку, полный рейс и годовые потери времени; итог в тоннах за год. Недостающие параметры оборудования и прочих простоев разрешено самостоятельно принять как явные изменяемые черновые допущения, а не данные рудника и не проверенные нормативы. Не задавай вопросы о уже указанных значениях; при неизвестных используй разрешённые допущения. Построй компактное понятное дерево с физически осмысленными формулами, проверь расчёт и исправь ошибки своими инструментами. Не заверши при N/A. Это новый черновик с одним корнем; формул и готовых ветвей нет. Пиши кратко по-русски.",
        goal: "Самостоятельно построить рассчитываемое дерево Excavation и завершить с проверенным числовым итогом и явными допущениями.",
        rootKpi: "Excavation", unit: "t", timePeriod: "Year", mode: "continue_project",
        options: { autoApplyPatches: true, maxSteps: 60, continueWithAssumptions: true, researchMode: "off" },
        selectedSkill: pin, skillResolution: "agent_semantic"
      };
      const builder = new VdtBuilderSession();
      builder.createDraft({ projectTitle: "Load & Haul", rootKpi: "Excavation", unit: "t" });
      const initial = builder.getProject();
      const root = initial.rootNodeId;
      const revision = builder.getRevision();
      const store = new AgentRunStore();
      const state = store.createRun({ mode: "continue_project", providerId: "vdt_builder", input: { project: initial }, options: { autoApplyPatches: false } });
      store.updateRun(state.runId, { builder, draftProject: initial });
      const definition = createLocalModelAgentBinding("ollama", "qwen3.5:4b-q4_K_M", hash, false);
      const capability = definition.capability;
      const toolContext = (): AgentToolContext => ({
        builder, store, runId: state.runId, requireDecompositionPlan: true,
        getRun: () => store.getSnapshot(state.runId), updateRun: patch => { store.updateRun(state.runId, patch); },
        emit: event => { store.appendEvent(state.runId, event); },
        signal: store.getState(state.runId).abortController.signal
      });
      const tools = createDefaultToolRegistry();
      const names = ["skill.read", "vdt.set_decomposition_plan", "vdt.inspect_hierarchy"];
      const gateway = new VdtToolGateway({ capability, tools, toolContext, allowedTools: new Set(names),
        ledger: new InMemoryVdtToolGatewayLedger(), binding: {
          schemaVersion: 2, bindingId: definition.bindingId, runId: state.runId, projectId: initial.id,
          executionProfile: capability.executionProfile, engineId: capability.engineId, engineAdapterId: capability.engineAdapterId,
          backendId: capability.backendId, modelId: definition.modelId, protocolVersion: capability.protocolVersion, cliVersion: null,
          toolIsolation: capability.toolIsolation, qualificationStatus: capability.qualification.status,
          capabilityEvidenceHash: capability.qualification.evidenceHash, settingsHash: hash, capabilityProfileHash: hash,
          toolCatalogHash: capability.toolCatalogHash, externalSessionId: null, sessionEpoch: 1, boundAt: initial.createdAt
        }
      });
      const plan = { version: 1, goal: "Годовой объём", nodes: [{ nodeId: root, parentNodeId: root, kind: "input" }] };
      const corrected = { ...plan, nodes: [{ ...plan.nodes[0], nodeId: "haulage" }] };
      let transportCalls = 0;
      const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        const step = ++transportCalls;
        const prompt = JSON.parse(request.messages.at(-1).content);
        const reviewingQuestion = Boolean(prompt.hostQuestionReview);
        const exchangeId = reviewingQuestion || prompt.hostEnvelopeRepair ? "exchange-3" : `exchange-${step}`;
        const questionVariant = ["question", "question_continues", "question_review_aborted"].includes(variant);
        if (reviewingQuestion && variant === "question_review_aborted") controller.abort();
        expect(request.model).toBe(definition.modelId);
        const name = step === 1 ? "skill.read" : step === 3 && variant === "unadmitted"
          ? "vdt.inspect_hierarchy" : "vdt.set_decomposition_plan";
        if (step === 3 && variant === "envelope_retry") return Response.json({ done: true, message: { content: "{}" } });
        const asking = questionVariant && (step === 3 || reviewingQuestion && variant !== "question_continues");
        return Response.json({ done: true, message: { content: JSON.stringify({
          ...(reviewingQuestion ? { questionDisposition: asking ? "ask_user" : "continue_work" } : {}),
          turnId: exchangeId, sessionState: "Load & Haul",
          assistantMessage: step === 1 ? { messageId: "exchange-1:opening", text: "Рассчитаю годовой объём." } : null,
          action: asking ? {
            type: "question", messageId: `${exchangeId}:message`, questionSetId: `${exchangeId}:questions`, questions: [{
              id: "scope", question: reviewingQuestion ? "Входит ли вскрыша в годовой объём?" : "Учитывать ли вскрышу?", reason: "Это меняет охват расчёта.", expectedAnswerType: "text", required: true
            }]
          } : { type: "action_batch", batch: { calls: [
            { externalCallId: `${exchangeId}:call:1`, toolName: name, args: step === 1 ? { skillId: pin.id }
              : { plan: step === 2 || variant === "second_rejection" ? plan : corrected } }
          ] } }
        }) } });
      });
      vi.stubGlobal("fetch", fetcher);
      let observedRevision = revision;
      const provider = createLocalModelAgentProvider(definition, () => ({
        constructingTree: true, needsStructure: true, hierarchyRequired: true, nodeCount: 1,
        hasDecompositionPlan: false, readinessPurpose: "calculated_baseline", rootNodeId: root, revision: observedRevision
      }));
      const controller = new AbortController();
      const complete = (step: number, delta: unknown) => provider.completeStructured<unknown, import("zod").infer<typeof modelAgentStructuredTurnSchema>>({
        taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT",
        signal: controller.signal, userPrompt: JSON.stringify({ exchangeId: `exchange-${step}`, delta })
      });
      await complete(1, { type: "initial_context", context: { brief, tools: tools.list().filter(tool => names.includes(tool.name))
        .map(tool => ({ name: tool.name, inputJsonSchema: tool.inputJsonSchema ?? toProviderJsonSchema(tool.inputSchema) })) } });
      const first = await complete(2, { type: "tool_results", results: [
        { status: "succeeded", toolName: "skill.read", payload: { output: { ...pin, readReceiptId: "pinned-read", excerpt: "Load and haul guidance" } } }
      ] });
      if (first.action.type !== "action_batch" || !first.action.batch.calls[0]) throw new Error("Expected model-authored plan");
      const rejection = await gateway.execute(first.action.batch.calls[0]);
      expect(rejection).toMatchObject({ status: "failed", resultCode: "INVALID_DECOMPOSITION_PLAN" });
      expect(builder.getRevision()).toBe(revision);
      expect(builder.getProject()).toEqual(initial);
      expect(store.getState(state.runId).mutationProposals ?? []).toHaveLength(0);
      const delta = { type: "tool_results", results: [rejection] };
      if (variant === "stale") observedRevision++;
      if (variant === "aborted") {
        controller.abort();
        await expect(complete(3, delta)).rejects.toMatchObject({ name: "AbortError" });
        expect(fetcher).toHaveBeenCalledTimes(2);
        return;
      }
      const next = complete(3, variant === "queued" ? { type: "checkpoint_inputs", checkpointDelta: delta, inputs: [] } : delta);
      if (variant === "unadmitted") {
        await expect(next).rejects.toThrow("outside the admitted plan correction");
      } else if (variant === "question_review_aborted") {
        await expect(next).rejects.toMatchObject({ name: "AbortError" });
        expect(fetcher).toHaveBeenCalledTimes(4);
      } else {
        const nextTurn = await next;
        if (variant === "question") {
          expect(nextTurn.action).toMatchObject({ type: "question", questions: [{ question: "Входит ли вскрыша в годовой объём?" }] });
          expect(fetcher).toHaveBeenCalledTimes(4);
        }
        if (["corrected", "second_rejection", "question_continues", "envelope_retry"].includes(variant)) {
          if (nextTurn.action.type !== "action_batch" || !nextTurn.action.batch.calls[0]) throw new Error("Expected model-authored correction");
          const result = await gateway.execute(nextTurn.action.batch.calls[0]);
          if (variant !== "second_rejection") {
            expect(result.status).toBe("waiting_approval");
            expect(store.getState(state.runId).mutationProposals).toHaveLength(1);
          } else {
            expect(result.resultCode).toBe("INVALID_DECOMPOSITION_PLAN");
            await complete(4, { type: "tool_results", results: [result] });
            const fourth = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
            expect(JSON.parse(fourth.messages.at(-1).content)).not.toHaveProperty("planReview");
          }
        }
      }
      const request = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
      const correctionPrompt = JSON.parse(request.messages.at(-1).content);
      if (variant === "queued" || variant === "stale") {
        expect(correctionPrompt).not.toHaveProperty("planReview");
      } else {
        expect(request).toMatchObject({ model: definition.modelId, think: false });
        expect(request.messages).toHaveLength(2);
        const budget = estimateOllamaAgentRequest(request);
        expect(budget.estimatedMessageTokens + budget.outputReserveTokens).toBeLessThanOrEqual(request.options.num_ctx);
        expect(request.options.num_ctx).toBeLessThanOrEqual(16_384);
        expect(correctionPrompt).toMatchObject({
          originalBrief: brief, hostObservation: { rootNodeId: root, revision },
          confirmedKnowledge: { selectedSkillRead: { skillId: pin.id, readReceiptId: "pinned-read" } },
          toolSchemasAvailable: ["vdt.set_decomposition_plan"],
          planReview: { previousPlan: plan, rejectedCallId: "exchange-2:call:1", diagnostic: expect.stringContaining(root) }
        });
        expect(JSON.stringify(request.format)).not.toContain('"vdt.inspect_hierarchy"');
        if (["question", "question_continues", "question_review_aborted", "envelope_retry"].includes(variant)) {
          expect(fetcher).toHaveBeenCalledTimes(4);
          const reviewRequest = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
          const reviewPrompt = JSON.parse(reviewRequest.messages.at(-1).content);
          expect(reviewRequest).toMatchObject({ model: definition.modelId, think: false });
          expect(reviewRequest.messages).toHaveLength(2);
          expect(reviewPrompt).toMatchObject(correctionPrompt);
          expect(JSON.stringify(reviewRequest.format)).not.toContain('"vdt.inspect_hierarchy"');
          if (variant === "envelope_retry") {
            expect(reviewPrompt.hostEnvelopeRepair).toEqual(expect.any(String));
            expect(reviewRequest.format).toEqual(request.format);
          } else {
            expect(reviewPrompt.hostQuestionReview.proposedQuestions).toEqual([
              expect.objectContaining({ question: "Учитывать ли вскрышу?" })
            ]);
            expect(JSON.stringify(reviewRequest.format)).toContain('"questionDisposition"');
          }
        }
      }
      expect(builder.getRevision()).toBe(revision);
      expect(builder.getProject()).toEqual(initial);
    }
  );

  it("reviews the original brief and actual root dependencies before finishing a new tree", async () => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "run.request_finish", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"c".repeat(64)}`), () => ({
      constructingTree: true, projectReadyForFinish: true,
      rootDependencyInputs: [{ id: "count", value: 4, valueStatus: "user_provided_value", sourceNote: "4 machines" }]
    }));
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: [], brief: { prompt: "4 machines; 10 trucks", businessContext: "Original context" } } });
    await complete({ type: "tool_results", results: [] });
    const request = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    const current = JSON.parse(request.messages.at(-1).content);
    expect(current.finalBusinessReview).toMatchObject({
      originalBrief: { prompt: "4 machines; 10 trucks", businessContext: "Original context" },
      unrepresentedLiteralQuantities: [{ value: 10, quote: "10 trucks" }]
    });
    expect(current.hostObservation.rootDependencyInputs).toHaveLength(1);
  });

  it("transports current-revision verification progress while preserving the selected model and thinking", async () => {
    const output = { turnId: "turn", sessionState: "Check", assistantMessage: null, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "vdt.validate", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    let revision = 4;
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"c".repeat(64)}`, true), () => ({
      revision, constructingTree: true, needsStructure: false, projectReadyForFinish: true
    }));
    const checks = ["vdt.validate", "vdt.calculate", "vdt.inspect_hierarchy"];
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: [...checks, "run.request_finish"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } });
    await complete({ type: "tool_results", results: checks.map((toolName) => ({
      toolName, status: "succeeded", resultHash: `sha256:${"d".repeat(64)}`, payload: { output: toolName === "vdt.calculate" ? { rootValue: 2000, errors: [] } : { valid: true, errors: [] } }
    })) });
    revision = 5;
    await complete({ type: "tool_results", results: [] });
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    for (const body of bodies) expect(body).toMatchObject({ model: "chosen-local-model", think: true });
    const workflows = bodies.map((body) => JSON.parse(body.messages.at(-1).content).hostObservation.verificationWorkflow);
    expect(workflows).toEqual([
      { revision: 4, completed: [], pending: checks, nextStep: "run_checks" },
      { revision: 4, completed: checks, pending: [], nextStep: "request_finish" },
      { revision: 5, completed: [], pending: checks, nextStep: "run_checks" }
    ]);
    expect(JSON.stringify(bodies[0].format)).not.toContain('"const":"run.request_finish"');
    expect(JSON.stringify(bodies[1].format)).toContain('"const":"run.request_finish"');
    expect(JSON.stringify(bodies[2].format)).not.toContain('"const":"run.request_finish"');
  });

  it("keeps discovered skill IDs and argument guides in later native requests without replaying a full conversation", async () => {
    const output = { turnId: "turn", sessionState: "Continue", assistantMessage: null, action: { type: "action_batch", batch: {
      calls: [{ externalCallId: "call", toolName: "skill.list", args: {} }]
    } } };
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "qwen3:4b-instruct", `sha256:${"b".repeat(64)}`));
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await complete({ type: "initial_context", context: { tools: ["tools.describe", "skill.list", "skill.read"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } });
    const readSchema = { type: "object", properties: { skillId: { type: "string" } }, required: ["skillId"] };
    await complete({ type: "tool_results", results: [
      { toolName: "tools.describe", status: "succeeded", payload: { output: { tools: [{ name: "skill.read", inputJsonSchema: readSchema }] } } },
      { toolName: "skill.list", status: "succeeded", payload: { output: { skills: [{ id: "actual_skill", title: "Actual returned skill" }] } } }
    ] });
    await complete({ type: "tool_results", results: [] });
    const request = JSON.parse(String((fetcher.mock.calls[2] as unknown as [string, RequestInit])[1].body));
    const current = JSON.parse(request.messages.at(-1).content);
    expect(current.confirmedKnowledge).toMatchObject({
      discoveredSkills: { entries: [{ id: "actual_skill" }] }, toolArgumentGuides: { entries: [{ name: "skill.read", inputJsonSchema: readSchema }] }
    });
    expect(request.messages).toHaveLength(4);
  });

  it("opens ordinary native construction after a confirmed no-applicable-skill result", async () => {
    const steps = ["skill.list", "skill.report_gap", "skill.report_gap", "vdt.add_driver"];
    let turn = 0;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify({
      turnId: "turn", sessionState: "Resolve guidance", assistantMessage: null, action: { type: "action_batch", batch: {
        calls: [{ externalCallId: "call", toolName: steps[turn++], args: {} }]
      } }
    }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"d".repeat(64)}`),
      () => ({ constructingTree: true, needsStructure: true }));
    const complete = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    const toolResult = (toolName: string, status: string, output: unknown) =>
      ({ type: "tool_results", results: [{ toolName, status, payload: { output } }] });
    await complete({ type: "initial_context", context: {
      brief: { mode: "generate_vdt", skillResolution: "agent_semantic", rootKpi: "Available benches", unit: "benches", timePeriod: "shift" },
      tools: ["skill.list", "skill.report_gap", "skill.compile_recipe", "vdt.add_driver"].map((name) => ({ name, inputJsonSchema: { type: "object" } }))
    } });
    await complete(toolResult("skill.list", "succeeded", { skills: [], nextOffset: null }));
    await complete(toolResult("skill.report_gap", "failed", { outcome: "no_applicable_skill" }));
    await complete(toolResult("skill.report_gap", "succeeded", { outcome: "no_applicable_skill" }));
    const requests = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    const current = requests.map((body) => JSON.parse(body.messages.at(-1).content));
    expect(current.map((prompt) => prompt.toolSchemasAvailable)).toEqual(steps.map((step) => [step]));
    expect(current[3].hostObservation.skillResolution).toMatchObject({ catalogBrowsed: true, gapReported: true });
    expect(JSON.stringify(requests[3].format)).not.toContain('"const":"skill.compile_recipe"');
  });

  it("reviews a redundant construction confirmation once and returns the model's own repair without a user answer", async () => {
    const question = { turnId: "turn", sessionState: "Ask", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "plan", question: "Should I repair my plan to match your request?", reason: "Scope needs clarification.", required: true
    }] } };
    const repair = { turnId: "turn", sessionState: "Repair plan", assistantMessage: null, action: { type: "action_batch", batch: { calls: [{
      externalCallId: "repair", toolName: "vdt.set_decomposition_plan", args: { plan: { version: 1, goal: "User scope", nodes: [{ nodeId: "quantity", parentNodeId: "root", kind: "input" }] } }
    }] } } };
    let nativeCalls = 0;
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition: "continue_work", ...repair }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"e".repeat(64)}`, true), () => ({
      revision: 4, constructingTree: true, needsStructure: false, hasDecompositionPlan: true
    }));
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId: "exchange-1-4", delta: { type: "tool_results", results: [] } }) });
    expect(result).toEqual(repair);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    for (const body of bodies) expect(body).toMatchObject({ model: "chosen-local-model", think: true });
    const branches = bodies[1].format.anyOf;
    expect(branches.map((branch: { properties: { questionDisposition: { const: string } } }) => branch.properties.questionDisposition.const)).toEqual(["continue_work", "ask_user"]);
    expect(branches[0].properties.turnId).toEqual(bodies[0].format.properties.turnId);
    expect(JSON.stringify(branches[0].properties.action)).not.toContain('"const":"question"');
    expect(branches[1].properties.action.anyOf.map((action: { properties: { type: { const: string } } }) => action.properties.type.const)).toEqual(["question"]);
    const review = JSON.parse(bodies[1].messages.at(-1).content);
    expect(review).toMatchObject({ exchangeId: "exchange-1-4", delta: { type: "tool_results", results: [] }, hostQuestionReview: {
      proposedQuestions: [{ question: "Should I repair my plan to match your request?" }]
    } });
    expect(review).not.toHaveProperty("answer");
    expect(review).not.toHaveProperty("human_inputs");
  });

  it("gives structural question review first authority over a Skill's repeated scope question", async () => {
    const turn = { turnId: "turn", sessionState: "Review scope", assistantMessage: null };
    const call = (toolName: string, args: object) => ({
      ...turn, action: { type: "action_batch", batch: { calls: [{ externalCallId: "scope", toolName, args }] } }
    });
    const list = call("skill.list", { offset: 0 });
    const search = call("skill.search", { query: "Serial process capacity" });
    const draft = { ...turn, action: { type: "question", messageId: "draft", questionSetId: "questions", questions: [{
      id: "scope", question: "Do the stages run in series or independently?", reason: "The Skill suggests checking both cases.", required: true
    }] } };
    const outputs = [list, draft, { questionDisposition: "continue_work", ...search }];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(outputs.shift()) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-model", `sha256:${"e".repeat(64)}`, false),
      () => ({ constructingTree: true, needsStructure: true, nodeCount: 1, readinessPurpose: "structural_model" }));
    const run = (delta: object) => provider.completeStructured({ taskType: "agent_decision", input: {},
      schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await run({ type: "initial_context", context: {
      brief: { outcome: "structural_model", skillResolution: "agent_semantic", prompt: "Model the throughput of two stages." },
      tools: ["skill.list", "skill.search", "skill.report_gap"].map(name => ({ name, inputJsonSchema: { type: "object" } }))
    } });
    const answer = { type: "user_answer", questionSetId: "earlier", answers: { process_relationship: "Every item goes through both stages, without a bypass." } };
    await expect(run({ type: "checkpoint_inputs", inputs: [answer], checkpointDelta: { type: "tool_results", results: [{
      toolName: "skill.list", status: "succeeded", resultCode: "OK", externalCallId: "scope-list",
      payload: { output: { skills: [], nextOffset: null } }
    }] } })).resolves.toEqual(search);
    const messages = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).messages);
    expect(messages[1][0].content).toContain("a confirmed fact satisfies its check");
    expect(messages[2][0].content).toContain("Review the proposed questions before they reach the user.");
    expect(messages[2][0].content).toContain("different, still-unresolved business fact");
    expect(JSON.parse(messages[2].at(-1).content)).toMatchObject({
      confirmedKnowledge: { recentUserAnswers: [answer] },
      hostQuestionReview: { proposedQuestions: [{ question: draft.action.questions[0]?.question }] }
    });
  });

  it.each([true, false])("preserves a genuine missing-fact question after one review (constructing=%s)", async (constructingTree) => {
    const question = { turnId: "turn", sessionState: "Need fact", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "period", question: "Which reporting period should the model use?", reason: "Scope needs clarification.", required: true
    }] } };
    let nativeCalls = 0;
    const fetcher = vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition: "ask_user", ...question }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"f".repeat(64)}`), () => ({
      revision: 0, constructingTree, needsStructure: false
    }));
    const delta = constructingTree ? { type: "initial_context", context: {
      brief: { outcome: "structural_model", prompt: "Model the throughput." }, tools: []
    } } : { type: "tool_results", results: [] };
    const result = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    expect(result).toEqual(question);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const reviewSystemPrompt = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body)).messages[0].content;
    expect(reviewSystemPrompt.includes("Review the proposed questions before they reach the user.")).toBe(constructingTree);
  });

  it.each([undefined, "continue_work", "unknown"])("rejects a question with an inconsistent review disposition %s instead of inventing consent", async (questionDisposition) => {
    const question = { turnId: "turn", sessionState: "Question", assistantMessage: null, action: { type: "question", messageId: "ask", questionSetId: "questions", questions: [{
      id: "period", question: "Which period?", reason: "Scope needs clarification.", required: true
    }] } };
    let nativeCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ done: true, message: { content: JSON.stringify(++nativeCalls === 1 ? question : { questionDisposition, ...question }) } })));
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "chosen-local-model", `sha256:${"f".repeat(64)}`), () => ({
      revision: 0, constructingTree: true, needsStructure: false
    }));
    await expect(provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "tool_results", results: [] } }) })).rejects.toThrow("inconsistent disposition");
    expect(nativeCalls).toBe(2);
  });

  it.each(["  Every tonne passes through both stages in order.  ", "  Each stage handles a disjoint stream independently.  "])(
    "audits an unsettled serial or parallel relationship before skill discovery and retains the exact answer (%s)", async (answer) => {
    const prompt = "I run two processing stages and want sustained throughput in tonnes per hour. I do not have their measured rates.";
    const toolTurn = { turnId: "exchange-2", sessionState: "Review guidance", assistantMessage: null,
      action: { type: "action_batch", batch: { calls: [{ externalCallId: "exchange-2:call:1", toolName: "skill.list", args: {} }] } } };
    const replies = [{ relationship: "unresolved", question: { text: "Does the material go through both stages in order, or can either stage process it independently?",
      reason: "The way the stages are connected determines how their capacities affect throughput." } },
      { disposition: "material", userQuote: "I run two processing stages",
        alternatives: ["go through both stages in order", "can either stage process it independently"] },
      toolTurn, { ...toolTurn, turnId: "exchange-3" }];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(replies.shift()) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"a".repeat(64)}`),
      () => ({ constructingTree: true, needsStructure: true, nodeCount: 1, readinessPurpose: "structural_model" }));
    const complete = (exchangeId: string, delta: unknown) => provider.completeStructured({ taskType: "agent_decision",
      input: {}, schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId, delta }) });
    const question = modelAgentStructuredTurnSchema.parse(await complete("exchange-1", { type: "initial_context", context: {
      brief: { mode: "continue_project", outcome: "structural_model", prompt, rootKpi: "Sustained throughput", unit: "t/h", timePeriod: "monthly" },
      tools: ["skill.list"].map((name) => ({ name, inputJsonSchema: { type: "object" } }))
    } }));
    expect(question.action).toMatchObject({ type: "question", questionSetId: "exchange-1:relationships",
      questions: [{ id: "process_relationship", expectedAnswerType: "text" }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const humanInput = { type: "user_answer", questionSetId: "exchange-1:relationships", answers: { process_relationship: answer } };
    expect(await complete("exchange-2", { type: "human_inputs", inputs: [humanInput] })).toEqual(toolTurn);
    await complete("exchange-3", { type: "tool_results", results: [] });
    const requests = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(JSON.stringify(requests[0].format)).toContain('"relationship"');
    expect(JSON.parse(requests[0].messages.at(-1).content)).toEqual({ request: prompt, kpi: "Sustained throughput", unit: "t/h" });
    expect(requests[1].messages).toHaveLength(2);
    expect(JSON.parse(requests[1].messages.at(-1).content)).toEqual({ request: prompt, proposedQuestion: {
      text: "Does the material go through both stages in order, or can either stage process it independently?",
      reason: "The way the stages are connected determines how their capacities affect throughput."
    } });
    const latest = JSON.parse(requests[3].messages.at(-1).content);
    expect(latest.originalBrief.prompt).toBe(prompt);
    expect(latest.confirmedKnowledge.recentUserAnswers).toEqual([humanInput]);
  });

  it.each(["stated", "out_of_scope", "material", "unsupported", "unsupported_repeated_question", "unverified_quote", "invalid_review",
    "malformed_then_stated", "malformed_then_unresolved", "double_malformed", "unrelated_alternatives", "overlapping_alternatives"] as const)(
    "audits a proposed structural question without publishing an invented amount (%s)", async variant => {
      const prompt = "Build a monthly cost tree. Energy totaled USD 260 and materials totaled USD 510 for the month. Keep both measured totals editable.";
      const bogus = { relationship: "unresolved", question: {
        text: "Should we use USD 670 as the monthly cost or charge all costs per batch?",
        reason: "The scope of the charges determines how the costs combine."
      } };
      const clear = { relationship: "stated", userQuote: "Energy totaled USD 260 and materials totaled USD 510 for the month." };
      const material = { disposition: "material", userQuote: clear.userQuote, alternatives: ["the monthly cost", "all costs per batch"] };
      const toolTurn = { turnId: "exchange-1", sessionState: "Find relevant guidance", assistantMessage: null, action: {
        type: "action_batch", batch: { calls: [{ externalCallId: "exchange-1:call:1", toolName: "skill.list", args: {} }] }
      } };
      const malformed = variant.startsWith("malformed") || variant === "double_malformed";
      const audit = variant === "unverified_quote" ? { disposition: "stated", userQuote: "The user said 670." }
        : variant === "material" ? material
        : variant === "unrelated_alternatives" ? { ...material, alternatives: ["Yearly allocations", "Ignoring energy"] }
        : variant === "overlapping_alternatives" ? { ...material, alternatives: ["the monthly cost", "monthly cost"] }
        : variant === "invalid_review" ? {}
        : variant.startsWith("unsupported") ? { disposition: "unsupported" } : { disposition: variant, userQuote: clear.userQuote };
      const assessment = variant === "unrelated_alternatives" || variant === "overlapping_alternatives"
        ? { ...bogus, question: { ...bogus.question, text: "Should we use the monthly cost or charge all costs per batch?" } } : bogus;
      const questionTurn = { ...toolTurn, action: { type: "question", messageId: "question", questionSetId: "questions",
        questions: [{ id: "scope", question: bogus.question.text, reason: bogus.question.reason,
          required: true, expectedAnswerType: "text" }] } };
      const replies = variant === "unsupported_repeated_question" ? [assessment, audit, questionTurn, questionTurn]
        : malformed ? [{}, variant === "malformed_then_stated" ? clear : variant === "double_malformed" ? {} : bogus, toolTurn]
        : [assessment, audit, toolTurn];
      const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(replies.shift()) } }));
      vi.stubGlobal("fetch", fetcher);
      const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "bound-local-model", `sha256:${"a".repeat(64)}`),
        () => ({ constructingTree: true, needsStructure: true, nodeCount: 1, readinessPurpose: "structural_model" }));
      const result = provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
        systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId: "exchange-1", delta: { type: "initial_context", context: {
          brief: { mode: "continue_project", outcome: "structural_model", prompt, skillResolution: "agent_semantic" },
          tools: [{ name: "skill.list", inputJsonSchema: { type: "object" } }]
        } } }) });
      if (variant === "stated" || variant === "out_of_scope" || variant === "unsupported" || variant === "malformed_then_stated") {
        expect(await result).toEqual(toolTurn);
        expect(fetcher).toHaveBeenCalledTimes(3);
        const body = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
        expect(body.messages).toHaveLength(2);
        expect(JSON.stringify(body)).not.toContain("670");
        if (variant === "unsupported") expect(JSON.stringify(body.format)).not.toContain('"const":"question"');
      } else if (variant === "unsupported_repeated_question") {
        await expect(result).rejects.toThrow("invalid structured turn");
        expect(fetcher).toHaveBeenCalledTimes(4);
      } else {
        await expect(result).rejects.toThrow(variant === "double_malformed"
          ? "could not verify the structural relationship assessment" : "could not verify the structural clarification");
        expect(fetcher).toHaveBeenCalledTimes(2);
      }
      const auditBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
      expect(auditBody.messages).toHaveLength(2);
      expect(JSON.parse(auditBody.messages.at(-1).content)).toEqual(malformed
        ? { request: prompt, correction: expect.any(String) } : { request: prompt, proposedQuestion: assessment.question });
    }
  );

  it("reviews an invalid first structural plan in the same exchange before its corrected call can run", async () => {
    const root = "sustained_output";
    const stageA = { nodeId: "stage_a", parentNodeId: null, kind: "input" };
    const stageB = { nodeId: "stage_b", parentNodeId: null, kind: "input" };
    const turn = (nodes: unknown[]) => ({ turnId: "first-plan", sessionState: "Plan the editable factors", assistantMessage: null,
      action: { type: "action_batch", batch: { calls: [{ externalCallId: "plan", toolName: "vdt.set_decomposition_plan",
        args: { plan: { version: 1, goal: "Output", nodes } } }] } } });
    const replies = [turn([{ nodeId: root, parentNodeId: "null", kind: "calculated", sharedWith: ["missing"] }, stageA, stageB]),
      turn([stageA, stageB])];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, message: { content: JSON.stringify(replies.shift()) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"d".repeat(64)}`),
      () => ({ rootNodeId: root, constructingTree: true, needsStructure: true, nodeCount: 1,
        readinessPurpose: "structural_model", hierarchyRequired: true, hasDecompositionPlan: false }));
    const actual = await provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ delta: { type: "initial_context", context: {
        brief: { outcome: "structural_model", prompt: "Build a structure for a single flow through two stages." },
        tools: [{ name: "vdt.set_decomposition_plan", inputJsonSchema: { type: "object" } }]
      } } }) });
    expect(actual).toEqual(turn([{ ...stageA, parentNodeId: root }, { ...stageB, parentNodeId: root }]));
    const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const review = JSON.parse(body.messages.at(-1).content);
    expect(review).toMatchObject({ exchangeId: "first-plan", rootNodeId: root, planReview: {
      issues: expect.arrayContaining([`PLAN_DUPLICATE_NODE: ${root}`])
    } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("uses at most one adaptive setting transition on a checked semantic plan repair (opted in: %s)", async optedIn => {
    const root = "root_output";
    const input = { nodeId: "observed_factor", parentNodeId: null, kind: "input" };
    const operandless = { nodeId: "unbound_total", parentNodeId: null, kind: "calculated" };
    const turn = (id: string, nodes: unknown[]) => ({ turnId: id, sessionState: "Plan editable factors", assistantMessage: null,
      action: { type: "action_batch", batch: { calls: [{ externalCallId: id, toolName: "vdt.set_decomposition_plan",
        args: { plan: { version: 1, goal: "Output", nodes } } }] } } });
    const replies = [turn("first", [input, operandless]), turn("first", [input]),
      turn("followup", [input, operandless]), turn("followup", [input])];
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ done: true, prompt_eval_count: 325, eval_count: 49,
      message: { content: JSON.stringify(replies.shift()), thinking: "never retain this private text" } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "qualified-model", `sha256:${"d".repeat(64)}`, false, undefined,
      optedIn ? { start: false, repair: "low" } : undefined);
    const record = vi.fn();
    const provider = createLocalModelAgentProvider(binding, () => ({
      rootNodeId: root, constructingTree: true, needsStructure: true, nodeCount: 1,
      readinessPurpose: "structural_model", hierarchyRequired: true, hasDecompositionPlan: false
    }), undefined, record);
    const run = (delta: unknown) => provider.completeStructured({ taskType: "agent_decision", input: {},
      schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: JSON.stringify({ delta }) });
    await expect(run({ type: "initial_context", context: {
      brief: { outcome: "structural_model", prompt: "Build an editable structure for the measured output." },
      tools: [{ name: "vdt.set_decomposition_plan", inputJsonSchema: { type: "object" } }]
    } })).resolves.toEqual(turn("first", [{ ...input, parentNodeId: root }]));
    await expect(run({ type: "human_input", input: { type: "user_instruction", text: "Continue with the same measurement." } }))
      .resolves.toEqual(turn("followup", [{ ...input, parentNodeId: root }]));
    const requests = fetcher.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) }));
    expect(requests).toHaveLength(4);
    expect(requests.every(({ url, body }) => url === "http://127.0.0.1:11434/api/chat" && body.model === binding.modelId)).toBe(true);
    expect(requests.map(({ body }) => body.think)).toEqual(optedIn ? [false, "low", false, false] : [false, false, false, false]);
    expect(record).toHaveBeenCalledTimes(optedIn ? 1 : 0);
    if (optedIn) {
      expect(record).toHaveBeenCalledWith({ reason: "initial_plan_semantic_repair", previousLevel: false, effectiveLevel: "low",
        result: "valid_plan_proposal", elapsedMs: expect.any(Number), attempts: 1, inputUnits: 325, outputUnits: 49 });
      expect(JSON.stringify(record.mock.calls)).not.toContain("never retain this private text");
    }
  });

  it("does not raise the selected setting after provider unavailability", async () => {
    const output = { turnId: "turn", sessionState: "Review", assistantMessage: null,
      action: { type: "question", messageId: "question", questionSetId: "questions", questions: [
        { id: "goal", question: "Which KPI?", reason: "Scope needs clarification.", expectedAnswerType: "text", required: true }
      ] } };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ done: true, message: { content: JSON.stringify(output) } }));
    vi.stubGlobal("fetch", fetcher);
    const binding = createLocalModelAgentBinding("ollama", "qualified-model", `sha256:${"d".repeat(64)}`, false, undefined,
      { start: false, repair: true });
    const record = vi.fn();
    const provider = createLocalModelAgentProvider(binding, undefined, undefined, record);
    const complete = () => provider.completeStructured({ taskType: "agent_decision", input: {},
      schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: "Clarify goal" });
    await expect(complete()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(complete()).resolves.toEqual(output);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).think)).toEqual([false, false]);
    expect(record).not.toHaveBeenCalled();
  });

  it("uses a compact specialist decision and excludes declined guidance after a structural gap", async () => {
    const specialty = "special.field_scope";
    const contentHash = `sha256:${"d".repeat(64)}`;
    const steps = ["skill.list", "skill.search", "skill.read", "skill.report_gap", "vdt.set_decomposition_plan"];
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      const position = index++;
      return Response.json({ done: true, message: { content: JSON.stringify({ turnId: `turn-${position}`, sessionState: "Next",
        assistantMessage: position === 0 ? { messageId: "opening", text: "I’ll build the factor tree." } : null,
        action: { type: "action_batch", batch: { calls: [{ externalCallId: `call-${position}`, toolName: steps[position], args: {} }] } }
      }) } });
    });
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", contentHash),
      () => ({ constructingTree: true, needsStructure: true, nodeCount: 1, readinessPurpose: "structural_model",
        hierarchyRequired: true, hasDecompositionPlan: false, rootNodeId: "root" }));
    const complete = (delta: unknown, exchangeId?: string) => provider.completeStructured({ taskType: "agent_decision", input: {},
      schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: JSON.stringify({ delta, exchangeId }) });
    const result = (toolName: string, output: unknown) => ({ type: "tool_results", results: [{
      toolName, status: "succeeded", resultCode: "OK", externalCallId: `call-${toolName}`, payload: { output }
    }] });
    await complete({ type: "initial_context", context: { brief: { outcome: "structural_model", skillResolution: "agent_semantic",
      prompt: "Model overall throughput for two processing stages." },
      tools: [...steps, "skill.select"].map((name) => ({ name, inputJsonSchema: { type: "object" } })) } });
    const answer = { type: "user_answer", questionSetId: "questions", answers: { process_relationship: "Each unit goes through both stages." } };
    await complete({ type: "checkpoint_inputs", inputs: [answer], checkpointDelta: result("skill.list", {
      skills: [{ id: specialty, title: "Specialist scope", scopeGuidance: ["Requires a particular specialty."] },
        { id: "unrelated.scope", title: "Unrelated catalog card" }], nextOffset: null
    }) }, "exchange-2");
    await complete(result("skill.search", { candidates: [{ id: specialty, version: 1, contentHash }] }), "exchange-3");
    await complete(result("skill.read", { id: specialty, version: 1, contentHash, readReceiptId: "read-1",
      excerpt: "Guidance for a particular specialty.", formulaTemplates: ["Do not copy this specialist formula."]
    }), "exchange-4");
    await complete(result("skill.report_gap", { outcome: "no_applicable_skill" }), "exchange-5");
    const requests = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests.map((request) => request.messages.length)).toEqual([2, 2, 2, 2, 2]);
    const catalog = requests[1].messages.at(-1).content;
    expect(catalog.match(/Specialist scope/g)).toHaveLength(1);
    expect(catalog).toContain("Unrelated catalog card");
    expect(JSON.parse(catalog).confirmedKnowledge.recentUserAnswers).toEqual([answer]);
    const scoped = requests[2].messages.at(-1).content;
    expect(scoped).not.toContain("Unrelated catalog card");
    expect(JSON.parse(scoped).confirmedKnowledge.discoveredSkills.entries).toMatchObject([{ id: specialty }]);
    const read = JSON.parse(requests[3].messages.at(-1).content);
    expect(read).toMatchObject({ toolSchemasAvailable: ["skill.report_gap", "skill.select"],
      skillResolution: { gapAvailable: true, readReceipts: [{ skillId: specialty, readReceiptId: "read-1" }] },
      confirmedKnowledge: { readSkills: [{ id: specialty, scopeExcerpt: "Guidance for a particular specialty." }] }
    });
    const construction = requests[4].messages.at(-1).content;
    expect(requests[4].messages[0].content).toContain("Record the smallest editable decomposition");
    expect(requests[4].messages[0].content).toContain("lowest capacity limits that flow");
    expect(JSON.parse(construction).confirmedKnowledge.recentUserAnswers).toEqual([answer]);
    expect(construction).not.toContain("Specialist scope");
    expect(construction).not.toContain("Guidance for a particular specialty.");
    expect(construction).not.toContain("Do not copy this specialist formula.");
  });

  it.each(["fresh", "mixed", "replayed", "executable"] as const)(
    "narrows the initial selected Skill plan only with uncomplicated current evidence (%s)", async variant => {
      const skillId = "method.line_output";
      const contentHash = `sha256:${"a".repeat(64)}`;
      const skill = { id: skillId, version: 2, contentHash };
      const unrelated = { id: "unrelated.method", title: "Unrelated discovery card" };
      const tools = ["skill.list", "skill.search", "skill.read", "skill.select", "vdt.set_decomposition_plan",
        "tools.describe", "data.list_sources", "vdt.inspect_hierarchy"].map(name => ({
        name, inputJsonSchema: { type: "object", properties: { skillId: { type: "string" } } }
      }));
      const stages = ["skill.list", "skill.search", "skill.read", "skill.select", "tools.describe", "data.list_sources"];
      let index = 0;
      const fetcher = vi.fn<typeof fetch>(async () => {
        const toolName = stages[index++];
        return Response.json({ done: true, message: { content: JSON.stringify({
          turnId: "turn", sessionState: "Next", assistantMessage: null,
          action: { type: "action_batch", batch: { calls: [{ externalCallId: "call", toolName, args: {} }] } }
        }) } });
      });
      vi.stubGlobal("fetch", fetcher);
      const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", contentHash, false),
        () => ({ constructingTree: true, needsStructure: true, nodeCount: 1, readinessPurpose: "structural_model",
          hierarchyRequired: true, hasDecompositionPlan: false, rootNodeId: "root", revision: 4 }));
      const prompt = "Build an editable shift output model. The line records 4 transfers per hour.";
      const complete = (delta: object, exchangeId?: string) => provider.completeStructured({ taskType: "agent_decision", input: { exchangeId },
        schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT",
        userPrompt: JSON.stringify({ exchangeId, delta, sessionContinuation: { state: "Prior catalog chatter" } }) });
      const result = (toolName: string, output: object, status = "succeeded") => ({ type: "tool_results", results: [{
        toolName, status, resultCode: "OK", resultHash: contentHash, externalCallId: `call-${toolName}`, payload: { output }
      }] });
      await complete({ type: "initial_context", context: { brief: { outcome: "structural_model", skillResolution: "agent_semantic",
        prompt, unit: "transfers/h", options: { researchMode: "off" } }, tools } });
      await complete(result("skill.list", { skills: [skill, unrelated], nextOffset: null }), "list");
      await complete(result("skill.search", { candidates: [skill] }), "search");
      await complete(result("skill.read", { ...skill, readReceiptId: "read-exact", excerpt: "Exact method scope.",
        formulaTemplates: ["Output is the measured rate."], ...(variant === "executable" ? { executableTopology: { defaultInputs: [] } } : {})
      }), "read");
      const selection = result("skill.select", { selectedSkill: skill }, variant === "replayed" ? "replayed" : "succeeded");
      await complete(variant === "mixed" ? { type: "checkpoint_inputs", checkpointDelta: selection, inputs: [
        { type: "user_instruction", text: "Please confirm the reporting boundary." }
      ] } : selection, "plan");
      const firstPlan = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body));
      const context = JSON.parse(firstPlan.messages.at(-1).content);
      expect(context.toolSchemasAvailable).toContain("vdt.set_decomposition_plan");
      if (variant !== "fresh") {
        expect(context.selectedMethod).toBeUndefined();
        expect(context.toolSchemasAvailable).toContain("vdt.inspect_hierarchy");
        return;
      }
      expect(context).toMatchObject({ originalBrief: { prompt, unit: "transfers/h" },
        hostObservation: { rootNodeId: "root", revision: 4 },
        selectedMethod: { ...skill, readReceiptId: "read-exact", excerpt: "Exact method scope.", formulaTemplates: ["Output is the measured rate."] },
        toolSchemasAvailable: ["vdt.set_decomposition_plan", "tools.describe", "data.list_sources"] });
      expect(firstPlan.messages).toHaveLength(2);
      expect(firstPlan.messages[0].content).toContain("kind=input");
      expect(firstPlan.messages.at(-1).content).not.toMatch(/Unrelated discovery card|Prior catalog chatter/u);
      expect(JSON.stringify(firstPlan.format)).toContain('"const":"question"');
      await complete(result("tools.describe", { tools: [] }), "inspect");
      const afterInspection = JSON.parse(String(fetcher.mock.calls[5]?.[1]?.body));
      expect(JSON.parse(afterInspection.messages.at(-1).content).toolSchemasAvailable).toContain("vdt.inspect_hierarchy");
    }
  );

  it("returns a refused structural Skill gap to the selected model with a current search available", async () => {
    const hash = `sha256:${"f".repeat(64)}`;
    const steps = ["skill.list", "skill.search", "skill.report_gap", "skill.search"];
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      const position = index++;
      const toolName = steps[position];
      return Response.json({ done: true, message: { content: JSON.stringify({
        turnId: `exchange-${position}`, sessionState: "Review Skill scope", assistantMessage: position === 0
          ? { messageId: "opening", text: "I’ll check the Skill catalog." } : null,
        action: { type: "action_batch", batch: { calls: [{ externalCallId: `call-${position}`, toolName, args: {} }] } }
      }) } });
    });
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", hash), () => ({
      constructingTree: true, needsStructure: true, readinessPurpose: "structural_model"
    }));
    const complete = (delta: unknown, position: number) => provider.completeStructured({ taskType: "agent_decision", input: {},
      schema: modelAgentStructuredTurnSchema, systemPrompt: "VDT", userPrompt: JSON.stringify({ delta, exchangeId: `exchange-${position}` }) });
    const result = (toolName: string, output: unknown) => ({ type: "tool_results", results: [{
      toolName, status: "succeeded", resultCode: "OK", resultHash: hash, externalCallId: `call-${toolName}`, payload: { output }
    }] });
    await complete({ type: "initial_context", context: { brief: { outcome: "structural_model", skillResolution: "agent_semantic",
      prompt: "Model weekly warranty claims." }, tools: [...new Set(steps)].map(name => ({ name, inputJsonSchema: { type: "object" } })) } }, 0);
    await complete(result("skill.list", { skills: [], nextOffset: null }), 1);
    await complete(result("skill.search", { candidates: [] }), 2);
    const correction = "Include only the claims accepted by our warranty team.";
    const message = "Finish browsing the catalog, search the current user scope, and read each returned Skill before reporting a gap.";
    await complete({ type: "checkpoint_inputs", inputs: [{ type: "user_instruction", text: correction }],
      checkpointDelta: { type: "tool_results", results: [{
        toolName: "skill.report_gap", status: "failed", externalCallId: "call-2", resultCode: "SKILL_CATALOG_REVIEW_REQUIRED",
        resultHash: hash, payload: { error: { message } }
      }] }
    }, 3);
    const request = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(JSON.parse(request.messages.at(-1).content)).toMatchObject({
      latestUserInstruction: correction, rejectedSkillGap: { code: "SKILL_CATALOG_REVIEW_REQUIRED", message },
      toolSchemasAvailable: ["skill.search"]
    });
  });

  it.each([true, false])("retries a bare decomposition assumption envelope once (corrected=%s)", async (corrected) => {
    const args = { nodeId: "throughput", statement: "Every tonne passes through both stages.", changesConclusionWhen: "The stages work independently.",
      source: "user_provided", timestamp: "2026-11-25T09:00:00Z" };
    const turn = { turnId: "exchange-2", sessionState: "Record relationship", assistantMessage: null, action: {
      type: "action_batch", batch: { calls: [{ externalCallId: "exchange-2:call:1", toolName: "vdt.set_decomposition_assumption", args }] }
    } };
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => Response.json({ done: true, message: { content: JSON.stringify(args) } }))
      .mockImplementationOnce(async () => Response.json({ done: true, message: { content: JSON.stringify(corrected ? turn : args) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"a".repeat(64)}`));
    const result = provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId: "exchange-2", delta: { type: "tool_results", results: [] } }) });
    if (corrected) await expect(result).resolves.toEqual(turn);
    else await expect(result).rejects.toThrow(/turnId/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [first, retry] = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(retry.format).toEqual(first.format);
    expect(retry.messages.at(-1).content).toContain("no action was accepted");
    expect(retry.messages.at(-1).content).not.toContain(args.statement);
  });

  it("reviews routine saved-workspace confirmation and preserves the requested operation and Gateway approvals", async () => {
    const question = { turnId: "exchange-2", sessionState: "Confirm", assistantMessage: null, action: {
      type: "question", messageId: "ask", questionSetId: "questions", questions: [
        { id: "save", question: "Should I save Version A now?", reason: "I want to confirm the save.", required: true }
      ] } };
    const action = { ...question, action: { type: "action_batch", batch: { calls: [{
      externalCallId: "exchange-2:call:1", toolName: "version.edit", args: { kind: "save", name: "Version A" }
    }] } } };
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => Response.json({ done: true, message: { content: JSON.stringify(question) } }))
      .mockImplementationOnce(async () => Response.json({ done: true, message: { content: JSON.stringify({ questionDisposition: "continue_work", ...action }) } }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding("ollama", "test-model", `sha256:${"a".repeat(64)}`),
      () => ({ constructingTree: false, revision: 4 }));
    await expect(provider.completeStructured({ taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "VDT", userPrompt: JSON.stringify({ exchangeId: "exchange-2", delta: { type: "tool_results", results: [] } }) })).resolves.toEqual(action);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const review = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).messages.at(-1).content;
    expect(JSON.parse(review).hostQuestionReview.instruction).toContain("Keep Gateway approval requirements in force.");
    expect(JSON.parse(review).hostQuestionReview.instruction).not.toContain("plan.nodes");
  });

  it.each([
    ["ollama", "http://127.0.0.1:11434/api/chat"],
    ["lm_studio", "http://127.0.0.1:1234/v1/chat/completions"],
    ["vllm", "http://127.0.0.1:8000/v1/chat/completions"]
  ] as const)("sends %s to its fixed endpoint with an enforced turn schema and no cloud credential", async (backendId, endpoint) => {
    vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "cloud-secret-must-not-be-used");
    const output = {
      turnId: "first", sessionState: "Await user answer", assistantMessage: null,
      action: { type: "question", messageId: "message", questionSetId: "questions", questions: [{
        id: "shifts", question: "Сколько смен в сутки?", reason: "Scope needs clarification.", expectedAnswerType: "text", required: true
      }] }
    };
    const fetcher = vi.fn(async () => Response.json(backendId === "ollama"
      ? { done: true, message: { content: JSON.stringify(output) } }
      : { choices: [{ message: { content: JSON.stringify(output) } }] }));
    vi.stubGlobal("fetch", fetcher);
    const provider = createLocalModelAgentProvider(createLocalModelAgentBinding(backendId, "qwen3:8b", `sha256:${"a".repeat(64)}`));
    const result = await provider.completeStructured({
      taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "Follow the VDT tool catalog", userPrompt: "Build excavation tree", model: "qwen3:8b"
    });
    expect(result).toEqual(output);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.redirect).toBe("error");
    expect(init.headers).not.toHaveProperty("authorization");
    expect(init.body).not.toContain("cloud-secret");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen3:8b");
    const schema = backendId === "ollama" ? body.format : body.response_format.json_schema.schema;
    expect(schema).toMatchObject({ type: "object", required: ["turnId", "sessionState", "assistantMessage", "action"] });
    if (backendId === "ollama") {
      expect(body).toMatchObject({ stream: true, options: { num_predict: 4_096 } });
      expect([4_096, 8_192, 16_384]).toContain(body.options.num_ctx);
      expect(body).not.toHaveProperty("think");
      expect(body.options).not.toHaveProperty("temperature");
      expect(schema.properties.sessionState.maxLength).toBe(512);
      expect(body.messages[0].content).not.toContain("Required JSON response schema");
    } else {
      expect(body.response_format.type).toBe("json_schema");
    }
    if (backendId !== "ollama") expect(body.messages[0].content).toContain("Required JSON response schema");
    await provider.completeStructured({
      taskType: "agent_decision", input: {}, schema: modelAgentStructuredTurnSchema,
      systemPrompt: "Follow the VDT tool catalog", userPrompt: "Current checkpoint/tool results"
    });
    const continuation = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(continuation.messages[1]).toEqual({ role: "user", content: "Build excavation tree" });
    expect(continuation.messages.at(-1)).toEqual({ role: "user", content: "Current checkpoint/tool results" });
  });
});
