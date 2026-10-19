import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveByokPreset, resolveEffectiveByokUrls } from "./byok-validation";
import type { ApiKeyVault } from "./api-key-vault";

export type ApiKeyStorageStatus = "loading" | "saving" | "saved" | "empty" | "error";

/** Match the effective request destination; model/deployment changes keep the key. */
export function apiKeyScope(settings: ExecutionSettings): string | undefined {
  if (settings.useMockProvider || settings.gatewayPresetId === "mock") return undefined;
  const preset = resolveByokPreset(settings);
  const protocol = settings.byokProtocol ?? preset.protocol;
  const urls = resolveEffectiveByokUrls(settings, preset);
  try {
    const url = new URL((protocol === "azure" ? urls.endpoint : urls.baseUrl) ?? "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return JSON.stringify(["byok.v1", protocol, preset.gateway, url.href.replace(/\/+$/, "")]);
  } catch {
    return undefined;
  }
}

export interface ApiKeySettingsSource {
  getSettings(): ExecutionSettings;
  setApiKey(value: string): void;
  subscribe(listener: (settings: ExecutionSettings) => void): () => void;
}

export function connectApiKeyPersistence(
  source: ApiKeySettingsSource,
  vault: ApiKeyVault,
  onStatus: (status: ApiKeyStorageStatus) => void
) {
  let scope = apiKeyScope(source.getSettings());
  let value = source.getSettings().apiKey ?? "";
  let generation = 0;
  let applying = false;
  let disposed = false;
  let failure: "restore" | "write" | undefined;
  let pendingWrites = 0;
  let queue = Promise.resolve();

  const publish = (expected: number, status: ApiKeyStorageStatus) => {
    if (!disposed && expected === generation) onStatus(status);
  };
  const apply = (next: string) => {
    value = next;
    applying = true;
    try { source.setApiKey(next); } finally { applying = false; }
  };
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job, job);
    return queue;
  };

  function restore() {
    const target = scope;
    const expected = ++generation;
    if (!target) { onStatus(value ? "error" : "empty"); return queue; }
    publish(expected, "loading");
    return enqueue(async () => {
      try {
        const saved = await vault.read(target);
        if (disposed || expected !== generation) return;
        apply(saved ?? "");
        failure = undefined;
        publish(expected, saved ? "saved" : "empty");
      } catch {
        if (expected === generation) failure = "restore";
        publish(expected, "error");
      }
    });
  }

  function write() {
    const target = scope;
    const next = value;
    const expected = ++generation;
    if (!target) { failure = "write"; onStatus("error"); return queue; }
    pendingWrites += 1;
    publish(expected, "saving");
    return enqueue(async () => {
      try {
        if (next.trim()) await vault.write(target, next);
        else await vault.remove(target);
        if (expected === generation) failure = undefined;
        publish(expected, next.trim() ? "saved" : "empty");
      } catch {
        if (expected === generation) failure = "write";
        publish(expected, "error");
      } finally {
        pendingWrites -= 1;
      }
    });
  }

  const unsubscribe = source.subscribe((settings) => {
    if (disposed || applying) return;
    const nextScope = apiKeyScope(settings);
    if (nextScope !== scope) {
      scope = nextScope;
      // Clear inherited credentials synchronously, before a new destination can
      // be used. Never copy the previous provider's key into the new scope.
      apply("");
      void restore();
    } else if ((settings.apiKey ?? "") !== value) {
      value = settings.apiKey ?? "";
      void write();
    }
  });

  // A key already in memory (e.g. a hot update) is admitted once; the initial
  // empty hydrated state is a read, never an instruction to delete a record.
  if (value.trim()) void write();
  else void restore();

  return {
    remove: () => { apply(""); return write(); },
    retry: () => failure === "write" ? write() : restore(),
    refresh: (changedScope: string) => {
      if (disposed || changedScope !== scope || pendingWrites > 0) return queue;
      apply("");
      return restore();
    },
    settled: () => queue,
    dispose: () => { disposed = true; unsubscribe(); }
  };
}
