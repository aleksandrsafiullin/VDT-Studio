import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateGraph } from "@vdt-studio/vdt-core";
import {
  generateVdtOutputSchema,
  generateVdtOutputToProject,
  generateVdtProject,
  LocalRunnerProvider,
  MockProvider,
  productionVolumeAiOutput
} from "./index";

describe("AI harness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates deterministic mock output", () => {
    const output = generateVdtOutputSchema.parse(productionVolumeAiOutput);

    expect(output.rootNodeId).toBe("production_volume");
    expect(output.nodes.length).toBeGreaterThan(5);
  });

  it("converts valid AI output into a calculable project", () => {
    const project = generateVdtOutputToProject(productionVolumeAiOutput, {
      rootKpi: "Production Volume",
      industry: "Mining / Processing Plant"
    });

    const withValues = {
      ...project,
      graph: {
        ...project.graph,
        nodes: project.graph.nodes.map((node) => {
          const baseline: Record<string, number> = {
            calendar_time: 720,
            planned_downtime: 40,
            unplanned_downtime: 80,
            nominal_rate: 220,
            utilization_factor: 0.9,
            yield_factor: 0.96
          };
          return baseline[node.id] !== undefined ? { ...node, baselineValue: baseline[node.id] } : node;
        })
      }
    };

    expect(calculateGraph(withValues).rootValue).toBeCloseTo(114048, 5);
    expect(project.aiReview?.assumptions).toContain("Production volume is measured as useful output, not gross material movement.");
    expect(project.aiReview?.questionsForUser.length).toBeGreaterThan(0);
    expect(project.aiReview?.warnings[0]?.message).toContain("Yield factor");
  });

  it("generates a project through the mock provider", async () => {
    const project = await generateVdtProject(new MockProvider(), {
      rootKpi: "Production Volume",
      industry: "Mining / Processing Plant",
      unit: "tonnes/month",
      goal: "Understand what drives production decrease",
      levelOfDetail: "medium"
    });

    expect(project.name).toBe("Production Volume Driver Model");
    expect(project.rootNodeId).toBe("production_volume");
  });

  it("generates a project through a local runner provider", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, output: productionVolumeAiOutput }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const project = await generateVdtProject(
      new LocalRunnerProvider({
        runnerUrl: "http://127.0.0.1:8765",
        runnerProviderId: "local_http_stub",
        providerConfig: {
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen3"
        },
        timeoutSec: 30
      }),
      {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        unit: "tonnes/month",
        goal: "Understand what drives production decrease",
        levelOfDetail: "medium"
      }
    );

    expect(project.name).toBe("Production Volume Driver Model");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/run",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("rejects invalid AI output", () => {
    expect(() =>
      generateVdtOutputSchema.parse({
        ...productionVolumeAiOutput,
        rootNodeId: "missing_root"
      })
    ).toThrow();
  });

  it("rejects non-root root nodes and malformed formulas during project conversion", () => {
    expect(() =>
      generateVdtOutputToProject(
        {
          ...productionVolumeAiOutput,
          rootNodeId: "calendar_time"
        },
        { rootKpi: "Production Volume" }
      )
    ).toThrow(/root_kpi/);

    expect(() =>
      generateVdtOutputToProject(
        {
          ...productionVolumeAiOutput,
          nodes: productionVolumeAiOutput.nodes.map((node) =>
            node.id === "production_volume" ? { ...node, formula: "effective_working_time *" } : node
          )
        },
        { rootKpi: "Production Volume" }
      )
    ).toThrow(/invalid graph/);
  });
});
