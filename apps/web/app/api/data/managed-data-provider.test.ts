import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dataDiscoveryToolNameSchema, runRawDataDiscovery } from "@vdt-studio/data-harness";
import { getRegisteredJsonSchema } from "@vdt-studio/model-bridge";
import { createLocalRuntimeContext } from "@vdt-studio/local-runner/server-runtime";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { createManagedAwareAiProvider } from "../agent/runs/managed-ai-provider";

type RuntimeContext = ReturnType<typeof createLocalRuntimeContext>;
const runtimeGlobal = globalThis as typeof globalThis & { __vdtStudioDevelopmentRuntime?: RuntimeContext };
let temporary: string | undefined;
let previousRuntime: RuntimeContext | undefined;

afterEach(async () => {
  if (previousRuntime) runtimeGlobal.__vdtStudioDevelopmentRuntime = previousRuntime;
  else delete runtimeGlobal.__vdtStudioDevelopmentRuntime;
  vi.unstubAllEnvs();
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("managed data provider canonical runtime integration", () => {
  it("keeps real tool arguments, mapping suggestions and questions through the registered Cursor CLI transport", async () => {
    previousRuntime = runtimeGlobal.__vdtStudioDevelopmentRuntime;
    // A fake executable verifies the actual production transport, not live-provider qualification.
    temporary = await mkdtemp(path.join(os.tmpdir(), "vdt-managed-data-contract-"));
    const executable = path.join(temporary, "fake-data-cursor.cjs");
    await writeFile(executable, String.raw`
const fs = require("node:fs");
if (process.argv.includes("--help")) { process.stdout.write("--trust\n"); process.exit(0); }
const prompt = fs.readFileSync(0, "utf8");
const envelope = JSON.parse(prompt.trim().split(/\r?\n/).at(-1));
const input = envelope.input.data;
let output;
if (envelope.schemaId === "data-agent-decision-v1") {
  const preview = envelope.outputJsonSchema.anyOf.find((branch) => branch.properties.toolName?.enum?.includes("table.preview"));
  if (!preview?.properties.input.properties.tableId) throw new Error("Tool arguments were erased by schema projection.");
  output = input.observations.some((observation) => observation.toolName === "table.preview")
    ? { type: "ask_user", rationale: "The source contains local dates and no complete calendar denominator.", questions: ["Confirm the timezone and full reporting period including days with no events."] }
    : { type: "tool_call", toolName: "table.preview", rationale: "Inspect timestamp examples before choosing date semantics.", input: { tableId: "table_1", limit: 2 } };
} else {
  if (!envelope.outputJsonSchema.properties.incomingKpiOptions) throw new Error("The canonical mapping proposal is missing.");
  output = {
    datasetId: input.datasetId,
    summary: { rowCount: 2, tableCount: 1, likelyDatasetKind: "downtime events", confidence: 0.8, description: "Synthetic event extract." },
    columns: [], metricCandidates: [], assumptions: [], questionsForUser: [], warnings: [],
    incomingKpiOptions: {
      tableId: "table_1", categoryColumns: ["Class", "System", "Reason"],
      duration: { mode: "timestamps", startColumn: "Start", endColumn: "End", format: "dmy", timezoneOffsetMinutes: 300 },
      numberFormat: null, normalization: null, period: null, missingCategoryPolicy: null
    }
  };
}
process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(output) }) + "\n");
`, { mode: 0o700 });
    const receipts: Array<{ backendId: string; taskType: string; schemaValid: boolean }> = [];
    runtimeGlobal.__vdtStudioDevelopmentRuntime = createLocalRuntimeContext({
      auditSink: (event) => receipts.push(event),
      executor: { resolveExecutable: async () => executable, tempRoot: temporary }
    });
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const project = structuredClone(productionVolumeProject);
    project.graph.nodes.find((node) => node.id === "unplanned_downtime")!.unit = "h/day";
    const bytes = new TextEncoder().encode("Class,System,Reason,Start,End\nPlanned,Mechanical,Inspection,01/02/2026 00:00,01/02/2026 02:00\nUnplanned,Electrical,Power loss,03/02/2026 00:00,03/02/2026 01:00");
    const provider = createManagedAwareAiProvider({ providerId: "local_runner", providerConfig: { backendId: "cursor_subscription", timeoutMs: 10_000 } }, "http://localhost:3000/api/data/discovery/runs");
    const snapshot = await runRawDataDiscovery({
      datasetId: "dataset_canonical_transport", bytes, project, provider,
      file: { fileName: "synthetic-downtime.csv", mimeType: "text/csv", sizeBytes: bytes.length, contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, storageRef: "dataset_canonical_transport", uploadedAt: "2026-10-16T00:00:00.000Z" },
      entryContext: { targetNodeId: "unplanned_downtime", purpose: "incoming_kpis" }
    });
    expect(snapshot.incomingKpi?.options).toMatchObject({ categoryColumns: ["Class", "System", "Reason"], duration: { mode: "timestamps", format: "dmy", timezoneOffsetMinutes: 300 } });
    expect(snapshot.incomingKpi?.options).not.toHaveProperty("period");
    expect(snapshot.incomingKpi?.options.confirmed).not.toBe(true);
    expect(snapshot.incomingKpi?.questions).toContainEqual(expect.objectContaining({ field: expect.stringMatching(/^clarificationAnswers\.provider_/), message: "Confirm the timezone and full reporting period including days with no events." }));
    expect(snapshot.observations.find((observation) => observation.toolName === "table.preview")?.input).toEqual({ tableId: "table_1", limit: 2 });
    expect(receipts).toHaveLength(4);
    expect(new Set(receipts.map((receipt) => receipt.taskType))).toEqual(new Set(["data_agent_decision", "analyze_raw_dataset", "review_dataset_proposal"]));
    expect(receipts.every((receipt) => receipt.backendId === "cursor_subscription" && receipt.schemaValid)).toBe(true);
    expect(snapshot.auditLog.filter((entry) => entry.taskType)).toHaveLength(4);
    const branches = getRegisteredJsonSchema("data-agent-decision-v1").anyOf as Array<{ properties: { toolName?: { enum: string[] } } }>;
    expect(new Set(branches.flatMap((branch) => branch.properties.toolName?.enum ?? []))).toEqual(new Set(dataDiscoveryToolNameSchema.options));
    expect((await readdir(temporary)).filter((name) => name.startsWith("vdt-run-"))).toEqual([]);
  }, 30_000);
});
