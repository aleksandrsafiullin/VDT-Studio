import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { productionVolumeProject } from "../packages/vdt-core/src/examples/production-volume.ts";
import { runAiTask } from "../packages/ai-harness/src/tasks/run-ai-task.ts";
import { MockProvider } from "../packages/ai-harness/src/providers/mock-provider.ts";
import {
  VDT_OUTPUT_SCHEMA_IDS,
  schemaIdForTask,
  schemaTasks
} from "../packages/model-bridge/src/schema-registry.ts";
import {
  ALL_VDT_TASK_TYPES,
  ALL_VDT_SCHEMA_IDS,
  BUILTIN_BACKEND_MANIFESTS
} from "../packages/local-runner/src/server/manifests.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), "..");

export const CANONICAL_TASK_TYPES = [
  "generate_tree",
  "deepen_node",
  "simplify_branch",
  "suggest_alternative",
  "suggest_formula",
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers",
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
];

const GRAPH_MUTATION_TASKS = new Set([
  "deepen_node",
  "simplify_branch",
  "suggest_alternative",
  "suggest_formula"
]);

const ADVISORY_TASKS = new Set([
  "review_model",
  "check_units",
  "identify_missing_drivers",
  "identify_duplicate_drivers"
]);

const EXPLANATION_TASKS = new Set([
  "explain_node",
  "explain_scenario",
  "generate_executive_summary"
]);

function fail(message) {
  throw new Error(`Phase 7 verification failed: ${message}`);
}

function read(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function expectExactSet(values, expected, label) {
  const actual = [...values].sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((value, index) => value !== wanted[index])) {
    fail(`${label} mismatch. Expected ${wanted.join(", ")}; received ${actual.join(", ")}.`);
  }
}

function listFiles(root, relativeDir) {
  const dir = join(root, relativeDir);
  const results = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    const relative = join(relativeDir, entry);
    if (statSync(absolute).isDirectory()) {
      results.push(...listFiles(root, relative));
    } else {
      results.push(relative);
    }
  }
  return results;
}

function assertTaskOwnership(root) {
  const coreTypes = read(root, "packages/vdt-core/src/types.ts");
  const modelBridgeContract = read(root, "packages/model-bridge/src/contract.ts");
  const vdtCorePackage = readJson(root, "packages/vdt-core/package.json");
  const modelBridgePackage = readJson(root, "packages/model-bridge/package.json");

  if (!coreTypes.includes("export type VdtAiTaskType =")) {
    fail("VdtAiTaskType must be owned by vdt-core.");
  }
  for (const taskType of CANONICAL_TASK_TYPES) {
    if (!coreTypes.includes(`"${taskType}"`)) {
      fail(`vdt-core VdtAiTaskType is missing ${taskType}.`);
    }
  }
  if (!modelBridgeContract.includes('import type { VdtAiTaskType } from "@vdt-studio/vdt-core"')) {
    fail("model-bridge must import VdtAiTaskType from vdt-core.");
  }
  if (!modelBridgeContract.includes("export type { VdtAiTaskType }")) {
    fail("model-bridge must re-export VdtAiTaskType.");
  }
  if (JSON.stringify(vdtCorePackage.dependencies ?? {}).includes("@vdt-studio/model-bridge")) {
    fail("vdt-core must not depend on model-bridge.");
  }
  if (modelBridgePackage.dependencies?.["@vdt-studio/vdt-core"] !== "workspace:*") {
    fail("model-bridge must depend on vdt-core for VdtAiTaskType.");
  }
}

function assertSchemaAndManifestCoverage() {
  expectExactSet(VDT_OUTPUT_SCHEMA_IDS.map((schemaId) => schemaTasks[schemaId]), CANONICAL_TASK_TYPES, "model-bridge output schema tasks");
  expectExactSet(ALL_VDT_TASK_TYPES, CANONICAL_TASK_TYPES, "local-runner ALL_VDT_TASK_TYPES");
  if (VDT_OUTPUT_SCHEMA_IDS.length !== CANONICAL_TASK_TYPES.length) {
    fail("model-bridge must register exactly 12 VDT output schemas.");
  }
  for (const taskType of CANONICAL_TASK_TYPES) {
    const schemaId = schemaIdForTask(taskType);
    if (!VDT_OUTPUT_SCHEMA_IDS.includes(schemaId)) {
      fail(`schemaIdForTask(${taskType}) returned unregistered schema ${schemaId}.`);
    }
  }
  for (const manifest of BUILTIN_BACKEND_MANIFESTS) {
    expectExactSet(manifest.taskTypes, CANONICAL_TASK_TYPES, `manifest ${manifest.id} taskTypes`);
    expectExactSet(manifest.schemaIds, ALL_VDT_SCHEMA_IDS, `manifest ${manifest.id} schemaIds`);
  }
}

function assertRouteSeparation(root) {
  const runTaskParser = read(root, "apps/web/app/api/ai/run-task/parse-run-task-request.ts");
  const runTaskRoute = read(root, "apps/web/app/api/ai/run-task/route.ts");
  const generateRoute = read(root, "apps/web/app/api/ai/generate-vdt/route.ts");

  if (!runTaskParser.includes("generate_tree must use /api/ai/generate-vdt.")) {
    fail("run-task route must reject generate_tree.");
  }
  for (const taskType of CANONICAL_TASK_TYPES.filter((taskType) => taskType !== "generate_tree")) {
    if (!runTaskParser.includes(`"${taskType}"`)) {
      fail(`/api/ai/run-task RUN_TASK_TYPES is missing ${taskType}.`);
    }
  }
  if (!runTaskRoute.includes("Bounded AI task route for all VdtAiTaskType values except `generate_tree`")) {
    fail("run-task route must document its non-generate_tree boundary.");
  }
  if (!generateRoute.includes('taskType: "generate_tree"')) {
    fail("/api/ai/generate-vdt must use generate_tree.");
  }
}

function assertNoSilentMutationPaths(root) {
  const files = [
    ...listFiles(root, "apps/web/components/vdt"),
    ...listFiles(root, "apps/web/lib"),
    ...listFiles(root, "apps/web/app/api/ai")
  ];
  for (const file of files) {
    const text = read(root, file);
    for (const banned of ["applyDeepenPreview", "prepareDeepenPreview"]) {
      if (text.includes(banned)) {
        fail(`${file} still contains removed silent mutation path ${banned}.`);
      }
    }
  }
}

function assertDocs(root) {
  const readme = read(root, "README.md");
  const roadmap = read(root, "docs/ROADMAP.md");

  if (!readme.includes("VDT Studio exposes 12 bounded AI tasks")) {
    fail("README must list the bounded AI actions.");
  }
  for (const taskType of CANONICAL_TASK_TYPES) {
    if (!readme.includes(`\`${taskType}\``)) {
      fail(`README AI Actions section is missing ${taskType}.`);
    }
  }
  if (!roadmap.includes("Phase 7 verification gate")) {
    fail("docs/ROADMAP.md must record Phase 7 verification gate progress.");
  }
}

function cloneProject() {
  return structuredClone(productionVolumeProject);
}

function taskInput(taskType) {
  const project = cloneProject();
  switch (taskType) {
    case "generate_tree":
      return {
        rootKpi: "Production Volume",
        industry: "Mining / Processing Plant",
        businessContext: "Operational performance analysis",
        unit: "tonnes/month",
        timePeriod: "monthly",
        goal: "Explain monthly production performance.",
        levelOfDetail: "medium"
      };
    case "deepen_node":
      return { project, nodeId: "unplanned_downtime" };
    case "simplify_branch":
      return { project, branchRootNodeId: "average_productivity" };
    case "suggest_alternative":
      return { project, targetNodeId: "effective_working_time" };
    case "suggest_formula":
      return { project, nodeId: "production_volume" };
    case "review_model":
    case "check_units":
    case "identify_missing_drivers":
    case "identify_duplicate_drivers":
      return { project };
    case "explain_node":
      return { project, nodeId: "production_volume" };
    case "explain_scenario":
      return {
        project,
        scenarioId: "scenario_reduce_unplanned_downtime",
        calculationSummary: {
          rootNodeId: "production_volume",
          baselineRootValue: 114_048,
          scenarioRootValue: 117_888,
          rootDelta: 3_840,
          nodeValues: [
            { nodeId: "unplanned_downtime", baselineValue: 80, scenarioValue: 60 },
            { nodeId: "production_volume", baselineValue: 114_048, scenarioValue: 117_888 }
          ]
        }
      };
    case "generate_executive_summary":
      return {
        project,
        rootValue: 114_048,
        topDrivers: [
          { nodeId: "effective_working_time", name: "Effective Working Time", contributionSummary: "Time base after losses." },
          { nodeId: "average_productivity", name: "Average Productivity", contributionSummary: "Rate achieved per effective hour." }
        ]
      };
    default:
      fail(`No mock smoke input for ${taskType}.`);
  }
}

function expectedKind(taskType) {
  if (taskType === "generate_tree") return "project";
  if (GRAPH_MUTATION_TASKS.has(taskType)) return "change_set";
  if (ADVISORY_TASKS.has(taskType)) return "advisory";
  if (EXPLANATION_TASKS.has(taskType)) return "explanation";
  fail(`No expected result kind for ${taskType}.`);
}

async function assertMockProviderCoverage() {
  const provider = new MockProvider();
  const results = [];
  for (const taskType of CANONICAL_TASK_TYPES) {
    const result = await runAiTask(taskType, provider, taskInput(taskType));
    const kind = expectedKind(taskType);
    if (result.kind !== kind) {
      fail(`MockProvider returned ${result.kind} for ${taskType}; expected ${kind}.`);
    }
    results.push({ taskType, kind });
  }
  return results;
}

export async function verifyPhase7Gate(root = DEFAULT_ROOT, options = {}) {
  const runMockSmoke = options.runMockSmoke !== false;
  assertTaskOwnership(root);
  assertSchemaAndManifestCoverage();
  assertRouteSeparation(root);
  assertNoSilentMutationPaths(root);
  assertDocs(root);
  const mockResults = runMockSmoke ? await assertMockProviderCoverage() : [];
  return {
    taskCount: CANONICAL_TASK_TYPES.length,
    schemaCount: VDT_OUTPUT_SCHEMA_IDS.length,
    manifestCount: BUILTIN_BACKEND_MANIFESTS.length,
    mockTaskCount: mockResults.length
  };
}

if (process.argv[1] === SCRIPT_PATH) {
  const result = await verifyPhase7Gate(DEFAULT_ROOT);
  process.stdout.write(
    `Phase 7 gate verified: tasks=${result.taskCount}; schemas=${result.schemaCount}; manifests=${result.manifestCount}; mockTasks=${result.mockTaskCount}\n`
  );
}
