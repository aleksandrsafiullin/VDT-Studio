import { describe, expect, it } from "vitest";
import { z } from "zod";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import type {
  AgentCapabilityProfile,
  AgentSessionBinding
} from "./agent-execution-contracts";
import { AgentRunStore } from "./run-store";
import { InMemoryAgentSupervisorPersistence } from "./agent-supervisor-persistence";
import { AgentToolError, ToolRegistry, type AgentToolContext } from "./tool-registry";
import { createDefaultToolRegistry } from "./tools";
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
      .resolves.toMatchObject({
        state: "completed",
        replayResult: JSON.parse(JSON.stringify(first))
      });
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

  it("returns a failed delete_node envelope instead of an ambiguous receipt when a formula still references the node", async () => {
    const fixture = baseFixture();
    const builder = haulageBuilder();
    fixture.store.updateRun(fixture.state.runId, {
      builder,
      draftProject: builder.getProject(),
      request: {
        ...fixture.store.getState(fixture.state.runId).request,
        options: { autoApplyPatches: true }
      }
    });
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(fixture.binding);
    const ledger = new AgentSupervisorToolGatewayLedger({
      binding: fixture.binding,
      persistence,
      getRevision: () => builder.getRevision()
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: createDefaultToolRegistry(),
      toolContext: () => ({
        ...fixture.context(),
        builder
      }),
      allowedTools: new Set(["vdt.delete_node"]),
      ledger
    });

    const result = await gateway.execute({
      externalCallId: "delete-referenced-node",
      toolName: "vdt.delete_node",
      args: { nodeId: "truck_working_time", cascadeEdges: true }
    });

    expect(result).toMatchObject({
      status: "failed",
      resultCode: "MUTATION_VALIDATION_FAILED"
    });
    expect(builder.getProject().graph.nodes.map((node) => node.id)).toContain("truck_working_time");
    expect(fixture.store.getSnapshot(fixture.state.runId).events.map((event) => event.type))
      .toEqual(expect.arrayContaining(["mutation_rejected"]));
    await expect(persistence.getToolOperationReceipt(
      fixture.binding.runId,
      "delete-referenced-node"
    )).resolves.toMatchObject({
      state: "failed",
      resultCode: "MUTATION_VALIDATION_FAILED"
    });
  });

  it("persists a failed add_driver receipt when the formula references a missing node", async () => {
    const fixture = baseFixture();
    const builder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
    builder.createDraft({ projectTitle: "Haulage", rootKpi: "Ore hauled" });
    fixture.store.updateRun(fixture.state.runId, {
      builder,
      draftProject: builder.getProject(),
      request: {
        ...fixture.store.getState(fixture.state.runId).request,
        options: { autoApplyPatches: true }
      }
    });
    const persistence = new InMemoryAgentSupervisorPersistence();
    await persistence.createBinding(fixture.binding);
    const ledger = new AgentSupervisorToolGatewayLedger({
      binding: fixture.binding,
      persistence,
      getRevision: () => builder.getRevision()
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: createDefaultToolRegistry(),
      toolContext: () => ({
        ...fixture.context(),
        builder
      }),
      allowedTools: new Set(["vdt.add_driver"]),
      ledger
    });

    const result = await gateway.execute({
      externalCallId: "add-cycle-time-08",
      toolName: "vdt.add_driver",
      args: {
        parentNodeId: builder.getProject().rootNodeId,
        nodeId: "cycle_time",
        name: "Cycle time",
        type: "calculated",
        formula: "loading_time_h"
      }
    });

    expect(result).toMatchObject({
      status: "failed",
      resultCode: "MUTATION_VALIDATION_FAILED"
    });
    expect(JSON.stringify(result.payload)).toContain("loading_time_h");
    expect(builder.getProject().graph.nodes.map((node) => node.id)).not.toContain("cycle_time");
    expect(gateway.persistFailureCount()).toBe(0);
    await expect(persistence.getToolOperationReceipt(
      fixture.binding.runId,
      "add-cycle-time-08"
    )).resolves.toMatchObject({
      state: "failed",
      resultCode: "MUTATION_VALIDATION_FAILED",
      replayResult: expect.objectContaining({
        status: "failed",
        resultCode: "MUTATION_VALIDATION_FAILED"
      })
    });
    const stored = await persistence.getToolOperationReceipt(
      fixture.binding.runId,
      "add-cycle-time-08"
    );
    expect(JSON.stringify(stored?.replayResult)).toContain("loading_time_h");
  });

  it("does not write an ambiguous receipt when lastToolResult persist throws after a rejected mutation", async () => {
    const fixture = baseFixture();
    const builder = haulageBuilder();
    fixture.store.updateRun(fixture.state.runId, {
      builder,
      draftProject: builder.getProject(),
      request: {
        ...fixture.store.getState(fixture.state.runId).request,
        options: { autoApplyPatches: true }
      }
    });
    const ledger = new InMemoryVdtToolGatewayLedger();
    const tools = createDefaultToolRegistry();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools,
      toolContext: () => ({
        ...fixture.context(),
        builder,
        updateRun: (patch) => {
          if (patch.lastToolResult) {
            throw new Error("lastToolResult persist failed");
          }
          fixture.store.updateRun(fixture.state.runId, patch);
        }
      }),
      allowedTools: new Set(["vdt.delete_node"]),
      ledger
    });

    const result = await gateway.execute({
      externalCallId: "delete-referenced-persist-fail",
      toolName: "vdt.delete_node",
      args: { nodeId: "truck_working_time", cascadeEdges: true }
    });

    expect(result).toMatchObject({
      status: "failed",
      resultCode: "MUTATION_VALIDATION_FAILED"
    });
    expect(ledger.list(fixture.binding.bindingId).map((receipt) => receipt.state)).toEqual(["failed"]);
    expect(tools.persistFailureCount()).toBe(1);
  });

  it("keeps a receipt ambiguous when a tool commits and then throws", async () => {
    const fixture = baseFixture();
    const builder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
    builder.createDraft({ projectTitle: "Haulage", rootKpi: "Ore hauled" });
    const revisionBefore = builder.getRevision();
    class CommitThenThrowRegistry extends ToolRegistry {
      override async run(name: string, args: unknown, context: AgentToolContext) {
        if (name === "vdt.commit_then_throw") {
          context.builder!.updateNode({
            nodeId: context.builder!.getProject().rootNodeId,
            patch: { name: "Committed then threw" }
          });
          throw new Error("post-commit boom");
        }
        return super.run(name, args, context);
      }
    }
    const registry = new CommitThenThrowRegistry();
    registry.register({
      name: "vdt.commit_then_throw",
      description: "Commit then throw.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      mutatesProject: true,
      run: () => {
        throw new Error("registry override should run instead");
      }
    });
    fixture.store.updateRun(fixture.state.runId, { builder, draftProject: builder.getProject() });
    const ledger = new InMemoryVdtToolGatewayLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: registry,
      toolContext: () => ({
        ...fixture.context(),
        builder
      }),
      allowedTools: new Set(["vdt.commit_then_throw"]),
      ledger
    });

    await expect(gateway.execute({
      externalCallId: "commit-then-throw",
      toolName: "vdt.commit_then_throw",
      args: {}
    })).rejects.toMatchObject({ code: "AMBIGUOUS_TOOL_CALL" });
    expect(builder.getRevision()).toBeGreaterThan(revisionBefore);
    expect(ledger.list(fixture.binding.bindingId)).toMatchObject([{
      externalCallId: "commit-then-throw",
      state: "ambiguous"
    }]);
  });

  it("treats a sealed finish throw as ambiguous even though revision is unchanged", async () => {
    const fixture = baseFixture();
    const ledger = new InMemoryVdtToolGatewayLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["run.request_finish"]),
      ledger,
      requestFinish: async () => {
        gateway.sealVerifiedFinish({
          receiptId: "finish-receipt-sealed-then-threw",
          projectRevision: 7
        });
        throw new Error("finish receipt persist failed after seal");
      }
    });

    await expect(gateway.execute({
      externalCallId: "finish-seal-then-throw",
      toolName: "run.request_finish",
      args: {}
    })).rejects.toMatchObject({ code: "AMBIGUOUS_TOOL_CALL" });
    expect(ledger.list(fixture.binding.bindingId)).toMatchObject([{
      externalCallId: "finish-seal-then-throw",
      state: "ambiguous"
    }]);
  });

  it("does not copy the previous call's lastToolResult onto this failed call", async () => {
    const fixture = gatewayFixture();
    fixture.store.updateRun(fixture.state.runId, {
      lastToolResult: {
        toolName: "vdt.echo",
        ok: false,
        error: { code: "PREVIOUS_CALL_FAILED", message: "Stale previous error." },
        projectChanged: false,
        emittedEventIds: []
      }
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["run.request_finish"]),
      ledger: fixture.ledger,
      requestFinish: async () => {
        throw new AgentToolError("THIS_CALL_FAILED", "This finish check failed.");
      }
    });

    const result = await gateway.execute({
      externalCallId: "finish-unsealed-throw",
      toolName: "run.request_finish",
      args: {}
    });

    expect(result).toMatchObject({
      status: "failed",
      resultCode: "THIS_CALL_FAILED"
    });
    expect(result.resultCode).not.toBe("PREVIOUS_CALL_FAILED");
    expect(fixture.ledger.list(fixture.binding.bindingId)).toMatchObject([{
      externalCallId: "finish-unsealed-throw",
      state: "failed",
      result: expect.objectContaining({ resultCode: "THIS_CALL_FAILED" })
    }]);
  });

  it("does not execute a registry tool after tool_call if the run was cancelled", async () => {
    const fixture = baseFixture();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let toolCallStarted!: () => void;
    const toolCallSeen = new Promise<void>((resolve) => { toolCallStarted = resolve; });
    let executions = 0;
    fixture.registry.register({
      name: "vdt.gated",
      description: "Must not run after cancel.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      run: () => {
        executions += 1;
        return { ok: true as const };
      }
    });
    const ledger = new InMemoryVdtToolGatewayLedger();
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["vdt.gated"]),
      ledger,
      emit: async (event) => {
        if (event.type === "tool_call") {
          toolCallStarted();
          await blocked;
        }
      }
    });

    const execution = gateway.execute({
      externalCallId: "cancelled-after-tool-call",
      toolName: "vdt.gated",
      args: {}
    });
    await toolCallSeen;
    fixture.store.getState(fixture.state.runId).abortController.abort("User cancelled the run.");
    release();

    await expect(execution).resolves.toMatchObject({
      status: "failed",
      resultCode: "RUN_CANCELLED"
    });
    expect(executions).toBe(0);
    expect(ledger.list(fixture.binding.bindingId)).toMatchObject([{
      externalCallId: "cancelled-after-tool-call",
      state: "failed"
    }]);
  });

  it("returns RESEARCH_PROVIDER_NOT_CONFIGURED with user.ask feedback and does not retry the same call", async () => {
    const fixture = baseFixture();
    fixture.store.updateRun(fixture.state.runId, {
      request: {
        ...fixture.state.request,
        options: { researchMode: "on" }
      }
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: createDefaultToolRegistry(),
      toolContext: fixture.context,
      allowedTools: new Set(["research.search_web", "user.ask"])
    });
    const call = {
      externalCallId: "research-unconfigured",
      toolName: "research.search_web",
      args: {
        query: "haulage process drivers",
        purpose: "process_components"
      }
    };

    const first = await gateway.execute(call);
    const replay = await gateway.execute(call);
    const secondId = await gateway.execute({
      ...call,
      externalCallId: "research-unconfigured-retry"
    });

    expect(first).toMatchObject({
      status: "failed",
      resultCode: "RESEARCH_PROVIDER_NOT_CONFIGURED",
      payload: {
        error: { code: "RESEARCH_PROVIDER_NOT_CONFIGURED" },
        feedback: {
          kind: "research_required",
          suggestedNextTools: ["user.ask"],
          retryable: false
        }
      }
    });
    expect(replay).toEqual(first);
    expect(secondId).toMatchObject({
      status: "failed",
      resultCode: "RESEARCH_PROVIDER_NOT_CONFIGURED",
      payload: {
        feedback: { kind: "research_required", suggestedNextTools: ["user.ask"] }
      }
    });
  });

  it("reports RESEARCH_PROVIDER_AUTH_FAILED as a non-retryable tool failure suggesting user.ask", async () => {
    const fixture = baseFixture();
    fixture.registry.register({
      name: "research.search_web",
      description: "Broken configured research.",
      inputSchema: z.object({ query: z.string(), purpose: z.string() }).strict(),
      outputSchema: z.record(z.unknown()),
      run: () => {
        throw new AgentToolError(
          "RESEARCH_PROVIDER_AUTH_FAILED",
          "Research provider \"brave\" request failed with status 401."
        );
      }
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["research.search_web"])
    });
    const result = await gateway.execute({
      externalCallId: "research-auth-failed",
      toolName: "research.search_web",
      args: { query: "haulage", purpose: "process_components" }
    });
    expect(result).toMatchObject({
      status: "failed",
      resultCode: "RESEARCH_PROVIDER_AUTH_FAILED",
      payload: {
        feedback: {
          kind: "tool_failed",
          suggestedNextTools: ["user.ask"],
          retryable: false
        }
      }
    });
  });

  it("preserves a persist-path VdtStorageError as non-retryable and does not loop", async () => {
    const fixture = baseFixture();
    let executions = 0;
    fixture.registry.register({
      name: "excavation.write_input_value",
      description: "Write a value that cannot persist.",
      inputSchema: z.object({ nodeId: z.string() }).strict(),
      outputSchema: z.record(z.unknown()),
      mutatesProject: true,
      run: () => {
        executions += 1;
        throw vdtStorageError(
          "PROPOSAL_BASE_NOT_PERSISTED",
          "Proposal run:mutation:28 base revision 28 is not persisted."
        );
      }
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["excavation.write_input_value"])
    });
    const call = {
      externalCallId: "write-missing-base",
      toolName: "excavation.write_input_value",
      args: { nodeId: "payload_t" }
    };
    const first = await gateway.execute(call);
    const replay = await gateway.execute(call);
    const secondId = await gateway.execute({
      ...call,
      externalCallId: "write-missing-base-retry"
    });

    expect(first).toMatchObject({
      status: "failed",
      resultCode: "PROPOSAL_BASE_NOT_PERSISTED",
      payload: {
        feedback: {
          kind: "tool_failed",
          retryable: false
        }
      }
    });
    expect(replay).toEqual(first);
    expect(executions).toBe(2);
    expect(secondId).toMatchObject({
      status: "failed",
      resultCode: "PROPOSAL_BASE_NOT_PERSISTED",
      payload: { feedback: { retryable: false } }
    });
  });

  it("keeps a pending-lock REVISION_CONFLICT retryable", async () => {
    const fixture = baseFixture();
    fixture.registry.register({
      name: "excavation.write_input_value",
      description: "Write while another revision is pending.",
      inputSchema: z.object({ nodeId: z.string() }).strict(),
      outputSchema: z.record(z.unknown()),
      mutatesProject: true,
      run: () => {
        throw vdtStorageError("REVISION_CONFLICT", "Another pending revision owns this VDT.");
      }
    });
    const gateway = new VdtToolGateway({
      binding: fixture.binding,
      capability: fixture.modelCapability,
      tools: fixture.registry,
      toolContext: fixture.context,
      allowedTools: new Set(["excavation.write_input_value"])
    });

    const result = await gateway.execute({
      externalCallId: "write-pending-lock",
      toolName: "excavation.write_input_value",
      args: { nodeId: "payload_t" }
    });

    expect(result).toMatchObject({
      status: "failed",
      resultCode: "REVISION_CONFLICT",
      payload: {
        feedback: {
          kind: "tool_failed",
          retryable: true
        }
      }
    });
  });
});

function haulageBuilder(): VdtBuilderSession {
  const builder = new VdtBuilderSession({ now: () => "2026-08-26T10:00:00.000Z" });
  builder.createDraft({ projectTitle: "Haulage", rootKpi: "Ore hauled" });
  const rootNodeId = builder.getProject().rootNodeId;
  builder.addDriver({
    parentNodeId: rootNodeId,
    nodeId: "truck_working_time",
    name: "Truck working time",
    type: "input",
    baselineValue: 10
  });
  builder.addDriver({
    parentNodeId: rootNodeId,
    nodeId: "truck_count",
    name: "Truck count",
    type: "input",
    baselineValue: 2
  });
  builder.setFormula({
    nodeId: rootNodeId,
    formula: "truck_working_time * truck_count"
  });
  return builder;
}

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

function vdtStorageError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = "VdtStorageError";
  (error as Error & { code: string }).code = code;
  return error;
}
