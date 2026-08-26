import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateBenchmarkRecords,
  assertMetricsOnly,
  benchmarkRunPasses,
  computeFixtureHash,
  createBenchmarkRecordFromSnapshot,
  DEFAULT_FIXTURE_HASH,
  loadBenchmarkFixture,
  loadBenchmarkRecords,
  percentileNearestRank,
  qualifyBenchmarkGroup,
  redactSensitiveText,
  runHttpBenchmark,
  sha256,
  stableStringify,
  validateBenchmarkRecord
} from "./agent-build-benchmark.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function benchmarkRecord({
  sample = "warm",
  ordinal = 1,
  elapsedWallMs = 120_000,
  status = "succeeded",
  failureCodes = [],
  completeTelemetry = true,
  backend = "cursor_subscription"
}: {
  sample?: "cold" | "warm";
  ordinal?: number;
  elapsedWallMs?: number;
  status?: string;
  failureCodes?: string[];
  completeTelemetry?: boolean;
  backend?: string;
} = {}) {
  const success = status === "succeeded";
  return validateBenchmarkRecord({
    schemaVersion: 1,
    recordType: "vdt_agent_build_benchmark_run",
    capturedAt: "2026-08-26T12:00:00.000Z",
    runIdHash: sha256(`${backend}:${sample}:${ordinal}`),
    fixture: {
      id: "ore-hauled-two-fleet",
      version: "1.0.0",
      hash: `sha256:${"a".repeat(64)}`
    },
    sample: { temperature: sample, ordinal },
    execution: {
      profile: "model_agent",
      adapter: "micro_cli_compatibility",
      backend,
      model: "cursor-grok-4.6-medium",
      version: "2026.08.11-e8db854",
      protocolVersion: null,
      toolIsolation: "unverified",
      qualificationStatus: "unverified",
      capabilityEvidenceHash: null,
      capabilityProfileHash: null,
      toolCatalogHash: null
    },
    timing: {
      elapsedWallMs,
      activeWallMs: elapsedWallMs,
      timeToFirstEventMs: 10,
      timeToFirstDurableAgentMessageMs: 2_000,
      modelMs: completeTelemetry ? elapsedWallMs - 10_000 : null,
      toolMs: 3_000,
      gatewayMs: 500,
      persistenceMs: 6_500
    },
    counts: {
      processSpawns: 4,
      logicalSessions: 1,
      resumes: 0,
      modelTurns: 4,
      toolCalls: 6,
      failures: success ? 0 : 1,
      corrections: 0,
      pauses: 0,
      approvals: 0,
      recoveries: 0
    },
    bytes: {
      contextInputBytes: 50_000,
      promptBytes: 55_000,
      streamBytes: 120_000,
      structuredOutputBytes: 4_000,
      toolResultBytes: 8_000,
      finalSnapshotBytes: 200_000,
      httpResponseBytes: 250_000
    },
    outcome: {
      terminalStatus: status,
      valid: success,
      calculable: success,
      formulaBacklogCount: success ? 0 : 1,
      finiteRoot: success,
      topology: {
        nodeCount: 73,
        edgeCount: 72,
        depth: 6,
        rootMatchesFixture: true,
        requiredFleetLabelsPresent: true,
        twoFleetBranchShapeMatches: true,
        matchesFixture: success
      }
    },
    usage: null,
    diagnostics: { failureCodes, correctionCodes: [] },
    provenance: {
      timingSource: "runtime_summary",
      executionIdentitySource: "legacy_request_echo",
      transportMode: "normalized_record",
      completeEventRangeObserved: true,
      derivedFields: []
    }
  });
}

function successfulQualificationRecords() {
  return [
    ...Array.from({ length: 3 }, (_value, index) => benchmarkRecord({
      sample: "cold",
      ordinal: index + 1,
      elapsedWallMs: 200_000 + index * 1_000
    })),
    ...Array.from({ length: 20 }, (_value, index) => benchmarkRecord({
      sample: "warm",
      ordinal: index + 1,
      elapsedWallMs: 100_000 + index * 1_000
    }))
  ];
}

function fixedProject() {
  const timestamp = "2026-08-26T00:00:00.000Z";
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  const addNode = (id: string, name: string, type: "root_kpi" | "calculated" | "input", formula?: string) => {
    nodes.push({
      id,
      name,
      type,
      status: "ai_suggested",
      unit: "tonnes/year",
      ...(formula ? { formula } : {}),
      ...(type === "input" ? { baselineValue: 1 } : {}),
      aiGenerated: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  };
  const addEdge = (sourceNodeId: string, targetNodeId: string) => {
    edges.push({
      id: `edge_${sourceNodeId}_${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      relation: "additive_component",
      aiGenerated: true
    });
  };

  addNode("ore_hauled_2", "Ore hauled 2", "root_kpi", "belaz_75131 + cat_793d");
  for (const fleet of ["belaz_75131", "cat_793d"]) {
    const fleetName = fleet === "belaz_75131" ? "BelAZ-75131 fleet" : "CAT 793D fleet";
    addNode(fleet, fleetName, "calculated", `${fleet}_level_2`);
    addEdge("ore_hauled_2", fleet);
    for (let depth = 2; depth <= 4; depth += 1) {
      const id = `${fleet}_level_${depth}`;
      const nextId = `${fleet}_level_${depth + 1}`;
      addNode(id, `${fleetName} level ${depth}`, "calculated", nextId);
      addEdge(depth === 2 ? fleet : `${fleet}_level_${depth - 1}`, id);
    }
    const parentId = `${fleet}_level_5`;
    const leafIds = Array.from({ length: 31 }, (_value, index) => `${fleet}_input_${index + 1}`);
    addNode(parentId, `${fleetName} level 5`, "calculated", leafIds.join(" + "));
    addEdge(`${fleet}_level_4`, parentId);
    for (const leafId of leafIds) {
      addNode(leafId, `${fleetName} input`, "input");
      addEdge(parentId, leafId);
    }
  }

  return {
    id: "benchmark_project_ore_hauled_2",
    name: "Ore hauled 2",
    rootNodeId: "ore_hauled_2",
    graph: { nodes, edges },
    scenarios: [],
    dataSources: [],
    aiSettings: { defaultProviderId: "test" },
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function successfulSnapshot() {
  return {
    runId: "benchmark-run-1",
    status: "succeeded",
    request: {
      providerId: "local_runner",
      providerConfig: {
        backendId: "cursor_subscription",
        model: "cursor-grok-4.6-medium"
      }
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:02:00.000Z",
    project: fixedProject(),
    events: [
      {
        seq: 1,
        type: "run_started",
        timestamp: "2026-08-26T00:00:00.010Z",
        metadata: {}
      },
      {
        seq: 2,
        type: "assistant_message",
        timestamp: "2026-08-26T00:00:02.000Z",
        metadata: {}
      },
      {
        seq: 3,
        type: "tool_call_started",
        timestamp: "2026-08-26T00:00:03.000Z",
        metadata: { taskType: "agent_decision" }
      },
      {
        seq: 4,
        type: "tool_call_completed",
        timestamp: "2026-08-26T00:01:45.000Z",
        metadata: { taskType: "agent_decision" }
      },
      {
        seq: 5,
        type: "run_completed",
        timestamp: "2026-08-26T00:02:00.000Z",
        metadata: {}
      }
    ],
    performanceSummary: {
      wallClockMs: 110_000,
      activeWallMs: 120_000,
      modelMs: 102_000,
      toolMs: 3_000,
      gatewayMs: 500,
      persistenceMs: 14_500,
      processSpawnCount: 1,
      logicalSessionCount: 1,
      resumeCount: 0,
      llmDecisionCount: 1,
      toolCallCount: 1,
      contextInputBytes: 40_000,
      promptBytes: 45_000,
      streamBytes: 60_000,
      outputBytes: 2_000,
      toolResultBytes: 4_000,
      repairCount: 0,
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 8_000,
        outputTokens: 2_000,
        totalTokens: 12_000
      }
    }
  };
}

function externalExecutionSummary() {
  return {
    schemaVersion: 2,
    executionProfile: "external_cli_agent",
    engineId: "cursor-agent",
    engineAdapterId: "cursor_acp",
    backendId: "cursor_subscription",
    modelId: "cursor-grok-4.6-medium",
    cliVersion: "2026.08.11-e8db854",
    protocolVersion: "acp-0.12",
    toolIsolation: "hard_verified",
    qualificationStatus: "qualified",
    capabilityEvidenceHash: `sha256:${"e".repeat(64)}`,
    capabilityProfileHash: `sha256:${"c".repeat(64)}`,
    toolCatalogHash: `sha256:${"d".repeat(64)}`,
    sessionStatus: "closed",
    recoveryStatus: "complete",
    sessionEpoch: 1,
    externalSessionBound: true,
    lastCheckpointId: "checkpoint-1",
    pendingOperation: null,
    finishState: "final_persisted",
    boundAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:02:00.000Z"
  };
}

describe("agent build benchmark metrics", () => {
  it("hashes the fixed Ore hauled fixture canonically", async () => {
    const fixture = await loadBenchmarkFixture();
    const reordered = JSON.parse(stableStringify(fixture));

    expect(fixture.id).toBe("ore-hauled-two-fleet");
    expect(fixture.startRequest.mode).toBe("continue_project");
    expect(fixture.acceptance).toMatchObject({ nodeCount: 73, edgeCount: 72, depth: 6 });
    expect(computeFixtureHash(fixture)).toBe(DEFAULT_FIXTURE_HASH);
    expect(computeFixtureHash(reordered)).toBe(computeFixtureHash(fixture));
  });

  it("uses nearest-rank p50 and p95 and qualifies 3 cold plus 20 warm runs", () => {
    expect(percentileNearestRank(Array.from({ length: 20 }, (_value, index) => index + 1), 0.5)).toBe(10);
    expect(percentileNearestRank(Array.from({ length: 20 }, (_value, index) => index + 1), 0.95)).toBe(19);

    const qualification = qualifyBenchmarkGroup(successfulQualificationRecords());
    expect(qualification).toMatchObject({
      qualified: true,
      coldCompleted: 3,
      coldPassed: 3,
      warmCompleted: 20,
      warmPassed: 20,
      warmP95ElapsedWallMs: 118_000,
      warmMedianElapsedWallMs: 109_000,
      stretchTargetMet: true
    });
    const duplicate = benchmarkRecord({ sample: "cold", ordinal: 1 });
    expect(() => qualifyBenchmarkGroup([duplicate, duplicate])).toThrow(/cannot reuse/);
  });

  it("fails qualification for insufficient samples, incomplete telemetry, known failures, or p95 regression", () => {
    const incomplete = qualifyBenchmarkGroup([
      benchmarkRecord({ sample: "cold", ordinal: 1, completeTelemetry: false }),
      benchmarkRecord({ sample: "warm", ordinal: 1, failureCodes: ["MAX_STEPS_EXCEEDED"], elapsedWallMs: 500_000 })
    ]);

    expect(incomplete.qualified).toBe(false);
    expect(incomplete.reasons).toEqual(expect.arrayContaining([
      "COLD_SAMPLE_COUNT_LT_3",
      "WARM_SAMPLE_COUNT_LT_20",
      "WARM_FUNCTIONAL_FAILURE",
      "TELEMETRY_INCOMPLETE"
    ]));

    const slow = successfulQualificationRecords().map((record) =>
      record.sample.temperature === "warm" && record.sample.ordinal >= 19
        ? benchmarkRecord({ sample: "warm", ordinal: record.sample.ordinal, elapsedWallMs: 500_000 })
        : record
    );
    expect(qualifyBenchmarkGroup(slow).reasons).toContain("WARM_P95_OVER_WALL_TARGET");

    const multiSession = benchmarkRecord({ sample: "cold", ordinal: 1 });
    multiSession.counts.logicalSessions = 23;
    expect(benchmarkRunPasses(multiSession)).toBe(false);
    expect(qualifyBenchmarkGroup([multiSession]).reasons).toContain("LOGICAL_SESSION_COUNT_NOT_1");
  });

  it("aggregates execution groups without mixing backend identities", () => {
    const records = successfulQualificationRecords();
    records.push(benchmarkRecord({ backend: "openai_http", sample: "warm", ordinal: 1 }));
    const report = aggregateBenchmarkRecords(records, { generatedAt: "2026-08-26T13:00:00.000Z" });

    expect(report.recordCount).toBe(24);
    expect(report.groups).toHaveLength(2);
    expect(report.groups.find((group) => group.execution.backend === "cursor_subscription")?.qualification.qualified).toBe(true);
    expect(report.groups.find((group) => group.execution.backend === "openai_http")?.qualification.reasons).toContain(
      "COLD_SAMPLE_COUNT_LT_3"
    );
  });

  it("rejects raw prompts and secrets while providing safe diagnostic redaction", () => {
    expect(() => assertMetricsOnly({ rawPrompt: "build a tree" })).toThrow(/not allowed/);
    expect(() => assertMetricsOnly({ note: "Bearer very-secret-token-value" })).toThrow(/Sensitive value/);
    expect(redactSensitiveText("failed with api_key=top-secret-value")).toBe("failed with [REDACTED]");
  });

  it("derives a strict metrics-only record and validates the fixed topology with vdt-core", async () => {
    const fixture = await loadBenchmarkFixture();
    const snapshot: any = successfulSnapshot();
    snapshot.executionSummary = externalExecutionSummary();
    const record = createBenchmarkRecordFromSnapshot({
      snapshot,
      fixture,
      execution: {
        profile: "external_cli_agent",
        adapter: "cursor_acp",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "cold", ordinal: 1 },
      observedAt: "2026-08-26T00:02:00.000Z",
      httpResponseBytes: 400_000
    });

    expect(record.timing).toMatchObject({
      elapsedWallMs: 120_000,
      timeToFirstEventMs: 10,
      timeToFirstDurableAgentMessageMs: 2_000,
      modelMs: 102_000
    });
    expect(record.outcome).toMatchObject({
      valid: true,
      calculable: true,
      formulaBacklogCount: 0,
      finiteRoot: true,
      topology: {
        nodeCount: 73,
        edgeCount: 72,
        depth: 6,
        requiredFleetLabelsPresent: true,
        twoFleetBranchShapeMatches: true,
        matchesFixture: true
      }
    });
    expect(record.usage).toEqual({ inputTokens: 10_000, cachedInputTokens: 8_000, outputTokens: 2_000, totalTokens: 12_000 });
    expect(record.provenance.executionIdentitySource).toBe("runtime_binding_evidence");
    expect(benchmarkRunPasses(record)).toBe(true);
    expect(JSON.stringify(record)).not.toContain('"prompt":');
    expect(JSON.stringify(record)).not.toContain("Ore hauled 2");

    expect(() => createBenchmarkRecordFromSnapshot({
      snapshot,
      fixture,
      execution: {
        profile: "model_agent",
        adapter: "micro_cli_compatibility",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "cold", ordinal: 2 }
    })).toThrow(/execution identity/);

    const unverifiedSnapshot: any = successfulSnapshot();
    unverifiedSnapshot.executionSummary = externalExecutionSummary();
    delete unverifiedSnapshot.executionSummary.capabilityEvidenceHash;
    expect(() => createBenchmarkRecordFromSnapshot({
      snapshot: unverifiedSnapshot,
      fixture,
      execution: {
        profile: "external_cli_agent",
        adapter: "cursor_acp",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "cold", ordinal: 3 }
    })).toThrow(/server-binding executionSummary evidence/);

    const spoofedSnapshot: any = successfulSnapshot();
    spoofedSnapshot.benchmarkExecutionIdentity = externalExecutionSummary();
    expect(() => createBenchmarkRecordFromSnapshot({
      snapshot: spoofedSnapshot,
      fixture,
      execution: {
        profile: "external_cli_agent",
        adapter: "cursor_acp",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "cold", ordinal: 4 }
    })).toThrow(/runtime executionSummary/);
  });

  it("rejects an unrelated 73-node graph even when labels, edge count, and depth match", async () => {
    const fixture = await loadBenchmarkFixture();
    const snapshot: any = successfulSnapshot();
    const movedEdge = snapshot.project.graph.edges.find((edge) => edge.targetNodeId === "cat_793d_input_31");
    if (!movedEdge) throw new Error("test fixture edge missing");
    movedEdge.sourceNodeId = "belaz_75131_level_5";
    movedEdge.id = "edge_belaz_75131_level_5_cat_793d_input_31";

    const record = createBenchmarkRecordFromSnapshot({
      snapshot,
      fixture,
      execution: {
        profile: "model_agent",
        adapter: "micro_cli_compatibility",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "warm", ordinal: 1 },
      transportMode: "legacy_provider_config"
    });

    expect(record.outcome.topology).toMatchObject({
      nodeCount: 73,
      edgeCount: 72,
      depth: 6,
      requiredFleetLabelsPresent: true,
      twoFleetBranchShapeMatches: false,
      matchesFixture: false
    });
    expect(benchmarkRunPasses(record)).toBe(false);
  });

  it("requires the exact root id and root_kpi type", async () => {
    const fixture = await loadBenchmarkFixture();
    const snapshot: any = successfulSnapshot();
    const root = snapshot.project.graph.nodes.find((node) => node.id === "ore_hauled_2");
    if (!root) throw new Error("test fixture root missing");
    root.id = "wrong_root";
    snapshot.project.rootNodeId = "wrong_root";
    for (const edge of snapshot.project.graph.edges) {
      if (edge.sourceNodeId === "ore_hauled_2") edge.sourceNodeId = "wrong_root";
    }

    const record = createBenchmarkRecordFromSnapshot({
      snapshot,
      fixture,
      execution: {
        profile: "model_agent",
        adapter: "micro_cli_compatibility",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "warm", ordinal: 2 },
      transportMode: "legacy_provider_config"
    });

    expect(record.outcome.valid).toBe(true);
    expect(record.outcome.calculable).toBe(true);
    expect(record.outcome.topology.rootMatchesFixture).toBe(false);
    expect(record.outcome.topology.matchesFixture).toBe(false);
    expect(benchmarkRunPasses(record)).toBe(false);
  });

  it("does not infer zero pauses or recoveries from a truncated event range", async () => {
    const fixture = await loadBenchmarkFixture();
    const snapshot: any = successfulSnapshot();
    snapshot.events = snapshot.events.slice(1);

    const record = createBenchmarkRecordFromSnapshot({
      snapshot,
      fixture,
      execution: {
        profile: "model_agent",
        adapter: "micro_cli_compatibility",
        backend: "cursor_subscription",
        model: "cursor-grok-4.6-medium",
        version: "2026.08.11-e8db854"
      },
      sample: { temperature: "warm", ordinal: 3 },
      transportMode: "legacy_provider_config"
    });

    expect(record.provenance.completeEventRangeObserved).toBe(false);
    expect(record.counts).toMatchObject({ failures: null, pauses: null, approvals: null, recoveries: null });
    expect(benchmarkRunPasses(record)).toBe(false);
  });

  it("invokes the loopback agent-run endpoint and returns only normalized metrics", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      { ok: true, runId: "benchmark-run-1", snapshot: { runId: "benchmark-run-1", status: "running" } },
      { ok: true, snapshot: successfulSnapshot() }
    ];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const body = JSON.stringify(responses.shift());
      return {
        ok: true,
        status: 200,
        text: async () => body
      } as Response;
    };

    const record = await runHttpBenchmark({
      baseUrl: "http://127.0.0.1:3000",
      bindingId: "local_runner",
      backend: "cursor_subscription",
      model: "cursor-grok-4.6-medium",
      version: "2026.08.11-e8db854",
      profile: "model_agent",
      adapter: "micro_cli_compatibility",
      sampleTemperature: "cold",
      sampleOrdinal: 1,
      pollIntervalMs: 0,
      legacyBaseline: true,
      fetchImpl,
      now: () => "2026-08-26T00:02:00.000Z"
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe("http://127.0.0.1:3000/api/agent/runs");
    const startBody = JSON.parse(String(requests[0]?.init?.body));
    expect(startBody).toMatchObject({
      mode: "continue_project",
      providerId: "local_runner",
      providerConfig: { backendId: "cursor_subscription", model: "cursor-grok-4.6-medium" }
    });
    expect(startBody).not.toHaveProperty("executionBindingId");
    expect(startBody.input.prompt).toContain("BelAZ-75131");
    expect(record.execution.adapter).toBe("micro_cli_compatibility");
    expect(record.provenance.transportMode).toBe("legacy_provider_config");
    expect(record.counts.processSpawns).toBe(1);
    expect(JSON.stringify(record)).not.toContain("BelAZ-75131");
  });

  it("uses binding-only target HTTP mode and requires runtime capability evidence", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const snapshot: any = successfulSnapshot();
    snapshot.executionSummary = externalExecutionSummary();
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, runId: snapshot.runId, snapshot })
      } as Response;
    };

    const record = await runHttpBenchmark({
      baseUrl: "http://127.0.0.1:3000",
      bindingId: "cursor_agent_binding",
      backend: "cursor_subscription",
      model: "cursor-grok-4.6-medium",
      version: "2026.08.11-e8db854",
      profile: "external_cli_agent",
      adapter: "cursor_acp",
      sampleTemperature: "cold",
      sampleOrdinal: 1,
      fetchImpl
    });

    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body.executionBindingId).toBe("cursor_agent_binding");
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("providerConfig");
    expect(record.execution.capabilityEvidenceHash).toBe(`sha256:${"e".repeat(64)}`);
    expect(record.provenance).toMatchObject({
      transportMode: "target_binding",
      executionIdentitySource: "runtime_binding_evidence"
    });
    expect(benchmarkRunPasses(record)).toBe(true);
  });

  it("uses protocolVersion as the server-owned Model Agent version when cliVersion is null", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const snapshot: any = successfulSnapshot();
    snapshot.executionSummary = {
      ...externalExecutionSummary(),
      executionProfile: "model_agent",
      engineId: "in-product-model-agent",
      engineAdapterId: "structured_turn_v1",
      backendId: "openai_http",
      modelId: "model-1",
      protocolVersion: "model-turn.v1",
      cliVersion: null,
      externalSessionBound: false
    };
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, runId: snapshot.runId, snapshot })
      } as Response;
    };

    const record = await runHttpBenchmark({
      baseUrl: "http://127.0.0.1:3000",
      bindingId: "model_agent_binding",
      backend: "openai_http",
      model: "model-1",
      version: "model-turn.v1",
      profile: "model_agent",
      adapter: "structured_turn_v1",
      sampleTemperature: "warm",
      sampleOrdinal: 1,
      fetchImpl
    });

    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({ executionBindingId: "model_agent_binding" });
    expect(body).not.toHaveProperty("providerId");
    expect(body).not.toHaveProperty("providerConfig");
    expect(record.execution).toMatchObject({
      profile: "model_agent",
      version: "model-turn.v1",
      protocolVersion: "model-turn.v1"
    });
    expect(record.provenance.executionIdentitySource).toBe("runtime_binding_evidence");
    expect(benchmarkRunPasses(record)).toBe(true);
  });

  it("aborts a stalled HTTP request at the whole-run deadline", async () => {
    const hangingFetch = async (_url: string | URL | Request, _init?: RequestInit) =>
      new Promise<Response>(() => undefined);

    await expect(runHttpBenchmark({
      baseUrl: "http://127.0.0.1:3000",
      bindingId: "cursor_agent_binding",
      backend: "cursor_subscription",
      model: "cursor-grok-4.6-medium",
      version: "2026.08.11-e8db854",
      profile: "external_cli_agent",
      adapter: "cursor_acp",
      sampleTemperature: "cold",
      sampleOrdinal: 1,
      deadlineMs: 50,
      fetchImpl: hangingFetch
    })).rejects.toThrow(/start request exceeded the benchmark deadline/i);
  });

  it("bounds a stalled poll and issues a separately bounded cancellation", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, _init?: RequestInit) => {
      const value = String(url);
      urls.push(value);
      if (value.endsWith("/cancel")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, snapshot: { status: "cancelled" } })
        } as Response;
      }
      if (value.endsWith("/api/agent/runs")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            runId: "benchmark-run-1",
            snapshot: { runId: "benchmark-run-1", status: "running" }
          })
        } as Response;
      }
      return new Promise<Response>(() => undefined);
    };

    await expect(runHttpBenchmark({
      baseUrl: "http://127.0.0.1:3000",
      bindingId: "cursor_agent_binding",
      backend: "cursor_subscription",
      model: "cursor-grok-4.6-medium",
      version: "2026.08.11-e8db854",
      profile: "external_cli_agent",
      adapter: "cursor_acp",
      sampleTemperature: "cold",
      sampleOrdinal: 1,
      deadlineMs: 50,
      pollIntervalMs: 0,
      fetchImpl
    })).rejects.toThrow(/poll request exceeded the benchmark deadline/i);
    expect(urls.some((url) => url.endsWith("/cancel"))).toBe(true);
  });

  it("ingests normalized JSON but rejects snapshot-shaped result files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-agent-benchmark-test-"));
    tempDirs.push(dir);
    const recordPath = path.join(dir, "record.json");
    const unsafePath = path.join(dir, "unsafe.json");
    await writeFile(recordPath, JSON.stringify(benchmarkRecord()));
    await writeFile(unsafePath, JSON.stringify({ snapshot: { request: { input: { prompt: "secret business brief" } } } }));

    await expect(loadBenchmarkRecords([recordPath])).resolves.toHaveLength(1);
    await expect(loadBenchmarkRecords([unsafePath])).rejects.toThrow(/not allowed/);
  });
});
