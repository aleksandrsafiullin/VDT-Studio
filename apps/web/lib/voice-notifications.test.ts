import { describe, expect, it, vi } from "vitest";
import type { AgentRunEventV2, VdtAgentEvent } from "@vdt-studio/vdt-agent-runtime";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { projectVoiceEvent, projectVoiceSnapshot, voiceRunStatus, type VoiceNotification, type VoiceRunSnapshot } from "./voice-notifications";
import { VoiceEventFeed, VoiceNotificationQueue } from "./voice-notification-queue";

const timestamp = "2026-11-25T10:00:01Z";
const hash = `sha256:${"a".repeat(64)}`;
const common = { runId: "run-1", timestamp, seq: 1, id: "event-1" };

function legacy(type: VdtAgentEvent["type"], overrides: Partial<VdtAgentEvent> = {}): VdtAgentEvent {
  return { ...common, type, title: "private trace", message: "private trace", phase: "building_graph", ...overrides };
}

function canonical(event: Omit<Extract<AgentRunEventV2, { type: "runtime_status" }>, keyof typeof common | "schemaVersion" | "hash" | "previousHash">): AgentRunEventV2 {
  return { ...common, schemaVersion: 2, previousHash: null, hash, ...event };
}

const selected = { id: "example-skill", selectionId: "selection-1", version: 1, contentHash: hash,
  selectionRevision: 3, readReceiptId: "read-1", methodTitle: "Cycle model", reason: "It matches the confirmed reporting boundary." };

describe("verified voice projection", () => {
  it("requires a real Skill receipt and localizes only the method and reason", () => {
    expect(projectVoiceEvent(legacy("skill_selected", { metadata: { ...selected, readReceiptId: undefined } }), "en")).toBeUndefined();
    const result = projectVoiceEvent(legacy("skill_selected", { metadata: { ...selected,
      reason: "The scope fits. <think>private chain</think>" } }), "ru-RU");
    expect(result).toMatchObject({ key: "run-1:method:selection-1", text: "Выбрана методика: Cycle model. The scope fits." });
  });

  it("suppresses model claims, failed mutations and unsaved or orphaned finishes", () => {
    for (const type of ["assistant_message", "plan_proposed", "mutation_proposed", "mutation_rejected", "run_completed"] as const)
      expect(projectVoiceEvent(legacy(type), "en")).toBeUndefined();
    const snapshot: VoiceRunSnapshot = { runId: common.runId, status: "succeeded", events: [], draftProject: productionVolumeProject };
    expect(projectVoiceSnapshot(snapshot, "en")).toEqual([]);
    const finishOutcome = { outcome: "structural_model" as const, state: "final_persisted" as const, policyVersion: "v1",
      projectRevision: 2, projectHash: hash };
    expect(projectVoiceSnapshot({ ...snapshot, status: "recovery_required", finishOutcome }, "en")).toEqual([]);
    expect(projectVoiceSnapshot({ ...snapshot, finishOutcome }, "en")[0]?.text).toBe("The run finished.");
    const saved = { ...snapshot, finishOutcome, workspaceRevision: {
      head: { schemaVersion: "vdt_revision_head.v2" as const, projectId: "project", vdtId: "tree",
        activeRevisionId: "revision", activeContentIdentity: { scheme: "legacy_graph_sha256" as const, hash: hash as `sha256:${string}` },
        pendingRevisionId: null, commitGeneration: 2 },
      runtime: { runtimeGeneration: "v2" as const, generationVersion: 1 }
    } };
    expect(projectVoiceSnapshot(saved, "en")[0]?.text).toBe(`The model was saved. Node count: ${productionVolumeProject.graph.nodes.length}.`);
    const workbookId = `excel_${"b".repeat(64)}`;
    const workbook = { type: "excel_workbook" as const, runId: common.runId, id: workbookId, createdAt: timestamp, summary: "Workbook",
      payload: { kind: "excel_workbook", id: workbookId, revisionId: "revision", scenarioId: null,
        downloadUrl: `/api/agent/runs/${common.runId}/excel-workbook?id=${workbookId}&revisionId=revision` } };
    expect(projectVoiceSnapshot({ ...saved, artifacts: [workbook] }, "en")[0]?.text)
      .toBe("The Excel workbook for the saved revision is ready to download.");
    expect(projectVoiceSnapshot({ ...saved, artifacts: [{ ...workbook, payload: { ...workbook.payload, revisionId: "old" } }] }, "en")[0]?.text)
      .not.toContain("Excel");
    expect(projectVoiceSnapshot({ ...saved, status: "running", artifacts: [workbook] }, "en")).toEqual([]);
    expect(voiceRunStatus(saved, "en").nodeCount).toBe(productionVolumeProject.graph.nodes.length);
  });

  it("uses independent monotonic sequences, ignores stale replay and sorts a burst", () => {
    const feed = new VoiceEventFeed(common.runId, Date.parse("2026-11-25T10:00:00Z"));
    const started = canonical({ type: "runtime_status", source: "runtime", payload: { code: "SESSION_STARTED", message: "private" } });
    const validation = legacy("graph_validation", { seq: 2, metadata: { errors: 1 } });
    const method = legacy("skill_selected", { metadata: selected });
    expect(feed.take([validation, method, started, { ...started, runId: "different" }], "en").map(item => item.kind))
      .toEqual(["method", "validation", "progress"]);
    expect(feed.take([validation, started, method], "en")).toEqual([]);
    expect(feed.take([{ ...started, seq: 3, timestamp: "2026-11-24T10:00:00Z" }], "en")).toEqual([]);
  });

  it("gives canonical and public method receipts the same spoken identity", () => {
    const base = canonical({ type: "runtime_status", source: "runtime", payload: { code: "SESSION_STARTED", message: "private" } });
    const newer = { ...base, type: "skill_selected", payload: selected } as unknown as AgentRunEventV2;
    const mirror = legacy("skill_selected", { metadata: { ...selected, eventV2Id: base.id } });
    expect(projectVoiceEvent(newer, "en")).toEqual(projectVoiceEvent(mirror, "en"));
  });

  it("speaks successful reads and validation facts without using diagnostic text", () => {
    expect(projectVoiceEvent(legacy("tool_call_completed", { metadata: { toolName: "project.get_subtree", ok: false } }), "en")).toBeUndefined();
    expect(projectVoiceEvent(legacy("tool_call_completed", { metadata: { toolName: "project.get_subtree", ok: true } }), "en"))
      .toMatchObject({ text: "The requested information was read." });
    expect(projectVoiceEvent(legacy("graph_validation", { metadata: { errors: 2 } }), "en"))
      .toMatchObject({ text: "Validation found issues. Error count: 2." });
  });
});

function item(key: string, priority: VoiceNotification["priority"], kind: VoiceNotification["kind"] = "progress"): VoiceNotification {
  return { key, kind, priority, text: key };
}

describe("notification playback queue", () => {
  it("deduplicates a mirrored method and coalesces progress while prioritizing questions", async () => {
    const speak = vi.fn(async () => {});
    const queue = new VoiceNotificationQueue({ speak }, () => {});
    queue.pause();
    queue.push([item("method", "normal", "method"), item("progress1", "progress")]);
    queue.push([item("method", "normal", "method"), item("progress2", "progress"), item("question", "urgent", "question")]);
    expect(speak).not.toHaveBeenCalled();
    queue.resume();
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls).toEqual([[expect.objectContaining({ key: "question" }), expect.any(AbortSignal)],
      [expect.objectContaining({ key: "method" }), expect.any(AbortSignal)]]);
    queue.dispose();
  });

  it("aborts stale audio, ignores late settlement and reports a failed synthesis independently", async () => {
    const states = vi.fn();
    let reject!: (reason?: unknown) => void;
    const speak = vi.fn((_item: VoiceNotification, _signal: AbortSignal) => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const queue = new VoiceNotificationQueue({ speak }, states);
    queue.push([item("progress", "progress")]);
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    queue.dispose();
    expect(speak.mock.calls[0]?.[1].aborted).toBe(true);
    reject(new Error("private error"));
    await Promise.resolve();
    expect(states.mock.calls).toEqual([["speaking"]]);

    const failed = new VoiceNotificationQueue({ speak: async () => { throw new Error("private error"); } }, states);
    failed.push([item("another", "urgent", "error")]);
    await vi.waitFor(() => expect(states).toHaveBeenLastCalledWith("error"));
  });

  it("stops a pending question if the run cancels and then speaks cancellation", async () => {
    const speak = vi.fn((voice: VoiceNotification, signal: AbortSignal) => voice.kind === "question"
      ? new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })) : Promise.resolve());
    const queue = new VoiceNotificationQueue({ speak }, () => {});
    queue.push([item("question", "urgent", "question")]);
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
    queue.push([item("cancel", "urgent", "cancel")]);
    expect(speak.mock.calls[0]?.[1].aborted).toBe(true);
    await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls[1]?.[0].kind).toBe("cancel");
    queue.dispose();
  });
});

it("holds the half-duplex interlock until playback has actually settled", async () => {
  let settle!: () => void;
  const speak = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
  const queue = new VoiceNotificationQueue({ speak }, () => {});
  queue.push([item("playing", "normal")]);
  expect(queue.pauseForCapture()).toBe(false);
  queue.interrupt();
  expect(queue.pauseForCapture()).toBe(false);
  // An interrupted adapter can still be unwinding its owned audio resources.
  await Promise.resolve();
  await vi.waitFor(() => expect(queue.pauseForCapture()).toBe(true));
  queue.push([item("queued", "normal")]);
  expect(speak).not.toHaveBeenCalled();
  queue.resume();
  await vi.waitFor(() => expect(speak).toHaveBeenCalledTimes(1));
  settle();
  queue.dispose();
});
