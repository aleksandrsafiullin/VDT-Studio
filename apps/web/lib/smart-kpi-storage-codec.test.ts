import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProject, createSmartKpiMeasuredFixture, createVersionSnapshot, kpiCanonicalJson } from "@vdt-studio/vdt-core";
import { compactSmartKpiStorage, expandSmartKpiStorage } from "./smart-kpi-storage-codec";
import { smartKpiJournalPersisted, studioStatePersistenceProblem, studioStateStorage } from "./smart-kpi-journal";
import type { SaveStoredVdtRevisionInput } from "./vdt-storage-client";

function fixture(kind: "add" | "undo" = "add") {
  let before = createSmartKpiMeasuredFixture(0);
  before.graph.nodes[0]!.description = "Фиктивное измерение 🔎 · quote \" · newline\n".repeat(150);
  for (let i = 0; i < 20; i++) before = createVersionSnapshot(before, { name: `Historical ${i}` });
  const candidate = createVersionSnapshot(before, { name: "Before incoming KPIs", taskType: "suggest_incoming_kpis" });
  candidate.graph.nodes[0]!.name = "Accepted formula parent";
  const checkpointVersionId = candidate.versions.at(-1)!.id;
  const current = kind === "add" ? before : candidate;
  const next = kind === "add" ? candidate : { ...cloneProject(before), versions: cloneProject(candidate.versions) };
  const input: SaveStoredVdtRevisionInput = { idempotencyKey: `smart-${kind}:qa`,
    expectedHead: { schemaVersion: "vdt_revision_cas.v1", activeRevisionId: "old", activeContentIdentity: null, commitGeneration: 1 },
    expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: "v1", generationVersion: 1 }, project: cloneProject(next), summary: "Exact original body" };
  const operation = { schemaVersion: kind === "add" ? "smart_kpi_operation.v2" : "smart_kpi_operation.v1", id: "smart_codec_qa", kind, phase: "committing",
    before: cloneProject(current), beforeJson: kpiCanonicalJson(current), candidate: cloneProject(next), checkpointVersionId,
    input };
  const undo = { before: cloneProject(before), appliedJson: kpiCanonicalJson(candidate), checkpointVersionId };
  return { state: { project: cloneProject(current), smartKpiOperation: operation, smartKpiConflictOperation: cloneProject(operation), ...(kind === "undo" ? { smartKpiUndo: undo } : {}) }, version: 0 };
}

const memory = new Map<string, string>();
let limit = Infinity;
beforeEach(() => {
  limit = Infinity; memory.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => {
    if (value.length > limit) throw new DOMException("Synthetic origin quota", "QuotaExceededError"); memory.set(key, value);
  }, removeItem: (key: string) => memory.delete(key) });
  studioStateStorage.removeItem("vdt-studio-state");
});
afterEach(() => { studioStateStorage.removeItem("vdt-studio-state"); vi.unstubAllGlobals(); });

describe("quota-safe lossless Smart storage", () => {
  it.each(["add", "undo"] as const)("restores exact %s data and request byte ordering, including the version evicted by the 20-snapshot cap", kind => {
    const input = fixture(kind), raw = JSON.stringify(input), compact = compactSmartKpiStorage(raw)!;
    expect(compact.length).toBeLessThan(raw.length * 0.35);
    expect(expandSmartKpiStorage(compact)).toBe(raw);
    const restored = JSON.parse(expandSmartKpiStorage(compact));
    expect(JSON.stringify(restored.state.smartKpiOperation.input)).toBe(JSON.stringify(input.state.smartKpiOperation.input));
    if (kind === "undo") expect(restored.state.smartKpiUndo.before.versions[0]).toEqual(input.state.smartKpiUndo!.before.versions[0]);
    expect(restored.state.project.graph.nodes[0].baselineValue).toBe(0);
  });

  it("does not repair inconsistent original beforeJson or candidate/input evidence", () => {
    const input = fixture(); input.state.smartKpiOperation.beforeJson = "corrupted original identity";
    input.state.smartKpiOperation.input.project.graph.nodes[0]!.baselineValue = 999;
    const raw = JSON.stringify(input), compact = compactSmartKpiStorage(raw)!;
    expect(expandSmartKpiStorage(compact)).toBe(raw);
  });

  it("leaves old editor records and non-Smart project data unchanged", () => {
    const raw = JSON.stringify({ state: { project: createSmartKpiMeasuredFixture(), pendingIncomingKpiRestart: { phase: "stopping" } }, version: 0 });
    expect(expandSmartKpiStorage(raw)).toBe(raw); expect(compactSmartKpiStorage(raw)).toBeUndefined();
    studioStateStorage.setItem("vdt-studio-state", raw); expect(memory.get("vdt-studio-state")).toBe(raw);
  });

  it("uses compact storage only after a quota failure, then rehydrates and verifies the exact immutable request", () => {
    const input = fixture(), raw = JSON.stringify(input); limit = raw.length * 0.4;
    studioStateStorage.setItem("vdt-studio-state", raw);
    expect(studioStatePersistenceProblem()).toBe(false);
    expect(memory.get("vdt-studio-state")!.length).toBeLessThan(limit);
    expect(studioStateStorage.getItem("vdt-studio-state")).toBe(raw);
    expect(smartKpiJournalPersisted("smart_codec_qa", input.state.smartKpiOperation.input)).toBe(true);
    expect(smartKpiJournalPersisted("different-operation", input.state.smartKpiOperation.input)).toBe(false);
    const changed = structuredClone(input.state.smartKpiOperation.input); changed.summary = "Other body";
    expect(smartKpiJournalPersisted("smart_codec_qa", changed)).toBe(false);
  });

  it("preserves the last durable record when neither representation fits", () => {
    const previous = JSON.stringify({ state: { selectedNodeId: "retained-draft" }, version: 0 });
    memory.set("vdt-studio-state", previous); limit = previous.length;
    studioStateStorage.setItem("vdt-studio-state", JSON.stringify(fixture()));
    expect(studioStatePersistenceProblem()).toBe(true); expect(memory.get("vdt-studio-state")).toBe(previous);
    expect(smartKpiJournalPersisted("smart_codec_qa")).toBe(false);
  });

  it.each(["version", "references", "anchor"])("retains unsupported/corrupt %s evidence and blocks overwriting it", corruption => {
    const packed = JSON.parse(compactSmartKpiStorage(JSON.stringify(fixture()))!);
    if (corruption === "version") packed.smartKpiPersistence.schemaVersion = "unsupported";
    else if (corruption === "references") packed.smartKpiPersistence.operation.versions[0][1] = 999999;
    else packed.state.project.graph.nodes[0].name = "Changed shared anchor";
    const evidence = JSON.stringify(packed); memory.set("vdt-studio-state", evidence);
    expect(studioStateStorage.getItem("vdt-studio-state")).toBeNull();
    studioStateStorage.setItem("vdt-studio-state", JSON.stringify({ state: { project: "replacement" } }));
    expect(memory.get("vdt-studio-state")).toBe(evidence); expect(studioStatePersistenceProblem()).toBe(true);
  });
});
