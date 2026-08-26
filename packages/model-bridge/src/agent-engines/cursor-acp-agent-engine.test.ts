import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AgentEngineCheckpoint,
  AgentEngineEvent,
  AgentEngineHost,
  AgentEngineStart,
  AgentSessionBinding,
  ExternalCliAgentEngine,
  FinishReceiptV2,
  VdtGatewayToolCall,
  VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import {
  CursorAcpEngine,
  cursorAcpCapabilityProfileHash,
  cursorAcpInitialContextHash,
  type CursorAcpSessionEnvironmentFactoryInput
} from "./cursor-acp-agent-engine";
import type {
  CursorAcpJsonRpcId,
  CursorAcpJsonRpcNotification,
  CursorAcpJsonRpcRequest,
  CursorAcpRequestOptions,
  CursorAcpTransport
} from "./cursor-acp-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

async function privateWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vdt-cursor-canonical-test-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  temporaryDirectories.push(root);
  return workspace;
}

interface FakeCall {
  readonly method: string;
  readonly params: unknown;
  readonly options?: CursorAcpRequestOptions;
}

class FakeCursorAcpTransport implements CursorAcpTransport {
  readonly calls: FakeCall[] = [];
  readonly notifications: FakeCall[] = [];
  readonly responses: Array<{ id: CursorAcpJsonRpcId; result?: unknown; error?: unknown }> = [];
  readonly #messageListeners = new Set<(
    message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification
  ) => void>();
  readonly #closeListeners = new Set<(error?: Error) => void>();
  readonly #promptResolvers: Array<(value: unknown) => void> = [];
  started = false;
  closed = false;
  sessionId = "cursor-session-canonical-1";
  supportsNativeResume = false;
  resumeMessage: { readonly messageId: string; readonly text: string } | null = null;

  async start(): Promise<void> {
    this.started = true;
  }

  request(method: string, params: unknown, options?: CursorAcpRequestOptions): Promise<unknown> {
    this.calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === "initialize") {
      return Promise.resolve({
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: {
            close: {},
            ...(this.supportsNativeResume ? { resume: {} } : {})
          }
        },
        agentInfo: { name: "cursor", version: "2026.08.11-e8db854" },
        authMethods: [{ id: "cursor_login" }]
      });
    }
    if (method === "authenticate") return Promise.resolve({});
    if (method === "session/new") return Promise.resolve({ sessionId: this.sessionId });
    if (method === "session/resume") {
      if (this.resumeMessage) {
        this.emit({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: this.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: this.resumeMessage.messageId,
              content: { type: "text", text: this.resumeMessage.text }
            }
          }
        });
      }
      return Promise.resolve({ stopReason: "end_turn" });
    }
    if (method === "session/load" || method === "session/close") {
      return Promise.resolve({});
    }
    if (method === "session/prompt") {
      return new Promise((resolve) => this.#promptResolvers.push(resolve));
    }
    return Promise.reject(Object.assign(new Error(`Unexpected method ${method}`), {
      code: "TEST_UNEXPECTED_METHOD"
    }));
  }

  async notify(method: string, params: unknown): Promise<void> {
    this.notifications.push({ method, params });
  }

  async respond(id: CursorAcpJsonRpcId, result: unknown): Promise<void> {
    this.responses.push({ id, result });
  }

  async respondError(id: CursorAcpJsonRpcId, code: number, message: string, data?: unknown): Promise<void> {
    this.responses.push({ id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
  }

  onMessage(listener: (
    message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification
  ) => void): () => void {
    this.#messageListeners.add(listener);
    return () => this.#messageListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  stderrTail(): string {
    return "";
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.#closeListeners) listener();
  }

  emit(message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification): void {
    for (const listener of this.#messageListeners) listener(message);
  }

  finishPrompt(result: unknown = { stopReason: "end_turn" }): void {
    const resolve = this.#promptResolvers.shift();
    if (!resolve) throw new Error("No prompt is pending.");
    resolve(result);
  }
}

const vdtMcpServer = Object.freeze({
  name: "vdt-tool-gateway" as const,
  command: "/opt/vdt/bin/vdt-tool-gateway",
  args: ["--stdio"] as const,
  env: [{ name: "VDT_GATEWAY_CAPABILITY", value: "server-owned-test-capability" }]
});

interface Harness {
  readonly engine: CursorAcpEngine;
  readonly transports: readonly FakeCursorAcpTransport[];
  readonly host: AgentEngineHost;
  readonly controller: AbortController;
  readonly environments: CursorAcpSessionEnvironmentFactoryInput[];
  readonly environmentClose: ReturnType<typeof vi.fn>;
  readonly gatewayExecute: ReturnType<typeof vi.fn>;
  binding: AgentSessionBinding;
  start: AgentEngineStart;
}

function successfulResult(call: VdtGatewayToolCall): VdtGatewayToolResult {
  return {
    externalCallId: call.externalCallId,
    toolName: call.toolName,
    status: "succeeded",
    resultCode: "OK",
    resultHash: sha256(`result:${call.externalCallId}`),
    payload: { ok: true }
  };
}

function makeHarness(options: {
  readonly canary?: boolean;
  readonly transports?: readonly FakeCursorAcpTransport[];
  readonly gatewayResult?: (call: VdtGatewayToolCall) => VdtGatewayToolResult;
  readonly durableFinishReceipt?: FinishReceiptV2 | null;
} = {}): Harness {
  const transports = [...(options.transports ?? [new FakeCursorAcpTransport()])];
  let transportIndex = 0;
  const environments: CursorAcpSessionEnvironmentFactoryInput[] = [];
  const environmentClose = vi.fn();
  const gatewayExecute = vi.fn(async (call: VdtGatewayToolCall) =>
    (options.gatewayResult ?? successfulResult)(call)
  );
  const controller = new AbortController();
  let bindingForResume: AgentSessionBinding | undefined;
  const engine = new CursorAcpEngine({
    cliVersion: "2026.08.11-e8db854",
    toolCatalogHash: sha256("tool-catalog"),
    allowedToolNames: ["approval.request", "run.request_finish", "user.ask", "vdt.validate"],
    transportFactory: () => {
      const transport = transports[transportIndex];
      transportIndex += 1;
      if (!transport) throw new Error("No fake Cursor transport is available.");
      return transport;
    },
    sessionEnvironmentFactory: async (input) => {
      environments.push(input);
      const privateWorkspacePath = await privateWorkspace();
      return {
        trustedPrivateWorkspaceRoot: path.dirname(privateWorkspacePath),
        privateWorkspacePath,
        vdtMcpServer,
        close: environmentClose
      };
    },
    resolveBinding: () => {
      if (!bindingForResume) throw new Error("No canonical binding was recorded for resume.");
      return bindingForResume;
    },
    resolveFinishReceipt: () => options.durableFinishReceipt ?? null,
    enableUnverifiedCanary: options.canary ?? true,
    now: () => new Date("2026-08-26T10:00:00.000Z")
  });
  const binding: AgentSessionBinding = {
    schemaVersion: 2,
    bindingId: "binding-cursor-1",
    runId: "run-cursor-1",
    projectId: "project-cursor-1",
    executionProfile: "external_cli_agent",
    engineId: engine.capability.engineId,
    engineAdapterId: engine.capability.engineAdapterId,
    backendId: engine.capability.backendId,
    modelId: "cursor-grok-4.6-medium",
    protocolVersion: engine.capability.protocolVersion,
    cliVersion: engine.capability.cli.version,
    toolIsolation: engine.capability.toolIsolation,
    qualificationStatus: engine.capability.qualification.status,
    capabilityEvidenceHash: engine.capability.qualification.evidenceHash,
    settingsHash: sha256("settings"),
    capabilityProfileHash: cursorAcpCapabilityProfileHash(engine.capability),
    toolCatalogHash: engine.capability.toolCatalogHash,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T09:59:00.000Z"
  };
  const initialContext = Object.freeze({
    brief: "Build the test VDT.",
    projectSummary: { revision: 1 },
    toolCatalogHash: engine.capability.toolCatalogHash
  });
  const start: AgentEngineStart = {
    binding,
    initialContext,
    initialContextHash: cursorAcpInitialContextHash(initialContext)
  };
  const harness: Harness = {
    engine,
    transports,
    host: { signal: controller.signal, executeTool: gatewayExecute },
    controller,
    environments,
    environmentClose,
    gatewayExecute,
    binding,
    start
  };
  Object.defineProperty(harness, "binding", {
    get: () => bindingForResume ?? binding,
    set: (value: AgentSessionBinding) => {
      bindingForResume = value;
    },
    enumerable: true
  });
  return harness;
}

function verifiedFinishReceipt(
  sessionEpoch = 1,
  receiptId = "finish-receipt-recovery"
): FinishReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId,
    runId: "run-cursor-1",
    bindingId: "binding-cursor-1",
    sessionEpoch,
    state: "verified",
    receiptHash: sha256(receiptId),
    projectRevision: 7,
    projectHash: sha256("project"),
    validationHash: sha256("validation"),
    calculationHash: sha256("calculation"),
    finalMessageHash: null,
    verifiedAt: "2026-08-26T09:59:30.000Z",
    finalPersistedAt: null
  };
}

function finishRecoveryCheckpoint(
  binding: AgentSessionBinding,
  receipt: FinishReceiptV2
): AgentEngineCheckpoint {
  return {
    schemaVersion: 2,
    checkpointId: "cursor-finish-recovery-checkpoint",
    bindingId: binding.bindingId,
    runId: binding.runId,
    sessionEpoch: binding.sessionEpoch,
    externalSessionId: binding.externalSessionId,
    lastConfirmedInput: { cursor: "cursor-input-finish", contentHash: sha256("input") },
    lastConfirmedOutput: { cursor: "cursor-output-finish", contentHash: sha256("output") },
    activeExchange: {
      exchangeId: "cursor-finish-turn",
      stableCallKey: "cursor-finish-turn",
      state: "ambiguous"
    },
    activeToolCall: {
      externalCallId: "cursor-finish-call",
      toolName: "run.request_finish",
      state: "completed"
    },
    finishReceipt: {
      receiptId: receipt.receiptId,
      state: "verified",
      receiptHash: receipt.receiptHash
    },
    createdAt: "2026-08-26T10:00:00.000Z"
  };
}

async function takeUntil(
  events: AsyncIterable<AgentEngineEvent>,
  predicate: (event: AgentEngineEvent) => boolean,
  limit = 30
): Promise<AgentEngineEvent[]> {
  const iterator = events[Symbol.asyncIterator]();
  const output: AgentEngineEvent[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for canonical ACP event.")), 1_000)
      )
    ]);
    if (result.done) break;
    output.push(result.value);
    if (predicate(result.value)) return output;
  }
  throw new Error("Expected canonical ACP event was not emitted.");
}

describe("CursorAcpEngine canonical adapter", () => {
  it("implements the canonical external engine contract and remains default-off while unverified", async () => {
    const harness = makeHarness({ canary: false });
    const canonical: ExternalCliAgentEngine = harness.engine;

    expect(canonical.capability).toMatchObject({
      executionProfile: "external_cli_agent",
      engineId: "cursor-acp",
      sessionStrategy: "native",
      toolIsolation: "unverified",
      qualification: { status: "unverified" }
    });
    await expect(canonical.openSession(harness.start, harness.host)).rejects.toMatchObject({
      code: "EXTERNAL_ENGINE_NOT_QUALIFIED"
    });
    expect(harness.environments).toHaveLength(0);
    expect(harness.transports[0]?.started).toBe(false);
  });

  it("opens one native session and exposes only the host Gateway callback as VDT authority", async () => {
    const harness = makeHarness();
    const session = await harness.engine.openSession(harness.start, harness.host);
    harness.binding = session.binding;
    const transport = harness.transports[0];
    const bridge = harness.environments[0];
    if (!transport || !bridge) throw new Error("Harness did not create a Cursor session environment.");

    expect(session.binding.externalSessionId).toBe(transport.sessionId);
    expect(transport.calls.map((call) => call.method)).toEqual([
      "initialize",
      "authenticate",
      "session/new"
    ]);
    expect(() => session.events()).toThrowError(expect.objectContaining({
      code: "CURSOR_ACP_PREPARED_CHECKPOINT_REQUIRED"
    }));
    expect(transport.calls.map((call) => call.method)).not.toContain("session/prompt");
    expect(await session.checkpoint()).toMatchObject({
      activeExchange: {
        exchangeId: expect.stringMatching(/^cursor-initial-/),
        stableCallKey: expect.stringMatching(/^cursor-initial-/),
        state: "prepared"
      }
    });
    await expect(bridge.executeTool({
      externalCallId: "too-early-call",
      toolName: "vdt.validate",
      args: {}
    })).rejects.toMatchObject({ code: "CURSOR_ACP_SESSION_NOT_ACTIVATED" });
    expect(harness.gatewayExecute).not.toHaveBeenCalled();

    const eventStream = session.events();
    expect(transport.calls.map((call) => call.method)).toContain("session/prompt");
    const result = await bridge.executeTool({
      externalCallId: "validate-call-1",
      toolName: "vdt.validate",
      args: {}
    });
    expect(result.status).toBe("succeeded");
    expect(harness.gatewayExecute).toHaveBeenCalledOnce();

    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "The graph is valid." }
        }
      }
    });
    transport.finishPrompt();
    const events = await takeUntil(eventStream, (event) => event.type === "checkpoint_requested");
    const delta = events.find((event) => event.type === "assistant_message_delta");
    const completed = events.find((event) => event.type === "assistant_message");
    expect(delta).toMatchObject({ type: "assistant_message_delta", delta: "The graph is valid." });
    expect(completed).toMatchObject({ type: "assistant_message", text: "The graph is valid." });
    expect(delta && completed && delta.messageId).toBe(completed && "messageId" in completed
      ? completed.messageId
      : undefined);
    expect(events.map((event) => event.type)).not.toContain("tool_request");

    const checkpoint = await session.checkpoint();
    expect(checkpoint).toMatchObject({
      schemaVersion: 2,
      bindingId: session.binding.bindingId,
      externalSessionId: transport.sessionId,
      activeToolCall: {
        externalCallId: "validate-call-1",
        toolName: "vdt.validate",
        state: "completed"
      }
    });
    expect(JSON.stringify(checkpoint)).not.toContain("server-owned-test-capability");
    await session.close();
  });

  it("normalizes a question and submits its answer to the same blocking ACP request", async () => {
    const harness = makeHarness();
    const session = await harness.engine.openSession(harness.start, harness.host);
    const transport = harness.transports[0];
    if (!transport) throw new Error("Harness has no transport.");
    await session.checkpoint();
    const eventStream = session.events();
    transport.emit({
      jsonrpc: "2.0",
      id: 77,
      method: "cursor/ask_question",
      params: {
        title: "Fleet choice",
        questions: [{
          id: "fleet",
          prompt: "Which fleet?",
          options: [{ id: "belaz", label: "BelAZ" }, { id: "cat", label: "CAT" }],
          allowMultiple: false
        }]
      }
    });
    const events = await takeUntil(eventStream, (event) => event.type === "question");
    const question = events.at(-1);
    if (!question || question.type !== "question") throw new Error("Question event is missing.");
    expect(question.questions).toEqual([{
      id: "fleet",
      question: "Which fleet?",
      reason: "Fleet choice",
      required: true,
      answerKind: "single_choice",
      options: [
        { id: "belaz", label: "BelAZ", value: "belaz" },
        { id: "cat", label: "CAT", value: "cat" }
      ]
    }]);
    await session.submit({
      type: "user_answer",
      questionSetId: question.questionSetId,
      answers: { fleet: "belaz" }
    });
    expect(transport.responses).toContainEqual({
      id: 77,
      result: {
        outcome: {
          outcome: "answered",
          answers: [{ questionId: "fleet", selectedOptionIds: ["belaz"] }]
        }
      }
    });
    transport.finishPrompt();
    await session.close();
  });

  it("publishes exactly one final only after the Gateway returns a verified finish receipt", async () => {
    const harness = makeHarness({
      gatewayResult: (call) => ({
        ...successfulResult(call),
        payload: { receiptId: "finish-receipt-1", receiptHash: sha256("finish-receipt-1") }
      })
    });
    const session = await harness.engine.openSession(harness.start, harness.host);
    const transport = harness.transports[0];
    const bridge = harness.environments[0];
    if (!transport || !bridge) throw new Error("Harness did not create a Cursor session environment.");
    await session.checkpoint();
    const eventStream = session.events();
    await bridge.executeTool({
      externalCallId: "finish-call-1",
      toolName: "run.request_finish",
      args: {}
    });
    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "final-message-1",
          content: { type: "text", text: "The VDT is complete." }
        }
      }
    });
    transport.finishPrompt();

    const iterator = eventStream[Symbol.asyncIterator]();
    const events: AgentEngineEvent[] = [];
    for (;;) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for final.")), 1_000)
        )
      ]);
      if (result.done) break;
      events.push(result.value);
    }
    expect(events.filter((event) => event.type === "final")).toEqual([
      expect.objectContaining({
        finishReceiptId: "finish-receipt-1",
        text: "The VDT is complete."
      })
    ]);
    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(0);
    expect((await session.checkpoint()).finishReceipt).toMatchObject({
      receiptId: "finish-receipt-1",
      state: "verified"
    });
    await session.close();
  });

  it("resumes the exact immutable opaque session from a canonical checkpoint", async () => {
    const first = new FakeCursorAcpTransport();
    const second = new FakeCursorAcpTransport();
    const harness = makeHarness({ transports: [first, second] });
    const opened = await harness.engine.openSession(harness.start, harness.host);
    harness.binding = opened.binding;
    await opened.checkpoint();
    const openedEvents = opened.events();
    first.finishPrompt();
    await takeUntil(openedEvents, (event) => event.type === "checkpoint_requested");
    const checkpoint = await opened.checkpoint();
    await opened.close();
    second.sessionId = opened.binding.externalSessionId ?? "missing-session";

    const resumed = await harness.engine.resumeSession(checkpoint, harness.host);
    expect(resumed.binding).toEqual(opened.binding);
    expect(second.calls.map((call) => call.method)).toContain("session/load");
    expect(second.calls.find((call) => call.method === "session/load")?.params).toMatchObject({
      sessionId: opened.binding.externalSessionId
    });
    await resumed.close();
  });

  it("hydrates the durable verified finish and emits only the exact-successor same-session final", async () => {
    const transport = new FakeCursorAcpTransport();
    transport.supportsNativeResume = true;
    transport.resumeMessage = {
      messageId: "recovered-final-message",
      text: "The original Cursor session completed the VDT."
    };
    const receipt = verifiedFinishReceipt();
    const harness = makeHarness({
      transports: [transport],
      durableFinishReceipt: receipt
    });
    const recoveryBinding: AgentSessionBinding = {
      ...harness.binding,
      externalSessionId: transport.sessionId,
      sessionEpoch: receipt.sessionEpoch + 1
    };
    harness.binding = recoveryBinding;
    const checkpoint = finishRecoveryCheckpoint(recoveryBinding, receipt);

    const resumed = await harness.engine.resumeSession(checkpoint, harness.host);

    expect((await resumed.checkpoint()).finishReceipt).toEqual(checkpoint.finishReceipt);
    await expect(resumed.submit({
      type: "user_instruction",
      text: "Start another turn after finish."
    })).rejects.toMatchObject({ code: "CURSOR_ACP_INPUT_AFTER_FINISH" });
    const recoveryBridge = harness.environments[0];
    if (!recoveryBridge) throw new Error("Recovery environment was not created.");
    await expect(recoveryBridge.executeTool({
      externalCallId: "post-finish-tool",
      toolName: "vdt.validate",
      args: {}
    })).rejects.toMatchObject({ code: "CURSOR_ACP_TOOL_AFTER_FINISH" });
    expect(harness.gatewayExecute).not.toHaveBeenCalled();

    const events = await takeUntil(resumed.events(), (event) => event.type === "final");
    expect(events.filter((event) => event.type === "final")).toEqual([{
      type: "final",
      messageId: expect.any(String),
      finishReceiptId: receipt.receiptId,
      text: transport.resumeMessage.text
    }]);
    expect(transport.calls.map((call) => call.method)).toContain("session/resume");
    expect(transport.calls.map((call) => call.method)).not.toContain("session/prompt");
    expect(harness.environments).toEqual([
      expect.objectContaining({ recovery: true, binding: recoveryBinding })
    ]);
    await resumed.close();
  });

  it("fails closed when durable finish authority is not from the exact predecessor epoch", async () => {
    const transport = new FakeCursorAcpTransport();
    const staleReceipt = verifiedFinishReceipt(2, "finish-receipt-stale-epoch");
    const harness = makeHarness({
      transports: [transport],
      durableFinishReceipt: staleReceipt
    });
    const recoveryBinding: AgentSessionBinding = {
      ...harness.binding,
      externalSessionId: transport.sessionId,
      sessionEpoch: 2
    };
    harness.binding = recoveryBinding;

    await expect(harness.engine.resumeSession(
      finishRecoveryCheckpoint(recoveryBinding, staleReceipt),
      harness.host
    )).rejects.toMatchObject({ code: "CURSOR_ACP_FINISH_EPOCH_MISMATCH" });
    expect(harness.environments).toHaveLength(0);
    expect(transport.started).toBe(false);
  });

  it("requires native resume for verified finish recovery and never synthesizes a missing final", async () => {
    const receipt = verifiedFinishReceipt();
    const loadOnlyTransport = new FakeCursorAcpTransport();
    const loadOnlyHarness = makeHarness({
      transports: [loadOnlyTransport],
      durableFinishReceipt: receipt
    });
    const loadOnlyBinding: AgentSessionBinding = {
      ...loadOnlyHarness.binding,
      externalSessionId: loadOnlyTransport.sessionId,
      sessionEpoch: 2
    };
    loadOnlyHarness.binding = loadOnlyBinding;
    await expect(loadOnlyHarness.engine.resumeSession(
      finishRecoveryCheckpoint(loadOnlyBinding, receipt),
      loadOnlyHarness.host
    )).rejects.toMatchObject({ code: "CURSOR_ACP_NATIVE_RESUME_REQUIRED" });
    expect(loadOnlyTransport.calls.map((call) => call.method)).not.toContain("session/load");
    expect(loadOnlyTransport.calls.map((call) => call.method)).not.toContain("session/prompt");
    expect(loadOnlyHarness.environmentClose).toHaveBeenCalledOnce();

    const nativeTransport = new FakeCursorAcpTransport();
    nativeTransport.supportsNativeResume = true;
    const nativeHarness = makeHarness({
      transports: [nativeTransport],
      durableFinishReceipt: receipt
    });
    const nativeBinding: AgentSessionBinding = {
      ...nativeHarness.binding,
      externalSessionId: nativeTransport.sessionId,
      sessionEpoch: 2
    };
    nativeHarness.binding = nativeBinding;
    const resumed = await nativeHarness.engine.resumeSession(
      finishRecoveryCheckpoint(nativeBinding, receipt),
      nativeHarness.host
    );
    const events = await takeUntil(
      resumed.events(),
      (event) => event.type === "checkpoint_requested"
    );
    expect(events.some((event) => event.type === "final")).toBe(false);
    expect(events.at(-1)).toEqual({
      type: "checkpoint_requested",
      reason: "cursor_finish_message_missing"
    });
    expect((await resumed.checkpoint()).finishReceipt).toEqual(
      finishRecoveryCheckpoint(nativeBinding, receipt).finishReceipt
    );
    expect(nativeTransport.calls.map((call) => call.method)).not.toContain("session/prompt");
    await resumed.close();
  });

  it("turns host abort into an immediate fenced ACP cancellation", async () => {
    const harness = makeHarness();
    const session = await harness.engine.openSession(harness.start, harness.host);
    const transport = harness.transports[0];
    if (!transport) throw new Error("Harness has no transport.");
    harness.controller.abort("cancelled-by-supervisor");
    await vi.waitFor(() => {
      expect(transport.notifications).toContainEqual(expect.objectContaining({
        method: "session/cancel"
      }));
    });
    await session.close();
  });

  it("rejects qualification evidence for a different host before exposing hard isolation", () => {
    expect(() => new CursorAcpEngine({
      cliVersion: "2026.08.11-e8db854",
      toolCatalogHash: sha256("tool-catalog"),
      allowedToolNames: ["vdt.validate"],
      transportFactory: () => new FakeCursorAcpTransport(),
      sessionEnvironmentFactory: async () => ({
        trustedPrivateWorkspaceRoot: "/private",
        privateWorkspacePath: "/private/test-only",
        vdtMcpServer
      }),
      resolveBinding: () => {
        throw new Error("not used");
      },
      resolveFinishReceipt: () => null,
      qualificationEvidence: {
        testedAt: "2026-08-26T00:00:00.000Z",
        evidenceHash: sha256("evidence"),
        platform: { os: "different-os", arch: process.arch, runtimeVersion: process.version }
      }
    })).toThrowError(expect.objectContaining({
      code: "CURSOR_ACP_QUALIFICATION_PLATFORM_MISMATCH"
    }));
  });
});
