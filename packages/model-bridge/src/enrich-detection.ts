import type { ModelBackendStatus } from "./contract";
import type { SubscriptionCliDetectionResult } from "./detection";
import { getSubscriptionCliAdapter } from "./subscription-cli/registry";

export interface EnrichedSubscriptionCliDetection extends SubscriptionCliDetectionResult {
  status?: ModelBackendStatus;
  authSummary?: string;
  diagnostics?: string[];
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

  const adapter = getSubscriptionCliAdapter(agent.backendId);
  if (adapter?.probeAuth) {
    try {
      const probe = await adapter.probeAuth(agent.executable, options.signal);
      return {
        ...publicDetection(agent),
        status: probe.status,
        ...(probe.authSummary ? { authSummary: probe.authSummary } : {}),
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
