import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { verifyDeterministicRunFinish } from "@vdt-studio/vdt-agent-runtime";
import type {
  VdtGatewayToolCall,
  VdtGatewayToolResult
} from "@vdt-studio/vdt-agent-runtime";
import {
  CodexResumeCheckpointEngine,
  CodexResumeCheckpointTransport,
  VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
  type CheckpointProcessRequest,
  type CheckpointProcessResult,
  type CheckpointProcessRunner,
  type CodexResumeCheckpointEnvironment
} from "@vdt-studio/model-bridge/node";
import type { ExternalCliExecutionBindingDefinition } from "./execution-bindings";
import { TARGET_MODEL_AGENT_TOOLS } from "./model-agent-tool-catalog";
import {
  canaryMetricsSidecarRecordSchema,
  hashCanaryMetricsRunId,
  resolveCanaryMetricsSidecarPath
} from "./canary-metrics-sidecar";

const { detectSubscriptionCli } = vi.hoisted(() => ({
  detectSubscriptionCli: vi.fn()
}));

vi.mock("@vdt-studio/model-bridge/node", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vdt-studio/model-bridge/node")>();
  return {
    ...original,
    detectSubscriptionCli
  };
});

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtAgentRuntime?: unknown;
  __vdtAgentExecutionBindingRegistry?: unknown;
  __vdtExternalAgentEngines?: unknown;
  __vdtCursorSessionBindingProbe?: unknown;
  __vdtCliSessionRegistrationOutcomes?: unknown;
};

const SEQUENCE_4_TABLES = [
  "agent_session_bindings_v2",
  "agent_session_epochs_v2",
  "agent_engine_checkpoints_v2",
  "agent_engine_exchange_receipts_v2",
  "agent_tool_operation_receipts_v2",
  "agent_finish_receipts_v2",
  "agent_run_event_outbox_v2"
] as const;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-qes-01-"));
const temporaryDirectories: string[] = [dataDir];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  detectSubscriptionCli.mockReset();
  delete runtimeGlobal.__vdtAgentRuntime;
  delete runtimeGlobal.__vdtAgentExecutionBindingRegistry;
  delete runtimeGlobal.__vdtExternalAgentEngines;
  delete runtimeGlobal.__vdtCursorSessionBindingProbe;
  delete runtimeGlobal.__vdtCliSessionRegistrationOutcomes;
  await Promise.all(temporaryDirectories.splice(1).map((directory) =>
    fs.promises.rm(directory, { recursive: true, force: true })
  ));
});

afterAll(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function turn(action: unknown, assistantMessage: unknown = null): string {
  return JSON.stringify({
    protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION,
    assistantMessage,
    action
  });
}

function codexStream(sessionId: string, turnText: string): string {
  return [
    { type: "thread.started", thread_id: sessionId },
    { type: "turn.started" },
    { type: "item.completed", item: { id: "item-1", type: "agent_message", text: turnText } },
    { type: "turn.completed" }
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";
}

class FakeRunner implements CheckpointProcessRunner {
  readonly requests: CheckpointProcessRequest[] = [];
  constructor(
    private readonly respond: (request: CheckpointProcessRequest, index: number) => CheckpointProcessResult
  ) {}

  async run(request: CheckpointProcessRequest): Promise<CheckpointProcessResult> {
    const copy = { ...request, args: [...request.args], environment: { ...request.environment } };
    this.requests.push(copy);
    return this.respond(copy, this.requests.length - 1);
  }
}

async function privateEnvironment(): Promise<CodexResumeCheckpointEnvironment> {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vdt-qes-01-workspace-"));
  const state = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vdt-qes-01-state-"));
  const forbidden = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vdt-qes-01-forbidden-"));
  temporaryDirectories.push(workspace, state, forbidden);
  return {
    environmentId: "env-qes-01",
    privateWorkspacePath: workspace,
    privateStatePath: state,
    forbiddenRoots: [forbidden]
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

async function waitForRunStatus(runId: string, status: string) {
  const { agentRuntime } = await import("./runtime");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = agentRuntime.store.getState(runId);
    if (state.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const state = (await import("./runtime")).agentRuntime.store.getState(runId);
  throw new Error(`Timed out waiting for status "${status}": ${JSON.stringify({
    status: state.status,
    error: state.error
  })}`);
}

async function waitUntilSupervisorReleased(runId: string) {
  const supervisor = await import("./supervisor-runtime");
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (!supervisor.isStructuredModelAgentRunActive(runId)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for supervisor release of ${runId}`);
}

function countSequence4Rows(sqlitePath: string, runId: string): Record<string, number> {
  const db = new DatabaseSync(sqlitePath);
  try {
    const counts: Record<string, number> = {};
    for (const table of SEQUENCE_4_TABLES) {
      const present = db.prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get(table) as { ok: number } | undefined;
      expect(present?.ok, table).toBe(1);
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`).get(runId) as { count: number };
      counts[table] = row.count;
    }
    return counts;
  } finally {
    db.close();
  }
}

function readSidecarLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split("\n").filter((line) => line.trim().length > 0);
}

describe("canary CLI session performanceTelemetry", { timeout: 90_000 }, () => {
  it("persists engine counters on V1 telemetry without Sequence 4 rows or executionSummary grants", async () => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "codex") {
        return {
          id,
          backendId: "codex_subscription",
          alias: "codex",
          installed: true,
          executable: "/opt/vdt-test/bin/codex",
          version: "0.146.0"
        };
      }
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    const supervisor = await import("./supervisor-runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingDefinition = runtime.agentExecutionBindingRegistry.resolve(
      runtime.CODEX_SESSION_EXECUTION_BINDING_ID
    ) as ExternalCliExecutionBindingDefinition;

    const env = await privateEnvironment();
    const runner = new FakeRunner((_request, index) => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream(
        "codex-thread-qes-01",
        turn(
          index === 0
            ? {
                type: "action_batch",
                batch: {
                  calls: [{ externalCallId: "call-list", toolName: "skill.list", args: {} }]
                }
              }
            : {
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
              },
          index === 0 ? { messageId: "message-open", text: "I will inspect the VDT graph." } : null
        )
      ),
      stderr: ""
    }));
    const engine = new CodexResumeCheckpointEngine({
      transport: new CodexResumeCheckpointTransport({
        executable: "/opt/codex/codex",
        validatedCliVersion: bindingDefinition.capability.cli!.version,
        runner
      }),
      cliVersion: bindingDefinition.capability.cli!.version,
      toolCatalogHash: bindingDefinition.capability.toolCatalogHash,
      allowedToolNames: TARGET_MODEL_AGENT_TOOLS,
      sessionEnvironmentFactory: () => env,
      resolveBinding: async () => {
        throw new Error("unused");
      },
      enableUnverifiedCanary: true
    });

    const started = await supervisor.startExternalCliAgentRun({
      request: {
        mode: "generate_vdt",
        input: { prompt: "Build a haulage VDT", rootKpi: "Ore hauled" },
        executionBindingId: runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
        providerId: "external_cli_agent",
        workspace: { projectId: "project_qes_01" },
        options: { researchMode: "off", maxSteps: 8 }
      },
      bindingDefinition,
      engine,
      allowUnqualifiedExternalCanary: true
    });

    const state = await waitForRunStatus(started.runId!, "needs_user_input");
    expect(state.performanceTelemetry.segmentCount).toBe(2);
    expect(state.performanceTelemetry.processSpawnCount).toBe(runner.requests.length);
    expect(state.performanceTelemetry.processSpawnCount).toBe(2);
    expect(state.performanceTelemetry.logicalSessionCount).toBe(1);
    expect(state.performanceTelemetry.resumeCount).toBe(1);
    expect(state.performanceTelemetry.toolCallCount).toBe(2);
    expect(state.performanceTelemetry.opaqueSessionIdHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(state.performanceTelemetry.segmentInferenceMs.length).toBe(2);
    expect(state.performanceTelemetry.decisionLatenciesMs.length).toBe(2);
    expect(JSON.stringify(state.performanceTelemetry)).not.toContain("codex-thread-qes-01");
    expect(state.performanceTelemetry).not.toHaveProperty("qualificationStatus");
    expect(state.executionSummary).not.toHaveProperty("logicalSessionCount");
    expect(state.executionSummary).not.toHaveProperty("processSpawnCount");
    const startedEvents = state.events.filter((event) => event.type === "tool_call_started");
    expect(startedEvents.length).toBeGreaterThan(0);
    expect(startedEvents.every((event) => typeof event.metadata?.toolName === "string" && event.metadata.toolName.length > 0))
      .toBe(true);

    const sqlitePath = path.join(dataDir, "app.sqlite");
    expect(fs.existsSync(sqlitePath)).toBe(true);
    const db = new DatabaseSync(sqlitePath);
    try {
      const persisted = db.prepare(
        "SELECT public_snapshot_json, internal_state_json FROM agent_runs WHERE id = ?"
      ).get(state.runId) as {
        public_snapshot_json: string;
        internal_state_json: string;
      };
      const publicSnapshot = JSON.parse(persisted.public_snapshot_json) as {
        performanceTelemetry?: Record<string, unknown>;
        executionSummary?: Record<string, unknown>;
      };
      const internalState = JSON.parse(persisted.internal_state_json) as {
        performanceTelemetry?: Record<string, unknown>;
        snapshot?: { performanceTelemetry?: Record<string, unknown> };
      };
      expect(publicSnapshot.performanceTelemetry).toMatchObject({
        segmentCount: 2,
        processSpawnCount: 2,
        logicalSessionCount: 1,
        resumeCount: 1,
        toolCallCount: 2
      });
      expect(publicSnapshot.performanceTelemetry).not.toHaveProperty("qualificationStatus");
      expect(publicSnapshot.executionSummary).not.toHaveProperty("logicalSessionCount");
      expect(internalState.performanceTelemetry).toMatchObject({
        segmentCount: 2,
        processSpawnCount: 2,
        logicalSessionCount: 1
      });
      expect(internalState.snapshot?.performanceTelemetry).toMatchObject({
        segmentCount: 2,
        processSpawnCount: 2,
        logicalSessionCount: 1
      });
      for (const table of SEQUENCE_4_TABLES) {
        const present = db.prepare(
          "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(table) as { ok: number } | undefined;
        expect(present?.ok, table).toBe(1);
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE run_id = ?`).get(state.runId) as { count: number };
        expect(row.count, table).toBe(0);
      }
    } finally {
      db.close();
    }

    expect(fs.existsSync(resolveCanaryMetricsSidecarPath())).toBe(false);

    supervisor.resetActiveSupervisorRunsForTests();
  });
});

describe("canary metrics sidecar isolation", { timeout: 90_000 }, () => {
  it("does not grant qualification from a planted sidecar row and writes counters only at terminal", async () => {
    const isolationDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-qes-02-isolation-"));
    temporaryDirectories.push(isolationDir);
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
    vi.stubEnv("VDT_DATA_DIR", isolationDir);
    detectSubscriptionCli.mockImplementation(async (id: string) => {
      if (id === "codex") {
        return {
          id,
          backendId: "codex_subscription",
          alias: "codex",
          installed: true,
          executable: "/opt/vdt-test/bin/codex",
          version: "0.146.0"
        };
      }
      return { id, backendId: id, installed: false, executable: null, version: null, alias: id };
    });

    const runtime = await import("./runtime");
    const supervisor = await import("./supervisor-runtime");
    await runtime.ensureServerManagedExecutionBindings();
    const bindingDefinition = runtime.agentExecutionBindingRegistry.resolve(
      runtime.CODEX_SESSION_EXECUTION_BINDING_ID
    ) as ExternalCliExecutionBindingDefinition;

    const sidecarPath = path.join(isolationDir, "canary-metrics", "counters.jsonl");
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    const planted = {
      schemaVersion: 1,
      recordType: "vdt_canary_metrics_counters",
      recordedAt: "2026-09-13T11:00:00.000Z",
      terminalStatus: "succeeded",
      runIdHash: hashCanaryMetricsRunId("run_planted_grant"),
      opaqueSessionIdHash: `sha256:${"11".repeat(32)}`,
      segmentCount: 99,
      processSpawnCount: 99,
      logicalSessionCount: 1,
      resumeCount: 98,
      sameOpaqueSessionAcrossSegments: true,
      segmentInferenceMs: [1],
      decisionLatenciesMs: [1],
      toolCallCount: 99,
      outputBytes: 0,
      repairCount: 0,
      elapsedWallMs: 1,
      identity: {
        executionProfile: "external_cli_agent",
        engineAdapterId: bindingDefinition.capability.engineAdapterId,
        backendId: bindingDefinition.capability.backendId,
        protocolVersion: bindingDefinition.capability.protocolVersion,
        cliVersion: bindingDefinition.capability.cli.version,
        toolCatalogHash: bindingDefinition.capability.toolCatalogHash,
        os: process.platform,
        arch: process.arch
      },
      qualificationStatus: "qualified",
      toolIsolation: "hard_verified",
      capabilityEvidenceHash: hashText("planted-evidence"),
      qualificationGranted: true
    };
    fs.writeFileSync(sidecarPath, `${JSON.stringify(planted)}\n`);

    const request = {
      mode: "generate_vdt" as const,
      input: { prompt: "Build a haulage VDT", rootKpi: "Ore hauled" },
      executionBindingId: runtime.CODEX_SESSION_EXECUTION_BINDING_ID,
      providerId: "external_cli_agent",
      workspace: { projectId: "project_qes_02" },
      options: { researchMode: "off" as const, maxSteps: 8 }
    };
    const env = await privateEnvironment();
    const runner = new FakeRunner((_request, index) => ({
      exitCode: 0,
      signal: null,
      stdout: codexStream(
        "codex-thread-qes-02",
        turn(
          index === 0
            ? {
                type: "action_batch",
                batch: {
                  calls: [{ externalCallId: "call-list", toolName: "skill.list", args: {} }]
                }
              }
            : {
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
              },
          index === 0 ? { messageId: "message-open", text: "I will inspect the VDT graph." } : null
        )
      ),
      stderr: ""
    }));
    const engine = new CodexResumeCheckpointEngine({
      transport: new CodexResumeCheckpointTransport({
        executable: "/opt/codex/codex",
        validatedCliVersion: bindingDefinition.capability.cli!.version,
        runner
      }),
      cliVersion: bindingDefinition.capability.cli!.version,
      toolCatalogHash: bindingDefinition.capability.toolCatalogHash,
      allowedToolNames: TARGET_MODEL_AGENT_TOOLS,
      sessionEnvironmentFactory: () => env,
      resolveBinding: async () => {
        throw new Error("unused");
      },
      enableUnverifiedCanary: true
    });

    await expect(supervisor.startExternalCliAgentRun({
      request,
      bindingDefinition,
      engine,
      allowUnqualifiedExternalCanary: false
    })).rejects.toMatchObject({ code: "AGENT_EXTERNAL_CAPABILITY_UNQUALIFIED" });

    expect(bindingDefinition.capability.qualification.status).toBe("unverified");
    expect(bindingDefinition.capability.toolIsolation).toBe("unverified");
    expect(bindingDefinition.capability.qualification.evidenceHash).toBeNull();

    const started = await supervisor.startExternalCliAgentRun({
      request,
      bindingDefinition,
      engine,
      allowUnqualifiedExternalCanary: true
    });
    const state = await waitForRunStatus(started.runId!, "needs_user_input");
    expect(bindingDefinition.capability.qualification.status).toBe("unverified");
    expect(state.executionSummary?.qualificationStatus).not.toBe("qualified");
    expect(state.executionSummary?.toolIsolation).not.toBe("hard_verified");
    expect(state.executionSummary?.capabilityEvidenceHash ?? null).toBeNull();
    expect(state.performanceTelemetry.segmentCount).toBe(2);
    expect(readSidecarLines(sidecarPath)).toHaveLength(1);

    const durable = state.supervisorPersistenceV2;
    expect(durable?.binding.qualificationStatus).toBe("unverified");
    const finish = verifyDeterministicRunFinish({
      binding: durable!.binding,
      project: state.draftProject ?? state.project ?? null,
      currentRevision: 0,
      expectedHeadRevision: 0,
      mode: "generate_vdt",
      pendingQuestion: true,
      pendingApproval: false,
      pendingProposal: false,
      ambiguousOperation: false,
      supervisorState: durable
    });
    expect(finish.accepted).toBe(false);
    expect(finish.code).not.toBe("FINISH_VERIFIED");

    const sqlitePath = path.join(isolationDir, "app.sqlite");
    expect(countSequence4Rows(sqlitePath, state.runId)).toEqual({
      agent_session_bindings_v2: 0,
      agent_session_epochs_v2: 0,
      agent_engine_checkpoints_v2: 0,
      agent_engine_exchange_receipts_v2: 0,
      agent_tool_operation_receipts_v2: 0,
      agent_finish_receipts_v2: 0,
      agent_run_event_outbox_v2: 0
    });

    await supervisor.cancelStructuredModelAgentRun(state.runId);
    await waitUntilSupervisorReleased(state.runId);

    const lines = readSidecarLines(sidecarPath);
    expect(lines).toHaveLength(2);
    const written = canaryMetricsSidecarRecordSchema.parse(JSON.parse(lines[1]!));
    expect(written.runIdHash).toBe(hashCanaryMetricsRunId(state.runId));
    expect(JSON.stringify(written)).not.toContain(state.runId);
    expect(written.segmentCount).toBe(2);
    expect(written.processSpawnCount).toBe(2);
    expect(written.logicalSessionCount).toBe(1);
    expect(written.terminalStatus).toBe("cancelled");
    expect(written).not.toHaveProperty("autoAnswered");
    expect(written).not.toHaveProperty("qualificationStatus");
    expect(written).not.toHaveProperty("toolIsolation");
    expect(written).not.toHaveProperty("capabilityEvidenceHash");
    expect(written).not.toHaveProperty("qualificationGranted");
    expect(written.identity).toMatchObject({
      executionProfile: "external_cli_agent",
      engineAdapterId: bindingDefinition.capability.engineAdapterId,
      backendId: bindingDefinition.capability.backendId,
      toolCatalogHash: bindingDefinition.capability.toolCatalogHash
    });

    expect(countSequence4Rows(sqlitePath, state.runId)).toEqual({
      agent_session_bindings_v2: 0,
      agent_session_epochs_v2: 0,
      agent_engine_checkpoints_v2: 0,
      agent_engine_exchange_receipts_v2: 0,
      agent_tool_operation_receipts_v2: 0,
      agent_finish_receipts_v2: 0,
      agent_run_event_outbox_v2: 0
    });
    expect(bindingDefinition.capability.qualification.status).toBe("unverified");
    expect(bindingDefinition.capability.toolIsolation).toBe("unverified");

    const artifactDir = process.env.VDT_QES02_ARTIFACT_DIR;
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.copyFileSync(sidecarPath, path.join(artifactDir, "counters.jsonl"));
      fs.copyFileSync(sqlitePath, path.join(artifactDir, "app.sqlite"));
      fs.writeFileSync(path.join(artifactDir, "run-id.txt"), `${state.runId}\n`);
    }

    supervisor.resetActiveSupervisorRunsForTests();
  });
});
