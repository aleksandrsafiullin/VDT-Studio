import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import type {
  AgentCapabilityProfile,
  AgentSessionBinding
} from "./agent-execution-contracts";
import { AgentRunStore } from "./run-store";
import { InMemoryAgentSupervisorPersistence } from "./agent-supervisor-persistence";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";
import { AgentSupervisorToolGatewayLedger } from "./tool-gateway-persistence";
import {
  InMemoryVdtToolGatewayLedger,
  VdtToolGateway,
  VdtToolGatewayError,
  type VdtGatewayOperationReceipt
} from "./tool-gateway";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

describe("VdtToolGateway", () => {
  it("deduplicates a stable external call without re-running the tool", async () => {
    const fixture = gatewayFixture();

    const first = await fixture.gateway.execute({
      externalCallId: "call-1",
      toolName: "vdt.echo",
      args: { value: "hello" }
    });
    const replay = await fixture.gateway.execute({
      externalCallId: "call-1",
      toolName: "vdt.echo",
      args: { value: "hello" }
    });

    expect(first).toMatchObject({ status: "succeeded", resultCode: "OK" });
    expect(replay).toEqual(first);
    expect(fixture.getExecutions()).toBe(1);
    expect(fixture.ledger.list(fixture.binding.bindingId)).toHaveLength(1);
  });

  it("rejects call-id reuse with different canonical arguments", async () => {
    const fixture = gatewayFixture();
    await fixture.gateway.execute({ externalCallId: "same", toolName: "vdt.echo", args: { value: "a" } });

    const result = await fixture.gateway.execute({
      externalCallId: "same",
      toolName: "vdt.echo",
      args: { value: "b" }
    });

    expect(result).toMatchObject({ status: "failed", resultCode: "CALL_ID_REUSE" });
    expect(fixture.getExecutions()).toBe(1);
  });

  it("preserves a failed terminal status on replay so a batch cannot continue", async () => {
    const fixture = gatewayFixture({ allowedTools: new Set(["vdt.missing"]) });
    const call = {
      externalCallId: "failed-call",
      toolName: "vdt.missing",
      args: {}
    };

    const first = await fixture.gateway.execute(call);
    const replay = await fixture.gateway.execute(call);

    expect(first).toMatchObject({ status: "failed", resultCode: "UNKNOWN_TOOL" });
    expect(replay).toEqual(first);
  });

  it("does not accept run or authority fields on the strict wire call", async () => {
    const fixture = gatewayFixture();
    const result = await fixture.gateway.execute({
      externalCallId: "authority-injection",
      toolName: "vdt.echo",
      args: {},
      runId: "another-run"
    } as never);

    expect(result).toMatchObject({ status: "failed", resultCode: "INVALID_GATEWAY_CALL" });
    expect(fixture.getExecutions()).toBe(0);

    const nested = await fixture.gateway.execute({
      externalCallId: "nested-authority-injection",
      toolName: "vdt.echo",
      args: { payload: [{ project_id: "another-project" }] }
    });
    expect(nested).toMatchObject({ status: "failed", resultCode: "INVALID_GATEWAY_CALL" });
    expect(fixture.getExecutions()).toBe(0);
  });

  it("rejects a stale mutating call and returns a server-derived reconciliation delta", async () => {
    const fixture = baseFixture();
    const builder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
    builder.createDraft({ projectTitle: "Ore hauled", rootKpi: "Ore hauled" });
    fixture.store.updateRun(fixture.state.runId, { builder, draftProject: builder.getProject() });
    let mutations = 0;
    fixture.registry.register({
      name: "vdt.rename_root",
      description: "Rename the current root.",
      inputSchema: z.object({ name: z.string() }).strict(),
      outputSchema: z.object({ revision: z.number().int() }).strict(),
      mutatesProject: true,
      run: (_context, input) => {
        mutations += 1;
        builder.updateNode({ nodeId: builder.getProject().rootNodeId, patch: { name: input.name } });
        return { revision: builder.getRevision() };
      }
    });
    const context = (): AgentToolContext => ({
      ...fixture.context(),
      builder
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: context,
      allowedTools: new Set(["vdt.rename_root"]),
      revisionReconciliation: ({ expectedRevision, currentRevision }) => ({
        expectedRevision,
        currentRevision,
        manualChanges: [{ kind: "node_updated" }]
      })
    });

    const expectedRevision = builder.getRevision();
    builder.updateNode({ nodeId: builder.getProject().rootNodeId, patch: { name: "Manual name" } });
    const currentRevision = builder.getRevision();
    const stale = await gateway.execute({
      externalCallId: "stale-mutation",
      toolName: "vdt.rename_root",
      args: { name: "Stale model name" }
    });

    expect(stale).toMatchObject({
      status: "failed",
      resultCode: "STALE_REVISION",
      payload: {
        expectedRevision,
        currentRevision,
        reconciliationDelta: {
          expectedRevision,
          currentRevision,
          manualChanges: [{ kind: "node_updated" }]
        }
      }
    });
    expect(mutations).toBe(0);
    expect(builder.getProject().graph.nodes.find((node) => node.id === builder.getProject().rootNodeId)?.name)
      .toBe("Manual name");

    const corrected = await gateway.execute({
      externalCallId: "corrected-mutation",
      toolName: "vdt.rename_root",
      args: { name: "Reconciled model name" }
    });
    expect(corrected.status).toBe("succeeded");
    expect(mutations).toBe(1);
  });

  it("fails closed for forbidden native-tool surfaces", async () => {
    const fixture = gatewayFixture({ allowedTools: new Set(["shell.exec"]) });
    const result = await fixture.gateway.execute({
      externalCallId: "forbidden",
      toolName: "shell.exec",
      args: { command: "pwd" }
    });

    expect(result).toMatchObject({ status: "failed", resultCode: "SECURITY_BOUNDARY_BREACH" });
  });

  it("seals the head after verified finish and rejects every new cognitive tool call", async () => {
    const fixture = baseFixture();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo", "run.request_finish"]),
      requestFinish: async (request) => {
        expect(request.expectedProjectRevision).toBeNull();
        return {
          accepted: true,
          code: "FINISH_VERIFIED",
          payload: {
            receiptId: "finish-receipt-sealed",
            receiptHash: HASH_A,
            projectRevision: 7
          }
        };
      }
    });

    await expect(gateway.execute({
      externalCallId: "finish-seal",
      toolName: "run.request_finish",
      args: {}
    })).resolves.toMatchObject({ status: "succeeded", resultCode: "FINISH_VERIFIED" });
    await expect(gateway.execute({
      externalCallId: "after-finish",
      toolName: "vdt.echo",
      args: { value: "must not run" }
    })).resolves.toMatchObject({ status: "failed", resultCode: "FINISH_ALREADY_VERIFIED" });
    expect(fixture.getExecutions()).toBe(0);
  });

  it("requires a qualified hard-isolated capability for external execution", () => {
    const fixture = baseFixture();
    const capability: AgentCapabilityProfile = {
      ...fixture.modelCapability,
      executionProfile: "external_cli_agent",
      sessionStrategy: "native",
      cli: { name: "Cursor Agent", version: "2026.08.11" },
      toolIsolation: "permission_only",
      qualification: {
        ...fixture.modelCapability.qualification,
        status: "unverified"
      }
    };
    const binding: AgentSessionBinding = {
      ...fixture.binding,
      executionProfile: "external_cli_agent",
      cliVersion: capability.cli.version,
      toolIsolation: capability.toolIsolation,
      qualificationStatus: capability.qualification.status,
      capabilityEvidenceHash: capability.qualification.evidenceHash
    };

    expect(() => new VdtToolGateway({
      binding,
      capability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"])
    })).toThrowError(VdtToolGatewayError);
  });

  it("replays the exact terminal result from durable Sequence 4 receipts after restart", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(fixture.binding);
    const makeGateway = () => new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger: new AgentSupervisorToolGatewayLedger({
        binding: fixture.binding,
        persistence
      })
    });

    const first = await makeGateway().execute({
      externalCallId: "durable-call",
      toolName: "vdt.echo",
      args: { value: "persisted" }
    });
    const replay = await makeGateway().execute({
      externalCallId: "durable-call",
      toolName: "vdt.echo",
      args: { value: "persisted" }
    });

    expect(first).toMatchObject({ status: "succeeded" });
    expect(replay).toEqual(first);
    expect(fixture.getExecutions()).toBe(1);
    await expect(persistence.getToolOperationReceipt(fixture.binding.runId, "durable-call"))
      .resolves.toMatchObject({ state: "completed", replayResult: first });
  });

  it("atomically reserves one durable call across concurrent gateway instances", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(fixture.binding);
    const makeGateway = () => new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger: new AgentSupervisorToolGatewayLedger({
        binding: fixture.binding,
        persistence
      })
    });
    const call = {
      externalCallId: "concurrent-durable-call",
      toolName: "vdt.echo",
      args: { value: "execute-once" }
    } as const;

    const results = await Promise.all([
      makeGateway().execute(call),
      makeGateway().execute(call)
    ]);

    expect(fixture.getExecutions()).toBe(1);
    expect(results.filter((result) => result.status === "succeeded")).toHaveLength(1);
    expect(results.filter((result) => result.resultCode === "AMBIGUOUS_TOOL_CALL")).toHaveLength(1);
    await expect(persistence.getToolOperationReceipt(
      fixture.binding.runId,
      call.externalCallId
    )).resolves.toMatchObject({ state: "completed" });
  });

  it("marks a commit boundary ambiguous instead of rewriting a successful mutation as failed", async () => {
    const fixture = baseFixture();
    let mutations = 0;
    fixture.registry.register({
      name: "vdt.commit_once",
      description: "Commit one test mutation.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ committed: z.literal(true) }).strict(),
      mutatesProject: true,
      run: () => {
        mutations += 1;
        return { committed: true as const };
      }
    });
    const ledger = new TerminalWriteFailureLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.commit_once"]),
      ledger
    });
    const call = {
      externalCallId: "commit-before-receipt",
      toolName: "vdt.commit_once",
      args: {}
    } as const;

    await expect(gateway.execute(call)).rejects.toMatchObject({
      code: "AMBIGUOUS_TOOL_CALL"
    });
    expect(mutations).toBe(1);
    expect(ledger.list(fixture.binding.bindingId)).toMatchObject([{ state: "ambiguous" }]);
    expect("result" in ledger.list(fixture.binding.bindingId)[0]!).toBe(false);

    const replay = await gateway.execute(call);
    expect(replay).toMatchObject({ status: "failed", resultCode: "AMBIGUOUS_TOOL_CALL" });
    expect(mutations).toBe(1);
  });

  it("keeps a terminal success authoritative when only event persistence fails", async () => {
    const fixture = baseFixture();
    const ledger = new InMemoryVdtToolGatewayLedger();
    const call = {
      externalCallId: "success-before-event-failure",
      toolName: "vdt.echo",
      args: { value: "committed" }
    } as const;
    const failingGateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger,
      emit: (event) => {
        if (event.type === "tool_result") throw new Error("outbox unavailable");
      }
    });

    await expect(failingGateway.execute(call)).rejects.toMatchObject({
      code: "GATEWAY_EVENT_PERSIST_FAILED"
    });
    expect(ledger.list(fixture.binding.bindingId)).toEqual([
      expect.objectContaining({ state: "completed", result: expect.objectContaining({ status: "succeeded" }) })
    ]);

    const replayGateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger
    });
    await expect(replayGateway.execute(call)).resolves.toMatchObject({
      status: "succeeded",
      resultCode: "OK"
    });
    expect(fixture.getExecutions()).toBe(1);
  });

  it("serializes a trusted approval mutation behind model tool work and receipts its terminal result", async () => {
    const fixture = baseFixture();
    let releaseModel!: () => void;
    const modelBlocked = new Promise<void>((resolve) => { releaseModel = resolve; });
    const order: string[] = [];
    fixture.registry.register({
      name: "vdt.blocking_mutation",
      description: "Hold the model mutation serialization slot.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      mutatesProject: true,
      run: async () => {
        order.push("model-start");
        await modelBlocked;
        order.push("model-end");
        return { ok: true as const };
      }
    });
    const ledger = new InMemoryVdtToolGatewayLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.blocking_mutation"]),
      ledger
    });
    const model = gateway.execute({
      externalCallId: "model-mutation",
      toolName: "vdt.blocking_mutation",
      args: {}
    });
    await viWaitFor(() => order.includes("model-start"));
    const approval = gateway.executeTrustedControlOperation({
      externalCallId: "approval-proposal-1",
      toolName: "control.apply_approved_proposal",
      args: { proposalId: "proposal-1", selectedChangeIds: ["change-1"] }
    }, () => {
      order.push("approval-apply");
      return {
        status: "succeeded",
        resultCode: "APPROVED_PROPOSAL_APPLIED",
        payload: { proposalId: "proposal-1" },
        projectChanged: true
      };
    });
    await Promise.resolve();
    expect(order).toEqual(["model-start"]);
    releaseModel();

    await expect(model).resolves.toMatchObject({ status: "succeeded" });
    await expect(approval).resolves.toMatchObject({
      replayed: false,
      result: { status: "succeeded", resultCode: "APPROVED_PROPOSAL_APPLIED" }
    });
    expect(order).toEqual(["model-start", "model-end", "approval-apply"]);
    expect(ledger.list(fixture.binding.bindingId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalCallId: "approval-proposal-1",
        toolName: "control.apply_approved_proposal",
        state: "completed"
      })
    ]));
  });

  it("replays a durable approval result without applying its proposal twice", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(fixture.binding);
    let applies = 0;
    const makeGateway = () => new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger: new AgentSupervisorToolGatewayLedger({
        binding: fixture.binding,
        persistence
      })
    });
    const call = {
      externalCallId: "approval-proposal-durable",
      toolName: "control.apply_approved_proposal",
      args: { proposalId: "proposal-durable", selectedChangeIds: ["change-a"] }
    } as const;
    const apply = () => {
      applies += 1;
      return {
        status: "succeeded" as const,
        resultCode: "APPROVED_PROPOSAL_APPLIED",
        payload: { proposalId: "proposal-durable", committedRevision: 2 },
        projectChanged: true
      };
    };

    const first = await makeGateway().executeTrustedControlOperation(call, apply);
    const replay = await makeGateway().executeTrustedControlOperation(call, apply);

    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ result: first.result, replayed: true });
    expect(applies).toBe(1);
    await expect(persistence.getToolOperationReceipt(
      fixture.binding.runId,
      call.externalCallId
    )).resolves.toMatchObject({
      state: "completed",
      toolName: "control.apply_approved_proposal",
      replayResult: first.result
    });
  });

  it("does not re-run an approval after an ambiguous commit boundary", async () => {
    const fixture = baseFixture();
    const ledger = new TerminalWriteFailureLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.echo"]),
      ledger
    });
    const call = {
      externalCallId: "approval-commit-ambiguous",
      toolName: "control.apply_approved_proposal",
      args: { proposalId: "proposal-ambiguous", selectedChangeIds: ["change-a"] }
    } as const;
    let applies = 0;
    const apply = () => {
      applies += 1;
      return {
        status: "succeeded" as const,
        resultCode: "APPROVED_PROPOSAL_APPLIED",
        payload: { proposalId: "proposal-ambiguous" },
        projectChanged: true
      };
    };

    await expect(gateway.executeTrustedControlOperation(call, apply)).rejects.toMatchObject({
      code: "AMBIGUOUS_TOOL_CALL"
    });
    await expect(gateway.executeTrustedControlOperation(call, apply)).resolves.toMatchObject({
      replayed: true,
      result: { status: "failed", resultCode: "AMBIGUOUS_TOOL_CALL" }
    });
    expect(applies).toBe(1);
  });
});

async function viWaitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for the gateway test condition.");
}

class TerminalWriteFailureLedger extends InMemoryVdtToolGatewayLedger {
  private failed = false;

  override async put(receipt: VdtGatewayOperationReceipt): Promise<void> {
    if (!this.failed && receipt.state === "completed") {
      this.failed = true;
      throw new Error("terminal receipt acknowledgement lost");
    }
    await super.put(receipt);
  }
}

function gatewayFixture(options: { allowedTools?: ReadonlySet<string> } = {}) {
  const fixture = baseFixture();
  const ledger = new InMemoryVdtToolGatewayLedger();
  const gateway = new VdtToolGateway({
    binding: fixture.binding,
    capability: fixture.modelCapability,
    tools: fixture.registry,
    toolContext: fixture.context,
    allowedTools: options.allowedTools ?? new Set(["vdt.echo"]),
    ledger
  });
  return { ...fixture, gateway, ledger };
}

function baseFixture() {
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register({
    name: "vdt.echo",
    description: "Echo a bounded value.",
    inputSchema: z.object({ value: z.string().optional() }).strict(),
    outputSchema: z.object({ value: z.string().nullable() }).strict(),
    run: (_context, input) => {
      executions += 1;
      return { value: input.value ?? null };
    }
  });

  const store = new AgentRunStore({ now: () => "2026-08-26T10:00:00.000Z" });
  const state = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Ore hauled" },
    workspace: { projectId: "project-1" },
    providerId: "model-test"
  });
  const context = (): AgentToolContext => ({
    runId: state.runId,
    store,
    emit: (event) => { store.appendEvent(state.runId, event); },
    getRun: () => store.getSnapshot(state.runId),
    updateRun: (patch) => { store.updateRun(state.runId, patch); },
    signal: store.getState(state.runId).abortController.signal
  });

  const binding: AgentSessionBinding = {
    schemaVersion: 2,
    bindingId: "binding-1",
    runId: state.runId,
    projectId: "project-1",
    executionProfile: "model_agent",
    engineId: "model-engine",
    engineAdapterId: "model-structured-turn",
    backendId: "model-test",
    modelId: "model-1",
    protocolVersion: "model-turn.v1",
    cliVersion: null,
    toolIsolation: "hard_verified",
    qualificationStatus: "qualified",
    capabilityEvidenceHash: HASH_B,
    settingsHash: HASH_A,
    capabilityProfileHash: HASH_B,
    toolCatalogHash: HASH_A,
    externalSessionId: null,
    sessionEpoch: 1,
    boundAt: "2026-08-26T10:00:00.000Z"
  };
  const modelCapability: AgentCapabilityProfile = {
    schemaVersion: 1,
    executionProfile: "model_agent",
    engineId: "model-engine",
    engineAdapterId: "model-structured-turn",
    backendId: "model-test",
    protocolVersion: "model-turn.v1",
    sessionStrategy: "structured_turn",
    toolCatalogHash: HASH_A,
    toolIsolation: "hard_verified",
    qualification: {
      status: "qualified",
      platform: { os: "test", arch: "test", runtimeVersion: null },
      testedAt: "2026-08-26T10:00:00.000Z",
      evidenceHash: HASH_B
    },
    supportsNativeSession: false,
    supportsResume: true,
    supportsStructuredEvents: true,
    supportsToolBridge: true,
    supportsQuestions: true,
    supportsCancellation: true,
    supportsUsageMetrics: false,
    cli: null
  };

  return {
    binding,
    modelCapability,
    registry,
    context,
    store,
    state,
    getExecutions: () => executions
  };
}
