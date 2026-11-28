import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "@/lib/execution-mode-catalog";
import { apiKeyScope, connectApiKeyPersistence } from "@/lib/api-key-persistence";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";

const rows = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => rows.get(key) ?? null,
  setItem: (key: string, value: string) => rows.set(key, value),
  removeItem: (key: string) => rows.delete(key)
});
const { useVdtStudioStore: store } = await import("./vdt-store");
const storageKey = "vdt-studio-state";

function retain(executionSettings: ExecutionSettings, providerId = "openai_compatible") {
  rows.set(storageKey, JSON.stringify({ version: 2, state: { executionSettings, providerId } }));
  return store.persist.rehydrate();
}

function fixtureBinding(locale = "en-US", id = "apple_identity_one") {
  return {
    bindingId: id, backendId: "apple_foundation_models", modelId: "system",
    appleIdentity: { osBuild: "27A100", locale }, executionProfile: "model_agent",
    admission: { mode: "local", profileVersion: 1, providerId: "apple_foundation_models", modelId: "system", modelRevision: null }
  };
}

function host(options: { enabled?: boolean; rollout?: boolean; issue?: string; identityLocale?: string } = {}) {
  const fetcher = vi.fn(async (target: string | URL | Request, init?: RequestInit) => {
    const url = String(target);
    if (url === "/api/agent/bindings/apple") {
      if (init?.method !== "POST") return Response.json({
        enabled: options.enabled ?? true, firstLaunchDefaultEnabled: options.rollout ?? true
      });
      if (options.issue) return Response.json({ ok: false, error: options.issue }, { status: 409 });
      const { locale } = JSON.parse(String(init.body));
      return Response.json({ ok: true, binding: fixtureBinding(options.identityLocale ?? locale) });
    }
    throw new Error(`Unexpected network request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
  vi.stubGlobal("navigator", { language: "en-US" });
  store.setState(store.getInitialState(), true);
  rows.clear();
  await store.persist.rehydrate();
});

afterEach(() => vi.unstubAllEnvs());

describe("Apple analytical first launch policy", () => {
  it("waits for the host rollout, then keeps the verified binding volatile across rehydration", async () => {
    const closedSwitch = host({ rollout: false });
    await expect(store.getState().refreshAppleAnalyticalDefault()).resolves.toBeUndefined();
    expect(closedSwitch).toHaveBeenCalledTimes(1);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("untouched");

    const openedSwitch = host();
    await expect(store.getState().refreshAppleAnalyticalDefault()).resolves.toMatchObject({ bindingId: "apple_identity_one" });
    expect(openedSwitch).toHaveBeenCalledTimes(2);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
    expect(resolveExecutionSettings(store.getState().executionSettings)).toEqual({ providerId: "apple_foundation_models" });
    expect(rows.get(storageKey)).not.toContain("apple_identity_one");
    await store.persist.rehydrate();
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
    expect(store.getState().appleNativePreview).toBeUndefined();
    await store.getState().refreshAppleAnalyticalDefault();
    expect(store.getState().appleNativePreview?.binding).toMatchObject({ appleIdentity: { locale: "en-US" } });
  });

  it.each([false, true])("preserves a pending first-launch check across an empty vault read (manual switch = %s)", async manualSwitch => {
    let releaseAvailability!: (response: Response) => void;
    let releaseVault!: (key: string | undefined) => void;
    const availability = new Promise<Response>(resolve => { releaseAvailability = resolve; });
    const vaultRead = new Promise<string | undefined>(resolve => { releaseVault = resolve; });
    const read = vi.fn((_scope: string) => vaultRead), write = vi.fn(), remove = vi.fn();
    const apply = vi.fn((value: string, scope?: string) => {
      if (scope !== undefined) store.getState().restoreApiKeyFromVault(scope, value);
      else store.getState().setExecutionSettingsField("apiKey", value);
    });
    const persistence = connectApiKeyPersistence({
      getSettings: () => store.getState().executionSettings, setApiKey: apply,
      subscribe: listener => store.subscribe((state, previous) => {
        if (state.executionSettings !== previous.executionSettings) listener(state.executionSettings);
      })
    }, { read, write, remove }, () => {});
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ ok: true, binding: fixtureBinding() }) : availability);
    vi.stubGlobal("fetch", fetcher);

    try {
      const original = store.getState().executionSettings;
      const pending = store.getState().refreshAppleAnalyticalDefault();
      await vi.waitFor(() => {
        expect(fetcher).toHaveBeenCalledOnce();
        expect(read).toHaveBeenCalledExactlyOnceWith(apiKeyScope(original));
      });
      releaseVault(undefined);
      await persistence.settled();
      expect(apply).toHaveBeenCalledWith("", apiKeyScope(original));
      expect(store.getState().executionSettings).toBe(original);
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      if (manualSwitch) store.getState().setLocalRunnerPreset("lm_studio_openai");
      releaseAvailability(Response.json({ enabled: true, firstLaunchDefaultEnabled: true }));
      const binding = await pending;
      if (manualSwitch) {
        expect(binding).toBeUndefined();
        expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
        expect(resolveExecutionSettings(store.getState().executionSettings).providerConfig?.backendId).toBe("lm_studio");
        expect(fetcher).toHaveBeenCalledOnce();
      } else {
        expect(binding).toMatchObject({ bindingId: "apple_identity_one" });
        expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
      }
    } finally { persistence.dispose(); }
  });

  it.each(["download in progress", "Apple Intelligence is disabled", "Device is unsupported"])(
    "keeps the choice untouched until the host becomes ready: %s", async issue => {
      host({ issue });
      await store.getState().refreshAppleAnalyticalDefault();
      expect(store.getState().appleFirstLaunch).toMatchObject({ status: "unavailable", message: issue });
      expect(store.getState().executionSettings.analyticalSourceChoice).toBe("untouched");
      host();
      await store.getState().refreshAppleAnalyticalDefault();
      expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
    }
  );

  it.each([
    ["ollama_openai", "ollama"], ["lm_studio_openai", "lm_studio"], ["vllm_openai", "vllm"],
  ] as const)("retains a manually selected %s through reload and later readiness", async (preset, backendId) => {
    store.getState().setLocalRunnerPreset(preset);
    await store.persist.rehydrate();
    const fetcher = host();
    await store.getState().refreshAppleAnalyticalDefault();
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
    expect(resolveExecutionSettings(store.getState().executionSettings)).toMatchObject({ providerConfig: { backendId } });
  });

  it("preserves legacy upgrades and independent Smart settings", async () => {
    const old = { ...DEFAULT_EXECUTION_SETTINGS, model: "existing-api-model" };
    await retain(old);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
    expect(resolveExecutionSettings(store.getState().executionSettings).providerConfig?.model).toBe("existing-api-model");
    const smart = { custom: { model: "independent-smart", reasoningByModel: { "independent-smart": false } } };
    await retain({ ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "untouched", smartKpiBySource: smart });
    host();
    await store.getState().refreshAppleAnalyticalDefault();
    expect(store.getState().executionSettings.smartKpiBySource).toEqual(smart);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
    store.getState().setByokProtocol("anthropic");
    await store.persist.rehydrate();
    expect(resolveExecutionSettings(store.getState().executionSettings).providerId).toBe("anthropic");
    store.getState().setSelectedCliAgentId("codex");
    await store.persist.rehydrate();
    expect(resolveExecutionSettings(store.getState().executionSettings).providerConfig?.backendId).toBe("codex_subscription");
    expect(store.getState().executionSettings.smartKpiBySource).toEqual(smart);
  });

  it("retains the Apple choice without paid fallback on missing locale or rollout rollback", async () => {
    await retain({ ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "apple_default" });
    let calls = host({ identityLocale: "en-US" });
    await store.getState().refreshAppleAnalyticalDefault({ locale: "ru-RU" });
    expect(store.getState().appleFirstLaunch).toMatchObject({ status: "unavailable" });
    expect(store.getState().appleNativePreview).toBeUndefined();
    calls = host({ rollout: false });
    expect(await store.getState().startAgentRun("Build the requested tree")).toBe(false);
    expect(calls.mock.calls.map(([url]) => url)).toEqual(["/api/agent/bindings/apple"]);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_default");
    expect(store.getState().aiError).toContain("disabled in this release");

    await store.getState().refreshAppleAnalyticalDefault({ selectManually: true, locale: "en-US" });
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_manual");
    await store.persist.rehydrate();
    await store.getState().refreshAppleAnalyticalDefault();
    expect(store.getState().appleNativePreview?.binding).toMatchObject({ bindingId: "apple_identity_one" });
  });

  it("discards a deferred Apple result after a user selects another model", async () => {
    let resolveOffer!: (response: Response) => void;
    const pendingOffer = new Promise<Response>(resolve => { resolveOffer = resolve; });
    const fetcher = vi.fn(async (_target: string, init?: RequestInit) => init?.method === "POST"
      ? pendingOffer : Response.json({ enabled: true, firstLaunchDefaultEnabled: true }));
    vi.stubGlobal("fetch", fetcher);
    const beginningRun = store.getState().startAgentRun("Build a structure");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    store.getState().setLocalRunnerPreset("lm_studio_openai");
    resolveOffer(Response.json({ ok: true, binding: fixtureBinding() }));
    await expect(beginningRun).resolves.toBe(false);
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
    expect(store.getState().appleNativePreview).toBeUndefined();
    expect(store.getState().appleFirstLaunch?.status).not.toBe("checking");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears a superseded availability check after opening Local models and permits an explicit Apple choice", async () => {
    let resolveAvailability!: (response: Response) => void;
    const deferred = new Promise<Response>(resolve => { resolveAvailability = resolve; });
    const fetcher = vi.fn(async () => deferred);
    vi.stubGlobal("fetch", fetcher);
    const outdated = store.getState().refreshAppleAnalyticalDefault();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(store.getState().appleFirstLaunch?.status).toBe("checking");
    store.getState().setExecutionCategory("local_models");
    const explicit = store.getState().executionSettings;
    expect(explicit.analyticalSourceChoice).toBe("manual");
    resolveAvailability(Response.json({ enabled: true, firstLaunchDefaultEnabled: false }));
    await expect(outdated).resolves.toBeUndefined();
    expect(store.getState().appleFirstLaunch?.status).not.toBe("checking");
    expect(store.getState().executionSettings).toBe(explicit);
    expect(fetcher).toHaveBeenCalledOnce();
    host({ rollout: false });
    await expect(store.getState().refreshAppleAnalyticalDefault({ selectManually: true })).resolves.toMatchObject({ bindingId: "apple_identity_one" });
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("apple_manual");
  });

  it("leaves the loading status owned by a newer explicit check", async () => {
    let releaseBackground!: (response: Response) => void;
    let releaseExplicit!: (response: Response) => void;
    const backgroundReply = new Promise<Response>(resolve => { releaseBackground = resolve; });
    const explicitReply = new Promise<Response>(resolve => { releaseExplicit = resolve; });
    const fetcher = vi.fn(async () => explicitReply).mockReturnValueOnce(backgroundReply);
    vi.stubGlobal("fetch", fetcher);
    const background = store.getState().refreshAppleAnalyticalDefault();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    store.getState().setExecutionCategory("local_models");
    const explicit = store.getState().refreshAppleAnalyticalDefault({ selectManually: true });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const checking = store.getState().appleFirstLaunch;
    releaseBackground(Response.json({ enabled: true, firstLaunchDefaultEnabled: false }));
    await expect(background).resolves.toBeUndefined();
    expect(store.getState().appleFirstLaunch).toBe(checking);
    expect(checking?.status).toBe("checking");
    releaseExplicit(Response.json({ enabled: false, firstLaunchDefaultEnabled: false }));
    await expect(explicit).resolves.toBeUndefined();
    expect(store.getState().appleFirstLaunch?.status).toBe("unavailable");
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
  });

  it("keeps first launch dormant on a non-desktop profile and does not refresh an active run", async () => {
    const fetcher = host();
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
    await store.getState().refreshAppleAnalyticalDefault();
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    await store.getState().refreshAppleAnalyticalDefault();
    store.setState({ isGenerating: true });
    await store.getState().refreshAppleAnalyticalDefault({ locale: "ru-RU" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.getState().appleNativePreview?.binding.appleIdentity?.locale).toBe("en-US");
  });

  it("rechecks before dispatch and passes only the fresh local binding", async () => {
    await retain({ ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "apple_default" });
    host();
    await store.getState().refreshAppleAnalyticalDefault();
    const dispatches: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/agent/bindings/apple") {
        return init?.method === "POST"
          ? Response.json({ ok: true, binding: fixtureBinding("en-US", "apple_identity_fresh") })
          : Response.json({ enabled: true, firstLaunchDefaultEnabled: true });
      }
      if (url.startsWith("/api/agent/runs") && init?.method === "POST") {
        dispatches.push(JSON.parse(String(init.body)));
        return Response.json({ ok: false, error: "Fixture stops before inference." }, { status: 409 });
      }
      if (url.startsWith("/api/agent/runs")) return Response.json({ ok: true, defaultBindingId: null, bindings: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(store.getState().startAgentRun("Build an editable tree", { outcomeSelection: "automatic" })).resolves.toBe(false);
    expect(dispatches).toEqual([expect.objectContaining({
      executionBindingId: "apple_identity_fresh",
      expectedExecution: { mode: "local", profileVersion: 1, providerId: "apple_foundation_models", modelId: "system", modelRevision: null },
      outcomeSelection: "automatic"
    })]);
    expect(dispatches[0]).not.toHaveProperty("providerId");
    expect(dispatches[0]).not.toHaveProperty("providerConfig");
    expect(fetcher.mock.calls.filter(([url]) => url === "/api/agent/bindings/apple")).toHaveLength(2);
  });

  it("continues an in-flight Apple run with local authority after changing the next-run settings", async () => {
    await retain({ ...DEFAULT_EXECUTION_SETTINGS, analyticalSourceChoice: "apple_default" });
    const runId = "pinned_apple_test";
    const snapshot = {
      runId, status: "needs_user_input",
      request: { executionBindingId: "apple_native_pinned", input: {}, mode: "generate_vdt", providerId: "model_agent" },
      executionSummary: { backendId: "apple_foundation_models", modelId: "system", executionProfile: "model_agent", executionMode: "local" }
    } as NonNullable<ReturnType<typeof store.getState>["agentRun"]>;
    store.setState({ agentRun: snapshot, activeAgentRunId: runId });
    store.getState().setLocalRunnerPreset("lm_studio_openai");
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ ok: false, error: "Fixture stops before continuing." }, { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    await store.getState().sendAgentAnswers({ scope: "Continue with the original scope" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`/api/agent/runs/${runId}/messages`);
    expect(JSON.parse(String(init?.body))).toMatchObject({ type: "user_answer", expectedExecutionMode: "local" });
    expect(store.getState().executionSettings.analyticalSourceChoice).toBe("manual");
  });
});
