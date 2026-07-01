import { describe, expect, it } from "vitest";
import { calculateGraph, validateGraph } from "@vdt-studio/vdt-core";
import {
  createVdtAgentRuntime,
  type AgentDecisionProvider
} from "./orchestrator";
import type { AgentDecision } from "./schemas/agent-decision";
import type { FirstResponseInput, FirstResponseOutput } from "./schemas/agent-first-response";
import { createDefaultToolRegistry } from "./tools";
import type { ResearchProvider } from "./tools/research-tools";
import { AgentToolError } from "./tool-registry";
import type { AgentDecisionContext } from "./types";

function scriptedProvider(
  decisions: unknown[],
  firstResponse: FirstResponseOutput = {
    assistantMessage: "I will use the visible brief as the source of truth before drafting.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request."
    }
  }
): AgentDecisionProvider & {
  calls: number;
  taskTypes: string[];
  firstResponseInputs: FirstResponseInput[];
  decisionInputs: AgentDecisionContext[];
} {
  return {
    id: "decision-test",
    calls: 0,
    taskTypes: [],
    firstResponseInputs: [],
    decisionInputs: [],
    async completeStructured(params) {
      this.calls += 1;
      this.taskTypes.push(params.taskType);
      if (params.taskType === "orchestrator_first_response") {
        this.firstResponseInputs.push(params.input as FirstResponseInput);
        return firstResponse as never;
      }
      this.decisionInputs.push(params.input as AgentDecisionContext);
      const decision = decisions.shift();
      if (!decision) throw new Error("Scripted provider ran out of decisions.");
      return decision as never;
    }
  };
}

function schemaValidatingRawDecisionProvider(
  decisions: unknown[],
  firstResponse: FirstResponseOutput = {
    assistantMessage: "I will continue through the decision loop.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request."
    }
  }
): AgentDecisionProvider & {
  decisionInputs: AgentDecisionContext[];
} {
  return {
    id: "schema-validating-provider",
    decisionInputs: [],
    async completeStructured(params) {
      const raw = params.taskType === "orchestrator_first_response"
        ? firstResponse
        : decisions.shift();
      if (params.taskType === "agent_decision") {
        this.decisionInputs.push(params.input as AgentDecisionContext);
      }
      const schema = params.schema as { parse?: (value: unknown) => unknown };
      return (typeof schema.parse === "function" ? schema.parse(raw) : raw) as never;
    }
  };
}

function structuredDecisionFailureProvider(
  decisions: unknown[],
  firstResponse: FirstResponseOutput = {
    assistantMessage: "I will continue through the decision loop.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request."
    }
  }
): AgentDecisionProvider & {
  decisionInputs: AgentDecisionContext[];
} {
  return {
    id: "structured-decision-failure-provider",
    decisionInputs: [],
    async completeStructured(params) {
      if (params.taskType === "orchestrator_first_response") {
        return firstResponse as never;
      }
      this.decisionInputs.push(params.input as AgentDecisionContext);
      const decision = decisions.shift();
      if (decision instanceof Error) {
        throw decision;
      }
      if (!decision) throw new Error("Structured failure provider ran out of decisions.");
      return decision as never;
    }
  };
}

function timeoutAfterFirstResponseProvider(firstResponse: FirstResponseOutput): AgentDecisionProvider & { taskTypes: string[] } {
  return {
    id: "timeout-test",
    taskTypes: [],
    async completeStructured(params) {
      this.taskTypes.push(params.taskType);
      if (params.taskType === "orchestrator_first_response") {
        return firstResponse as never;
      }
      const error = new Error("Backend execution timed out.");
      (error as { code?: string }).code = "TIMEOUT";
      throw error;
    }
  };
}

function firstResponseParseFailureProvider(): AgentDecisionProvider & { taskTypes: string[] } {
  return {
    id: "parse-failure-test",
    taskTypes: [],
    async completeStructured(params) {
      this.taskTypes.push(params.taskType);
      const error = new Error("Backend output could not be parsed as the required structured response.");
      (error as { code?: string }).code = "BACKEND_PARSE_FAILED";
      throw error;
    }
  };
}

function askForHaulageInputs(): AgentDecision {
  return {
    type: "ask_user",
    statusMessage: "Payload and operating hours are needed before calculating hauled tonnes.",
    questions: [
      {
        id: "payload_per_trip_t",
        question: "What is the average payload per trip in tonnes?",
        reason: "Annual ore hauled requires tonnes per trip.",
        required: true,
        expectedAnswerType: "number"
      },
      {
        id: "operating_hours",
        question: "How many operating hours per year should the model use?",
        reason: "Trips per truck require an annual operating-hours base.",
        required: true,
        expectedAnswerType: "number"
      }
    ]
  };
}

function haulageBuildDecisions(): AgentDecision[] {
  return [
    {
      type: "call_tool",
      toolName: "vdt.create_draft",
      statusMessage: "Creating the hauled-tonnes root.",
      args: {
        projectTitle: "Ore haulage Driver Model",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year",
        industry: "Mining"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding truck count.",
      args: {
        parentNodeId: "ore_haulage",
        nodeId: "number_of_trucks",
        name: "Number of trucks",
        type: "input",
        unit: "trucks",
        relation: "multiplicative_driver",
        baselineValue: 5
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding trips per truck.",
      args: {
        parentNodeId: "ore_haulage",
        nodeId: "trips_per_truck",
        name: "Trips per truck",
        type: "calculated",
        unit: "trips/truck/year",
        relation: "multiplicative_driver"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding payload per trip.",
      args: {
        parentNodeId: "ore_haulage",
        nodeId: "payload_per_trip_t",
        name: "Payload per trip",
        type: "input",
        unit: "tonnes/trip",
        relation: "multiplicative_driver",
        baselineValue: 40
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding operating hours.",
      args: {
        parentNodeId: "trips_per_truck",
        nodeId: "operating_hours",
        name: "Operating hours",
        type: "input",
        unit: "h/year",
        relation: "formula_dependency",
        baselineValue: 4000
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding cycle time.",
      args: {
        parentNodeId: "trips_per_truck",
        nodeId: "cycle_time_h",
        name: "Cycle time",
        type: "calculated",
        unit: "h/trip",
        relation: "divisive_driver"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding loaded travel time.",
      args: {
        parentNodeId: "cycle_time_h",
        nodeId: "loaded_travel_time_h",
        name: "Loaded travel time",
        type: "calculated",
        unit: "h/trip",
        relation: "additive_component"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding empty return time.",
      args: {
        parentNodeId: "cycle_time_h",
        nodeId: "empty_return_time_h",
        name: "Empty return time",
        type: "calculated",
        unit: "h/trip",
        relation: "additive_component"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding haul distance.",
      args: {
        parentNodeId: "loaded_travel_time_h",
        nodeId: "haul_distance_km",
        name: "Average haul distance",
        type: "input",
        unit: "km",
        relation: "formula_dependency",
        baselineValue: 2.7
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding loaded speed.",
      args: {
        parentNodeId: "loaded_travel_time_h",
        nodeId: "loaded_speed_kmh",
        name: "Average loaded speed",
        type: "input",
        unit: "km/h",
        relation: "formula_dependency",
        baselineValue: 7
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.add_driver",
      statusMessage: "Adding empty speed.",
      args: {
        parentNodeId: "empty_return_time_h",
        nodeId: "empty_speed_kmh",
        name: "Average empty speed",
        type: "input",
        unit: "km/h",
        relation: "formula_dependency",
        baselineValue: 11
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.set_formula",
      statusMessage: "Setting loaded travel time formula.",
      args: {
        nodeId: "loaded_travel_time_h",
        formula: "haul_distance_km / loaded_speed_kmh"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.set_formula",
      statusMessage: "Setting empty return time formula.",
      args: {
        nodeId: "empty_return_time_h",
        formula: "haul_distance_km / empty_speed_kmh"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.set_formula",
      statusMessage: "Setting cycle-time formula.",
      args: {
        nodeId: "cycle_time_h",
        formula: "loaded_travel_time_h + empty_return_time_h"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.set_formula",
      statusMessage: "Setting trips-per-truck formula.",
      args: {
        nodeId: "trips_per_truck",
        formula: "operating_hours / cycle_time_h"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.set_formula",
      statusMessage: "Setting the root hauled-tonnes formula.",
      args: {
        nodeId: "ore_haulage",
        formula: "number_of_trucks * trips_per_truck * payload_per_trip_t"
      }
    },
    {
      type: "call_tool",
      toolName: "vdt.validate",
      statusMessage: "Validating the graph.",
      args: {}
    },
    {
      type: "call_tool",
      toolName: "vdt.calculate",
      statusMessage: "Calculating the graph.",
      args: {}
    },
    {
      type: "finish",
      summary: "Built a valid calculable truck haulage VDT.",
      nextSuggestedActions: ["Review payload and operating-hour assumptions."]
    }
  ];
}

describe("VdtAgentRuntime decision loop", { timeout: 15_000 }, () => {
  it("keeps agent_decision schema validation in the orchestrator even when provider validates its supplied schema", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = schemaValidatingRawDecisionProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Missing args should be rejected by orchestrator feedback."
      },
      {
        type: "ask_user",
        statusMessage: "Asking after orchestrator-side schema feedback.",
        questions: [{
          id: "root_kpi_needed",
          question: "What root KPI should the draft use?",
          reason: "The previous agent decision was missing required tool args.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT", rootKpi: "Revenue" },
      providerId: "schema-validating-provider",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.retryableError).toBeUndefined();
    expect(snapshot.lastFeedback).toMatchObject({
      kind: "schema_validation_failed",
      target: { taskType: "agent_decision", fieldPath: "args" }
    });
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({ kind: "schema_validation_failed" });
  });

  it("feeds provider-side agent_decision structured output failures back to the next AI decision", async () => {
    const runtime = createVdtAgentRuntime();
    const providerError = new Error("AI response could not be parsed or validated: Required field args is missing.");
    const provider = structuredDecisionFailureProvider([
      providerError,
      {
        type: "ask_user",
        statusMessage: "Asking after provider-side schema feedback.",
        questions: [{
          id: "root_kpi_needed",
          question: "What root KPI should the draft use?",
          reason: "The previous provider response failed structured output validation.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT", rootKpi: "Revenue" },
      providerId: "structured-decision-failure-provider",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.retryableError).toBeUndefined();
    expect(snapshot.lastFeedback).toMatchObject({
      kind: "schema_validation_failed",
      message: expect.stringContaining("could not be parsed or validated"),
      target: { taskType: "agent_decision" },
      retryable: true
    });
    expect(provider.decisionInputs).toHaveLength(2);
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({
      kind: "schema_validation_failed",
      target: { taskType: "agent_decision" }
    });
  });

  it("feeds forbidden full-plan fields back to the provider and retries the next small decision", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Trying a full plan.",
        args: {},
        nodes: [{ id: "bad" }]
      },
      {
        type: "ask_user",
        statusMessage: "Asking for a safe process boundary.",
        questions: [{
          id: "process_boundary",
          question: "What process boundary should this VDT use?",
          reason: "The previous output attempted to return a full graph instead of one decision.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a mining VDT", rootKpi: "Mine production" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({ kind: "forbidden_field", retryable: true });
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({ kind: "forbidden_field" });
    expect(snapshot.events.some((event) =>
      event.title === "AI decision rejected" &&
      event.metadata?.retrying === true
    )).toBe(true);
  });

  it("returns unknown tool feedback to the next AI decision", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "missing.tool",
        statusMessage: "Trying a missing tool.",
        args: {}
      },
      {
        type: "ask_user",
        statusMessage: "Falling back to a process question.",
        questions: [{
          id: "missing_tool_fallback",
          question: "What process components should the agent model manually?",
          reason: "The requested tool is not available.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT", rootKpi: "Custom KPI" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({ kind: "unknown_tool", target: { toolName: "missing.tool" } });
    expect(provider.decisionInputs[1]?.recentFeedback?.at(-1)).toMatchObject({ kind: "unknown_tool" });
  });

  it("returns invalid tool args feedback to the next AI decision", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Trying invalid args.",
        args: { projectTitle: "Bad draft" }
      },
      {
        type: "ask_user",
        statusMessage: "Asking after invalid tool args.",
        questions: [{
          id: "root_kpi_needed",
          question: "What root KPI should the draft use?",
          reason: "The draft tool requires rootKpi.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT", rootKpi: "Revenue" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({ kind: "invalid_tool_args", target: { toolName: "vdt.create_draft" } });
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({ kind: "invalid_tool_args" });
  });

  it("turns research provider absence into feedback and lets the agent ask the user", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "research.search_web",
        statusMessage: "Checking configured research sources.",
        args: {
          query: "custom industrial KPI process drivers",
          purpose: "process_components"
        }
      },
      {
        type: "ask_user",
        statusMessage: "Research is not configured, so asking for process components.",
        questions: [{
          id: "process_components",
          question: "What are the main process components and formula boundary for this KPI?",
          reason: "Research provider is not configured.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT for an unknown KPI", rootKpi: "Custom KPI" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({ kind: "research_required", target: { toolName: "research.search_web" } });
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({ kind: "research_required" });
  });

  it("feeds configured research results back into the next agent decision", async () => {
    const researchProvider: ResearchProvider = {
      id: "test-search",
      async search(query, options) {
        return [{
          id: "test_1",
          title: "Mine production process drivers",
          url: "https://example.com/mining-production",
          sourceName: "Example",
          snippet: `${query}: working time and productivity rate for ${options.purpose}.`,
          retrievedAt: "2026-07-01T00:00:00.000Z"
        }];
      }
    };
    const runtime = createVdtAgentRuntime({
      tools: createDefaultToolRegistry({ researchProvider })
    });
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "research.search_web",
        statusMessage: "Checking configured research sources.",
        args: {
          query: "mine production process drivers",
          purpose: "process_components",
          maxResults: 3
        }
      },
      {
        type: "ask_user",
        statusMessage: "Research found candidate process drivers; asking for the site-specific boundary.",
        questions: [{
          id: "process_boundary",
          question: "Which researched process drivers apply to this mine?",
          reason: "The search result gave general process drivers that need user confirmation.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT for mine production", rootKpi: "Mine production" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toBeUndefined();
    expect(provider.decisionInputs[1]?.lastToolResult).toMatchObject({
      toolName: "research.search_web",
      ok: true,
      output: {
        providerConfigured: true,
        providerId: "test-search",
        results: [
          expect.objectContaining({
            id: "test_1",
            title: "Mine production process drivers"
          })
        ]
      }
    });
  });

  it("turns configured research provider failures into structured feedback for the next decision", async () => {
    const researchProvider: ResearchProvider = {
      id: "test-search",
      async search() {
        throw new AgentToolError(
          "RESEARCH_PROVIDER_UNAVAILABLE",
          "Research provider \"test-search\" request failed with status 503.",
          { providerId: "test-search", status: 503 }
        );
      }
    };
    const runtime = createVdtAgentRuntime({
      tools: createDefaultToolRegistry({ researchProvider })
    });
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "research.search_web",
        statusMessage: "Checking configured research sources.",
        args: {
          query: "mine production process drivers",
          purpose: "process_components",
          maxResults: 3
        }
      },
      {
        type: "ask_user",
        statusMessage: "Research provider failed, so asking for source details.",
        questions: [{
          id: "process_components",
          question: "What process components should the VDT use while research is unavailable?",
          reason: "The configured research provider failed.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a VDT for mine production", rootKpi: "Mine production" },
      providerId: "decision-test",
      options: { maxSteps: 4 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({
      kind: "tool_failed",
      target: { toolName: "research.search_web" },
      actual: { providerId: "test-search", status: 503 },
      retryable: true
    });
    expect(provider.decisionInputs[1]?.lastFeedback).toMatchObject({
      kind: "tool_failed",
      target: { toolName: "research.search_web" }
    });
  });

  it("records finish rejection feedback and lets the next decision repair or ask", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Creating a draft without values.",
        args: { projectTitle: "Revenue", rootKpi: "Revenue" }
      },
      {
        type: "finish",
        summary: "Trying to finish too early.",
        nextSuggestedActions: []
      },
      {
        type: "ask_user",
        statusMessage: "Asking for the missing formula/value.",
        questions: [{
          id: "root_formula_or_value",
          question: "What formula or value should the root KPI use?",
          reason: "The draft cannot finish without a formula or value.",
          required: true,
          expectedAnswerType: "text"
        }]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build a simple revenue VDT", rootKpi: "Revenue" },
      providerId: "decision-test",
      options: { autoApplyPatches: true, maxSteps: 6 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.lastFeedback).toMatchObject({ kind: "finish_rejected" });
    expect(provider.decisionInputs[2]?.lastFeedback).toMatchObject({ kind: "finish_rejected" });
    expect(snapshot.repairAttemptCount).toBe(1);
  });

  it("asks for modeling direction before skill selection when the visible root KPI is a placeholder", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([], {
      assistantMessage: "I can use those inputs, but first I need to confirm what VDT you want to build.",
      nextAction: "ask_user",
      questions: [
        {
          id: "model_direction",
          question: "What value driver tree should we build from this information?",
          reason: "The visible Root KPI is still a placeholder, and the source data alone does not define the model output.",
          required: true,
          expectedAnswerType: "text",
          freeTextAllowed: true,
          placeholder: "Describe the target output, KPI, or business question for the tree."
        }
      ],
      publicStatus: {
        phase: "asking_questions",
        message: "Confirming what VDT to build."
      }
    });

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 Komatsu PC1250 and 2 Komatsu PC2000",
        rootKpi: "New VDT",
        timePeriod: "monthly"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, maxSteps: 10 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(provider.taskTypes).toEqual(["orchestrator_first_response"]);
    expect(provider.decisionInputs).toEqual([]);
    expect(provider.firstResponseInputs[0]?.briefReadiness).toMatchObject({
      rootKpiIsPlaceholder: true,
      directionStatus: "needs_agent_judgment"
    });
    expect(snapshot.pendingQuestions?.[0]).toMatchObject({
      id: "model_direction",
      question: "What value driver tree should we build from this information?",
      answerKind: "text",
      freeTextAllowed: true
    });
    expect(snapshot.events.map((event) => event.type)).not.toContain("skill_search");
    expect(snapshot.selectedSkills).toEqual([]);
  });

  it("splits compound fleet and shift clarification into structured fields", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([], {
      assistantMessage: "I need to confirm the operating setup before building the tree.",
      nextAction: "ask_user",
      questions: [
        {
          id: "confirm_fleet_and_shifts",
          question: "How many excavators and trucks should I use, and do they work in both shifts?",
          reason: "Fleet count and shift pattern determine annual excavation capacity.",
          required: true,
          expectedAnswerType: "text"
        }
      ],
      publicStatus: {
        phase: "asking_questions",
        message: "Confirming fleet and shift inputs."
      }
    });

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation VDT.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, maxSteps: 10 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.pendingQuestions?.map((question) => question.id)).toEqual([
      "confirm_fleet_and_shifts_fleet",
      "confirm_fleet_and_shifts_shifts"
    ]);
    expect(snapshot.pendingQuestions?.[0]?.fields?.map((field) => field.id)).toEqual([
      "excavator_count",
      "haul_truck_count"
    ]);
    expect(snapshot.pendingQuestions?.[1]?.fields?.map((field) => field.id)).toEqual(["shifts_per_day"]);
  });

  it("normalizes compound numeric clarifications into separate answer fields", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([], {
      assistantMessage: "I need to confirm the missing operating inputs before building the tree.",
      nextAction: "ask_user",
      questions: [
        {
          id: "fleet_counts",
          question: "How many excavators and trucks should the model use?",
          reason: "Fleet count determines loading and hauling capacity.",
          required: true,
          expectedAnswerType: "text"
        },
        {
          id: "excavator_mix",
          question: "Of the excavators, how many are reverse shovel and how many are straight shovel?",
          reason: "Excavator type can affect loading assumptions.",
          required: true,
          expectedAnswerType: "text"
        },
        {
          id: "calendar",
          question: "How many hours are in each shift, and how many working days per year should be assumed?",
          reason: "Calendar assumptions determine annual available hours.",
          required: true,
          expectedAnswerType: "text"
        }
      ],
      publicStatus: {
        phase: "asking_questions",
        message: "Confirming missing inputs."
      }
    });

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation VDT.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, maxSteps: 10 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.pendingQuestions?.map((question) => question.id)).toEqual([
      "fleet_counts",
      "excavator_mix",
      "calendar"
    ]);
    expect(snapshot.pendingQuestions?.[0]?.fields?.map((field) => field.id)).toEqual([
      "excavator_count",
      "haul_truck_count"
    ]);
    expect(snapshot.pendingQuestions?.[1]?.fields?.map((field) => field.id)).toEqual([
      "reverse_shovel_count",
      "straight_shovel_count"
    ]);
    expect(snapshot.pendingQuestions?.[2]?.fields?.map((field) => field.id)).toEqual([
      "hours_per_shift",
      "working_days_per_year"
    ]);
  });

  it("continues automatically across safe Working time layers without asking after each layer", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Creating the production root.",
        args: {
          projectTitle: "Production Volume Driver Model",
          rootKpi: "Production Volume",
          unit: "tonnes/month",
          timePeriod: "month",
          industry: "Mining"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_drivers_batch",
        statusMessage: "Adding the first visible production layer.",
        args: {
          drivers: [
            {
              parentNodeId: "production_volume",
              nodeId: "throughput_rate",
              name: "Throughput rate",
              type: "input",
              unit: "tonnes/hour",
              relation: "multiplicative_driver",
              baselineValue: 10
            },
            {
              parentNodeId: "production_volume",
              nodeId: "working_time",
              name: "Working time",
              type: "calculated",
              unit: "hours/month",
              relation: "multiplicative_driver"
            }
          ]
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_drivers_batch",
        statusMessage: "Decomposing Working time into downtime categories.",
        args: {
          drivers: [
            {
              parentNodeId: "working_time",
              nodeId: "scheduled_shift_time",
              name: "Scheduled shift time",
              type: "input",
              unit: "hours/month",
              relation: "additive_component",
              baselineValue: 100
            },
            {
              parentNodeId: "working_time",
              nodeId: "planned_downtime",
              name: "Planned downtime",
              type: "input",
              unit: "hours/month",
              relation: "subtractive_component",
              baselineValue: 10
            },
            {
              parentNodeId: "working_time",
              nodeId: "unplanned_downtime",
              name: "Unplanned downtime",
              type: "input",
              unit: "hours/month",
              relation: "subtractive_component",
              baselineValue: 5
            }
          ]
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.set_formula",
        statusMessage: "Calculating Working time.",
        args: {
          nodeId: "working_time",
          formula: "scheduled_shift_time - planned_downtime - unplanned_downtime"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.set_formula",
        statusMessage: "Calculating Production Volume.",
        args: {
          nodeId: "production_volume",
          formula: "throughput_rate * working_time"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.calculate",
        statusMessage: "Calculating the VDT.",
        args: {}
      },
      {
        type: "finish",
        summary: "Built a calculable production-volume VDT with Working time decomposed into downtime categories.",
        nextSuggestedActions: ["Review additional downtime categories if the mine has more stoppage data."]
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a production volume VDT.",
        rootKpi: "Production Volume",
        unit: "tonnes/month",
        timePeriod: "month",
        industry: "Mining"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, autoApplyPatches: true, maxSteps: 12 }
    }, { provider });

    expect(snapshot.status).toBe("succeeded");
    expect(snapshot.pendingQuestions).toBeUndefined();
    expect(provider.firstResponseInputs[0]?.continuationPolicy).toMatchObject({
      continueWithAssumptions: false,
      maxNodesPerLayer: 8
    });
    expect(provider.decisionInputs.every((input) => input.continuationPolicy.continueWithAssumptions === false)).toBe(true);
    const layerProposals = snapshot.mutationProposals?.filter((proposal) => proposal.changeSet.additions.length > 0);
    expect(layerProposals?.map((proposal) => proposal.progressiveScope?.targetNodeId)).toEqual([
      "production_volume",
      "working_time"
    ]);
    expect(snapshot.progressiveBuild).toMatchObject({
      currentDepth: 2,
      completedLayerNodeIds: expect.arrayContaining(["production_volume", "working_time"])
    });
    expect(snapshot.project?.graph.nodes.map((node) => node.name)).toEqual(expect.arrayContaining([
      "Production Volume",
      "Throughput rate",
      "Working time",
      "Scheduled shift time",
      "Planned downtime",
      "Unplanned downtime"
    ]));
    expect(calculateGraph(snapshot.project!).rootValue).toBe(850);
  });

  it("asks for missing haulage inputs, resumes the same run, and builds a valid calculable VDT one tool at a time", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "skill.search",
        statusMessage: "Searching haulage skills.",
        args: {
          rootKpi: "Ore haulage",
          industry: "Mining",
          businessContext: "5 trucks, 2.7 km, 7 km/h loaded, 11 km/h empty",
          maxSkills: 3
        }
      },
      {
        type: "call_tool",
        toolName: "skill.read",
        statusMessage: "Reading the truck-cycle skill.",
        args: { skillId: "mining.haulage_truck_cycle" }
      },
      {
        type: "call_tool",
        toolName: "skill.compile_recipe",
        statusMessage: "Compiling a truck-cycle recipe.",
        args: { skillId: "mining.haulage_truck_cycle" }
      },
      askForHaulageInputs(),
      ...haulageBuildDecisions()
    ]);

    const start = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks. Average distance 2.7 km. Average loaded speed 7 km/h. Average empty speed 11 km/h. Build annual ore hauled VDT.",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, autoApplyPatches: true, maxSteps: 30, maxAutoDepth: 4 }
    }, { provider });

    expect(start.status).toBe("needs_user_input");
    expect(start.pendingQuestions?.map((question) => question.id)).toEqual(["payload_per_trip_t", "operating_hours"]);
    expect(start.draftProject).toBeUndefined();

    const resumed = await runtime.handleMessage(start.runId, {
      type: "user_answer",
      answers: {
        payload_per_trip_t: 40,
        operating_hours: 4000
      }
    }, { provider });

    expect(provider.taskTypes[0]).toBe("orchestrator_first_response");
    expect(provider.taskTypes.slice(1).every((taskType) => taskType === "agent_decision")).toBe(true);
    expect(resumed.status).toBe("succeeded");
    expect(resumed.project).toBeDefined();
    expect(resumed.events.some((event) => event.metadata?.taskType === "agent_plan")).toBe(false);
    expect(resumed.chatMessages.map((message) => message.kind)).toEqual(expect.arrayContaining([
      "instruction",
      "assistant_message",
      "question",
      "answer",
      "final_report"
    ]));
    expect(resumed.chatMessages.find((message) => message.kind === "assistant_message")?.text).toBe(
      "I will use the visible brief as the source of truth before drafting."
    );

    const project = resumed.project!;
    const nodeIds = project.graph.nodes.map((node) => node.id);
    expect(nodeIds).toEqual(expect.arrayContaining([
      "ore_haulage",
      "number_of_trucks",
      "trips_per_truck",
      "payload_per_trip_t",
      "cycle_time_h",
      "haul_distance_km",
      "loaded_speed_kmh",
      "empty_speed_kmh"
    ]));
    expect(project.graph.nodes.find((node) => node.id === "number_of_trucks")?.baselineValue).toBe(5);
    expect(project.graph.nodes.find((node) => node.id === "payload_per_trip_t")?.baselineValue).toBe(40);
    expect(project.graph.nodes.find((node) => node.id === "operating_hours")?.baselineValue).toBe(4000);
    expect(project.graph.nodes.find((node) => node.id === "haul_distance_km")?.baselineValue).toBe(2.7);
    expect(project.graph.nodes.find((node) => node.id === "loaded_speed_kmh")?.baselineValue).toBe(7);
    expect(project.graph.nodes.find((node) => node.id === "empty_speed_kmh")?.baselineValue).toBe(11);
    expect(project.graph.nodes.find((node) => node.id === "ore_haulage")?.formula).toBe(
      "number_of_trucks * trips_per_truck * payload_per_trip_t"
    );
    expect(validateGraph(project).valid).toBe(true);
    const calculation = calculateGraph(project);
    expect(calculation.errors).toEqual([]);
    expect(calculation.rootValue).toBeGreaterThan(0);
    expect(resumed.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "tool_call_started",
      "tool_call_completed",
      "graph_patch",
      "graph_validation",
      "final_report",
      "run_completed"
    ]));
  });

  it("returns tool failures to the model and continues with a repaired formula decision", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Creating draft.",
        args: { projectTitle: "Ore haulage", rootKpi: "Ore haulage", unit: "tonnes/year" }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_driver",
        statusMessage: "Adding cycle time input.",
        args: {
          parentNodeId: "ore_haulage",
          nodeId: "cycle_time_h",
          name: "Cycle time",
          type: "input",
          unit: "h/trip",
          relation: "divisive_driver",
          baselineValue: 0.5
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.set_formula",
        statusMessage: "Trying formula with a wrong reference.",
        args: {
          nodeId: "ore_haulage",
          formula: "cycle_time"
        }
      },
      {
        type: "call_tool",
        toolName: "formula.suggest_reference_repair",
        statusMessage: "Looking for the closest existing reference.",
        args: { missingReference: "cycle_time" }
      },
      {
        type: "call_tool",
        toolName: "vdt.set_formula",
        statusMessage: "Applying repaired formula.",
        args: {
          nodeId: "ore_haulage",
          formula: "cycle_time_h"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.calculate",
        statusMessage: "Calculating repaired graph.",
        args: {}
      },
      {
        type: "finish",
        summary: "Repaired the root formula reference and finished.",
        nextSuggestedActions: []
      }
    ]);

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: { prompt: "Build and repair", rootKpi: "Ore haulage" },
      providerId: "decision-test",
      options: { autoApplyPatches: true, maxSteps: 20 }
    }, { provider });

    expect(snapshot.status).toBe("succeeded");
    const failedSetFormula = snapshot.events.find((event) =>
      event.type === "tool_call_completed" &&
      event.metadata?.toolName === "vdt.set_formula" &&
      event.metadata?.ok === false
    );
    expect(failedSetFormula?.metadata?.code).toBe("MISSING_FORMULA_REFERENCES");
    expect(snapshot.project?.graph.nodes.find((node) => node.id === "ore_haulage")?.formula).toBe("cycle_time_h");
    expect(calculateGraph(snapshot.project!).errors).toEqual([]);
  });

  it("keeps the excavation brief authoritative across first response, free-form answers, and mock haulage defaults", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = scriptedProvider([
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Trying a stale haulage draft.",
        args: {
          projectTitle: "Ore haulage Driver Model",
          rootKpi: "Ore haulage",
          unit: "tonnes/year",
          timePeriod: "year",
          industry: "Mining"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.create_draft",
        statusMessage: "Creating the excavation root.",
        args: {
          projectTitle: "Excavation Driver Model",
          rootKpi: "Excavation",
          unit: "tonnes/year",
          timePeriod: "year",
          industry: "Mining"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_driver",
        statusMessage: "Adding excavator count.",
        args: {
          parentNodeId: "excavation",
          nodeId: "number_of_excavators",
          name: "Number of excavators",
          type: "input",
          unit: "excavators",
          relation: "multiplicative_driver",
          baselineValue: 5
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_driver",
        statusMessage: "Adding bucket capacity.",
        args: {
          parentNodeId: "excavation",
          nodeId: "bucket_capacity_m3",
          name: "Bucket capacity",
          type: "input",
          unit: "m3",
          relation: "multiplicative_driver",
          baselineValue: 6.7
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.add_driver",
        statusMessage: "Adding operating hours.",
        args: {
          parentNodeId: "excavation",
          nodeId: "operating_hours_year",
          name: "Operating hours",
          type: "input",
          unit: "h/year",
          relation: "multiplicative_driver",
          baselineValue: 4200
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.set_formula",
        statusMessage: "Setting excavation formula.",
        args: {
          nodeId: "excavation",
          formula: "number_of_excavators * bucket_capacity_m3 * operating_hours_year"
        }
      },
      {
        type: "call_tool",
        toolName: "vdt.calculate",
        statusMessage: "Calculating excavation draft.",
        args: {}
      },
      {
        type: "finish",
        summary: "Draft ready. Built the excavation-only VDT.",
        nextSuggestedActions: []
      }
    ], {
      assistantMessage: "I will build an excavation VDT in tonnes/year. Should this stay excavation-only, or should haulage also constrain output?",
      nextAction: "ask_user",
      questions: [
        {
          id: "scope",
          question: "Should this model include only excavation/loading, or should truck haulage also constrain output?",
          reason: "Excavation and haulage can be separate bottlenecks.",
          required: true,
          answerKind: "single_choice",
          options: [
            { id: "excavation_only", label: "Excavation only", value: "excavation_only" },
            { id: "include_haulage", label: "Include haulage constraint", value: "include_haulage" }
          ],
          freeTextAllowed: true,
          placeholder: "Example: Excavation only. Use PC1250, bucket 6.7 m3, 4200 hours/year."
        }
      ],
      publicStatus: {
        phase: "asking_questions",
        message: "Waiting for scope confirmation."
      }
    });

    const start = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation model. I have 5 excavators.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "decision-test",
      options: { continueWithAssumptions: false, autoApplyPatches: true, maxSteps: 20 }
    }, { provider });

    expect(start.status).toBe("needs_user_input");
    expect(start.visibleContext.visibleTitle).toBe("Excavation");
    expect(start.chatMessages.map((message) => message.kind)).toEqual(["instruction", "assistant_message", "question"]);
    expect(start.chatMessages.find((message) => message.kind === "assistant_message")?.text).toContain("excavation VDT");
    expect(start.pendingQuestions?.[0]?.freeTextAllowed).toBe(true);

    const resumed = await runtime.handleMessage(start.runId, {
      type: "user_answer",
      answers: {
        scope: "Excavation only. Use PC1250, bucket 6.7 m3, 4200 hours/year."
      }
    }, { provider });

    expect(resumed.status).toBe("succeeded");
    expect(resumed.visibleContext.visibleTitle).toBe("Excavation");
    expect(resumed.project?.name).toBe("Excavation Driver Model");
    const root = resumed.project?.graph.nodes.find((node) => node.id === resumed.project?.rootNodeId);
    expect(root?.name).toBe("Excavation");
    expect(resumed.project?.name).not.toContain("Ore haulage");
    expect(resumed.chatMessages.find((message) => message.kind === "answer")?.text).toContain("PC1250");
    expect(resumed.events.some((event) =>
      event.type === "tool_call_completed" &&
      event.metadata?.code === "VISIBLE_BRIEF_CONFLICT"
    )).toBe(true);
  });

  it("keeps chat and free-form answers when provider execution times out", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = timeoutAfterFirstResponseProvider({
      assistantMessage: "I can build this excavation model, but first confirm the scope.",
      nextAction: "ask_user",
      questions: [
        {
          id: "scope",
          question: "Should this stay excavation-only?",
          reason: "The visible brief is excavation, but haulage is a separate constraint.",
          required: true,
          answerKind: "text",
          freeTextAllowed: true
        }
      ],
      publicStatus: {
        phase: "asking_questions",
        message: "Waiting for your answer."
      }
    });

    const start = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation model. I have 5 excavators.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "timeout-test",
      options: { maxSteps: 5 }
    }, { provider });

    expect(start.status).toBe("needs_user_input");

    const timedOut = await runtime.handleMessage(start.runId, {
      type: "user_answer",
      answers: {
        scope: "Excavation only. Use PC1250, bucket 6.7 m3, 4200 hours/year."
      }
    }, { provider });

    expect(timedOut.status).toBe("needs_user_input");
    expect(timedOut.retryableError).toMatchObject({ code: "TIMEOUT" });
    expect(timedOut.publicStatus.phase).toBe("retryable_error");
    expect(timedOut.chatMessages.find((message) => message.kind === "answer")?.text).toContain("PC1250");
    expect(timedOut.chatMessages.find((message) => message.kind === "retryable_error")?.text).toContain("saved your message");
    expect(timedOut.visibleContext.visibleTitle).toBe("Excavation");
  });

  it("keeps the initial user message visible when the first provider response is not structured JSON", async () => {
    const runtime = createVdtAgentRuntime();
    const provider = firstResponseParseFailureProvider();

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an excavation model. I have 5 excavators.",
        rootKpi: "Excavation",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "parse-failure-test",
      options: { maxSteps: 5 }
    }, { provider });

    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.retryableError).toMatchObject({ code: "STRUCTURED_OUTPUT_FAILED" });
    expect(snapshot.publicStatus).toMatchObject({
      phase: "retryable_error",
      message: expect.stringContaining("unstructured answer")
    });
    expect(snapshot.chatMessages.map((message) => message.kind)).toEqual([
      "instruction",
      "retryable_error"
    ]);
    expect(snapshot.chatMessages[0]?.text).toBe("Build an excavation model. I have 5 excavators.");
    expect(snapshot.chatMessages[1]?.text).toContain("could not use as a structured agent response");
    expect(provider.taskTypes).toEqual(["orchestrator_first_response"]);
  });
});
