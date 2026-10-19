import { describe, expect, it, vi } from "vitest";
import { apiKeyScope, connectApiKeyPersistence, type ApiKeyStorageStatus } from "./api-key-persistence";
import type { ApiKeyVault } from "./api-key-vault";
import { applyGatewayPreset, DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "./execution-mode-catalog";

const settings = (): ExecutionSettings => applyGatewayPreset(DEFAULT_EXECUTION_SETTINGS, "openai-default");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function source(initial = settings()) {
  let state = initial;
  const listeners = new Set<(next: ExecutionSettings) => void>();
  const change = (patch: Partial<ExecutionSettings>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  return {
    change,
    getSettings: () => state,
    setApiKey: (apiKey: string) => change({ apiKey }),
    subscribe: (listener: (next: ExecutionSettings) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}
function fixture(initial = settings()) {
  const records = new Map<string, string>();
  const vault = {
    read: vi.fn(async (scope: string) => records.get(scope)),
    write: vi.fn(async (scope: string, value: string) => { records.set(scope, value); }),
    remove: vi.fn(async (scope: string) => { records.delete(scope); })
  } satisfies ApiKeyVault;
  const store = source(initial);
  const statuses: ApiKeyStorageStatus[] = [];
  return { records, vault, store, statuses, connect: () => connectApiKeyPersistence(store, vault, (status) => statuses.push(status)) };
}

describe("API key persistence lifecycle", () => {
  it("restores after a new session without deleting the initially empty key", async () => {
    const f = fixture();
    f.records.set(apiKeyScope(settings())!, "synthetic-old");
    const p = f.connect();
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-old");
    expect(f.vault.write).not.toHaveBeenCalled();
    expect(f.vault.remove).not.toHaveBeenCalled();
    expect(f.statuses.at(-1)).toBe("saved");
    p.dispose();
  });

  it("replaces, reopens, removes and keeps the key absent on the next session", async () => {
    const f = fixture();
    let p = f.connect();
    await p.settled();
    f.store.change({ apiKey: "synthetic-first" });
    f.store.change({ apiKey: "synthetic-replacement" });
    await p.settled();
    p.dispose();
    f.store.change({ apiKey: undefined });
    p = f.connect();
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-replacement");
    await p.remove();
    expect(f.records.size).toBe(0);
    expect(f.store.getSettings().apiKey).toBe("");
    p.dispose();
    p = f.connect();
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("");
    expect(f.statuses.at(-1)).toBe("empty");
    p.dispose();
  });

  it("never overwrites new input with a late restoration", async () => {
    const f = fixture();
    const read = deferred<string | undefined>();
    f.vault.read.mockImplementationOnce(() => read.promise);
    const p = f.connect();
    f.store.change({ apiKey: "synthetic-new" });
    read.resolve("synthetic-old");
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-new");
    expect(f.records.get(apiKeyScope(settings())!)).toBe("synthetic-new");
    p.dispose();
  });

  it("allows explicit deletion during restoration and serializes it after pending writes", async () => {
    const f = fixture();
    const read = deferred<string | undefined>();
    f.vault.read.mockImplementationOnce(() => read.promise);
    const p = f.connect();
    f.store.change({ apiKey: "synthetic-replacement" });
    const deletion = p.remove();
    read.resolve("synthetic-old");
    await deletion;
    expect(f.records.size).toBe(0);
    expect(f.store.getSettings().apiKey).toBe("");
    expect(f.statuses.at(-1)).toBe("empty");
    p.dispose();
  });

  it("isolates destinations, retains the previous key and restores it when switching back", async () => {
    const f = fixture();
    const p = f.connect();
    await p.settled();
    f.store.change({ apiKey: "synthetic-a" });
    await p.settled();
    const original = f.store.getSettings();
    f.store.change({ customizeBaseUrl: true, baseUrl: "https://provider-b.example/v1" });
    expect(f.store.getSettings().apiKey).toBe("");
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("");
    f.store.change({ apiKey: "synthetic-b" });
    await p.settled();
    f.store.change({ ...original, apiKey: "synthetic-b" });
    expect(f.store.getSettings().apiKey).toBe("");
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-a");
    expect(f.records.size).toBe(2);
    p.dispose();
  });

  it("preserves keys across model and execution category changes", async () => {
    const f = fixture({ ...settings(), apiKey: "synthetic-key" });
    const p = f.connect();
    await p.settled();
    f.store.change({ model: "another-model", executionMode: "local_cli" });
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-key");
    expect(f.vault.write).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it("never applies a late restoration from the previous endpoint", async () => {
    const f = fixture();
    const oldRead = deferred<string | undefined>();
    f.vault.read.mockImplementationOnce(() => oldRead.promise);
    const next = { ...settings(), customizeBaseUrl: true, baseUrl: "https://provider-b.example/v1" };
    f.records.set(apiKeyScope(next)!, "synthetic-b");
    const p = f.connect();
    const observed: string[] = [];
    const stop = f.store.subscribe((current) => {
      if (apiKeyScope(current) === apiKeyScope(next)) observed.push(current.apiKey ?? "");
    });
    f.store.change(next);
    oldRead.resolve("synthetic-a");
    await p.settled();
    expect(f.store.getSettings().apiKey).toBe("synthetic-b");
    expect(observed).not.toContain("synthetic-a");
    stop();
    p.dispose();
  });

  it("retains unreadable records and reports a restore failure until retry succeeds", async () => {
    const f = fixture();
    f.records.set(apiKeyScope(settings())!, "synthetic-key");
    f.vault.read.mockRejectedValueOnce(new Error("unreadable"));
    const p = f.connect();
    await p.settled();
    expect(f.statuses.at(-1)).toBe("error");
    expect(f.records.size).toBe(1);
    expect(f.vault.remove).not.toHaveBeenCalled();
    await p.retry();
    expect(f.store.getSettings().apiKey).toBe("synthetic-key");
    p.dispose();
  });

  it("reports save/delete failures and retries the requested operation", async () => {
    const f = fixture();
    const p = f.connect();
    await p.settled();
    f.vault.write.mockRejectedValueOnce(new Error("quota"));
    f.store.change({ apiKey: "synthetic-key" });
    await p.settled();
    expect(f.statuses.at(-1)).toBe("error");
    expect(f.records.size).toBe(0);
    await p.retry();
    expect(f.records.size).toBe(1);
    f.vault.remove.mockRejectedValueOnce(new Error("blocked"));
    await p.remove();
    expect(f.statuses.at(-1)).toBe("error");
    expect(f.records.size).toBe(1);
    await p.retry();
    expect(f.records.size).toBe(0);
    expect(f.statuses.at(-1)).toBe("empty");
    p.dispose();
  });

  it("refreshes same-scope changes from another tab without writing back", async () => {
    const f = fixture();
    const p = f.connect();
    await p.settled();
    f.records.set(apiKeyScope(settings())!, "synthetic-from-tab");
    await p.refresh(apiKeyScope(settings())!);
    expect(f.store.getSettings().apiKey).toBe("synthetic-from-tab");
    f.records.clear();
    await p.refresh(apiKeyScope(settings())!);
    expect(f.store.getSettings().apiKey).toBe("");
    expect(f.vault.write).not.toHaveBeenCalled();
    p.dispose();
  });

  it("does not apply late reads after disposal", async () => {
    const f = fixture();
    const read = deferred<string | undefined>();
    f.vault.read.mockImplementationOnce(() => read.promise);
    const p = f.connect();
    p.dispose();
    read.resolve("synthetic-stale");
    await p.settled();
    expect(f.store.getSettings().apiKey).toBeUndefined();
  });
});

describe("credential destination identity", () => {
  it("uses effective defaults and ignores model, limits and unused URL settings", () => {
    const original = settings();
    expect(apiKeyScope({ ...original, baseUrl: "https://ignored.example", model: "different", maxTokens: 1 })).toBe(apiKeyScope(original));
    expect(apiKeyScope({ ...original, customizeBaseUrl: true, baseUrl: "https://API.OPENAI.COM:443/v1/" })).toBe(apiKeyScope(original));
    expect(apiKeyScope({ ...original, customizeBaseUrl: true, baseUrl: "https://other.example/v1" })).not.toBe(apiKeyScope(original));
    const azure = applyGatewayPreset(original, "azure-default");
    expect(apiKeyScope({ ...azure, deployment: "other-deployment" })).toBe(apiKeyScope(azure));
    expect(apiKeyScope({ ...azure, endpoint: "https://other.openai.azure.com" })).not.toBe(apiKeyScope(azure));
  });

  it.each(["invalid", "https://user:password@example.test", "https://example.test/?key=secret", "file:///tmp/key"])("does not persist invalid or credential-bearing endpoints: %s", (baseUrl) => {
    expect(apiKeyScope({ ...settings(), customizeBaseUrl: true, baseUrl })).toBeUndefined();
  });
});
