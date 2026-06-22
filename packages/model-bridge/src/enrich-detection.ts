import type { ModelBackendStatus } from "./contract";
import type { SubscriptionCliDetectionResult } from "./detection";
import { getSubscriptionCliAdapter } from "./subscription-cli/registry";

export interface EnrichedSubscriptionCliDetection extends SubscriptionCliDetectionResult {
  status?: ModelBackendStatus;
  authSummary?: string;
  diagnostics?: string[];
}

export async function enrichSubscriptionCliDetection(
  agent: SubscriptionCliDetectionResult,
  options: { signal?: AbortSignal } = {}
): Promise<EnrichedSubscriptionCliDetection> {
  if (!agent.installed || !agent.executable) {
    return {
      ...agent,
      status: "not_installed",
      diagnostics: []
    };
  }

  const adapter = getSubscriptionCliAdapter(agent.backendId);
  if (adapter?.probeAuth) {
    try {
      const probe = await adapter.probeAuth(agent.executable, options.signal);
      return {
        ...agent,
        status: probe.status,
        ...(probe.authSummary ? { authSummary: probe.authSummary } : {}),
        diagnostics: probe.diagnostics
      };
    } catch (error) {
      if (options.signal?.aborted) {
        return {
          ...agent,
          status: "installed",
          authSummary: "Authentication probe timed out.",
          diagnostics: ["CLI enrichment timed out before auth could be verified."]
        };
      }
      return {
        ...agent,
        status: "error",
        diagnostics: [error instanceof Error ? error.message : "Auth probe failed."]
      };
    }
  }

  const diagnostics: string[] = [];
  if (agent.error) diagnostics.push(`Version probe failed: ${agent.error}`);

  return {
    ...agent,
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
