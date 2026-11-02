import type { ModelBackendStatus } from "./contract";
import type { SubscriptionCliDetectionResult } from "./detection";
import { getSubscriptionCliAdapter } from "./subscription-cli/registry";
import { getHarnessDefinition } from "./harness/profiles";
import { probeHarnessModels } from "./harness/rpc-session";
import type { HarnessAccessChecks } from "./harness/catalog";

export interface EnrichedSubscriptionCliDetection extends SubscriptionCliDetectionResult {
  status?: ModelBackendStatus;
  authSummary?: string;
  diagnostics?: string[];
  checks?: HarnessAccessChecks;
}

function publicDetection(agent: SubscriptionCliDetectionResult): SubscriptionCliDetectionResult {
  // execFile errors can embed full command lines, environment guidance and credential output.
  return agent.error ? { ...agent, error: "CLI version probe failed." } : agent;
}

function probeDiagnostics(status: ModelBackendStatus): string[] {
  switch (status) {
    case "ready":
      return [];
    case "authentication_required":
      return ["The provider could not verify an active CLI session. Complete provider sign-in, then rescan."];
    case "rate_limited":
      return ["The provider reported an account or request limit. Check your plan and try again later."];
    case "unsupported_version":
      return ["Update the provider CLI to a supported version, then rescan."];
    case "unavailable":
      return ["Provider access is unavailable for the current account, plan or organization policy."];
    default:
      return ["CLI access was not verified. Check the provider CLI in a terminal, then rescan."];
  }
}

export async function enrichSubscriptionCliDetection(
  agent: SubscriptionCliDetectionResult,
  options: { signal?: AbortSignal } = {}
): Promise<EnrichedSubscriptionCliDetection> {
  if (!agent.installed || !agent.executable) {
    return {
      ...publicDetection(agent),
      status: "not_installed",
      diagnostics: []
    };
  }

  const harness = getHarnessDefinition(agent.backendId);
  if (harness && harness.transport !== "native") {
    try {
      await probeHarnessModels(harness, options.signal ?? AbortSignal.timeout(5000));
      return { ...publicDetection(agent), status: "ready", authSummary: "Protocol session verified. Account access and quotas remain managed by the provider and are checked when a task runs.", checks: { authentication: "provider_managed", protocol: "verified" }, diagnostics: [] };
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const status: ModelBackendStatus = code === "AUTH_REQUIRED" ? "authentication_required" : code === "RATE_LIMITED" ? "rate_limited" : "error";
      const reason = code === "HARNESS_CAPABILITY_MISSING" ? "The JSONL adapter must support sessions, structured completion and acknowledged cancellation."
        : code === "UNSUPPORTED_PROTOCOL" ? "This adapter must implement protocol version 1."
          : code === "SESSION_MISMATCH" ? "The adapter returned an invalid or changed session ID."
            : code === "HARNESS_ENV_MISSING" ? "A referenced host environment variable is missing."
              : code === "CLEANUP_UNCONFIRMED" ? "Cancellation or process cleanup could not be confirmed."
                : status === "authentication_required" ? "Complete sign-in in the provider CLI, then rescan." : "The harness protocol handshake could not be verified.";
      return { ...publicDetection(agent), status, authSummary: reason, checks: { authentication: status === "authentication_required" ? "required" : "unknown", protocol: ["HARNESS_CAPABILITY_MISSING", "UNSUPPORTED_PROTOCOL", "SESSION_MISMATCH"].includes(code ?? "") ? "incompatible" : "unverified", reason }, diagnostics: probeDiagnostics(status) };
    }
  }
  const adapter = getSubscriptionCliAdapter(agent.backendId);
  if (adapter?.probeAuth) {
    try {
      const probe = await adapter.probeAuth(agent.executable, options.signal);
      return {
        ...publicDetection(agent),
        status: probe.status,
        ...(probe.authSummary ? { authSummary: probe.authSummary } : {}),
        checks: { authentication: probe.status === "ready" ? "verified" : probe.status === "authentication_required" ? "required" : "unknown", protocol: probe.status === "unsupported_version" ? "incompatible" : "unverified" },
        diagnostics: probeDiagnostics(probe.status)
      };
    } catch {
      if (options.signal?.aborted) {
        return {
          ...publicDetection(agent),
          status: "installed",
          authSummary: "Authentication probe timed out.",
          diagnostics: ["CLI enrichment timed out before auth could be verified."]
        };
      }
      return {
        ...publicDetection(agent),
        status: "error",
        authSummary: "CLI authentication could not be verified. Check the provider CLI, then rescan.",
        diagnostics: probeDiagnostics("error")
      };
    }
  }

  const diagnostics: string[] = [];
  if (agent.error) diagnostics.push("CLI version probe failed.");

  return {
    ...publicDetection(agent),
    status: "installed",
    diagnostics
  };
}

export async function enrichSubscriptionCliDetections(
  agents: readonly SubscriptionCliDetectionResult[],
  options: { probeTimeoutMs?: number } = {}
): Promise<EnrichedSubscriptionCliDetection[]> {
  const probeTimeoutMs = options.probeTimeoutMs ?? 5_000;

  return Promise.all(
    agents.map(async (agent) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
      try {
        return await enrichSubscriptionCliDetection(agent, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    })
  );
}
