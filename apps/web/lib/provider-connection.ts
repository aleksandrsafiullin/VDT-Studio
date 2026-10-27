import type { ModelReasoningCapabilities } from "@vdt-studio/ai-harness/browser";
import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionCategory } from "./execution-category";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import { providerConnectionRequest } from "./provider-agent-binding";

export interface ProviderConnectionCheck {
  key?: string | undefined;
  state?: "checking" | "ready" | "warning" | undefined;
  capabilities?: ModelReasoningCapabilities | undefined;
  message?: string | undefined;
}

export function providerConnectionKey(settings: ExecutionSettings): string | undefined {
  if (resolveExecutionCategory(settings) === "cli_subscriptions") return undefined;
  const { providerId, providerConfig: config = {} } = resolveExecutionSettings(settings);
  if (providerId === "mock") return undefined;
  return JSON.stringify([providerId, config.backendId, config.endpoint ?? config.baseUrl, config.model, config.deployment, config.apiVersion, config.anthropicVersion]);
}

/** App-wide verification; credentials are compared privately, never published/persisted. */
export function connectProviderConnection(port: {
  getSettings: () => ExecutionSettings;
  subscribe: (listener: () => void) => () => void;
  probe: (connection: NonNullable<ReturnType<typeof providerConnectionRequest>>, signal: AbortSignal) => Promise<ModelReasoningCapabilities | undefined>;
  publish: (check: ProviderConnectionCheck) => void;
  isVisible: () => boolean;
}) {
  let previousKey: string | undefined, previousCredential: unknown;
  let revision = 0, failures = 0, lastAttempt = -Infinity, disposed = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function check(force = false) {
    if (disposed) return;
    const settings = port.getSettings(), key = providerConnectionKey(settings);
    const resolved = resolveExecutionSettings(settings), config = resolved.providerConfig ?? {};
    const credential = config.apiKey;
    if (!force && key === previousKey && credential === previousCredential) return;
    if (key !== previousKey || credential !== previousCredential) failures = 0;
    previousKey = key; previousCredential = credential;
    const requestRevision = ++revision;
    controller?.abort(); clearTimeout(timer); timer = undefined;
    if (!key) { port.publish({}); return; }
    port.publish({ key, state: "checking", message: "Connecting to the selected model…" });
    if (!port.isVisible()) return;
    let connection: ReturnType<typeof providerConnectionRequest>;
    try { connection = providerConnectionRequest(settings, resolved.providerId, config, false); }
    catch (error) { port.publish({ key, state: "warning", message: error instanceof Error ? error.message : "Check provider settings." }); return; }
    if (!connection) { port.publish({ key, state: "warning", message: "Choose a supported provider and model." }); return; }
    controller = new AbortController(); lastAttempt = Date.now();
    let retryMs = 60_000;
    void port.probe(connection, controller.signal).then((capabilities) => {
      if (disposed || revision !== requestRevision) return;
      failures = 0;
      port.publish({ key, state: "ready", capabilities, message: "The selected model is reachable. Model and reasoning are pinned when the chat starts." });
    }, (error: unknown) => {
      if (disposed || revision !== requestRevision) return;
      const status = (error as { status?: number } | undefined)?.status;
      retryMs = status && [400, 401, 403].includes(status) ? 0 : [3_000, 10_000, 30_000, 60_000][Math.min(failures++, 3)]!;
      port.publish({ key, state: "warning", message: error instanceof Error ? error.message : "Could not connect to the selected model." });
    }).finally(() => {
      if (!disposed && revision === requestRevision && retryMs) timer = setTimeout(() => check(true), retryMs);
    });
  }
  const unsubscribe = port.subscribe(() => check());
  check(true);
  return {
    refresh() { if (Date.now() - lastAttempt >= 3_000) check(true); },
    visibilityChanged() { if (port.isVisible()) check(true); },
    dispose() { disposed = true; revision++; clearTimeout(timer); controller?.abort(); unsubscribe(); }
  };
}
