import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createAgenticGeneratePrompt,
  finalizeAgenticVdtRun,
  loadSkillLibraryFromFs,
  prepareAgenticVdtRun,
  retrieveSkills,
  type GenerateVdtInputLike,
  type SkillExcerpt
} from "./index";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillsRoot = join(packageRoot, "skills");

async function listPackageFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        return listPackageFiles(path);
      }
      return entry.isFile() ? [path] : [];
    })
  );
  return nested.flat();
}

describe("VDT agent skill library", () => {
  it("loads registry and verifies every skill path is referenced", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const registryPaths = new Set(library.registry.map((entry) => entry.path));
    const skillPaths = library.skills.map((skill) => skill.path).sort();

    expect(skillPaths).toEqual([
      "finance/revenue-profit.md",
      "generic/logical-kpi-decomposition.md",
      "mining/haulage-truck-cycle.md",
      "mining/production-volume.md",
      "saas/funnel-growth.md"
    ]);
    expect(skillPaths.every((path) => registryPaths.has(path))).toBe(true);
    expect(
      library.registry.every(
        (entry) =>
          entry.inputRequirements.length > 0 &&
          entry.expectedOutputs.length > 0 &&
          entry.confidenceHints.length > 0 &&
          entry.whenNotToUse.length > 0
      )
    ).toBe(true);
  });

  it.each([
    [
      "mining haulage",
      {
        rootKpi: "Annual ore hauled",
        industry: "Mining",
        businessContext: "Open-pit truck haulage with payload and cycle time constraints"
      },
      "mining.haulage.truck_cycle"
    ],
    [
      "finance profit",
      {
        rootKpi: "Operating profit",
        industry: "Retail",
        businessContext: "Revenue, discounts, variable costs, and operating expenses"
      },
      "finance.revenue_profit"
    ],
    [
      "saas funnel",
      {
        rootKpi: "Net new MRR",
        industry: "SaaS",
        businessContext: "Signup, activation, trial conversion, expansion, and churn"
      },
      "saas.funnel_growth"
    ],
    [
      "generic KPI",
      {
        rootKpi: "Service quality score",
        businessContext: "Operational KPI with capacity, utilization, and quality drivers"
      },
      "generic.logical_kpi_decomposition"
    ]
  ])("retrieves deterministic skill for %s", async (_name, request: GenerateVdtInputLike, expectedSkillId) => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const selected = retrieveSkills(request, library, { maxSkills: 2 });

    expect(selected[0]?.skill.id).toBe(expectedSkillId);
  });

  it("does not select same-domain mining skills without an explicit skill pattern match", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const selected = retrieveSkills(
      {
        rootKpi: "Maintenance cost per tonne",
        industry: "Mining",
        businessContext: "Reduce maintenance cost per tonne across mobile equipment"
      },
      library,
      { maxSkills: 3 }
    );

    expect(selected.map((candidate) => candidate.skill.id)).toEqual(["generic.logical_kpi_decomposition"]);
  });
});

describe("VDT agent runtime preparation", () => {
  it("emits real events for classification, skill retrieval, reading, questions, and planning", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const { run, prompt } = prepareAgenticVdtRun(
      {
        rootKpi: "Ore mined",
        industry: "Mining",
        businessContext: "Production volume constrained by haulage and plant throughput"
      },
      library,
      {
        runId: "test-run",
        now: () => new Date("2026-06-25T00:00:00.000Z")
      }
    );

    expect(run.status).toBe("running");
    expect(run.phase).toBe("generating_graph");
    expect(run.finalReport).toBeUndefined();
    expect(run.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "classification",
      "skill_search",
      "skill_selected",
      "skill_read",
      "clarifying_questions",
      "planning_decomposition"
    ]));
    expect(run.events.map((event) => event.type)).not.toContain("final_report");
    expect(run.selectedSkills.map((skill) => skill.id)).toContain("mining.production_volume");
    expect(prompt.decompositionPlan.selectedSkillIds).toContain("mining.production_volume");
  });

  it("can block preparation on clarifying questions without marking the run succeeded", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const { run } = prepareAgenticVdtRun(
      {
        rootKpi: "Operating profit",
        industry: "Finance"
      },
      library,
      {
        runId: "needs-input-run",
        continueWithAssumptions: false,
        now: () => new Date("2026-06-25T00:00:00.000Z")
      }
    );

    expect(run.status).toBe("needs_user_input");
    expect(run.phase).toBe("asking_clarifying_questions");
    expect(run.questionsForUser?.length).toBeGreaterThan(0);
    expect(run.events.map((event) => event.type)).not.toContain("final_report");
  });

  it("finalizes only after model completion and graph validation events", async () => {
    const library = await loadSkillLibraryFromFs(skillsRoot);
    const { run } = prepareAgenticVdtRun(
      {
        rootKpi: "Net new MRR",
        industry: "SaaS",
        unit: "USD/month",
        timePeriod: "monthly",
        businessContext: "Signup, activation, conversion, expansion, and churn"
      },
      library,
      {
        runId: "finalize-run",
        now: () => new Date("2026-06-25T00:00:00.000Z")
      }
    );

    const finalized = finalizeAgenticVdtRun(run, {
      resultProjectId: "project-123",
      finalReport: "Generated a SaaS MRR driver tree.",
      validationSummary: "Graph validation passed: 12 nodes, 11 decomposition edges.",
      now: () => new Date("2026-06-25T00:01:00.000Z")
    });

    expect(finalized.status).toBe("succeeded");
    expect(finalized.phase).toBe("reporting");
    expect(finalized.resultProjectId).toBe("project-123");
    expect(finalized.finalReport).toBe("Generated a SaaS MRR driver tree.");
    expect(finalized.events.slice(-3).map((event) => event.type)).toEqual([
      "model_call_completed",
      "graph_validation",
      "final_report"
    ]);
  });

  it("can prepare prompt additions from selected excerpts without calling a provider", () => {
    const excerpts: SkillExcerpt[] = [
      {
        id: "finance.revenue_profit",
        path: "finance/revenue-profit.md",
        title: "Finance revenue and profit decomposition",
        domain: "finance",
        excerpt: [
          "## Formula Templates",
          "revenue = units_sold * average_selling_price * (1 - discount_rate) - refunds",
          "operating_profit = gross_profit - operating_expenses"
        ].join("\n"),
        outputs: ["revenue", "gross_profit", "operating_profit"],
        questions: ["Is the target revenue, gross profit, operating profit, EBITDA, or net profit?"]
      }
    ];

    const prompt = createAgenticGeneratePrompt(
      {
        rootKpi: "Operating profit",
        industry: "Finance",
        unit: "USD",
        timePeriod: "FY2027"
      },
      excerpts
    );

    expect(prompt.systemPromptAddition).toContain("Use the selected VDT skills");
    expect(prompt.userPromptAddition).toContain("finance.revenue_profit");
    expect(prompt.decompositionPlan.formulaTemplates).toContain(
      "revenue = units_sold * average_selling_price * (1 - discount_rate) - refunds"
    );
    expect(prompt.finalReportSeed).toContain("Validation result: pending graph generation");
  });

  it("does not contain forbidden fake progress strings in package files or generated output", async () => {
    const forbidden = [["The model is", " thinking"].join(""), ["Reasoning", "..."].join("")];
    const files = await listPackageFiles(packageRoot);
    const text = (
      await Promise.all(
        files
          .filter((path) => /\.(ts|md|json)$/.test(path))
          .map(async (path) => `${relative(packageRoot, path)}\n${await readFile(path, "utf8")}`)
      )
    ).join("\n");

    const generated = createAgenticGeneratePrompt(
      { rootKpi: "Generic KPI" },
      [
        {
          id: "generic.logical_kpi_decomposition",
          path: "generic/logical-kpi-decomposition.md",
          title: "Generic logical KPI decomposition",
          domain: "generic",
          excerpt: "## Formula Templates\noutput_value = volume * rate",
          outputs: ["volume_rate_tree"],
          questions: []
        }
      ]
    );

    for (const phrase of forbidden) {
      expect(text).not.toContain(phrase);
      expect(JSON.stringify(generated)).not.toContain(phrase);
    }
  });
});
