import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VdtAgentOutcome, VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { loadWorkspaceRequest } from "../../../../../../scripts/evaluate-agent-autonomy-workspace.mjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type ToolResult = { toolName: string; status: string; resultCode: string; payload: {
  output?: { nextOffset?: number | null; readReceiptId?: string }; receiptId?: string;
} };

const rootKpi = "Sustained throughput";
const dataDir = mkdtempSync(join(tmpdir(), "vdt-outcome-route-"));
const bindingId = "automatic_outcome_test_binding";

function request(url: string, body: object) {
  return new Request(`http://localhost:3000/api/agent/runs${url}`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
  });
}

describe("Automatic outcome through the public Supervisor", { timeout: 60_000 }, () => {
  let route: typeof import("./route");
  let runtime: typeof import("./runtime");
  let supervisor: typeof import("./supervisor-runtime");
  let messages: typeof import("./[runId]/messages/route");
  let dispose: (() => void) | undefined;
  let activeRun: string | undefined;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    [route, runtime, supervisor, messages] = await Promise.all([
      import("./route"), import("./runtime"), import("./supervisor-runtime"), import("./[runId]/messages/route")
    ]);
    dispose = runtime.agentExecutionBindingRegistry.register({
      bindingId, enabled: true, modelId: "automatic-outcome-fixture",
      capability: {
        schemaVersion: 1, executionProfile: "model_agent", engineId: "in-product-model-agent",
        engineAdapterId: "outcome-route-test-v1", backendId: "openai_compatible", protocolVersion: "structured-turn-v1",
        sessionStrategy: "structured_turn", toolCatalogHash: supervisor.currentModelAgentToolCatalogHash(),
        toolIsolation: "permission_only",
        qualification: { status: "unverified", platform: { os: "test", arch: "test", runtimeVersion: "node-test" }, testedAt: null, evidenceHash: null },
        supportsNativeSession: false, supportsResume: false, supportsStructuredEvents: true, supportsToolBridge: true,
        supportsQuestions: true, supportsCancellation: true, supportsUsageMetrics: false, cli: null
      },
      modelEngineAdapter: { providerId: "openai_compatible", providerConfig: {
        baseUrl: "https://outcome-fixture.example.test/v1", apiKey: "test-only"
      } }
    });
  });

  afterEach(async () => {
    if (activeRun && supervisor?.isStructuredModelAgentRunActive(activeRun)) {
      await supervisor.cancelStructuredModelAgentRun(activeRun, true);
    }
    activeRun = undefined;
  });

  afterAll(() => {
    dispose?.();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function installModelFixture(choose: (turn: { exchangeId: string; delta: { type: string; results?: ToolResult[] } }) => object) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
      const { messages } = JSON.parse(String(init?.body ?? ""));
      const userPrompt = messages.filter(({ role }: { role: string }) => role === "user").at(-1).content as string;
      const modelTurn = JSON.parse(userPrompt.split("\n\nThe previous response was invalid:", 1)[0]!);
      const action = choose(modelTurn);
      const output = {
        turnId: modelTurn.exchangeId,
        sessionState: "Fixture checkpoint",
        assistantMessage: modelTurn.delta.type === "initial_context"
          ? { messageId: `${modelTurn.exchangeId}:opening`, text: "I will check the requested work." }
          : null,
        action
      };
      return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const call = (turnId: string, toolName: string, args: object = {}) => ({
    type: "action_batch", batch: { calls: [{ externalCallId: `${turnId}:call`, toolName, args }] }
  });
  const ask = (turnId: string, question: string) => ({
    type: "question", messageId: `${turnId}:question`, questionSetId: `${turnId}:questions`,
    questions: [{ id: "process_relationship", question, reason: "The answer changes the model.", required: true, expectedAnswerType: "text" }]
  });
  const final = (turnId: string, finishReceiptId: string | undefined) => ({
    type: "final", messageId: `${turnId}:result`, finishReceiptId, text: "Completed the requested work."
  });

  async function start(prompt: string, outcome?: VdtAgentOutcome, project?: unknown, workspace?: VdtAgentStartRequest["workspace"]) {
    const response = await route.POST(request("", {
      executionBindingId: bindingId, mode: project ? "continue_project" : "generate_vdt",
      ...(outcome ? { outcome } : { outcomeSelection: "automatic" }),
      input: { prompt, ...(project ? { project } : {}) },
      workspace,
      options: { autoApplyPatches: true, researchMode: "off" }
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return (activeRun = body.runId as string);
  }

  it("fences a spoken answer to its exact question occurrence and consumes it only once", async () => {
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { createStorageWriteActor } = await import("../../vdt/storage-write-adapter");
    const { productionVolumeProject } = await import("@vdt-studio/vdt-core");
    const projectId = "voice_project", vdtId = "voice_vdt";
    const db = openVdtDatabase(process.cwd(), { dataDir });
    try {
      db.createProject({ id: projectId, name: "Voice checkpoint" });
      const generation = db.getProjectRuntimeState(projectId)!;
      db.createVdtWithInitialSnapshot({
        actor: createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } }),
        command: { schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId,
          expectedRuntimeGeneration: generation.runtimeGeneration, expectedGenerationVersion: generation.generationVersion,
          idempotencyKey: "voice-seed", vdt: { requestedVdtId: vdtId, name: "Voice checkpoint", rootKpi: "Production Volume",
            unit: null, timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Voice fixture", validation: null, calculation: null } },
        project: productionVolumeProject
      });
    } finally { db.close(); }

    let count = 0;
    const fetch = installModelFixture(({ exchangeId }) => ({ ...ask(exchangeId, ++count === 1 ? "What enters the plant?" : "What leaves the plant?"),
      questionSetId: "reused-question-set" }));
    const runId = await start("Explain the process scope.", "answer", productionVolumeProject, { projectId, vdtId });
    const state = () => runtime.agentRuntime.store.getState(runId);
    const event = () => state().events.slice().reverse().find(item => item.type === "clarifying_questions");
    await vi.waitFor(() => expect(event()).toBeDefined(), { timeout: 10_000 });
    const firstEventId = event()!.id;
    const target = { runId, projectId, vdtId, questionSetId: "reused-question-set",
      questionEventId: firstEventId, questionId: "process_relationship", turnId: randomUUID() };
    type Question = typeof target & { captureSessionId: string; recognitionProof: string };
    const submit = (expectedQuestion: Question, text = "Ore enters from the upstream plant") => messages.POST(request(`/${runId}/messages`, {
      type: "user_answer", expectedQuestion, structuredAnswers: [{ questionId: "process_relationship", fields: { answer: text } }]
    }), { params: Promise.resolve({ runId }) });
    const invented = { ...target, captureSessionId: randomUUID(), recognitionProof: randomUUID() };
    expect((await submit(invented)).status).toBe(409);
    expect(fetch).toHaveBeenCalledOnce();

    const { pcmWave } = await import("@vdt-studio/local-runner/speech-audio");
    const { getSpeechRuntime, SpeechRuntime } = await import("@vdt-studio/local-runner/speech");
    const speechRoute = await import("../../speech/route");
    const oldSpeech = getSpeechRuntime();
    const host = globalThis as typeof globalThis & { __vdtSpeechRuntime?: typeof oldSpeech };
    let recognized = "";
    const localSpeech = new SpeechRuntime({ platform: "darwin", arch: "arm64", recognize: async () => recognized });
    vi.spyOn(localSpeech, "status").mockResolvedValue({
      supported: true, engineReady: true, installedModels: ["base"],
      installation: { state: "ready", downloadedBytes: 0, totalBytes: 0 }
    });
    const speech = (body: object) => speechRoute.POST(new Request("http://localhost:3000/api/speech", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(body)
    }));
    const capture = async (answerCapture: typeof target, transcript: string): Promise<Question> => {
      recognized = transcript;
      const opened = await speech({ operation: "open_session", answerCapture, selection: {
        version: 1, scopeId: JSON.stringify([projectId, vdtId]), analytics: { mode: "legacy", providerId: "mock", modelId: null },
        language: "en", stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null
      } });
      expect(opened.status, await opened.clone().text()).toBe(200);
      const { sessionId } = await opened.json();
      const jobId = randomUUID();
      const submitted = await speech({ operation: "transcribe", sessionId, jobId,
        audioBase64: Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64") });
      expect(submitted.status).toBe(200);
      let recognitionProof = "";
      await vi.waitFor(async () => {
        const result = await speech({ operation: "result", sessionId, jobId });
        const body = await result.json();
        expect(body).toMatchObject({ state: "complete", text: transcript, recognitionProof: expect.any(String) });
        recognitionProof = body.recognitionProof;
      });
      return { ...answerCapture, captureSessionId: sessionId, recognitionProof };
    };
    const close = (value: Question) => speech({ operation: "close_session", sessionId: value.captureSessionId });
    host.__vdtSpeechRuntime = localSpeech;
    try {
      const cancelled = await capture({ ...target, turnId: randomUUID() }, "Ore enters from the upstream plant");
      await close(cancelled);
      expect((await submit(cancelled)).status).toBe(409);

      const checkpoint = await capture(target, "Ore enters from the upstream plant");
      expect((await submit({ ...checkpoint, vdtId: "other-vdt" })).status).toBe(409);
      expect((await submit(checkpoint, "25 tonnes")).status).toBe(409);
      expect((await submit(checkpoint, "This text did not come from recognition")).status).toBe(409);
      expect(fetch).toHaveBeenCalledOnce();
      const responses = await Promise.all([submit(checkpoint), submit(checkpoint)]);
      expect(responses.map(item => item.status).sort()).toEqual([200, 409]);
      await close(checkpoint);
      await vi.waitFor(() => expect(event()?.id).not.toBe(firstEventId), { timeout: 10_000 });
      expect(state().pendingQuestions?.[0]?.question).toBe("What leaves the plant?");
      expect((await submit(checkpoint)).status).toBe(409);
      expect((await submit({ ...checkpoint, questionEventId: event()!.id, turnId: randomUUID() })).status).toBe(409);
      expect(fetch).toHaveBeenCalledTimes(2);
      const next = await capture({ ...target, questionEventId: event()!.id, turnId: randomUUID() }, "Concentrate leaves the plant");
      expect((await submit(next, "Concentrate leaves the plant")).status).toBe(200);
      await close(next);
    } finally { host.__vdtSpeechRuntime = oldSpeech; }

  });

  it.each(["en", "ru"])("admits and persists a verified structure with missing inputs (%s)", async (locale) => {
    const fixture = await loadWorkspaceRequest("REV-01-structure", locale);
    const [brief, relationship, baseline] = fixture.turns.map(({ prompt }: { prompt: string }) => prompt);
    const driverIds = ["stage_a", "stage_b"];
    let pendingWrites = 0;
    installModelFixture(({ exchangeId: turnId, delta }) => {
      const tool = (name: string, args?: object) => call(turnId, name, args);
      const result = delta.results?.at(-1);
      const builder = activeRun && runtime.agentRuntime.store.has(activeRun) ? runtime.agentRuntime.store.getState(activeRun).builder : undefined;
      const parentNodeId = builder?.getProject().rootNodeId;
      if (delta.type === "initial_context") {
        return tool("vdt.create_draft", { projectTitle: rootKpi, rootKpi, unit: "t/h" });
      }
      if (result?.status === "failed" && result.toolName === "vdt.create_draft" && pendingWrites === 0) {
        pendingWrites++;
        expect(builder?.getRevision()).toBe(0);
        return ask(turnId, locale === "ru" ? "Как материал проходит между этапами?" : "How does material flow between stages?");
      }
      if (delta.type === "human_input") return tool("run.propose_outcome", {
        outcome: "structural_model", artifact: null, evidenceQuote: brief
      });
      switch (result?.toolName) {
        case "run.propose_outcome": return tool("skill.list");
        case "skill.list": {
          const offset = result.payload.output?.nextOffset;
          return offset == null ? tool("skill.report_gap", { reason: "No process-specific guidance matches this brief." }) : tool("skill.list", { offset });
        }
        case "skill.report_gap": return tool("vdt.create_draft", { projectTitle: rootKpi, rootKpi, unit: "t/h" });
        case "vdt.create_draft": return tool("vdt.set_decomposition_plan", { plan: {
          version: 1, goal: rootKpi, nodes: driverIds.map(nodeId => ({ nodeId, parentNodeId, kind: "input" }))
        } });
        case "vdt.set_decomposition_plan": return tool("vdt.add_drivers_batch", {
          drivers: driverIds.map(nodeId => ({ parentNodeId, nodeId, name: nodeId, unit: "t/h", type: "input" }))
        });
        case "vdt.add_drivers_batch": return tool("vdt.set_formula", { nodeId: parentNodeId, formula: "min(stage_a, stage_b)" });
        case "vdt.set_formula": return tool("run.request_finish");
        case "run.request_finish": return final(turnId, result.payload.receiptId);
        default: throw new Error(`Unexpected fixture turn: ${JSON.stringify(delta)}`);
      }
    });
    const runId = await start(brief);
    await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("needs_user_input"), { timeout: 10_000 });
    const preAdmission = runtime.agentRuntime.store.getState(runId);
    expect(preAdmission.pendingQuestions?.[0]?.id).toBe("process_relationship");
    expect(preAdmission.request.outcome).toBeUndefined();
    expect(preAdmission.draftProject).toBeUndefined();
    expect(preAdmission.workspaceRevision).toBeUndefined();
    const answered = await messages.POST(request(`/${runId}/messages`, {
      type: "user_answer", answers: { process_relationship: relationship }
    }), { params: Promise.resolve({ runId }) });
    expect(answered.status).toBe(200);
    await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("succeeded"), { timeout: 15_000 });
    const snapshot = await supervisor.compactSupervisorAwareSnapshot(runtime.agentRuntime.store.getSnapshot(runId));
    expect(pendingWrites).toBe(1);
    expect(snapshot.request.outcome).toBe("structural_model");
    expect(snapshot.finishOutcome).toMatchObject({
      state: "final_persisted", outcome: "structural_model", missingInputCount: 2
    });
    const { openAgentRunPersistenceDatabase } = await import("./persistence");
    const database = openAgentRunPersistenceDatabase(process.cwd());
    try {
      const storedRun = database.getAgentRun(runId);
      expect(storedRun?.vdtId).toBeTruthy();
      const head = database.getVdtRevisionHead(storedRun!.vdtId!);
      expect(head?.activeRevisionId).toBeTruthy();
      const revision = database.getVdtRevision(head!.activeRevisionId!);
      expect(revision).toBeDefined();
      const read = database.readVdtRevision(revision!);
      expect(read.graph.nodes.filter(({ valueStatus }) => valueStatus === "unknown")).toHaveLength(2);
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.request_finish");
        expect(delta.results?.at(-1)).toMatchObject({ toolName: "run.request_finish", status: "failed" });
        return ask(exchangeId, "What measured rates should I use?");
      });
      const projectRuntime = database.getProjectRuntimeState(head!.projectId)!;
      const numericalRunId = await start(baseline, "calculated_baseline", read, {
        projectId: head!.projectId,
        vdtId: head!.vdtId,
        expectedRevision: {
          expectedActiveRevisionId: head!.activeRevisionId,
          expectedActiveContentIdentity: head!.activeContentIdentity,
          expectedCommitGeneration: head!.commitGeneration,
          expectedRuntimeGeneration: projectRuntime.runtimeGeneration,
          expectedGenerationVersion: projectRuntime.generationVersion
        }
      });
      await vi.waitFor(() => expect(["needs_user_input", "recovery_required", "failed"])
        .toContain(runtime.agentRuntime.store.getState(numericalRunId).status), { timeout: 10_000 });
      const numericalState = runtime.agentRuntime.store.getState(numericalRunId);
      expect(numericalState.status, JSON.stringify(numericalState.events.slice(-5))).toBe("needs_user_input");
      const numerical = await supervisor.compactSupervisorAwareSnapshot(runtime.agentRuntime.store.getSnapshot(numericalRunId));
      expect(numerical.request.outcome).toBe("calculated_baseline");
      expect(numerical.finishOutcome).toBeUndefined();
    } finally {
      database.close();
      if (activeRun !== runId && activeRun) await supervisor.cancelStructuredModelAgentRun(activeRun, true);
    }
  });

  it("keeps the answer read-only and rejects a second goal proposal", async () => {
    const fixture = await loadWorkspaceRequest("REV-01-structure", "en");
    const prompt = fixture.turns[3].prompt;
    let blocked = 0;
    installModelFixture(({ exchangeId: turnId, delta }) => {
      const proposal = { outcome: "answer", artifact: null, evidenceQuote: prompt };
      if (delta.type === "initial_context") return call(turnId, "run.propose_outcome", proposal);
      const result = delta.results?.at(-1);
      if (result?.toolName === "run.propose_outcome" && result.status === "succeeded") {
        return call(turnId, "run.propose_outcome", { ...proposal, outcome: "structural_model" });
      }
      if (result?.toolName === "run.propose_outcome") {
        expect(result.status).toBe("failed");
        return call(turnId, "vdt.create_draft", { projectTitle: rootKpi, rootKpi, unit: "t/h" });
      }
      if (result?.toolName === "vdt.create_draft") {
        expect(result.status).toBe("failed");
        blocked++;
        return call(turnId, "run.request_finish");
      }
      return final(turnId, result?.payload.receiptId);
    });
    const runId = await start(prompt);
    await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("succeeded"), { timeout: 10_000 });
    const state = runtime.agentRuntime.store.getState(runId);
    expect(blocked).toBe(1);
    expect(state.request.outcome).toBe("answer");
    expect(state.finishOutcome?.outcome).toBe("answer");
    expect(state.workspaceRevision).toBeUndefined();
    expect(state.builder?.getRevision()).toBe(0);
  });

  it.each(["malformed", "mixed batch"])("asks for the goal on %s while keeping the project untouched", async (kind) => {
    const prompt = "Please work out what is useful here.";
    if (kind === "malformed") {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] })));
    } else {
      installModelFixture(({ exchangeId: turnId }) => ({
        type: "action_batch",
        batch: { calls: [
          { externalCallId: `${turnId}:goal`, toolName: "run.propose_outcome", args: { outcome: "structural_model", artifact: null, evidenceQuote: prompt } },
          { externalCallId: `${turnId}:write`, toolName: "vdt.create_draft", args: { projectTitle: rootKpi, rootKpi, unit: "t/h" } }
        ] }
      }));
    }
    const runId = await start(prompt);
    await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("needs_user_input"), { timeout: 10_000 });
    const state = runtime.agentRuntime.store.getState(runId);
    expect(state.request.outcome).toBeUndefined();
    expect(state.pendingQuestions?.[0]?.id).toBe("requested_outcome");
    expect(state.workspaceRevision).toBeUndefined();
    expect(state.builder?.getRevision()).toBe(0);
  });

  it.each(["en", "ru"])("downloads the exact retained named revision without changing the active VDT (%s)", async locale => {
    const { createVersionSnapshot, exportProjectExcel, productionVolumeProject } = await import("@vdt-studio/vdt-core");
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { describeExcelWorkbook } = await import("./excel-workbook");
    const { GET } = await import("./[runId]/excel-workbook/route");
    const projectId = `named_export_project_${locale}`, vdtId = `named_export_vdt_${locale}`;
    const name = locale === "ru" ? "Проверка линии" : "Line check";
    const citedTitle = name.toLocaleUpperCase();
    const prompt = locale === "ru"
      ? `Выгрузи книгу Excel для сценария Recovery из сохранённой версии «${citedTitle}».`
      : `Export an Excel workbook for Recovery from the saved version “${citedTitle}”.`;
    const recoveryId = "historic_recovery";
    const database = openVdtDatabase(process.cwd(), { dataDir });
    try {
      database.createProject({ id: projectId, name: "Named export fixture" });
      database.createVdt({ id: vdtId, projectId, name: "Named export fixture", rootKpi: "Output" });
      const source = structuredClone(productionVolumeProject);
      const baselineId = source.scenarios[0]!.id;
      source.scenarios = [source.scenarios[0]!, { ...source.scenarios[0]!, id: recoveryId, name: "Recovery", isMain: false },
        { ...source.scenarios[0]!, id: "historic_recovery_plan", name: "Recovery plan", isMain: false },
        { ...source.scenarios[0]!, id: "historic_recovery_suffix", name: "Recovery scenario", isMain: false }];
      const save = (revisionNo: number, project: typeof source, parentRevisionId?: string) => database.saveVdtRevision({
        id: `${vdtId}_${revisionNo}`, vdtId, projectId, revisionNo, source: "user", project, parentRevisionId
      });
      const initial = save(1, source);
      const named = createVersionSnapshot(source, { name }, { id: "version_line_check", createdAt: "2026-11-24T09:00:00.000Z" });
      const historical = save(2, named, initial.id);
      const headProject = structuredClone(named);
      headProject.graph.nodes.find(node => node.type === "input")!.baselineValue = 1234;
      headProject.scenarios = [source.scenarios[0]!, { ...source.scenarios[1]!, id: "current_recovery" }];
      const head = save(3, headProject, historical.id);
      async function start(text: string) {
        const response = await route.POST(request("", { executionBindingId: bindingId, mode: "continue_project",
          outcomeSelection: "automatic", workspace: { projectId, vdtId },
          input: { prompt: text, activeScenarioId: baselineId }, options: { researchMode: "off" }
        }));
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return (activeRun = body.runId as string);
      }
      const proposal = (text: string, title: string | null, revisionId?: string, scenarioName: string | null = "Recovery") => ({
        outcome: "answer", evidenceQuote: text, artifact: { kind: "excel_workbook", scenarioName,
          versionName: title, ...(revisionId ? { revisionId } : {}) }
      });
      let requested = proposal(prompt, citedTitle);
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", requested);
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") {
          expect(result.status).toBe("succeeded");
          return call(exchangeId, "export.excel");
        }
        if (result?.toolName === "export.excel") return call(exchangeId, "run.request_finish");
        return final(exchangeId, result?.payload.receiptId);
      });
      const delivered = await start(prompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(delivered).status).toBe("succeeded"));
      const saved = runtime.agentRuntime.store.getState(delivered);
      expect(saved.request.artifactIntent).toEqual({ kind: "excel_workbook", scenarioName: "Recovery",
        scenarioId: recoveryId, revisionId: historical.id });
      expect(saved.artifacts).toHaveLength(1);
      const descriptor = saved.artifacts![0]!.payload as { downloadUrl: string };
      const workbookResponse = await GET(new Request(new URL(descriptor.downloadUrl, "http://localhost:3000")),
        { params: Promise.resolve({ runId: delivered }) });
      expect(workbookResponse.status).toBe(200);
      expect(new Uint8Array(await workbookResponse.arrayBuffer())).toEqual(
        exportProjectExcel(database.readVdtRevision(historical), { scenarioId: recoveryId }));
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(head.id);

      const directPrompt = locale === "ru" ? `Выгрузи в Excel сценарий Recovery из ревизии ${historical.id}.`
        : `Export Recovery to Excel from revision ${historical.id}.`;
      requested = proposal(directPrompt, null, historical.id);
      const direct = await start(directPrompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(direct).status).toBe("succeeded"));
      expect(runtime.agentRuntime.store.getState(direct).request.artifactIntent).toMatchObject({ scenarioId: recoveryId, revisionId: historical.id });

      const unquotedPrompt = `Export from version ${name} to Excel for Recovery.`;
      requested = proposal(unquotedPrompt, name);
      const unquoted = await start(unquotedPrompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(unquoted).status).toBe("succeeded"));

      const suffixedPrompt = `Give me the Excel workbook for Recovery scenario from saved version “${citedTitle}”.`;
      requested = proposal(suffixedPrompt, name, undefined, "Recovery scenario");
      const suffixed = await start(suffixedPrompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(suffixed).status).toBe("succeeded"));
      expect(runtime.agentRuntime.store.getState(suffixed).artifacts?.[0]?.payload)
        .toMatchObject({ scenarioId: "historic_recovery_suffix", revisionId: historical.id });

      const currentPrompt = locale === "ru" ? "Выгрузи в Excel сценарий Recovery из текущей сохранённой версии."
        : "Export Recovery to Excel from the current saved head.";
      requested = proposal(currentPrompt, null);
      const latest = await start(currentPrompt);
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(latest);
        expect(state.status, JSON.stringify(state.events.slice(-8).map(event => [event.type, event.metadata?.code, event.metadata?.toolName]))).toBe("succeeded");
      });
      const latestArtifact = runtime.agentRuntime.store.getState(latest).artifacts?.[0]?.payload;
      expect(latestArtifact).toMatchObject({ scenarioId: "current_recovery", revisionId: head.id });

      const splitPrompt = locale === "ru" ? "Выгрузи в Excel сценарий Recovery из сохранённой версии."
        : "Export the Excel workbook for Recovery from the saved version.";
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return ask(exchangeId, locale === "ru" ? "Какую сохранённую версию выгрузить?" : "Which saved version should I export?");
        if (delta.type === "human_input") return call(exchangeId, "run.propose_outcome", proposal(name, name));
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") {
          expect(result.status).toBe("succeeded");
          return call(exchangeId, "export.excel");
        }
        if (result?.toolName === "export.excel") return call(exchangeId, "run.request_finish");
        return final(exchangeId, result?.payload.receiptId);
      });
      const clarified = await start(splitPrompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(clarified).status).toBe("needs_user_input"), { timeout: 15_000 });
      expect((await messages.POST(request(`/${clarified}/messages`, {
        type: "user_answer", structuredAnswers: [{ questionId: "process_relationship", fields: { answer: name } }]
      }), { params: Promise.resolve({ runId: clarified }) })).status).toBe(200);
      await vi.waitFor(() => {
        const state = runtime.agentRuntime.store.getState(clarified);
        expect(state.status, JSON.stringify(state.events.slice(-8).map(event => [event.type, event.metadata?.code, event.metadata?.toolName]))).toBe("succeeded");
      }, { timeout: 15_000 });
      const clarifiedArtifact = runtime.agentRuntime.store.getState(clarified).artifacts?.[0]?.payload as { downloadUrl: string };
      const clarifiedResponse = await GET(new Request(new URL(clarifiedArtifact.downloadUrl, "http://localhost:3000")),
        { params: Promise.resolve({ runId: clarified }) });
      expect(clarifiedResponse.status).toBe(200);
      expect(new Uint8Array(await clarifiedResponse.arrayBuffer())).toEqual(
        exportProjectExcel(database.readVdtRevision(historical), { scenarioId: recoveryId }));

      const siblingId = `${vdtId}_sibling`;
      database.createVdt({ id: siblingId, projectId, name: "Sibling", rootKpi: "Output" });
      const sibling = database.saveVdtRevision({ id: `${siblingId}_revision`, vdtId: siblingId, projectId, revisionNo: 1,
        source: "user", project: named });
      const unknown = locale === "ru" ? "Неизвестная версия" : "Unknown version";
      const controls = [
        proposal(prompt, null),
        proposal("Send me the Excel workbook of Recovery plan from the saved version “" + citedTitle + "”.", name, undefined, null),
        proposal("Export our saved version “" + citedTitle + "” to Excel with Recovery.", name, undefined, null),
        proposal("Give me the Excel workbook for Recovery from stored version Liner.", null),
        proposal("Please send me the Q3 audit version of the Excel workbook for Recovery.", null),
        proposal(`Export the Excel workbook for Recovery and mention ${historical.id} in chat.`, null, historical.id),
        proposal(prompt, unknown),
        proposal(prompt, name, undefined, null),
        proposal(prompt.replace("Recovery", "Recovery plan"), name),
        proposal(prompt.replace("Recovery", "Recovery or Recovery plan"), name),
        proposal(prompt.replace("Recovery", "“Recovery” or “Recovery plan”"), name),
        proposal(`Export Recovery to Excel from saved version “${citedTitle}”.`, name, undefined, null),
        proposal(locale === "ru" ? "Выгрузи в Excel сценарий Recovery из сохранённой версии."
          : "Export Excel for Recovery from the saved version.", null),
        proposal(locale === "ru" ? "Выгрузи в Excel сценарий Recovery из предыдущего снимка."
          : "Export Excel for Recovery from the earlier snapshot.", null),
        proposal(locale === "ru" ? "Выгрузи в Excel сценарий Recovery из сохранённой версии Неизвестный выпуск."
          : "Export saved version Unknown title to Excel for Recovery.", null),
        proposal(`${prompt} ${locale === "ru" ? "Вместо этого используй текущую сохранённую версию." : "Use the current saved head instead."}`, name),
        proposal("Export Excel for Recovery from the saved version Unknown title.", null),
        proposal(`${prompt} Or use version “${unknown}”.`, name),
        proposal(`${prompt} ${head.id}`, name, head.id),
        proposal(`${prompt} ${sibling.id}`, name, sibling.id),
        proposal(`${prompt} ${sibling.id}`, null, sibling.id)
      ];
      async function expectUnresolved(value: ReturnType<typeof proposal>, submitted = value.evidenceQuote) {
        installModelFixture(({ exchangeId, delta }) => {
          if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", value);
          expect(delta.results?.at(-1)?.resultCode).toBe("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED");
          return ask(exchangeId, "Which saved version should I use?");
        });
        const runId = await start(submitted);
        await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("needs_user_input"));
        const state = runtime.agentRuntime.store.getState(runId);
        expect(state.request.artifactIntent).toBeUndefined();
        expect(state.artifacts ?? []).toEqual([]);
        const unissued = describeExcelWorkbook(database, { runId, projectId, vdtId, revisionId: historical.id, scenarioId: recoveryId });
        expect(await GET(new Request(new URL(unissued.downloadUrl, "http://localhost:3000")),
          { params: Promise.resolve({ runId }) })).toMatchObject({ status: 404 });
        await supervisor.cancelStructuredModelAgentRun(runId, true);
      }
      for (const invalid of controls) await expectUnresolved(invalid);
      await expectUnresolved(proposal(prompt.slice(prompt.indexOf(citedTitle)), name), prompt);
      const duplicate = createVersionSnapshot(headProject, { name: citedTitle },
        { id: "version_duplicate_title", createdAt: "2026-11-25T09:00:00.000Z" });
      const duplicateHead = save(4, duplicate, head.id);
      await expectUnresolved(proposal(prompt, name));
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(duplicateHead.id);
      const divergent = structuredClone(headProject);
      divergent.versions[0]!.projectSnapshot.scenarios = [source.scenarios[0]!];
      const divergentHead = save(5, divergent, duplicateHead.id);
      await expectUnresolved(proposal(prompt, name));
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(divergentHead.id);
    } finally {
      database.close();
    }
  });

  it("keeps a requested workbook bound to the new named version through an outcome retry", async () => {
    const { exportProjectExcel, productionVolumeProject } = await import("@vdt-studio/vdt-core");
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { createStorageWriteActor } = await import("../../vdt/storage-write-adapter");
    const { GET } = await import("./[runId]/excel-workbook/route");
    const projectId = "successor_workbook_project", vdtId = "successor_workbook_vdt";
    const name = "Audit delivery", recoveryId = "audit_recovery";
    const prompt = `Save this corrected model as a new version named ${name}. Create an editable Excel workbook for the Recovery scenario from that new version.`;
    const project = structuredClone(productionVolumeProject);
    const baseline = project.scenarios[0]!;
    project.scenarios.push({ ...baseline, id: recoveryId, name: "Recovery", isMain: false });
    const database = openVdtDatabase(process.cwd(), { dataDir });
    try {
      database.createProject({ id: projectId, name: project.name });
      const generation = database.getProjectRuntimeState(projectId)!;
      const seeded = database.createVdtWithInitialSnapshot({
        actor: createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } }),
        command: { schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId,
          expectedRuntimeGeneration: generation.runtimeGeneration, expectedGenerationVersion: generation.generationVersion,
          idempotencyKey: "successor-workbook-seed", vdt: { requestedVdtId: vdtId, name: project.name,
            rootKpi: "Production Volume", unit: null, timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Seed saved scenarios", validation: null, calculation: null } },
        project
      });
      const snapshot = database.readVdtRevision(seeded.revision);
      const artifact = { kind: "excel_workbook", scenarioName: "Recovery", versionName: name };
      const outcomeArgs = { outcome: "structural_model", evidenceQuote: prompt };
      const steps = [
        { tool: "run.propose_outcome", args: { ...outcomeArgs, artifact: null }, result: "OUTCOME_ARTIFACT_SCOPE_UNRESOLVED" },
        { tool: "run.propose_outcome", args: { ...outcomeArgs, artifact }, result: "OK" },
        { tool: "export.excel", args: {}, result: "EXCEL_SUCCESSOR_VERSION_REQUIRED" },
        { tool: "version.edit", args: { kind: "save", name }, result: "OK" },
        { tool: "run.request_finish", args: {}, result: "EXCEL_REQUESTED_ARTIFACT_MISSING" },
        { tool: "export.excel", args: { scenarioId: recoveryId }, result: "OK" },
        { tool: "run.request_finish", args: {}, result: "FINISH_VERIFIED" }
      ];
      let step = 0;
      const observed: Array<[string, string]> = [];
      installModelFixture(({ exchangeId, delta }) => {
        const previous = steps[step - 1];
        const result = delta.results?.at(-1);
        if (result) observed.push([result.toolName, result.resultCode]);
        if (previous) expect(result).toMatchObject({ toolName: previous.tool, resultCode: previous.result });
        const next = steps[step++];
        return next ? call(exchangeId, next.tool, next.args) : final(exchangeId, result?.payload.receiptId);
      });
      const head = database.getVdtRevisionHead(vdtId)!;
      const runId = await start(prompt, undefined, snapshot, { projectId, vdtId, expectedRevision: {
        expectedActiveRevisionId: head.activeRevisionId,
        expectedActiveContentIdentity: head.activeContentIdentity,
        expectedCommitGeneration: head.commitGeneration,
        expectedRuntimeGeneration: generation.runtimeGeneration,
        expectedGenerationVersion: generation.generationVersion
      } });
      const getState = () => runtime.agentRuntime.store.getState(runId);
      await vi.waitFor(() => {
        const state = getState();
        expect(state.status, JSON.stringify({ observed, terminal: state.events.slice(-6).map(event =>
          [event.type, event.metadata?.code, event.metadata?.toolName]) })).toBe("succeeded");
      }, { timeout: 10_000 });
      const successorId = database.getVdtRevisionHead(vdtId)!.activeRevisionId!;
      const successor = database.getVdtRevision(successorId)!;
      const saved = database.readVdtRevision(successor);
      expect(successor.parentRevisionId).toBe(seeded.revision.id);
      expect(saved.versions.map(version => version.name)).toContain(name);
      expect(saved.graph).toEqual(snapshot.graph);
      expect(getState().artifacts).toHaveLength(1);
      const descriptor = getState().artifacts![0]!.payload as { downloadUrl: string };
      expect(descriptor).toMatchObject({ revisionId: successorId, scenarioId: recoveryId });
      const workbook = await GET(new Request(new URL(descriptor.downloadUrl, "http://localhost:3000")),
        { params: Promise.resolve({ runId }) });
      expect(workbook.status).toBe(200);
      expect(new Uint8Array(await workbook.arrayBuffer())).toEqual(exportProjectExcel(saved, { scenarioId: recoveryId }));
    } finally {
      database.close();
    }
  });

  it.each(["en", "ru"])("delivers Recovery from the exact saved revision and treats discussion as an answer (%s)", async locale => {
    const { productionVolumeProject } = await import("@vdt-studio/vdt-core");
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { createStorageWriteActor } = await import("../../vdt/storage-write-adapter");
    const { describeExcelWorkbook } = await import("./excel-workbook");
    const { GET } = await import("./[runId]/excel-workbook/route");
    const [delivery, discussion] = (await loadWorkspaceRequest("REV-03-workbook", locale)).turns;
    const projectId = `artifact_project_${locale}`, vdtId = `artifact_vdt_${locale}`;
    const recoveryId = "scenario_recovery_exact";
    const database = openVdtDatabase(process.cwd(), { dataDir });
    try {
      const project = structuredClone(productionVolumeProject);
      const baselineId = project.scenarios[0]!.id;
      project.scenarios = [{ ...project.scenarios[0]!, overrides: [] },
        { ...project.scenarios[0]!, id: recoveryId, name: "Recovery", isMain: false, overrides: [] },
        { ...project.scenarios[0]!, id: "recovery_other", name: "Recovery plan", isMain: false, overrides: [] }];
      database.createProject({ id: projectId, name: project.name });
      function saveFixture(id: string, input: typeof project) {
        const runtimeState = database.getProjectRuntimeState(projectId)!;
        return database.createVdtWithInitialSnapshot({
        actor: createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } }),
        command: {
          schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId,
          expectedRuntimeGeneration: runtimeState.runtimeGeneration, expectedGenerationVersion: runtimeState.generationVersion,
          idempotencyKey: `seed-${id}`, vdt: { requestedVdtId: id, name: project.name, rootKpi: "Production Volume",
            unit: null, timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Seed saved scenarios", validation: null, calculation: null }
        }, project: input
        });
      }
      const seeded = saveFixture(vdtId, project);
      const snapshot = database.readVdtRevision(seeded.revision);
      async function startSaved(prompt: string, targetId = vdtId, saved: typeof snapshot | null = snapshot) {
        const response = await route.POST(request("", { executionBindingId: bindingId, mode: "continue_project",
          outcomeSelection: "automatic", workspace: { projectId, vdtId: targetId },
          input: { prompt, ...(saved ? { project: saved } : {}), activeScenarioId: baselineId }, options: { researchMode: "off" }
        }));
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return (activeRun = body.runId as string);
      }
      let finishAttempts = 0;
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", {
          outcome: "answer", artifact: { kind: "excel_workbook", scenarioName: "Recovery" }, evidenceQuote: delivery.prompt
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return call(exchangeId, "run.request_finish");
        if (result?.toolName === "run.request_finish" && ++finishAttempts === 1) {
          expect(result.resultCode).toBe("EXCEL_REQUESTED_ARTIFACT_MISSING");
          return call(exchangeId, "export.excel", { scenarioId: baselineId });
        }
        if (result?.toolName === "export.excel" && result.status === "failed") {
          expect(result.resultCode).toBe("EXCEL_SCENARIO_CONFLICT");
          return call(exchangeId, "export.excel");
        }
        if (result?.toolName === "export.excel") return call(exchangeId, "run.request_finish");
        return final(exchangeId, result?.payload.receiptId);
      });
      const runId = await startSaved(delivery.prompt, vdtId, null);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(runId).status).toBe("succeeded"), { timeout: 15_000 });
      const record = database.getAgentRun(runId)!;
      expect(record.publicSnapshot).toMatchObject({ artifacts: [{ type: "excel_workbook", payload: { scenarioId: recoveryId, revisionId: seeded.revision.id } }] });
      const runState = runtime.agentRuntime.store.getState(runId);
      expect(runState.builder?.getRevision()).toBe(0);
      const descriptor = runState.artifacts![0]!.payload as { downloadUrl: string };
      const workbookResponse = await GET(new Request(new URL(descriptor.downloadUrl, "http://localhost:3000")), {
        params: Promise.resolve({ runId })
      });
      expect(workbookResponse.status).toBe(200);
      expect((await workbookResponse.arrayBuffer()).byteLength).toBeGreaterThan(100);
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(seeded.revision.id);

      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", {
          outcome: "answer", artifact: null, evidenceQuote: discussion.prompt
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return call(exchangeId, "export.excel");
        if (result?.toolName === "export.excel") {
          expect(result.status).toBe("failed");
          return call(exchangeId, "run.request_finish");
        }
        return final(exchangeId, result?.payload.receiptId);
      });
      const discussionId = await startSaved(discussion.prompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(discussionId).status).toBe("succeeded"), { timeout: 15_000 });
      expect(runtime.agentRuntime.store.getState(discussionId).artifacts ?? []).toHaveLength(0);
      const unissued = describeExcelWorkbook(database, { runId: discussionId, projectId, vdtId, revisionId: seeded.revision.id, scenarioId: recoveryId });
      expect(await GET(new Request(new URL(unissued.downloadUrl, "http://localhost:3000")), {
        params: Promise.resolve({ runId: discussionId })
      })).toMatchObject({ status: 404 });

      const duplicateId = `${vdtId}_ambiguous`;
      const duplicate = saveFixture(duplicateId, {
        ...project, scenarios: project.scenarios.map(scenario => scenario.id === "recovery_other"
          ? { ...scenario, name: "RECOVERY" } : scenario)
      });
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", {
          outcome: "answer", artifact: { kind: "excel_workbook", scenarioName: "Recovery" }, evidenceQuote: delivery.prompt
        });
        const result = delta.results?.at(-1);
        expect(result?.resultCode).toBe("OUTCOME_ARTIFACT_SCOPE_UNRESOLVED");
        return ask(exchangeId, locale === "ru" ? "Какой сценарий Recovery выгрузить?" : "Which saved Recovery scenario should I export?");
      });
      const ambiguousId = await startSaved(delivery.prompt, duplicateId, database.readVdtRevision(duplicate.revision));
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(ambiguousId).status).toBe("needs_user_input"), { timeout: 15_000 });
      expect(runtime.agentRuntime.store.getState(ambiguousId).artifacts ?? []).toHaveLength(0);
      expect(database.getVdtRevisionHead(duplicateId)?.activeRevisionId).toBe(duplicate.revision.id);

      await supervisor.cancelStructuredModelAgentRun(ambiguousId, true);
      const leafId = snapshot.graph.nodes.find(node => node.type === "input" && !node.formula)?.id;
      expect(leafId).toBeTruthy();
      const handoffPrompt = locale === "ru" ? "Открой выбор файла для этого показателя." : "Open the file chooser for this KPI.";
      installModelFixture(({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return call(exchangeId, "run.propose_outcome", {
          outcome: "answer", artifact: null, evidenceQuote: handoffPrompt
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return call(exchangeId, "project.get_node", { nodeId: leafId });
        if (result?.toolName === "project.get_node") {
          expect(result.status).toBe("succeeded");
          return call(exchangeId, "data.open_file_import", { nodeId: leafId });
        }
        if (result?.toolName === "data.open_file_import") {
          expect(result).toMatchObject({ status: "succeeded", payload: { output: { status: "user_action_available" } } });
          return call(exchangeId, "run.request_finish");
        }
        return { ...final(exchangeId, result?.payload.receiptId), text: "The file mapping was applied." };
      });
      const handoffId = await startSaved(handoffPrompt);
      await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(handoffId).status).toBe("succeeded"), { timeout: 15_000 });
      const handoffState = runtime.agentRuntime.store.getState(handoffId);
      expect(handoffState.finalReport).toContain(locale === "ru" ? "Выберите источник" : "Choose a source");
      expect(handoffState.finalReport).not.toContain("The file mapping was applied.");
      expect(database.getAgentRun(handoffId)?.publicSnapshot?.finalReport).toBe(handoffState.finalReport);
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(seeded.revision.id);
    } finally {
      database.close();
    }
  });


  it.each([
    ["en", "face", undefined, "mining.excavation", "accept_method"],
    ["ru", "delivery", undefined, "mining.haulage_truck_cycle", "accept_method"],
    ["en", "delivery", "calculated_baseline", "mining.haulage_truck_cycle", "accept_method"],
    ["ru", "face", "calculated_baseline", "mining.excavation", "decline_method"],
  ] as const)("waits for submitted scope and the exact proposed method (%s / %s / %s)", async (locale, branch, goal, skillId, choice) => {
    const fixture = await loadWorkspaceRequest(`SKILL-02-${branch}`, locale);
    const [brief, scope] = fixture.turns.map(({ prompt }: { prompt: string }) => prompt);
    let answeredScope = false;
    let answeredMethod = false;
    let readReceiptId: string | undefined;
    const localizedReason = locale === "ru"
      ? branch === "face" ? "Метод учитывает погрузку у забоя." : "Метод учитывает доставку руды."
      : branch === "face" ? "The method measures tonnes at the face." : "The method accounts for completed ore deliveries.";
    const drivers = branch === "face"
      ? [{ id: "loading_hours", unit: "h" }, { id: "loading_rate", unit: "t/h" }]
      : [{ id: "completed_deliveries", unit: "1" }, { id: "payload_per_delivery", unit: "t" }];
    installModelFixture(({ exchangeId, delta }) => {
      const result = delta.results?.at(-1);
      const next = (name: string, args?: object) => call(exchangeId, name, args);
      const question = (text: string) => ask(exchangeId, text);
      if (delta.type === "initial_context") {
        return question(locale === "ru" ? "В какой точке считать объём руды?" : "At which point should the tonnes be counted?");
      }
      if (delta.type === "human_input" && answeredScope && !answeredMethod) {
        return goal ? next("skill.list") : next("run.propose_outcome", {
          outcome: "structural_model", artifact: null, evidenceQuote: brief, confirmSkillMethod: true
        });
      }
      if (result?.toolName === "run.propose_outcome") return next("skill.list");
      if (result?.toolName === "skill.list") return next("skill.read", { skillId });
      if (result?.toolName === "skill.read") {
        readReceiptId = result.payload.output!.readReceiptId;
        return next("skill.select", { skillId, reason: localizedReason, readReceiptId, confirmMethod: true });
      }
      if (delta.type === "checkpoint_inputs" || delta.type === "human_input" && answeredMethod) {
        return next("skill.select", { skillId, reason: localizedReason, readReceiptId });
      }
      if (result?.toolName === "skill.select") {
        if (choice === "decline_method") return question("Какую другую границу процесса следует использовать?");
        return goal ? question("What measured inputs should be used?") : next("vdt.create_draft", {
          projectTitle: "Monthly ore output", rootKpi: "Monthly ore output", unit: "t"
        });
      }
      const parentNodeId = activeRun ? runtime.agentRuntime.store.getState(activeRun).builder?.getProject().rootNodeId : undefined;
      if (result?.toolName === "vdt.create_draft") return next("vdt.set_decomposition_plan", {
        plan: { version: 1, goal: "Monthly output", nodes: drivers.map(({ id: nodeId }) => ({ nodeId, parentNodeId, kind: "input" })) }
      });
      if (result?.toolName === "vdt.set_decomposition_plan") return next("vdt.add_drivers_batch", {
        drivers: drivers.map(({ id: nodeId, unit }) => ({ parentNodeId, nodeId, name: nodeId, unit, type: "input" }))
      });
      if (result?.toolName === "vdt.add_drivers_batch") return next("vdt.set_formula", {
        nodeId: parentNodeId, formula: drivers.map(({ id }) => id).join(" * ")
      });
      if (result?.toolName === "vdt.set_formula") return next("run.request_finish");
      if (result?.toolName === "run.request_finish") return final(exchangeId, result.payload.receiptId);
      throw new Error(`Unexpected Skill turn: ${JSON.stringify(delta)}`);
    });
    const runId = await start(brief, goal);
    const read = () => runtime.agentRuntime.store.getState(runId);
    await vi.waitFor(() => expect(read().pendingQuestions?.[0]?.id).toBe("process_relationship"), { timeout: 10_000 });
    expect(read().builder?.getRevision()).toBe(0);
    expect(read().events.some(event => event.type === "skill_selected")).toBe(false);
    answeredScope = true;
    const submit = (answer: object) => messages.POST(request(`/${runId}/messages`, { type: "user_answer", ...answer }),
      { params: Promise.resolve({ runId }) });
    expect((await submit({ answers: { process_relationship: scope } })).status).toBe(200);
    await vi.waitFor(() => expect(read().pendingQuestions?.[0]?.id).toMatch(/^skill-method-/u), { timeout: 10_000 });
    const questionId = read().pendingQuestions![0]!.id;
    expect(read().request.skillResolution?.pendingMethod?.readReceiptId).toBe(readReceiptId);
    expect(read().request.skillResolution?.outcome).toBeUndefined();
    expect(read().builder?.getRevision()).toBe(0);
    const replayed = await supervisor.compactSupervisorAwareSnapshot(runtime.agentRuntime.store.getSnapshot(runId));
    expect(replayed.pendingQuestions?.map(({ id }) => id)).toEqual([questionId]);
    expect(read().events.some(event => event.type === "skill_selected")).toBe(false);
    answeredMethod = true;
    expect((await submit({ structuredAnswers: [{ questionId, selectedOptionIds: [choice] }] })).status).toBe(200);
    if (choice === "accept_method" && !goal) {
      await vi.waitFor(() => expect(read().status).toBe("succeeded"), { timeout: 15_000 });
      const { openAgentRunPersistenceDatabase } = await import("./persistence");
      const database = openAgentRunPersistenceDatabase(process.cwd());
      try {
        const stored = database.getAgentRun(runId);
        const head = database.getVdtRevisionHead(stored!.vdtId!);
        const reopened = database.readVdtRevision(database.getVdtRevision(head!.activeRevisionId!)!);
        expect(reopened.graph.nodes.find(node => node.id === reopened.rootNodeId)?.formula)
          .toBe(drivers.map(({ id }) => id).join(" * "));
        expect(reopened.graph.nodes.filter(({ type }) => type === "input").map(({ id }) => id).sort())
          .toEqual(drivers.map(({ id }) => id).sort());
      } finally {
        database.close();
      }
      expect(read().events.findIndex(event => event.type === "skill_selected"))
        .toBeLessThan(read().events.findIndex(event => event.metadata?.toolName === "vdt.create_draft"));
    } else {
      await vi.waitFor(() => expect(read().pendingQuestions?.[0]?.id).toBe("process_relationship"), { timeout: 10_000 });
      expect(read().builder?.getRevision()).toBe(0);
    }
    const events = read().events.filter(event => event.type === "skill_selected");
    if (choice === "accept_method") {
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toMatchObject({ id: skillId, readReceiptId, reason: localizedReason,
        scopeSourceMessageId: expect.any(String), methodConfirmationSourceMessageId: expect.any(String) });
    } else expect(events).toHaveLength(0);
  });
});
