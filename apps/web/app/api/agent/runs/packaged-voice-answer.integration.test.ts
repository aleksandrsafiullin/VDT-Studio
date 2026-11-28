import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { VdtAgentOutcome, VdtAgentStartRequest } from "@vdt-studio/vdt-agent-runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type ToolResult = { toolName: string; status: string; resultCode: string; payload: {
  output?: { nextOffset?: number | null; readReceiptId?: string }; receiptId?: string;
} };

const dataDir = mkdtempSync(join(tmpdir(), "vdt-packaged-voice-"));
const bindingId = "packaged_voice_test_binding";

function request(url: string, body: object) {
  return new Request(`http://localhost:3000/api/agent/runs${url}`, {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }
  });
}

/** Unix socket peer exercising the real packaged-web protocol in a test with
 * an injected local recognizer and the production WebView HTTP handlers. */
async function packagedSpeechFixture(directory: string, receive: (request: unknown) => Promise<unknown>) {
  let peer: Socket | undefined;
  const server = createServer(socket => {
    peer = socket;
    const frames = createInterface({ input: socket });
    // The runtime host dispatches bridge frames in arrival order.
    let queued = Promise.resolve();
    frames.on("line", line => {
      queued = queued.then(async () => {
        const { id, speech } = JSON.parse(line);
        try { socket.write(`${JSON.stringify({ id, ok: true, speech: await receive(speech) })}\n`); }
        catch { socket.write(`${JSON.stringify({ id, ok: false, error: "Speech fixture rejected the operation." })}\n`); }
      });
    });
  });
  const path = join(directory, "voice.sock");
  server.listen(path);
  await once(server, "listening");
  const client = createConnection(path);
  await once(client, "connect");
  const socketKey = Symbol.for("vdt-studio.packaged-speech.socket.v1");
  const clientKey = Symbol.for("vdt-studio.packaged-speech.client.v1");
  const host = globalThis as typeof globalThis & { [socketKey]?: Socket; [clientKey]?: unknown };
  host[socketKey] = client;
  return {
    async disconnect() {
      const closed = once(client, "close");
      peer?.destroy();
      await closed;
    },
    async dispose() {
      delete host[socketKey];
      delete host[clientKey];
      client.destroy();
      peer?.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}

describe("Packaged bridge through the public Supervisor", { timeout: 60_000 }, () => {
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

  function useModel(choose: (turn: { exchangeId: string; delta: { type: string; results?: ToolResult[] } }) => object) {
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

  const ask = (turnId: string, question: string) => ({
    type: "question", messageId: `${turnId}:question`, questionSetId: `${turnId}:questions`,
    questions: [{ id: "process_relationship", question, reason: "The answer changes the model.", required: true, expectedAnswerType: "text" }]
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

  it.each(["development_web", "packaged_whisper", "packaged_apple"] as const)("fences a spoken answer to its exact question occurrence and consumes it only once (%s)", async surface => {
    const { openVdtDatabase } = await import("@vdt-studio/storage");
    const { createStorageWriteActor } = await import("../../vdt/storage-write-adapter");
    const { productionVolumeProject } = await import("@vdt-studio/vdt-core");
    const packaged = surface !== "development_web";
    const projectId = `voice_project_${surface}`, vdtId = `voice_vdt_${surface}`;
    const db = openVdtDatabase(process.cwd(), { dataDir });
    let expectedRevision: NonNullable<VdtAgentStartRequest["workspace"]>["expectedRevision"];
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
      const head = db.getVdtRevisionHead(vdtId)!;
      expectedRevision = {
        expectedActiveRevisionId: head.activeRevisionId, expectedActiveContentIdentity: head.activeContentIdentity,
        expectedCommitGeneration: head.commitGeneration, expectedRuntimeGeneration: generation.runtimeGeneration,
        expectedGenerationVersion: generation.generationVersion
      };
    } finally { db.close(); }

    let count = 0;
    const fetch = useModel(({ exchangeId }) => ({ ...ask(exchangeId, ++count === 1 ? "What enters the plant?" : "What leaves the plant?"),
      questionSetId: "reused-question-set" }));
    const runId = await start("Explain the process scope.", "answer", productionVolumeProject, { projectId, vdtId, ...(packaged ? { expectedRevision } : {}) });
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
    const { getSpeechRuntime, parseSpeechRequest, SpeechRuntime } = await import("@vdt-studio/local-runner/speech");
    const speechRoute = await import("../../speech/route");
    const oldSpeech = getSpeechRuntime();
    const host = globalThis as typeof globalThis & { __vdtSpeechRuntime?: typeof oldSpeech };
    let recognized = "";
    const localSpeech = new SpeechRuntime({ platform: "darwin", arch: "arm64", recognize: async () => recognized,
      appleVoice: {
        async status() { return { state: "apple_voice_status", supported: true, recognition: [{ locale: "en", status: "installed" }], voices: [] }; },
        async recognize() { return recognized; }, async preview() { throw new Error("no fixture synthesis"); }
      }
    });
    vi.spyOn(localSpeech, "status").mockResolvedValue({
      supported: true, engineReady: true, installedModels: ["base"],
      installation: { state: "ready", downloadedBytes: 0, totalBytes: 0 }
    });
    const origin = packaged ? "http://127.0.0.1:37541" : "http://localhost:3000";
    const speech = (body: object) => speechRoute.POST(new Request(`${origin}/api/speech`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body)
    }));
    const selection = (language: "en" | "ru" | "es" | "auto" = "en") => ({
      version: 1, scopeId: JSON.stringify([projectId, vdtId]), analytics: { mode: "legacy", providerId: "mock", modelId: null },
      language, stt: surface === "packaged_apple" ? { providerId: "apple_local", modelId: "system" }
        : { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null
    });
    const capture = async (answerCapture: typeof target, transcript: string, proofAllowed = true, afterOpen?: () => void): Promise<Question> => {
      recognized = transcript;
      const language = surface === "packaged_whisper" && /\p{Script=Cyrillic}/u.test(transcript) ? "ru" : "en";
      const opened = await speech({ operation: "open_session", answerCapture, selection: selection(language) });
      expect(opened.status, await opened.clone().text()).toBe(200);
      const { sessionId } = await opened.json();
      afterOpen?.();
      const jobId = randomUUID();
      const submitted = await speech({ operation: "transcribe", sessionId, jobId,
        audioBase64: Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64") });
      expect(submitted.status).toBe(200);
      let recognitionProof = "";
      await vi.waitFor(async () => {
        const result = await speech({ operation: "result", sessionId, jobId });
        const body = await result.json();
        expect(body).toMatchObject({ state: "complete", text: transcript });
        if (proofAllowed) expect(body.recognitionProof).toEqual(expect.any(String));
        else expect(body.recognitionProof).toBeUndefined();
        recognitionProof = body.recognitionProof ?? "";
      });
      return { ...answerCapture, captureSessionId: sessionId, recognitionProof };
    };
    const close = (value: Question) => speech({ operation: "close_session", sessionId: value.captureSessionId });
    let owned: string | undefined;
    const bridge = packaged ? await packagedSpeechFixture(dataDir, async raw => {
      const parsed = parseSpeechRequest(raw);
      if (parsed.operation !== "open_session" && (!("sessionId" in parsed) || owned !== parsed.sessionId)) throw new Error("unowned session");
      const result = await localSpeech.request(parsed);
      if ("state" in result && result.state === "open") owned = result.sessionId;
      if (parsed.operation === "close_session") owned = undefined;
      return result;
    }) : undefined;
    if (packaged) vi.stubEnv("VDT_APP_MODE", "desktop");
    else host.__vdtSpeechRuntime = localSpeech;
    try {
      if (packaged) {
        expect((await speech({ operation: "result", sessionId: randomUUID(), jobId: randomUUID() })).status).toBe(409);
        expect((await speech({ operation: "tts_result", sessionId: randomUUID() })).status).toBe(403);
        if (surface === "packaged_whisper") {
          for (const language of ["auto", "es"] as const) {
            const draft = await speech({ operation: "open_session", selection: selection(language), answerCapture: { ...target, turnId: randomUUID() } });
            expect(draft.status).toBe(409);
            expect(await draft.json()).toMatchObject({ code: "PACKAGED_SPEECH_DRAFT_ONLY" });
          }
        }
        for (const transcript of ["Yes", "25 tonnes", "с двумя насосами", "до ста тонн"]) {
          const held = await capture({ ...target, turnId: randomUUID() }, transcript, false);
          expect((await close(held)).status).toBe(200);
        }
        const builder = state().builder!;
        const staleBeforeRecognition = await capture({ ...target, turnId: randomUUID() }, "Ore enters from the upstream plant", false, () => {
          builder.updateNode({ nodeId: builder.getProject().rootNodeId, patch: { description: "Changed working revision before recognition." } });
        });
        expect((await close(staleBeforeRecognition)).status).toBe(200);
        const oldRevision = await capture({ ...target, turnId: randomUUID() }, "Ore enters from the upstream plant");
        builder.updateNode({ nodeId: builder.getProject().rootNodeId, patch: { description: "Changed working revision after capture." } });
        expect((await submit(oldRevision)).status).toBe(409);
        expect((await close(oldRevision)).status).toBe(200);
      }
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
      const nextText = packaged ? "Материал выходит из дробилки" : "Concentrate leaves the plant";
      const next = await capture({ ...target, questionEventId: event()!.id, turnId: randomUUID() }, nextText);
      expect((await submit(next, nextText)).status).toBe(200);
      await close(next);
      if (bridge) {
        await vi.waitFor(() => expect(event()?.id).not.toBe(next.questionEventId), { timeout: 10_000 });
        const lastTarget = { ...target, questionEventId: event()!.id, turnId: randomUUID() };
        const invalidated = await capture(lastTarget, "Concentrate leaves the plant");
        if (surface === "packaged_whisper") {
          const database = openVdtDatabase(process.cwd(), { dataDir });
          try {
            const head = database.getVdtRevisionHead(vdtId)!;
            const generation = database.getProjectRuntimeState(projectId)!;
            const revised = structuredClone(productionVolumeProject);
            revised.graph.nodes.find(node => node.id === revised.rootNodeId)!.description = "Manual save after voice capture.";
            const result = database.commitVdtRevision({
              projectId, vdtId, actor: createStorageWriteActor(projectId), project: revised,
              command: { schemaVersion: "revision_commit.v2", idempotencyKey: "voice-mid-turn-save",
                expectedActiveRevisionId: head.activeRevisionId, expectedActiveContentIdentity: head.activeContentIdentity,
                expectedCommitGeneration: head.commitGeneration, expectedRuntimeGeneration: generation.runtimeGeneration,
                expectedGenerationVersion: generation.generationVersion,
                intent: { source: "user", summary: "Manual save", validation: null, calculation: null }
              }
            });
            expect(result.status).toBe("committed");
          } finally { database.close(); }
          expect((await submit(invalidated, "Concentrate leaves the plant")).status).toBe(409);
          await close(invalidated);
        } else {
          await bridge.disconnect();
          expect((await submit(invalidated, "Concentrate leaves the plant")).status).toBe(409);
        }
      }
    } finally {
      if (packaged) vi.stubEnv("VDT_APP_MODE", "development_web");
      host.__vdtSpeechRuntime = oldSpeech;
      await bridge?.dispose();
    }

  });

});
