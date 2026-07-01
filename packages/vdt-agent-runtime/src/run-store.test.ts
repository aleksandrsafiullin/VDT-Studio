import { describe, expect, it, vi } from "vitest";
import {
  AgentRunStore,
  hydrateAgentRunState,
  serializeAgentRunState,
  type AgentRunPersistence,
  type PersistedAgentRunState,
  type VdtAgentEvent,
  type VdtAgentRunSnapshot,
  type VdtAgentRunState
} from "./index";

describe("AgentRunStore persistence", () => {
  it("keeps the initial prompt in the visible brief context", () => {
    const store = new AgentRunStore({ now: fixedClock("2026-06-29T10:00:00.000Z") });
    const state = store.createRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 Komatsu PC1250 and 2 Komatsu PC2000",
        rootKpi: "Ore Excavation",
        businessContext: ""
      },
      providerId: "mock"
    });

    expect(store.getSnapshot(state.runId).visibleContext.brief).toMatchObject({
      rootKpi: "Ore Excavation",
      businessContext: "I have 5 Komatsu PC1250 and 2 Komatsu PC2000"
    });
  });

  it("redacts public snapshots and persists recoverable run state", () => {
    const persisted = new Map<string, PersistedAgentRunState>();
    const snapshots = new Map<string, VdtAgentRunSnapshot>();
    const events: VdtAgentEvent[] = [];
    const persistence: AgentRunPersistence = {
      createRun: vi.fn((state: VdtAgentRunState) => {
        persisted.set(state.runId, serializeAgentRunState(state));
        snapshots.set(state.runId, stateSnapshot(state));
      }),
      updateRun: vi.fn((state: VdtAgentRunState) => {
        persisted.set(state.runId, serializeAgentRunState(state));
        snapshots.set(state.runId, stateSnapshot(state));
      }),
      appendEvent: vi.fn((event: VdtAgentEvent, state: VdtAgentRunState) => {
        events.push(event);
        persisted.set(state.runId, serializeAgentRunState(state));
        snapshots.set(state.runId, stateSnapshot(state));
      }),
      getState: vi.fn((runId: string) => {
        const state = persisted.get(runId);
        return state ? hydrateAgentRunState(state) : null;
      }),
      getSnapshot: vi.fn((runId: string) => snapshots.get(runId) ?? null)
    };

    const store = new AgentRunStore({
      now: fixedClock("2026-06-29T10:00:00.000Z"),
      persistence
    });
    const state = store.createRun({
      mode: "generate_vdt",
      input: { rootKpi: "Revenue" },
      providerId: "openai_compatible",
      providerConfig: {
        apiKey: "sk-secret",
        pairingToken: "pair-secret",
        model: "gpt-test"
      }
    });

    store.updateRun(state.runId, { status: "running", phase: "building_graph" });
    store.appendEvent(state.runId, {
      type: "graph_patch",
      phase: "building_graph",
      title: "Patch",
      message: "Created a visible layer.",
      metadata: {
        apiKey: "event-secret",
        nested: { accessToken: "nested-secret", kept: "visible" }
      }
    });

    const snapshot = store.getSnapshot(state.runId);
    expect(snapshot.request.providerConfig).toMatchObject({
      apiKey: "[redacted]",
      pairingToken: "[redacted]",
      model: "gpt-test"
    });
    expect(snapshot.events[0]?.metadata).toEqual({
      apiKey: "[redacted]",
      nested: { accessToken: "[redacted]", kept: "visible" }
    });

    const recoveredStore = new AgentRunStore({ persistence });
    expect(recoveredStore.has(state.runId)).toBe(true);
    expect(recoveredStore.getSnapshot(state.runId)).toMatchObject({
      runId: state.runId,
      status: "running",
      phase: "building_graph"
    });
    expect(events).toHaveLength(1);
  });
});

function stateSnapshot(state: VdtAgentRunState): VdtAgentRunSnapshot {
  return serializeAgentRunState(state).snapshot;
}

function fixedClock(value: string): () => string {
  return () => value;
}
