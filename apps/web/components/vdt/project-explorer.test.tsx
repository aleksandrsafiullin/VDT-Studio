import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cloneProject, createVersionSnapshot, productionVolumeProject } from "@vdt-studio/vdt-core";
import { ProjectExplorer } from "./project-explorer";

describe("ProjectExplorer", () => {
  it("renders the current project tree and comparison baseline count", () => {
    const project = createVersionSnapshot(cloneProject(productionVolumeProject), {
      name: "Before downtime change"
    });
    const html = renderToStaticMarkup(<ProjectExplorer project={project} />);

    expect(html).toContain('data-testid="project-explorer"');
    expect(html).toContain("Project explorer");
    expect(html).toContain("Projects");
    expect(html).toContain('data-testid="project-explorer-vdts"');
    expect(html).toContain('data-testid="project-explorer-conversations"');
    expect(html).toContain('data-testid="project-explorer-comparisons"');
    expect(html).toContain('data-testid="project-explorer-files"');
    expect(html).toContain("1 snapshot baseline");
    expect(html).toContain("JSON, SVG, and Markdown exports");
  });

  it("renders storage-backed workspace counts when provided", () => {
    const project = cloneProject(productionVolumeProject);
    const html = renderToStaticMarkup(
      <ProjectExplorer
        project={project}
        storedSummary={{
          projects: [
            {
              project: {
                id: "project_agent_workspace",
                name: "Agent workspace",
                industry: "Mining",
                createdAt: "2026-06-29T13:00:00.000Z",
                updatedAt: "2026-06-29T13:00:00.000Z"
              },
              runtimeState: {
                schemaVersion: "project_runtime_state.v1",
                projectId: "project_agent_workspace",
                runtimeGeneration: "v1",
                generationVersion: 1,
                migrationState: "shadow_ready",
                writeState: "enabled",
                updatedAt: "2026-06-29T13:00:00.000Z"
              },
              counts: {
                vdts: 2,
                revisions: 4,
                conversations: 1,
                agentRuns: 3,
                mutationProposals: 2,
                comparisons: 1
              },
              vdts: [
                {
                  vdt: {
                    id: "vdt_production",
                    projectId: "project_agent_workspace",
                    name: "Production VDT",
                    rootKpi: "Production Volume",
                    status: "draft",
                    activeRevisionId: "revision_2",
                    createdAt: "2026-06-29T13:00:00.000Z",
                    updatedAt: "2026-06-29T13:00:00.000Z"
                  },
                  head: {
                    schemaVersion: "vdt_revision_head.v2",
                    projectId: "project_agent_workspace",
                    vdtId: "vdt_production",
                    activeRevisionId: "revision_2",
                    activeContentIdentity: {
                      scheme: "legacy_graph_sha256",
                      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    },
                    pendingRevisionId: null,
                    commitGeneration: 2
                  },
                  revisionCount: 2
                }
              ]
            }
          ]
        }}
      />
    );

    expect(html).toContain('data-testid="project-explorer-storage"');
    expect(html).toContain("SQLite workspace");
    expect(html).toContain("1 project");
    expect(html).toContain("2 VDTs");
    expect(html).toContain("4 revisions");
    expect(html).toContain("Agent workspace: 1 conversation");
    expect(html).toContain("1 comparison");
  });
});
