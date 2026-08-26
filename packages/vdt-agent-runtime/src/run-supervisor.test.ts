import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { productionVolumeProject, VdtBuilderSession } from "@vdt-studio/vdt-core";
import type {
  AgentCapabilityProfile,
  AgentEngineCheckpoint,
  AgentEngineEvent,
  AgentEngineHost,
  AgentEngineStart,
  AgentExecutionEngine,
  AgentHumanInput,
  AgentRunSession,
  AgentSessionBinding
} from "./agent-execution-contracts";
import { AgentRunEventOutbox } from "./agent-event-outbox";
import { AgentRunStore } from "./run-store";
import {
  InMemoryAgentSupervisorPersistence,
  type AgentEngineExchangeReceiptV2,
  type FinishReceiptV2
} from "./agent-supervisor-persistence";
import { VdtRunSupervisor, VdtRunSupervisorError } from "./run-supervisor";
import { verifyDeterministicRunFinish } from "./finish-verifier";
import { ToolRegistry, type AgentToolContext } from "./tool-registry";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

describe("VdtRunSupervisor", () => {
  it("keeps one binding and accepts first message and final from the same session", async () => {
    const fixture = supervisorFixture(async function* (host) {
      yield { type: "assistant_message", messageId: "message-1", text: "I will build Ore hauled." };
      const finish = await host.executeTool({
        externalCallId: "finish-1",
        toolName: "run.request_finish",
        args: {}
      });
      const payload = finish.payload as { receiptId: string };
      yield {
        type: "final",
        messageId: "message-2",
        finishReceiptId: payload.receiptId,
        text: "The verified tree is ready."
      };
    });

    await fixture.supervisor.start({ initialContext: { brief: "Ore hauled" }, initialContextHash: HASH_A });
    await fixture.supervisor.wait();

    expect(fixture.engine.openCount).toBe(1);
    expect(fixture.engine.resumeCount).toBe(0);
    expect(fixture.supervisor.status).toBe("succeeded");
    const events = fixture.supervisor.eventsAfter(0);
    expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(events.filter((event) => event.type === "final")).toHaveLength(1);
    expect(events.some((event) => event.type === "tool_result")).toBe(true);
    expect(events.some((event) =>
      event.type === "checkpoint" && event.payload.reason === "tool_call"
    )).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "runtime_status",
      payload: { code: "RUN_SUCCEEDED" }
    });
  });

  it("does not fabricate success when an engine emits final before finish verification", async () => {
    const fixture = supervisorFixture(async function* () {
      yield {
        type: "final",
        messageId: "message-1",
        finishReceiptId: "finish-receipt-1",
        text: "Done."
      };
    });

    await fixture.supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await fixture.supervisor.wait();

    expect(fixture.supervisor.status).toBe("recovery_required");
    expect(fixture.supervisor.eventsAfter(0).some((event) =>
      event.type === "error" && event.payload.code === "FINAL_WITHOUT_VERIFIED_FINISH"
    )).toBe(true);
    expect(fixture.supervisor.eventsAfter(0).some((event) => event.type === "final")).toBe(false);
  });

  it("does not commit final when the verified project head changes before the agent message", async () => {
    const fixture = baseFixture();
    const builder = new VdtBuilderSession({
      project: structuredClone(productionVolumeProject),
      now: () => "2026-08-26T10:00:00.000Z"
    });
    const gateway = {
      ...fixture.gateway,
      toolContext: (): AgentToolContext => ({
        ...fixture.gateway.toolContext(),
        builder
      })
    };
    const engine = new FakeEngine(fixture.capability, fixture.binding, async function* (host) {
      const finish = await host.executeTool({
        externalCallId: "finish-before-head-change",
        toolName: "run.request_finish",
        args: {}
      });
      expect(finish.status).toBe("succeeded");
      builder.updateNode({
        nodeId: builder.getProject().rootNodeId,
        patch: { name: "Changed after finish" }
      });
      yield {
        type: "final",
        messageId: "stale-final-message",
        finishReceiptId: (finish.payload as { receiptId: string }).receiptId,
        text: "This stale final must not be committed."
      };
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway,
      verifyFinish: async ({ externalCallId, expectedProjectRevision }) => verifyDeterministicRunFinish({
        binding: fixture.binding,
        project: builder.getProject(),
        currentRevision: builder.getRevision(),
        expectedHeadRevision: expectedProjectRevision ?? builder.getRevision(),
        mode: "generate_vdt",
        pendingQuestion: false,
        pendingApproval: false,
        pendingProposal: false,
        ambiguousOperation: false,
        currentFinishCallId: externalCallId,
        now: () => "2026-08-26T10:00:01.000Z"
      })
    });

    await supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await supervisor.wait();

    expect(supervisor.status).toBe("recovery_required");
    expect(supervisor.eventsAfter(0).some((event) =>
      event.type === "error" && event.payload.code === "FINISH_HEAD_CHANGED"
    )).toBe(true);
    expect(supervisor.eventsAfter(0).some((event) => event.type === "final")).toBe(false);
  });

  it("checkpoints a question and routes the answer to the same session", async () => {
    const fixture = supervisorFixture(async function* () {
      yield {
        type: "question",
        messageId: "message-1",
        questionSetId: "questions-1",
        questions: [{
          id: "unit",
          question: "Which unit should be used?",
          reason: "The root unit is required.",
          required: true,
          expectedAnswerType: "text"
        }]
      };
    });

    await fixture.supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await fixture.supervisor.wait();
    expect(fixture.supervisor.status).toBe("waiting_user");

    await fixture.supervisor.submit({
      type: "user_answer",
      questionSetId: "questions-1",
      answers: { unit: "tonnes" }
    });
    expect(fixture.session.submitted).toEqual([{
      type: "user_answer",
      questionSetId: "questions-1",
      answers: { unit: "tonnes" }
    }]);
    expect(fixture.engine.openCount).toBe(1);
  });

  it("queues a user instruction on the active session without creating another engine", async () => {
    let releaseStream!: () => void;
    const keepStreamOpen = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const fixture = supervisorFixture(async function* () {
      yield { type: "assistant_message", messageId: "message-1", text: "Working." };
      await keepStreamOpen;
    });
    await fixture.supervisor.start({ initialContext: {}, initialContextHash: HASH_A });

    await fixture.supervisor.submit({
      type: "user_instruction",
      text: "Use the revised fleet naming."
    });

    expect(fixture.engine.openCount).toBe(1);
    expect(fixture.session.submitted).toEqual([{
      type: "user_instruction",
      text: "Use the revised fleet naming."
    }]);
    expect(fixture.supervisor.eventsAfter(0)).toContainEqual(expect.objectContaining({
      type: "runtime_status",
      payload: expect.objectContaining({ code: "HUMAN_INPUT_QUEUED" })
    }));
    releaseStream();
    await fixture.supervisor.wait();
  });

  it("cancels the bound session and fails closed on a security breach", async () => {
    const fixture = supervisorFixture(async function* () {
      yield {
        type: "transport_error",
        code: "SECURITY_BOUNDARY_BREACH",
        message: "Observed forbidden shell execution.",
        retryable: false
      };
    });

    await fixture.supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await fixture.supervisor.wait();

    expect(fixture.supervisor.status).toBe("failed");
    expect(fixture.session.cancelled).toEqual(["Observed forbidden shell execution."]);
  });

  it("lets an already-started durable final commit win over a concurrent cancel", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    let releaseFinal!: () => void;
    let markFinalStarted!: () => void;
    const finalBlocked = new Promise<void>((resolve) => { releaseFinal = resolve; });
    const finalStarted = new Promise<void>((resolve) => { markFinalStarted = resolve; });
    const outbox = new AgentRunEventOutbox(fixture.binding.runId, {
      sink: {
        append: async (event) => {
          if (event.type === "final") {
            markFinalStarted();
            await finalBlocked;
          }
          await persistence.appendEvent(event);
        }
      }
    });
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-receipt-cancel-race");
    const engine = new FakeEngine(fixture.capability, fixture.binding, async function* (host) {
      const finish = await host.executeTool({
        externalCallId: "finish-cancel-race",
        toolName: "run.request_finish",
        args: {}
      });
      yield {
        type: "final",
        messageId: "message-cancel-race",
        finishReceiptId: (finish.payload as { receiptId: string }).receiptId,
        text: "This final already entered its durable commit."
      };
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      outbox,
      verifyFinish: async () => ({
        accepted: true,
        code: "FINISH_VERIFIED",
        receiptId: receipt.receiptId,
        receiptHash: receipt.receiptHash,
        finishReceipt: receipt,
        payload: {
          receiptId: receipt.receiptId,
          receiptHash: receipt.receiptHash,
          projectRevision: receipt.projectRevision
        }
      })
    });

    await supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await finalStarted;
    await supervisor.cancel("Too late to cancel the durable final.");
    releaseFinal();
    await supervisor.wait();

    expect(supervisor.status).toBe("succeeded");
    expect(engine.session?.cancelled).toEqual([]);
    expect(supervisor.eventsAfter(0).filter((event) =>
      event.type === "runtime_status" && event.payload.code === "RUN_CANCELLED"
    )).toHaveLength(0);
    expect(supervisor.eventsAfter(0).filter((event) => event.type === "final")).toHaveLength(1);
  });

  it("stops the bound session when the gateway observes a forbidden tool call", async () => {
    const fixture = supervisorFixture(async function* (host) {
      const result = await host.executeTool({
        externalCallId: "forbidden-shell-1",
        toolName: "shell.exec",
        args: { command: "pwd" }
      });
      expect(result).toMatchObject({
        status: "failed",
        resultCode: "SECURITY_BOUNDARY_BREACH"
      });
      yield { type: "assistant_message", messageId: "must-not-persist", text: "Continuing." };
    });

    await fixture.supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await fixture.supervisor.wait();

    expect(fixture.supervisor.status).toBe("failed");
    expect(fixture.session.cancelled).toEqual([
      'Tool "shell.exec" is outside the VDT domain-tool boundary.'
    ]);
    expect(fixture.supervisor.eventsAfter(0).some((event) =>
      event.type === "error" && event.payload.code === "SECURITY_BOUNDARY_BREACH"
    )).toBe(true);
    expect(fixture.supervisor.eventsAfter(0).some((event) =>
      event.type === "assistant_message" && event.messageId === "must-not-persist"
    )).toBe(false);
  });

  it("rejects an unqualified external profile unless the explicit canary gate is enabled", () => {
    const fixture = baseFixture();
    const capability: AgentCapabilityProfile = {
      ...fixture.capability,
      executionProfile: "external_cli_agent",
      sessionStrategy: "native",
      cli: { name: "Cursor Agent", version: "2026.08" },
      toolIsolation: "permission_only",
      qualification: { ...fixture.capability.qualification, status: "unverified" }
    };
    const binding: AgentSessionBinding = {
      ...fixture.binding,
      executionProfile: "external_cli_agent",
      cliVersion: capability.cli.version,
      toolIsolation: capability.toolIsolation,
      qualificationStatus: capability.qualification.status,
      capabilityEvidenceHash: capability.qualification.evidenceHash,
      externalSessionId: "cursor-session-1"
    };
    const engine = new FakeEngine(capability, binding, async function* () {});

    expect(() => new VdtRunSupervisor({
      engine,
      binding,
      gateway: fixture.gateway,
      verifyFinish: fixture.verifyFinish
    })).toThrowError(VdtRunSupervisorError);

    expect(() => new VdtRunSupervisor({
      engine,
      binding,
      gateway: fixture.gateway,
      verifyFinish: fixture.verifyFinish,
      allowUnqualifiedExternalCanary: true
    })).not.toThrow();
  });

  it("durably records the binding, gateway receipt, V2 outbox and finish handshake", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const engine = new FakeEngine(fixture.capability, fixture.binding, async function* (host) {
      const finish = await host.executeTool({
        externalCallId: "finish-durable",
        toolName: "run.request_finish",
        args: {}
      });
      yield {
        type: "final",
        messageId: "message-durable",
        finishReceiptId: (finish.payload as { receiptId: string }).receiptId,
        text: "The durable tree is ready."
      };
    });
    const verifiedAt = new Date(Date.now() - 1_000).toISOString();
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: async () => ({
        accepted: true,
        code: "FINISH_VERIFIED",
        receiptId: "finish-receipt-durable",
        receiptHash: HASH_C,
        finishReceipt: {
          schemaVersion: 2,
          receiptId: "finish-receipt-durable",
          runId: fixture.binding.runId,
          bindingId: fixture.binding.bindingId,
          sessionEpoch: fixture.binding.sessionEpoch,
          state: "verified",
          receiptHash: HASH_C,
          projectRevision: 7,
          projectHash: HASH_A,
          validationHash: HASH_B,
          calculationHash: HASH_C,
          finalMessageHash: null,
          verifiedAt,
          finalPersistedAt: null
        },
        payload: { projectRevision: 7 }
      })
    });

    await supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await supervisor.wait();

    expect(supervisor.status).toBe("succeeded");
    const state = await persistence.load(fixture.binding.runId);
    expect(state).toMatchObject({
      binding: fixture.binding,
      finishReceipt: { state: "final_persisted" },
      toolOperationReceipts: expect.arrayContaining([
        expect.objectContaining({ externalCallId: "finish-durable", state: "completed" })
      ])
    });
    expect(state?.eventOutbox?.filter((event) => event.type === "final")).toHaveLength(1);
  });

  it("hydrates a verified finish receipt and resumes only the original session for its final", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const checkpoint = recoveryCheckpoint(fixture.binding, {
      finishReceipt: null
    });
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-receipt-recovered");
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(checkpoint);
    await persistence.appendFinishReceipt(receipt);
    const preCrashOutbox = new AgentRunEventOutbox(fixture.binding.runId, {
      now: () => "2026-08-26T10:00:00.500Z",
      sink: { append: (event) => persistence.appendEvent(event) }
    });
    const preCrashEvent = await preCrashOutbox.append({
      type: "runtime_status",
      source: "runtime",
      payload: { code: "PRE_CRASH", message: "Durable before recovery.", state: "finishing" }
    });
    const onFinal = vi.fn();
    const recoveredBinding = { ...fixture.binding, sessionEpoch: 2 };
    const engine = new FakeEngine(fixture.capability, recoveredBinding, async function* () {
      yield {
        type: "final",
        messageId: "message-recovered",
        finishReceiptId: receipt.receiptId,
        text: "The recovered session supplied this final."
      };
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish,
      onFinal
    });

    await supervisor.recover(checkpoint);
    await supervisor.wait();

    expect(engine.openCount).toBe(0);
    expect(engine.resumeCount).toBe(1);
    expect(engine.resumedCheckpoints[0]?.finishReceipt).toEqual({
      receiptId: receipt.receiptId,
      state: "verified",
      receiptHash: receipt.receiptHash
    });
    expect(engine.resumedCheckpoints[0]?.sessionEpoch).toBe(2);
    expect(supervisor.status).toBe("succeeded");
    expect(onFinal).toHaveBeenCalledTimes(1);
    const recoveredEvents = await persistence.getEvents(fixture.binding.runId);
    expect(recoveredEvents[0]).toEqual(preCrashEvent);
    expect(recoveredEvents.map((event) => event.seq)).toEqual(
      recoveredEvents.map((_, index) => index + 1)
    );
    expect(recoveredEvents.filter((event) => event.type === "final")).toHaveLength(1);
    expect(await persistence.getFinishReceipt(fixture.binding.runId)).toMatchObject({
      state: "final_persisted",
      finalMessageHash: expect.stringMatching(/^sha256:/)
    });
  });

  it("reconciles crash-after-finish-receipt into an exact successful tool replay before resume", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const checkpoint = recoveryCheckpoint(fixture.binding, {
      activeToolCall: {
        externalCallId: "finish-crash-window",
        toolName: "run.request_finish",
        state: "in_flight"
      }
    });
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-receipt-crash-window");
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(checkpoint);
    await persistence.appendToolOperationReceipt({
      schemaVersion: 2,
      receiptId: "tool-receipt-finish-crash-window",
      runId: fixture.binding.runId,
      bindingId: fixture.binding.bindingId,
      externalCallId: "finish-crash-window",
      toolName: "run.request_finish",
      idempotencyKey: "tool-key-finish-crash-window",
      sessionEpoch: 1,
      state: "in_flight",
      argsHash: `sha256:${createHash("sha256").update(JSON.stringify({
        args: {},
        toolName: "run.request_finish"
      })).digest("hex")}`,
      resultHash: null,
      resultCode: null,
      expectedRevision: 7,
      committedRevision: null,
      startedAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:01.000Z"
    });
    await persistence.appendFinishReceipt(receipt);

    const recoveredBinding = { ...fixture.binding, sessionEpoch: 2 };
    const engine = new FakeEngine(fixture.capability, recoveredBinding, async function* (host) {
      const replay = await host.executeTool({
        externalCallId: "finish-crash-window",
        toolName: "run.request_finish",
        args: {}
      });
      expect(replay).toMatchObject({
        status: "succeeded",
        resultCode: "FINISH_VERIFIED",
        payload: { receiptId: receipt.receiptId }
      });
      yield {
        type: "final",
        messageId: "message-after-finish-replay",
        finishReceiptId: receipt.receiptId,
        text: "Recovered the verified finish tool result and completed."
      };
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await supervisor.recover(checkpoint);
    await supervisor.wait();

    expect(engine.resumeCount).toBe(1);
    expect(supervisor.eventsAfter(0).filter((event) => event.type === "error")).toEqual([]);
    expect(supervisor.status).toBe("succeeded");
    await expect(persistence.getToolOperationReceipt(
      fixture.binding.runId,
      "finish-crash-window"
    )).resolves.toMatchObject({
      state: "completed",
      resultCode: "FINISH_VERIFIED",
      replayResult: {
        status: "succeeded",
        payload: { receiptId: receipt.receiptId }
      }
    });
  });

  it("retires an origin-epoch completed exchange before the successor session resumes", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const checkpoint = recoveryCheckpoint(fixture.binding, {
      activeExchange: {
        exchangeId: "exchange-origin",
        stableCallKey: "turn-origin",
        state: "completed"
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(checkpoint);
    await persistence.appendExchangeReceipt({
      schemaVersion: 2,
      receiptId: "exchange-receipt-origin",
      runId: fixture.binding.runId,
      bindingId: fixture.binding.bindingId,
      exchangeId: "exchange-origin",
      stableCallKey: "turn-origin",
      sessionEpoch: 1,
      state: "completed",
      inputHash: HASH_A,
      outputHash: HASH_B,
      resultCode: "OK",
      startedAt: "2026-08-26T10:00:01.000Z",
      updatedAt: "2026-08-26T10:00:02.000Z"
    });
    const recoveredBinding = { ...fixture.binding, sessionEpoch: 2 };
    const engine = new FakeEngine(fixture.capability, recoveredBinding, async function* () {
      yield {
        type: "question",
        messageId: "message-after-recovery",
        questionSetId: "questions-after-recovery",
        questions: [{
          id: "continue",
          question: "Continue the recovered run?",
          reason: "The origin exchange is already terminal.",
          required: true,
          expectedAnswerType: "text"
        }]
      };
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await supervisor.recover(checkpoint);
    await supervisor.wait();

    expect(engine.resumedCheckpoints[0]).toMatchObject({
      sessionEpoch: 2,
      activeExchange: null,
      activeToolCall: null
    });
    expect(supervisor.status).toBe("waiting_user");
    const state = await persistence.load(fixture.binding.runId);
    expect(state?.exchangeReceipts.filter((receipt) => receipt.stableCallKey === "turn-origin"))
      .toHaveLength(1);
  });

  it("blocks provider resume while an origin-epoch operation is ambiguous", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const checkpoint = recoveryCheckpoint(fixture.binding, {
      activeExchange: {
        exchangeId: "exchange-ambiguous",
        stableCallKey: "turn-ambiguous",
        state: "in_flight"
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(checkpoint);
    await persistence.appendExchangeReceipt({
      schemaVersion: 2,
      receiptId: "exchange-receipt-ambiguous",
      runId: fixture.binding.runId,
      bindingId: fixture.binding.bindingId,
      exchangeId: "exchange-ambiguous",
      stableCallKey: "turn-ambiguous",
      sessionEpoch: 1,
      state: "in_flight",
      inputHash: HASH_A,
      outputHash: null,
      resultCode: null,
      startedAt: "2026-08-26T10:00:01.000Z",
      updatedAt: "2026-08-26T10:00:02.000Z"
    });
    const engine = new FakeEngine(
      fixture.capability,
      { ...fixture.binding, sessionEpoch: 2 },
      async function* () {}
    );
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await expect(supervisor.recover(checkpoint)).rejects.toMatchObject({
      code: "AMBIGUOUS_OPERATION_RECOVERY"
    });
    expect(engine.resumeCount).toBe(0);
    expect((await persistence.load(fixture.binding.runId))?.binding.sessionEpoch).toBe(1);
  });

  it("reconciles a crash after the durable final without asking an engine to invent it again", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-receipt-after-final");
    const checkpoint = recoveryCheckpoint(fixture.binding, {
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: "verified",
        receiptHash: receipt.receiptHash
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(checkpoint);
    await persistence.appendFinishReceipt(receipt);
    const crashedOutbox = new AgentRunEventOutbox(fixture.binding.runId, {
      now: () => "2026-08-26T10:00:03.000Z",
      sink: { append: (event) => persistence.appendEvent(event) }
    });
    const durableFinal = await crashedOutbox.append({
      type: "final",
      source: "vdt_agent",
      sessionId: fixture.binding.bindingId,
      messageId: "message-before-crash",
      payload: {
        text: "This exact final was durable before the crash.",
        format: "markdown",
        finishReceiptId: receipt.receiptId,
        finishReceiptHash: receipt.receiptHash
      }
    });
    if (durableFinal.type !== "final") throw new Error("Expected a durable final fixture event.");
    const onFinal = vi.fn();
    const engine = new FakeEngine(fixture.capability, fixture.binding, async function* () {
      throw new Error("Recovery must not ask the engine for another final.");
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish,
      onFinal
    });

    await supervisor.recover(checkpoint);

    expect(supervisor.status).toBe("succeeded");
    expect(engine.resumeCount).toBe(0);
    expect(onFinal).toHaveBeenCalledOnce();
    expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({
      text: durableFinal.payload.text,
      receiptId: receipt.receiptId
    }));
    expect((await persistence.getEvents(fixture.binding.runId)).filter((event) => event.type === "final"))
      .toEqual([durableFinal]);
    const persistedFinish = await persistence.getFinishReceipt(fixture.binding.runId);
    expect(persistedFinish).toMatchObject({
      state: "final_persisted",
      finalPersistedAt: durableFinal.timestamp
    });

    const secondOnFinal = vi.fn();
    const secondEngine = new FakeEngine(fixture.capability, fixture.binding, async function* () {
      throw new Error("Completed recovery must not resume an engine.");
    });
    const secondSupervisor = new VdtRunSupervisor({
      engine: secondEngine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish,
      onFinal: secondOnFinal
    });
    await secondSupervisor.recover(checkpoint);

    expect(secondSupervisor.status).toBe("succeeded");
    expect(secondEngine.resumeCount).toBe(0);
    expect(secondOnFinal).not.toHaveBeenCalled();
    expect((await persistence.getEvents(fixture.binding.runId)).filter((event) => event.type === "final"))
      .toHaveLength(1);
  });

  it("finalizes one durable recovery-epoch final against its immutable origin receipt", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-origin-to-recovery");
    const originCheckpoint = recoveryCheckpoint(fixture.binding, {
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: "verified",
        receiptHash: receipt.receiptHash
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(originCheckpoint);
    await persistence.appendFinishReceipt(receipt);
    const recoveryBinding = { ...fixture.binding, sessionEpoch: 2 };
    const recoveryEpochCheckpoint = recoveryCheckpoint(recoveryBinding, {
      checkpointId: "checkpoint-recovery-epoch-final",
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: "verified",
        receiptHash: receipt.receiptHash
      },
      createdAt: "2026-08-26T10:00:03.000Z"
    });
    await persistence.saveCheckpoint(recoveryEpochCheckpoint);
    await persistence.createBinding(recoveryBinding);
    const crashedOutbox = new AgentRunEventOutbox(fixture.binding.runId, {
      now: () => "2026-08-26T10:00:04.000Z",
      sink: { append: (event) => persistence.appendEvent(event) }
    });
    await crashedOutbox.append({
      type: "final",
      source: "vdt_agent",
      sessionId: recoveryBinding.bindingId,
      messageId: "message-recovery-epoch",
      payload: {
        text: "The recovery owner persisted this one final.",
        format: "markdown",
        finishReceiptId: receipt.receiptId,
        finishReceiptHash: receipt.receiptHash
      }
    });
    const engine = new FakeEngine(fixture.capability, recoveryBinding, async function* () {
      throw new Error("The already durable final must not be regenerated.");
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: recoveryBinding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await supervisor.recover(recoveryEpochCheckpoint);

    expect(supervisor.status).toBe("succeeded");
    expect(engine.resumeCount).toBe(0);
    expect(await persistence.getFinishReceipt(fixture.binding.runId)).toMatchObject({
      sessionEpoch: 1,
      state: "final_persisted",
      finalPersistedAt: "2026-08-26T10:00:04.000Z"
    });
    expect((await persistence.getEvents(fixture.binding.runId)).filter((event) => event.type === "final"))
      .toHaveLength(1);
  });

  it("fails closed instead of advancing a verified finish beyond its exact recovery successor", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const receipt = verifiedFinishReceipt(fixture.binding, "finish-recovery-retry-unsafe");
    const originCheckpoint = recoveryCheckpoint(fixture.binding, {
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: "verified",
        receiptHash: receipt.receiptHash
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(originCheckpoint);
    await persistence.appendFinishReceipt(receipt);

    const recoveryBinding = { ...fixture.binding, sessionEpoch: 2 };
    const recoveryCheckpointAlreadyAcquired = recoveryCheckpoint(recoveryBinding, {
      checkpointId: "checkpoint-finish-recovery-already-acquired",
      finishReceipt: {
        receiptId: receipt.receiptId,
        state: "verified",
        receiptHash: receipt.receiptHash
      },
      createdAt: "2026-08-26T10:00:03.000Z"
    });
    await persistence.saveCheckpoint(recoveryCheckpointAlreadyAcquired);
    await persistence.createBinding(recoveryBinding);

    const engine = new FakeEngine(fixture.capability, recoveryBinding, async function* () {
      throw new Error("A second finish recovery epoch must not reach the provider.");
    });
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: recoveryBinding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await expect(supervisor.recover(recoveryCheckpointAlreadyAcquired)).rejects.toMatchObject({
      code: "FINISH_RECOVERY_RETRY_UNSAFE"
    });

    expect(supervisor.status).toBe("recovery_required");
    expect(engine.resumeCount).toBe(0);
    expect((await persistence.load(fixture.binding.runId))?.checkpoint?.sessionEpoch).toBe(2);
    expect(await persistence.getFinishReceipt(fixture.binding.runId)).toEqual(receipt);
    expect((await persistence.getEvents(fixture.binding.runId)).filter((event) => event.type === "final"))
      .toHaveLength(0);
  });

  it("fails closed when a caller skips the durable recovery transition and supplies a bumped binding", async () => {
    const fixture = baseFixture();
    const persistence = new InMemoryAgentSupervisorPersistence();
    const originReceipt = verifiedFinishReceipt(fixture.binding, "finish-origin-epoch");
    const originCheckpoint = recoveryCheckpoint(fixture.binding, {
      finishReceipt: {
        receiptId: originReceipt.receiptId,
        state: "verified",
        receiptHash: originReceipt.receiptHash
      }
    });
    await persistence.createBinding(fixture.binding);
    await persistence.saveCheckpoint(originCheckpoint);
    await persistence.appendFinishReceipt(originReceipt);
    const bumpedBinding = { ...fixture.binding, sessionEpoch: 2 };
    const bumpedCheckpoint = recoveryCheckpoint(bumpedBinding, {
      checkpointId: "checkpoint-epoch-2",
      finishReceipt: {
        receiptId: originReceipt.receiptId,
        state: "verified",
        receiptHash: originReceipt.receiptHash
      }
    });
    const engine = new FakeEngine(fixture.capability, bumpedBinding, async function* () {});
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: bumpedBinding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await expect(supervisor.recover(bumpedCheckpoint)).rejects.toMatchObject({
      code: "RECOVERY_BINDING_STALE"
    });
    expect(supervisor.status).toBe("recovery_required");
    expect(engine.resumeCount).toBe(0);
    expect(await persistence.getFinishReceipt(fixture.binding.runId)).toEqual(originReceipt);
  });

  it("orders same-millisecond checkpoints and does not duplicate a terminal exchange receipt", async () => {
    const fixture = baseFixture();
    const persistence = new RecordingSupervisorPersistence();
    const engine = new FakeEngine(
      fixture.capability,
      fixture.binding,
      async function* () {
        yield {
          type: "question",
          messageId: "message-constant-clock",
          questionSetId: "questions-constant-clock",
          questions: [{
            id: "unit",
            question: "Which unit should be used?",
            reason: "The root unit is required.",
            required: true,
            expectedAnswerType: "text"
          }]
        };
      },
      () => ({
        lastConfirmedInput: { cursor: "input-1", contentHash: HASH_A },
        lastConfirmedOutput: { cursor: "output-1", contentHash: HASH_B },
        activeExchange: {
          exchangeId: "exchange-constant-clock",
          stableCallKey: "turn-constant-clock",
          state: "completed"
        },
        createdAt: "2026-08-26T10:00:00.000Z"
      })
    );
    const supervisor = new VdtRunSupervisor({
      engine,
      binding: fixture.binding,
      gateway: fixture.gateway,
      persistence,
      verifyFinish: fixture.verifyFinish
    });

    await supervisor.start({ initialContext: {}, initialContextHash: HASH_A });
    await supervisor.wait();

    expect(supervisor.status).toBe("waiting_user");
    expect(persistence.checkpoints.map((checkpoint) => checkpoint.createdAt)).toEqual([
      "2026-08-26T10:00:00.000Z",
      "2026-08-26T10:00:00.001Z"
    ]);
    expect(persistence.exchangeWrites.filter((receipt) =>
      receipt.stableCallKey === "turn-constant-clock" && receipt.state === "completed"
    )).toHaveLength(1);
  });
});

type EventFactory = (host: AgentEngineHost) => AsyncGenerator<AgentEngineEvent>;
type CheckpointFactory = (
  count: number,
  binding: AgentSessionBinding
) => Partial<AgentEngineCheckpoint>;

class RecordingSupervisorPersistence extends InMemoryAgentSupervisorPersistence {
  readonly checkpoints: AgentEngineCheckpoint[] = [];
  readonly exchangeWrites: AgentEngineExchangeReceiptV2[] = [];

  override async saveCheckpoint(checkpoint: AgentEngineCheckpoint): Promise<void> {
    this.checkpoints.push(structuredClone(checkpoint));
    await super.saveCheckpoint(checkpoint);
  }

  override async appendExchangeReceipt(receipt: AgentEngineExchangeReceiptV2): Promise<void> {
    this.exchangeWrites.push(structuredClone(receipt));
    await super.appendExchangeReceipt(receipt);
  }
}

class FakeSession implements AgentRunSession {
  checkpointCount = 0;
  readonly submitted: AgentHumanInput[] = [];
  readonly cancelled: string[] = [];

  constructor(
    readonly binding: AgentSessionBinding,
    private readonly host: AgentEngineHost,
    private readonly eventFactory: EventFactory,
    private readonly checkpointFactory?: CheckpointFactory,
    private readonly recoveredCheckpoint?: AgentEngineCheckpoint
  ) {}

  events(): AsyncIterable<AgentEngineEvent> {
    return this.eventFactory(this.host);
  }

  async submit(input: AgentHumanInput): Promise<void> {
    this.submitted.push(structuredClone(input));
  }

  async checkpoint(): Promise<AgentEngineCheckpoint> {
    this.checkpointCount += 1;
    return {
      ...this.recoveredCheckpoint,
      schemaVersion: 2,
      checkpointId: `checkpoint-${this.checkpointCount}`,
      bindingId: this.binding.bindingId,
      runId: this.binding.runId,
      sessionEpoch: this.binding.sessionEpoch,
      externalSessionId: this.binding.externalSessionId,
      lastConfirmedInput: this.recoveredCheckpoint?.lastConfirmedInput ?? null,
      lastConfirmedOutput: this.recoveredCheckpoint?.lastConfirmedOutput ?? null,
      activeExchange: this.recoveredCheckpoint?.activeExchange ?? null,
      activeToolCall: this.recoveredCheckpoint?.activeToolCall ?? null,
      finishReceipt: this.recoveredCheckpoint?.finishReceipt ?? null,
      createdAt: `2026-08-26T10:00:0${this.checkpointCount}.000Z`,
      ...this.checkpointFactory?.(this.checkpointCount, this.binding)
    };
  }

  async cancel(reason: string): Promise<void> {
    this.cancelled.push(reason);
  }

  async close(): Promise<void> {}
}

class FakeEngine implements AgentExecutionEngine {
  openCount = 0;
  resumeCount = 0;
  readonly resumedCheckpoints: AgentEngineCheckpoint[] = [];
  session?: FakeSession;

  constructor(
    readonly capability: AgentCapabilityProfile,
    private readonly binding: AgentSessionBinding,
    private readonly eventFactory: EventFactory,
    private readonly checkpointFactory?: CheckpointFactory
  ) {}

  async openSession(start: AgentEngineStart, host: AgentEngineHost): Promise<AgentRunSession> {
    this.openCount += 1;
    expect(start.binding).toEqual(this.binding);
    this.session = new FakeSession(this.binding, host, this.eventFactory, this.checkpointFactory);
    return this.session;
  }

  async resumeSession(checkpoint: AgentEngineCheckpoint, host: AgentEngineHost): Promise<AgentRunSession> {
    this.resumeCount += 1;
    this.resumedCheckpoints.push(structuredClone(checkpoint));
    this.session = new FakeSession(this.binding, host, this.eventFactory, this.checkpointFactory, checkpoint);
    return this.session;
  }
}

function recoveryCheckpoint(
  binding: AgentSessionBinding,
  patch: Partial<AgentEngineCheckpoint> = {}
): AgentEngineCheckpoint {
  return {
    schemaVersion: 2,
    checkpointId: "checkpoint-recovery",
    bindingId: binding.bindingId,
    runId: binding.runId,
    sessionEpoch: binding.sessionEpoch,
    externalSessionId: binding.externalSessionId,
    lastConfirmedInput: { cursor: "turn-1-input", contentHash: HASH_A },
    lastConfirmedOutput: { cursor: "turn-1-output", contentHash: HASH_B },
    activeExchange: null,
    activeToolCall: null,
    finishReceipt: null,
    createdAt: "2026-08-26T10:00:02.000Z",
    ...patch
  };
}

function verifiedFinishReceipt(
  binding: AgentSessionBinding,
  receiptId: string
): FinishReceiptV2 {
  return {
    schemaVersion: 2,
    receiptId,
    runId: binding.runId,
    bindingId: binding.bindingId,
    sessionEpoch: binding.sessionEpoch,
    state: "verified",
    receiptHash: HASH_C,
    projectRevision: 7,
    projectHash: HASH_A,
    validationHash: HASH_B,
    calculationHash: HASH_C,
    finalMessageHash: null,
    verifiedAt: "2026-08-26T10:00:01.000Z",
    finalPersistedAt: null
  };
}

function supervisorFixture(eventFactory: EventFactory) {
  const fixture = baseFixture();
  const engine = new FakeEngine(fixture.capability, fixture.binding, eventFactory);
  const supervisor = new VdtRunSupervisor({
    engine,
    binding: fixture.binding,
    gateway: fixture.gateway,
    verifyFinish: fixture.verifyFinish
  });
  return {
    ...fixture,
    engine,
    supervisor,
    get session(): FakeSession {
      if (!engine.session) throw new Error("Session is not open.");
      return engine.session;
    }
  };
}

function baseFixture() {
  const registry = new ToolRegistry();
  registry.register({
    name: "vdt.echo",
    description: "Echo a value.",
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    run: (_context, input) => input
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
  const capability: AgentCapabilityProfile = {
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
    capability,
    gateway: {
      tools: registry,
      toolContext: context,
      allowedTools: new Set(["vdt.echo", "run.request_finish"])
    },
    verifyFinish: async () => ({
      accepted: true,
      code: "FINISH_VERIFIED",
      receiptId: "finish-receipt-1",
      receiptHash: HASH_C,
      payload: { projectRevision: 7 }
    })
  };
}
