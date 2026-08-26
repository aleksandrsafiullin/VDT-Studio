import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CursorAcpProtocolEngine } from "./cursor-acp-engine";
import type {
  CursorAcpEngineStart,
  CursorAcpJsonRpcId,
  CursorAcpJsonRpcNotification,
  CursorAcpJsonRpcRequest,
  CursorAcpRequestOptions,
  CursorAcpSessionEvent,
  CursorAcpTransport
} from "./cursor-acp-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function privateWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vdt-cursor-acp-test-"));
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
  readonly #messageListeners = new Set<(message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification) => void>();
  readonly #closeListeners = new Set<(error?: Error) => void>();
  readonly #promptResolvers: Array<(value: unknown) => void> = [];
  started = false;
  closed = false;
  sessionId = "cursor-session-1";
  initializeResult: unknown = {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { close: {} }
    },
    agentInfo: { name: "cursor", version: "2026.08.11-e8db854" },
    authMethods: [{ id: "cursor_login" }]
  };
  replayOnLoad: CursorAcpJsonRpcNotification | undefined;

  async start(): Promise<void> {
    this.started = true;
  }

  request(method: string, params: unknown, options?: CursorAcpRequestOptions): Promise<unknown> {
    this.calls.push({ method, params, ...(options ? { options } : {}) });
    if (method === "initialize") return Promise.resolve(this.initializeResult);
    if (method === "authenticate") return Promise.resolve({});
    if (method === "session/new") return Promise.resolve({ sessionId: this.sessionId });
    if (method === "session/load" || method === "session/resume") {
      if (this.replayOnLoad) this.emit(this.replayOnLoad);
      return Promise.resolve({});
    }
    if (method === "session/close") return Promise.resolve({});
    if (method === "session/prompt") {
      return new Promise((resolve) => this.#promptResolvers.push(resolve));
    }
    return Promise.reject(Object.assign(new Error(`Unexpected method ${method}`), { code: "TEST_UNEXPECTED_METHOD" }));
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

  onMessage(listener: (message: CursorAcpJsonRpcRequest | CursorAcpJsonRpcNotification) => void): () => void {
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

function baseStart(workspace: string): CursorAcpEngineStart {
  return {
    runId: "run-1",
    engineBindingId: "binding-1",
    sessionEpoch: 1,
    trustedPrivateWorkspaceRoot: path.dirname(workspace),
    privateWorkspacePath: workspace,
    initialPrompt: "Build a bounded VDT.",
    model: "cursor-grok-4.6-medium",
    backendSettingsHash: sha256("settings"),
    toolCatalogHash: sha256("catalog"),
    allowedToolNames: ["run.request_finish", "vdt.add_driver", "vdt.validate"],
    vdtMcpServer: {
      name: "vdt-tool-gateway",
      command: "/opt/vdt/bin/vdt-tool-gateway",
      args: ["--stdio"],
      env: [{ name: "VDT_GATEWAY_CAPABILITY", value: "do-not-persist-this-secret" }]
    }
  };
}

function engine(transport: FakeCursorAcpTransport, options: { canary?: boolean } = {}): CursorAcpProtocolEngine {
  return new CursorAcpProtocolEngine({
    transportFactory: () => transport,
    expectedCliVersion: "2026.08.11-e8db854",
    enableUnverifiedCanary: options.canary ?? true,
    now: () => new Date("2026-08-26T10:00:00.000Z")
  });
}

async function takeUntil(
  events: AsyncIterable<CursorAcpSessionEvent>,
  predicate: (event: CursorAcpSessionEvent) => boolean,
  limit = 30
): Promise<CursorAcpSessionEvent[]> {
  const iterator = events[Symbol.asyncIterator]();
  const output: CursorAcpSessionEvent[] = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for ACP event.")), 1_000))
    ]);
    if (result.done) break;
    output.push(result.value);
    if (predicate(result.value)) return output;
  }
  throw new Error("Expected ACP event was not emitted.");
}

describe("CursorAcpEngine", () => {
  it("is default-off and exposes an explicitly unverified canary capability", async () => {
    const transport = new FakeCursorAcpTransport();
    const instance = engine(transport, { canary: false });

    expect(instance.capability).toMatchObject({
      profile: "external_cli_agent",
      sessionStrategy: "native",
      qualificationStatus: "unverified",
      toolIsolation: "unverified"
    });
    await expect(instance.openSession(baseStart(await privateWorkspace()))).rejects.toMatchObject({
      code: "EXTERNAL_ENGINE_NOT_QUALIFIED"
    });
    expect(transport.started).toBe(false);
  });

  it("rejects a private workspace outside its explicit trusted root before process start", async () => {
    const transport = new FakeCursorAcpTransport();
    const workspace = await privateWorkspace();
    const unrelatedWorkspace = await privateWorkspace();
    const start = {
      ...baseStart(workspace),
      trustedPrivateWorkspaceRoot: path.dirname(unrelatedWorkspace)
    };

    await expect(engine(transport).openSession(start)).rejects.toMatchObject({
      code: "CURSOR_ACP_UNSAFE_WORKSPACE"
    });
    expect(transport.started).toBe(false);
  });

  it("rejects a lexical workspace child whose realpath escapes through a symlink", async () => {
    const transport = new FakeCursorAcpTransport();
    const trustedRoot = await mkdtemp(path.join(tmpdir(), "vdt-cursor-acp-trusted-"));
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "vdt-cursor-acp-outside-"));
    const outsideWorkspace = path.join(outsideRoot, "workspace");
    await mkdir(outsideWorkspace);
    await symlink(outsideRoot, path.join(trustedRoot, "escape"));
    temporaryDirectories.push(trustedRoot, outsideRoot);
    const escapedWorkspace = path.join(trustedRoot, "escape", "workspace");
    const start = {
      ...baseStart(escapedWorkspace),
      trustedPrivateWorkspaceRoot: trustedRoot
    };

    await expect(engine(transport).openSession(start)).rejects.toMatchObject({
      code: "CURSOR_ACP_UNSAFE_WORKSPACE"
    });
    expect(transport.started).toBe(false);
  });

  it("uses one persistent ACP session, streams messages, and emits a durable-safe checkpoint", async () => {
    const transport = new FakeCursorAcpTransport();
    const instance = engine(transport);
    const session = await instance.openSession(baseStart(await privateWorkspace()));

    expect(transport.calls.map((call) => call.method)).toEqual([
      "initialize",
      "authenticate",
      "session/new",
      "session/prompt"
    ]);
    expect(transport.calls[0]?.params).toMatchObject({
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      }
    });
    expect(transport.calls[2]?.params).toMatchObject({
      mcpServers: [{ name: "vdt-tool-gateway" }]
    });

    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "I’ll build " }
        }
      }
    });
    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "the VDT." }
        }
      }
    });
    transport.finishPrompt({ stopReason: "end_turn" });

    const events = await takeUntil(session.events(), (event) => event.type === "checkpoint");
    expect(events.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ phase: "delta", text: "I’ll build " }),
      expect.objectContaining({ phase: "delta", text: "the VDT." }),
      expect.objectContaining({ phase: "completed", text: "I’ll build the VDT." })
    ]);
    expect(events.at(-1)).toMatchObject({ type: "checkpoint", stopReason: "end_turn" });

    const checkpoint = await session.checkpoint();
    const serialized = JSON.stringify(checkpoint);
    expect(checkpoint).toMatchObject({
      externalSessionId: transport.sessionId,
      state: "idle",
      cliVersion: "2026.08.11-e8db854",
      model: "cursor-grok-4.6-medium"
    });
    expect(checkpoint.lastConfirmedInputHash).toMatch(/^sha256:/);
    expect(checkpoint.lastConfirmedOutputHash).toMatch(/^sha256:/);
    expect(serialized).not.toContain("Build a bounded VDT");
    expect(serialized).not.toContain("do-not-persist-this-secret");
    expect(serialized).not.toContain("/opt/vdt/bin/vdt-tool-gateway");
    await session.close();
  });

  it("routes a blocking Cursor question back to the same prompt turn", async () => {
    const transport = new FakeCursorAcpTransport();
    const session = await engine(transport).openSession(baseStart(await privateWorkspace()));

    transport.emit({
      jsonrpc: "2.0",
      id: 77,
      method: "cursor/ask_question",
      params: {
        toolCallId: "question-tool-1",
        title: "Missing input",
        questions: [{
          id: "fleet",
          prompt: "Which fleet?",
          options: [{ id: "belaz", label: "BelAZ" }, { id: "cat", label: "CAT" }],
          allowMultiple: false
        }]
      }
    });
    const events = await takeUntil(session.events(), (event) => event.type === "question");
    expect(events.at(-1)).toMatchObject({
      type: "question",
      requestId: 77,
      title: "Missing input"
    });

    await session.submit({
      type: "question_answer",
      requestId: 77,
      answers: [{ questionId: "fleet", selectedOptionIds: ["belaz"] }]
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
    expect((await session.checkpoint()).state).toBe("running");
    transport.finishPrompt();
    await session.close();
  });

  it("keeps allowlisted ACP tool reports non-authoritative and outside session events", async () => {
    const transport = new FakeCursorAcpTransport();
    const onObservation = vi.fn();
    const instance = new CursorAcpProtocolEngine({
      transportFactory: () => transport,
      expectedCliVersion: "2026.08.11-e8db854",
      enableUnverifiedCanary: true,
      onObservation,
      now: () => new Date("2026-08-26T10:00:00.000Z")
    });
    const session = await instance.openSession(baseStart(await privateWorkspace()));

    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          toolName: "vdt.validate",
          title: "Validate VDT",
          kind: "other",
          status: "pending",
          rawInput: { toolName: "vdt.validate", args: {} }
        }
      }
    });
    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed" }
      }
    });
    transport.finishPrompt();

    const events = await takeUntil(session.events(), (event) => event.type === "checkpoint");
    expect(events.map((event) => event.type)).not.toContain("tool_call");
    expect(events.map((event) => event.type)).not.toContain("tool_result");
    expect(onObservation).toHaveBeenCalledTimes(2);
    expect(onObservation).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "vdt_tool_updated",
      toolName: "vdt.validate",
      status: "completed"
    }));
    await session.close();
  });

  it("fails closed on provider permission requests", async () => {
    const transport = new FakeCursorAcpTransport();
    const session = await engine(transport).openSession(baseStart(await privateWorkspace()));

    transport.emit({
      jsonrpc: "2.0",
      id: "permission-1",
      method: "session/request_permission",
      params: {
        sessionId: transport.sessionId,
        toolCall: { toolCallId: "shell-1", title: "Run shell", kind: "execute" },
        options: [{ optionId: "reject-once", name: "Reject", kind: "reject_once" }]
      }
    });
    const events = await takeUntil(session.events(), (event) =>
      event.type === "error" && event.code === "SECURITY_BOUNDARY_BREACH"
    );
    expect(events.at(-1)).toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await vi.waitFor(() => expect(transport.closed).toBe(true));
    expect(transport.responses).toContainEqual({
      id: "permission-1",
      result: { outcome: { outcome: "selected", optionId: "reject-once" } }
    });
    expect(transport.notifications).toContainEqual(expect.objectContaining({ method: "session/cancel" }));
  });

  it("fails closed when Cursor reports a shell or non-allowlisted tool", async () => {
    const transport = new FakeCursorAcpTransport();
    const session = await engine(transport).openSession(baseStart(await privateWorkspace()));

    transport.emit({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: transport.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "shell-1",
          toolName: "shell.exec",
          title: "Run command",
          kind: "execute",
          rawInput: { command: "pwd" }
        }
      }
    });
    const events = await takeUntil(session.events(), (event) =>
      event.type === "error" && event.code === "SECURITY_BOUNDARY_BREACH"
    );
    expect(events.at(-1)).toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    await vi.waitFor(() => expect(transport.closed).toBe(true));
  });

  it("loads the same opaque session without replaying history as new events", async () => {
    const firstTransport = new FakeCursorAcpTransport();
    const firstSession = await engine(firstTransport).openSession(baseStart(await privateWorkspace()));
    firstTransport.finishPrompt();
    await takeUntil(firstSession.events(), (event) => event.type === "checkpoint");
    const checkpoint = await firstSession.checkpoint();
    await firstSession.close();

    const resumeTransport = new FakeCursorAcpTransport();
    resumeTransport.sessionId = checkpoint.externalSessionId;
    resumeTransport.replayOnLoad = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: checkpoint.externalSessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "replayed-message",
          content: { type: "text", text: "Historical text" }
        }
      }
    };
    const workspace = await privateWorkspace();
    const resumed = await engine(resumeTransport).resumeSession({
      checkpoint,
      trustedPrivateWorkspaceRoot: path.dirname(workspace),
      privateWorkspacePath: workspace,
      backendSettingsHash: checkpoint.backendSettingsHash,
      toolCatalogHash: checkpoint.toolCatalogHash,
      allowedToolNames: ["run.request_finish", "vdt.add_driver", "vdt.validate"],
      vdtMcpServer: baseStart(workspace).vdtMcpServer
    });

    expect(resumeTransport.calls.map((call) => call.method)).toContain("session/load");
    expect(resumed.binding.externalSessionId).toBe(checkpoint.externalSessionId);
    const events = await takeUntil(resumed.events(), (event) =>
      event.type === "runtime_status" && event.status === "session_resumed"
    );
    expect(events.some((event) => event.type === "assistant_message")).toBe(false);
    await resumed.close();
  });

  it("rejects stale hard-verification evidence when the live CLI version differs", async () => {
    const transport = new FakeCursorAcpTransport();
    const instance = new CursorAcpProtocolEngine({
      transportFactory: () => transport,
      expectedCliVersion: "2026.08.11-e8db854",
      qualificationEvidence: {
        status: "hard_verified",
        cliVersion: "different-version",
        protocolVersion: 1,
        platform: process.platform,
        testedAt: "2026-08-26T00:00:00.000Z",
        evidenceHash: sha256("evidence"),
        toolCatalogHash: sha256("catalog")
      }
    });

    expect(instance.capability.qualificationStatus).toBe("hard_verified");
    await expect(instance.openSession(baseStart(await privateWorkspace()))).rejects.toMatchObject({
      code: "CURSOR_ACP_CLI_VERSION_MISMATCH"
    });
    expect(transport.closed).toBe(true);
  });
});
