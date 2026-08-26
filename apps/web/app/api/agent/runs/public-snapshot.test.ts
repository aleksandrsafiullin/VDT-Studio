import { describe, expect, it } from "vitest";
import type { MutationProposal, VdtAgentRunSnapshot } from "@vdt-studio/vdt-agent-runtime";
import {
  PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES,
  compactPublicAgentSnapshot
} from "./public-snapshot";

describe("compactPublicAgentSnapshot", () => {
  it("keeps one pending preview and hashes applied preview history", () => {
    const applied = proposal("applied", "applied-preview-marker");
    const pending = proposal("proposed", "pending-preview-marker");
    const snapshot = makeSnapshot({
      mutationProposals: [applied, pending],
      pendingMutationProposal: pending
    });

    const compact = compactPublicAgentSnapshot(snapshot);
    const json = JSON.stringify(compact);

    expect(compact.mutationProposals).toBeUndefined();
    expect(compact.pendingMutationProposal?.previewProject.name).toContain("pending-preview-marker");
    expect(compact.appliedMutationHistory).toEqual([
      expect.objectContaining({
        id: applied.id,
        status: "applied",
        changeSet: applied.changeSet,
        changeSetHash: expect.stringMatching(/^sha256:/),
        previewProjectHash: expect.stringMatching(/^sha256:/)
      })
    ]);
    expect(json).not.toContain("applied-preview-marker");
    expect(json).toContain("pending-preview-marker");
    expect(snapshot.mutationProposals).toHaveLength(2);
  });

  it("bounds a proposal-heavy public snapshot and redacts provider secrets", () => {
    const applied = Array.from({ length: 30 }, (_, index) =>
      proposal("applied", `preview-${index}-${"x".repeat(30_000)}`)
    );
    const snapshot = makeSnapshot({
      request: {
        mode: "generate_vdt",
        input: { rootKpi: "Ore hauled" },
        providerId: "local_runner",
        providerConfig: { backendId: "cursor_subscription", apiKey: "secret-value" }
      },
      mutationProposals: applied,
      events: Array.from({ length: 300 }, (_, index) => ({
        id: `event-${index}`,
        runId: "run-1",
        seq: index + 1,
        timestamp: "2026-08-26T10:00:00.000Z",
        phase: "building_graph" as const,
        type: "graph_patch" as const,
        title: "Patch",
        message: "Applied a patch.",
        patch: { blob: "y".repeat(20_000) } as never
      }))
    });

    const compact = compactPublicAgentSnapshot(snapshot);
    const json = JSON.stringify(compact);

    expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES);
    expect(json).not.toContain("secret-value");
    expect(json).not.toContain("\"patch\"");
    expect(compact.snapshotProjection.compact).toBe(true);
  });
});

function makeSnapshot(overrides: Partial<VdtAgentRunSnapshot> = {}): VdtAgentRunSnapshot {
  return {
    runId: "run-1",
    status: "running",
    phase: "building_graph",
    request: {
      mode: "generate_vdt",
      input: { rootKpi: "Ore hauled" },
      providerId: "mock"
    },
    selectedSkills: [],
    events: [],
    chatMessages: [],
    publicStatus: {
      phase: "building_draft",
      message: "Building the tree.",
      updatedAt: "2026-08-26T10:00:00.000Z"
    },
    visibleContext: {
      threadId: "run-1",
      visibleTitle: "Ore hauled",
      brief: { rootKpi: "Ore hauled" },
      visibleMessages: []
    },
    createdAt: "2026-08-26T10:00:00.000Z",
    updatedAt: "2026-08-26T10:00:00.000Z",
    ...overrides
  };
}

function proposal(
  status: MutationProposal["status"],
  previewName: string
): MutationProposal {
  return {
    id: `proposal-${status}-${previewName.slice(0, 12).replace(/[^a-z0-9-]/gi, "-")}`,
    runId: "run-1",
    projectId: "project-1",
    vdtId: "root",
    baseRevisionId: "builder:0",
    baseRevision: 0,
    source: "agent",
    title: "Add drivers",
    summary: "Adds a bounded driver layer.",
    changeSet: {
      id: "changes-1",
      additions: [],
      updates: [],
      deletions: []
    } as unknown as MutationProposal["changeSet"],
    selectedChangeIds: [],
    previewProject: {
      id: "project-1",
      name: previewName,
      rootNodeId: "root",
      graph: { nodes: [], edges: [] }
    } as unknown as MutationProposal["previewProject"],
    validation: { valid: true, errors: [], warnings: [] },
    status,
    policy: {
      autoApply: true,
      askBeforeFirstPatch: false,
      requireApprovalForGraphStructure: false,
      requireApprovalForFormulaChanges: false,
      requireApprovalForDelete: false
    },
    createdAt: "2026-08-26T10:00:00.000Z",
    ...(status === "applied" ? { appliedAt: "2026-08-26T10:00:01.000Z" } : {})
  };
}
