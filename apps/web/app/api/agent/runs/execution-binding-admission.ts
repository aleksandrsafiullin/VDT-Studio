import type { ExecutionExpectation } from "@vdt-studio/vdt-agent-runtime";
import type { AgentExecutionBindingDefinition } from "./execution-bindings";
import { AgentExecutionBindingError } from "./execution-bindings";

export type AnalyticalTask = "agent_run" | "suggested_kpi" | "file_analysis" | "bounded_task" | "generation_diagnostics";
export type ExecutionMode = ExecutionExpectation["mode"];
export type ProcessingBoundary = "on_device" | "provider_service" | "unverified";
export type SpeechComponent = "stt" | "tts" | "realtime";
export type ExecutionReasoning = boolean | string | number;
export type ExecutionCredential = { readonly kind: "none" } | {
  readonly kind: "session_key" | "host_configuration" | "subscription";
  readonly reference: string;
};

export interface SpeechRoute {
  readonly providerId: string;
  readonly modelId: string | null;
  readonly boundary: ProcessingBoundary;
  readonly billing: "none" | "subscription" | "api";
  readonly credential: ExecutionCredential;
  readonly consent: "explicit_component";
  readonly scope: "bound_voice_session";
}

export interface HostExecutionAdmission {
  readonly profileVersion: 1;
  readonly mode: ExecutionMode;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string | null;
  readonly runtimeProfileVersion: string | null;
  readonly reasoning: ExecutionReasoning | null;
  readonly boundary: ProcessingBoundary;
  readonly analyticalTasks: readonly AnalyticalTask[];
  readonly speech: Readonly<Record<SpeechComponent, SpeechRoute | null>>;
  readonly credential: ExecutionCredential;
  readonly consent: "explicit_connection" | "host_configuration" | "legacy" | "none";
  readonly scope: "bound_run";
  readonly research: boolean;
  readonly delegation: false;
}

/** Legacy routes keep their prior compatibility semantics. Only fresh host
 * evidence can construct a Local admission. In particular a loopback URL
 * and a model name on their own do not establish an on-device boundary. */
export function hostExecutionAdmission(definition: AgentExecutionBindingDefinition): HostExecutionAdmission {
  const providerId = definition.capability.backendId;
  const cli = "currentQualification" in definition;
  const adapter = "modelEngineAdapter" in definition ? definition.modelEngineAdapter : undefined;
  const api = adapter && ["openai_compatible", "anthropic", "azure_openai", "gemini"].includes(adapter.providerId);
  const apiSession = api && (definition.bindingId.startsWith("openai_byok_session_") || definition.bindingId.startsWith("api_byok_session_"));
  const local = "localProof" in definition ? definition.localProof : undefined;
  const apple = adapter?.appleCapability;
  const onDevice = Boolean(local || apple);
  return {
    profileVersion: 1,
    mode: onDevice ? "local" : cli ? "cli_subscription" : api ? "api_keys" : "legacy",
    providerId,
    modelId: definition.modelId,
    modelRevision: local?.modelRevision ?? null,
    runtimeProfileVersion: local?.profileVersion ?? apple?.identity.profile ?? null,
    reasoning: ("modelReasoning" in definition ? definition.modelReasoning : undefined) ??
      ("reasoningEffort" in definition ? definition.reasoningEffort : undefined) ?? null,
    boundary: onDevice ? "on_device" : cli || api ? "provider_service" : "unverified",
    analyticalTasks: apple ? ["agent_run", "suggested_kpi", "file_analysis", "bounded_task", "generation_diagnostics"] : ["agent_run"],
    speech: { stt: null, tts: null, realtime: null },
    credential: onDevice || (!cli && !api) ? { kind: "none" } : {
      kind: cli ? "subscription" : apiSession ? "session_key" : "host_configuration",
      reference: definition.bindingId
    },
    consent: onDevice ? "none" : cli || apiSession ? "explicit_connection" : api ? "host_configuration" : "legacy",
    scope: "bound_run",
    research: !onDevice && providerId !== "ollama" && providerId !== "lm_studio" && providerId !== "vllm",
    delegation: false
  };
}

export type { ExecutionExpectation };

export function assertAnalyticalAdmission(
  admission: HostExecutionAdmission,
  task: AnalyticalTask,
  requestedResearch?: "auto" | "on" | "off",
  expectation?: ExecutionExpectation
): void {
  if (expectation && (
    expectation.mode !== admission.mode
    || expectation.profileVersion !== admission.profileVersion
    || expectation.providerId !== admission.providerId
    || expectation.modelId !== admission.modelId
    || expectation.modelRevision !== admission.modelRevision
  )) {
    throw new AgentExecutionBindingError("BINDING_CAPABILITY_DENIED", "The selected execution identity is stale or incompatible.");
  }
  if (!admission.analyticalTasks.includes(task) || (!admission.research && requestedResearch === "on")) {
    throw new AgentExecutionBindingError("BINDING_CAPABILITY_DENIED", "The selected execution binding cannot perform this task or use web research.");
  }
}
