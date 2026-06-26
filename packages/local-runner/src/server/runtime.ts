import { randomUUID } from "node:crypto";
import {
  isVdtSchemaId,
  schemaSupportsTask,
  type VdtAiTaskType
} from "@vdt-studio/model-bridge";
import {
  detectSubscriptionCli,
  detectSubscriptionClis,
  enrichSubscriptionCliDetections,
  isSubscriptionCliId,
  type DetectionOptions,
  type SubscriptionCliId
} from "@vdt-studio/model-bridge/node";
import { validateGraph, type VdtGraph, type VdtProject, type VdtWarning } from "@vdt-studio/vdt-core";
import {
  appendAgenticVdtRunEvent,
  finalizeAgenticVdtRun,
  loadDefaultSkillLibrary,
  prepareAgenticVdtRun,
  type AgenticPromptPackage,
  type GenerateVdtInputLike,
  type VdtAgentRun
} from "@vdt-studio/vdt-agent";
import type { AuditEvent, BackendManifest, CompletionRequest, RunProgressPhase, RunSnapshot, RunStatus } from "../cli/types";
import { executeCompletion, EXECUTION_LIMITS, listBackendModels, type ExecutorOptions } from "./executor";
import { createManifestRegistry, publicManifest } from "./manifests";

export const LOCAL_RUNTIME_VERSION = "0.2.0";
const MAX_RETAINED_RUNS = 200;
const TASK_TYPES = new Set<VdtAiTaskType>([
  "generate_tree", "deepen_node", "simplify_branch", "suggest_alternative", "suggest_formula",
  "review_model", "check_units", "identify_missing_drivers", "identify_duplicate_drivers",
  "explain_node", "explain_scenario", "generate_executive_summary"
]);

export interface LocalRuntimeConfig {
  manifests?: readonly BackendManifest[];
  executor?: ExecutorOptions;
  detection?: DetectionOptions & { probeTimeoutMs?: number };
  auditSink?: (event: AuditEvent) => void;
  adapterVersion?: string;
}

interface ActiveRun extends RunSnapshot {
  controller: AbortController;
}

const PROGRESS_LABELS: Record<RunProgressPhase, string> = {
  preparing_request: "Preparing request",
  starting_backend: "Starting backend",
  waiting_for_provider: "Waiting for CLI/provider",
  validating_schema: "Validating schema",
  repairing_output: "Repairing/normalizing output",
  building_project: "Building project",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled"
};

export interface LocalRuntimeContext {
  config: LocalRuntimeConfig;
  manifests: ReadonlyMap<string, BackendManifest>;
  runs: Map<string, ActiveRun>;
  auditSink: (event: AuditEvent) => void;
  adapterVersion: string;
}

export interface RuntimeResult {
  statusCode: number;
  payload?: unknown;
}

export class LocalRuntimeError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "LocalRuntimeError";
  }
}

function setRunProgress(run: ActiveRun, phase: RunProgressPhase, status: RunStatus = run.status): void {
  run.progress = {
    phase,
    label: PROGRESS_LABELS[phase],
    updatedAt: new Date().toISOString()
  };
  run.status = status;
}

export function createLocalRuntimeContext(config: LocalRuntimeConfig = {}): LocalRuntimeContext {
  return {
    config,
    manifests: createManifestRegistry(config.manifests),
    runs: new Map(),
    auditSink: config.auditSink ?? ((event) => process.stdout.write(`${JSON.stringify({ event: "vdt_runner_audit", ...event })}\n`)),
    adapterVersion: config.adapterVersion ?? LOCAL_RUNTIME_VERSION
  };
}

export function listRuntimeBackends(context: LocalRuntimeContext): RuntimeResult {
  return { statusCode: 200, payload: { ok: true, backends: [...context.manifests.values()].map(publicManifest) } };
}

export async function detectRuntimeSubscriptionClis(
  context: LocalRuntimeContext,
  agentId?: string
): Promise<RuntimeResult> {
  if (agentId !== undefined && !isSubscriptionCliId(agentId)) {
    throw new LocalRuntimeError(400, "UNKNOWN_CLI_AGENT", `Unknown CLI agent: ${agentId}`);
  }

  const detectionOptions = context.config.detection ?? {};
  const detected = agentId
    ? [await detectSubscriptionCli(agentId as SubscriptionCliId, detectionOptions)]
    : await detectSubscriptionClis(detectionOptions);
  const enrichmentOptions = detectionOptions.probeTimeoutMs === undefined
    ? {}
    : { probeTimeoutMs: detectionOptions.probeTimeoutMs };
  const agents = await enrichSubscriptionCliDetections(detected, enrichmentOptions);
  const modelsByAgent: Partial<Record<SubscriptionCliId, string[]>> = {};

  await Promise.all(
    agents.map(async (agent) => {
      if (!agent.installed || !agent.executable) {
        modelsByAgent[agent.id] = [];
        return;
      }
      const manifest = context.manifests.get(agent.backendId);
      if (!manifest) {
        modelsByAgent[agent.id] = [];
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        modelsByAgent[agent.id] = [
          ...await listBackendModels(manifest, controller.signal, {
            ...(context.config.executor ?? {}),
            resolveExecutable: async () => agent.executable!
          })
        ];
      } catch {
        modelsByAgent[agent.id] = [];
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return { statusCode: 200, payload: { ok: true, agents, modelsByAgent } };
}

export async function listRuntimeModels(backendId: string, context: LocalRuntimeContext): Promise<RuntimeResult> {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  timeout.unref?.();
  try {
    const models = await listBackendModels(manifest, controller.signal, context.config.executor);
    return { statusCode: 200, payload: { ok: true, backendId, models } };
  } catch (error) {
    if (isSoftModelListFailure(error)) {
      return { statusCode: 200, payload: { ok: true, backendId, models: [] } };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testRuntimeBackend(backendId: string, context: LocalRuntimeContext): Promise<RuntimeResult> {
  return completeRuntime({
    requestId: randomUUID(),
    backendId,
    taskType: "generate_tree",
    schemaId: "connection-test-v1",
    input: { probe: true },
    timeoutMs: 30_000
  }, context);
}

export async function completeRuntime(request: CompletionRequest, context: LocalRuntimeContext): Promise<RuntimeResult> {
  if (context.runs.has(request.requestId)) throw new LocalRuntimeError(409, "DUPLICATE_REQUEST_ID", "requestId already exists.");
  if (context.runs.size >= MAX_RETAINED_RUNS) {
    const completedId = [...context.runs].find(([, run]) => run.status !== "running")?.[0];
    if (!completedId) throw new LocalRuntimeError(503, "RUN_CAPACITY_REACHED", "Local runner is at its active run limit.");
    context.runs.delete(completedId);
  }
  const manifest = context.manifests.get(request.backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (!manifest.taskTypes.includes(request.taskType) || !manifest.schemaIds.includes(request.schemaId)) {
    throw new LocalRuntimeError(400, "UNSUPPORTED_CONTRACT", "Backend does not support this task/schema contract.");
  }
  const createdAt = new Date().toISOString();
  const controller = new AbortController();
  const run: ActiveRun = {
    requestId: request.requestId,
    backendId: request.backendId,
    taskType: request.taskType,
    schemaId: request.schemaId,
    status: "running",
    createdAt,
    startedAt: createdAt,
    progress: { phase: "starting_backend", label: PROGRESS_LABELS.starting_backend, updatedAt: createdAt },
    controller
  };
  context.runs.set(request.requestId, run);
  const started = Date.now();
  let executionRequest = request;
  try {
    setRunProgress(run, "preparing_request");
    const preparedAgent = await prepareRuntimeAgentRun(request);
    if (preparedAgent) {
      executionRequest = preparedAgent.request;
      run.agentRun = preparedAgent.agentRun;
    }
    setRunProgress(run, "waiting_for_provider");
    const result = await executeCompletion(manifest, executionRequest, controller.signal, context.config.executor);
    run.status = "succeeded";
    run.output = result.output;
    if (run.agentRun) {
      run.agentRun = finalizeRuntimeAgentRun(run.agentRun, request, result.output);
    }
    run.outputBytes = result.outputBytes;
    run.schemaValid = result.schemaValid;
    if (result.repaired === true) run.repaired = true;
    if (result.repairAttempted === true) run.repairAttempted = true;
    if (result.repairSucceeded === true) run.repairSucceeded = true;
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    setRunProgress(run, "complete", "succeeded");
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: context.adapterVersion,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: result.outputBytes, schemaValid: result.schemaValid,
      ...(result.repaired === true ? { repaired: true } : {}),
      ...(result.repairAttempted === true ? { repairAttempted: true } : {}),
      ...(result.repairSucceeded === true ? { repairSucceeded: true } : {}),
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
      ...(result.executableVersion === undefined ? {} : { executableVersion: result.executableVersion })
    });
    return { statusCode: 200, payload: { ok: true, run: publicRun(run), output: result.output } };
  } catch (error) {
    const normalized = publicRuntimeError(error);
    run.status = normalized.code === "CANCELLED" ? "cancelled" : "failed";
    run.error = normalized;
    run.outputBytes = 0;
    run.schemaValid = false;
    if (hasRepairAttempt(error)) {
      run.repairAttempted = true;
      run.repairSucceeded = false;
    }
    if (run.agentRun) {
      run.agentRun = appendAgenticVdtRunEvent(
        run.agentRun,
        {
          type: "error",
          title: normalized.code === "CANCELLED" ? "Provider execution cancelled" : "Provider execution failed",
          message: normalized.message,
          metadata: { code: normalized.code }
        },
        { phase: "reporting", status: normalized.code === "CANCELLED" ? "cancelled" : "failed" }
      );
    }
    run.finishedAt = new Date().toISOString();
    run.latencyMs = Date.now() - started;
    setRunProgress(run, normalized.code === "CANCELLED" ? "cancelled" : "error", run.status);
    context.auditSink({
      requestId: run.requestId, backendId: run.backendId, adapterVersion: context.adapterVersion,
      taskType: run.taskType, startedAt: run.startedAt!, latencyMs: run.latencyMs,
      outputBytes: 0, schemaValid: false,
      ...(hasRepairAttempt(error) ? { repairAttempted: true, repairSucceeded: false } : {}),
      errorCode: normalized.code
    });
    return { statusCode: normalized.code === "CANCELLED" ? 409 : 502, payload: { ok: false, run: publicRun(run), error: normalized } };
  }
}

interface PreparedRuntimeAgentRun {
  request: CompletionRequest;
  agentRun: VdtAgentRun;
}

async function prepareRuntimeAgentRun(request: CompletionRequest): Promise<PreparedRuntimeAgentRun | undefined> {
  if (request.schemaId === "connection-test-v1") return undefined;
  if (request.taskType !== "generate_tree" && request.taskType !== "deepen_node") return undefined;

  const agentRequest = request.taskType === "generate_tree"
    ? generateInputFromCompletionInput(request.input)
    : deepenInputFromCompletionInput(request.input);
  if (!agentRequest) return undefined;

  const library = await loadDefaultSkillLibrary();
  const prepared = prepareAgenticVdtRun(agentRequest, library);
  const agentRun = appendAgenticVdtRunEvent(
    prepared.run,
    {
      type: "model_call_started",
      title: request.taskType === "generate_tree" ? "Model call started" : "Deepen model call started",
      message:
        request.taskType === "generate_tree"
          ? `Generating graph from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.`
          : `Generating deepen patch from ${prepared.skillExcerpts.length} selected skill${prepared.skillExcerpts.length === 1 ? "" : "s"}.`,
      metadata: {
        taskType: request.taskType,
        selectedSkillIds: prepared.prompt.decompositionPlan.selectedSkillIds
      }
    },
    { phase: "generating_graph" }
  );

  return {
    request: request.taskType === "generate_tree" || request.taskType === "deepen_node"
      ? { ...request, input: enrichAgenticCompletionInput(request.input, prepared.prompt) }
      : request,
    agentRun
  };
}

function finalizeRuntimeAgentRun(agentRun: VdtAgentRun, request: CompletionRequest, output: unknown): VdtAgentRun {
  const resultProjectId = outputProjectId(output) ?? request.requestId;
  if (request.taskType === "generate_tree") {
    const validation = graphValidationSummaryFromGenerateOutput(output);
    return finalizeAgenticVdtRun(agentRun, {
      resultProjectId,
      finalReport: runtimeFinalReport(
        agentRun,
        "Generated a candidate VDT graph through the local runtime.",
        validation.message
      ),
      validationSummary: validation.message,
      draftGraph: output
    });
  }

  const withPatch = appendAgenticVdtRunEvent(
    agentRun,
    {
      type: "graph_patch",
      title: "Graph patch returned",
      message: "Deepen operation returned a candidate change set payload.",
      metadata: { targetNodeId: isRecord(output) ? output.targetNodeId : undefined }
    },
    { phase: "validating_graph" }
  );
  const withCompleted = appendAgenticVdtRunEvent(
    withPatch,
    {
      type: "model_call_completed",
      title: "Deepen model call completed",
      message: validationSummaryFromOutput(output),
      metadata: { targetNodeId: isRecord(output) ? output.targetNodeId : undefined }
    },
    { phase: "reporting" }
  );
  const validationSummary = validationSummaryFromOutput(output);
  const withReport = appendAgenticVdtRunEvent(
    withCompleted,
    {
      type: "final_report",
      title: "Deepen report prepared",
      message: "Prepared deepen run report after provider schema validation.",
      metadata: { targetNodeId: isRecord(output) ? output.targetNodeId : undefined }
    },
    { phase: "reporting", status: "succeeded" }
  );
  return {
    ...withReport,
    resultProjectId,
    finalReport: runtimeFinalReport(
      withReport,
      "Generated a candidate deepen patch through the local runtime.",
      validationSummary
    ),
    draftGraph: output
  };
}

function unwrapTaskInput(input: unknown): unknown {
  if (isRecord(input) && "data" in input) return input.data;
  return input;
}

function generateInputFromCompletionInput(input: unknown): GenerateVdtInputLike | undefined {
  const data = unwrapTaskInput(input);
  if (!isRecord(data)) return undefined;
  const rootKpi = boundedString(data.rootKpi) ?? boundedString(data.projectTitle) ?? boundedString(data.prompt);
  if (!rootKpi) return undefined;
  const request: GenerateVdtInputLike = { rootKpi };
  const industry = boundedString(data.industry);
  const businessContext = boundedString(data.businessContext);
  const unit = boundedString(data.unit);
  const timePeriod = boundedString(data.timePeriod);
  const goal = boundedString(data.goal);
  const levelOfDetail = boundedString(data.levelOfDetail);
  if (industry) request.industry = industry;
  if (businessContext) request.businessContext = businessContext;
  if (unit) request.unit = unit;
  if (timePeriod) request.timePeriod = timePeriod;
  if (goal) request.goal = goal;
  if (levelOfDetail) request.levelOfDetail = levelOfDetail;
  return request;
}

function deepenInputFromCompletionInput(input: unknown): GenerateVdtInputLike | undefined {
  const data = unwrapTaskInput(input);
  if (!isRecord(data)) return undefined;
  const project = projectFromDeepenInput(data);
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const targetName = targetNameFromDeepenInput(data);
  const rootKpi = targetName ?? targetNodeId;
  if (!rootKpi) return undefined;
  const context = isRecord(data.context) ? data.context : undefined;
  const request: GenerateVdtInputLike = { rootKpi };
  const industry = boundedString(data.industry) ?? boundedString(project?.industry);
  const businessContext = boundedString(data.businessContext) ?? boundedString(project?.businessContext) ?? boundedString(project?.description);
  const goal = boundedString(context?.goal);
  const targetUnit = targetUnitFromDeepenInput(data);
  if (industry) request.industry = industry;
  if (businessContext) request.businessContext = businessContext;
  if (targetUnit) request.unit = targetUnit;
  if (goal) request.goal = goal;
  return request;
}

function targetNameFromDeepenInput(data: Record<string, unknown>): string | undefined {
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const excerpt = isRecord(data.excerpt) ? data.excerpt : undefined;
  const project = projectFromDeepenInput(data);
  const graph = isRecord(project?.graph) ? project.graph : undefined;
  const nodes = Array.isArray(excerpt?.nodes)
    ? excerpt.nodes
    : Array.isArray(graph?.nodes)
      ? graph.nodes
      : [];
  const target = nodes.find((node): node is Record<string, unknown> => isRecord(node) && node.id === targetNodeId);
  return boundedString(target?.name);
}

function targetUnitFromDeepenInput(data: Record<string, unknown>): string | undefined {
  const targetNodeId = boundedString(data.targetNodeId) ?? boundedString(data.nodeId);
  const excerpt = isRecord(data.excerpt) ? data.excerpt : undefined;
  const project = projectFromDeepenInput(data);
  const graph = isRecord(project?.graph) ? project.graph : undefined;
  const nodes = Array.isArray(excerpt?.nodes)
    ? excerpt.nodes
    : Array.isArray(graph?.nodes)
      ? graph.nodes
      : [];
  const target = nodes.find((node): node is Record<string, unknown> => isRecord(node) && node.id === targetNodeId);
  return boundedString(target?.unit, 80);
}

function projectFromDeepenInput(data: Record<string, unknown>): Partial<VdtProject> | undefined {
  const project = data.project;
  return isRecord(project) ? project as Partial<VdtProject> : undefined;
}

function enrichAgenticCompletionInput(input: unknown, prompt: AgenticPromptPackage): unknown {
  const context = {
    selectedSkillIds: prompt.decompositionPlan.selectedSkillIds,
    decompositionPlan: prompt.decompositionPlan
  };
  if (isRecord(input)) {
    const hasAgenticPrompt = typeof input.userPrompt === "string" && input.userPrompt.includes("Agentic VDT preparation");
    return {
      ...input,
      agenticContext: context,
      ...(typeof input.systemPrompt === "string" && !hasAgenticPrompt
        ? { systemPrompt: `${input.systemPrompt}\n\n${prompt.systemPromptAddition}` }
        : {}),
      ...(typeof input.userPrompt === "string" && !hasAgenticPrompt
        ? { userPrompt: `${input.userPrompt}\n\n${prompt.userPromptAddition}` }
        : {})
    };
  }
  return {
    data: input,
    systemPrompt: prompt.systemPromptAddition,
    userPrompt: prompt.userPromptAddition,
    agenticContext: context
  };
}

function boundedString(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function outputProjectId(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined;
  return boundedString(output.projectId) ?? boundedString(output.rootNodeId) ?? boundedString(output.projectTitle);
}

function validationSummaryFromOutput(output: unknown): string {
  if (!isRecord(output)) return "Provider output passed registered schema validation.";
  const nodes = Array.isArray(output.nodes) ? output.nodes.length : undefined;
  const edges = Array.isArray(output.edges) ? output.edges.length : undefined;
  if (nodes !== undefined && edges !== undefined) {
    return `Provider output passed registered schema validation: ${nodes} nodes, ${edges} edges.`;
  }
  return "Provider output passed registered schema validation.";
}

function graphValidationSummaryFromGenerateOutput(output: unknown): { valid: boolean; message: string } {
  if (!isRecord(output) || typeof output.rootNodeId !== "string" || !Array.isArray(output.nodes) || !Array.isArray(output.edges)) {
    return { valid: false, message: "Graph validation failed: provider output was not a graph-shaped generate_tree payload." };
  }

  const validation = validateGraph(
    {
      nodes: output.nodes,
      edges: output.edges
    } as VdtGraph,
    output.rootNodeId
  );
  if (validation.valid && validation.warnings.length === 0) {
    return {
      valid: true,
      message: `Graph validation passed: ${output.nodes.length} nodes, ${output.edges.length} decomposition edges.`
    };
  }

  const issues = [...validation.errors, ...validation.warnings].map((issue: VdtWarning) => issue.message).slice(0, 6);
  return {
    valid: false,
    message: `Graph validation failed: ${issues.join("; ")}`
  };
}

function runtimeFinalReport(agentRun: VdtAgentRun, headline: string, validationSummary: string): string {
  return [
    headline,
    `Selected skills: ${agentRun.selectedSkills.map((skill) => skill.id).join(", ") || "none"}.`,
    `Validation result: ${validationSummary}`
  ].join("\n");
}

function hasRepairAttempt(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { repairAttempted?: unknown }).repairAttempted === true;
}

function isSoftModelListFailure(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "BACKEND_NOT_INSTALLED" || code === "AUTH_REQUIRED" || code === "CANCELLED";
}

export function cancelRuntimeRequest(requestId: string, context: LocalRuntimeContext): RuntimeResult {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  if (run.status !== "running") throw new LocalRuntimeError(409, "RUN_NOT_ACTIVE", "Run is not active.");
  run.controller.abort();
  setRunProgress(run, "cancelled");
  return { statusCode: 202, payload: { ok: true, requestId, status: "cancelling" } };
}

export function getRuntimeRun(requestId: string, context: LocalRuntimeContext): RuntimeResult {
  const run = context.runs.get(requestId);
  if (!run) throw new LocalRuntimeError(404, "RUN_NOT_FOUND", "Run was not found.");
  return { statusCode: 200, payload: { ok: true, run: publicRun(run) } };
}

export function openRuntimeProviderAuth(backendId: string, context: LocalRuntimeContext): RuntimeResult {
  const manifest = context.manifests.get(backendId);
  if (!manifest) throw new LocalRuntimeError(404, "UNKNOWN_BACKEND", "Unknown backendId.");
  if (manifest.kind !== "subscription_cli") {
    throw new LocalRuntimeError(400, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is only available for subscription backends.");
  }
  const action = providerAuthAction(backendId);
  if (!action) {
    throw new LocalRuntimeError(501, "AUTH_ACTION_UNAVAILABLE", "Provider authentication is not available for this backend.");
  }
  return { statusCode: 200, payload: { ok: true, backendId, ...action } };
}

export function parseCompletionPayload(value: unknown): CompletionRequest {
  if (!isRecord(value)) throw new LocalRuntimeError(400, "INVALID_BODY", "Completion body must be an object.");
  for (const forbidden of ["command", "args", "providerConfig", "schema", "systemPrompt", "userPrompt", "cwd", "env", "extraArgs"]) {
    if (forbidden in value) throw new LocalRuntimeError(400, "FORBIDDEN_FIELD", `Completion body must not include ${forbidden}.`);
  }
  const allowed = new Set(["requestId", "backendId", "taskType", "schemaId", "input", "model", "timeoutMs"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new LocalRuntimeError(400, "UNKNOWN_FIELD", `Unknown completion field: ${key}.`);
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new LocalRuntimeError(400, "INVALID_REQUEST_ID", "requestId must be a UUID.");
  }
  const backendId = typeof value.backendId === "string" ? value.backendId : "";
  const taskType = typeof value.taskType === "string" && TASK_TYPES.has(value.taskType as VdtAiTaskType)
    ? value.taskType as VdtAiTaskType
    : undefined;
  const schemaId = typeof value.schemaId === "string" && isVdtSchemaId(value.schemaId) ? value.schemaId : undefined;
  if (!backendId) throw new LocalRuntimeError(400, "INVALID_BACKEND_ID", "backendId is required.");
  if (!taskType) throw new LocalRuntimeError(400, "INVALID_TASK_TYPE", "taskType is not approved.");
  if (!schemaId || !schemaSupportsTask(schemaId, taskType)) {
    throw new LocalRuntimeError(400, "INVALID_SCHEMA_ID", "schemaId is not approved for this task.");
  }
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > EXECUTION_LIMITS.timeoutMs)) {
    throw new LocalRuntimeError(400, "INVALID_TIMEOUT", `timeoutMs must be at most ${EXECUTION_LIMITS.timeoutMs}.`);
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.length > 160 || value.model.includes("\0"))) {
    throw new LocalRuntimeError(400, "INVALID_MODEL", "model must be a bounded string.");
  }
  return {
    requestId,
    backendId,
    taskType,
    schemaId,
    input: value.input,
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {})
  };
}

function publicRun(run: ActiveRun): RunSnapshot {
  const { controller: _controller, ...snapshot } = run;
  return snapshot;
}

function publicRuntimeError(error: unknown): { code: string; message: string } {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "EXECUTION_FAILED";
  const messages: Record<string, string> = {
    CANCELLED: "Completion was cancelled.",
    TIMEOUT: "Backend execution timed out.",
    OUTPUT_TOO_LARGE: "Backend output exceeded the configured limit.",
    OUTPUT_LINE_TOO_LARGE: "Backend output line exceeded the configured limit.",
    SCHEMA_INVALID: "Backend output failed schema validation.",
    BACKEND_NOT_INSTALLED: "Backend executable is not installed.",
    UNSAFE_CONFIGURATION: "Backend is not certified for isolated execution.",
    LOCAL_HTTP_FAILED: "Local model endpoint failed.",
    INVALID_PROVIDER_RESPONSE: "Local model returned an invalid response.",
    AUTH_REQUIRED: "Backend account authentication is required.",
    RATE_LIMITED: "Backend account allowance or request limit was reached.",
    POLICY_DISABLED: "Backend access is disabled by the current plan or organization policy.",
    BACKEND_PARSE_FAILED: "Backend output could not be parsed as the required structured response.",
    BACKEND_EXIT_FAILED: "Backend process exited before producing a valid response."
  };
  return { code, message: messages[code] ?? "Backend execution failed." };
}

function providerAuthAction(backendId: string): { action: "instructions"; label: string; instructions: string; docsUrl: string } | undefined {
  if (backendId === "cursor_subscription") {
    return {
      action: "instructions",
      label: "Cursor Agent authentication",
      instructions: "Use Cursor's official Agent sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.cursor.com/agent"
    };
  }
  if (backendId === "codex_subscription") {
    return {
      action: "instructions",
      label: "Codex CLI authentication",
      instructions: "Use the official Codex CLI sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://developers.openai.com/codex/cli"
    };
  }
  if (backendId === "claude_subscription") {
    return {
      action: "instructions",
      label: "Claude Code authentication",
      instructions: "Use Claude Code's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code"
    };
  }
  if (backendId === "gemini_subscription") {
    return {
      action: "instructions",
      label: "Gemini CLI authentication",
      instructions: "Use Gemini CLI's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://github.com/google-gemini/gemini-cli"
    };
  }
  if (backendId === "copilot_subscription") {
    return {
      action: "instructions",
      label: "GitHub Copilot CLI authentication",
      instructions: "Use GitHub Copilot CLI's official sign-in flow, then rescan this provider in VDT Studio Desktop.",
      docsUrl: "https://docs.github.com/en/copilot"
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
