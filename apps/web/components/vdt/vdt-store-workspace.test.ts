import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  VdtStorageRequestError,
  type StoredProjectSummary
} from "@/lib/vdt-storage-client";

const mockFetchSummaries = vi.fn();
const mockSaveRevision = vi.fn();
const mockFetchRevisionState = vi.fn();
const mockCreateVdt = vi.fn();
const mockCreateProject = vi.fn();
const mockLoadVdt = vi.fn();
const mockUpdateVdt = vi.fn();

vi.mock("@/lib/vdt-storage-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vdt-storage-client")>();
  return {
    ...actual,
    fetchStoredProjectExplorerSummary: (...args: Parameters<typeof actual.fetchStoredProjectExplorerSummary>) =>
      mockFetchSummaries(...args),
    saveStoredVdtRevision: (...args: Parameters<typeof actual.saveStoredVdtRevision>) =>
      mockSaveRevision(...args),
    fetchStoredVdtRevisionState: (...args: Parameters<typeof actual.fetchStoredVdtRevisionState>) =>
      mockFetchRevisionState(...args),
    createStoredVdt: (...args: Parameters<typeof actual.createStoredVdt>) =>
      mockCreateVdt(...args),
    createStoredProject: (...args: Parameters<typeof actual.createStoredProject>) =>
      mockCreateProject(...args),
    loadStoredVdt: (...args: Parameters<typeof actual.loadStoredVdt>) =>
      mockLoadVdt(...args),
    updateStoredVdt: (...args: Parameters<typeof actual.updateStoredVdt>) =>
      mockUpdateVdt(...args)
  };
});

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const { useVdtStudioStore } = await import("./vdt-store");
const initialProject = structuredClone(useVdtStudioStore.getState().project);

function sampleSummary(
  projectId: string,
  name: string,
  vdtId?: string
): StoredProjectSummary {
  return {
    project: {
      id: projectId,
      name,
      createdAt: "2026-06-29T13:00:00.000Z",
      updatedAt: "2026-06-29T13:00:00.000Z"
    },
    runtimeState: {
      schemaVersion: "project_runtime_state.v1",
      projectId,
      runtimeGeneration: "v1",
      generationVersion: 1,
      migrationState: "shadow_ready",
      writeState: "enabled",
      updatedAt: "2026-06-29T13:00:00.000Z"
    },
    counts: {
      vdts: vdtId ? 1 : 0,
      revisions: vdtId ? 1 : 0,
      conversations: 0,
      agentRuns: 0,
      mutationProposals: 0,
      comparisons: 0
    },
    vdts: vdtId
      ? [
          {
            vdt: {
              id: vdtId,
              projectId,
              name: `${name} VDT`,
              rootKpi: "Root KPI",
              status: "draft",
              createdAt: "2026-06-29T13:00:00.000Z",
              updatedAt: "2026-06-29T13:00:00.000Z"
            },
            head: {
              schemaVersion: "vdt_revision_head.v2",
              projectId,
              vdtId,
              activeRevisionId: `revision_${vdtId}_1`,
              activeContentIdentity: {
                scheme: "legacy_graph_sha256",
                hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
              },
              pendingRevisionId: null,
              commitGeneration: 1
            },
            revisionCount: 1
          }
        ]
      : []
  };
}

describe("refreshWorkspace scoping", () => {
  beforeEach(() => {
    mockFetchSummaries.mockReset();
    mockSaveRevision.mockReset();
    mockFetchRevisionState.mockReset();
    mockCreateVdt.mockReset();
    mockCreateProject.mockReset();
    mockLoadVdt.mockReset();
    mockUpdateVdt.mockReset();
    localStorageMock.clear();
    mockFetchSummaries.mockResolvedValue({
      projects: [
        sampleSummary("project_a", "Project A", "vdt_a"),
        sampleSummary("project_b", "Project B")
      ]
    });
    useVdtStudioStore.setState((state) => ({
      project: structuredClone(initialProject),
      projectRevision: 0,
      workspace: {
        ...state.workspace,
        activePanel: "vdt",
        projectSummaries: [
          sampleSummary("project_a", "Project A", "vdt_a"),
          sampleSummary("project_b", "Project B")
        ],
        activeProjectId: "project_a",
        activeVdtId: "vdt_a",
        isLoading: false,
        isMutating: false,
        error: undefined,
        lastSavedAt: undefined,
        pendingRevisionCommit: undefined,
        pendingVdtCreate: undefined
      }
    }));
  });

  it("preserves active project and VDT on unscoped refresh when IDs remain valid", async () => {
    await useVdtStudioStore.getState().refreshWorkspace();

    const workspace = useVdtStudioStore.getState().workspace;
    expect(workspace.activeProjectId).toBe("project_a");
    expect(workspace.activeVdtId).toBe("vdt_a");
    expect(workspace.activePanel).toBe("vdt");
    expect(workspace.projectSummaries).toHaveLength(2);
  });

  it("sets active project from scoped refresh without adopting another active VDT", async () => {
    await useVdtStudioStore.getState().refreshWorkspace({ scopedProjectId: "project_b" });

    const workspace = useVdtStudioStore.getState().workspace;
    expect(workspace.activeProjectId).toBe("project_b");
    expect(workspace.activeVdtId).toBeUndefined();
    expect(workspace.activePanel).toBe("project");
  });

  it("leaves workspace unselected after home clear plus unscoped refresh", async () => {
    useVdtStudioStore.getState().clearHomeWorkspaceContext();
    await useVdtStudioStore.getState().refreshWorkspace();

    const workspace = useVdtStudioStore.getState().workspace;
    expect(workspace.activeProjectId).toBeUndefined();
    expect(workspace.activeVdtId).toBeUndefined();
    expect(workspace.activePanel).toBe("project");
    expect(workspace.projectSummaries).toHaveLength(2);
  });

  it("reuses one immutable manual-save request after an ambiguous transport failure", async () => {
    mockSaveRevision.mockRejectedValueOnce(new Error("connection closed after request"));
    const firstResult = await useVdtStudioStore.getState().saveActiveWorkspaceVdt();

    expect(firstResult).toBe(false);
    const pending = useVdtStudioStore.getState().workspace.pendingRevisionCommit;
    expect(pending?.input.idempotencyKey).toMatch(/^manual-save:vdt_a:/);
    expect(useVdtStudioStore.getState().workspace.lastSavedAt).toBeUndefined();

    const committed = committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2);
    mockSaveRevision.mockResolvedValueOnce(committed);
    const secondResult = await useVdtStudioStore.getState().saveActiveWorkspaceVdt();

    expect(secondResult).toBe(true);
    expect(mockSaveRevision).toHaveBeenCalledTimes(2);
    expect(mockSaveRevision.mock.calls[1]?.[1]).toEqual(mockSaveRevision.mock.calls[0]?.[1]);
    expect(useVdtStudioStore.getState().workspace.pendingRevisionCommit).toBeUndefined();
    expect(useVdtStudioStore.getState().workspace.lastSavedAt).toEqual(expect.any(String));
    expect(mockUpdateVdt).not.toHaveBeenCalled();
  });

  it("rehydrates and replays the exact pending manual-save operation", async () => {
    useVdtStudioStore.setState({ projectRevision: 7 });
    mockSaveRevision.mockRejectedValueOnce(new Error("connection closed after request"));
    await expect(useVdtStudioStore.getState().saveActiveWorkspaceVdt()).resolves.toBe(false);
    const firstRequest = structuredClone(mockSaveRevision.mock.calls[0]?.[1]);
    const persisted = localStorageMock.getItem("vdt-studio-state");
    expect(persisted).toContain(firstRequest.idempotencyKey);

    useVdtStudioStore.setState((state) => ({
      projectRevision: 0,
      workspace: { ...state.workspace, pendingRevisionCommit: undefined }
    }));
    localStorageMock.setItem("vdt-studio-state", persisted!);
    await useVdtStudioStore.persist.rehydrate();
    expect(useVdtStudioStore.getState().projectRevision).toBe(7);
    expect(useVdtStudioStore.getState().workspace.pendingRevisionCommit?.input).toEqual(firstRequest);

    mockSaveRevision.mockResolvedValueOnce(
      committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2)
    );
    await expect(useVdtStudioStore.getState().saveActiveWorkspaceVdt()).resolves.toBe(true);
    expect(mockSaveRevision.mock.calls[1]?.[1]).toEqual(firstRequest);
  });

  it("keeps local edits and lastSavedAt on conflict while refreshing only server CAS", async () => {
    const previousSavedAt = "2026-06-29T13:30:00.000Z";
    useVdtStudioStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        lastSavedAt: previousSavedAt,
        projectSummaries: state.workspace.projectSummaries.map((summary) => ({
          ...summary,
          vdts: summary.vdts.map((entry) => (
            entry.vdt.id === "vdt_a"
              ? {
                  ...entry,
                  vdt: {
                    ...entry.vdt,
                    name: "Local metadata sentinel",
                    metadata: { sentinel: "must-survive-conflict-refresh" }
                  }
                }
              : entry
          ))
        }))
      }
    }));
    const projectBefore = structuredClone(useVdtStudioStore.getState().project);
    const vdtBefore = structuredClone(
      sampleEntry(useVdtStudioStore.getState().workspace.projectSummaries, "vdt_a")?.vdt
    );
    const refreshed = committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2);
    mockSaveRevision.mockRejectedValueOnce(
      new VdtStorageRequestError("stale head", 409, "REVISION_CONFLICT", false)
    );
    mockFetchRevisionState.mockResolvedValueOnce({
      vdt: refreshed.vdt,
      head: refreshed.head,
      runtimeState: refreshed.runtimeState
    });

    const result = await useVdtStudioStore.getState().saveActiveWorkspaceVdt();
    const state = useVdtStudioStore.getState();

    expect(result).toBe(false);
    expect(state.project).toEqual(projectBefore);
    expect(state.workspace.lastSavedAt).toBe(previousSavedAt);
    expect(state.workspace.error).toMatch(/reload or rebase/i);
    expect(state.workspace.pendingRevisionCommit).toBeUndefined();
    expect(
      sampleEntry(state.workspace.projectSummaries, "vdt_a")?.head.commitGeneration
    ).toBe(2);
    expect(sampleEntry(state.workspace.projectSummaries, "vdt_a")?.vdt).toEqual(vdtBefore);
    expect(mockUpdateVdt).not.toHaveBeenCalled();
  });

  it("does not claim a save when the project changes while the commit is in flight", async () => {
    let resolveCommit: ((value: ReturnType<typeof committedPayload>) => void) | undefined;
    mockSaveRevision.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCommit = resolve;
    }));

    const savePromise = useVdtStudioStore.getState().saveActiveWorkspaceVdt();
    useVdtStudioStore.getState().acceptNode(useVdtStudioStore.getState().project.rootNodeId);
    resolveCommit?.(committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2));

    await expect(savePromise).resolves.toBe(false);
    expect(useVdtStudioStore.getState().workspace.lastSavedAt).toBeUndefined();
    expect(useVdtStudioStore.getState().workspace.error).toMatch(/newer local edits/i);
  });

  it("blocks navigation when a completed save covers an older in-flight snapshot", async () => {
    let resolveCommit: ((value: ReturnType<typeof committedPayload>) => void) | undefined;
    mockSaveRevision.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCommit = resolve;
    }));

    const navigationPromise = useVdtStudioStore.getState().selectWorkspaceProject("project_b");
    useVdtStudioStore.getState().acceptNode(useVdtStudioStore.getState().project.rootNodeId);
    resolveCommit?.(committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2));

    await expect(navigationPromise).resolves.toBe(false);
    expect(useVdtStudioStore.getState().workspace.activeProjectId).toBe("project_a");
    expect(useVdtStudioStore.getState().workspace.activeVdtId).toBe("vdt_a");
    expect(useVdtStudioStore.getState().workspace.error).toMatch(/newer local edits/i);
  });

  it("reuses the combined-create body and key after an ambiguous result", async () => {
    useVdtStudioStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        activePanel: "project",
        projectSummaries: [sampleSummary("project_a", "Project A")],
        activeProjectId: "project_a",
        activeVdtId: undefined
      }
    }));
    mockCreateVdt.mockRejectedValueOnce(new Error("response lost"));

    await expect(
      useVdtStudioStore.getState().createWorkspaceVdt({ name: "Created VDT", rootKpi: "Revenue" })
    ).resolves.toBe(false);
    const pending = useVdtStudioStore.getState().workspace.pendingVdtCreate;
    expect(pending?.input.idempotencyKey).toMatch(/^create-vdt:project_a:/);

    const created = committedPayload(sampleSummary("project_a", "Project A", "vdt_created"), "vdt_created", 1);
    mockCreateVdt.mockResolvedValueOnce(created);
    await expect(
      useVdtStudioStore.getState().createWorkspaceVdt({ name: "Ignored retry input" })
    ).resolves.toBe(true);

    expect(mockCreateVdt.mock.calls[1]?.[1]).toEqual(mockCreateVdt.mock.calls[0]?.[1]);
    expect(useVdtStudioStore.getState().workspace.pendingVdtCreate).toBeUndefined();
    expect(useVdtStudioStore.getState().workspace.activeVdtId).toBe("vdt_created");
  });

  it("rehydrates and replays the exact pending combined-create operation", async () => {
    useVdtStudioStore.setState((state) => ({
      projectRevision: 11,
      workspace: {
        ...state.workspace,
        activePanel: "project",
        projectSummaries: [sampleSummary("project_a", "Project A")],
        activeProjectId: "project_a",
        activeVdtId: undefined
      }
    }));
    mockCreateVdt.mockRejectedValueOnce(new Error("response lost"));
    await expect(
      useVdtStudioStore.getState().createWorkspaceVdt({ name: "Created VDT", rootKpi: "Revenue" })
    ).resolves.toBe(false);
    const firstRequest = structuredClone(mockCreateVdt.mock.calls[0]?.[1]);
    const persisted = localStorageMock.getItem("vdt-studio-state");
    expect(persisted).toContain(firstRequest.idempotencyKey);

    useVdtStudioStore.setState((state) => ({
      projectRevision: 0,
      workspace: { ...state.workspace, pendingVdtCreate: undefined }
    }));
    localStorageMock.setItem("vdt-studio-state", persisted!);
    await useVdtStudioStore.persist.rehydrate();
    expect(useVdtStudioStore.getState().projectRevision).toBe(11);
    expect(useVdtStudioStore.getState().workspace.pendingVdtCreate?.input).toEqual(firstRequest);

    mockCreateVdt.mockResolvedValueOnce(
      committedPayload(sampleSummary("project_a", "Project A", "vdt_created"), "vdt_created", 1)
    );
    await expect(
      useVdtStudioStore.getState().createWorkspaceVdt({ name: "Ignored after reload" })
    ).resolves.toBe(true);
    expect(mockCreateVdt.mock.calls[1]?.[1]).toEqual(firstRequest);
  });

  it("does not switch VDTs when the local project changes during combined create", async () => {
    useVdtStudioStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        activePanel: "project",
        projectSummaries: [sampleSummary("project_a", "Project A")],
        activeProjectId: "project_a",
        activeVdtId: undefined
      }
    }));
    let resolveCreate: ((value: ReturnType<typeof committedPayload>) => void) | undefined;
    mockCreateVdt.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    const projectBefore = structuredClone(useVdtStudioStore.getState().project);

    const createPromise = useVdtStudioStore.getState().createWorkspaceVdt({
      name: "Created VDT",
      rootKpi: "Revenue"
    });
    useVdtStudioStore.getState().acceptNode(useVdtStudioStore.getState().project.rootNodeId);
    const editedProject = structuredClone(useVdtStudioStore.getState().project);
    expect(editedProject).not.toEqual(projectBefore);
    resolveCreate?.(
      committedPayload(sampleSummary("project_a", "Project A", "vdt_created"), "vdt_created", 1)
    );

    await expect(createPromise).resolves.toBe(false);
    expect(useVdtStudioStore.getState().project).toEqual(editedProject);
    expect(useVdtStudioStore.getState().workspace.activeVdtId).toBeUndefined();
    expect(useVdtStudioStore.getState().workspace.lastSavedAt).toBeUndefined();
    expect(useVdtStudioStore.getState().workspace.error).toMatch(/newer local edits/i);
    expect(
      sampleEntry(useVdtStudioStore.getState().workspace.projectSummaries, "vdt_created")
    ).toBeDefined();
  });

  it.each([
    ["retryable", true, true],
    ["terminal", false, false]
  ])("%s manual error retains pending operation: %s", async (_label, retryable, expectedPending) => {
    mockSaveRevision.mockRejectedValueOnce(
      new VdtStorageRequestError(
        retryable ? "still committing" : "stale head",
        409,
        retryable ? "REVISION_IN_PROGRESS" : "REVISION_CONFLICT",
        retryable
      )
    );
    if (!retryable) {
      const current = committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2);
      mockFetchRevisionState.mockResolvedValueOnce({
        vdt: current.vdt,
        head: current.head,
        runtimeState: current.runtimeState
      });
    }

    await expect(useVdtStudioStore.getState().saveActiveWorkspaceVdt()).resolves.toBe(false);
    expect(Boolean(useVdtStudioStore.getState().workspace.pendingRevisionCommit)).toBe(expectedPending);
  });

  it.each([
    ["retryable", true, true],
    ["terminal", false, false]
  ])("%s create error retains pending operation: %s", async (_label, retryable, expectedPending) => {
    useVdtStudioStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        activePanel: "project",
        projectSummaries: [sampleSummary("project_a", "Project A")],
        activeProjectId: "project_a",
        activeVdtId: undefined
      }
    }));
    mockCreateVdt.mockRejectedValueOnce(
      new VdtStorageRequestError(
        retryable ? "still creating" : "conflict",
        409,
        retryable ? "REVISION_IN_PROGRESS" : "VDT_ALREADY_EXISTS",
        retryable
      )
    );

    await expect(
      useVdtStudioStore.getState().createWorkspaceVdt({ name: "Created VDT", rootKpi: "Revenue" })
    ).resolves.toBe(false);
    expect(Boolean(useVdtStudioStore.getState().workspace.pendingVdtCreate)).toBe(expectedPending);
  });

  it.each([
    ["create project", () => useVdtStudioStore.getState().createWorkspaceProject("Blocked project")],
    ["create VDT", () => useVdtStudioStore.getState().createWorkspaceVdt({ name: "Blocked VDT" })],
    ["select project", () => useVdtStudioStore.getState().selectWorkspaceProject("project_b")],
    ["select VDT", () => useVdtStudioStore.getState().selectWorkspaceVdt("vdt_other")]
  ])("blocks %s when automatic save conflicts", async (_label, navigate) => {
    mockSaveRevision.mockRejectedValueOnce(
      new VdtStorageRequestError("stale head", 409, "REVISION_CONFLICT", false)
    );
    const current = committedPayload(sampleSummary("project_a", "Project A", "vdt_a"), "vdt_a", 2);
    mockFetchRevisionState.mockResolvedValueOnce({
      vdt: current.vdt,
      head: current.head,
      runtimeState: current.runtimeState
    });

    await expect(navigate()).resolves.toBe(false);
    expect(useVdtStudioStore.getState().workspace.activeVdtId).toBe("vdt_a");
    expect(mockCreateProject).not.toHaveBeenCalled();
    expect(mockCreateVdt).not.toHaveBeenCalled();
    expect(mockLoadVdt).not.toHaveBeenCalled();
  });
});

function committedPayload(summary: StoredProjectSummary, vdtId: string, generation: number) {
  const entry = sampleEntry([summary], vdtId);
  if (!entry) throw new Error(`Missing VDT fixture: ${vdtId}`);
  const head = {
    ...entry.head,
    activeRevisionId: `revision_${vdtId}_${generation}`,
    activeContentIdentity: {
      scheme: "vdt_revision_payload_hash.v1" as const,
      hash: `sha256:${String(generation).padStart(64, "0")}` as const
    },
    commitGeneration: generation
  };
  const nextSummary: StoredProjectSummary = {
    ...summary,
    vdts: summary.vdts.map((candidate) => (
      candidate.vdt.id === vdtId ? { ...candidate, head, revisionCount: generation } : candidate
    ))
  };
  return {
    vdt: entry.vdt,
    revision: {
      id: head.activeRevisionId,
      vdtId,
      revisionNo: generation,
      source: "user" as const,
      summary: "Manual workspace save",
      createdAt: "2026-06-29T13:31:00.000Z"
    },
    head,
    runtimeState: summary.runtimeState,
    summary: nextSummary
  };
}

function sampleEntry(summaries: StoredProjectSummary[], vdtId: string) {
  return summaries.flatMap((summary) => summary.vdts).find((entry) => entry.vdt.id === vdtId);
}
