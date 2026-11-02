import { listHarnessDefinitions, getHarnessDefinition, probeHarnessModels } from "@vdt-studio/model-bridge/node";
import { BUILTIN_HARNESSES, isHarnessId, type HarnessId } from "@vdt-studio/model-bridge/harness-catalog";
import { NextResponse } from "next/server";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";

const SUBSCRIPTION_CLI_AGENTS = BUILTIN_HARNESSES;
type SubscriptionCliAgent = (typeof SUBSCRIPTION_CLI_AGENTS)[number];
type SubscriptionCliAgentId = HarnessId;

interface CliDetectionCacheEntry {
  promise: Promise<unknown>;
}

const detectionCacheGlobal = globalThis as typeof globalThis & {
  __vdtCliDetectionInFlight?: Map<string, CliDetectionCacheEntry>;
};
const detectionCache = detectionCacheGlobal.__vdtCliDetectionInFlight ?? new Map<string, CliDetectionCacheEntry>();
if (process.env.NODE_ENV !== "production") detectionCacheGlobal.__vdtCliDetectionInFlight = detectionCache;

function isSubscriptionCliAgentId(value: string): value is SubscriptionCliAgentId { return isHarnessId(value); }

function hostedWebDetection(agent: SubscriptionCliAgent) {
  return {
    id: agent.id,
    backendId: agent.backendId,
    installed: false,
    executable: null,
    alias: null,
    version: null,
    status: "unavailable",
    authSummary: "Local subscriptions are available in VDT Studio Desktop.",
    diagnostics: ["Hosted web cannot detect or execute local subscription CLIs."]
  };
}

function desktopDetectionUnavailable(agent: SubscriptionCliAgent) {
  return {
    ...hostedWebDetection(agent),
    authSummary: "Desktop CLI detection must use the VDT Studio desktop bridge.",
    diagnostics: ["The hosted Next.js route is not allowed to scan PATH or execute provider CLIs."]
  };
}

async function developmentWebDetectionPayload(agentId?: SubscriptionCliAgentId) {
  const { detectSubscriptionCli, detectSubscriptionClis, enrichSubscriptionCliDetections } = await import("@vdt-studio/model-bridge/node");
  const { getSubscriptionCliAdapter } = await import("@vdt-studio/model-bridge");
  const detected = agentId ? [await detectSubscriptionCli(agentId)] : await detectSubscriptionClis();
  const agents = await enrichSubscriptionCliDetections(detected);
  const modelsByAgent: Partial<Record<SubscriptionCliAgentId, readonly string[]>> = {};

  await Promise.all(
    agents.map(async (agent) => {
      if (!agent.installed || !agent.executable || agent.status !== "ready") {
        modelsByAgent[agent.id] = [];
        return;
      }
      const adapter = getSubscriptionCliAdapter(agent.backendId);
      try {
        const h = getHarnessDefinition(agent.id);
        modelsByAgent[agent.id] = h && h.transport !== "native" ? (await probeHarnessModels(h, AbortSignal.timeout(5000))).map(m => m.id) : adapter?.listModels ? await adapter.listModels(agent.executable) : [];
      } catch {
        modelsByAgent[agent.id] = [];
      }
    })
  );

  return {
    appMode: "development_web",
    ok: true,
    agents,
    modelsByAgent,
    harnesses: listHarnessDefinitions()
  };
}

async function developmentWebDetection(agentId?: SubscriptionCliAgentId) {
  const key = JSON.stringify({
    agentId: agentId ?? "all",
    path: process.env.PATH ?? "",
    pathExt: process.env.PATHEXT ?? "",
    platform: process.platform,
    arch: process.arch
  });
  const cached = detectionCache.get(key);
  if (cached) {
    return NextResponse.json(await cached.promise, {
      headers: { "x-vdt-cli-probe-cache": "hit", "cache-control": "no-store" }
    });
  }
  const promise = developmentWebDetectionPayload(agentId);
  detectionCache.set(key, { promise });
  try {
    return NextResponse.json(await promise, {
      headers: { "x-vdt-cli-probe-cache": "miss", "cache-control": "no-store" }
    });
  } finally {
    // A rescan after sign-in must not reuse an earlier account/session result.
    if (detectionCache.get(key)?.promise === promise) detectionCache.delete(key);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");
  const appMode = resolveVdtAppModeForRequest(request);

  if (agentId && (!isSubscriptionCliAgentId(agentId) || !(appMode === "development_web" ? getHarnessDefinition(agentId) : SUBSCRIPTION_CLI_AGENTS.some(h => h.id === agentId)))) {
    return NextResponse.json({ error: `Unknown CLI agent: ${agentId}` }, { status: 400 });
  }
  const requestedAgentId = agentId && isSubscriptionCliAgentId(agentId) ? agentId : undefined;

  const agents = agentId
    ? SUBSCRIPTION_CLI_AGENTS.filter((agent) => agent.id === agentId)
    : SUBSCRIPTION_CLI_AGENTS;

  if (appMode === "development_web") {
    return developmentWebDetection(requestedAgentId);
  }

  return NextResponse.json({
    appMode,
    agents: agents.map(appMode === "desktop" ? desktopDetectionUnavailable : hostedWebDetection),
    modelsByAgent: {}
  });
}
