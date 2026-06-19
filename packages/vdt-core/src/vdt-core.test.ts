import { describe, expect, it } from "vitest";
import {
  calculateGraph,
  calculateScenario,
  evaluateFormula,
  exportProjectJson,
  exportProjectMarkdown,
  productionVolumeProject,
  validateGraph,
  type VdtProject
} from "./index";

describe("formula engine", () => {
  it("evaluates arithmetic, parentheses and percent literals", () => {
    expect(evaluateFormula("(a + b) * 90%", { a: 10, b: 20 }).value).toBe(27);
    expect(evaluateFormula("rate * utilization", { rate: 220, utilization: 0.9 }).value).toBe(198);
  });

  it("reports missing values and division by zero", () => {
    const missing = evaluateFormula("a + b", { a: 1 });
    expect(missing.errors[0]?.type).toBe("missing_value");
    expect(missing.references).toEqual(["a", "b"]);
    expect(evaluateFormula("a / b", { a: 1, b: 0 }).errors[0]?.type).toBe("division_by_zero");
  });
});

describe("production volume example", () => {
  it("calculates the expected baseline values", () => {
    const result = calculateGraph(productionVolumeProject);

    expect(result.errors).toHaveLength(0);
    expect(result.values.effective_working_time).toBe(600);
    expect(result.values.average_productivity).toBeCloseTo(190.08, 5);
    expect(result.values.production_volume).toBeCloseTo(114048, 5);
    expect(result.rootValue).toBeCloseTo(114048, 5);
    expect(result.trace.find((item) => item.nodeId === "production_volume")?.resolvedFormula).toBe("600 * 190.08");
  });

  it("calculates scenario impact for reduced unplanned downtime", () => {
    const scenario = productionVolumeProject.scenarios[0];
    expect(scenario).toBeDefined();

    const result = calculateScenario(productionVolumeProject, scenario!);

    expect(result.baselineValue).toBeCloseTo(114048, 5);
    expect(result.scenarioValue).toBeCloseTo(117849.6, 5);
    expect(result.absoluteChange).toBeCloseTo(3801.6, 5);
    expect(result.percentageChange).toBeCloseTo(3.333333, 4);
    expect(result.impactedNodes.map((node) => node.nodeId)).toContain("unplanned_downtime");
  });
});

describe("graph validation", () => {
  it("accepts the example graph", () => {
    const result = validateGraph(productionVolumeProject.graph, productionVolumeProject.rootNodeId);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("detects missing edge references and duplicate edge pairs", () => {
    const graph = {
      ...productionVolumeProject.graph,
      edges: [
        ...productionVolumeProject.graph.edges,
        {
          id: "bad_edge",
          sourceNodeId: "production_volume",
          targetNodeId: "missing_node",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "dup_pair",
          sourceNodeId: "production_volume",
          targetNodeId: "effective_working_time",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const result = validateGraph(graph, productionVolumeProject.rootNodeId);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("missing target"))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes("Duplicate edge pair"))).toBe(true);
  });

  it("detects formula parse errors, unknown references and circular dependencies", () => {
    const badFormula = {
      ...productionVolumeProject.graph,
      nodes: productionVolumeProject.graph.nodes.map((node) =>
        node.id === "production_volume" ? { ...node, formula: "missing_node *" } : node
      )
    };

    const badFormulaResult = validateGraph(badFormula, productionVolumeProject.rootNodeId);
    expect(badFormulaResult.valid).toBe(false);
    expect(badFormulaResult.errors.some((error) => error.type === "formula_parse_error")).toBe(true);

    const missingReference = {
      ...productionVolumeProject.graph,
      nodes: productionVolumeProject.graph.nodes.map((node) =>
        node.id === "production_volume" ? { ...node, formula: "missing_node * average_productivity" } : node
      )
    };

    const missingReferenceResult = validateGraph(missingReference, productionVolumeProject.rootNodeId);
    expect(missingReferenceResult.valid).toBe(false);
    expect(missingReferenceResult.errors.some((error) => error.type === "unknown_reference")).toBe(true);

    const circular = {
      nodes: [
        {
          id: "a",
          name: "A",
          type: "root_kpi" as const,
          status: "accepted" as const,
          formula: "b + 1",
          aiGenerated: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "b",
          name: "B",
          type: "calculated" as const,
          status: "accepted" as const,
          formula: "a + 1",
          aiGenerated: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ],
      edges: [
        {
          id: "edge_a_b",
          sourceNodeId: "a",
          targetNodeId: "b",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const circularResult = validateGraph(circular, "a");
    expect(circularResult.valid).toBe(false);
    expect(circularResult.errors.some((error) => error.type === "circular_dependency")).toBe(true);
  });
});

describe("calculation failures", () => {
  it("detects circular formula dependencies", () => {
    const project: VdtProject = {
      ...productionVolumeProject,
      rootNodeId: "a",
      graph: {
        nodes: [
          {
            id: "a",
            name: "A",
            type: "root_kpi",
            status: "accepted",
            formula: "b + 1",
            aiGenerated: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "b",
            name: "B",
            type: "calculated",
            status: "accepted",
            formula: "a + 1",
            aiGenerated: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        edges: [
          {
            id: "edge_a_b",
            sourceNodeId: "a",
            targetNodeId: "b",
            relation: "positive_driver",
            aiGenerated: false
          }
        ]
      },
      scenarios: []
    };

    const result = calculateGraph(project);
    expect(result.errors.some((error) => error.type === "circular_dependency")).toBe(true);
  });

  it("reports missing input values", () => {
    const project: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "calendar_time" ? { ...node, baselineValue: undefined, value: undefined } : node
        )
      }
    };

    const result = calculateGraph(project);
    expect(result.errors.some((error) => error.type === "missing_value" && error.nodeId === "calendar_time")).toBe(true);
  });

  it("reports invalid scenario overrides", () => {
    const result = calculateScenario(productionVolumeProject, {
      ...productionVolumeProject.scenarios[0]!,
      overrides: [{ nodeId: "typo_node", value: 123 }]
    });

    expect(result.errors?.some((error) => error.message.includes("typo_node"))).toBe(true);
  });
});

describe("exports", () => {
  it("exports project JSON and Markdown summary", () => {
    const json = exportProjectJson(productionVolumeProject);
    const markdown = exportProjectMarkdown(productionVolumeProject);

    expect(JSON.parse(json).rootNodeId).toBe("production_volume");
    expect(markdown).toContain("# Production Volume Driver Model");
    expect(markdown).toContain("Production Volume");
    expect(markdown).toContain("Calculation Trace");
  });
});
