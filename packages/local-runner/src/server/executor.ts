import { execFile, spawn as nodeSpawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assertArgsSafe,
  extractBoundedJson,
  getSubscriptionCliAdapter,
  getRegisteredJsonSchema,
  getStrictResponseJsonSchema,
  isVdtSchemaId,
  normalizeRegisteredSchemaOutput,
  validateRegisteredSchemaDetailed,
  validateRegisteredSchema,
  type ExecFileProbe,
  type VdtSchemaId
} from "@vdt-studio/model-bridge";
import type { BackendManifest, CompletionRequest } from "../cli/types";

const advisoryStub = Object.freeze({
  assumptions: [] as string[],
  questionsForUser: [] as string[],
  warnings: [] as Record<string, unknown>[]
});

const mockNode = Object.freeze({
  id: "root",
  name: "Root KPI",
  description: "Mock root KPI.",
  type: "root_kpi",
  unit: "units",
  aiConfidence: 0.9,
  aiRationale: "Mock schema-valid node.",
  controllability: "medium",
  materiality: "high"
});

const MOCK_STUB_OUTPUT: Record<VdtSchemaId, Record<string, unknown>> = {
  "connection-test-v1": { ok: true },
  "agent-decision-v1": {
    type: "call_tool",
    toolName: "skill.search",
    args: {
      rootKpi: "Ore haulage",
      industry: "Mining",
      maxSkills: 3
    },
    statusMessage: "Searching for the most relevant VDT skill."
  },
  "agent-plan-v1": {
    buildIntent: {
      rootKpi: "Ore haulage",
      industry: "",
      businessContext: "I have 5 trucks\nAverage distance 2.7 km\nAverage load speed - 7 km/h\nAverage empty speed - 11 km/h",
      unit: "tonnes/year",
      timePeriod: "year",
      goal: ""
    },
    selectedSkillIds: ["mining.haulage_truck_cycle"],
    skillRationale: "Mock planning response for a truck haulage request.",
    extractedInputs: [
      { id: "number_of_trucks", label: "Number of trucks", value: 5, unit: "trucks", sourceText: "I have 5 trucks" },
      { id: "haul_distance_km", label: "Average haul distance", value: 2.7, unit: "km", sourceText: "Average distance 2.7 km" },
      { id: "loaded_speed_kmh", label: "Average loaded speed", value: 7, unit: "km/h", sourceText: "Average load speed - 7 km/h" },
      { id: "empty_speed_kmh", label: "Average empty speed", value: 11, unit: "km/h", sourceText: "Average empty speed - 11 km/h" }
    ],
    missingInputs: [
      {
        id: "payload_per_trip_t",
        question: "What is the average payload per truck trip in tonnes?",
        reason: "Truck haulage tonnes require payload per trip.",
        required: true
      },
      {
        id: "operating_hours",
        question: "How many operating hours should the yearly period assume?",
        reason: "Trips per truck require available operating time.",
        required: true
      }
    ],
    driverPlan: [
      {
        id: "number_of_trucks",
        parentNodeId: "root",
        name: "Number of trucks",
        type: "input",
        unit: "trucks",
        relation: "multiplicative_driver",
        formula: "",
        description: "Available truck fleet size.",
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
        formula: "operating_hours / ((haul_distance_km / loaded_speed_kmh) + (haul_distance_km / empty_speed_kmh))",
        description: "Trips each truck can complete from cycle time and annual operating hours.",
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
        description: "Average tonnes moved per loaded trip.",
        value: "",
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
        description: "Available truck operating hours during the year.",
        value: "",
        assumptions: []
      },
      {
        id: "haul_distance_km",
        parentNodeId: "trips_per_truck",
        name: "Average haul distance",
        type: "input",
        unit: "km",
        relation: "divisive_driver",
        formula: "",
        description: "Average one-way loaded haul distance.",
        value: 2.7,
        assumptions: []
      },
      {
        id: "loaded_speed_kmh",
        parentNodeId: "trips_per_truck",
        name: "Average loaded speed",
        type: "input",
        unit: "km/h",
        relation: "positive_driver",
        formula: "",
        description: "Average speed while loaded.",
        value: 7,
        assumptions: []
      },
      {
        id: "empty_speed_kmh",
        parentNodeId: "trips_per_truck",
        name: "Average empty speed",
        type: "input",
        unit: "km/h",
        relation: "positive_driver",
        formula: "",
        description: "Average return speed while empty.",
        value: 11,
        assumptions: []
      }
    ],
    rootFormula: "number_of_trucks * trips_per_truck * payload_per_trip_t",
    ...advisoryStub,
    confidence: 0.5
  },
  "generate-tree-v1": { projectTitle: "Mock tree", rootNodeId: "root", nodes: [mockNode], edges: [], ...advisoryStub },
  "deepen-node-v1": { targetNodeId: "node-1", nodes: [{ ...mockNode, id: "child_a", name: "Child A" }], edges: [], ...advisoryStub },
  "simplify-branch-v1": { branchRootNodeId: "node-1", nodeRemovals: [], edgeChanges: [], rationale: "Mock", ...advisoryStub },
  "suggest-alternative-v1": { targetNodeId: "node-1", nodes: [{ ...mockNode, id: "alternative_a", name: "Alternative A" }], edges: [], rationale: "Mock", ...advisoryStub },
  "suggest-formula-v1": { nodeId: "node-1", proposedFormula: "1", aiRationale: "Mock", confidence: 0.5, ...advisoryStub },
  "review-model-v1": { findings: [], ...advisoryStub },
  "check-units-v1": { unitFindings: [], ...advisoryStub },
  "identify-missing-drivers-v1": { missingDrivers: [], ...advisoryStub },
  "identify-duplicate-drivers-v1": { duplicateClusters: [], ...advisoryStub },
  "explain-node-v1": { nodeId: "node-1", explanation: "Mock", keyDrivers: [], assumptions: [], questionsForUser: [] },
  "explain-scenario-v1": { scenarioId: "scenario-1", narrative: "Mock", impactHighlights: [], assumptions: [], questionsForUser: [] },
  "generate-executive-summary-v1": { headline: "Mock", keyDrivers: [], risks: [], recommendations: [] }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mockOutput(schemaId: VdtSchemaId, input: unknown): Record<string, unknown> {
  if (schemaId === "agent-decision-v1") return mockAgentDecision(input);
  if (isRecord(input) && validateRegisteredSchema(schemaId, input)) return input;
  return MOCK_STUB_OUTPUT[schemaId];
}

function mockAgentDecision(input: unknown): Record<string, unknown> {
  const context = isRecord(input) && isRecord(input.data) ? input.data : input;
  const record = isRecord(context) ? context : {};
  const project = isRecord(record.currentProject) ? record.currentProject : undefined;
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const nodeIds = new Set(nodes.flatMap((node) => isRecord(node) && typeof node.id === "string" ? [node.id] : []));
  const answers = isRecord(record.userAnswers) ? record.userAnswers : {};
  const recentEvents = Array.isArray(record.recentEvents) ? record.recentEvents : [];
  const hasTool = (toolName: string) => recentEvents.some((event) => {
    if (!isRecord(event) || !isRecord(event.metadata)) return false;
    return event.metadata.toolName === toolName;
  });

  if (!hasTool("skill.search")) return { type: "call_tool", toolName: "skill.search", args: { rootKpi: "Ore haulage", industry: "Mining", maxSkills: 3 }, statusMessage: "Searching for the truck haulage skill." };
  if (!hasTool("skill.read")) return { type: "call_tool", toolName: "skill.read", args: { skillId: "mining.haulage_truck_cycle" }, statusMessage: "Reading the truck haulage skill." };
  if (!hasTool("skill.compile_recipe")) return { type: "call_tool", toolName: "skill.compile_recipe", args: { skillId: "mining.haulage_truck_cycle" }, statusMessage: "Compiling the truck haulage recipe." };
  if (answers.payload_per_trip_t === undefined || answers.operating_hours === undefined) {
    return {
      type: "ask_user",
      statusMessage: "Payload and operating hours are needed to calculate annual hauled tonnes.",
      questions: [
        { id: "payload_per_trip_t", question: "What is the average payload per truck trip in tonnes?", reason: "Annual hauled tonnes require payload per completed trip.", required: true, expectedAnswerType: "number" },
        { id: "operating_hours", question: "How many operating hours per year should the model use?", reason: "Trips per truck require an operating-hours base.", required: true, expectedAnswerType: "number" }
      ]
    };
  }
  if (!project || nodeIds.size === 0) return { type: "call_tool", toolName: "vdt.create_draft", args: { projectTitle: "Ore haulage Driver Model", rootKpi: "Ore haulage", unit: "tonnes/year", timePeriod: "year", industry: "Mining" }, statusMessage: "Creating the hauled-tonnes root." };
  const payload = parseMockNumber(answers.payload_per_trip_t) ?? 40;
  const operatingHours = parseMockNumber(answers.operating_hours) ?? 4000;
  const add = (nodeId: string, name: string, parentNodeId: string, extra: Record<string, unknown>) => ({ type: "call_tool", toolName: "vdt.add_driver", args: { parentNodeId, nodeId, name, ...extra }, statusMessage: `Adding ${name}.` });
  if (!nodeIds.has("number_of_trucks")) return add("number_of_trucks", "Number of trucks", "ore_haulage", { type: "input", unit: "trucks", relation: "multiplicative_driver", baselineValue: 5 });
  if (!nodeIds.has("trips_per_truck")) return add("trips_per_truck", "Trips per truck", "ore_haulage", { type: "calculated", unit: "trips/truck/year", relation: "multiplicative_driver", formula: "operating_hours / cycle_time_h" });
  if (!nodeIds.has("payload_per_trip_t")) return add("payload_per_trip_t", "Payload per trip", "ore_haulage", { type: "input", unit: "tonnes/trip", relation: "multiplicative_driver", baselineValue: payload });
  if (!nodeIds.has("operating_hours")) return add("operating_hours", "Operating hours", "trips_per_truck", { type: "input", unit: "h/year", relation: "formula_dependency", baselineValue: operatingHours });
  if (!nodeIds.has("cycle_time_h")) return add("cycle_time_h", "Cycle time", "trips_per_truck", { type: "calculated", unit: "h/trip", relation: "divisive_driver", formula: "loaded_travel_time_h + empty_return_time_h" });
  if (!nodeIds.has("loaded_travel_time_h")) return add("loaded_travel_time_h", "Loaded travel time", "cycle_time_h", { type: "calculated", unit: "h/trip", relation: "additive_component", formula: "haul_distance_km / loaded_speed_kmh" });
  if (!nodeIds.has("empty_return_time_h")) return add("empty_return_time_h", "Empty return time", "cycle_time_h", { type: "calculated", unit: "h/trip", relation: "additive_component", formula: "haul_distance_km / empty_speed_kmh" });
  if (!nodeIds.has("haul_distance_km")) return add("haul_distance_km", "Average haul distance", "loaded_travel_time_h", { type: "input", unit: "km", relation: "formula_dependency", baselineValue: 2.7 });
  if (!nodeIds.has("loaded_speed_kmh")) return add("loaded_speed_kmh", "Average loaded speed", "loaded_travel_time_h", { type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 7 });
  if (!nodeIds.has("empty_speed_kmh")) return add("empty_speed_kmh", "Average empty speed", "empty_return_time_h", { type: "input", unit: "km/h", relation: "formula_dependency", baselineValue: 11 });
  const root = nodes.find((node) => isRecord(node) && node.id === "ore_haulage");
  if (!isRecord(root) || typeof root.formula !== "string" || !root.formula) return { type: "call_tool", toolName: "vdt.set_formula", args: { nodeId: "ore_haulage", formula: "number_of_trucks * trips_per_truck * payload_per_trip_t" }, statusMessage: "Setting the hauled-tonnes formula." };
  if (!hasTool("vdt.calculate")) return { type: "call_tool", toolName: "vdt.calculate", args: {}, statusMessage: "Calculating the graph." };
  return { type: "finish", summary: "Built a valid truck haulage VDT.", nextSuggestedActions: ["Review payload and operating-hours assumptions."] };
}

function parseMockNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value.replace(",", ".").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const EXECUTION_LIMITS = Object.freeze({
  maxPromptBytes: 512 * 1024,
  maxLineBytes: 1024 * 1024,
  maxStdoutBytes: 4 * 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  maxRepairExcerptBytes: 16 * 1024,
  repairTimeoutMs: 60_000,
  timeoutMs: 120_000,
  killGraceMs: 3_000
});

const ALLOWED_ENV_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "NO_COLOR",
  "VDT_FAKE_CURSOR_MODE", "VDT_FAKE_CODEX_MODE", "VDT_FAKE_CLAUDE_MODE", "VDT_FAKE_GEMINI_MODE", "VDT_FAKE_COPILOT_MODE"
] as const;

const CODEX_HOME_COPY_FILES = ["auth.json", "installation_id", "models_cache.json"] as const;

export interface ExecutionResult {
  output: unknown;
  rawText?: string;
  outputBytes: number;
  schemaValid: boolean;
  repaired?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  exitCode?: number;
  executableVersion?: string;
}

export interface ExecutorOptions {
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  fetch?: typeof globalThis.fetch;
  spawn?: (command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
  resolveExecutable?: (manifest: BackendManifest, env: NodeJS.ProcessEnv) => Promise<string>;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function abortError(message = "Completion was cancelled."): Error {
  return Object.assign(new Error(message), { name: "AbortError", code: "CANCELLED" });
}

function isClosedStdinError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function safeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.NO_COLOR = "1";
  return result as NodeJS.ProcessEnv;
}

async function defaultResolveExecutable(manifest: BackendManifest, env: NodeJS.ProcessEnv): Promise<string> {
  const cli = manifest.cli;
  if (!cli) throw Object.assign(new Error("Backend has no executable manifest."), { code: "INVALID_MANIFEST" });
  const pathValue = env.PATH ?? "";
  for (const alias of cli.executableAliases) {
    if (alias.includes("\0") || path.basename(alias) !== alias || alias === "." || alias === "..") continue;
    for (const directory of pathValue.split(path.delimiter).filter((entry) => path.isAbsolute(entry))) {
      const candidate = path.resolve(directory, alias);
      try {
        const info = await lstat(candidate);
        if (!info.isSymbolicLink() && !info.isFile()) continue;
        const resolved = await realpath(candidate);
        if (!path.isAbsolute(resolved)) continue;
        const resolvedInfo = await lstat(resolved);
        if (!resolvedInfo.isFile()) continue;
        const projectRoot = path.resolve(process.cwd());
        if (resolved === projectRoot || resolved.startsWith(`${projectRoot}${path.sep}`)) continue;
        return resolved;
      } catch {
        // Continue probing reviewed aliases only.
      }
    }
  }
  throw Object.assign(new Error(`${manifest.label} executable was not found as a regular non-symlink file on PATH.`), {
    code: "BACKEND_NOT_INSTALLED"
  });
}

async function normalizeResolvedExecutable(executable: string): Promise<string> {
  if (!path.isAbsolute(executable) || executable.includes("\0")) {
    throw Object.assign(new Error("Resolved executable must be an absolute path without NUL bytes."), { code: "UNSAFE_EXECUTABLE" });
  }
  try {
    return await realpath(executable);
  } catch {
    return executable;
  }
}

function isJavaScriptExecutable(executable: string): boolean {
  return /\.(?:mjs|cjs|js)$/i.test(executable);
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldLocalizeJavaScriptExecutable(executable: string, options: ExecutorOptions): boolean {
  return options.resolveExecutable !== undefined && isPathInside(process.cwd(), executable);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function copyCodexHomeFile(sourceDir: string, targetDir: string, fileName: string): Promise<void> {
  try {
    const targetPath = path.join(targetDir, fileName);
    await copyFile(path.join(sourceDir, fileName), targetPath);
    await chmod(targetPath, 0o600);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
}

async function prepareEphemeralCodexHome(cwd: string, envSource: NodeJS.ProcessEnv): Promise<string | undefined> {
  const sourceCodexHome = envSource.CODEX_HOME ?? (envSource.HOME ? path.join(envSource.HOME, ".codex") : undefined);
  if (!sourceCodexHome) return undefined;

  const codexHome = path.join(cwd, "codex-home");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await chmod(codexHome, 0o700);
  for (const fileName of CODEX_HOME_COPY_FILES) {
    await copyCodexHomeFile(sourceCodexHome, codexHome, fileName);
  }
  return codexHome;
}

function isEphemeralWorkspaceCertified(manifest: BackendManifest): boolean {
  return (
    manifest.id === "cursor_subscription" &&
    manifest.kind === "subscription_cli" &&
    manifest.safety.ephemeralWorkspaceOnly === true &&
    manifest.safety.trustEphemeralWorkspace === true &&
    manifest.safety.requiresOsSandbox === false
  );
}

function assertManifestSafe(manifest: BackendManifest): void {
  if (manifest.kind !== "subscription_cli" && manifest.kind !== "custom_cli") return;
  if (manifest.cli?.args) {
    assertArgsSafe(manifest.cli.args, {
      allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true
    });
  }
  const { certified, toolsDisabled, requiresOsSandbox } = manifest.safety;
  const ephemeralWorkspaceCertified = isEphemeralWorkspaceCertified(manifest);
  if (!certified || requiresOsSandbox || (!toolsDisabled && !ephemeralWorkspaceCertified)) {
    throw Object.assign(new Error(`${manifest.label} is not certified for isolated execution.`), {
      code: "UNSAFE_CONFIGURATION"
    });
  }
}

function assertLineLimit(value: string): void {
  for (const line of value.split(/\r?\n/)) {
    if (byteLength(line) > EXECUTION_LIMITS.maxLineBytes) {
      throw Object.assign(new Error("Backend output line exceeds the configured limit."), { code: "OUTPUT_LINE_TOO_LARGE" });
    }
  }
}

function truncateForRepair(value: string): string {
  if (byteLength(value) <= EXECUTION_LIMITS.maxRepairExcerptBytes) return value;
  let end = Math.min(value.length, EXECUTION_LIMITS.maxRepairExcerptBytes);
  while (end > 0 && byteLength(value.slice(0, end)) > EXECUTION_LIMITS.maxRepairExcerptBytes) {
    end -= 1;
  }
  return `${value.slice(0, end)}\n[truncated]`;
}

function tailForDiagnostics(value: string, maxBytes = 2_048): string {
  if (!value.trim()) return "";
  let start = Math.max(0, value.length - maxBytes);
  while (start < value.length && byteLength(value.slice(start)) > maxBytes) {
    start += 1;
  }
  return value.slice(start).replace(/\s+/g, " ").trim();
}

function timeoutDiagnostic(stdout: string, stderr: string, timeoutMs: number): string {
  const stdoutBytes = byteLength(stdout);
  const stderrBytes = byteLength(stderr);
  const parts = [`after ${timeoutMs}ms`, `stdout=${stdoutBytes} bytes`, `stderr=${stderrBytes} bytes`];
  const stderrTail = tailForDiagnostics(stderr);
  const stdoutTail = tailForDiagnostics(stdout);
  if (stderrTail) parts.push(`stderrTail=${JSON.stringify(stderrTail)}`);
  if (stdoutTail) parts.push(`stdoutTail=${JSON.stringify(stdoutTail)}`);
  return parts.join("; ");
}

function validationSummary(schemaId: VdtSchemaId, output: unknown): string[] {
  const schema = getRegisteredJsonSchema(schemaId);
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
  const missing = isRecord(output) ? required.filter((key) => !(key in output)) : required;
  const detailed = validateRegisteredSchemaDetailed(schemaId, output).errors;
  return [
    `Output must be one JSON object for schema ${schemaId}.`,
    ...(missing.length > 0 ? [`Missing required keys: ${missing.join(", ")}.`] : []),
    ...detailed.slice(0, 12),
    "Nested values must match the registered VDT runtime schema."
  ];
}

function buildRepairMessages(
  schemaId: VdtSchemaId,
  request: CompletionRequest,
  invalidJson: string,
  parsedOutput: unknown
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "Repair one invalid VDT JSON response.",
        "Return exactly one corrected JSON object.",
        "Do not include markdown fences, commentary, file paths, environment values, credentials, or tokens."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        taskType: request.taskType,
        schemaId,
        validationErrors: validationSummary(schemaId, parsedOutput),
        invalidJsonExcerpt: truncateForRepair(invalidJson)
      })
    }
  ];
}

function buildSubscriptionPrompt(request: CompletionRequest): string {
  const schemaId = request.schemaId as VdtSchemaId;
  return [
    `Return only JSON matching approved schema ${request.schemaId} for VDT task ${request.taskType}.`,
    "Do not include markdown fences or commentary.",
    "Do not use tools, run commands, inspect files, edit files, or wait for user input. Answer directly from the provided request.",
    JSON.stringify({
      schemaId: request.schemaId,
      taskType: request.taskType,
      outputJsonSchema: getStrictResponseJsonSchema(schemaId),
      input: request.input,
      ...(request.model ? { model: request.model } : {})
    })
  ].join("\n");
}

function buildRepairPrompt(request: CompletionRequest, invalidJson: string, parsedOutput: unknown): string {
  return [
    `Repair JSON for approved schema ${request.schemaId} and VDT task ${request.taskType}.`,
    "Return exactly one corrected JSON object.",
    "Do not include markdown fences, commentary, file paths, environment values, credentials, or tokens.",
    JSON.stringify({
      taskType: request.taskType,
      schemaId: request.schemaId,
      validationErrors: validationSummary(request.schemaId as VdtSchemaId, parsedOutput),
      invalidJsonExcerpt: truncateForRepair(invalidJson)
    })
  ].join("\n");
}

async function probeExecutableVersion(executable: string, versionArgs: readonly string[]): Promise<string | undefined> {
  try {
    const result = await promisify(execFile)(executable, [...versionArgs], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
      shell: false
    });
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    return combined || undefined;
  } catch {
    return undefined;
  }
}

async function executableHelpIncludes(executable: string, needle: string): Promise<boolean> {
  try {
    const result = await promisify(execFile)(executable, ["--help"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 256 * 1024,
      windowsHide: true,
      shell: false
    });
    return `${result.stdout}\n${result.stderr}`.includes(needle);
  } catch {
    return false;
  }
}

async function executeCli(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  assertManifestSafe(manifest);
  const adapter = manifest.kind === "subscription_cli" ? getSubscriptionCliAdapter(manifest.id) : undefined;
  const envSource = options.env ?? process.env;
  const executable = await normalizeResolvedExecutable(await (options.resolveExecutable ?? defaultResolveExecutable)(manifest, envSource));
  const payload = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...(request.model ? { model: request.model } : {})
  });
  if (byteLength(payload) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }

  const executableVersion =
    manifest.cli?.versionArgs?.length && !isJavaScriptExecutable(executable)
      ? await probeExecutableVersion(executable, manifest.cli.versionArgs)
      : undefined;

  async function runCliAttempt(prompt: string, timeoutMs: number, requestJson = payload): Promise<ExecutionResult> {
    if (byteLength(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
      throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
    }

    const tempRoot = options.tempRoot ?? os.tmpdir();
    await mkdir(tempRoot, { recursive: true });
    const cwd = await mkdtemp(path.join(tempRoot, "vdt-run-"));
    await chmod(cwd, 0o700);
    const requestPath = path.join(cwd, "request.json");
    await writeFile(requestPath, requestJson, { encoding: "utf8", mode: 0o600, flag: "wx" });

    const promptPath = path.join(cwd, "prompt.txt");
    await writeFile(promptPath, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" });

    const schemaPath = path.join(cwd, "schema.json");
    await writeFile(schemaPath, `${JSON.stringify(getStrictResponseJsonSchema(request.schemaId as VdtSchemaId), null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    const outputPath = path.join(cwd, "last-message.json");
    const toolPolicyPath = path.join(cwd, "deny-all-tools.toml");
    await writeFile(
      toolPolicyPath,
      '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n',
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    const promptText = await readFile(promptPath, "utf8");

    const staticArgs = manifest.cli?.args ?? [];
    const dynamicArgs = adapter
      ? adapter.buildArgs({
          ...(request.model ? { model: request.model } : {}),
          cwd,
          promptPath,
          promptText,
          schemaPath,
          outputPath,
          toolPolicyPath,
          enableWorkspaceTrust:
            manifest.id === "cursor_subscription" &&
            manifest.safety.trustEphemeralWorkspace === true &&
            await executableHelpIncludes(executable, "--trust")
        })
      : [];
    let command = executable;
    let spawnArgs = [...staticArgs, ...dynamicArgs];
    assertArgsSafe(spawnArgs, {
      allowScopedTrust: manifest.safety.trustEphemeralWorkspace === true
    });

    if (isJavaScriptExecutable(executable)) {
      let scriptPath = executable;
      if (shouldLocalizeJavaScriptExecutable(executable, options)) {
        scriptPath = path.join(cwd, path.basename(executable));
        await copyFile(executable, scriptPath);
        await chmod(scriptPath, 0o700);
      }
      command = process.execPath;
      spawnArgs = [scriptPath, ...spawnArgs];
    }

    let finalArgs = spawnArgs;

    const childEnv = safeEnvironment(envSource);
    if (manifest.id === "cursor_subscription") {
      childEnv.NODE_COMPILE_CACHE = path.join(cwd, "node-compile-cache");
    }
    if (manifest.id === "codex_subscription") {
      const codexHome = await prepareEphemeralCodexHome(cwd, envSource);
      if (codexHome) childEnv.CODEX_HOME = codexHome;
    }
    const child = (options.spawn ?? ((spawnCommand, args, spawnOptions) =>
      nodeSpawn(spawnCommand, [...args], spawnOptions) as ChildProcessWithoutNullStreams))(
      command,
      finalArgs,
      { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    let timeout: NodeJS.Timeout | undefined;
    let forceKill: NodeJS.Timeout | undefined;
    let cancelled = false;
    let outputLimitExceeded = false;

    const terminate = () => {
      cancelled = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), EXECUTION_LIMITS.killGraceMs);
      forceKill.unref?.();
    };
    signal.addEventListener("abort", terminate, { once: true });
    const effectiveTimeout = Math.min(timeoutMs, EXECUTION_LIMITS.timeoutMs);
    timeout = setTimeout(terminate, effectiveTimeout);
    timeout.unref?.();

    type CompletionEvent =
      | { type: "exit"; exitCode: number }
      | { type: "stream"; result: ExecutionResult };

    let completionSettled = false;
    let streamingResult: ExecutionResult | undefined;
    let streamingError: unknown;
    const stopChildAfterStreamingResult = () => {
      child.kill("SIGTERM");
      const streamKill = setTimeout(() => child.kill("SIGKILL"), 50);
      streamKill.unref?.();
      child.once("close", () => clearTimeout(streamKill));
    };

    const completion = new Promise<CompletionEvent>((resolve, reject) => {
      const settle = (event: CompletionEvent) => {
        if (completionSettled) return;
        completionSettled = true;
        resolve(event);
      };
      const fail = (error: unknown) => {
        if (completionSettled) return;
        completionSettled = true;
        reject(error);
      };
      const trySettleFromStream = () => {
        if (!adapter?.parseStreamingOutput) return;
        if (streamingResult || streamingError !== undefined) return;
        let output: unknown;
        try {
          output = normalizeRegisteredSchemaOutput(
            request.schemaId as VdtSchemaId,
            adapter.parseStreamingOutput(stdout, stderr, request.schemaId as VdtSchemaId)
          );
        } catch (error) {
          streamingError = error;
          stopChildAfterStreamingResult();
          return;
        }
        if (output === undefined || !validateRegisteredSchema(request.schemaId as VdtSchemaId, output)) return;
        streamingResult = {
          output,
          rawText: stdout,
          outputBytes: byteLength(stdout),
          schemaValid: true,
          exitCode: 0,
          ...(executableVersion === undefined ? {} : { executableVersion })
        };
        stopChildAfterStreamingResult();
      };

      child.once("error", fail);
      child.stdin.on("error", (error) => {
        if (isClosedStdinError(error)) return;
        fail(error);
      });
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
        if (byteLength(stdout) > EXECUTION_LIMITS.maxStdoutBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
        if (byteLength(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        trySettleFromStream();
      });
      child.once("close", (code) => {
        if (streamingError !== undefined) {
          fail(streamingError);
          return;
        }
        if (streamingResult) {
          settle({ type: "stream", result: streamingResult });
          return;
        }
        settle({ type: "exit", exitCode: code ?? -1 });
      });
    });

    try {
      if (signal.aborted) terminate();
      try {
        if (adapter) {
          if (adapter.spawnHints?.stdin === "prompt") {
            child.stdin.end(promptText);
          } else {
            child.stdin.end();
          }
        } else {
          child.stdin.end(requestJson);
        }
      } catch (error) {
        if (!isClosedStdinError(error)) throw error;
      }
      const completed = await completion;
      if (completed.type === "stream") return completed.result;
      const exitCode = completed.exitCode;
      if (cancelled) {
        if (byteLength(stdout) > EXECUTION_LIMITS.maxStdoutBytes || byteLength(stderr) > EXECUTION_LIMITS.maxStderrBytes) {
          throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
        }
        if (signal.aborted) throw abortError();
        throw Object.assign(new Error(`Backend timed out (${timeoutDiagnostic(stdout, stderr, effectiveTimeout)}).`), {
          code: "TIMEOUT",
          rawText: stdout
        });
      }
      if (exitCode !== 0) {
        if (adapter) {
          try {
            adapter.parseOutput(stdout, stderr, request.schemaId as VdtSchemaId);
          } catch (error) {
            throw error;
          }
        }
        throw Object.assign(new Error(`Backend exited with code ${exitCode}; stderr contained ${byteLength(stderr)} bytes.`), {
          code: "BACKEND_EXIT_FAILED",
          exitCode
        });
      }
      assertLineLimit(stdout);
      if (byteLength(stdout) > EXECUTION_LIMITS.maxResultBytes && !adapter) {
        throw Object.assign(new Error("Backend result exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      const parsedOutput = adapter
        ? adapter.parseOutput(stdout, stderr, request.schemaId as VdtSchemaId)
        : extractBoundedJson(stdout, EXECUTION_LIMITS.maxResultBytes);
      const output = normalizeRegisteredSchemaOutput(request.schemaId as VdtSchemaId, parsedOutput);
      const schemaValid = validateRegisteredSchema(request.schemaId as VdtSchemaId, output);
      if (!schemaValid) {
        throw Object.assign(new Error("Backend output failed registered schema validation."), {
          code: "SCHEMA_INVALID",
          output,
          rawText: stdout
        });
      }
      return {
        output,
        rawText: stdout,
        outputBytes: byteLength(stdout),
        schemaValid,
        exitCode,
        ...(executableVersion === undefined ? {} : { executableVersion })
      };
    } catch (error) {
      if (outputLimitExceeded) {
        throw Object.assign(new Error("Backend output exceeded the configured limit."), { code: "OUTPUT_TOO_LARGE" });
      }
      if (
        error instanceof Error &&
        !("rawText" in error) &&
        (error as { code?: unknown }).code === "BACKEND_PARSE_FAILED"
      ) {
        throw Object.assign(error, { rawText: stdout });
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", terminate);
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      await rm(cwd, { recursive: true, force: true });
    }
  }

  const first = await runCliAttempt(buildSubscriptionPrompt(request), request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs).catch(
    async (error: unknown) => {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code !== "SCHEMA_INVALID" && code !== "BACKEND_PARSE_FAILED") throw error;
      const parsedOutput = typeof error === "object" && error !== null && "output" in error ? (error as { output?: unknown }).output : undefined;
      const invalidText =
        parsedOutput === undefined
          ? typeof error === "object" && error !== null && "rawText" in error && typeof (error as { rawText?: unknown }).rawText === "string"
            ? (error as { rawText: string }).rawText
            : error instanceof Error
              ? error.message
              : "Invalid provider output."
          : JSON.stringify(parsedOutput);
      let repaired: ExecutionResult;
      try {
        repaired = await runCliAttempt(
          buildRepairPrompt(request, invalidText, parsedOutput),
          Math.min(EXECUTION_LIMITS.repairTimeoutMs, request.timeoutMs ?? EXECUTION_LIMITS.repairTimeoutMs),
          JSON.stringify({
            requestId: request.requestId,
            taskType: request.taskType,
            schemaId: request.schemaId,
            repair: true
          })
        );
      } catch (repairError) {
        if (repairError instanceof Error) {
          throw Object.assign(repairError, { repairAttempted: true, repairSucceeded: false });
        }
        throw repairError;
      }
      return {
        ...repaired,
        outputBytes: repaired.outputBytes + byteLength(invalidText),
        repaired: true,
        repairAttempted: true,
        repairSucceeded: true
      };
    }
  );
  return first;
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (response.redirected) throw Object.assign(new Error("Provider redirects are disabled."), { code: "REDIRECT_BLOCKED" });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > EXECUTION_LIMITS.maxStdoutBytes) {
    throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > EXECUTION_LIMITS.maxStdoutBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Provider response exceeds the configured limit."), { code: "OUTPUT_TOO_LARGE" });
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function appendPath(baseUrl: string, pathSegment: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${pathSegment.replace(/^\/+/, "")}`;
}

function ollamaTagsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/v1\/?$/, "").replace(/\/+$/, "")}/api/tags`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function addModelName(models: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const model = value.trim();
  if (!model || model.length > 160 || model.includes("\0") || seen.has(model)) return;
  seen.add(model);
  models.push(model);
}

function collectModelNames(payload: unknown): string[] {
  const models: string[] = [];
  const seen = new Set<string>();

  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      addModelName(models, seen, value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    addModelName(models, seen, record.id);
    addModelName(models, seen, record.name);
    addModelName(models, seen, record.model);

    if (Array.isArray(record.data)) visit(record.data);
    if (Array.isArray(record.models)) visit(record.models);
  };

  visit(payload);
  return models;
}

async function fetchModelList(url: string, signal: AbortSignal, options: ExecutorOptions): Promise<string[]> {
  let response: Response;
  let rawResponse: string;
  try {
    response = await (options.fetch ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal,
      headers: { accept: "application/json" }
    });
    rawResponse = await readBoundedResponse(response);
  } catch (error) {
    if (signal.aborted) throw abortError("Model listing was cancelled.");
    throw Object.assign(error instanceof Error ? error : new Error("Local model endpoint could not be reached."), {
      code: "LOCAL_MODEL_LIST_FAILED"
    });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`Local model list failed with status ${response.status}.`), {
      code: "LOCAL_MODEL_LIST_FAILED"
    });
  }

  try {
    return collectModelNames(JSON.parse(rawResponse));
  } catch {
    throw Object.assign(new Error("Local model list returned invalid JSON."), {
      code: "INVALID_PROVIDER_RESPONSE"
    });
  }
}

async function listLocalHttpModels(
  manifest: BackendManifest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<readonly string[]> {
  if (!manifest.localHttp) return [];
  const urls = [
    appendPath(manifest.localHttp.baseUrl, "models"),
    ...(manifest.id === "ollama" ? [ollamaTagsUrl(manifest.localHttp.baseUrl)] : [])
  ];
  let lastError: unknown;

  for (const url of urls) {
    try {
      const models = await fetchModelList(url, signal, options);
      if (models.length > 0 || manifest.id !== "ollama") return models;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return [];
}

async function postLocalHttpChat(
  manifest: BackendManifest,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal: AbortSignal,
  options: ExecutorOptions,
  request: CompletionRequest,
  timeoutMs: number
): Promise<string> {
  if (!manifest.localHttp) throw Object.assign(new Error("Backend has no local HTTP manifest."), { code: "INVALID_MANIFEST" });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, Math.min(timeoutMs, EXECUTION_LIMITS.timeoutMs));
  timeout.unref?.();
  let response: Response;
  let rawResponse: string;
  try {
    response = await (options.fetch ?? fetch)(`${manifest.localHttp.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model ?? manifest.localHttp.defaultModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages
      })
    });
    rawResponse = await readBoundedResponse(response);
    assertLineLimit(rawResponse);
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal.aborted) throw abortError();
      throw Object.assign(new Error("Local provider timed out."), { code: "TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
  if (!response.ok) throw Object.assign(new Error(`Local provider failed with status ${response.status}.`), { code: "LOCAL_HTTP_FAILED" });
  const envelope = JSON.parse(rawResponse) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw Object.assign(new Error("Local provider response did not contain message content."), { code: "INVALID_PROVIDER_RESPONSE" });
  return content;
}

async function executeLocalHttp(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions
): Promise<ExecutionResult> {
  const schemaId = request.schemaId as VdtSchemaId;
  const content = await postLocalHttpChat(
    manifest,
    [
      { role: "system", content: `Return one JSON object for VDT task ${request.taskType} matching approved schema ${request.schemaId}.` },
      { role: "user", content: JSON.stringify(request.input) }
    ],
    signal,
    options,
    request,
    request.timeoutMs ?? EXECUTION_LIMITS.timeoutMs
  );
  let output: unknown;
  let schemaValid = false;
  try {
    output = normalizeRegisteredSchemaOutput(schemaId, extractBoundedJson(content, EXECUTION_LIMITS.maxResultBytes));
    schemaValid = validateRegisteredSchema(schemaId, output);
  } catch {
    output = undefined;
  }
  if (schemaValid) return { output, outputBytes: byteLength(content), schemaValid };

  let repairedContent: string;
  let repairedOutput: unknown;
  try {
    repairedContent = await postLocalHttpChat(
      manifest,
      buildRepairMessages(schemaId, request, output === undefined ? content : JSON.stringify(output), output),
      signal,
      options,
      request,
      Math.min(EXECUTION_LIMITS.repairTimeoutMs, request.timeoutMs ?? EXECUTION_LIMITS.repairTimeoutMs)
    );
    repairedOutput = normalizeRegisteredSchemaOutput(
      schemaId,
      extractBoundedJson(repairedContent, EXECUTION_LIMITS.maxResultBytes)
    );
    const repairedSchemaValid = validateRegisteredSchema(schemaId, repairedOutput);
    if (!repairedSchemaValid) {
      throw Object.assign(new Error("Backend output failed registered schema validation after one repair attempt."), {
        code: "SCHEMA_INVALID"
      });
    }
  } catch (repairError) {
    if (repairError instanceof Error) {
      throw Object.assign(repairError, { repairAttempted: true, repairSucceeded: false });
    }
    throw repairError;
  }
  return {
    output: repairedOutput,
    outputBytes: byteLength(content) + byteLength(repairedContent),
    schemaValid: true,
    repaired: true,
    repairAttempted: true,
    repairSucceeded: true
  };
}

export async function executeCompletion(
  manifest: BackendManifest,
  request: CompletionRequest,
  signal: AbortSignal,
  options: ExecutorOptions = {}
): Promise<ExecutionResult> {
  if (!isVdtSchemaId(request.schemaId)) throw Object.assign(new Error("Unknown schemaId."), { code: "UNKNOWN_SCHEMA" });
  if (signal.aborted) throw abortError();
  const prompt = JSON.stringify({
    requestId: request.requestId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    input: request.input,
    ...(request.model ? { model: request.model } : {})
  });
  if (byteLength(prompt) > EXECUTION_LIMITS.maxPromptBytes) {
    throw Object.assign(new Error("Completion request exceeds the prompt limit."), { code: "PROMPT_TOO_LARGE" });
  }
  if (manifest.kind === "mock") {
    const output = mockOutput(request.schemaId, request.input);
    const schemaValid = validateRegisteredSchema(request.schemaId, output);
    if (!schemaValid) throw Object.assign(new Error("Mock input failed registered schema validation."), { code: "SCHEMA_INVALID" });
    return { output, outputBytes: byteLength(JSON.stringify(output)), schemaValid };
  }
  if (manifest.kind === "local_http") return executeLocalHttp(manifest, request, signal, options);
  return executeCli(manifest, request, signal, options);
}

export async function listBackendModels(
  manifest: BackendManifest,
  signal: AbortSignal,
  options: ExecutorOptions = {}
): Promise<readonly string[]> {
  if (!manifest.modelSelection) return [];
  if (signal.aborted) throw abortError("Model listing was cancelled.");
  if (manifest.kind === "local_http") {
    return listLocalHttpModels(manifest, signal, options);
  }
  if (manifest.kind !== "subscription_cli") return [];

  const adapter = getSubscriptionCliAdapter(manifest.id);
  if (!adapter?.listModels) return [];

  const envSource = options.env ?? process.env;
  const executable = await normalizeResolvedExecutable(await (options.resolveExecutable ?? defaultResolveExecutable)(manifest, envSource));

  const fixtureExecFile =
    isJavaScriptExecutable(executable)
      ? (async (_executable, args, execOptions) => {
          const result = await promisify(execFile)(process.execPath, [executable, ...args], execOptions);
          return { stdout: result.stdout, stderr: result.stderr };
        }) satisfies ExecFileProbe
      : undefined;

  return adapter.listModels(executable, { signal, ...(fixtureExecFile ? { execFile: fixtureExecFile } : {}) });
}
