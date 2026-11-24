import type { EnrichedSubscriptionCliDetection } from "@vdt-studio/model-bridge/local-runtime";
import { getSubscriptionCliAdapter } from "@vdt-studio/model-bridge";
import { BUILTIN_HARNESSES, type HarnessDefinition } from "@vdt-studio/model-bridge/harness-catalog";
import { NextResponse } from "next/server";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";
import { recordClaudeCliCatalog } from "@/lib/claude-cli-catalog";

const SUBSCRIPTION_CLI_AGENTS = BUILTIN_HARNESSES;
type SubscriptionCliAgent = (typeof SUBSCRIPTION_CLI_AGENTS)[number];

interface CliProbeResult {
  agent: EnrichedSubscriptionCliDetection;
  models: readonly string[];
}

const detectionCacheGlobal = globalThis as typeof globalThis & {
  __vdtCliProviderProbesInFlight?: Map<string, Promise<CliProbeResult>>;
};
const providerProbes = detectionCacheGlobal.__vdtCliProviderProbesInFlight ??= new Map();

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

async function probeProvider(harness: HarnessDefinition): Promise<CliProbeResult> {
  const { detectSubscriptionCli, enrichSubscriptionCliDetection, isWindowsCursorPayload, WINDOWS_CURSOR_STATUS_TIMEOUT_MS } =
    await import("@vdt-studio/model-bridge/local-runtime");
  const detected = await detectSubscriptionCli(harness.id);
  let models: readonly string[] = [];
  const timeout = detected.executable && harness.id === "cursor-agent" && isWindowsCursorPayload(detected.executable)
    ? WINDOWS_CURSOR_STATUS_TIMEOUT_MS
    : 5_000;
  const agent = await enrichSubscriptionCliDetection(detected, {
    signal: AbortSignal.timeout(timeout),
    onHarnessModels: (discovered) => { models = discovered.map((model) => model.id); }
  });
  if (agent.status === "ready" && agent.executable && harness.transport === "native") {
    const adapter = getSubscriptionCliAdapter(agent.backendId);
    if (agent.id === "claude" && agent.version && adapter?.listModelOptions) {
      const options = await adapter.listModelOptions(agent.executable).catch(() => []);
      models = options.map(({ id }) => id);
      if (models.length) recordClaudeCliCatalog(agent.executable, agent.version, options);
    } else {
      models = await adapter?.listModels?.(agent.executable).catch(() => []) ?? [];
    }
  }
  return { agent, models };
}

function startProviderProbe(harness: HarnessDefinition, key: string) {
  const pending = providerProbes.get(key);
  if (pending) return { pending, reused: true };
  const probe = probeProvider(harness).catch((): CliProbeResult => ({
    agent: {
      id: harness.id, backendId: harness.backendId, installed: false, executable: null, alias: null,
      version: null, status: "unavailable", authSummary: "Provider detection failed. Use Rescan to try again."
    },
    models: []
  })).finally(() => providerProbes.delete(key));
  providerProbes.set(key, probe);
  return { pending: probe, reused: false };
}

function unknownAgent(agentId: string) {
  return NextResponse.json({ error: `Unknown CLI agent: ${agentId}` }, { status: 400 });
}

async function developmentWebDetection(agentId: string | null, progressive: boolean) {
  const { listHarnessDefinitions, harnessDefinitionVersion } = await import("@vdt-studio/model-bridge/local-runtime");
  const harnesses = listHarnessDefinitions();
  const environment = JSON.stringify([process.env.PATH, process.env.PATHEXT, process.platform, process.arch]);
  const providers = agentId ? harnesses.filter(({ id }) => id === agentId) : harnesses;
  if (agentId && providers.length === 0) return unknownAgent(agentId);
  const probes = providers.map((harness) => startProviderProbe(
    harness, JSON.stringify([harness.id, harnessDefinitionVersion(harness), environment])
  ));
  const headers = {
    "x-vdt-cli-probe-cache": probes.every(({ reused }) => reused) ? "hit" : "miss",
    "cache-control": "no-store"
  };
  if (progressive) {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (record: object) => {
          if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(record) + "\n"));
        };
        send({ harnesses });
        await Promise.all(probes.map(async ({ pending }) => {
          const { agent, models } = await pending;
          send({ agents: [agent], modelsByAgent: { [agent.id]: models } });
        }));
        if (!cancelled) {
          send({ done: true });
          controller.close();
        }
      },
      cancel() { cancelled = true; }
    });
    return new Response(body, { headers: { ...headers, "content-type": "application/x-ndjson" } });
  }

  const results = await Promise.all(probes.map(({ pending }) => pending));
  return NextResponse.json({
    appMode: "development_web",
    ok: true,
    agents: results.map(({ agent }) => agent),
    modelsByAgent: Object.fromEntries(results.map(({ agent, models }) => [agent.id, models])),
    harnesses
  }, { headers });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("id");
  const appMode = resolveVdtAppModeForRequest(request);

  if (appMode === "development_web") {
    const progressive = !agentId && request.headers.get("accept") === "application/x-ndjson";
    return developmentWebDetection(agentId, progressive);
  }

  const agents = agentId
    ? SUBSCRIPTION_CLI_AGENTS.filter((agent) => agent.id === agentId)
    : SUBSCRIPTION_CLI_AGENTS;
  if (agentId && agents.length === 0) return unknownAgent(agentId);

  return NextResponse.json({
    appMode,
    agents: agents.map(appMode === "desktop" ? desktopDetectionUnavailable : hostedWebDetection),
    modelsByAgent: {}
  });
}
