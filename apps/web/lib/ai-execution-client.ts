import {
  generateVdtOutputSchema,
  generateVdtOutputToProject,
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

interface DesktopCompletionPayload {
  requestId: string;
  providerId: string;
  backendId: string;
  taskType: VdtAiTaskType;
  schemaId: string;
  input: unknown;
  model?: string;
  timeoutMs?: number;
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
  complete(request: AiCompletionRequest, signal?: AbortSignal): Promise<RunAiTaskResult>;
  cancel(requestId: string): Promise<void>;
  detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult>;
  openProviderAuth(backendId: string): Promise<ProviderAuthActionResult>;
  generateTree(request: GenerateTreeRequest, signal?: AbortSignal): Promise<VdtProject>;
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
    const output = generateVdtOutputSchema.parse((value as { output?: unknown }).output);
    return generateVdtOutputToProject(output, input, providerId);
  }
  const output = generateVdtOutputSchema.parse(value);
  return generateVdtOutputToProject(output, input, providerId);
}

function unwrapDesktopRunResult(value: unknown): RunAiTaskResult {
  if (isRunAiTaskResult(value)) return value;
  if (typeof value === "object" && value !== null && "result" in value && isRunAiTaskResult((value as { result?: unknown }).result)) {
    return (value as { result: RunAiTaskResult }).result;
  }
  throw new Error("Desktop runtime returned an unsupported AI task result.");
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json()) as T & { error?: unknown };
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
  constructor(
    protected readonly appMode: VdtAppMode,
    protected readonly fetcher: Fetcher
  ) {}

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

  async complete(request: AiCompletionRequest, signal?: AbortSignal): Promise<RunAiTaskResult> {
    const response = await this.fetcher("/api/ai/run-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(signal ? { signal } : {}),
      body: JSON.stringify(request)
    });
    const payload = await readJsonResponse<{ ok?: boolean; result?: RunAiTaskResult; error?: string }>(
      response,
      "AI task failed."
    );
    if (!payload.ok || !payload.result) throw new Error(payload.error ?? "AI task response could not be parsed.");
    return payload.result;
  }

  async cancel(requestId: string): Promise<void> {
    void requestId;
    // Route-level cancellation is owned by the local runtime/desktop client. Hosted route requests use AbortSignal.
  }

  async generateTree(request: GenerateTreeRequest, signal?: AbortSignal): Promise<VdtProject> {
    const response = await this.fetcher("/api/ai/generate-vdt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(signal ? { signal } : {}),
      body: JSON.stringify(request)
    });
    const payload = await readJsonResponse<{ ok?: boolean; project?: VdtProject; error?: string }>(
      response,
      "AI response could not be parsed."
    );
    if (!payload.ok || !payload.project) throw new Error(payload.error ?? "AI response could not be parsed.");
    return payload.project;
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
  constructor(fetcher: Fetcher = fetch) {
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
  constructor(fetcher: Fetcher = fetch) {
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

  override async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    void backendId;
    throw new Error("Standalone runner authentication actions are not available in development web mode.");
  }
}

export class DesktopAiExecutionClient extends BaseWebAiExecutionClient {
  constructor(fetcher: Fetcher = fetch, private readonly invoke: DesktopInvoke | undefined = resolveDesktopInvoke()) {
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

  override async generateTree(request: GenerateTreeRequest, signal?: AbortSignal): Promise<VdtProject> {
    if (isApiBackendId(request.providerId)) return super.generateTree(request, signal);
    const completion = this.buildDesktopCompletionRequest("generate_tree", request, request.providerId, request.providerConfig);
    const result = await this.invokeDesktopCompletion(completion, signal);
    return unwrapDesktopProject(result, request, request.providerId);
  }

  private buildDesktopCompletionRequest(
    taskType: VdtAiTaskType,
    input: unknown,
    providerId: string,
    providerConfig: Record<string, unknown> | undefined
  ): DesktopCompletionPayload {
    const model = desktopModel(providerConfig);
    const timeoutMs = desktopTimeoutMs(providerConfig);
    return {
      requestId: crypto.randomUUID(),
      providerId,
      backendId: desktopBackendId(providerId, providerConfig),
      taskType,
      schemaId: TASK_SCHEMA_IDS[taskType],
      input,
      ...(model === undefined ? {} : { model }),
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    };
  }

  private async invokeDesktopCompletion(request: DesktopCompletionPayload, signal?: AbortSignal): Promise<unknown> {
    const invoke = this.requireInvoke();
    if (signal?.aborted) {
      await invoke("ai_cancel", { requestId: request.requestId }).catch(() => undefined);
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    const abort = () => {
      void invoke("ai_cancel", { requestId: request.requestId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await invoke("ai_complete", { request });
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  override async complete(request: AiCompletionRequest, signal?: AbortSignal): Promise<RunAiTaskResult> {
    if (isApiBackendId(request.providerId)) return super.complete(request, signal);
    const result = await this.invokeDesktopCompletion(
      this.buildDesktopCompletionRequest(request.taskType, request.input, request.providerId, request.providerConfig),
      signal
    );
    return unwrapDesktopRunResult(result);
  }

  override async cancel(requestId: string): Promise<void> {
    await this.requireInvoke()("ai_cancel", { requestId });
  }

  async detectSubscriptionClis(agentId?: CliAgentId): Promise<DetectSubscriptionClisResult> {
    if (!this.invoke) return { agents: placeholderAgents(DESKTOP_LOCAL_AI_PLACEHOLDER_MESSAGE, agentId), modelsByAgent: {} };
    const backends = await this.listBackends();
    const agents = CLI_CATALOG
      .filter((entry) => !agentId || entry.id === agentId)
      .map((entry) => {
        const backend = backends.find((candidate) => candidate.backendId.includes(entry.id.replace("-agent", "")));
        return {
          id: entry.id,
          installed: backend?.status === "available",
          executable: null,
          alias: null,
          version: null,
          status: backend?.status === "available" ? "ready" as const : "unavailable" as const,
          authSummary: backend?.message,
          diagnostics: backend?.message ? [backend.message] : undefined
        };
      });
    return { agents, modelsByAgent: {} };
  }

  override async openProviderAuth(backendId: string): Promise<ProviderAuthActionResult> {
    return await this.requireInvoke()("open_provider_auth", { backendId }) as ProviderAuthActionResult;
  }
}

export function createAiExecutionClient(
  appMode: VdtAppMode = resolveVdtAppMode(),
  fetcher: Fetcher = fetch
): AiExecutionClient {
  if (appMode === "hosted_web") return new HostedApiExecutionClient(fetcher);
  if (appMode === "desktop") return new DesktopAiExecutionClient(fetcher);
  return new DevelopmentRunnerClient(fetcher);
}
