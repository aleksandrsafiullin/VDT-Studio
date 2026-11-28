import { afterEach, describe, expect, it, vi } from "vitest";
import { openSpeechSession, selectedSpeechAnalytics, speechAnalyticsConnectionKey, speechRequest, transcribeSpeech, transcribeSpeechWithProof } from "./speech-client";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(["apple_manual", "apple_default"] as const)("uses the native analytics identity for %s over retained BYOK fields", analyticalSourceChoice => {
  expect(selectedSpeechAnalytics({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok", analyticalSourceChoice, model: "old-model" })).toEqual({
    mode: "local", providerId: "apple_foundation_models", modelId: "SystemLanguageModel.default"
  });
});

describe("speech client transport", () => {
  it.each(["play", "volumechange"])("revokes packaged capture and withholds a late proof on local %s", async eventType => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    vi.stubGlobal("location", { origin: "http://127.0.0.1:37541" });
    const invoke = vi.fn();
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    class Media { muted = false; volume = 1; paused = false; ended = false; }
    const media = new Media();
    if (eventType === "volumechange") { media.muted = true; media.volume = 0; }
    const listeners = new Map<string, (event: Event) => void>();
    const remove = vi.fn();
    vi.stubGlobal("HTMLMediaElement", Media);
    vi.stubGlobal("document", {
      querySelectorAll: () => eventType === "volumechange" ? [media] : [],
      addEventListener: (name: string, listener: (event: Event) => void) => { listeners.set(name, listener); },
      removeEventListener: remove
    });
    const sessionId = crypto.randomUUID();
    let finish: ((response: Response) => void) | undefined;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const { operation } = JSON.parse(String(init.body));
      calls.push(operation);
      if (operation === "open_session") return Response.json({ state: "open", sessionId });
      if (operation === "close_session") return Response.json({ state: "closed" });
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const selection = {
      version: 1, analytics: { mode: "local", providerId: "selected", modelId: "model" },
      scopeId: "workspace", language: "en", stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null
    } as const;
    const answerCapture = { turnId: crypto.randomUUID(), runId: "run", projectId: "project", vdtId: "tree", questionSetId: "set", questionEventId: "event", questionId: "question" };
    await speechRequest({ operation: "open_session", selection, answerCapture });
    const result = transcribeSpeechWithProof({ sessionId, audioBase64: "AA==" }, new AbortController().signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    media.muted = false;
    media.volume = 1;
    listeners.get(eventType)!({ type: eventType, target: media } as unknown as Event);
    await vi.waitFor(() => expect(calls).toContain("close_session"));
    finish!(Response.json({ state: "complete", text: "Draft remains editable", recognitionProof: crypto.randomUUID() }));
    await expect(result).resolves.toEqual({ text: "Draft remains editable" });
    expect(remove).toHaveBeenCalledWith("play", listeners.get("play"), true);
    expect(remove).toHaveBeenCalledWith("volumechange", listeners.get("volumechange"), true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps desktop draft fallback in legacy native IPC with no checkpoint metadata", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    vi.stubGlobal("location", { origin: "http://127.0.0.1:37541" });
    const invoke = vi.fn(async () => ({ state: "open", sessionId: "editable-only" }));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "PACKAGED_SPEECH_BRIDGE_UNAVAILABLE" }, { status: 403 })));
    const selection = {
      version: 1, analytics: { mode: "legacy", providerId: "mock", modelId: null }, scopeId: "workspace", language: "en",
      stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null
    } as const;
    const answerCapture = { turnId: crypto.randomUUID(), runId: "run", projectId: "project", vdtId: "tree", questionSetId: "set", questionEventId: "event", questionId: "question" };
    await expect(speechRequest({ operation: "open_session", selection, answerCapture })).resolves.toEqual({ state: "open", sessionId: "editable-only" });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("speech_request", { request: { operation: "open_session", selection } });
  });

  it("uses the reviewed private desktop command without HTTP", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const invoke = vi.fn(async () => ({ supported: true }));
    const fetcher = vi.fn();
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    vi.stubGlobal("fetch", fetcher);
    await speechRequest({ operation: "status" });
    expect(invoke).toHaveBeenCalledWith("speech_request", { request: { operation: "status" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps verified synthesis off HTTP and closes the grant through private IPC", async () => {
    const request = { operation: "close_tts", sessionId: "lease" } as const;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "development_web");
    await expect(speechRequest(request)).rejects.toThrow(/Desktop/);
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const invoke = vi.fn(async () => ({ state: "closed" }));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    await expect(speechRequest(request)).resolves.toEqual({ state: "closed" });
    expect(invoke).toHaveBeenCalledWith("speech_request", { request });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed in hosted mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(speechRequest({ operation: "status" })).rejects.toThrow(/Desktop or on localhost/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("changes the local capture fence for a new endpoint in the same provider family without copying credentials", () => {
    const first = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "byok", byokProtocol: "openai",
      customizeBaseUrl: true, baseUrl: "https://gateway-a.example/v1", model: "shared-model", apiKey: "key-a" } as const;
    const second = { ...first, baseUrl: "https://gateway-b.example/v1", apiKey: "key-b" };
    expect(selectedSpeechAnalytics(first)).toEqual(selectedSpeechAnalytics(second));
    expect(speechAnalyticsConnectionKey(first)).not.toEqual(speechAnalyticsConnectionKey(second));
    expect(speechAnalyticsConnectionKey(first)).not.toContain("key-a");
    expect(speechAnalyticsConnectionKey({ ...first, apiKey: "another-key" })).toEqual(speechAnalyticsConnectionKey(first));
  });

  it("opens capture only with a matching local host receipt and closes a mismatched receipt", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const selection = { version: 1, analytics: { mode: "legacy", providerId: "ollama", modelId: "qwen3" },
      scopeId: "project-a/vdt-b", stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null, language: "ru" } as const;
    const result = {
      state: "open", sessionId: "session-1", scopeId: selection.scopeId, analytics: selection.analytics, language: selection.language,
      stt: { ...selection.stt, boundary: "on_device", billing: "none", credential: { kind: "none" },
        consent: "explicit_component", scope: "bound_voice_session" }, tts: null, realtime: null
    };
    const invoke = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, scopeId: "stale-scope" }).mockResolvedValueOnce({ state: "closed" });
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    await expect(openSpeechSession(selection, new AbortController().signal)).resolves.toEqual(result);
    await expect(openSpeechSession(selection, new AbortController().signal)).rejects.toThrow(/stale or incompatible/);
    expect(invoke).toHaveBeenLastCalledWith("speech_request", { request: { operation: "close_session", sessionId: "session-1" } });
  });

  it("closes a granted session when settings change before the host acknowledges it", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    let acknowledge!: (value: unknown) => void;
    const invoke = vi.fn((_command: string, args: { request: { operation: string } }) => args.request.operation === "open_session"
      ? new Promise((resolve) => { acknowledge = resolve; }) : Promise.resolve({ state: "closed" }));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    const controller = new AbortController();
    const selection = { version: 1, analytics: { mode: "local", providerId: "selected", modelId: "model" },
      scopeId: "project-a/vdt-b", stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null, language: "ru" } as const;
    const pending = openSpeechSession(selection, controller.signal);
    controller.abort();
    acknowledge({ state: "open", sessionId: "session-1" });
    await expect(pending).rejects.toThrow();
    expect(invoke.mock.calls.map(([, args]) => args.request)).toEqual([
      { operation: "open_session", selection }, { operation: "close_session", sessionId: "session-1" }
    ]);
  });
  it("cancels again if capture is stopped before the submission acknowledgement arrives", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    let acknowledge: (value: unknown) => void = () => undefined;
    const invoke = vi.fn((_command: string, args: { request: { operation: string } }) => args.request.operation === "transcribe"
      ? new Promise((resolve) => { acknowledge = resolve; }) : Promise.resolve({ state: "cancelled" }));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    const controller = new AbortController();
    const pending = transcribeSpeech({ sessionId: "session-1", audioBase64: "AA==" }, controller.signal);
    controller.abort();
    acknowledge({ state: "processing" });
    await expect(pending).rejects.toThrow();
    expect(invoke.mock.calls.filter(([, args]) => args.request.operation === "cancel")).toHaveLength(2);
  });
});
