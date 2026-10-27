import type { AgentExecutionBindingSelection } from "./agent-client";
import { resolveExecutionBindingId } from "./agent-start-resolver";
import { resolveSelectedCliReadiness, type CliReadinessDetection } from "./cli-readiness";
import { resolveExecutionCategory } from "./execution-category";
import type { CliAgentId, ExecutionSettings } from "./execution-mode-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";

export interface CliConnectionCheck {
  key?: string | undefined;
  bindings?: AgentExecutionBindingSelection | undefined;
  failed?: boolean | undefined;
  catalog?: AgentExecutionBindingSelection | undefined;
}

export interface CliConnectionSnapshot {
  settings: ExecutionSettings;
  detections: readonly CliReadinessDetection[] | undefined;
  detectionError?: string | undefined;
  scanning: boolean;
  testing: boolean;
  removedAgentIds: readonly CliAgentId[];
  vdtId?: string | undefined;
}

export function cliConnectionKey(settings: ExecutionSettings): string | undefined {
  if (resolveExecutionCategory(settings) !== "cli_subscriptions") return undefined;
  const execution = resolveExecutionSettings(settings);
  return JSON.stringify([settings.selectedCliAgentId, execution.providerConfig?.model, settings.cliModelSelection?.reasoningEffort]);
}

const RETRY_DELAYS = [3_000, 10_000, 30_000, 60_000];
const READY_REFRESH_MS = 60_000;
const RECOVERY_REFRESH_MS = 3_000;

/** One app-wide owner, independent of Settings and of the mounted VDT panel.
 * Only selection is durable; every browser session verifies live CLI access. */
export function connectCliConnection(port: {
  getSnapshot: () => CliConnectionSnapshot;
  subscribe: (listener: () => void) => () => void;
  rescan: (agentId?: CliAgentId) => Promise<void>;
  getBindings: () => Promise<AgentExecutionBindingSelection>;
  publish: (check: CliConnectionCheck) => void;
  isVisible: () => boolean;
}) {
  let previous = port.getSnapshot();
  let key: string | undefined;
  let selectionRevision = 0;
  let disposed = false;
  let running = false;
  let needsScan = false;
  let needsCheck = false;
  let healthy = false;
  let lastAttempt = -Infinity;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function selectedKey(state: CliConnectionSnapshot) {
    if (state.settings.selectedCliAgentId && state.removedAgentIds.includes(state.settings.selectedCliAgentId)) return undefined;
    // An intentionally cleared selection after Remove must stay cleared.
    if (!state.settings.selectedCliAgentId && state.removedAgentIds.length > 0) return undefined;
    return cliConnectionKey(state.settings);
  }

  async function run() {
    const state = port.getSnapshot();
    if (disposed || running || !key || state.scanning || state.testing) return;
    const requestKey = key;
    const requestRevision = selectionRevision;
    const scan = needsScan;
    needsScan = false;
    needsCheck = false;
    running = true;
    clearTimer();
    port.publish({ key: requestKey });
    let retry = false;
    try {
      if (scan) await port.rescan(state.settings.selectedCliAgentId);
      if (disposed || selectionRevision !== requestRevision) return;
      // The scan's store notifications are already covered by this attempt.
      needsCheck = false;
      const verified = port.getSnapshot();
      if (verified.scanning || verified.testing) return;
      const readiness = resolveSelectedCliReadiness(verified.settings, verified.detections, {
        detectionError: verified.detectionError
      });
      healthy = false;
      if (!readiness?.canExecute) {
        const status = verified.detections?.find((agent) => agent.id === verified.settings.selectedCliAgentId)?.status;
        retry = Boolean(verified.detectionError) || status === undefined ||
          status === "installed" || status === "unavailable" || status === "error";
        return;
      }
      const bindings = await port.getBindings();
      if (disposed || selectionRevision !== requestRevision) return;
      const latest = port.getSnapshot();
      if (latest.scanning || latest.testing || latest.detections !== verified.detections || latest.detectionError) return;
      const execution = resolveExecutionSettings(latest.settings);
      healthy = resolveExecutionBindingId(bindings, latest.settings, execution.providerId, execution.providerConfig) !== null;
      port.publish({ key: requestKey, bindings });
      retry = !healthy;
    } catch {
      if (!disposed && selectionRevision === requestRevision) {
        healthy = false;
        port.publish({ key: requestKey, failed: true });
        retry = true;
      }
    } finally {
      running = false;
      if (!disposed) {
        if (selectionRevision === requestRevision) {
          lastAttempt = Date.now();
          if (healthy) failures = 0;
          if (retry && port.isVisible()) {
            const delay = RETRY_DELAYS[Math.min(failures++, RETRY_DELAYS.length - 1)]!;
            timer = setTimeout(() => {
              needsScan = true;
              needsCheck = true;
              void run();
            }, delay);
          }
        }
        if (needsCheck) void run();
      }
    }
  }

  function refresh() {
    if (disposed || running || !key || !port.isVisible()) return;
    const cooldown = healthy ? READY_REFRESH_MS : RECOVERY_REFRESH_MS;
    const remaining = cooldown - (Date.now() - lastAttempt);
    if (remaining > 0) {
      if (!healthy && timer === undefined) timer = setTimeout(() => { timer = undefined; refresh(); }, remaining);
      return;
    }
    needsScan = true;
    needsCheck = true;
    void run();
  }

  function sync() {
    if (disposed) return;
    const state = port.getSnapshot();
    const nextKey = selectedKey(state);
    const detectionChanged = state.detections !== previous.detections || state.detectionError !== previous.detectionError;
    const becameIdle = (previous.scanning || previous.testing) && !state.scanning && !state.testing;
    const openedVdt = state.vdtId !== previous.vdtId;
    previous = state;
    if (nextKey !== key) {
      selectionRevision += 1;
      key = nextKey;
      healthy = false;
      failures = 0;
      lastAttempt = -Infinity;
      clearTimer();
      // A discovery scan may have just selected its first installed provider.
      needsScan = Boolean(key) && !detectionChanged;
      needsCheck = Boolean(key);
      port.publish({ key });
    } else if (key && (detectionChanged || becameIdle)) {
      if (!running && detectionChanged && !state.scanning && !state.testing) needsScan = false;
      needsCheck = true;
    }
    if (needsCheck) void run();
    else if (openedVdt) refresh();
  }

  const unsubscribe = port.subscribe(sync);
  sync();
  return {
    refresh,
    visibilityChanged() {
      if (port.isVisible()) refresh();
      else clearTimer();
    },
    dispose() { disposed = true; clearTimer(); unsubscribe(); }
  };
}
