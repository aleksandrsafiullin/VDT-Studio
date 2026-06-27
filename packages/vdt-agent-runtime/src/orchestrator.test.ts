import { describe, expect, it } from "vitest";
import { createVdtAgentRuntime, type AgentPlanningProvider } from "./orchestrator";

function truckPlan(missingInputs: boolean) {
  return {
    buildIntent: {
      rootKpi: "Ore haulage",
      industry: "Mining",
      businessContext: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
      unit: "tonnes/year",
      timePeriod: "year",
      goal: "Build a truck haulage VDT from the provided fleet and route inputs."
    },
    selectedSkillIds: ["mining.haulage_truck_cycle"],
    skillRationale: "Truck count, haul distance, loaded speed, and empty speed match the haulage truck cycle skill.",
    extractedInputs: [
      { id: "number_of_trucks", label: "Number of trucks", value: 5, unit: "trucks", sourceText: "I have 5 trucks" },
      { id: "haul_distance_km", label: "Average haul distance", value: 2.7, unit: "km", sourceText: "Average distance 2.7 km" },
      { id: "loaded_speed_kmh", label: "Average loaded speed", value: 7, unit: "km/h", sourceText: "Average load speed - 7 km/h" },
      { id: "empty_speed_kmh", label: "Average empty speed", value: 11, unit: "km/h", sourceText: "Average empty speed - 11 km/h" }
    ],
    missingInputs: missingInputs
      ? [
          {
            id: "payload_per_trip_t",
            question: "What is the average payload per truck trip in tonnes?",
            reason: "Truck haulage tonnes require payload per trip.",
            required: true
          }
        ]
      : [],
    driverPlan: [
      {
        id: "number_of_trucks",
        parentNodeId: "root",
        name: "Number of trucks",
        type: "input",
        unit: "trucks",
        relation: "multiplicative_driver",
        formula: "",
        description: "Active haul trucks in the fleet.",
        value: 5,
        assumptions: []
      },
      {
        id: "trips_per_truck",
        parentNodeId: "root",
        name: "Trips per truck",
        type: "calculated",
        unit: "trips/truck/year",
        relation: "multiplicative_driver",
        formula: "trips_per_truck = operating_hours / cycle_time_h",
        description: "Completed haulage cycles per truck.",
        value: "",
        assumptions: []
      },
      {
        id: "payload_per_trip_t",
        parentNodeId: "root",
        name: "Payload per trip",
        type: "input",
        unit: "tonnes/trip",
        relation: "multiplicative_driver",
        formula: "",
        description: "Payload carried per truck cycle.",
        value: missingInputs ? "" : "40 tonnes",
        assumptions: []
      },
      {
        id: "operating_hours",
        parentNodeId: "trips_per_truck",
        name: "Operating hours",
        type: "input",
        unit: "hours/year",
        relation: "formula_dependency",
        formula: "",
        description: "Operating hours in the year.",
        value: missingInputs ? "" : "4000 hours/year",
        assumptions: []
      },
      {
        id: "cycle_time_h",
        parentNodeId: "trips_per_truck",
        name: "Cycle time",
        type: "calculated",
        unit: "hours/trip",
        relation: "divisive_driver",
        formula: "loaded_travel_time_h + empty_return_time_h",
        description: "Travel-only truck cycle time.",
        value: "",
        assumptions: []
      },
      {
        id: "loaded_travel_time_h",
        parentNodeId: "cycle_time_h",
        name: "Loaded travel time",
        type: "calculated",
        unit: "hours/trip",
        relation: "additive_component",
        formula: "haul_distance_km / loaded_speed_kmh",
        description: "Loaded travel duration.",
        value: "",
        assumptions: []
      },
      {
        id: "empty_return_time_h",
        parentNodeId: "cycle_time_h",
        name: "Empty return time",
        type: "calculated",
        unit: "hours/trip",
        relation: "additive_component",
        formula: "haul_distance_km / empty_speed_kmh",
        description: "Empty return duration.",
        value: "",
        assumptions: []
      },
      {
        id: "haul_distance_km",
        parentNodeId: "loaded_travel_time_h",
        name: "Average haul distance",
        type: "input",
        unit: "km",
        relation: "formula_dependency",
        formula: "",
        description: "Average one-way route distance.",
        value: 2.7,
        assumptions: []
      },
      {
        id: "loaded_speed_kmh",
        parentNodeId: "loaded_travel_time_h",
        name: "Average loaded speed",
        type: "input",
        unit: "km/h",
        relation: "formula_dependency",
        formula: "",
        description: "Average loaded truck speed.",
        value: 7,
        assumptions: []
      },
      {
        id: "empty_speed_kmh",
        parentNodeId: "empty_return_time_h",
        name: "Average empty speed",
        type: "input",
        unit: "km/h",
        relation: "formula_dependency",
        formula: "",
        description: "Average empty return speed.",
        value: 11,
        assumptions: []
      }
    ],
    rootFormula: "ore_haulage = number_of_trucks * trips_per_truck * payload_per_trip_t",
    assumptions: ["Return distance equals loaded haul distance until specified otherwise."],
    questionsForUser: missingInputs ? ["What is payload per trip?"] : [],
    warnings: [],
    confidence: 0.92
  };
}

function provider(): AgentPlanningProvider & { calls: number } {
  return {
    id: "planner-test",
    calls: 0,
    async completeStructured(_params) {
      this.calls += 1;
      return truckPlan(this.calls === 1) as never;
    }
  };
}

describe("VdtAgentRuntime", { timeout: 15_000 }, () => {
  it("uses the AI planner to select skills and ask for missing data before building", async () => {
    const runtime = createVdtAgentRuntime();
    const planner = provider();

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: false }
    }, { provider: planner });

    expect(planner.calls).toBe(1);
    expect(snapshot.status).toBe("needs_user_input");
    expect(snapshot.selectedSkills.map((skill) => skill.id)).toEqual(["mining.haulage_truck_cycle"]);
    expect(snapshot.pendingQuestions?.map((question) => question.id)).toContain("payload_per_trip_t");
    expect(snapshot.draftProject).toBeUndefined();
    expect(snapshot.events.find((event) => event.type === "clarifying_questions")?.metadata).toMatchObject({
      providerWasCalled: true
    });
  });

  it("resumes after answers and builds a VDT from the AI planner driver plan", async () => {
    const runtime = createVdtAgentRuntime();
    const planner = provider();
    const start = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: false }
    }, { provider: planner });

    const resumed = await runtime.handleMessage(start.runId, {
      type: "user_answer",
      answers: {
        payload_per_trip_t: "40 tonnes",
        operating_hours: "4000 hours/year"
      }
    }, { provider: planner });

    expect(planner.calls).toBe(2);
    expect(resumed.status).toBe("succeeded");
    const nodes = resumed.draftProject?.graph.nodes ?? [];
    expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      "ore_haulage",
      "number_of_trucks",
      "trips_per_truck",
      "payload_per_trip_t",
      "haul_distance_km",
      "loaded_speed_kmh",
      "empty_speed_kmh"
    ]));
    expect(nodes.find((node) => node.id === "number_of_trucks")?.baselineValue).toBe(5);
    expect(nodes.find((node) => node.id === "payload_per_trip_t")?.baselineValue).toBe(40);
    expect(nodes.find((node) => node.id === "operating_hours")?.baselineValue).toBe(4000);
    expect(nodes.find((node) => node.id === "haul_distance_km")?.baselineValue).toBe(2.7);
    expect(nodes.find((node) => node.id === "loaded_speed_kmh")?.baselineValue).toBe(7);
    expect(nodes.find((node) => node.id === "empty_speed_kmh")?.baselineValue).toBe(11);
    expect(nodes.find((node) => node.id === "ore_haulage")?.formula).toBe(
      "number_of_trucks * trips_per_truck * payload_per_trip_t"
    );
    expect(nodes.find((node) => node.id === "trips_per_truck")?.formula).toBe("operating_hours / cycle_time_h");
    expect(resumed.finalReport).toContain("Selected skills: mining.haulage_truck_cycle");
    expect(resumed.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "tool_call_started",
      "tool_call_completed",
      "user_answer_received",
      "graph_patch",
      "graph_validation",
      "final_report",
      "run_completed"
    ]));
  });

  it("returns a failed snapshot instead of leaving the run stuck when the build plan is invalid", async () => {
    const runtime = createVdtAgentRuntime();
    const invalidPlan = {
      ...truckPlan(false),
      driverPlan: [
        {
          id: "orphan_driver",
          parentNodeId: "missing_parent",
          name: "Orphan driver",
          type: "input",
          unit: "units",
          relation: "positive_driver",
          formula: "",
          description: "Invalid parent should fail the build.",
          value: 1,
          assumptions: []
        }
      ]
    };

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build an invalid VDT",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: true }
    }, {
      provider: {
        id: "planner-test",
        completeStructured: async () => invalidPlan as never
      }
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error?.message).toContain("unresolved parents");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining(["error", "run_completed"]));
  });

  it("returns a failed snapshot instead of a 500 when the AI planner returns an invalid formula", async () => {
    const runtime = createVdtAgentRuntime();
    const invalidFormulaPlan = {
      ...truckPlan(false),
      driverPlan: truckPlan(false).driverPlan.map((driver) => driver.id === "trips_per_truck"
        ? { ...driver, formula: "trips_per_truck = operating_hours /" }
        : driver)
    };

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a haulage VDT with an invalid model formula",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: true }
    }, {
      provider: {
        id: "planner-test",
        completeStructured: async () => invalidFormulaPlan as never
      }
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error?.message).toContain("Expected a number, reference, or parenthesized expression");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining(["error", "run_completed"]));
  });

  it("fails instead of silently succeeding when the root formula references missing model nodes", async () => {
    const runtime = createVdtAgentRuntime();
    const missingReferencePlan = {
      ...truckPlan(false),
      rootFormula: "ore_haulage = missing_driver * payload_per_trip_t"
    };

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a haulage VDT with a missing root formula reference",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: true }
    }, {
      provider: {
        id: "planner-test",
        completeStructured: async () => missingReferencePlan as never
      }
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error?.message).toContain("missing_driver");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining(["error", "run_completed"]));
  });

  it("fails instead of succeeding when validation finds missing formula references", async () => {
    const runtime = createVdtAgentRuntime();
    const missingFormulaReferencePlan = {
      ...truckPlan(false),
      driverPlan: truckPlan(false).driverPlan.map((driver) => driver.id === "trips_per_truck"
        ? { ...driver, formula: "operating_hours / missing_cycle_time" }
        : driver)
    };

    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "Build a haulage VDT with a validation error",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: true }
    }, {
      provider: {
        id: "planner-test",
        completeStructured: async () => missingFormulaReferencePlan as never
      }
    });

    expect(snapshot.status).toBe("failed");
    expect(snapshot.error?.message).toContain("invalid VDT graph");
    expect(snapshot.events.map((event) => event.type)).toEqual(expect.arrayContaining(["error", "run_completed"]));
  });

  it("records manual project changes as run context", async () => {
    const runtime = createVdtAgentRuntime();
    const snapshot = await runtime.startRun({
      mode: "generate_vdt",
      input: {
        prompt: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
        rootKpi: "Ore haulage",
        unit: "tonnes/year",
        timePeriod: "year"
      },
      providerId: "planner-test",
      options: { continueWithAssumptions: true }
    }, { provider: { ...provider(), completeStructured: async () => truckPlan(false) as never } });

    const afterEdit = await runtime.handleMessage(snapshot.runId, {
      type: "manual_project_change",
      projectRevision: 1,
      change: {
        kind: "node_updated",
        nodeId: "ore_haulage",
        patch: { name: "Renamed output" }
      }
    });

    expect(afterEdit.events.at(-1)?.type).toBe("manual_change_observed");
    expect(afterEdit.draftProject?.graph.nodes.find((node) => node.id === "ore_haulage")?.name).toBe("Renamed output");
  });
});
