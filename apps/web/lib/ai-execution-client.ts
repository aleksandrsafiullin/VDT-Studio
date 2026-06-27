import {
  generateVdtOutputSchema,
  generateVdtOutputToProject,
  validateAndMapDeepenNode,
  type GenerateVdtInput,
  type RunAiTaskResult
} from "@vdt-studio/ai-harness/browser";
import type { VdtAiTaskType, VdtProject } from "@vdt-studio/vdt-core";
import { resolveVdtAppMode, type VdtAppMode } from "./app-mode";
import { CLI_CATALOG, type CliAgentId } from "./execution-mode-catalog";

export const DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE =
  "Local subscriptions will be managed automatically by VDT Studio Desktop.";

export const HOSTED_WEB_LOCAL_AI_MESSAGE =
  "Local subscriptions and local models are available in VDT Studio Desktop.";

type Fetcher = typeof fetch;
type DesktopInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

type DesktopBridgeGlobal = typeof globalThis & {
  __TAURI__?: {
    core?: {
      invoke?: unknown;
    };
    invoke?: unknown;
  };
};

export interface CliAgentDetectionSnapshot {
  id: CliAgentId;
  installed: boolean;
  executable: string | null;
  alias: string | null;
  version: string | null;
  error?: string | undefined;
  status?:
    | "not_installed"
    | "installed"
    | "authentication_required"
    | "ready"
    | "rate_limited"
    | "unsupported_version"
    | "unsafe_configuration"
    | "unavailable"
    | "error"
    | undefined;
  authSummary?: string | undefined;
  diagnostics?: string[] | undefined;
}

export interface PublicBackendStatus {
  backendId: string;
  label: string;
  mode: "api" | "subscription_cli" | "local_http";
  status: "available" | "unavailable" | "placeholder";
  message?: string | undefined;
}

interface DesktopBackendStatus {
  backendId?: unknown;
  id?: unknown;
  label?: unknown;
  mode?: unknown;
  status?: unknown;
  message?: unknown;
}

export type AiExecutionProgressPhase =
  | "preparing_request"
  | "starting_backend"
  | "waiting_for_provider"
  | "validating_schema"
  | "repairing_output"
  | "building_project"
  | "complete"
  | "error"
  | "cancelled";

export type AiExecutionProgressStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type AiExecutionProgressDetailStatus = "pending" | "running" | "complete" | "error" | "cancelled";

export type VdtAgentStatus = "running" | "needs_user_input" | "succeeded" | "failed" | "cancelled";

export type VdtAgentPhase =
  | "classifying_request"
  | "retrieving_skills"
  | "reading_skills"
  | "planning_decomposition"
  | "asking_clarifying_questions"
  | "generating_graph"
  | "validating_graph"
  | "applying_graph"
  | "reporting";

export type VdtAgentEventType =
  | "classification"
  | "skill_search"
  | "skill_selected"
  | "skill_read"
  | "clarifying_questions"
  | "user_instruction"
  | "planning_decomposition"
  | "model_call_started"
  | "model_call_completed"
  | "web_search_started"
  | "web_search_completed"
  | "graph_validation"
  | "graph_patch"
  | "final_report"
  | "error";

export interface VdtAgentEvent {
  id: string;
  timestamp: string;
  type: VdtAgentEventType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface VdtAgentSelectedSkill {
  id: string;
  path: string;
  reason: string;
}

export interface VdtAgentRun {
  runId: string;
  status: VdtAgentStatus;
  phase: VdtAgentPhase;
  request: {
    rootKpi: string;
    industry?: string;
    businessContext?: string;
    unit?: string;
    timePeriod?: string;
    goal?: string;
    levelOfDetail?: string;
  };
  selectedSkills: VdtAgentSelectedSkill[];
  events: VdtAgentEvent[];
  questionsForUser?: string[];
  draftGraph?: unknown;
  resultProjectId?: string;
  finalReport?: string;
  error?: { code: string; message: string };
}

export interface AiExecutionProgressDetail {
  id: string;
  label: string;
  status: AiExecutionProgressDetailStatus;
}

export interface AiExecutionProgressEvent {
  requestId: string;
  phase: AiExecutionProgressPhase;
  label: string;
  status: AiExecutionProgressStatus;
  appMode: VdtAppMode;
  providerId?: string;
  backendId?: string;
  taskType?: VdtAiTaskType;
  schemaId?: string;
  updatedAt: string;
  outputBytes?: number;
  schemaValid?: boolean;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  error?: { code?: string; message: string };
  details?: AiExecutionProgressDetail[];
  agentRun?: VdtAgentRun;
}

export interface AiExecutionOptions {
  signal?: AbortSignal;
  onProgress?: (event: AiExecutionProgressEvent) => void;
  pollIntervalMs?: number;
}

interface RuntimeCompletionPayload {
  requestId: string;
  backendId: string;
  taskType: VdtAiTaskType;
  schemaId: string;
  input: unknown;
  model?: string;
  timeoutMs?: number;
}

interface DesktopCompletionPayload extends RuntimeCompletionPayload {
  providerId: string;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface AiCompletionRequest {
  taskType: Exclude<VdtAiTaskType, "generate_tree">;
  input: unknown;
  providerId: string;
  providerConfig?: Record<string, unknown> | undefined;
}

export interface GenerateTreeRequest extends GenerateVdtInput {
  providerId: string;
  providerConfig?: Record<string, unknown> | undefined;
}

export interface BackendTestRequest {
  providerId: string;
  providerConfig?: Record<string, unknown> | undefined;
}

export interface BackendTestResult {
  ok: boolean;
}

export interface DetectSubscriptionClisResult {
  agents: CliAgentDetectionSnapshot[];
  modelsByAgent: Partial<Record<CliAgentId, string[]>>;
}

export interface StandaloneRunnerPairResult {
  token: string;
}

export interface ProviderAuthActionResult {
  ok?: boolean;
  backendId?: string;
  action?: "instructions";
  label?: string;
  instructions?: string;
  docsUrl?: string;
}

export interface AiExecutionClient {
  getEnvironment(): Promise<VdtAppMode>;
  listBackends(): Promise<PublicBackendStatus[]>;
  testBackend(backendId: string, request: BackendTestRequest): Promise<BackendTestResult>;
  listModels(backendId: string): Promise<ModelOption[]>;
  complete(request: AiCompletionRequest, options?: AbortSignal | AiExecutionOptions): Promise<RunAiTaskResult>;
  cancel(requestId: string): Promise<void>;
  detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult>;
  openProviderAuth(backendId: string): Promise<ProviderAuthActionResult>;
  generateTree(request: GenerateTreeRequest, options?: AbortSignal | AiExecutionOptions): Promise<VdtProject>;
  pairStandaloneRunner(runnerUrl: string, code: string): Promise<StandaloneRunnerPairResult>;
  unpairStandaloneRunner(runnerUrl: string, token: string): Promise<void>;
}

function placeholderAgents(message: string, agentId?: CliAgentId): CliAgentDetectionSnapshot[] {
  const ids = agentId ? [agentId] : CLI_CATALOG.map((entry) => entry.id);
  return ids.map((id) => ({
    id,
    installed: false,
    executable: null,
    alias: null,
    version: null,
    status: "unavailable",
    authSummary: message,
    diagnostics: [message]
  }));
}

function apiBackends(): PublicBackendStatus[] {
  return [
    { backendId: "openai_compatible", label: "OpenAI-compatible API", mode: "api", status: "available" },
    { backendId: "anthropic", label: "Anthropic API", mode: "api", status: "available" },
    { backendId: "gemini", label: "Gemini API", mode: "api", status: "available" },
    { backendId: "azure_openai", label: "Azure OpenAI", mode: "api", status: "available" }
  ];
}

const API_BACKEND_IDS = new Set(["openai_compatible", "anthropic", "gemini", "azure_openai", "mock"]);
const TASK_SCHEMA_IDS = {
  generate_tree: "generate-tree-v1",
  deepen_node: "deepen-node-v1",
  simplify_branch: "simplify-branch-v1",
  suggest_alternative: "suggest-alternative-v1",
  suggest_formula: "suggest-formula-v1",
  review_model: "review-model-v1",
  check_units: "check-units-v1",
  identify_missing_drivers: "identify-missing-drivers-v1",
  identify_duplicate_drivers: "identify-duplicate-drivers-v1",
  explain_node: "explain-node-v1",
  explain_scenario: "explain-scenario-v1",
  generate_executive_summary: "generate-executive-summary-v1"
} satisfies Record<VdtAiTaskType, string>;

function isApiBackendId(backendId: string): boolean {
  return API_BACKEND_IDS.has(backendId);
}

const PROGRESS_LABELS: Record<AiExecutionProgressPhase, string> = {
  preparing_request: "Preparing request",
  starting_backend: "Starting backend",
  waiting_for_provider: "Provider execution",
  validating_schema: "Validating schema",
  repairing_output: "Repairing/normalizing output",
  building_project: "Building project",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled"
};

function normalizeExecutionOptions(options?: AbortSignal | AiExecutionOptions): AiExecutionOptions {
  if (
    options &&
    "aborted" in options &&
    typeof options.aborted === "boolean" &&
    "addEventListener" in options &&
    typeof options.addEventListener === "function"
  ) {
    return { signal: options as AbortSignal };
  }
  return (options as AiExecutionOptions | undefined) ?? {};
}

function emitProgress(
  options: AiExecutionOptions | undefined,
  event: Omit<AiExecutionProgressEvent, "label" | "updatedAt"> & { label?: string; updatedAt?: string }
): void {
  options?.onProgress?.({
    ...event,
    label: event.label ?? PROGRESS_LABELS[event.phase],
    updatedAt: event.updatedAt ?? new Date().toISOString()
  });
}

function abortProgressPhase(error: unknown): "cancelled" | "error" {
  return error instanceof Error && error.name === "AbortError" ? "cancelled" : "error";
}

interface RuntimeRunSnapshot {
  requestId?: unknown;
  backendId?: unknown;
  taskType?: unknown;
  schemaId?: unknown;
  status?: unknown;
  progress?: {
    phase?: unknown;
    label?: unknown;
    updatedAt?: unknown;
  };
  outputBytes?: unknown;
  schemaValid?: unknown;
  repairAttempted?: unknown;
  repairSucceeded?: unknown;
  agentRun?: unknown;
  error?: { code?: unknown; message?: unknown };
}

function isProgressPhase(value: unknown): value is AiExecutionProgressPhase {
  return typeof value === "string" && value in PROGRESS_LABELS;
}

function isProgressStatus(value: unknown): value is AiExecutionProgressStatus {
  return value === "pending" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function providerWorkLabel(backendId: string | undefined, providerId: string | undefined): string {
  const value = backendId ?? providerId ?? "provider";
  const labels: Record<string, string> = {
    claude_subscription: "Claude Code",
    codex_subscription: "Codex CLI",
    cursor_subscription: "Cursor Agent",
    gemini_subscription: "Gemini CLI",
    copilot_subscription: "GitHub Copilot CLI"
  };
  const known = labels[value];
  if (known) return known;
  return value
    .replace(/_subscription$/, "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isVdtAgentRun(value: unknown): value is VdtAgentRun {
  const record = asRecord(value);
  if (!record) return false;
  return (
    typeof record.runId === "string" &&
    typeof record.status === "string" &&
    typeof record.phase === "string" &&
    Array.isArray(record.selectedSkills) &&
    Array.isArray(record.events)
  );
}

function lifecycleDetails(input: {
  phase: AiExecutionProgressPhase;
  status: AiExecutionProgressStatus;
  backendId?: string;
  providerId?: string;
  schemaId?: string;
  taskType?: VdtAiTaskType;
  requestInput?: unknown;
}): AiExecutionProgressDetail[] {
  const terminalError = input.phase === "error" || input.status === "failed";
  const terminalCancel = input.phase === "cancelled" || input.status === "cancelled";
  const terminalComplete = input.phase === "complete" || input.status === "succeeded";
  const afterWaiting =
    terminalComplete ||
    input.phase === "validating_schema" ||
    input.phase === "repairing_output" ||
    input.phase === "building_project";
  const providerStatus: AiExecutionProgressDetailStatus =
    terminalError ? "error" : terminalCancel ? "cancelled" : afterWaiting ? "complete" : "running";
  const validationStatus: AiExecutionProgressDetailStatus =
    terminalError || terminalCancel
      ? "pending"
      : terminalComplete || input.phase === "building_project"
        ? "complete"
        : input.phase === "validating_schema" || input.phase === "repairing_output"
          ? "running"
          : "pending";
  const canvasStatus: AiExecutionProgressDetailStatus =
    terminalError || terminalCancel
      ? "pending"
      : terminalComplete
        ? "complete"
        : input.phase === "building_project"
          ? "running"
          : "pending";
  const framingStatus: AiExecutionProgressDetailStatus =
    input.phase === "preparing_request"
      ? "running"
      : terminalError || terminalCancel
        ? "complete"
        : "complete";
  const driverStatus: AiExecutionProgressDetailStatus =
    input.phase === "preparing_request"
      ? "pending"
      : input.phase === "starting_backend"
        ? "running"
        : terminalError || terminalCancel || input.phase === "waiting_for_provider" || afterWaiting
          ? "complete"
          : "pending";
  const providerLabel = providerWorkLabel(input.backendId, undefined);
  const schemaLabel = input.schemaId ?? "task schema";
  const taskLabel = input.taskType ?? "AI task";

  return [
    {
      id: "request-prepared",
      label: `Request prepared for ${taskLabel}.`,
      status: framingStatus
    },
    {
      id: "backend-started",
      label: `${providerLabel} backend selected.`,
      status: driverStatus
    },
    {
      id: "provider-request",
      label: `Provider request running for ${schemaLabel}.`,
      status: providerStatus
    },
    {
      id: "schema-validation",
      label: `Schema validation for ${schemaLabel}.`,
      status: validationStatus
    },
    {
      id: "canvas-build",
      label: "Canvas project build.",
      status: canvasStatus
    }
  ];
}

function progressFromRuntimeRun(
  run: RuntimeRunSnapshot,
  appMode: VdtAppMode,
  providerId?: string
): AiExecutionProgressEvent | undefined {
  const requestId = typeof run.requestId === "string" ? run.requestId : undefined;
  if (!requestId) return undefined;
  const phase = isProgressPhase(run.progress?.phase) ? run.progress.phase : statusToPhase(run.status);
  const status = isProgressStatus(run.status) ? run.status : phase === "complete" ? "succeeded" : "running";
  const errorMessage = typeof run.error?.message === "string" ? run.error.message : undefined;
  return {
    requestId,
    phase,
    label: typeof run.progress?.label === "string" ? run.progress.label : PROGRESS_LABELS[phase],
    status,
    appMode,
    ...(providerId === undefined ? {} : { providerId }),
    ...(typeof run.backendId === "string" ? { backendId: run.backendId } : {}),
    ...(typeof run.taskType === "string" ? { taskType: run.taskType as VdtAiTaskType } : {}),
    ...(typeof run.schemaId === "string" ? { schemaId: run.schemaId } : {}),
    updatedAt: typeof run.progress?.updatedAt === "string" ? run.progress.updatedAt : new Date().toISOString(),
    ...(typeof run.outputBytes === "number" ? { outputBytes: run.outputBytes } : {}),
    ...(typeof run.schemaValid === "boolean" ? { schemaValid: run.schemaValid } : {}),
    ...(typeof run.repairAttempted === "boolean" ? { repairAttempted: run.repairAttempted } : {}),
    ...(typeof run.repairSucceeded === "boolean" ? { repairSucceeded: run.repairSucceeded } : {}),
    ...(errorMessage === undefined
      ? {}
      : {
          error: {
            ...(typeof run.error?.code === "string" ? { code: run.error.code } : {}),
            message: errorMessage
          }
        }),
    details: lifecycleDetails({
      phase,
      status,
      ...(typeof run.backendId === "string" ? { backendId: run.backendId } : {}),
      ...(typeof run.taskType === "string" ? { taskType: run.taskType as VdtAiTaskType } : {}),
      ...(typeof run.schemaId === "string" ? { schemaId: run.schemaId } : {})
    }),
    ...(isVdtAgentRun(run.agentRun) ? { agentRun: run.agentRun } : {})
  };
}

function statusToPhase(status: unknown): AiExecutionProgressPhase {
  if (status === "succeeded") return "complete";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  return "waiting_for_provider";
}

function createDefaultFetcher(): Fetcher {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("fetch is not available in this environment.");
  }
  return globalThis.fetch.bind(globalThis) as Fetcher;
}

function normalizeFetcher(fetcher: Fetcher): Fetcher {
  return typeof globalThis.fetch === "function" && fetcher === globalThis.fetch
    ? (fetcher.bind(globalThis) as Fetcher)
    : fetcher;
}

function providerConfigValue(config: Record<string, unknown> | undefined, key: string): unknown {
  return config && Object.prototype.hasOwnProperty.call(config, key) ? config[key] : undefined;
}

function desktopBackendId(providerId: string, providerConfig: Record<string, unknown> | undefined): string {
  const configured = providerConfigValue(providerConfig, "backendId");
  return typeof configured === "string" && configured.length > 0 ? configured : providerId;
}

function desktopModel(providerConfig: Record<string, unknown> | undefined): string | undefined {
  const model = providerConfigValue(providerConfig, "model");
  return typeof model === "string" && model.length > 0 ? model : undefined;
}

function desktopTimeoutMs(providerConfig: Record<string, unknown> | undefined): number | undefined {
  const timeoutMs = providerConfigValue(providerConfig, "timeoutMs");
  return typeof timeoutMs === "number" && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
}

function runtimeTimeoutMs(
  taskType: VdtAiTaskType,
  backendId: string,
  providerConfig: Record<string, unknown> | undefined
): number | undefined {
  const timeoutMs = desktopTimeoutMs(providerConfig);
  if (taskType === "generate_tree" && backendId.endsWith("_subscription")) {
    return Math.max(timeoutMs ?? 0, 120_000);
  }
  return timeoutMs;
}

function buildRuntimeCompletionRequest(
  taskType: VdtAiTaskType,
  input: unknown,
  providerId: string,
  providerConfig: Record<string, unknown> | undefined
): RuntimeCompletionPayload {
  const model = desktopModel(providerConfig);
  const backendId = desktopBackendId(providerId, providerConfig);
  const timeoutMs = runtimeTimeoutMs(taskType, backendId, providerConfig);
  return {
    requestId: crypto.randomUUID(),
    backendId,
    taskType,
    schemaId: TASK_SCHEMA_IDS[taskType],
    input,
    ...(model === undefined ? {} : { model }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  };
}

function buildDesktopCompletionRequest(
  taskType: VdtAiTaskType,
  input: unknown,
  providerId: string,
  providerConfig: Record<string, unknown> | undefined
): DesktopCompletionPayload {
  return {
    ...buildRuntimeCompletionRequest(taskType, input, providerId, providerConfig),
    providerId
  };
}

function resolveDesktopInvoke(source: DesktopBridgeGlobal = globalThis as DesktopBridgeGlobal): DesktopInvoke | undefined {
  const bridge = source.__TAURI__;
  const coreInvoke = bridge?.core?.invoke;
  if (typeof coreInvoke === "function") return coreInvoke as DesktopInvoke;
  const legacyInvoke = bridge?.invoke;
  return typeof legacyInvoke === "function" ? legacyInvoke as DesktopInvoke : undefined;
}

function normalizeDesktopBackend(entry: DesktopBackendStatus): PublicBackendStatus | undefined {
  const backendId = typeof entry.backendId === "string" ? entry.backendId : typeof entry.id === "string" ? entry.id : undefined;
  const label = typeof entry.label === "string" ? entry.label : backendId;
  const mode = entry.mode === "api" || entry.mode === "subscription_cli" || entry.mode === "local_http" ? entry.mode : undefined;
  const status =
    entry.status === "available" || entry.status === "unavailable" || entry.status === "placeholder"
      ? entry.status
      : undefined;
  if (!backendId || !label || !mode || !status) return undefined;
  return {
    backendId,
    label,
    mode,
    status,
    ...(typeof entry.message === "string" ? { message: entry.message } : {})
  };
}

function isVdtProject(value: unknown): value is VdtProject {
  return typeof value === "object" && value !== null && "id" in value && "rootNodeId" in value && "graph" in value;
}

function isRunAiTaskResult(value: unknown): value is RunAiTaskResult {
  return typeof value === "object" && value !== null && "kind" in value;
}

function unwrapDesktopProject(value: unknown, input: GenerateVdtInput, providerId: string): VdtProject {
  if (isVdtProject(value)) return value;
  if (isRunAiTaskResult(value) && value.kind === "project") return value.project;
  if (typeof value === "object" && value !== null && "project" in value && isVdtProject((value as { project?: unknown }).project)) {
    return (value as { project: VdtProject }).project;
  }
  if (typeof value === "object" && value !== null && "output" in value) {
    const wrappedOutput = (value as { output?: unknown }).output;
    if (isVdtProject(wrappedOutput)) return wrappedOutput;
    const output = generateVdtOutputSchema.parse(wrappedOutput);
    return generateVdtOutputToProject(output, input, providerId);
  }
  const output = generateVdtOutputSchema.parse(value);
  return generateVdtOutputToProject(output, input, providerId);
}

function unwrapDesktopRunResult(value: unknown, request?: RuntimeCompletionPayload): RunAiTaskResult {
  if (isRunAiTaskResult(value)) return value;
  if (typeof value === "object" && value !== null && "result" in value && isRunAiTaskResult((value as { result?: unknown }).result)) {
    return (value as { result: RunAiTaskResult }).result;
  }
  const agentRun = agentRunFromCompletionResult(value);
  const record = asRecord(value);
  const mappedWrapped = request && record && "output" in record
    ? runResultFromRuntimeOutput(record.output, request, agentRun)
    : undefined;
  if (mappedWrapped) return mappedWrapped;
  const mappedRaw = request ? runResultFromRuntimeOutput(value, request, agentRun) : undefined;
  if (mappedRaw) return mappedRaw;
  throw new Error("Desktop runtime returned an unsupported AI task result.");
}

function runResultFromRuntimeOutput(
  value: unknown,
  request: RuntimeCompletionPayload,
  agentRun?: VdtAgentRun
): RunAiTaskResult | undefined {
  if (isRunAiTaskResult(value)) return value;
  if (request.taskType !== "deepen_node") return undefined;
  const input = asRecord(request.input);
  const project = input?.project;
  const nodeId = input?.nodeId;
  if (!isVdtProject(project) || typeof nodeId !== "string") return undefined;
  const { changeSet } = validateAndMapDeepenNode(project, value, nodeId, request.backendId);
  return { kind: "change_set", changeSet, ...(agentRun ? { agentRun } : {}) };
}

function agentRunFromCompletionResult(value: unknown): VdtAgentRun | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (isVdtAgentRun(record.agentRun)) return record.agentRun;
  const runRecord = asRecord(record.run);
  if (isVdtAgentRun(runRecord?.agentRun)) return runRecord.agentRun;
  return undefined;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  let payload: T & { error?: unknown };

  if (typeof response.text === "function") {
    const raw = await response.text();
    try {
      payload = (raw ? JSON.parse(raw) : {}) as T & { error?: unknown };
    } catch {
      const contentType = response.headers.get("content-type") ?? "unknown content type";
      const responseKind = contentType.includes("text/html")
        ? "The server returned HTML instead of JSON."
        : `The server returned ${contentType} instead of JSON.`;
      throw new Error(`${fallbackMessage} HTTP ${response.status}. ${responseKind}`);
    }
  } else if (typeof (response as { json?: unknown }).json === "function") {
    payload = await (response as { json: () => Promise<T & { error?: unknown }> }).json();
  } else {
    throw new Error(`${fallbackMessage} HTTP ${response.status}. The server returned an unreadable response.`);
  }

  if (!response.ok) {
    const error =
      typeof payload.error === "string"
        ? payload.error
        : payload.error && typeof payload.error === "object" && "message" in payload.error
          ? String((payload.error as { message?: unknown }).message)
          : fallbackMessage;
    throw new Error(error);
  }
  return payload;
}

abstract class BaseWebAiExecutionClient implements AiExecutionClient {
  protected readonly fetcher: Fetcher;

  constructor(
    protected readonly appMode: VdtAppMode,
    fetcher: Fetcher
  ) {
    this.fetcher = normalizeFetcher(fetcher);
  }

  async getEnvironment(): Promise<VdtAppMode> {
    return this.appMode;
  }

  async listBackends(): Promise<PublicBackendStatus[]> {
    return apiBackends();
  }

  async testBackend(backendId: string, request: BackendTestRequest): Promise<BackendTestResult> {
    void backendId;
    const response = await this.fetcher("/api/ai/generate-vdt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "connection_test",
        providerId: request.providerId,
        providerConfig: request.providerConfig
      })
    });
    const payload = await readJsonResponse<{ ok?: boolean; error?: string }>(response, "Backend test failed.");
    if (!payload.ok) throw new Error(payload.error ?? "Backend test failed.");
    return { ok: true };
  }

  async listModels(backendId: string): Promise<ModelOption[]> {
    void backendId;
    return [];
  }

  async complete(request: AiCompletionRequest, options?: AbortSignal | AiExecutionOptions): Promise<RunAiTaskResult> {
    const execution = normalizeExecutionOptions(options);
    const requestId = crypto.randomUUID();
    emitProgress(execution, {
      requestId,
      phase: "preparing_request",
      status: "pending",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.providerId,
      taskType: request.taskType,
      schemaId: TASK_SCHEMA_IDS[request.taskType]
    });
    emitProgress(execution, {
      requestId,
      phase: "waiting_for_provider",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.providerId,
      taskType: request.taskType,
      schemaId: TASK_SCHEMA_IDS[request.taskType],
      details: lifecycleDetails({
        phase: "waiting_for_provider",
        status: "running",
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: request.taskType,
        schemaId: TASK_SCHEMA_IDS[request.taskType],
        requestInput: request.input
      })
    });
    try {
      const response = await this.fetcher("/api/ai/run-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(execution.signal ? { signal: execution.signal } : {}),
        body: JSON.stringify(request)
      });
      const payload = await readJsonResponse<{ ok?: boolean; result?: RunAiTaskResult; error?: string }>(
        response,
        "AI task failed."
      );
      if (!payload.ok || !payload.result) throw new Error(payload.error ?? "AI task response could not be parsed.");
      const agentRun = agentRunFromCompletionResult(payload.result);
      emitProgress(execution, {
        requestId,
        phase: "complete",
        status: "succeeded",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: request.taskType,
        schemaId: TASK_SCHEMA_IDS[request.taskType],
        ...(agentRun ? { agentRun } : {})
      });
      return payload.result;
    } catch (error) {
      const phase = abortProgressPhase(error);
      emitProgress(execution, {
        requestId,
        phase,
        status: phase === "cancelled" ? "cancelled" : "failed",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: request.taskType,
        schemaId: TASK_SCHEMA_IDS[request.taskType],
        error: { message: error instanceof Error ? error.message : "AI task failed." }
      });
      throw error;
    }
  }

  async cancel(requestId: string): Promise<void> {
    void requestId;
    // Route-level cancellation is owned by the local runtime/desktop client. Hosted route requests use AbortSignal.
  }

  async generateTree(request: GenerateTreeRequest, options?: AbortSignal | AiExecutionOptions): Promise<VdtProject> {
    const execution = normalizeExecutionOptions(options);
    const requestId = crypto.randomUUID();
    emitProgress(execution, {
      requestId,
      phase: "preparing_request",
      status: "pending",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.providerId,
      taskType: "generate_tree",
      schemaId: TASK_SCHEMA_IDS.generate_tree
    });
    emitProgress(execution, {
      requestId,
      phase: "waiting_for_provider",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.providerId,
      taskType: "generate_tree",
      schemaId: TASK_SCHEMA_IDS.generate_tree,
      details: lifecycleDetails({
        phase: "waiting_for_provider",
        status: "running",
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: "generate_tree",
        schemaId: TASK_SCHEMA_IDS.generate_tree,
        requestInput: request
      })
    });
    try {
      const response = await this.fetcher("/api/ai/generate-vdt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(execution.signal ? { signal: execution.signal } : {}),
        body: JSON.stringify(request)
      });
      const payload = await readJsonResponse<{ ok?: boolean; project?: VdtProject; agentRun?: unknown; error?: string }>(
        response,
        "AI response could not be parsed."
      );
      if (!payload.ok || !payload.project) throw new Error(payload.error ?? "AI response could not be parsed.");
      const agentRun = isVdtAgentRun(payload.agentRun) ? payload.agentRun : undefined;
      emitProgress(execution, {
        requestId,
        phase: "building_project",
        status: "running",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: "generate_tree",
        schemaId: TASK_SCHEMA_IDS.generate_tree,
        ...(agentRun ? { agentRun } : {})
      });
      emitProgress(execution, {
        requestId,
        phase: "complete",
        status: "succeeded",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: "generate_tree",
        schemaId: TASK_SCHEMA_IDS.generate_tree,
        ...(agentRun ? { agentRun } : {})
      });
      return payload.project;
    } catch (error) {
      const phase = abortProgressPhase(error);
      emitProgress(execution, {
        requestId,
        phase,
        status: phase === "cancelled" ? "cancelled" : "failed",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.providerId,
        taskType: "generate_tree",
        schemaId: TASK_SCHEMA_IDS.generate_tree,
        error: { message: error instanceof Error ? error.message : "AI response could not be parsed." }
      });
      throw error;
    }
  }

  async pairStandaloneRunner(runnerUrl: string, code: string): Promise<StandaloneRunnerPairResult> {
    const response = await this.fetcher(`${runnerUrl.replace(/\/$/, "")}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code })
    });
    const payload = await readJsonResponse<{
      ok?: boolean;
      session?: { token?: string };
      error?: { message?: string } | string;
    }>(response, "Runner pairing failed.");
    const token = payload.session?.token;
    if (!payload.ok || !token) {
      const error = typeof payload.error === "object" ? payload.error?.message : payload.error;
      throw new Error(error ?? "Runner pairing failed.");
    }
    return { token };
  }

  async unpairStandaloneRunner(runnerUrl: string, token: string): Promise<void> {
    await this.fetcher(`${runnerUrl.replace(/\/$/, "")}/v1/unpair`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}"
    });
  }

  abstract detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult>;

  async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    void backendId;
    throw new Error("Provider authentication actions are available in VDT Studio Desktop.");
  }
}

export class HostedApiExecutionClient extends BaseWebAiExecutionClient {
  constructor(fetcher: Fetcher = createDefaultFetcher()) {
    super("hosted_web", fetcher);
  }

  async detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult> {
    return { agents: placeholderAgents(HOSTED_WEB_LOCAL_AI_MESSAGE, agentId), modelsByAgent: {} };
  }

  override async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    void backendId;
    throw new Error(HOSTED_WEB_LOCAL_AI_MESSAGE);
  }
}

export class DevelopmentRunnerClient extends BaseWebAiExecutionClient {
  constructor(fetcher: Fetcher = createDefaultFetcher()) {
    super("development_web", fetcher);
  }

  override async listBackends(): Promise<PublicBackendStatus[]> {
    return [
      ...apiBackends(),
      { backendId: "standalone_runner", label: "Standalone runner", mode: "local_http", status: "available" }
    ];
  }

  async detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult> {
    const url = agentId ? `/api/ai/detect-clis?id=${encodeURIComponent(agentId)}` : "/api/ai/detect-clis";
    const response = await this.fetcher(url);
    const payload = await readJsonResponse<{
      agents?: CliAgentDetectionSnapshot[];
      modelsByAgent?: Partial<Record<CliAgentId, string[]>>;
      error?: string;
    }>(response, "CLI detection failed.");
    if (!payload.agents) throw new Error(payload.error ?? "CLI detection failed.");
    return { agents: payload.agents, modelsByAgent: payload.modelsByAgent ?? {} };
  }

  override async testBackend(backendId: string, request: BackendTestRequest): Promise<BackendTestResult> {
    if (isApiBackendId(backendId) || isApiBackendId(request.providerId)) return super.testBackend(backendId, request);
    const response = await this.fetcher("/api/ai/dev-runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "test", backendId })
    });
    const payload = await readJsonResponse<{ ok?: boolean; error?: string | { message?: string } }>(
      response,
      "Backend test failed."
    );
    if (!payload.ok) throw new Error("Backend test failed.");
    return { ok: true };
  }

  override async complete(request: AiCompletionRequest, options?: AbortSignal | AiExecutionOptions): Promise<RunAiTaskResult> {
    if (isApiBackendId(request.providerId)) return super.complete(request, options);
    const execution = normalizeExecutionOptions(options);
    const completion = buildRuntimeCompletionRequest(request.taskType, request.input, request.providerId, request.providerConfig);
    const result = await this.invokeDevelopmentRuntimeCompletion(
      completion,
      request.providerId,
      execution
    );
    const runResult = unwrapDesktopRunResult(result, completion);
    const agentRun = agentRunFromCompletionResult(result) ?? (runResult.kind === "change_set" ? runResult.agentRun : undefined);
    emitProgress(execution, {
      requestId: completion.requestId,
      phase: "complete",
      status: "succeeded",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completion.backendId,
      taskType: completion.taskType,
      schemaId: completion.schemaId,
      ...(agentRun ? { agentRun } : {})
    });
    return runResult;
  }

  override async generateTree(request: GenerateTreeRequest, options?: AbortSignal | AiExecutionOptions): Promise<VdtProject> {
    if (isApiBackendId(request.providerId)) return super.generateTree(request, options);
    const execution = normalizeExecutionOptions(options);
    const completionRequest = buildRuntimeCompletionRequest("generate_tree", request, request.providerId, request.providerConfig);
    const result = await this.invokeDevelopmentRuntimeCompletion(
      completionRequest,
      request.providerId,
      execution
    );
    const agentRun = agentRunFromCompletionResult(result);
    emitProgress(execution, {
      requestId: completionRequest.requestId,
      phase: "building_project",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completionRequest.backendId,
      taskType: completionRequest.taskType,
      schemaId: completionRequest.schemaId,
      ...(agentRun ? { agentRun } : {}),
      details: lifecycleDetails({
        phase: "building_project",
        status: "running",
        providerId: request.providerId,
        backendId: completionRequest.backendId,
        taskType: completionRequest.taskType,
        schemaId: completionRequest.schemaId,
        requestInput: completionRequest.input
      })
    });
    const project = unwrapDesktopProject(result, request, request.providerId);
    emitProgress(execution, {
      requestId: completionRequest.requestId,
      phase: "complete",
      status: "succeeded",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completionRequest.backendId,
      taskType: completionRequest.taskType,
      schemaId: completionRequest.schemaId,
      ...(agentRun ? { agentRun } : {})
    });
    return project;
  }

  private async pollDevelopmentRuntimeRun(request: RuntimeCompletionPayload, providerId: string, options: AiExecutionOptions): Promise<void> {
    const response = await this.fetcher("/api/ai/dev-runtime", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "run", requestId: request.requestId })
    });
    if (!response.ok) return;
    const payload = await response.json() as { ok?: boolean; run?: RuntimeRunSnapshot };
    if (!payload.ok || !payload.run) return;
    const event = progressFromRuntimeRun(payload.run, this.appMode, providerId);
    if (event) options.onProgress?.(event);
  }

  private startDevelopmentRuntimePolling(
    request: RuntimeCompletionPayload,
    providerId: string,
    options: AiExecutionOptions
  ): () => void {
    if (!options.onProgress) return () => undefined;
    let stopped = false;
    let polling = false;
    const intervalMs = Math.max(50, options.pollIntervalMs ?? 750);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (stopped || polling) return;
      polling = true;
      void this.pollDevelopmentRuntimeRun(request, providerId, options)
        .catch(() => undefined)
        .finally(() => {
          polling = false;
          if (!stopped) timer = setTimeout(tick, intervalMs);
        });
    };
    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  private async invokeDevelopmentRuntimeCompletion(
    request: RuntimeCompletionPayload,
    providerId: string,
    options: AiExecutionOptions
  ): Promise<unknown> {
    emitProgress(options, {
      requestId: request.requestId,
      phase: "preparing_request",
      status: "pending",
      appMode: this.appMode,
      providerId,
      backendId: request.backendId,
      taskType: request.taskType,
      schemaId: request.schemaId
    });
    if (options.signal?.aborted) {
      await this.cancel(request.requestId).catch(() => undefined);
      const error = new DOMException("The operation was aborted.", "AbortError");
      emitProgress(options, {
        requestId: request.requestId,
        phase: "cancelled",
        status: "cancelled",
        appMode: this.appMode,
        providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        error: { message: error.message }
      });
      throw error;
    }
    emitProgress(options, {
      requestId: request.requestId,
      phase: "starting_backend",
      status: "running",
      appMode: this.appMode,
      providerId,
      backendId: request.backendId,
      taskType: request.taskType,
      schemaId: request.schemaId,
      details: lifecycleDetails({
        phase: "starting_backend",
        status: "running",
        providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        requestInput: request.input
      })
    });
    const abort = () => {
      void this.cancel(request.requestId).catch(() => undefined);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const stopPolling = this.startDevelopmentRuntimePolling(request, providerId, options);
    try {
      emitProgress(options, {
        requestId: request.requestId,
        phase: "waiting_for_provider",
        status: "running",
        appMode: this.appMode,
        providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        details: lifecycleDetails({
          phase: "waiting_for_provider",
          status: "running",
          providerId,
          backendId: request.backendId,
          taskType: request.taskType,
          schemaId: request.schemaId,
          requestInput: request.input
        })
      });
      const response = await this.fetcher("/api/ai/dev-runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(options.signal ? { signal: options.signal } : {}),
        body: JSON.stringify({ operation: "complete", request })
      });
      const payload = await readJsonResponse<{
        ok?: boolean;
        output?: unknown;
        run?: RuntimeRunSnapshot;
        error?: string | { message?: string };
      }>(response, "Development runtime completion failed.");
      if (payload.run) {
        const event = progressFromRuntimeRun(payload.run, this.appMode, providerId);
        if (event && !(request.taskType !== "generate_tree" && event.phase === "complete")) {
          options.onProgress?.(event);
        }
        if (payload.run.repairAttempted === true) {
          emitProgress(options, {
            requestId: request.requestId,
            phase: "repairing_output",
            status: payload.run.repairSucceeded === false ? "failed" : "running",
            appMode: this.appMode,
            providerId,
            backendId: request.backendId,
            taskType: request.taskType,
            schemaId: request.schemaId,
            repairAttempted: true,
            repairSucceeded: payload.run.repairSucceeded === true,
            details: lifecycleDetails({
              phase: "repairing_output",
              status: payload.run.repairSucceeded === false ? "failed" : "running",
              providerId,
              backendId: request.backendId,
              taskType: request.taskType,
              schemaId: request.schemaId,
              requestInput: request.input
            })
          });
        }
        if (payload.run.schemaValid === true) {
          emitProgress(options, {
            requestId: request.requestId,
            phase: "validating_schema",
            status: "running",
            appMode: this.appMode,
            providerId,
            backendId: request.backendId,
            taskType: request.taskType,
            schemaId: request.schemaId,
            schemaValid: true,
            details: lifecycleDetails({
              phase: "validating_schema",
              status: "running",
              providerId,
              backendId: request.backendId,
              taskType: request.taskType,
              schemaId: request.schemaId,
              requestInput: request.input
            })
          });
        }
      }
      if (!payload.ok || payload.output === undefined) {
        throw new Error("Development runtime completion failed.");
      }
      return { output: payload.output, ...(payload.run ? { run: payload.run } : {}) };
    } catch (error) {
      const phase = abortProgressPhase(error);
      emitProgress(options, {
        requestId: request.requestId,
        phase,
        status: phase === "cancelled" ? "cancelled" : "failed",
        appMode: this.appMode,
        providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        error: { message: error instanceof Error ? error.message : "Development runtime completion failed." },
        details: lifecycleDetails({
          phase,
          status: phase === "cancelled" ? "cancelled" : "failed",
          providerId,
          backendId: request.backendId,
          taskType: request.taskType,
          schemaId: request.schemaId,
          requestInput: request.input
        })
      });
      throw error;
    } finally {
      stopPolling();
      options.signal?.removeEventListener("abort", abort);
    }
  }

  override async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    void backendId;
    throw new Error("Standalone runner authentication actions are not available in development web mode.");
  }
}

export class DesktopAiExecutionClient extends BaseWebAiExecutionClient {
  constructor(fetcher: Fetcher = createDefaultFetcher(), private readonly invoke: DesktopInvoke | undefined = resolveDesktopInvoke()) {
    super("desktop", fetcher);
  }

  private requireInvoke(): DesktopInvoke {
    if (!this.invoke) throw new Error(DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE);
    return this.invoke;
  }

  override async listBackends(): Promise<PublicBackendStatus[]> {
    if (this.invoke) {
      const desktopBackends = await this.invoke("ai_list_backends") as DesktopBackendStatus[];
      return [...apiBackends(), ...desktopBackends.map(normalizeDesktopBackend).filter((entry): entry is PublicBackendStatus => Boolean(entry))];
    }
    return [
      ...apiBackends(),
      {
        backendId: "desktop_local_ai",
        label: "Desktop Local AI",
        mode: "subscription_cli",
        status: "placeholder",
        message: DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE
      }
    ];
  }

  override async testBackend(backendId: string, request: BackendTestRequest): Promise<BackendTestResult> {
    if (isApiBackendId(backendId)) return super.testBackend(backendId, request);
    const result = await this.requireInvoke()("ai_test_backend", { backendId }) as BackendTestResult | void;
    return result && typeof result === "object" && "ok" in result ? { ok: Boolean(result.ok) } : { ok: true };
  }

  override async listModels(backendId: string): Promise<ModelOption[]> {
    if (isApiBackendId(backendId)) return [];
    const models = await this.requireInvoke()("ai_list_models", { backendId }) as Array<string | ModelOption>;
    return models.map((model) => typeof model === "string" ? { id: model, label: model } : model);
  }

  override async generateTree(request: GenerateTreeRequest, options?: AbortSignal | AiExecutionOptions): Promise<VdtProject> {
    if (isApiBackendId(request.providerId)) return super.generateTree(request, options);
    const execution = normalizeExecutionOptions(options);
    const completion = this.buildDesktopCompletionRequest("generate_tree", request, request.providerId, request.providerConfig);
    const result = await this.invokeDesktopCompletion(completion, execution);
    const agentRun = agentRunFromCompletionResult(result);
    emitProgress(execution, {
      requestId: completion.requestId,
      phase: "building_project",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completion.backendId,
      taskType: completion.taskType,
      schemaId: completion.schemaId,
      ...(agentRun ? { agentRun } : {}),
      details: lifecycleDetails({
        phase: "building_project",
        status: "running",
        providerId: request.providerId,
        backendId: completion.backendId,
        taskType: completion.taskType,
        schemaId: completion.schemaId,
        requestInput: request
      })
    });
    const project = unwrapDesktopProject(result, request, request.providerId);
    emitProgress(execution, {
      requestId: completion.requestId,
      phase: "complete",
      status: "succeeded",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completion.backendId,
      taskType: completion.taskType,
      schemaId: completion.schemaId,
      ...(agentRun ? { agentRun } : {})
    });
    return project;
  }

  private buildDesktopCompletionRequest(
    taskType: VdtAiTaskType,
    input: unknown,
    providerId: string,
    providerConfig: Record<string, unknown> | undefined
  ): DesktopCompletionPayload {
    return buildDesktopCompletionRequest(taskType, input, providerId, providerConfig);
  }

  private async invokeDesktopCompletion(request: DesktopCompletionPayload, options: AiExecutionOptions): Promise<unknown> {
    emitProgress(options, {
      requestId: request.requestId,
      phase: "preparing_request",
      status: "pending",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.backendId,
      taskType: request.taskType,
      schemaId: request.schemaId
    });
    let invoke: DesktopInvoke;
    try {
      invoke = this.requireInvoke();
    } catch (error) {
      emitProgress(options, {
        requestId: request.requestId,
        phase: "error",
        status: "failed",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        error: { message: error instanceof Error ? error.message : DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE }
      });
      throw error;
    }
    if (options.signal?.aborted) {
      await invoke("ai_cancel", { requestId: request.requestId }).catch(() => undefined);
      const error = new DOMException("The operation was aborted.", "AbortError");
      emitProgress(options, {
        requestId: request.requestId,
        phase: "cancelled",
        status: "cancelled",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        error: { message: error.message }
      });
      throw error;
    }
    emitProgress(options, {
      requestId: request.requestId,
      phase: "starting_backend",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.backendId,
      taskType: request.taskType,
      schemaId: request.schemaId,
      details: lifecycleDetails({
        phase: "starting_backend",
        status: "running",
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        requestInput: request.input
      })
    });
    emitProgress(options, {
      requestId: request.requestId,
      phase: "waiting_for_provider",
      status: "running",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: request.backendId,
      taskType: request.taskType,
      schemaId: request.schemaId,
      details: lifecycleDetails({
        phase: "waiting_for_provider",
        status: "running",
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        requestInput: request.input
      })
    });
    const abort = () => {
      void invoke("ai_cancel", { requestId: request.requestId }).catch(() => undefined);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await invoke("ai_complete", { request });
      emitProgress(options, {
        requestId: request.requestId,
        phase: "validating_schema",
        status: "running",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        details: lifecycleDetails({
          phase: "validating_schema",
          status: "running",
          providerId: request.providerId,
          backendId: request.backendId,
          taskType: request.taskType,
          schemaId: request.schemaId,
          requestInput: request.input
        })
      });
      return result;
    } catch (error) {
      const phase = abortProgressPhase(error);
      emitProgress(options, {
        requestId: request.requestId,
        phase,
        status: phase === "cancelled" ? "cancelled" : "failed",
        appMode: this.appMode,
        providerId: request.providerId,
        backendId: request.backendId,
        taskType: request.taskType,
        schemaId: request.schemaId,
        error: { message: error instanceof Error ? error.message : DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE },
        details: lifecycleDetails({
          phase,
          status: phase === "cancelled" ? "cancelled" : "failed",
          providerId: request.providerId,
          backendId: request.backendId,
          taskType: request.taskType,
          schemaId: request.schemaId,
          requestInput: request.input
        })
      });
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }

  override async complete(request: AiCompletionRequest, options?: AbortSignal | AiExecutionOptions): Promise<RunAiTaskResult> {
    if (isApiBackendId(request.providerId)) return super.complete(request, options);
    const execution = normalizeExecutionOptions(options);
    const completion = this.buildDesktopCompletionRequest(request.taskType, request.input, request.providerId, request.providerConfig);
    const result = await this.invokeDesktopCompletion(completion, execution);
    const runResult = unwrapDesktopRunResult(result, completion);
    const agentRun = agentRunFromCompletionResult(result) ?? (runResult.kind === "change_set" ? runResult.agentRun : undefined);
    emitProgress(execution, {
      requestId: completion.requestId,
      phase: "complete",
      status: "succeeded",
      appMode: this.appMode,
      providerId: request.providerId,
      backendId: completion.backendId,
      taskType: request.taskType,
      schemaId: completion.schemaId,
      ...(agentRun ? { agentRun } : {})
    });
    return runResult;
  }

  override async cancel(requestId: string): Promise<void> {
    await this.requireInvoke()("ai_cancel", { requestId });
  }

  async detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult> {
    if (!this.invoke) return { agents: placeholderAgents(DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE, agentId), modelsByAgent: {} };
    const payload = await this.invoke("ai_detect_subscription_clis", agentId ? { agentId } : {}) as Partial<DetectSubscriptionClisResult> & {
      ok?: boolean;
      error?: unknown;
    };
    if (!payload.agents) {
      const error = typeof payload.error === "string" ? payload.error : "Desktop CLI detection failed.";
      throw new Error(error);
    }
    return { agents: payload.agents, modelsByAgent: payload.modelsByAgent ?? {} };
  }

  override async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    return await this.requireInvoke()("open_provider_auth", { backendId }) as ProviderAuthActionResult;
  }
}

export function createAiExecutionClient(
  appMode: VdtAppMode = resolveVdtAppMode(),
  fetcher: Fetcher = createDefaultFetcher()
): AiExecutionClient {
  if (appMode === "hosted_web") return new HostedApiExecutionClient(fetcher);
  if (appMode === "desktop") return new DesktopAiExecutionClient(fetcher);
  return new DevelopmentRunnerClient(fetcher);
}
