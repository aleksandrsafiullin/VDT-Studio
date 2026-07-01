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
    push: vi.fn()
  })
}));

const { ProjectsHomePage, ProjectsHomeProjectCards } = await import("./projects-home-page");
const { useVdtStudioStore } = await import("./vdt-store");

describe("ProjectsHomePage", () => {
  beforeEach(() => {
    localStorageMock.clear();
    useVdtStudioStore.setState((state) => ({
      clearHomeWorkspaceContext: vi.fn(),
      refreshWorkspace: vi.fn(async () => {}),
      workspace: {
        ...state.workspace,
        activePanel: "project",
        projectSummaries: [],
        isLoading: false,
        isMutating: false,
        error: undefined
      }
    }));
  });

  it("renders the projects home shell and empty state", () => {
    const html = renderToStaticMarkup(<ProjectsHomePage />);

    expect(html).toContain('data-testid="projects-home"');
    expect(html).toContain('data-testid="projects-home-empty"');
    expect(html).toContain('data-testid="create-project-button"');
    expect(html).toContain("VDT Studio");
    expect(html).toContain("No projects yet");
  });

  it("renders saved project cards with counts and updated date", () => {
    const html = renderToStaticMarkup(
      <ProjectsHomeProjectCards
        summaries={[
          {
            project: {
              id: "project_home_test",
              name: "Agent workspace",
              industry: "Mining",
              metadata: {
                clientName: "North Mining Co",
                siteName: "Pilbara",
                year: "2026"
              },
              createdAt: "2026-06-29T13:00:00.000Z",
              updatedAt: "2026-06-29T13:00:00.000Z"
            },
            counts: {
              vdts: 2,
              revisions: 4,
              conversations: 0,
              agentRuns: 0,
              mutationProposals: 0,
              comparisons: 0
            },
            vdts: []
          }
        ]}
        isMutating={false}
        onDeleteProject={() => {}}
      />
    );

    expect(html).toContain('data-testid="projects-home-list"');
    expect(html).toContain('data-testid="project-card-project_home_test"');
    expect(html).toContain('data-testid="project-card-details-project_home_test"');
    expect(html).toContain("Agent workspace");
    expect(html).toContain(">Client<");
    expect(html).toContain("North Mining Co");
    expect(html).toContain(">Site<");
    expect(html).toContain("Pilbara");
    expect(html).toContain(">Year<");
    expect(html).toContain("2026");
    expect(html).toContain("2 VDTs");
    expect(html).toContain("4 revisions");
    expect(html).toContain('href="/projects/project_home_test"');
  });

  it("renders placeholder detail rows when project metadata is empty", () => {
    const html = renderToStaticMarkup(
      <ProjectsHomeProjectCards
        summaries={[
          {
            project: {
              id: "project_empty_meta",
              name: "Empty metadata",
              createdAt: "2026-06-29T13:00:00.000Z",
              updatedAt: "2026-06-29T13:00:00.000Z"
            },
            counts: {
              vdts: 0,
              revisions: 0,
              conversations: 0,
              agentRuns: 0,
              mutationProposals: 0,
              comparisons: 0
            },
            vdts: []
          }
        ]}
        isMutating={false}
        onDeleteProject={() => {}}
      />
    );

    expect(html).toContain('data-testid="project-card-details-project_empty_meta"');
    expect(html).toContain(">Client<");
    expect(html).toContain(">Site<");
    expect(html).toContain(">Year<");
    expect(html).not.toContain("—");
    expect(html).toContain('class="flex h-[13.5rem]');
  });
});
