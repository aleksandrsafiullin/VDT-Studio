import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn()
  }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("./use-workspace-route-sync", () => ({
  useWorkspaceRouteSync: () => ({
    openWorkspaceVdt: vi.fn(),
    showProjectWorkspace: vi.fn()
  })
}));

const { VdtStudioApp } = await import("./vdt-studio-app");
const { useVdtStudioStore } = await import("./vdt-store");

describe("VdtStudioApp project mode", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState((state) => ({
      resumePersistedAgentRun: vi.fn(async () => {}),
      workspace: {
        ...state.workspace,
        activePanel: "project",
        activeProjectId: undefined,
        activeVdtId: undefined,
        projectSummaries: [],
        isLoading: false,
        isMutating: false,
        error: undefined
      }
    }));
  });

  it("shows project management without VDT editor surfaces", () => {
    const html = renderToStaticMarkup(<VdtStudioApp projectId="project_mode_test" />);

    expect(html).toContain('data-testid="workspace-mode-project"');
    expect(html).toContain('data-testid="workspace-mode-vdt"');
    expect(html).toContain("disabled");
    expect(html).toContain("Project management");
    expect(html).toContain('data-testid="back-to-projects"');
    expect(html).toContain("Project workspace");
    expect(html).toContain("No saved project selected");
    expect(html).toContain('data-testid="project-vdt-empty"');
    expect(html).toContain("No project selected");
    expect(html).not.toContain("VDT Agent");
    expect(html).not.toContain("Current brief");
    expect(html).not.toContain('data-testid="vdt-canvas"');
  });
});
