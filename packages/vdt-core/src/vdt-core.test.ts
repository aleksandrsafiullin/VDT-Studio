import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateGraph,
  calculateScenario,
  evaluateFormula,
  exportProjectSvg,
  exportProjectJson,
  exportProjectMarkdown,
  importProjectJson,
  layoutGraph,
  DEFAULT_CANVAS_LAYOUT,
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

describe("checked-in examples", () => {
  const examplesDir = new URL("../../../examples/", import.meta.url);
  const exampleFiles = readdirSync(examplesDir).filter((filename) => filename.endsWith(".json")).sort();

  it.each(exampleFiles)("imports, validates and calculates %s", (filename) => {
    const raw = readFileSync(new URL(filename, examplesDir), "utf8");
    const project = importProjectJson(raw);
    const validation = validateGraph(project.graph, project.rootNodeId);
    const calculation = calculateGraph(project);

    expect(validation.errors).toHaveLength(0);
    expect(calculation.errors).toHaveLength(0);
    expect(calculation.rootValue).toEqual(expect.any(Number));
    expect(Number.isFinite(calculation.rootValue)).toBe(true);
  });

  it("keeps the OEE demo on a 0-100 percentage scale", () => {
    const project = importProjectJson(readFileSync(new URL("oee.json", examplesDir), "utf8"));
    const calculation = calculateGraph(project);

    expect(calculation.errors).toHaveLength(0);
    expect(calculation.values.availability).toBeCloseTo(83.333333, 5);
    expect(calculation.values.performance).toBeCloseTo(81.818181, 5);
    expect(calculation.values.quality).toBeCloseTo(95, 5);
    expect(calculation.rootValue).toBeCloseTo(64.772727, 5);
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

  it("warns on obvious unit mismatches", () => {
    const graph = {
      ...productionVolumeProject.graph,
      nodes: productionVolumeProject.graph.nodes.map((node) =>
        node.id === "effective_working_time" ? { ...node, formula: "calendar_time + nominal_rate" } : node
      )
    };

    const result = validateGraph(graph, productionVolumeProject.rootNodeId);

    expect(result.warnings.some((warning) => warning.type === "unit_mismatch")).toBe(true);
  });

  it("treats rejected nodes as invalid active model dependencies", () => {
    const graph = {
      ...productionVolumeProject.graph,
      nodes: productionVolumeProject.graph.nodes.map((node) =>
        node.id === "average_productivity" ? { ...node, status: "rejected" as const } : node
      )
    };

    const validation = validateGraph(graph, productionVolumeProject.rootNodeId);
    const calculation = calculateGraph({ ...productionVolumeProject, graph });

    expect(validation.errors.some((error) => error.message.includes("rejected node"))).toBe(true);
    expect(calculation.errors.some((error) => error.message.includes("Rejected node"))).toBe(true);
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

  it("rejects non-finite baseline values and scenario overrides", () => {
    const invalidBaseline: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "calendar_time" ? { ...node, baselineValue: Infinity } : node
        )
      }
    };

    const baselineResult = calculateGraph(invalidBaseline);
    const scenarioResult = calculateScenario(productionVolumeProject, {
      ...productionVolumeProject.scenarios[0]!,
      overrides: [{ nodeId: "unplanned_downtime", value: Infinity }]
    });

    expect(baselineResult.errors.some((error) => error.type === "invalid_value")).toBe(true);
    expect(scenarioResult.errors?.some((error) => error.type === "invalid_value")).toBe(true);
  });
});

describe("exports", () => {
  it("exports and imports project JSON", () => {
    const json = exportProjectJson(productionVolumeProject);
    const imported = importProjectJson(json);

    expect(imported.rootNodeId).toBe("production_volume");
    expect(imported.graph.nodes).toHaveLength(productionVolumeProject.graph.nodes.length);
    expect(imported.graph.edges).toHaveLength(productionVolumeProject.graph.edges.length);
  });

  it("round-trips node positions through JSON import", () => {
    const positioned = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node, index) =>
          index === 0 ? { ...node, position: { x: 420, y: 180 } } : node
        )
      }
    };
    const imported = importProjectJson(exportProjectJson(positioned));

    expect(imported.graph.nodes[0]?.position).toEqual({ x: 420, y: 180 });
  });

  it("ignores malformed node positions on import", () => {
    const base = JSON.parse(exportProjectJson(productionVolumeProject)) as Record<string, unknown>;
    const graph = base.graph as Record<string, unknown>;
    const nodes = graph.nodes as Record<string, unknown>[];

    nodes[0] = { ...nodes[0], position: "invalid" };
    expect(importProjectJson(JSON.stringify(base)).graph.nodes[0]?.position).toBeUndefined();

    nodes[0] = { ...nodes[0], position: { x: "bad", y: 1 } };
    expect(importProjectJson(JSON.stringify(base)).graph.nodes[0]?.position).toBeUndefined();

    nodes[0] = { ...nodes[0], position: { x: 1, y: Number.NaN } };
    expect(importProjectJson(JSON.stringify(base)).graph.nodes[0]?.position).toBeUndefined();
  });

  it("rejects malformed imported projects before they enter the graph", () => {
    expect(() => importProjectJson("{")).toThrow("Project JSON could not be parsed.");
    expect(() =>
      importProjectJson(
        JSON.stringify({
          ...productionVolumeProject,
          graph: {
            ...productionVolumeProject.graph,
            edges: [
              ...productionVolumeProject.graph.edges,
              {
                id: "bad",
                sourceNodeId: "production_volume",
                targetNodeId: "missing",
                relation: "positive_driver",
                aiGenerated: false
              }
            ]
          }
        })
      )
    ).toThrow("missing target");
    expect(() =>
      importProjectJson(
        JSON.stringify({
          ...productionVolumeProject,
          scenarios: [{ ...productionVolumeProject.scenarios[0], overrides: "not-array" }]
        })
      )
    ).toThrow("scenario overrides");
  });

  it("exports Markdown summary and deterministic SVG canvas", () => {
    const markdown = exportProjectMarkdown(productionVolumeProject);
    const svg = exportProjectSvg(productionVolumeProject);

    expect(markdown).toContain("# Production Volume Driver Model");
    expect(markdown).toContain("Production Volume");
    expect(markdown).toContain("Calculation Trace");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Production Volume Driver Model");
    expect(svg).toContain("effective_working_time");
  });

  it("exports SVG using saved node positions when present", () => {
    const positioned = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node, index) =>
          index === 0 ? { ...node, position: { x: 512, y: 224 } } : node
        )
      }
    };

    const svg = exportProjectSvg(positioned);

    expect(svg).toContain("translate(512, 224)");
  });
});

describe("graph layout", () => {
  function assertNoOverlappingBoxes(
    positions: Map<string, { x: number; y: number }>,
    cardWidth: number,
    cardHeight: number
  ) {
    const entries = Array.from(positions.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [, a] = entries[i]!;
        const [, b] = entries[j]!;
        const separated =
          a.x + cardWidth <= b.x ||
          b.x + cardWidth <= a.x ||
          a.y + cardHeight <= b.y ||
          b.y + cardHeight <= a.y;
        expect(separated).toBe(true);
      }
    }
  }

  function ysFor(
    positions: Map<string, { x: number; y: number }>,
    nodeIds: string[]
  ): number[] {
    return nodeIds.map((id) => {
      const position = positions.get(id);
      expect(position).toBeDefined();
      expect(Number.isFinite(position!.y)).toBe(true);
      return position!.y;
    });
  }

  function assertSiblingClustersDoNotInterleave(clusterA: number[], clusterB: number[]): void {
    const maxA = Math.max(...clusterA);
    const minA = Math.min(...clusterA);
    const maxB = Math.max(...clusterB);
    const minB = Math.min(...clusterB);
    const aAboveB = maxA <= minB;
    const bAboveA = maxB <= minA;
    expect(aAboveB || bAboveA).toBe(true);
  }

  function assertNotBetweenY(
    positions: Map<string, { x: number; y: number }>,
    nodeId: string,
    lowerId: string,
    upperId: string
  ): void {
    const y = positions.get(nodeId)!.y;
    const lowerY = positions.get(lowerId)!.y;
    const upperY = positions.get(upperId)!.y;
    const minY = Math.min(lowerY, upperY);
    const maxY = Math.max(lowerY, upperY);
    expect(y <= minY || y >= maxY).toBe(true);
  }

  function buildWideSubtreeGraph() {
    const now = "2026-01-01T00:00:00.000Z";
    const node = (
      id: string,
      name: string,
      type: "root_kpi" | "calculated" | "input" = "input"
    ) => ({
      id,
      name,
      type,
      status: "accepted" as const,
      aiGenerated: false,
      createdAt: now,
      updatedAt: now
    });
    const edge = (id: string, sourceNodeId: string, targetNodeId: string) => ({
      id,
      sourceNodeId,
      targetNodeId,
      relation: "positive_driver" as const,
      aiGenerated: false
    });

    return {
      nodes: [
        node("wide_root", "Root", "root_kpi"),
        node("wide_a", "Branch A", "calculated"),
        node("wide_b", "Branch B", "calculated"),
        node("wide_c", "Branch C", "calculated"),
        // Names sort globally as B1, C2, D3, X7, Y8, Z9 — flat depth sort interleaves branches.
        node("wide_a1", "Sort B1"),
        node("wide_a2", "Sort Z9"),
        node("wide_b1", "Sort C2"),
        node("wide_b2", "Sort Y8"),
        node("wide_c1", "Sort D3"),
        node("wide_c2", "Sort X7")
      ],
      edges: [
        edge("e_ra", "wide_root", "wide_a"),
        edge("e_rb", "wide_root", "wide_b"),
        edge("e_rc", "wide_root", "wide_c"),
        edge("e_a1", "wide_a", "wide_a1"),
        edge("e_a2", "wide_a", "wide_a2"),
        edge("e_b1", "wide_b", "wide_b1"),
        edge("e_b2", "wide_b", "wide_b2"),
        edge("e_c1", "wide_c", "wide_c1"),
        edge("e_c2", "wide_c", "wide_c2")
      ]
    };
  }

  it("assigns non-overlapping bounding boxes for every node", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );

    assertNoOverlappingBoxes(layout.positions, layout.cardWidth, layout.cardHeight);
  });

  it("places deeper nodes further to the right", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );
    const rootPosition = layout.positions.get(productionVolumeProject.rootNodeId);
    const effectiveWorkingTime = layout.positions.get("effective_working_time");
    const calendarTime = layout.positions.get("calendar_time");

    expect(rootPosition).toBeDefined();
    expect(effectiveWorkingTime).toBeDefined();
    expect(calendarTime).toBeDefined();
    expect(effectiveWorkingTime!.x).toBeGreaterThan(rootPosition!.x);
    expect(calendarTime!.x).toBeGreaterThan(effectiveWorkingTime!.x);
  });

  it("keeps sibling layout stable when node array order changes", () => {
    const { graph, rootNodeId } = productionVolumeProject;
    const baseline = layoutGraph(graph, rootNodeId, DEFAULT_CANVAS_LAYOUT);
    const reordered = layoutGraph(
      { ...graph, nodes: [...graph.nodes].reverse() },
      rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );

    for (const node of graph.nodes) {
      expect(reordered.positions.get(node.id)).toEqual(baseline.positions.get(node.id));
    }
  });

  it("orders siblings within each parent by name then id", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );
    const averageProductivity = layout.positions.get("average_productivity");
    const effectiveWorkingTime = layout.positions.get("effective_working_time");

    expect(averageProductivity).toBeDefined();
    expect(effectiveWorkingTime).toBeDefined();
    expect(averageProductivity!.y).toBeLessThan(effectiveWorkingTime!.y);

    const ewtChildren = ["calendar_time", "planned_downtime", "unplanned_downtime"];
    const ewtYs = ysFor(layout.positions, ewtChildren);
    expect(ewtYs[0]).toBeLessThan(ewtYs[1]!);
    expect(ewtYs[1]).toBeLessThan(ewtYs[2]!);

    const apChildren = ["nominal_rate", "utilization_factor", "yield_factor"];
    const apYs = ysFor(layout.positions, apChildren);
    expect(apYs[0]).toBeLessThan(apYs[1]!);
    expect(apYs[1]).toBeLessThan(apYs[2]!);
  });

  it("packs each parent's grandchildren as non-interleaving clusters", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );

    const ewtChildren = ["calendar_time", "planned_downtime", "unplanned_downtime"];
    const apChildren = ["nominal_rate", "utilization_factor", "yield_factor"];
    const ewtYs = ysFor(layout.positions, ewtChildren);
    const apYs = ysFor(layout.positions, apChildren);

    assertSiblingClustersDoNotInterleave(ewtYs, apYs);
    expect(Math.max(...apYs)).toBeLessThan(Math.min(...ewtYs));
  });

  it("does not interleave cousins from different parent branches", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );

    const ewtCousins = ["calendar_time", "planned_downtime", "unplanned_downtime"];
    const apCousins = ["nominal_rate", "utilization_factor", "yield_factor"];
    const ewtYs = ysFor(layout.positions, ewtCousins);
    const apYs = ysFor(layout.positions, apCousins);

    // Flat global depth sort orders all six by name (C, N, P, U, U, Y) and interleaves branches.
    assertSiblingClustersDoNotInterleave(ewtYs, apYs);
    assertNotBetweenY(layout.positions, "nominal_rate", "calendar_time", "planned_downtime");
    assertNotBetweenY(layout.positions, "utilization_factor", "planned_downtime", "unplanned_downtime");
  });

  it("preserves manual order among effective_working_time children from existingPositions", () => {
    const { graph, rootNodeId } = productionVolumeProject;
    const baseline = layoutGraph(graph, rootNodeId, DEFAULT_CANVAS_LAYOUT);
    const calendarTime = baseline.positions.get("calendar_time")!;
    const plannedDowntime = baseline.positions.get("planned_downtime")!;

    expect(plannedDowntime.y).toBeGreaterThan(calendarTime.y);

    const existingPositions = new Map([
      ["calendar_time", { x: calendarTime.x, y: plannedDowntime.y + 200 }],
      ["planned_downtime", { x: plannedDowntime.x, y: calendarTime.y }]
    ]);

    const layout = layoutGraph(graph, rootNodeId, {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    });

    expect(layout.positions.get("planned_downtime")!.y).toBeLessThan(
      layout.positions.get("calendar_time")!.y
    );
    expect(layout.positions.get("planned_downtime")!.x).toBe(plannedDowntime.x);
    expect(layout.positions.get("calendar_time")!.x).toBe(calendarTime.x);
  });

  it("assigns non-overlapping bounding boxes for a wide synthetic tree", () => {
    const graph = buildWideSubtreeGraph();
    const layout = layoutGraph(graph, "wide_root", DEFAULT_CANVAS_LAYOUT);

    assertNoOverlappingBoxes(layout.positions, layout.cardWidth, layout.cardHeight);

    const branchLeaves = [
      ["wide_a1", "wide_a2"],
      ["wide_b1", "wide_b2"],
      ["wide_c1", "wide_c2"]
    ];
    const leafClusters = branchLeaves.map((ids) => ysFor(layout.positions, ids));
    assertSiblingClustersDoNotInterleave(leafClusters[0]!, leafClusters[1]!);
    assertSiblingClustersDoNotInterleave(leafClusters[1]!, leafClusters[2]!);
    assertSiblingClustersDoNotInterleave(leafClusters[0]!, leafClusters[2]!);
  });

  it("respects manual sibling order from existingPositions y values", () => {
    const { graph, rootNodeId } = productionVolumeProject;
    const baseline = layoutGraph(graph, rootNodeId, DEFAULT_CANVAS_LAYOUT);
    const avg = baseline.positions.get("average_productivity")!;
    const eff = baseline.positions.get("effective_working_time")!;

    expect(avg.y).toBeLessThan(eff.y);

    const existingPositions = new Map([
      ["average_productivity", { x: avg.x, y: eff.y + 200 }],
      ["effective_working_time", { x: eff.x, y: avg.y }]
    ]);

    const layout = layoutGraph(graph, rootNodeId, {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    });
    const reorderedAvg = layout.positions.get("average_productivity")!;
    const reorderedEff = layout.positions.get("effective_working_time")!;

    expect(reorderedEff.y).toBeLessThan(reorderedAvg.y);
    expect(reorderedAvg.x).toBe(avg.x);
    expect(reorderedEff.x).toBe(eff.x);
  });

  it("keeps layout deterministic when existingPositions is provided", () => {
    const { graph, rootNodeId } = productionVolumeProject;
    const baseline = layoutGraph(graph, rootNodeId, DEFAULT_CANVAS_LAYOUT);
    const existingPositions = new Map(baseline.positions);

    const first = layoutGraph(graph, rootNodeId, { ...DEFAULT_CANVAS_LAYOUT, existingPositions });
    const second = layoutGraph(graph, rootNodeId, { ...DEFAULT_CANVAS_LAYOUT, existingPositions });

    for (const node of graph.nodes) {
      expect(second.positions.get(node.id)).toEqual(first.positions.get(node.id));
    }
  });

  it("appends unpositioned siblings after positioned siblings in name order", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const graph = {
      nodes: [
        {
          id: "root",
          name: "Root",
          type: "root_kpi" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_a",
          name: "Alpha",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_b",
          name: "Beta",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_c",
          name: "Charlie",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      edges: [
        {
          id: "e_a",
          sourceNodeId: "root",
          targetNodeId: "child_a",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_b",
          sourceNodeId: "root",
          targetNodeId: "child_b",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_c",
          sourceNodeId: "root",
          targetNodeId: "child_c",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const existingPositions = new Map([
      ["child_b", { x: 300, y: 50 }],
      ["child_a", { x: 300, y: 10 }]
    ]);

    const layout = layoutGraph(graph, "root", {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    });

    const childA = layout.positions.get("child_a")!;
    const childB = layout.positions.get("child_b")!;
    const childC = layout.positions.get("child_c")!;

    expect(childA.y).toBeLessThan(childB.y);
    expect(childB.y).toBeLessThan(childC.y);
  });

  it("tie-breaks positioned siblings with equal y by name then id", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const graph = {
      nodes: [
        {
          id: "root",
          name: "Root",
          type: "root_kpi" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_z",
          name: "Zulu",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_a",
          name: "Alpha",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      edges: [
        {
          id: "e_z",
          sourceNodeId: "root",
          targetNodeId: "child_z",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_a",
          sourceNodeId: "root",
          targetNodeId: "child_a",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const existingPositions = new Map([
      ["child_z", { x: 300, y: 42 }],
      ["child_a", { x: 300, y: 42 }]
    ]);

    const layout = layoutGraph(graph, "root", {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    });

    expect(layout.positions.get("child_a")!.y).toBeLessThan(layout.positions.get("child_z")!.y);
  });

  it("places a single positioned sibling before unpositioned siblings", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const graph = {
      nodes: [
        {
          id: "root",
          name: "Root",
          type: "root_kpi" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_a",
          name: "Alpha",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "child_b",
          name: "Beta",
          type: "input" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      edges: [
        {
          id: "e_a",
          sourceNodeId: "root",
          targetNodeId: "child_a",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_b",
          sourceNodeId: "root",
          targetNodeId: "child_b",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const existingPositions = new Map([["child_b", { x: 300, y: 80 }]]);

    const layout = layoutGraph(graph, "root", {
      ...DEFAULT_CANVAS_LAYOUT,
      existingPositions
    });

    expect(layout.positions.get("child_b")!.y).toBeLessThan(layout.positions.get("child_a")!.y);
  });

  it("returns positions for a simple cyclic graph without throwing", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const graph = {
      nodes: [
        {
          id: "cycle_a",
          name: "A",
          type: "root_kpi" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "cycle_b",
          name: "B",
          type: "calculated" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        },
        {
          id: "cycle_c",
          name: "C",
          type: "calculated" as const,
          status: "accepted" as const,
          aiGenerated: false,
          createdAt: now,
          updatedAt: now
        }
      ],
      edges: [
        {
          id: "e_ab",
          sourceNodeId: "cycle_a",
          targetNodeId: "cycle_b",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_bc",
          sourceNodeId: "cycle_b",
          targetNodeId: "cycle_c",
          relation: "positive_driver" as const,
          aiGenerated: false
        },
        {
          id: "e_ca",
          sourceNodeId: "cycle_c",
          targetNodeId: "cycle_a",
          relation: "positive_driver" as const,
          aiGenerated: false
        }
      ]
    };

    const layout = layoutGraph(graph, "cycle_a", DEFAULT_CANVAS_LAYOUT);

    expect(layout.positions.size).toBe(3);
    for (const node of graph.nodes) {
      expect(layout.positions.get(node.id)).toBeDefined();
    }

    const coords = graph.nodes.map((node) => layout.positions.get(node.id)!);
    const uniqueCoords = new Set(coords.map((pos) => `${pos.x},${pos.y}`));
    expect(uniqueCoords.size).toBe(coords.length);

    assertNoOverlappingBoxes(layout.positions, layout.cardWidth, layout.cardHeight);
  });
});
