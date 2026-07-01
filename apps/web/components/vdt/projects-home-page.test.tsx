import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsHomePage, ProjectsHomeProjectCards } from "./projects-home-page";
import { useVdtStudioStore } from "./vdt-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn()
  })
}));

describe("ProjectsHomePage", () => {
  beforeEach(() => {
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
    expect(html).toContain("Agent workspace");
    expect(html).toContain("2 VDTs");
    expect(html).toContain("4 revisions");
    expect(html).toContain('href="/projects/project_home_test"');
  });
});
