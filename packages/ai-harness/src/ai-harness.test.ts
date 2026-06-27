import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateGraph, previewChangeSet, productionVolumeProject, validateGraph } from "@vdt-studio/vdt-core";
import {
  averageProductivitySimplifyOutput,
  deepenNodeOutputSchema,
  deepenNodeOutputToChangeSet,
  effectiveWorkingTimeAlternativeOutput,
  generateVdtOutputSchema,
  generateVdtOutputToProject,
  aiChangeSetDraftSchema,
  aiChangeSetDraftToVdtChangeSet,
  aiVdtNodeSchema,
  generateAgenticVdtProject,
  generateVdtProject,
  checkUnitsOutputSchema,
  executiveSummaryOutputSchema,
  explainNodeOutputSchema,
  explainScenarioOutputSchema,
  identifyDuplicateDriversOutputSchema,
  identifyMissingDriversOutputSchema,
  reviewModelOutputSchema,
  simplifyBranchOutputSchema,
  suggestAlternativeOutputSchema,
  suggestFormulaOutputSchema,
  LocalRunnerProvider,
  MockProvider,
  productionVolumeAiOutput,
  productionVolumeCheckUnitsOutput,
  productionVolumeDuplicateDriversOutput,
  productionVolumeExecutiveSummaryOutput,
  productionVolumeExplainNodeOutput,
  productionVolumeFormulaOutput,
  productionVolumeMissingDriversOutput,
  productionVolumeReviewOutput,
  reduceDowntimeExplainScenarioOutput,
  runCheckUnits,
  runDeepenNode,
  runExecutiveSummary,
  runExplainNode,
  runExplainScenario,
  runIdentifyDuplicateDrivers,
  runIdentifyMissingDrivers,
  runReviewModel,
  runAiTask,
  runSimplifyBranch,
  runSuggestAlternative,
  runSuggestFormula,
  simplifyBranchOutputToChangeSet,
  suggestAlternativeOutputToChangeSet,
  suggestFormulaOutputToChangeSet,
  unplannedDowntimeDeepenOutput,
  validateAndMapDeepenNode,
  validateAndMapSimplifyBranch,
  validateAndMapSuggestAlternative,
  validateAndMapSuggestFormula,
  validateCheckUnitsOutput,
  validateDeepenNodeOutput,
  validateExecutiveSummaryOutput,
  validateExplainNodeOutput,
  validateExplainScenarioOutput,
  validateIdentifyDuplicateDriversOutput,
  validateIdentifyMissingDriversOutput,
  validateReviewModelOutput
} from "./index";
import type { AiCompletionParams, AiProvider } from "./types";

function mockProviderFor<TOutput>(id: string, output: TOutput): AiProvider {
  return {
    id,
    name: `Mock ${id}`,
    type: "mock",
    async completeStructured<TInput, TResult>(): Promise<TResult> {
      return output as unknown as TResult;
    }
  };
}

describe("AI harness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates deterministic mock output", () => {
    const output = generateVdtOutputSchema.parse(productionVolumeAiOutput);

    expect(output.rootNodeId).toBe("production_volume");
    expect(output.nodes.length).toBeGreaterThan(5);
  });

  it("accepts optional fixedInScenario on AI nodes and maps it to VdtNode", () => {
    const node = aiVdtNodeSchema.parse({
      id: "calendar_time",
      name: "Calendar Time",
      description: "Total calendar hours in the period.",
      type: "input",
      aiConfidence: 0.9,
      aiRationale: "Fixed time base.",
      fixedInScenario: true
    });

    expect(node.fixedInScenario).toBe(true);

    const output = generateVdtOutputSchema.parse({
      ...productionVolumeAiOutput,
      nodes: productionVolumeAiOutput.nodes.map((entry) =>
        entry.id === "calendar_time" ? { ...entry, fixedInScenario: true } : entry
      )
    });
    const project = generateVdtOutputToProject(output, {
      rootKpi: "Production Volume",
      industry: "Mining / Processing Plant"
    });

    expect(project.graph.nodes.find((entry) => entry.id === "calendar_time")?.fixedInScenario).toBe(true);
  });

  it("rejects non-boolean fixedInScenario on AI nodes", () => {
    expect(() =>
      aiVdtNodeSchema.parse({
        id: "calendar_time",
        name: "Calendar Time",
        description: "Total calendar hours in the period.",
        type: "input",
        aiConfidence: 0.9,
        aiRationale: "Fixed time base.",
        fixedInScenario: "yes"
      })
    ).toThrow();
  });

  it("mirrors fixedInScenario through change-set draft additions and node patches", () => {
    const draft = aiChangeSetDraftSchema.parse({
      additions: [
        {
          id: "add_calendar_time",
          nodeId: "calendar_time",
          parentNodeId: "effective_working_time",
          relation: "positive_driver",
          name: "Calendar Time",
          fixedInScenario: true
        }
      ],
      updates: [
        {
          id: "update_planned_downtime",
          nodeId: "planned_downtime",
          patch: { fixedInScenario: false }
        }
      ]
    });

    const changeSet = aiChangeSetDraftToVdtChangeSet(draft, {
      taskType: "review_model",
      backendId: "mock",
      changeSetId: "changeset_test"
    });

    expect(changeSet.additions[0]?.fixedInScenario).toBe(true);
    expect(changeSet.updates[0]?.patch.fixedInScenario).toBe(false);
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
    expect(project.aiSettings.defaultProviderId).toBe("mock");
  });

  it("generates an agentic project with selected skills and decomposition plan in the provider prompt", async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const provider: AiProvider = {
      id: "capture",
      name: "Capture Provider",
      type: "mock",
      async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
        calls.push({ systemPrompt: params.systemPrompt, userPrompt: params.userPrompt });
        return productionVolumeAiOutput as TOutput;
      }
    };

    const { project, agentRun } = await generateAgenticVdtProject(provider, {
      rootKpi: "Production Volume",
      industry: "Mining / Processing Plant",
      businessContext: "Ore throughput and plant production volume",
      unit: "tonnes/month",
      goal: "Understand what drives production decrease",
      levelOfDetail: "medium"
    });

    expect(project.rootNodeId).toBe("production_volume");
    expect(agentRun.status).toBe("succeeded");
    expect(agentRun.selectedSkills.map((skill: { id: string }) => skill.id)).toContain("mining.production_volume");
    expect(agentRun.events.map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining([
      "model_call_started",
      "model_call_completed",
      "graph_validation",
      "final_report"
    ]));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.systemPrompt).toContain("Use the selected VDT skills");
    expect(calls[0]?.userPrompt).toContain("Selected skill excerpts:");
    expect(calls[0]?.userPrompt).toContain("mining.production_volume");
    expect(calls[0]?.userPrompt).toContain("Deterministic decomposition plan:");
  });

  it("adapts mock generation to the requested root KPI", async () => {
    const project = await generateVdtProject(new MockProvider(), {
      rootKpi: "Maintenance Cost",
      industry: "Asset Management",
      unit: "USD/month",
      goal: "Reduce reactive maintenance spend",
      levelOfDetail: "medium"
    });

    const rootNode = project.graph.nodes.find((node) => node.id === project.rootNodeId);
    expect(project.name).toBe("Maintenance Cost Driver Model");
    expect(project.rootNodeId).toBe("maintenance_cost");
    expect(rootNode).toMatchObject({ name: "Maintenance Cost", unit: "USD/month", type: "root_kpi" });
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
        backendId: "ollama",
        pairingToken: "session-token",
        origin: "http://127.0.0.1:3000",
        model: "qwen3",
        timeoutMs: 30_000
      }),
      {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        unit: "tonnes/month",
        goal: "Understand what drives production decrease",
        levelOfDetail: "medium"
      }
    );

    expect(project.aiSettings.defaultProviderId).toBe("local_runner");

    expect(project.name).toBe("Production Volume Driver Model");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/v1/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"taskType":"generate_tree"')
      })
    );
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const requestBody = JSON.parse(String(calls[0]?.[1]?.body));
    expect(requestBody.schemaId).toBe("generate-tree-v1");
  });

  it("rejects invalid AI output", () => {
    expect(() =>
      generateVdtOutputSchema.parse({
        ...productionVolumeAiOutput,
        rootNodeId: "missing_root"
      })
    ).toThrow();
  });

  it("validates deepen_node golden output and maps to a previewable change set", () => {
    const output = deepenNodeOutputSchema.parse(unplannedDowntimeDeepenOutput);
    expect(output.targetNodeId).toBe("unplanned_downtime");
    expect(output.nodes).toHaveLength(2);

    const { output: validated } = validateDeepenNodeOutput(
      productionVolumeProject,
      output,
      "unplanned_downtime"
    );
    const changeSet = deepenNodeOutputToChangeSet(validated, { backendId: "mock" });

    expect(changeSet.taskType).toBe("deepen_node");
    expect(changeSet.additions).toHaveLength(2);
    expect(changeSet.additions.every((entry) => entry.id.startsWith("add_"))).toBe(true);
    expect(changeSet.additions.every((entry) => entry.parentNodeId === "unplanned_downtime")).toBe(true);

    const preview = previewChangeSet(productionVolumeProject, changeSet);
    expect(preview.graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["equipment_failure_downtime", "process_interruption_downtime"])
    );

    const validation = validateGraph(preview.graph, preview.rootNodeId);
    expect(validation.valid).toBe(true);
    expect(validation.warnings).toHaveLength(0);
  });

  it("maps deepen_node output through validateAndMapDeepenNode", () => {
    const { changeSet } = validateAndMapDeepenNode(
      productionVolumeProject,
      unplannedDowntimeDeepenOutput,
      "unplanned_downtime",
      "mock"
    );

    expect(changeSet.assumptions.length).toBeGreaterThan(0);
    expect(changeSet.questions.length).toBeGreaterThan(0);
    expect(previewChangeSet(productionVolumeProject, changeSet).graph.nodes.length).toBeGreaterThan(
      productionVolumeProject.graph.nodes.length
    );
  });

  it("runs deepen_node through a task-aware mock provider", async () => {
    const deepenProvider: AiProvider = {
      id: "mock_deepen",
      name: "Mock Deepen Provider",
      type: "mock",
      async completeStructured<TInput, TOutput>(): Promise<TOutput> {
        return unplannedDowntimeDeepenOutput as TOutput;
      }
    };

    const changeSet = await runDeepenNode(deepenProvider, productionVolumeProject, "unplanned_downtime");

    expect(changeSet.backendId).toBe("mock_deepen");
    expect(changeSet.additions.map((entry) => entry.nodeId)).toEqual([
      "equipment_failure_downtime",
      "process_interruption_downtime"
    ]);
  });

  it("rejects deepen_node output with duplicate project node ids", () => {
    expect(() =>
      validateDeepenNodeOutput(productionVolumeProject, unplannedDowntimeDeepenOutput, "calendar_time")
    ).toThrow(/targetNodeId/);

    expect(() =>
      validateDeepenNodeOutput(
        productionVolumeProject,
        {
          ...unplannedDowntimeDeepenOutput,
          nodes: [
            {
              ...unplannedDowntimeDeepenOutput.nodes[0]!,
              id: "calendar_time"
            }
          ],
          edges: [
            {
              id: "edge_unplanned_downtime_calendar_time",
              sourceNodeId: "unplanned_downtime",
              targetNodeId: "calendar_time",
              relation: "additive_component",
              aiConfidence: 0.5
            }
          ]
        },
        "unplanned_downtime"
      )
    ).toThrow(/already exists/);
  });

  it("rejects deepen_node proposals that fail graph validation", () => {
    expect(() =>
      validateAndMapDeepenNode(
        productionVolumeProject,
        {
          ...unplannedDowntimeDeepenOutput,
          nodes: [
            {
              id: "invalid_formula_child",
              name: "Invalid Formula Child",
              description: "Child with broken formula.",
              type: "calculated",
              unit: "hours/month",
              formula: "equipment_failure_downtime +",
              aiConfidence: 0.5,
              aiRationale: "Test invalid formula."
            }
          ],
          edges: [
            {
              id: "edge_unplanned_invalid_formula",
              sourceNodeId: "unplanned_downtime",
              targetNodeId: "invalid_formula_child",
              relation: "additive_component",
              aiConfidence: 0.5
            }
          ]
        },
        "unplanned_downtime",
        "mock"
      )
    ).toThrow(/graph validation/);
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

  it("validates simplify_branch golden output and maps to a previewable change set", () => {
    const { changeSet } = validateAndMapSimplifyBranch(
      productionVolumeProject,
      averageProductivitySimplifyOutput,
      "average_productivity",
      "mock"
    );

    expect(changeSet.taskType).toBe("simplify_branch");
    expect(changeSet.deletions.map((entry) => entry.nodeId)).toEqual(["yield_factor"]);
    expect(changeSet.updates[0]?.patch.formula).toBe("nominal_rate * utilization_factor");

    const preview = previewChangeSet(productionVolumeProject, changeSet);
    expect(preview.graph.nodes.some((node) => node.id === "yield_factor")).toBe(false);
    expect(validateGraph(preview.graph, preview.rootNodeId).valid).toBe(true);
  });

  it("runs simplify_branch through a task-aware mock provider", async () => {
    const changeSet = await runSimplifyBranch(
      mockProviderFor("mock_simplify", averageProductivitySimplifyOutput),
      productionVolumeProject,
      "average_productivity"
    );

    expect(changeSet.backendId).toBe("mock_simplify");
    expect(changeSet.deletions).toHaveLength(1);
  });

  it("rejects simplify_branch proposals that fail graph validation", () => {
    expect(() =>
      validateAndMapSimplifyBranch(
        productionVolumeProject,
        {
          ...averageProductivitySimplifyOutput,
          nodeUpdates: []
        },
        "average_productivity",
        "mock"
      )
    ).toThrow(/graph validation/);
  });

  it("validates suggest_alternative golden output and maps to a previewable change set", () => {
    const { changeSet } = validateAndMapSuggestAlternative(
      productionVolumeProject,
      effectiveWorkingTimeAlternativeOutput,
      "effective_working_time",
      "mock"
    );

    expect(changeSet.taskType).toBe("suggest_alternative");
    expect(changeSet.deletions).toHaveLength(3);
    expect(changeSet.additions).toHaveLength(2);
    expect(changeSet.warnings.some((entry) => entry.message.includes("replaces"))).toBe(true);

    const preview = previewChangeSet(productionVolumeProject, changeSet);
    expect(validateGraph(preview.graph, preview.rootNodeId).valid).toBe(true);
  });

  it("runs suggest_alternative through a task-aware mock provider", async () => {
    const changeSet = await runSuggestAlternative(
      mockProviderFor("mock_alternative", effectiveWorkingTimeAlternativeOutput),
      productionVolumeProject,
      "effective_working_time"
    );

    expect(changeSet.additions.map((entry) => entry.nodeId)).toEqual([
      "gross_available_hours",
      "total_downtime_hours"
    ]);
  });

  it("validates review_model advisory output", () => {
    const result = validateReviewModelOutput(productionVolumeProject, productionVolumeReviewOutput);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]?.category).toBe("unit_consistency");
    expect(result.suggestedChanges).toBeUndefined();
  });

  it("runs review_model through a task-aware mock provider", async () => {
    const result = await runReviewModel(
      mockProviderFor("mock_review", productionVolumeReviewOutput),
      productionVolumeProject
    );

    expect(result.questionsForUser.length).toBeGreaterThan(0);
  });

  it("strips invalid review_model suggestedChanges drafts", () => {
    const result = validateReviewModelOutput(productionVolumeProject, {
      ...productionVolumeReviewOutput,
      suggestedChanges: {
        updates: [
          {
            id: "update_bad",
            nodeId: "production_volume",
            patch: { formula: "effective_working_time *" }
          }
        ]
      }
    });

    expect(result.suggestedChanges).toBeUndefined();
  });

  it("validates suggest_formula and maps to a single node update", () => {
    const { changeSet } = validateAndMapSuggestFormula(
      productionVolumeProject,
      productionVolumeFormulaOutput,
      "production_volume",
      "mock"
    );

    expect(changeSet.updates).toHaveLength(1);
    expect(changeSet.updates[0]?.patch.formula).toBe("effective_working_time * average_productivity");
    const preview = previewChangeSet(productionVolumeProject, changeSet);
    const rootNode = preview.graph.nodes.find((node) => node.id === "production_volume");
    expect(rootNode?.formula).toBe(productionVolumeFormulaOutput.proposedFormula);
  });

  it("runs suggest_formula through a task-aware mock provider", async () => {
    const changeSet = await runSuggestFormula(
      mockProviderFor("mock_formula", productionVolumeFormulaOutput),
      productionVolumeProject,
      "production_volume"
    );

    expect(changeSet.taskType).toBe("suggest_formula");
  });

  it("rejects suggest_formula with unparseable formulas", () => {
    expect(() =>
      validateAndMapSuggestFormula(
        productionVolumeProject,
        {
          ...productionVolumeFormulaOutput,
          proposedFormula: "effective_working_time *"
        },
        "production_volume",
        "mock"
      )
    ).toThrow(/cannot be parsed/);
  });

  it("validates check_units advisory output", () => {
    const result = validateCheckUnitsOutput(productionVolumeProject, productionVolumeCheckUnitsOutput);

    expect(result.unitFindings.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("runs check_units through a task-aware mock provider", async () => {
    const result = await runCheckUnits(
      mockProviderFor("mock_units", productionVolumeCheckUnitsOutput),
      productionVolumeProject
    );

    expect(result.unitFindings[0]?.nodeId).toBe("utilization_factor");
  });

  it("rejects check_units findings for unknown node ids", () => {
    expect(() =>
      validateCheckUnitsOutput(productionVolumeProject, {
        ...productionVolumeCheckUnitsOutput,
        unitFindings: [
          {
            nodeId: "missing_node",
            severity: "warning",
            message: "Unknown node."
          }
        ]
      })
    ).toThrow(/unknown node id/);
  });

  it("validates identify_missing_drivers advisory output", () => {
    const result = validateIdentifyMissingDriversOutput(
      productionVolumeProject,
      productionVolumeMissingDriversOutput
    );

    expect(result.missingDrivers[0]?.parentNodeId).toBe("unplanned_downtime");
  });

  it("runs identify_missing_drivers through a task-aware mock provider", async () => {
    const result = await runIdentifyMissingDrivers(
      mockProviderFor("mock_missing", productionVolumeMissingDriversOutput),
      productionVolumeProject
    );

    expect(result.missingDrivers).toHaveLength(1);
  });

  it("validates identify_duplicate_drivers advisory output", () => {
    const result = validateIdentifyDuplicateDriversOutput(
      productionVolumeProject,
      productionVolumeDuplicateDriversOutput
    );

    expect(result.duplicateClusters[0]?.nodeIds).toEqual(["utilization_factor", "yield_factor"]);
  });

  it("runs identify_duplicate_drivers through a task-aware mock provider", async () => {
    const result = await runIdentifyDuplicateDrivers(
      mockProviderFor("mock_duplicate", productionVolumeDuplicateDriversOutput),
      productionVolumeProject
    );

    expect(result.duplicateClusters).toHaveLength(1);
  });

  it("rejects duplicate driver clusters with unknown node ids", () => {
    expect(() =>
      validateIdentifyDuplicateDriversOutput(productionVolumeProject, {
        ...productionVolumeDuplicateDriversOutput,
        duplicateClusters: [{ nodeIds: ["utilization_factor", "missing_node"], similarityReason: "test" }]
      })
    ).toThrow(/unknown node id/);
  });

  it("validates explain_node output", () => {
    const result = validateExplainNodeOutput(
      productionVolumeProject,
      productionVolumeExplainNodeOutput,
      "production_volume"
    );

    expect(result.explanation).toContain("Production Volume");
    expect(result.keyDrivers.length).toBeGreaterThan(0);
  });

  it("runs explain_node through a task-aware mock provider", async () => {
    const result = await runExplainNode(
      mockProviderFor("mock_explain_node", productionVolumeExplainNodeOutput),
      productionVolumeProject,
      "production_volume"
    );

    expect(result.nodeId).toBe("production_volume");
  });

  it("validates explain_scenario output", () => {
    const result = validateExplainScenarioOutput(
      productionVolumeProject,
      reduceDowntimeExplainScenarioOutput,
      "scenario_reduce_unplanned_downtime"
    );

    expect(result.impactHighlights.length).toBeGreaterThan(0);
  });

  it("runs explain_scenario through a task-aware mock provider", async () => {
    const result = await runExplainScenario(
      mockProviderFor("mock_explain_scenario", reduceDowntimeExplainScenarioOutput),
      productionVolumeProject,
      "scenario_reduce_unplanned_downtime",
      {
        calculationSummary: {
          rootNodeId: "production_volume",
          baselineRootValue: 114048,
          scenarioRootValue: 117888,
          rootDelta: 3840,
          nodeValues: []
        }
      }
    );

    expect(result.scenarioId).toBe("scenario_reduce_unplanned_downtime");
  });

  it("validates executive summary output", () => {
    const result = validateExecutiveSummaryOutput(productionVolumeExecutiveSummaryOutput);

    expect(result.headline.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("runs generate_executive_summary through a task-aware mock provider", async () => {
    const result = await runExecutiveSummary(
      mockProviderFor("mock_summary", productionVolumeExecutiveSummaryOutput),
      productionVolumeProject,
      { rootValue: 114048 }
    );

    expect(result.keyDrivers.length).toBeGreaterThan(0);
  });

  it("dispatches deepen_node through runAiTask with MockProvider", async () => {
    const result = await runAiTask("deepen_node", new MockProvider(), {
      project: productionVolumeProject,
      nodeId: "unplanned_downtime"
    });

    expect(result.kind).toBe("change_set");
    if (result.kind !== "change_set") return;
    expect(result.changeSet.taskType).toBe("deepen_node");
    expect(result.changeSet.additions.map((entry) => entry.nodeId)).toEqual([
      "equipment_failure_downtime",
      "process_interruption_downtime"
    ]);
    expect(result.agentRun).toMatchObject({
      status: "succeeded",
      events: expect.arrayContaining([
        expect.objectContaining({ type: "classification" }),
        expect.objectContaining({ type: "skill_selected" }),
        expect.objectContaining({ type: "model_call_started" }),
        expect.objectContaining({ type: "graph_patch" }),
        expect.objectContaining({ type: "graph_validation" }),
        expect.objectContaining({ type: "final_report" })
      ])
    });
  });

  it("dispatches review_model through runAiTask with MockProvider", async () => {
    const result = await runAiTask("review_model", new MockProvider(), {
      project: productionVolumeProject
    });

    expect(result.kind).toBe("advisory");
    if (result.kind !== "advisory" || !("findings" in result.result)) return;
    expect(result.result.findings.length).toBeGreaterThan(0);
    expect(result.result.questionsForUser.length).toBeGreaterThan(0);
  });

  it("maps change set helpers produce unique entry ids", () => {
    const simplifyChangeSet = simplifyBranchOutputToChangeSet(averageProductivitySimplifyOutput, {
      backendId: "mock"
    });
    const alternativeChangeSet = suggestAlternativeOutputToChangeSet(effectiveWorkingTimeAlternativeOutput, {
      backendId: "mock"
    });
    const formulaChangeSet = suggestFormulaOutputToChangeSet(productionVolumeFormulaOutput, {
      backendId: "mock"
    });

    for (const changeSet of [simplifyChangeSet, alternativeChangeSet, formulaChangeSet]) {
      const entryIds = [
        ...changeSet.additions.map((entry) => entry.id),
        ...changeSet.updates.map((entry) => entry.id),
        ...changeSet.deletions.map((entry) => entry.id),
        ...changeSet.edgeChanges.map((entry) => entry.id)
      ];
      expect(new Set(entryIds).size).toBe(entryIds.length);
    }
  });

  describe("golden path runAiTask (MockProvider)", () => {
    const provider = new MockProvider();

    it("dispatches generate_tree through runAiTask", async () => {
      const result = await runAiTask("generate_tree", provider, {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        unit: "tonnes/month",
        goal: "Understand what drives production decrease",
        levelOfDetail: "medium"
      });

      expect(result.kind).toBe("project");
      if (result.kind !== "project") return;
      expect(result.project.rootNodeId).toBe("production_volume");
    });

    it("dispatches simplify_branch through runAiTask with previewable graph", async () => {
      const result = await runAiTask("simplify_branch", provider, {
        project: productionVolumeProject,
        branchRootNodeId: "average_productivity"
      });

      expect(result.kind).toBe("change_set");
      if (result.kind !== "change_set") return;
      const preview = previewChangeSet(productionVolumeProject, result.changeSet);
      expect(validateGraph(preview.graph, preview.rootNodeId).valid).toBe(true);
    });

    it("dispatches suggest_alternative through runAiTask with previewable graph", async () => {
      const result = await runAiTask("suggest_alternative", provider, {
        project: productionVolumeProject,
        targetNodeId: "effective_working_time"
      });

      expect(result.kind).toBe("change_set");
      if (result.kind !== "change_set") return;
      const preview = previewChangeSet(productionVolumeProject, result.changeSet);
      expect(validateGraph(preview.graph, preview.rootNodeId).valid).toBe(true);
    });

    it("dispatches suggest_formula through runAiTask with previewable graph", async () => {
      const result = await runAiTask("suggest_formula", provider, {
        project: productionVolumeProject,
        nodeId: "production_volume"
      });

      expect(result.kind).toBe("change_set");
      if (result.kind !== "change_set") return;
      const preview = previewChangeSet(productionVolumeProject, result.changeSet);
      expect(validateGraph(preview.graph, preview.rootNodeId).valid).toBe(true);
    });

    it("dispatches check_units through runAiTask", async () => {
      const result = await runAiTask("check_units", provider, { project: productionVolumeProject });

      expect(result.kind).toBe("advisory");
      if (result.kind !== "advisory" || !("unitFindings" in result.result)) return;
      expect(result.result.unitFindings.length).toBeGreaterThan(0);
    });

    it("dispatches identify_missing_drivers through runAiTask", async () => {
      const result = await runAiTask("identify_missing_drivers", provider, {
        project: productionVolumeProject
      });

      expect(result.kind).toBe("advisory");
      if (result.kind !== "advisory" || !("missingDrivers" in result.result)) return;
      expect(result.result.missingDrivers.length).toBeGreaterThan(0);
    });

    it("dispatches identify_duplicate_drivers through runAiTask", async () => {
      const result = await runAiTask("identify_duplicate_drivers", provider, {
        project: productionVolumeProject
      });

      expect(result.kind).toBe("advisory");
      if (result.kind !== "advisory" || !("duplicateClusters" in result.result)) return;
      expect(result.result.duplicateClusters.length).toBeGreaterThan(0);
    });

    it("dispatches explain_node through runAiTask", async () => {
      const result = await runAiTask("explain_node", provider, {
        project: productionVolumeProject,
        nodeId: "production_volume"
      });

      expect(result.kind).toBe("explanation");
      if (result.kind !== "explanation" || !("explanation" in result.result)) return;
      expect(result.result.explanation).toContain("Production Volume");
    });

    it("dispatches explain_scenario through runAiTask", async () => {
      const result = await runAiTask("explain_scenario", provider, {
        project: productionVolumeProject,
        scenarioId: "scenario_reduce_unplanned_downtime",
        calculationSummary: {
          rootNodeId: "production_volume",
          baselineRootValue: 114048,
          scenarioRootValue: 117888,
          rootDelta: 3840,
          nodeValues: []
        }
      });

      expect(result.kind).toBe("explanation");
      if (result.kind !== "explanation" || !("impactHighlights" in result.result)) return;
      expect(result.result.impactHighlights.length).toBeGreaterThan(0);
    });

    it("dispatches generate_executive_summary through runAiTask", async () => {
      const result = await runAiTask("generate_executive_summary", provider, {
        project: productionVolumeProject,
        rootValue: 114048
      });

      expect(result.kind).toBe("explanation");
      if (result.kind !== "explanation" || !("headline" in result.result)) return;
      expect(result.result.headline.length).toBeGreaterThan(0);
    });
  });

  describe("invalid AI output fixtures (schema rejection)", () => {
    it("rejects invalid generate_tree output", () => {
      expect(() =>
        generateVdtOutputSchema.parse({
          ...productionVolumeAiOutput,
          nodes: []
        })
      ).toThrow();
    });

    it("rejects invalid deepen_node output", () => {
      expect(() =>
        deepenNodeOutputSchema.parse({
          ...unplannedDowntimeDeepenOutput,
          targetNodeId: ""
        })
      ).toThrow();
    });

    it("rejects invalid simplify_branch output", () => {
      expect(() =>
        simplifyBranchOutputSchema.parse({
          ...averageProductivitySimplifyOutput,
          rationale: ""
        })
      ).toThrow();
    });

    it("rejects invalid suggest_alternative output", () => {
      expect(() =>
        suggestAlternativeOutputSchema.parse({
          ...effectiveWorkingTimeAlternativeOutput,
          targetNodeId: ""
        })
      ).toThrow();
    });

    it("rejects invalid suggest_formula output", () => {
      expect(() =>
        suggestFormulaOutputSchema.parse({
          ...productionVolumeFormulaOutput,
          proposedFormula: ""
        })
      ).toThrow();
    });

    it("rejects invalid review_model output", () => {
      expect(() =>
        reviewModelOutputSchema.parse({
          ...productionVolumeReviewOutput,
          findings: [
            {
              severity: "warning",
              category: "not_a_category",
              message: "Invalid category."
            }
          ]
        })
      ).toThrow();
    });

    it("rejects invalid check_units output", () => {
      expect(() =>
        checkUnitsOutputSchema.parse({
          ...productionVolumeCheckUnitsOutput,
          unitFindings: [
            {
              nodeId: "utilization_factor",
              severity: "critical",
              message: "Invalid severity."
            }
          ]
        })
      ).toThrow();
    });

    it("rejects invalid identify_missing_drivers output", () => {
      expect(() =>
        identifyMissingDriversOutputSchema.parse({
          ...productionVolumeMissingDriversOutput,
          missingDrivers: [
            {
              ...productionVolumeMissingDriversOutput.missingDrivers[0]!,
              suggestedName: ""
            }
          ]
        })
      ).toThrow();
    });

    it("rejects invalid identify_duplicate_drivers output", () => {
      expect(() =>
        identifyDuplicateDriversOutputSchema.parse({
          ...productionVolumeDuplicateDriversOutput,
          duplicateClusters: [{ nodeIds: ["utilization_factor"], similarityReason: "Only one node." }]
        })
      ).toThrow();
    });

    it("rejects invalid explain_node output", () => {
      expect(() =>
        explainNodeOutputSchema.parse({
          ...productionVolumeExplainNodeOutput,
          explanation: ""
        })
      ).toThrow();
    });

    it("rejects invalid explain_scenario output", () => {
      expect(() =>
        explainScenarioOutputSchema.parse({
          ...reduceDowntimeExplainScenarioOutput,
          narrative: ""
        })
      ).toThrow();
    });

    it("rejects invalid generate_executive_summary output", () => {
      expect(() =>
        executiveSummaryOutputSchema.parse({
          ...productionVolumeExecutiveSummaryOutput,
          headline: ""
        })
      ).toThrow();
    });
  });
});
