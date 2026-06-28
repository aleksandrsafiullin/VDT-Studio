import { describe, expect, it } from "vitest";
import { calculateGraph, validateGraph } from "@vdt-studio/vdt-core";
import {
  createVdtAgentRuntime,
  type AgentDecisionProvider
} from "./orchestrator";
import type { AgentDecision } from "./schemas/agent-decision";
import type { FirstResponseOutput } from "./schemas/agent-first-response";

function scriptedProvider(
  decisions: AgentDecision[],
  firstResponse: FirstResponseOutput = {
    assistantMessage: "I will use the visible brief as the source of truth before drafting.",
    nextAction: "continue_building",
    questions: [],
    publicStatus: {
      phase: "planning_model",
      message: "Planning the VDT from your request."
    }
  }
): AgentDecisionProvider & { calls: number; taskTypes: string[] } {
  return {
    id: "decision-test",
    calls: 0,
    taskTypes: [],
    async completeStructured(params) {
      this.calls += 1;
      this.taskTypes.push(params.taskType);
      if (params.taskType === "orchestrator_first_response") {
        return firstResponse as never;
      }
      const decision = decisions.shift();
      if (!decision) throw new Error("Scripted provider ran out of decisions.");
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
        relation: "multiplicative_driver",
        formula: "operating_hours / cycle_time_h"
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
        relation: "divisive_driver",
        formula: "loaded_travel_time_h + empty_return_time_h"
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
        relation: "additive_component",
        formula: "haul_distance_km / loaded_speed_kmh"
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
        relation: "additive_component",
        formula: "haul_distance_km / empty_speed_kmh"
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
      options: { continueWithAssumptions: false, maxSteps: 30 }
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
      options: { maxSteps: 20 }
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
      options: { continueWithAssumptions: false, maxSteps: 20 }
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
