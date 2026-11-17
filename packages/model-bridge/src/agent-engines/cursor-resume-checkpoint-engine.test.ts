import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_FINISH_MISSING_VALUE_PROMPT_RULE,
  AGENT_QUESTION_PROMPT_RULE,
  AGENT_QUESTION_WRITEBACK_PROMPT_RULE,
  AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE,
  CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE,
  CHECKPOINT_ACTION_TYPE_PROMPT_RULE,
  CHECKPOINT_FINISH_ORDER_PROMPT_RULE,
  CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE,
  type AgentEngineEvent,
  type AgentEngineHost,
  type AgentSessionBinding,
  type VdtGatewayToolCall,
  type VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  CursorResumeCheckpointEngine,
  buildCursorResumeCheckpointInitialPrompt,
  createCursorResumeCheckpointSessionMissingPendingDeltaForTests,
  cursorResumeCheckpointCapabilityHash,
  createQualifiedCursorResumeCheckpointEngine,
  type CursorCheckpointQualificationEvidence
} from "./cursor-resume-checkpoint-engine";
import {
  CURSOR_CHECKPOINT_PROTOCOL_VERSION,
  CursorResumeCheckpointTransport,
  cursorCheckpointVendorPolicyHash,
  type CursorResumeCheckpointEnvironment,
  type CursorResumeProcessRequest,
  type CursorResumeProcessResult,
  type CursorResumeProcessRunner
} from "./cursor-resume-checkpoint-transport";

const SHA = `sha256:${"a".repeat(64)}`;
const TOOL_CATALOG_HASH = `sha256:${"b".repeat(64)}`;
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function turn(action: unknown, assistantMessage: unknown = null): string {
  return JSON.stringify({
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    assistantMessage,
    action
  });
}

function stream(request: CursorResumeProcessRequest, result: string, sessionId = "opaque-cursor-session", model = request.args.includes("--model") ? request.args[request.args.indexOf("--model") + 1] : "auto"): string {
  return [
    {
      type: "system",
      subtype: "init",
      cwd: request.cwd,
      session_id: sessionId,
      model,
      permissionMode: "ask"
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      session_id: sessionId
    }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

class ScriptedRunner implements CursorResumeProcessRunner {
  readonly requests: CursorResumeProcessRequest[] = [];
  readonly #steps: readonly ((request: CursorResumeProcessRequest, index: number) => string | Promise<string>)[];

  constructor(steps: readonly ((request: CursorResumeProcessRequest, index: number) => string | Promise<string>)[]) {
    this.#steps = steps;
  }

  async run(request: CursorResumeProcessRequest): Promise<CursorResumeProcessResult> {
    const index = this.requests.length;
    const copy = { ...request, args: [...request.args], environment: { ...request.environment } };
    this.requests.push(copy);
    const step = this.#steps[index];
    if (!step) throw new Error(`Unexpected Cursor process spawn ${index + 1}.`);
    return {
      exitCode: 0,
      signal: null,
      stdout: await step(copy, index),
      stderr: ""
    };
  }
}

async function createEnvironment(environmentId = "cursor-private-env"): Promise<CursorResumeCheckpointEnvironment> {
  return {
    environmentId,
    privateWorkspacePath: await temporaryDirectory("vdt-checkpoint-workspace-"),
    privateStatePath: await temporaryDirectory("vdt-checkpoint-state-"),
    forbiddenRoots: [await temporaryDirectory("vdt-checkpoint-forbidden-")]
  };
}

function bindingFor(engine: CursorResumeCheckpointEngine): AgentSessionBinding {
  return {
    schemaVersion: 2,
    bindingId: "binding-cursor-checkpoint",
    runId: "run-cursor-checkpoint",
    projectId: "project-1",
    executionProfile: "external_cli_agent",
    engineId: engine.capability.engineId,
    engineAdapterId: engine.capability.engineAdapterId,
    backendId: engine.capability.backendId,
    modelId: "gpt-5.5-high",
    protocolVersion: engine.capability.protocolVersion,
    cliVersion: engine.capability.cli.version,
    toolIsolation: "unverified",
    qualificationStatus: "unverified",
    capabilityEvidenceHash: null,
    settingsHash: SHA,
    capabilityProfileHash: cursorResumeCheckpointCapabilityHash(engine.capability),
    toolCatalogHash: TOOL_CATALOG_HASH,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T10:00:00.000Z"
  };
}

function gatewayResult(call: VdtGatewayToolCall, input: Partial<VdtGatewayToolResult> = {}): VdtGatewayToolResult {
  return {
    externalCallId: call.externalCallId,
    toolName: call.toolName,
    status: "succeeded",
    resultCode: "OK",
    resultHash: hashText(`${call.externalCallId}:${call.toolName}`),
    payload: { ok: true },
    ...input
  };
}

async function collect(events: AsyncIterable<AgentEngineEvent>): Promise<AgentEngineEvent[]> {
  const output: AgentEngineEvent[] = [];
  for await (const event of events) output.push(event);
  return output;
}

function harness(input: {
  runner: ScriptedRunner;
  environment: CursorResumeCheckpointEnvironment;
  executed?: VdtGatewayToolCall[];
  executeTool?: (call: VdtGatewayToolCall) => Promise<VdtGatewayToolResult>;
  enable?: boolean;
}) {
  let resumeBinding: AgentSessionBinding | undefined;
  const transport = new CursorResumeCheckpointTransport({
    executable: "/opt/cursor/cursor-agent",
    validatedCliVersion: "2026.08.1",
    runner: input.runner
  });
  const engine = new CursorResumeCheckpointEngine({
    transport,
    cliVersion: "2026.08.1",
    toolCatalogHash: TOOL_CATALOG_HASH,
    allowedToolNames: ["vdt.echo", "vdt.inspect", "user.ask", "approval.request", "run.request_finish"],
    sessionEnvironmentFactory: () => input.environment,
    resolveBinding: () => {
      if (!resumeBinding) throw new Error("Resume binding is not available.");
      return resumeBinding;
    },
    enableUnverifiedCanary: input.enable ?? true,
    now: () => "2026-08-26T10:00:00.000Z",
    idFactory: () => "checkpoint-id"
  });
  const controller = new AbortController();
  const host: AgentEngineHost = {
    signal: controller.signal,
    executeTool: async (call) => {
      input.executed?.push(call);
      return input.executeTool ? input.executeTool(call) : gatewayResult(call);
    }
  };
  return {
    engine,
    host,
    setResumeBinding(binding: AgentSessionBinding) {
      resumeBinding = binding;
    }
  };
}

describe.skipIf(process.platform !== "darwin" && process.platform !== "win32")("qualified Cursor checkpoints", () => {
  const evidence: CursorCheckpointQualificationEvidence = {
    evidenceHash: SHA,
    testedAt: "2026-11-16T10:00:00.000Z",
    cliVersion: "2026.11.11-b912975",
    protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
    toolCatalogHash: TOOL_CATALOG_HASH,
    payloadHash: hashText("test vendor payload"),
    policyHash: hashText("test isolation policy"),
    vendorPolicyHash: cursorCheckpointVendorPolicyHash("disabled"),
    platform: { os: process.platform, arch: process.arch, runtimeVersion: process.version },
    modelId: "grok-4.7-low",
    catalogModelDisplayName: "Grok 4.7  Low",
    runtimeModelDisplayName: "Grok 4.7 256K Low"
  };
  const identity = {
    cliVersion: evidence.cliVersion, payloadHash: evidence.payloadHash,
    policyHash: evidence.policyHash, vendorPolicyHash: evidence.vendorPolicyHash
  };
  const executable = path.resolve("test-cursor-payload");
  const context = { brief: "exact Grok fixture" };

  function options(environment: CursorResumeCheckpointEnvironment, runner: ScriptedRunner, qualification = evidence) {
    return {
      executable,
      cliVersion: evidence.cliVersion,
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["run.request_finish"],
      sessionEnvironmentFactory: () => environment,
      resolveBinding: () => { throw new Error("Recovery not needed for this fixture."); },
      evidence: qualification,
      runner: {
        async measureIdentity(candidate: string) {
          expect(candidate).toBe(executable);
          return identity;
        },
        async runQualified(request: CursorResumeProcessRequest, permit: typeof identity) {
          expect(permit).toEqual(identity);
          expect(Object.isFrozen(permit)).toBe(true);
          expect(request.executable).toBe(executable);
          expect(request.environment.HOME).toBe(await realpath(environment.privateStatePath));
          const vendorPolicy = JSON.parse(await readFile(path.join(request.environment.CURSOR_CONFIG_DIR!, "cli-config.json"), "utf8"));
          expect(vendorPolicy).toMatchObject({
            approvalMode: "allowlist",
            permissions: { allow: [], deny: expect.arrayContaining(["Shell(*)", "Mcp(*:*)"]) },
            sandbox: { mode: "disabled", readBoundary: "workspace" }
          });
          expect(request.args).toContain("--trust");
          const modelFlag = request.args.indexOf("--model");
          expect(modelFlag).toBeGreaterThan(0);
          expect(request.args[modelFlag + 1]).toBe(qualification.modelId);
          return runner.run(request);
        }
      }
    };
  }

  function start(engine: CursorResumeCheckpointEngine, modelId = evidence.modelId) {
    return {
      binding: {
        ...bindingFor(engine),
        modelId,
        toolIsolation: engine.capability.toolIsolation,
        qualificationStatus: engine.capability.qualification.status,
        capabilityEvidenceHash: engine.capability.qualification.evidenceHash
      },
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    };
  }

  it("pins the exact Grok model and forwards the same native identity permit on open and resume", async () => {
    const privateEnvironment = await createEnvironment();
    const environment = { ...privateEnvironment, preauthorizeEmptyWorkspace: true };
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
      }, { messageId: "initial", text: "Checking the calculation." }), "same-cursor-session", evidence.runtimeModelDisplayName),
      (request) => stream(request, turn({
        type: "final",
        messageId: "final",
        finishReceiptId: "receipt",
        text: "Finished."
      }), "same-cursor-session", evidence.runtimeModelDisplayName)
    ]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options(environment, runner));
    expect(engine.capability).toMatchObject({
      toolIsolation: "hard_verified",
      qualification: { status: "qualified", evidenceHash: evidence.evidenceHash }
    });
    const executed: VdtGatewayToolCall[] = [];
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => {
        executed.push(call);
        return gatewayResult(call, { payload: { receiptId: "receipt", receiptHash: hashText("receipt") } });
      }
    };
    await expect(engine.openSession(start(engine, "auto"), host)).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_BINDING_MISMATCH"
    });
    expect(runner.requests).toHaveLength(0);
    const opened = await engine.openSession(start(engine), host);
    const events = await collect(opened.events());
    expect(events.at(-1), JSON.stringify(events)).toMatchObject({ type: "final" });
    expect(executed.map((call) => call.toolName)).toEqual(["run.request_finish"]);
    expect(runner.requests).toHaveLength(2);
    const resumeFlag = runner.requests[1]!.args.indexOf("--resume");
    expect(runner.requests[1]!.args[resumeFlag + 1]).toBe("same-cursor-session");
    await opened.close();
  });

  const extraHigh = {
    ...evidence,
    modelId: "grok-4.7-xhigh",
    catalogModelDisplayName: "Grok 4.7  Extra High",
    runtimeModelDisplayName: "Grok 4.7 256K Extra High"
  };

  it.each([
    ["Grok 4.7 Extra High", "Grok 4.7  Extra High"],
    ["Grok 4.7 256K Extra High", "grok-4.7-xhigh"]
  ])("confirms qualified Extra High at open (%s) and same-session resume (%s)", async (openLabel, resumeLabel) => {
    const environment = { ...await createEnvironment(), preauthorizeEmptyWorkspace: true };
    const runner = new ScriptedRunner([
      request => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
      }, { messageId: "initial", text: "Checking the calculation." }), "same-xhigh-session", openLabel),
      request => stream(request, turn({
        type: "final", messageId: "final", finishReceiptId: "receipt", text: "Finished."
      }), "same-xhigh-session", resumeLabel)
    ]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options(environment, runner, extraHigh));
    const opened = await engine.openSession(start(engine, extraHigh.modelId), {
      signal: new AbortController().signal,
      executeTool: async call => gatewayResult(call, { payload: { receiptId: "receipt", receiptHash: hashText("receipt") } })
    });
    const events = await collect(opened.events());
    expect(events.at(-1), JSON.stringify(events)).toMatchObject({ type: "final" });
    expect(runner.requests[1]?.args).toContain("same-xhigh-session");
    await opened.close();
  });

  it.each([
    "Grok 4.7 Low", "grok-4.7-low", "auto", "Grok 4.7 Extra High Preview",
    "grok 4.7 Extra High", "Grok 4.7\tExtra High", " Grok 4.7 Extra High"
  ])("rejects an unreviewed Extra High init label %j", async label => {
    const environment = { ...await createEnvironment(), preauthorizeEmptyWorkspace: true };
    const runner = new ScriptedRunner([
      request => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
      }), "same-xhigh-session", label)
    ]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options(environment, runner, extraHigh));
    await expect(engine.openSession(start(engine, extraHigh.modelId), {
      signal: new AbortController().signal,
      executeTool: async () => { throw new Error("An unreviewed label must never reach the Gateway."); }
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_MODEL_UNVERIFIED" });
    expect(runner.requests).toHaveLength(1);
  });

  it("rejects a catalog label presented as the model at runtime", async () => {
    const environment = { ...await createEnvironment(), preauthorizeEmptyWorkspace: true };
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
      }, { messageId: "initial", text: "Checking the calculation." }), "fixture-session", evidence.catalogModelDisplayName)
    ]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options(environment, runner));
    await expect(engine.openSession(start(engine), {
      signal: new AbortController().signal,
      executeTool: async () => { throw new Error("Model mismatch must never reach the Gateway."); }
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_MODEL_UNVERIFIED" });
    expect(runner.requests).toHaveLength(1);
  });

  it("rejects a reported native WebSearch event before any VDT Gateway call", async () => {
    const environment = { ...await createEnvironment(), preauthorizeEmptyWorkspace: true };
    const runner = new ScriptedRunner([
      (request) => {
        const output = stream(request, turn({
          type: "action_batch",
          calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
        }, { messageId: "initial", text: "Checking the calculation." }));
        const [init, result] = output.trim().split("\n");
        return [init, JSON.stringify({
          type: "tool_call",
          subtype: "started",
          session_id: "opaque-cursor-session",
          tool_call: { webSearchToolCall: { args: { searchTerm: "fixture" } } }
        }), result].join("\n");
      }
    ]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options(environment, runner));
    await expect(engine.openSession(start(engine), {
      signal: new AbortController().signal,
      executeTool: async () => { throw new Error("Fixture must never reach the Gateway."); }
    })).rejects.toMatchObject({ code: "SECURITY_BOUNDARY_BREACH" });
    expect(runner.requests).toHaveLength(1);
  });

  it("rejects mismatched vendor policy bytes in evidence before the runner measures", async () => {
    const input = options(await createEnvironment(), new ScriptedRunner([]));
    await expect(createQualifiedCursorResumeCheckpointEngine({
      ...input,
      evidence: { ...input.evidence, vendorPolicyHash: cursorCheckpointVendorPolicyHash("enabled") }
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH" });
  });

  it("rejects measured policy drift before admitting a binding", async () => {
    const input = options(await createEnvironment(), new ScriptedRunner([]));
    await expect(createQualifiedCursorResumeCheckpointEngine({
      ...input,
      runner: { ...input.runner, async measureIdentity() {
        return { ...identity, policyHash: hashText("different policy") };
      } }
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_QUALIFICATION_MISMATCH" });
  });

  it("rejects development auth HOME before spawning the vendor", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([]);
    const engine = await createQualifiedCursorResumeCheckpointEngine(options({
      ...environment,
      trustedSubscriptionAuthHomePath: await temporaryDirectory("vdt-checkpoint-test-auth-")
    }, runner));
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => gatewayResult(call)
    };
    await expect(engine.openSession(start(engine), host)).rejects.toMatchObject({
      code: "CURSOR_CHECKPOINT_UNSAFE_ENVIRONMENT"
    });
    expect(runner.requests).toHaveLength(0);
  });
});

describe("buildCursorResumeCheckpointInitialPrompt", () => {
  it("embeds the shared writeback and finish constants", () => {
    const prompt = buildCursorResumeCheckpointInitialPrompt({
      binding: {
        schemaVersion: 2,
        bindingId: "binding-cursor-checkpoint",
        runId: "run-cursor-checkpoint",
        projectId: "project-1",
        executionProfile: "external_cli_agent",
        engineId: "cursor-resume-checkpoint",
        engineAdapterId: "cursor-resume-checkpoint-v1",
        backendId: "cursor_cli",
        modelId: "gpt-5.5-high",
        protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
        cliVersion: "2026.08.1",
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: SHA,
        capabilityProfileHash: SHA,
        toolCatalogHash: TOOL_CATALOG_HASH,
        externalSessionId: "opaque-cursor-session",
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      },
      initialContext: { brief: "prompt-coverage" },
      initialContextHash: hashText(JSON.stringify({ brief: "prompt-coverage" }))
    }, ["tools.describe", "vdt.add_drivers_batch", "user.ask", "run.request_finish"]);
    const [instruction, context] = prompt.split("\n", 2);
    expect(instruction).toContain("VDT tools are requests in action.calls.");
    expect(instruction).toContain("return tools.describe with args.toolNames");
    expect(instruction).toContain("Never use Cursor's native Grep");
    const parsed = JSON.parse(context!) as {
      constraints: {
        questions: string;
        finishMissingValues: string;
        final: string;
        actionBatch: string;
        actionTypes: string;
        data: string;
        example: unknown;
        structure: string;
        sourceInputs: string;
      };
    };
    expect(parsed.constraints.questions).toBe(AGENT_QUESTION_PROMPT_RULE);
    expect(parsed.constraints.questions).toContain(AGENT_QUESTION_WRITEBACK_PROMPT_RULE);
    expect(parsed.constraints.finishMissingValues).toBe(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toBe(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(parsed.constraints.actionBatch).toBe(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(parsed.constraints.actionTypes).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(parsed.constraints.final).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(parsed.constraints.final).toContain(AGENT_FINISH_MISSING_VALUE_PROMPT_RULE);
    expect(parsed.constraints.final).not.toMatch(/request_finish first/i);
    expect(parsed.constraints.data).toContain("data.list_sources");
    expect(parsed.constraints.data).toContain("data.write_inputs");
    expect(parsed.constraints.data).toContain("inclusive calendar day count");
    expect(parsed.constraints.data).toContain("never in editable default_assumption inputs");
    expect(parsed.constraints.structure).toContain("Omit the optional relation for ordinary formula dependencies.");
    expect(parsed.constraints.structure).toContain("Actual tonnes per trip already include any payload adjustment");
    expect(parsed.constraints.example).toMatchObject({
      action: { type: "action_batch", calls: [{ toolName: "tools.describe", args: { toolNames: ["vdt.add_drivers_batch"] } }] }
    });
    expect(parsed.constraints.sourceInputs).toContain("literalUserQuantities");
  });
});

describe("CursorResumeCheckpointEngine", () => {
  it("propagates mismatched model identity before executing the action batch", async () => {
    const executed: VdtGatewayToolCall[] = [];
    const runner = new ScriptedRunner([request => stream(request, turn({
      type: "action_batch",
      batch: { calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }] }
    }), "opaque-cursor-session", "other-model")]);
    const h = harness({ runner, environment: await createEnvironment(), executed });
    const context = { brief: "model identity" };
    await expect(h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host)).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_MODEL_UNVERIFIED" });
    expect(executed).toEqual([]);
    expect(runner.requests).toHaveLength(1);
  });

  it("emits a recoverable transport_error when the pending exchange delta is missing", async () => {
    const environment = await createEnvironment();
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner: new ScriptedRunner([])
    });
    const session = createCursorResumeCheckpointSessionMissingPendingDeltaForTests({
      binding: {
        schemaVersion: 2,
        bindingId: "binding-cursor-checkpoint",
        runId: "run-cursor-checkpoint",
        projectId: "project-1",
        executionProfile: "external_cli_agent",
        engineId: "cursor-resume-checkpoint",
        engineAdapterId: "cursor-resume-checkpoint-v1",
        backendId: "cursor_cli",
        modelId: "gpt-5.5-high",
        protocolVersion: CURSOR_CHECKPOINT_PROTOCOL_VERSION,
        cliVersion: "2026.08.1",
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: SHA,
        capabilityProfileHash: SHA,
        toolCatalogHash: TOOL_CATALOG_HASH,
        externalSessionId: "opaque-cursor-session",
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      },
      transport,
      environment,
      host: {
        signal: new AbortController().signal,
        executeTool: async () => {
          throw new Error("executeTool must not run when the pending delta is missing.");
        }
      }
    });

    const events = await collect(session.events());
    expect(events).toEqual([{
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_PENDING_DELTA_MISSING",
      message: "Cursor checkpoint session lost its pending exchange delta. Recover this run from the last durable checkpoint.",
      retryable: true
    }]);
  });
  it("terminates the logical session when a resumed ActionBatch attempts shell execution", async () => {
    const environment = await createEnvironment();
    const executed: VdtGatewayToolCall[] = [];
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{ externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } }]
        }
      }, { messageId: "message-start", text: "I am starting through the VDT Gateway." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{ externalCallId: "breach-1", toolName: "shell.exec", args: { command: "pwd" } }]
        }
      }))
    ]);
    const h = harness({ runner, environment, executed });
    const context = { brief: "security-boundary" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);

    const events = await collect(session.events());

    expect(executed.map((entry) => entry.toolName)).toEqual(["vdt.echo"]);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "SECURITY_BOUNDARY_BREACH",
      retryable: false
    });
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(0);
    expect(runner.requests).toHaveLength(2);
    await expect(session.submit({
      type: "user_instruction",
      text: "Continue."
    })).rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_SESSION_TERMINAL" });
  });

  it("executes ActionBatch sequentially and resumes one opaque session only at checkpoints", async () => {
    const environment = await createEnvironment();
    const executed: VdtGatewayToolCall[] = [];
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [
            { externalCallId: "call-1", toolName: "vdt.echo", args: { value: 1 } },
            { externalCallId: "call-2", toolName: "vdt.inspect", args: { nodeId: "root" } },
            { externalCallId: "call-3", toolName: "vdt.echo", args: { value: 2 } }
          ]
        }
      }, { messageId: "message-start", text: "I am building the VDT in this session." })),
      (request) => {
        expect(executed.map((call) => call.externalCallId)).toEqual(["call-1", "call-2", "call-3"]);
        return stream(request, turn({
          type: "action_batch",
          batch: {
            calls: [{ externalCallId: "finish-1", toolName: "run.request_finish", args: {} }]
          }
        }));
      },
      (request) => stream(request, turn({
        type: "final",
        messageId: "message-final",
        finishReceiptId: "finish-receipt-1",
        text: "The VDT is complete and verified."
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executed,
      executeTool: async (call) => call.toolName === "run.request_finish"
        ? gatewayResult(call, {
            payload: {
              receiptId: "finish-receipt-1",
              receiptHash: hashText("finish-receipt-1")
            }
          })
        : gatewayResult(call)
    });
    const context = { brief: "exact-fixture" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    h.setResumeBinding(opened.binding);
    const events = await collect(opened.events());

    expect(executed.map((call) => call.externalCallId)).toEqual(["call-1", "call-2", "call-3", "finish-1"]);
    expect(runner.requests).toHaveLength(3);
    const telemetry = (opened as unknown as { snapshotPerformanceTelemetry: () => {
      segmentCount: number;
      processSpawnCount: number;
      logicalSessionCount: number;
      resumeCount: number;
      toolCallCount: number;
    } }).snapshotPerformanceTelemetry();
    expect(telemetry.segmentCount).toBe(3);
    expect(telemetry.processSpawnCount).toBe(runner.requests.length);
    expect(telemetry.logicalSessionCount).toBe(1);
    expect(telemetry.resumeCount).toBe(2);
    expect(telemetry.toolCallCount).toBe(4);
    expect(JSON.stringify(telemetry)).not.toContain("opaque-cursor-session");
    expect(runner.requests.slice(1).every((request) => {
      const index = request.args.indexOf("--resume");
      return index >= 0 && request.args[index + 1] === "opaque-cursor-session";
    })).toBe(true);
    expect(runner.requests[0]?.stdin).toContain("exact-fixture");
    expect(runner.requests[1]?.stdin).not.toContain("exact-fixture");
    expect(runner.requests[1]?.stdin).toContain("call-3");
    expect(events).toContainEqual({
      type: "final",
      messageId: "message-final",
      finishReceiptId: "finish-receipt-1",
      text: "The VDT is complete and verified."
    });
    expect(opened.binding.externalSessionId).toBe("opaque-cursor-session");
  });

  it("publishes the host's verified calculation after a finish receipt without another model call", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "inspect", toolName: "vdt.inspect", args: {} }]
      }, { messageId: "start", text: "Проверяю дерево." })),
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "finish", toolName: "run.request_finish", args: {} }]
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => call.toolName === "run.request_finish"
        ? gatewayResult(call, {
            resultCode: "FINISH_VERIFIED",
            payload: {
              receiptId: "finish-receipt-verified",
              receiptHash: hashText("finish-receipt-verified"),
              verifiedFinalText: "Итог расчёта — 4 900 USD."
            }
          })
        : gatewayResult(call)
    });
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: { brief: "host-final" },
      initialContextHash: hashText(JSON.stringify({ brief: "host-final" }))
    }, h.host);
    const events = await collect(session.events());

    expect(runner.requests).toHaveLength(2);
    expect(events.at(-2)).toMatchObject({ type: "checkpoint_requested" });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      finishReceiptId: "finish-receipt-verified",
      text: "Итог расчёта — 4 900 USD."
    });
  });

  it("normalizes non-plain gateway error details before the next Cursor resume", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        calls: [{ externalCallId: "call-invalid", toolName: "vdt.echo", args: { value: 1 } }]
      }, "I will validate this call.")),
      (request) => stream(request, turn({
        type: "final",
        finishReceiptId: "missing-finish-receipt"
      }, "The run cannot actually finish without its receipt."))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, {
        status: "failed",
        resultCode: "INVALID_TOOL_ARGS",
        payload: {
          error: {
            code: "INVALID_TOOL_ARGS",
            message: "Invalid tool arguments.",
            details: [{ unionErrors: [new Error("branch one"), new Error("branch two")] }]
          }
        }
      })
    });
    const context = { brief: "wire-normalization" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);

    const events = await collect(opened.events());

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1]?.stdin).toContain("INVALID_TOOL_ARGS");
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_RESPONSE_ENVELOPE_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_ACTION_TYPE_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain(AGENT_RESEARCH_UNCONFIGURED_PROMPT_RULE);
    expect(runner.requests[1]?.stdin).toContain("assistantMessage only");
    expect(runner.requests[1]?.stdin).toContain("return tools.describe with args.toolNames");
    expect(runner.requests[1]?.stdin).toContain("inclusive calendar day count");
    expect(runner.requests[1]?.stdin).toContain("Omit the optional relation");
    expect(runner.requests[1]?.stdin).not.toContain("or stated assumptions");
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_FINAL_WITHOUT_RECEIPT"
    });
    expect(events.map((event) => event.type === "transport_error" && event.code))
      .not.toContain("CURSOR_CHECKPOINT_JSON_INVALID");
  });

  it("checkpoints a user.ask pause and resumes the same session after submit", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-1",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "fleet-size",
                question: "How many trucks should be modeled?",
                reason: "The fleet size is required for the branch.",
                required: true,
                answerKind: "number"
              }]
            }
          }]
        }
      }, { messageId: "message-question", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: { calls: [{ externalCallId: "finish-2", toolName: "run.request_finish", args: {} }] }
      })),
      (request) => stream(request, turn({
        type: "final",
        messageId: "message-final-2",
        finishReceiptId: "finish-receipt-2",
        text: "The answered run is complete."
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => call.toolName === "user.ask"
        ? gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
        : gatewayResult(call, {
            payload: {
              receiptId: "finish-receipt-2",
              receiptHash: hashText("finish-receipt-2")
            }
          })
    });
    const context = { brief: "question-fixture" };
    const opened = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    h.setResumeBinding(opened.binding);
    const pausedEvents = await collect(opened.events());
    expect(pausedEvents.map((event) => event.type)).toEqual([
      "assistant_message",
      "checkpoint_requested",
      "question"
    ]);
    const checkpoint = await opened.checkpoint();
    expect(checkpoint.externalSessionId).toBe("opaque-cursor-session");

    await opened.submit({
      type: "user_answer",
      questionSetId: "cursor-question-question-1",
      answers: { "fleet-size": 36 }
    });
    const completedEvents = await collect(opened.events());
    expect(completedEvents.at(-1)).toMatchObject({ type: "final", finishReceiptId: "finish-receipt-2" });
    expect(runner.requests[1]?.args).toEqual(expect.arrayContaining(["--resume", "opaque-cursor-session"]));
    expect(runner.requests[1]?.stdin).toContain("fleet-size");
    expect(runner.requests[1]?.stdin).toContain("36");
  });

  it("is default-off and keeps capability isolation explicitly unverified", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([]);
    const h = harness({ runner, environment, enable: false });
    expect(h.engine.capability).toMatchObject({
      sessionStrategy: "checkpoint_resume",
      toolIsolation: "unverified",
      qualification: { status: "unverified", evidenceHash: null }
    });
    const context = { brief: "blocked" };
    await expect(h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host)).rejects.toMatchObject({ code: "EXTERNAL_ENGINE_NOT_QUALIFIED" });
    expect(runner.requests).toHaveLength(0);
  });

  it("rejects crash recovery when the private environment identity changes", async () => {
    const original = await createEnvironment("original-private-environment");
    const changed = await createEnvironment("changed-private-environment");
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-recovery",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "confirm",
                question: "Continue?",
                reason: "A checkpoint is required.",
                required: true,
                answerKind: "single_choice",
                options: ["yes", "no"]
              }]
            }
          }]
        }
      }, { messageId: "message-recovery", text: "I need confirmation." }))
    ]);
    let resolvedBinding: AgentSessionBinding | undefined;
    let recovery = false;
    const transport = new CursorResumeCheckpointTransport({
      executable: "/opt/cursor/cursor-agent",
      validatedCliVersion: "2026.08.1",
      runner
    });
    const engine = new CursorResumeCheckpointEngine({
      transport,
      cliVersion: "2026.08.1",
      toolCatalogHash: TOOL_CATALOG_HASH,
      allowedToolNames: ["user.ask"],
      sessionEnvironmentFactory: () => recovery ? changed : original,
      resolveBinding: () => resolvedBinding!,
      enableUnverifiedCanary: true,
      now: () => "2026-08-26T10:00:00.000Z",
      idFactory: () => "checkpoint-id"
    });
    const host: AgentEngineHost = {
      signal: new AbortController().signal,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    };
    const context = { brief: "recovery" };
    const opened = await engine.openSession({
      binding: bindingFor(engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, host);
    resolvedBinding = opened.binding;
    await collect(opened.events());
    const checkpoint = await opened.checkpoint();
    recovery = true;

    await expect(engine.resumeSession(checkpoint, host))
      .rejects.toMatchObject({ code: "CURSOR_CHECKPOINT_ENVIRONMENT_MISMATCH" });
  });

  it("retries one malformed user.ask and continues after a corrected set", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "missing-reason",
                question: "What scope?",
                required: true
              }]
            }
          }]
        }
      }, { messageId: "message-bad", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-good",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "fleet-size",
                question: "How many trucks should be modeled?",
                reason: "The fleet size is required for the branch.",
                required: true,
                answerKind: "number"
              }]
            }
          }]
        }
      }))
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    });
    const context = { brief: "question-payload-retry" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    const events = await collect(session.events());

    expect(runner.requests).toHaveLength(2);
    expect(runner.requests[1]?.stdin).toContain("QUESTION_SCHEMA_INVALID");
    expect(runner.requests[1]?.stdin).toContain("0.reason");
    expect(events.map((event) => event.type)).toEqual([
      "assistant_message",
      "transport_note",
      "checkpoint_requested",
      "checkpoint_requested",
      "question"
    ]);
    expect(events.find((event) => event.type === "transport_note")).toMatchObject({
      code: "CURSOR_CHECKPOINT_QUESTION_PAYLOAD_RETRY"
    });
    expect(events.at(-1)).toMatchObject({
      type: "question",
      questionSetId: "cursor-question-question-good"
    });
  });

  it("terminates on a second consecutive malformed set with the second diagnostic", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad-1",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "missing-reason",
                question: "What scope?",
                required: true
              }]
            }
          }]
        }
      }, { messageId: "message-bad", text: "I need one value before continuing." })),
      (request) => stream(request, turn({
        type: "action_batch",
        batch: {
          calls: [{
            externalCallId: "question-bad-2",
            toolName: "user.ask",
            args: {
              questions: [{
                id: "bad-type",
                question: "Pick one?",
                reason: "Enum is invalid.",
                required: true,
                expectedAnswerType: "bogus"
              }]
            }
          }]
        }
      })),
      (request) => {
        throw new Error("A third question payload must not be requested.");
      }
    ]);
    const h = harness({
      runner,
      environment,
      executeTool: async (call) => gatewayResult(call, { status: "waiting_user", resultCode: "QUESTION_REQUIRED" })
    });
    const context = { brief: "question-payload-retry-terminal" };
    const session = await h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host);
    const events = await collect(session.events());

    expect(runner.requests).toHaveLength(2);
    expect(events.filter((event) => event.type === "transport_note")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "transport_error",
      code: "CURSOR_CHECKPOINT_QUESTION_INVALID",
      retryable: false
    });
    const terminal = events.at(-1);
    if (terminal?.type !== "transport_error") throw new Error("expected transport_error");
    expect(terminal.message).toContain("user.ask did not contain a valid VDT question checkpoint:");
    expect(terminal.message).toContain("expectedAnswerType");
    expect(terminal.message).not.toContain("0.reason");
  });
});

describe("CursorResumeCheckpointEngine.open contract violations", () => {
  const mixedTools = [
    ["run.request_finish", "run.request_finish must be the only call in an action batch."],
    ["user.ask", "user.ask must be the only call in an action batch."],
    ["approval.request", "approval.request must be the only call in an action batch."]
  ] as const;

  function mixedControlArgs(toolName: string): Record<string, unknown> {
    if (toolName !== "user.ask") return {};
    return {
      questions: [{
        id: "fleet-size",
        question: "How many trucks should be modeled?",
        reason: "The fleet size is required for the branch.",
        required: true,
        answerKind: "number"
      }]
    };
  }

  function mixedControlAction(toolName: string) {
    return {
      type: "action_batch",
      batch: {
        calls: [
          { externalCallId: "echo-1", toolName: "vdt.echo", args: { value: 1 } },
          { externalCallId: "control-1", toolName, args: mixedControlArgs(toolName) }
        ]
      }
    };
  }

  for (const [toolName, message] of mixedTools) {
    it(`ends a mixed ${toolName} first turn in a diagnosable transport_error`, async () => {
      const environment = await createEnvironment();
      const runner = new ScriptedRunner([
        (request) => stream(request, turn(
          mixedControlAction(toolName),
          { messageId: "message-open", text: "I will inspect the VDT graph." }
        ), "opaque-cursor-mixed")
      ]);
      const h = harness({
        runner,
        environment,
        executeTool: async () => {
          throw new Error("executeTool must not run on a mixed first turn.");
        }
      });
      const context = { brief: "mixed-open" };
      const session = await h.engine.openSession({
        binding: bindingFor(h.engine),
        initialContext: context,
        initialContextHash: hashText(JSON.stringify(context))
      }, h.host);
      const events = await collect(session.events());
      expect(session.binding.externalSessionId).toBe("opaque-cursor-mixed");
      expect(runner.requests[0]?.stdin).toContain(CHECKPOINT_ACTION_BATCH_CONTRACT_PROMPT_RULE);
      expect(runner.requests[0]?.stdin).toContain(CHECKPOINT_FINISH_ORDER_PROMPT_RULE);
      expect(events).toEqual([{
        type: "transport_error",
        code: "ACTION_BATCH_CONTROL_TOOL_MIXED",
        message,
        retryable: true
      }]);
    });
  }

  it("still fails loudly for a genuine internal error during open", async () => {
    const environment = await createEnvironment();
    const runner = new ScriptedRunner([
      () => {
        throw new Error("sqlite disk I/O failed");
      }
    ]);
    const h = harness({ runner, environment });
    const context = { brief: "internal-open" };
    await expect(h.engine.openSession({
      binding: bindingFor(h.engine),
      initialContext: context,
      initialContextHash: hashText(JSON.stringify(context))
    }, h.host)).rejects.toThrow("sqlite disk I/O failed");
  });
});
