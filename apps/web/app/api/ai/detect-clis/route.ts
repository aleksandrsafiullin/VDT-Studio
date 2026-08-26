import { NextResponse } from "next/server";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";

const SUBSCRIPTION_CLI_AGENTS = [
  { id: "cursor-agent", backendId: "cursor_subscription" },
  { id: "codex", backendId: "codex_subscription" },
  { id: "claude", backendId: "claude_subscription" },
  { id: "gemini", backendId: "gemini_subscription" },
  { id: "copilot", backendId: "copilot_subscription" }
] as const;

type SubscriptionCliAgent = (typeof SUBSCRIPTION_CLI_AGENTS)[number];
type SubscriptionCliAgentId = SubscriptionCliAgent["id"];

interface CliDetectionCacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const detectionCacheGlobal = globalThis as typeof globalThis & {
  __vdtCliDetectionCache?: Map<string, CliDetectionCacheEntry>;
};
const detectionCache = detectionCacheGlobal.__vdtCliDetectionCache ?? new Map<string, CliDetectionCacheEntry>();
if (process.env.NODE_ENV !== "production") detectionCacheGlobal.__vdtCliDetectionCache = detectionCache;
const DETECTION_CACHE_TTL_MS = 30_000;

const agentIds = new Set<string>(SUBSCRIPTION_CLI_AGENTS.map((agent) => agent.id));

function isSubscriptionCliAgentId(value: string): value is SubscriptionCliAgentId {
  return agentIds.has(value);
}

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
      if (!agent.installed || !agent.executable) {
        modelsByAgent[agent.id] = [];
        return;
      }
      const adapter = getSubscriptionCliAdapter(agent.backendId);
      try {
        modelsByAgent[agent.id] = adapter?.listModels ? await adapter.listModels(agent.executable) : [];
      } catch {
        modelsByAgent[agent.id] = [];
      }
    })
  );

  return {
    appMode: "development_web",
    ok: true,
    agents,
    modelsByAgent
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
  const now = Date.now();
  const cached = detectionCache.get(key);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(await cached.promise, {
      headers: { "x-vdt-cli-probe-cache": "hit" }
    });
  }
  const promise = developmentWebDetectionPayload(agentId);
  detectionCache.set(key, { expiresAt: now + DETECTION_CACHE_TTL_MS, promise });
  try {
    return NextResponse.json(await promise, {
      headers: { "x-vdt-cli-probe-cache": "miss" }
    });
  } catch (error) {
    detectionCache.delete(key);
    throw error;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");
  const appMode = resolveVdtAppModeForRequest(request);

  if (agentId && !isSubscriptionCliAgentId(agentId)) {
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
