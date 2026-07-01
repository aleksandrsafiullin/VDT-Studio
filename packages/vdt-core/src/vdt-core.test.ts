import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyChangeSet,
  calculateGraph,
  calculateIsolatedRootEffect,
  calculateOnePercentRootSensitivity,
  calculateScenario,
  calculateScenarioGraph,
  calculateScenarioMultiplicativeEffect,
  compareVdtProjects,
  createVersionSnapshot,
  diffChangeSet,
  evaluateAst,
  evaluateFormula,
  exportProjectSvg,
  exportProjectJson,
  exportProjectMarkdown,
  FormulaParseError,
  getFormulaReferenceOrder,
  importProjectJson,
  layoutGraph,
  listVersions,
  MAX_VERSION_SNAPSHOTS,
  DEFAULT_CANVAS_LAYOUT,
  parseFormula,
  previewChangeSet,
  productionVolumeProject,
  rankScenarioInputNodes,
  resolveFormulaEdgeRelation,
  restoreVersionSnapshot,
  serializeFormulaTokens,
  tokenizeFormula,
  validateGraph,
  VersionNotFoundError,
  type VdtChangeSet,
  type VdtProject
} from "./index";

describe("formula engine", () => {
  it("evaluates arithmetic, parentheses and percent literals", () => {
    expect(evaluateFormula("(a + b) * 90%", { a: 10, b: 20 }).value).toBe(27);
    expect(evaluateFormula("rate * working_time", { rate: 220, working_time: 600 }).value).toBe(132000);
  });

  it("reports missing values and division by zero", () => {
    const missing = evaluateFormula("a + b", { a: 1 });
    expect(missing.errors[0]?.type).toBe("missing_value");
    expect(missing.references).toEqual(["a", "b"]);
    expect(evaluateFormula("a / b", { a: 1, b: 0 }).errors[0]?.type).toBe("division_by_zero");
  });
});

describe("serializeFormulaTokens", () => {
  const assertParseEquivalent = (formula: string, bindings: Record<string, number>) => {
    const serialized = serializeFormulaTokens(tokenizeFormula(formula));
    const originalAst = parseFormula(formula);
    const serializedAst = parseFormula(serialized);
    const resolve = (reference: string) => bindings[reference];

    expect(evaluateAst(serializedAst, resolve)).toBe(evaluateAst(originalAst, resolve));
  };

  it("normalizes spacing for production-volume formulas", () => {
    const formulas = productionVolumeProject.graph.nodes
      .map((node) => node.formula)
      .filter((formula): formula is string => Boolean(formula?.trim()));

    for (const formula of formulas) {
      expect(serializeFormulaTokens(tokenizeFormula(formula))).toBe(formula);
    }
  });

  it("preserves number.raw including percent suffix", () => {
    expect(serializeFormulaTokens(tokenizeFormula("90%"))).toBe("90%");
    expect(serializeFormulaTokens(tokenizeFormula("(a + b) * 90%"))).toBe("(a + b) * 90%");
  });

  it("returns empty string for empty or whitespace-only token streams", () => {
    expect(serializeFormulaTokens([])).toBe("");
    expect(serializeFormulaTokens([{ type: "eof" }])).toBe("");
    expect(serializeFormulaTokens(tokenizeFormula(""))).toBe("");
    expect(serializeFormulaTokens(tokenizeFormula("   "))).toBe("");
    expect(() => parseFormula(serializeFormulaTokens(tokenizeFormula("")))).toThrow(FormulaParseError);
  });

  it("strips eof tokens when serializing", () => {
    const tokens = tokenizeFormula("a + b");
    expect(tokens.at(-1)?.type).toBe("eof");
    expect(serializeFormulaTokens(tokens)).toBe("a + b");
  });

  it("keeps parse semantics for unary minus, parentheses, and chained subtraction", () => {
    assertParseEquivalent("-a", { a: 5 });
    assertParseEquivalent("(a + b) * 90%", { a: 10, b: 20 });
    assertParseEquivalent("calendar_time - planned_downtime - unplanned_downtime", {
      calendar_time: 720,
      planned_downtime: 40,
      unplanned_downtime: 80
    });

    expect(serializeFormulaTokens(tokenizeFormula("-a"))).toBe("-a");
    expect(serializeFormulaTokens(tokenizeFormula("(a + b) * 90%"))).toBe("(a + b) * 90%");
    expect(serializeFormulaTokens(tokenizeFormula("calendar_time - planned_downtime - unplanned_downtime"))).toBe(
      "calendar_time - planned_downtime - unplanned_downtime"
    );
  });
});

describe("formula edge relations", () => {
  it("assigns formula_dependency to the first operand and maps later operators", () => {
    expect(
      resolveFormulaEdgeRelation(
        "throughput_rate * working_time * yield_factor",
        "throughput_rate",
        "multiplicative_driver"
      )
    ).toBe("formula_dependency");
    expect(
      resolveFormulaEdgeRelation(
        "throughput_rate * working_time * yield_factor",
        "working_time",
        "multiplicative_driver"
      )
    ).toBe("multiplicative_driver");
    expect(
      resolveFormulaEdgeRelation(
        "throughput_rate * working_time * yield_factor",
        "yield_factor",
        "multiplicative_driver"
      )
    ).toBe("multiplicative_driver");
  });

  it("maps chained subtraction to subtractive components after the base operand", () => {
    expect(
      resolveFormulaEdgeRelation(
        "calendar_time - planned_downtime - unplanned_downtime",
        "calendar_time",
        "subtractive_component"
      )
    ).toBe("formula_dependency");
    expect(
      resolveFormulaEdgeRelation(
        "calendar_time - planned_downtime - unplanned_downtime",
        "planned_downtime",
        "additive_component"
      )
    ).toBe("subtractive_component");
    expect(
      resolveFormulaEdgeRelation(
        "calendar_time - planned_downtime - unplanned_downtime",
        "unplanned_downtime",
        "subtractive_component"
      )
    ).toBe("subtractive_component");
  });

  it("maps two-factor multiplication with one visible operator", () => {
    expect(
      resolveFormulaEdgeRelation(
        "effective_working_time * average_productivity",
        "effective_working_time",
        "multiplicative_driver"
      )
    ).toBe("formula_dependency");
    expect(
      resolveFormulaEdgeRelation(
        "effective_working_time * average_productivity",
        "average_productivity",
        "multiplicative_driver"
      )
    ).toBe("multiplicative_driver");
  });

  it("maps division with formula_dependency numerator and divisive denominator", () => {
    expect(
      resolveFormulaEdgeRelation("operating_hours / cycle_time_h", "operating_hours", "divisive_driver")
    ).toBe("formula_dependency");
    expect(
      resolveFormulaEdgeRelation("operating_hours / cycle_time_h", "cycle_time_h", "multiplicative_driver")
    ).toBe("divisive_driver");
  });

  it("falls back when parent formula is missing or child is not referenced", () => {
    expect(resolveFormulaEdgeRelation(undefined, "child", "positive_driver")).toBe("positive_driver");
    expect(resolveFormulaEdgeRelation("a * b", "unknown", "contextual_influence")).toBe("contextual_influence");
  });

  it("returns formula operand ids in left-to-right order", () => {
    expect(getFormulaReferenceOrder("throughput_rate * working_time * yield_factor")).toEqual([
      "throughput_rate",
      "working_time",
      "yield_factor"
    ]);
    expect(getFormulaReferenceOrder("calendar_time - planned_downtime - unplanned_downtime")).toEqual([
      "calendar_time",
      "planned_downtime",
      "unplanned_downtime"
    ]);
    expect(getFormulaReferenceOrder("effective_working_time * average_productivity")).toEqual([
      "effective_working_time",
      "average_productivity"
    ]);
    expect(getFormulaReferenceOrder("operating_hours / cycle_time_h")).toEqual([
      "operating_hours",
      "cycle_time_h"
    ]);
  });
});

describe("production volume example", () => {
  it("calculates the expected baseline values", () => {
    const result = calculateGraph(productionVolumeProject);

    expect(result.errors).toHaveLength(0);
    expect(result.values.effective_working_time).toBe(600);
    expect(result.values.average_productivity).toBeCloseTo(211.2, 5);
    expect(result.values.production_volume).toBeCloseTo(126720, 5);
    expect(result.rootValue).toBeCloseTo(126720, 5);
    expect(result.trace.find((item) => item.nodeId === "production_volume")?.resolvedFormula).toBe("600 * 211.2");
  });

  it("calculates scenario impact for reduced unplanned downtime", () => {
    const scenario = productionVolumeProject.scenarios[0];
    expect(scenario).toBeDefined();

    const result = calculateScenario(productionVolumeProject, scenario!);

    expect(result.baselineValue).toBeCloseTo(126720, 5);
    expect(result.scenarioValue).toBeCloseTo(130944, 5);
    expect(result.absoluteChange).toBeCloseTo(4224, 5);
    expect(result.percentageChange).toBeCloseTo(3.333333, 4);
    expect(result.impactedNodes.map((node) => node.nodeId)).toContain("unplanned_downtime");
  });

  it("calculateScenarioGraph matches calculateScenario root values", () => {
    const scenario = productionVolumeProject.scenarios[0]!;
    const graphResult = calculateScenarioGraph(productionVolumeProject, scenario);
    const scenarioResult = calculateScenario(productionVolumeProject, scenario);

    expect(graphResult.rootValue).toBe(scenarioResult.scenarioValue);
  });
});

describe("scenario sensitivity APIs", () => {
  it("calculates 1% root sensitivity for unplanned_downtime", () => {
    const delta = calculateOnePercentRootSensitivity(productionVolumeProject, "unplanned_downtime");

    expect(delta).toBeDefined();
    expect(Number.isFinite(delta)).toBe(true);
    expect(delta).not.toBe(0);
    // +1% unplanned downtime reduces effective working time and root output.
    expect(delta).toBeCloseTo(-168.96, 2);
  });

  it("calculates isolated root effect for a single override value", () => {
    const isolatedAt60 = calculateIsolatedRootEffect(productionVolumeProject, "unplanned_downtime", 60);
    const scenario = productionVolumeProject.scenarios[0];
    expect(scenario).toBeDefined();

    const scenarioResult = calculateScenario(productionVolumeProject, scenario!);

    expect(isolatedAt60).toBeDefined();
    expect(isolatedAt60).toBeCloseTo(4224, 2);
    expect(isolatedAt60).toBeCloseTo(scenarioResult.absoluteChange!, 5);
  });

  it("ranks scenario input nodes by absolute 1% root effect with zero baseline last and name tie-break", () => {
    const zeroBaselineInput = {
      id: "zero_baseline_input",
      name: "Zero Baseline Input",
      description: "Input with zero baseline for ranking edge case.",
      type: "input" as const,
      status: "ai_suggested" as const,
      unit: "hours/month",
      baselineValue: 0,
      aiGenerated: true,
      aiConfidence: 0.5,
      aiRationale: "Test fixture for zero-baseline ranking.",
      controllability: "low" as const,
      materiality: "low" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const projectWithZeroBaseline: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: [...productionVolumeProject.graph.nodes, zeroBaselineInput]
      }
    };

    const ranked = rankScenarioInputNodes(projectWithZeroBaseline);
    const rankedIds = ranked.map((entry) => entry.nodeId);

    expect(rankedIds.at(-1)).toBe("zero_baseline_input");
    expect(ranked.find((entry) => entry.nodeId === "zero_baseline_input")?.onePercentRootDelta).toBe(0);

    const unplannedIndex = rankedIds.indexOf("unplanned_downtime");
    const plannedIndex = rankedIds.indexOf("planned_downtime");
    expect(unplannedIndex).toBeGreaterThan(-1);
    expect(plannedIndex).toBeGreaterThan(-1);
    expect(unplannedIndex).toBeLessThan(plannedIndex);

    const yieldIndex = rankedIds.indexOf("yield_factor");
    expect(yieldIndex).toBeGreaterThan(-1);
    expect(Math.abs(ranked[yieldIndex]!.onePercentRootDelta ?? 0)).toBeGreaterThan(0);

    for (let index = 1; index < ranked.length - 1; index += 1) {
      const previous = ranked[index - 1]!;
      const current = ranked[index]!;
      const previousMagnitude = Math.abs(previous.onePercentRootDelta ?? 0);
      const currentMagnitude = Math.abs(current.onePercentRootDelta ?? 0);
      expect(previousMagnitude).toBeGreaterThanOrEqual(currentMagnitude);
    }
  });

  it("returns undefined sensitivity for unknown node ids without throwing", () => {
    expect(calculateOnePercentRootSensitivity(productionVolumeProject, "missing_node")).toBeUndefined();
    expect(calculateIsolatedRootEffect(productionVolumeProject, "missing_node", 42)).toBeUndefined();
  });

  it("calculates zero multiplicative effect for a single override", () => {
    const scenario = productionVolumeProject.scenarios[0];
    expect(scenario).toBeDefined();

    const multiplicative = calculateScenarioMultiplicativeEffect(productionVolumeProject, scenario!);

    expect(multiplicative.totalRootEffect).toBeCloseTo(4224, 2);
    expect(multiplicative.sumOfIsolatedEffects).toBeCloseTo(4224, 2);
    expect(multiplicative.multiplicativeEffect).toBeCloseTo(0, 5);
  });

  it("calculates non-zero multiplicative effect when multiple overrides combine", () => {
    const scenario = productionVolumeProject.scenarios[0];
    expect(scenario).toBeDefined();

    const multiOverrideScenario = {
      ...scenario!,
      overrides: [
        { nodeId: "unplanned_downtime", value: 60 },
        { nodeId: "yield_factor", value: 0.98 }
      ]
    };

    const combined = calculateScenario(productionVolumeProject, multiOverrideScenario);
    const multiplicative = calculateScenarioMultiplicativeEffect(productionVolumeProject, multiOverrideScenario);
    const isolatedUnplanned = calculateIsolatedRootEffect(productionVolumeProject, "unplanned_downtime", 60)!;
    const isolatedYield = calculateIsolatedRootEffect(productionVolumeProject, "yield_factor", 0.98)!;

    expect(combined.absoluteChange).toBeDefined();
    expect(multiplicative.sumOfIsolatedEffects).toBeCloseTo(isolatedUnplanned + isolatedYield, 2);
    expect(multiplicative.multiplicativeEffect).toBeCloseTo(
      combined.absoluteChange! - (isolatedUnplanned + isolatedYield),
      2
    );
    expect(Math.abs(multiplicative.multiplicativeEffect ?? 0)).toBeGreaterThan(0);
  });

  it("returns undefined multiplicative fields when scenario has no valid overrides", () => {
    const multiplicative = calculateScenarioMultiplicativeEffect(productionVolumeProject, {
      ...productionVolumeProject.scenarios[0]!,
      overrides: []
    });

    expect(multiplicative.sumOfIsolatedEffects).toBeUndefined();
    expect(multiplicative.multiplicativeEffect).toBeUndefined();
  });

  it("excludes fixedInScenario nodes from ranking and sensitivity helpers", () => {
    const projectWithLockedInput: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "unplanned_downtime" ? { ...node, fixedInScenario: true } : node
        )
      }
    };

    const ranked = rankScenarioInputNodes(projectWithLockedInput);
    expect(ranked.map((entry) => entry.nodeId)).not.toContain("unplanned_downtime");
    expect(calculateOnePercentRootSensitivity(projectWithLockedInput, "unplanned_downtime")).toBeUndefined();
    expect(calculateIsolatedRootEffect(projectWithLockedInput, "unplanned_downtime", 60)).toBeUndefined();
  });

  it("ignores overrides targeting fixedInScenario nodes in calculateScenario", () => {
    const projectWithLockedInput: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "unplanned_downtime" ? { ...node, fixedInScenario: true } : node
        )
      }
    };
    const baseline = calculateGraph(projectWithLockedInput);
    const scenarioWithLockedOverride = {
      ...productionVolumeProject.scenarios[0]!,
      overrides: [{ nodeId: "unplanned_downtime", value: 60 }]
    };

    const result = calculateScenario(projectWithLockedInput, scenarioWithLockedOverride);

    expect(result.scenarioValue).toBeCloseTo(baseline.rootValue!, 5);
    expect(result.absoluteChange).toBeCloseTo(0, 5);
    expect(result.errors?.some((error) => error.nodeId === "unplanned_downtime")).toBe(false);
  });

  it("still errors on unknown override nodes when fixedInScenario nodes are present", () => {
    const projectWithLockedInput: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "unplanned_downtime" ? { ...node, fixedInScenario: true } : node
        )
      }
    };

    const result = calculateScenario(projectWithLockedInput, {
      ...productionVolumeProject.scenarios[0]!,
      overrides: [{ nodeId: "typo_node", value: 123 }]
    });

    expect(result.errors?.some((error) => error.message.includes("typo_node"))).toBe(true);
  });

  it("counts only non-locked overrides in calculateScenarioMultiplicativeEffect", () => {
    const projectWithLockedInput: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "unplanned_downtime" ? { ...node, fixedInScenario: true } : node
        )
      }
    };
    const scenario = {
      ...productionVolumeProject.scenarios[0]!,
      overrides: [
        { nodeId: "unplanned_downtime", value: 60 },
        { nodeId: "planned_downtime", value: 20 }
      ]
    };

    const multiplicative = calculateScenarioMultiplicativeEffect(projectWithLockedInput, scenario);
    const isolatedPlanned = calculateIsolatedRootEffect(projectWithLockedInput, "planned_downtime", 20)!;

    expect(multiplicative.sumOfIsolatedEffects).toBeCloseTo(isolatedPlanned, 2);
    expect(calculateIsolatedRootEffect(projectWithLockedInput, "unplanned_downtime", 60)).toBeUndefined();
  });
});

describe("VDT comparison APIs", () => {
  it("compares structure, formulas, values, root delta, and deterministic bottleneck candidates", () => {
    const right: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: [
          ...productionVolumeProject.graph.nodes.map((node) => {
            if (node.id === "production_volume") {
              return { ...node, formula: "effective_working_time * average_productivity * recovery_factor" };
            }
            if (node.id === "unplanned_downtime") {
              return { ...node, baselineValue: 120 };
            }
            return node;
          }),
          {
            id: "recovery_factor",
            name: "Recovery Factor",
            type: "input",
            status: "ai_suggested",
            unit: "%",
            baselineValue: 0.95,
            aiGenerated: true,
            materiality: "high",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        edges: [
          ...productionVolumeProject.graph.edges,
          {
            id: "edge_production_volume_recovery_factor",
            sourceNodeId: "production_volume",
            targetNodeId: "recovery_factor",
            relation: "multiplicative_driver",
            aiGenerated: true
          }
        ]
      }
    };

    const result = compareVdtProjects(productionVolumeProject, right);

    expect(result.rootDelta?.leftValue).toBe(126720);
    expect(result.rootDelta?.rightValue).toBe(112358.4);
    expect(result.rootDelta?.absoluteDelta).toBeCloseTo(-14361.6, 5);
    expect(result.rootDelta?.percentDelta).toBeCloseTo(-11.3333, 4);
    expect(result.structuralDiff).toEqual({
      addedDrivers: ["recovery_factor"],
      removedDrivers: [],
      changedFormulas: ["production_volume"],
      changedValues: expect.arrayContaining(["production_volume", "effective_working_time", "unplanned_downtime"])
    });
    expect(result.bottleneckCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "production_volume",
          evidence: "value_delta",
          severity: "high"
        }),
        expect.objectContaining({
          nodeId: "production_volume",
          evidence: "formula_change",
          severity: "high"
        }),
        expect.objectContaining({
          nodeId: "recovery_factor",
          evidence: "missing_driver",
          severity: "high"
        }),
        expect.objectContaining({
          nodeId: "unplanned_downtime",
          evidence: "sensitivity"
        })
      ])
    );
  });

  it("detects removed drivers and omits root delta when neither graph calculates", () => {
    const left: VdtProject = {
      ...productionVolumeProject,
      graph: {
        ...productionVolumeProject.graph,
        nodes: productionVolumeProject.graph.nodes.map((node) =>
          node.id === "calendar_time" ? { ...node, baselineValue: undefined } : node
        )
      }
    };
    const right: VdtProject = {
      ...left,
      graph: {
        nodes: left.graph.nodes.filter((node) => node.id !== "yield_factor"),
        edges: left.graph.edges.filter((edge) => edge.targetNodeId !== "yield_factor")
      }
    };

    const result = compareVdtProjects(left, right, { maxBottleneckCandidates: 4 });

    expect(result.rootDelta).toBeUndefined();
    expect(result.structuralDiff.removedDrivers).toEqual(["yield_factor"]);
    expect(result.bottleneckCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: "yield_factor",
        evidence: "missing_driver"
      })
    ]));
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
    expect(imported.scenarios[0]?.isMain).toBe(true);
  });

  it("round-trips scenario isMain through JSON import", () => {
    const project = {
      ...productionVolumeProject,
      scenarios: [
        { ...productionVolumeProject.scenarios[0]!, isMain: true },
        {
          id: "scenario_alt",
          name: "Alternate",
          isMain: false,
          overrides: [],
          createdAt: productionVolumeProject.createdAt,
          updatedAt: productionVolumeProject.updatedAt
        }
      ]
    };

    const imported = importProjectJson(exportProjectJson(project));
    expect(imported.scenarios.find((scenario) => scenario.id === "scenario_reduce_unplanned_downtime")?.isMain).toBe(
      true
    );
    expect(imported.scenarios.find((scenario) => scenario.id === "scenario_alt")?.isMain).toBe(false);
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

    const apChildren = ["nominal_rate", "yield_factor"];
    const apYs = ysFor(layout.positions, apChildren);
    expect(apYs[0]).toBeLessThan(apYs[1]!);
  });

  it("packs each parent's grandchildren as non-interleaving clusters", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      DEFAULT_CANVAS_LAYOUT
    );

    const ewtChildren = ["calendar_time", "planned_downtime", "unplanned_downtime"];
    const apChildren = ["nominal_rate", "yield_factor"];
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
    const apCousins = ["nominal_rate", "yield_factor"];
    const ewtYs = ysFor(layout.positions, ewtCousins);
    const apYs = ysFor(layout.positions, apCousins);

    // Flat global depth sort orders all six by name (C, N, P, U, U, Y) and interleaves branches.
    assertSiblingClustersDoNotInterleave(ewtYs, apYs);
    assertNotBetweenY(layout.positions, "nominal_rate", "calendar_time", "planned_downtime");
    assertNotBetweenY(layout.positions, "yield_factor", "planned_downtime", "unplanned_downtime");
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

  it("keeps same-named leaf KPIs grouped under their own parent branch", () => {
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
    const graph = {
      nodes: [
        node("root", "Root", "root_kpi"),
        node("senior_a", "Senior KPI A", "calculated"),
        node("senior_b", "Senior KPI B", "calculated"),
        node("a_distance", "Average haul distance"),
        node("a_speed", "Average speed"),
        node("b_distance", "Average haul distance"),
        node("b_speed", "Average speed")
      ],
      edges: [
        edge("e_root_a", "root", "senior_a"),
        edge("e_root_b", "root", "senior_b"),
        edge("e_a_distance", "senior_a", "a_distance"),
        edge("e_a_speed", "senior_a", "a_speed"),
        edge("e_b_distance", "senior_b", "b_distance"),
        edge("e_b_speed", "senior_b", "b_speed")
      ]
    };

    const layout = layoutGraph(graph, "root", DEFAULT_CANVAS_LAYOUT);

    assertSiblingClustersDoNotInterleave(
      ysFor(layout.positions, ["a_distance", "a_speed"]),
      ysFor(layout.positions, ["b_distance", "b_speed"])
    );
  });

  it("applies custom horizontal and vertical KPI spacing", () => {
    const layout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      {
        ...DEFAULT_CANVAS_LAYOUT,
        horizontalGap: 320,
        verticalGap: 96
      }
    );

    expect(
      layout.positions.get("effective_working_time")!.x -
        layout.positions.get(productionVolumeProject.rootNodeId)!.x
    ).toBe(DEFAULT_CANVAS_LAYOUT.cardWidth + 320);
    expect(
      layout.positions.get("planned_downtime")!.y -
        layout.positions.get("calendar_time")!.y
    ).toBe(DEFAULT_CANVAS_LAYOUT.cardHeight + 96);
    assertNoOverlappingBoxes(layout.positions, layout.cardWidth, layout.cardHeight);
  });

  it("supports partial spacing options and legacy xGap/yGap aliases", () => {
    const partialLayout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      {
        horizontalGap: 320,
        verticalGap: 96
      }
    );
    const aliasLayout = layoutGraph(
      productionVolumeProject.graph,
      productionVolumeProject.rootNodeId,
      {
        xGap: 320,
        yGap: 96
      }
    );

    expect(partialLayout.cardWidth).toBe(DEFAULT_CANVAS_LAYOUT.cardWidth);
    expect(partialLayout.cardHeight).toBe(DEFAULT_CANVAS_LAYOUT.cardHeight);
    expect(partialLayout.positions.get("effective_working_time")).toEqual(
      aliasLayout.positions.get("effective_working_time")
    );
    expect(
      partialLayout.positions.get("effective_working_time")!.x -
        partialLayout.positions.get(productionVolumeProject.rootNodeId)!.x
    ).toBe(DEFAULT_CANVAS_LAYOUT.cardWidth + 320);
    expect(
      partialLayout.positions.get("planned_downtime")!.y -
        partialLayout.positions.get("calendar_time")!.y
    ).toBe(DEFAULT_CANVAS_LAYOUT.cardHeight + 96);
    assertNoOverlappingBoxes(partialLayout.positions, partialLayout.cardWidth, partialLayout.cardHeight);
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

describe("change set apply, preview, and diff", () => {
  const timestamp = "2026-06-22T00:00:00.000Z";

  function minimalProject(): VdtProject {
    return {
      id: "project_changeset_smoke",
      name: "Change Set Smoke",
      rootNodeId: "root",
      graph: {
        nodes: [
          {
            id: "root",
            name: "Root KPI",
            type: "root_kpi",
            status: "accepted",
            unit: "units",
            formula: "driver_a",
            aiGenerated: false,
            position: { x: 400, y: 100 },
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: "driver_a",
            name: "Driver A",
            type: "input",
            status: "accepted",
            unit: "units",
            baselineValue: 10,
            aiGenerated: false,
            position: { x: 100, y: 100 },
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        edges: [
          {
            id: "edge_root_driver_a",
            sourceNodeId: "root",
            targetNodeId: "driver_a",
            relation: "positive_driver",
            aiGenerated: false
          }
        ]
      },
      scenarios: [],
      dataSources: [],
      aiSettings: { defaultProviderId: "mock" },
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function baseChangeSet(overrides?: Partial<VdtChangeSet>): VdtChangeSet {
    return {
      id: "changeset_smoke",
      taskType: "deepen_node",
      backendId: "mock",
      createdAt: timestamp,
      additions: [],
      updates: [],
      deletions: [],
      edgeChanges: [],
      assumptions: [],
      questions: [],
      warnings: [],
      ...overrides
    };
  }

  it("previews node addition with parent edge and diff ids", () => {
    const project = minimalProject();
    const changeSet = baseChangeSet({
      additions: [
        {
          id: "add_driver_b",
          nodeId: "driver_b",
          parentNodeId: "root",
          relation: "positive_driver",
          name: "Driver B",
          unit: "units",
          baselineValue: 5
        }
      ]
    });

    const diff = diffChangeSet(project, changeSet);
    expect(diff).toEqual({
      addedNodeIds: ["driver_b"],
      updatedNodeIds: [],
      removedNodeIds: [],
      addedEdgeIds: ["edge_root_driver_b"],
      updatedEdgeIds: [],
      removedEdgeIds: []
    });

    const originalNodeCount = project.graph.nodes.length;
    const preview = previewChangeSet(project, changeSet);

    expect(project.graph.nodes).toHaveLength(originalNodeCount);
    expect(preview.graph.nodes.map((node) => node.id)).toContain("driver_b");
    expect(preview.graph.edges.some((edge) => edge.id === "edge_root_driver_b")).toBe(true);
    expect(preview.graph.nodes.find((node) => node.id === "driver_b")).toMatchObject({
      status: "ai_suggested",
      aiGenerated: true
    });
    expect(preview.graph.nodes.find((node) => node.id === "root")?.position).toEqual({ x: 400, y: 100 });

    const validation = validateGraph(preview.graph, preview.rootNodeId);
    expect(validation.valid).toBe(true);
  });

  it("applies only selected change entries", () => {
    const project = minimalProject();
    const changeSet = baseChangeSet({
      additions: [
        {
          id: "add_driver_b",
          nodeId: "driver_b",
          parentNodeId: "root",
          relation: "positive_driver",
          name: "Driver B",
          baselineValue: 5
        },
        {
          id: "add_driver_c",
          nodeId: "driver_c",
          parentNodeId: "root",
          relation: "positive_driver",
          name: "Driver C",
          baselineValue: 7
        }
      ]
    });

    const result = applyChangeSet(project, changeSet, new Set(["add_driver_b"]));

    expect(result.success).toBe(true);
    expect(result.project.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["root", "driver_a", "driver_b"])
    );
    expect(result.project.graph.nodes.map((node) => node.id)).not.toContain("driver_c");
    expect(result.project.graph.edges.some((edge) => edge.id === "edge_root_driver_b")).toBe(true);
    expect(result.project.graph.edges.some((edge) => edge.id === "edge_root_driver_c")).toBe(false);
    expect(validateGraph(result.project.graph, result.project.rootNodeId).valid).toBe(true);
  });

  it("rejects invalid formula updates with warnings", () => {
    const project = minimalProject();
    const changeSet = baseChangeSet({
      updates: [
        {
          id: "update_root_formula",
          nodeId: "root",
          patch: { formula: "driver_a +" }
        }
      ]
    });

    const result = applyChangeSet(project, changeSet, new Set(["update_root_formula"]));

    expect(result.success).toBe(false);
    expect(result.project).toEqual(project);
    expect(result.warnings.some((entry) => entry.type === "formula_parse_error")).toBe(true);
  });

  describe("comprehensive edge cases", () => {
    it("applies a single node addition with parent edge", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_driver_b",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            unit: "units",
            baselineValue: 5
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["add_driver_b"]));

      expect(result.success).toBe(true);
      expect(result.project.graph.nodes).toHaveLength(3);
      expect(result.project.graph.nodes.find((node) => node.id === "driver_b")).toMatchObject({
        name: "Driver B",
        status: "ai_suggested",
        aiGenerated: true,
        baselineValue: 5
      });
      expect(result.project.graph.edges.some((edge) => edge.id === "edge_root_driver_b")).toBe(true);
      expect(result.project.updatedAt).not.toBe(project.updatedAt);
      expect(project.graph.nodes).toHaveLength(2);
    });

    it("keys selection by change entry id, not node id alone", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        updates: [
          {
            id: "rename_root",
            nodeId: "root",
            patch: { name: "Renamed Root" }
          },
          {
            id: "rename_driver",
            nodeId: "driver_a",
            patch: { name: "Renamed Driver" }
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["rename_driver"]));

      expect(result.success).toBe(true);
      expect(result.project.graph.nodes.find((node) => node.id === "root")?.name).toBe("Root KPI");
      expect(result.project.graph.nodes.find((node) => node.id === "driver_a")?.name).toBe(
        "Renamed Driver"
      );
    });

    it("skips unselected change ids during partial apply", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_driver_b",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            baselineValue: 5
          }
        ],
        updates: [
          {
            id: "update_root_formula",
            nodeId: "root",
            patch: { formula: "driver_a + driver_b" }
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["add_driver_b"]));

      expect(result.success).toBe(true);
      expect(result.project.graph.nodes.map((node) => node.id)).toContain("driver_b");
      expect(result.project.graph.nodes.find((node) => node.id === "root")?.formula).toBe("driver_a");
    });

    it("preview with partial selection leaves unselected changes out", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_driver_b",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            baselineValue: 5
          },
          {
            id: "add_driver_c",
            nodeId: "driver_c",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver C",
            baselineValue: 7
          }
        ]
      });

      const preview = previewChangeSet(project, changeSet, new Set(["add_driver_c"]));

      expect(project.graph.nodes).toHaveLength(2);
      expect(preview.graph.nodes.map((node) => node.id)).toContain("driver_c");
      expect(preview.graph.nodes.map((node) => node.id)).not.toContain("driver_b");
    });

    it("rejects duplicate change entry ids", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "dup_entry",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            baselineValue: 5
          },
          {
            id: "dup_entry",
            nodeId: "driver_c",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver C",
            baselineValue: 7
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["dup_entry"]));

      expect(result.success).toBe(false);
      expect(result.project).toEqual(project);
      expect(result.warnings.some((entry) => entry.message.includes("Duplicate change entry id"))).toBe(
        true
      );
    });

    it("rejects duplicate proposed node ids within selected additions", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_driver_b_a",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            baselineValue: 5
          },
          {
            id: "add_driver_b_b",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B duplicate",
            baselineValue: 9
          }
        ]
      });

      const result = applyChangeSet(
        project,
        changeSet,
        new Set(["add_driver_b_a", "add_driver_b_b"])
      );

      expect(result.success).toBe(false);
      expect(result.project).toEqual(project);
      expect(
        result.warnings.some((entry) => entry.message.includes("Duplicate proposed node id"))
      ).toBe(true);
    });

    it("rejects additions that target an existing node id", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_existing",
            nodeId: "driver_a",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Duplicate Driver A",
            baselineValue: 99
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["add_existing"]));

      expect(result.success).toBe(false);
      expect(result.project).toEqual(project);
      expect(
        result.warnings.some((entry) => entry.message.includes("Addition targets existing node id"))
      ).toBe(true);
    });

    it("handles deletion of a missing node as a no-op", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        deletions: [
          {
            id: "delete_missing",
            nodeId: "driver_missing",
            cascadeEdges: true
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["delete_missing"]));

      expect(result.success).toBe(true);
      expect(result.project.graph.nodes.map((node) => node.id)).toEqual(["root", "driver_a"]);
      expect(result.project.graph.edges).toHaveLength(1);
    });

    it("applies node deletion with cascadeEdges", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        deletions: [
          {
            id: "delete_driver_a",
            nodeId: "driver_a",
            cascadeEdges: true
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["delete_driver_a"]));

      expect(result.success).toBe(false);
      expect(result.project).toEqual(project);
      expect(result.warnings.some((entry) => entry.severity === "error")).toBe(true);
    });

    it("diff identifies updates, deletions, and edge changes for existing graph ids", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        additions: [
          {
            id: "add_driver_b",
            nodeId: "driver_b",
            parentNodeId: "root",
            relation: "positive_driver",
            name: "Driver B",
            baselineValue: 5
          }
        ],
        updates: [{ id: "update_root", nodeId: "root", patch: { name: "Updated Root" } }],
        deletions: [
          { id: "delete_driver_a", nodeId: "driver_a" },
          { id: "delete_missing", nodeId: "driver_missing" }
        ],
        edgeChanges: [
          {
            id: "edge_add",
            action: "add",
            edge: {
              id: "edge_manual",
              sourceNodeId: "root",
              targetNodeId: "driver_b",
              relation: "positive_driver"
            }
          },
          {
            id: "edge_update",
            action: "update",
            edgeId: "edge_root_driver_a",
            patch: { relation: "negative_driver" }
          },
          {
            id: "edge_remove",
            action: "remove",
            edgeId: "edge_root_driver_a"
          },
          {
            id: "edge_remove_missing",
            action: "remove",
            edgeId: "edge_missing"
          }
        ]
      });

      expect(diffChangeSet(project, changeSet)).toEqual({
        addedNodeIds: ["driver_b"],
        updatedNodeIds: ["root"],
        removedNodeIds: ["driver_a"],
        addedEdgeIds: ["edge_manual", "edge_root_driver_b"],
        updatedEdgeIds: ["edge_root_driver_a"],
        removedEdgeIds: ["edge_root_driver_a"]
      });
    });

    it("applies edge add, update, and remove changes", () => {
      const project = minimalProject();
      const withExtraNode: VdtProject = {
        ...project,
        graph: {
          nodes: [
            ...project.graph.nodes,
            {
              id: "driver_b",
              name: "Driver B",
              type: "input",
              status: "accepted",
              unit: "units",
              baselineValue: 5,
              aiGenerated: false,
              position: { x: 100, y: 220 },
              createdAt: timestamp,
              updatedAt: timestamp
            }
          ],
          edges: [
            ...project.graph.edges,
            {
              id: "edge_root_driver_b",
              sourceNodeId: "root",
              targetNodeId: "driver_b",
              relation: "positive_driver",
              aiGenerated: false
            }
          ]
        }
      };

      const changeSet = baseChangeSet({
        edgeChanges: [
          {
            id: "edge_update",
            action: "update",
            edgeId: "edge_root_driver_b",
            patch: { relation: "negative_driver", label: "inhibitor" }
          },
          {
            id: "edge_remove",
            action: "remove",
            edgeId: "edge_root_driver_a"
          }
        ]
      });

      const result = applyChangeSet(
        withExtraNode,
        changeSet,
        new Set(["edge_update", "edge_remove"])
      );

      expect(result.success).toBe(true);
      expect(result.project.graph.edges.find((edge) => edge.id === "edge_root_driver_b")).toMatchObject({
        relation: "negative_driver",
        label: "inhibitor"
      });
      expect(result.project.graph.edges.some((edge) => edge.id === "edge_root_driver_a")).toBe(false);
    });

    it("does not modify node positions when applying field updates", () => {
      const project = minimalProject();
      const changeSet = baseChangeSet({
        updates: [
          {
            id: "update_driver_name",
            nodeId: "driver_a",
            patch: { name: "Driver A renamed", baselineValue: 42 }
          }
        ]
      });

      const result = applyChangeSet(project, changeSet, new Set(["update_driver_name"]));

      expect(result.success).toBe(true);
      expect(result.project.graph.nodes.find((node) => node.id === "driver_a")?.position).toEqual({
        x: 100,
        y: 100
      });
    });

    it("preview clones source project without mutating it", () => {
      const project = minimalProject();
      const originalNodes = project.graph.nodes;
      const originalEdges = project.graph.edges;
      const changeSet = baseChangeSet({
        updates: [{ id: "rename_root", nodeId: "root", patch: { name: "Preview Only" } }]
      });

      const preview = previewChangeSet(project, changeSet);

      expect(preview.graph.nodes.find((node) => node.id === "root")?.name).toBe("Preview Only");
      expect(project.graph.nodes.find((node) => node.id === "root")?.name).toBe("Root KPI");
      expect(project.graph.nodes).toBe(originalNodes);
      expect(project.graph.edges).toBe(originalEdges);
    });
  });
});

describe("version snapshot utilities", () => {
  const timestamp = "2026-06-22T00:00:00.000Z";

  function minimalProject(): VdtProject {
    return {
      id: "project_version_smoke",
      name: "Version Smoke",
      rootNodeId: "root",
      graph: {
        nodes: [
          {
            id: "root",
            name: "Root KPI",
            type: "root_kpi",
            status: "accepted",
            unit: "units",
            formula: "driver_a",
            aiGenerated: false,
            position: { x: 400, y: 100 },
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: "driver_a",
            name: "Driver A",
            type: "input",
            status: "accepted",
            unit: "units",
            baselineValue: 10,
            aiGenerated: false,
            position: { x: 100, y: 100 },
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        edges: [
          {
            id: "edge_root_driver_a",
            sourceNodeId: "root",
            targetNodeId: "driver_a",
            relation: "positive_driver",
            aiGenerated: false
          }
        ]
      },
      scenarios: [],
      dataSources: [],
      aiSettings: { defaultProviderId: "mock" },
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  it("create → mutate → restore round-trips graph state", () => {
    const original = minimalProject();
    const snapshotted = createVersionSnapshot(original, {
      name: "Before deepen",
      description: "Pre-apply checkpoint",
      taskType: "deepen_node"
    });

    expect(snapshotted.versions).toHaveLength(1);
    expect(snapshotted.versions[0]).toMatchObject({
      name: "Before deepen",
      description: "Pre-apply checkpoint",
      taskType: "deepen_node"
    });
    expect(snapshotted.versions[0]?.projectSnapshot.graph.nodes).toHaveLength(2);
    expect(snapshotted.versions[0]?.projectSnapshot.versions).toEqual([]);
    expect(snapshotted.versions[0]?.projectSnapshot).not.toBe(original);
    expect(snapshotted.versions[0]?.projectSnapshot.graph).not.toBe(original.graph);

    const mutated = {
      ...snapshotted,
      graph: {
        ...snapshotted.graph,
        nodes: [
          ...snapshotted.graph.nodes,
          {
            id: "driver_b",
            name: "Driver B",
            type: "input" as const,
            status: "accepted" as const,
            unit: "units",
            baselineValue: 5,
            aiGenerated: false,
            position: { x: 100, y: 220 },
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        edges: [
          ...snapshotted.graph.edges,
          {
            id: "edge_root_driver_b",
            sourceNodeId: "root",
            targetNodeId: "driver_b",
            relation: "positive_driver" as const,
            aiGenerated: false
          }
        ]
      },
      updatedAt: "2026-06-22T01:00:00.000Z"
    };

    expect(mutated.graph.nodes).toHaveLength(3);

    const restored = restoreVersionSnapshot(mutated, snapshotted.versions[0]!.id);

    expect(restored.graph.nodes.map((node) => node.id)).toEqual(["root", "driver_a"]);
    expect(restored.graph.edges).toHaveLength(1);
    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.aiSettings).toEqual(original.aiSettings);
    expect(restored.versions).toHaveLength(1);
    expect(restored.versions[0]?.id).toBe(snapshotted.versions[0]?.id);
    expect(restored.updatedAt).not.toBe(mutated.updatedAt);
  });

  it("lists versions newest-first", () => {
    const project = createVersionSnapshot(minimalProject(), { name: "First" });
    const withSecond = createVersionSnapshot(
      { ...project, updatedAt: "2026-06-22T01:00:00.000Z" },
      { name: "Second" }
    );

    expect(listVersions(withSecond).map((version) => version.name)).toEqual(["Second", "First"]);
  });

  it("throws when restoring an unknown version id", () => {
    expect(() => restoreVersionSnapshot(minimalProject(), "version_missing")).toThrow(
      VersionNotFoundError
    );
  });

  it("evicts oldest snapshot when FIFO cap is exceeded", () => {
    let project = createVersionSnapshot(minimalProject(), { name: "v1" });
    const firstVersionId = project.versions[0]!.id;

    for (let index = 2; index <= MAX_VERSION_SNAPSHOTS; index += 1) {
      project = createVersionSnapshot(project, { name: `v${index}` });
    }
    expect(project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
    expect(project.versions.some((entry) => entry.id === firstVersionId)).toBe(true);

    project = createVersionSnapshot(project, { name: `v${MAX_VERSION_SNAPSHOTS + 1}` });

    expect(project.versions).toHaveLength(MAX_VERSION_SNAPSHOTS);
    expect(project.versions.some((entry) => entry.id === firstVersionId)).toBe(false);
    expect(project.versions[0]?.name).toBe("v2");
    expect(project.versions[MAX_VERSION_SNAPSHOTS - 1]?.name).toBe(
      `v${MAX_VERSION_SNAPSHOTS + 1}`
    );
  });

  it("clears aiReview on restore when snapshot had none", () => {
    const withReview: VdtProject = {
      ...minimalProject(),
      aiReview: {
        assumptions: ["baseline holds"],
        questionsForUser: [],
        warnings: []
      }
    };
    const snapshotted = createVersionSnapshot(withReview, { name: "with review" });
    const mutated: VdtProject = {
      ...snapshotted,
      aiReview: {
        assumptions: ["mutated"],
        questionsForUser: ["question?"],
        warnings: []
      }
    };

    const restored = restoreVersionSnapshot(mutated, snapshotted.versions[0]!.id);

    expect(restored.aiReview).toEqual(withReview.aiReview);
    expect(restored.aiReview).not.toBe(mutated.aiReview);
  });

  it("sets aiReview to undefined when restoring snapshot without review", () => {
    const snapshotted = createVersionSnapshot(minimalProject(), { name: "no review" });
    const mutated: VdtProject = {
      ...snapshotted,
      aiReview: {
        assumptions: ["stale"],
        questionsForUser: [],
        warnings: []
      }
    };

    const restored = restoreVersionSnapshot(mutated, snapshotted.versions[0]!.id);

    expect(restored.aiReview).toBeUndefined();
  });

  describe("comprehensive edge cases", () => {
    it("does not mutate the input project when creating a snapshot", () => {
      const original = minimalProject();
      const originalVersions = original.versions;

      const snapshotted = createVersionSnapshot(original, { name: "Checkpoint" });

      expect(original.versions).toBe(originalVersions);
      expect(original.versions).toHaveLength(0);
      expect(snapshotted.versions).toHaveLength(1);
    });

    it("round-trips scenarios and dataSources on restore", () => {
      const original: VdtProject = {
        ...minimalProject(),
        scenarios: [
          {
            id: "scenario_upside",
            name: "Upside",
            overrides: [{ nodeId: "driver_a", value: 15 }],
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ],
        dataSources: [
          {
            id: "ds_erp",
            name: "ERP",
            type: "manual"
          }
        ]
      };

      const snapshotted = createVersionSnapshot(original, { name: "with scenarios" });
      const mutated: VdtProject = {
        ...snapshotted,
        scenarios: [],
        dataSources: [],
        graph: {
          ...snapshotted.graph,
          nodes: snapshotted.graph.nodes.filter((node) => node.id !== "driver_a")
        }
      };

      const restored = restoreVersionSnapshot(mutated, snapshotted.versions[0]!.id);

      expect(restored.scenarios).toEqual(original.scenarios);
      expect(restored.dataSources).toEqual(original.dataSources);
      expect(restored.graph.nodes.map((node) => node.id)).toEqual(["root", "driver_a"]);
      expect(restored.scenarios).not.toBe(mutated.scenarios);
    });

    it("preserves full version history when restoring an older snapshot", () => {
      const first = createVersionSnapshot(minimalProject(), { name: "v1" });
      const second = createVersionSnapshot(
        { ...first, updatedAt: "2026-06-22T01:00:00.000Z" },
        { name: "v2" }
      );
      const third = createVersionSnapshot(
        { ...second, updatedAt: "2026-06-22T02:00:00.000Z" },
        { name: "v3" }
      );

      const restored = restoreVersionSnapshot(third, second.versions[1]!.id);

      expect(restored.versions).toHaveLength(3);
      expect(listVersions(restored).map((version) => version.name)).toEqual(["v3", "v2", "v1"]);
      expect(restored.graph.nodes).toHaveLength(2);
    });

    it("returns an empty list from listVersions when no snapshots exist", () => {
      expect(listVersions(minimalProject())).toEqual([]);
    });

    it("stores nested version history only inside the snapshot clone", () => {
      const withFirst = createVersionSnapshot(minimalProject(), { name: "first" });
      const withSecond = createVersionSnapshot(withFirst, { name: "second" });

      const snapshot = withSecond.versions[1]!.projectSnapshot;
      expect(snapshot.versions).toEqual([]);
      expect(withSecond.versions).toHaveLength(2);
    });
  });
});
