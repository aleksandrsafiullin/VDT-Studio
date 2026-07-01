import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredProjectSummary } from "@/lib/vdt-storage-client";

const mockFetchSummaries = vi.fn();

vi.mock("@/lib/vdt-storage-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vdt-storage-client")>();
  return {
    ...actual,
    fetchStoredProjectExplorerSummary: (...args: Parameters<typeof actual.fetchStoredProjectExplorerSummary>) =>
      mockFetchSummaries(...args)
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
            revisionCount: 1
          }
        ]
      : []
  };
}

describe("refreshWorkspace scoping", () => {
  beforeEach(() => {
    mockFetchSummaries.mockReset();
    mockFetchSummaries.mockResolvedValue({
      projects: [
        sampleSummary("project_a", "Project A", "vdt_a"),
        sampleSummary("project_b", "Project B")
      ]
    });
    useVdtStudioStore.setState((state) => ({
      workspace: {
        ...state.workspace,
        activePanel: "vdt",
        projectSummaries: [],
        activeProjectId: "project_a",
        activeVdtId: "vdt_a",
        isLoading: false,
        isMutating: false,
        error: undefined
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
});
