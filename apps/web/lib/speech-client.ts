import type { SpeechAnalyticsSelection, SpeechJobResult, SpeechRequest, SpeechResponse, SpeechSelection, SpeechSessionAdmission } from "@vdt-studio/local-runner/speech-catalog";
import type { AgentAnswerCapture } from "@vdt-studio/vdt-agent-runtime";
import { builtinHarness } from "@vdt-studio/model-bridge/harness-catalog";
import { resolveExecutionSettings } from "./execution-mode-resolver";
import type { ExecutionSettings } from "./execution-mode-catalog";
import { resolveVdtAppMode } from "./app-mode";

interface SpeechBridge { __TAURI__?: { core?: { invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown> }; invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown> } }
type BrowserSpeechRequest = SpeechRequest & { answerCapture?: AgentAnswerCapture };
const packagedCaptureSessions = new Map<string, { dispose: () => void; playbackStarted: boolean }>();

function audibleMedia(target: EventTarget | null): target is HTMLMediaElement {
  return target instanceof HTMLMediaElement && !target.muted && target.volume > 0;
}

/** A prepared system preview can play from the renderer after its native
 * synthesis call has ended. Revoke the answer capture when it audibly starts. */
async function openPackagedAnswerCapture<T extends SpeechResponse>(request: BrowserSpeechRequest): Promise<T> {
  const page = typeof document === "undefined" ? undefined : document;
  const stopPlayback = () => new Error("Stop spoken playback before opening a voice answer.");
  if (page && Array.from(page.querySelectorAll("audio,video")).some(media => audibleMedia(media) && !media.paused && !media.ended)) {
    throw stopPlayback();
  }
  let sessionId: string | undefined;
  const onPlayback = (event: Event) => {
    if (capture.playbackStarted || !audibleMedia(event.target)
      || (event.type === "volumechange" && (event.target.paused || event.target.ended))) return;
    capture.playbackStarted = true;
    if (sessionId) void closeSpeechSession(sessionId);
  };
  const capture = { dispose: () => {
    page?.removeEventListener("play", onPlayback, true);
    page?.removeEventListener("volumechange", onPlayback, true);
  }, playbackStarted: false };
  page?.addEventListener("play", onPlayback, true);
  page?.addEventListener("volumechange", onPlayback, true);
  try {
    const result = await requestSpeechHttp<T>(request);
    if ("state" in result && result.state === "open") {
      sessionId = result.sessionId;
      packagedCaptureSessions.set(sessionId, capture);
      if (capture.playbackStarted) { await closeSpeechSession(sessionId); throw stopPlayback(); }
    }
    return result;
  } finally {
    if (!sessionId) capture.dispose();
  }
}

export async function speechRequest<T extends SpeechResponse>(request: BrowserSpeechRequest): Promise<T> {
  const mode = resolveVdtAppMode();
  if (mode !== "desktop" && (request.operation === "open_tts" || request.operation === "tts_result" || request.operation === "close_tts")) {
    throw new Error("Verified spoken updates require an installed Apple system voice in VDT Studio Desktop.");
  }
  if (mode === "hosted_web") throw new Error("Local voice input is available in VDT Studio Desktop or on localhost.");
  if (mode === "desktop") {
    const answerOpen = request.operation === "open_session" && request.answerCapture !== undefined
      && globalThis.location?.origin === "http://127.0.0.1:37541";
    const sessionId = "sessionId" in request ? request.sessionId : undefined;
    if (answerOpen || (sessionId && packagedCaptureSessions.has(sessionId))) {
      try {
        return await (answerOpen ? openPackagedAnswerCapture<T>(request) : requestSpeechHttp<T>(request));
      } catch (error) {
        if (!answerOpen || !(error instanceof Error && "code" in error
          && (error.code === "PACKAGED_SPEECH_BRIDGE_UNAVAILABLE" || error.code === "PACKAGED_SPEECH_DRAFT_ONLY"))) throw error;
        // Older, Windows, and debug bundles retain editable draft behavior.
      } finally {
        if (request.operation === "close_session" && sessionId) {
          packagedCaptureSessions.get(sessionId)?.dispose();
          packagedCaptureSessions.delete(sessionId);
        }
      }
    }
    const bridge = (globalThis as SpeechBridge).__TAURI__;
    const invoke = bridge?.core?.invoke ?? bridge?.invoke;
    if (!invoke) throw new Error("The local voice input runtime is unavailable. Restart VDT Studio Desktop.");
    const { answerCapture: _answerCapture, ...nativeRequest } = request;
    try { return await invoke("speech_request", { request: nativeRequest }) as T; }
    catch (error) { throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Local voice input failed."); }
  }
  return requestSpeechHttp<T>(request);
}

async function requestSpeechHttp<T extends SpeechResponse>(request: BrowserSpeechRequest): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/speech", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store", signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new Error("The local voice runtime did not respond. Retry when the application is ready.");
  }
  const result = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw Object.assign(new Error(result.error ?? "Local voice input failed."), { code: result.code });
  return result;
}

/** Display and capture scope only. Credentials never leave execution settings here. */
export function selectedSpeechAnalytics(settings: ExecutionSettings): SpeechAnalyticsSelection {
  const { providerId, providerConfig } = resolveExecutionSettings(settings);
  if (providerId === "apple_foundation_models") {
    return { mode: "local", providerId, modelId: "SystemLanguageModel.default" };
  }
  const model = providerId === "azure_openai" ? providerConfig?.deployment : providerConfig?.model;
  const modelId = typeof model === "string" && model.trim() ? model.trim().slice(0, 240) : null;
  if (providerId === "local_runner") {
    const backendId = typeof providerConfig?.backendId === "string" && providerConfig.backendId.trim()
      ? providerConfig.backendId.trim().slice(0, 240) : "local_runner";
    return { mode: builtinHarness(backendId) ? "cli_subscription" : "legacy", providerId: backendId, modelId };
  }
  return { mode: providerId === "mock" ? "legacy" : "api_keys", providerId, modelId };
}

/** Compare the effective connection on the device. No credential or raw URL is sent to the voice host. */
export function speechAnalyticsConnectionKey(settings: ExecutionSettings): string {
  const { providerId, providerConfig } = resolveExecutionSettings(settings);
  const destination = (value: unknown) => {
    if (typeof value !== "string") return null;
    try {
      const url = new URL(value);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch { return null; }
  };
  return JSON.stringify(providerId === "local_runner" ? [
    settings.executionMode, settings.localRunnerPresetId, settings.selectedCliAgentId,
    destination(providerConfig?.runnerUrl), destination(settings.localBaseUrl)
  ] : [
    settings.executionMode, settings.gatewayPresetId, settings.byokGateway, settings.byokProtocol,
    destination(providerConfig?.endpoint ?? providerConfig?.baseUrl), providerConfig?.apiVersion, providerConfig?.anthropicVersion
  ]);
}

export async function openSpeechSession(selection: SpeechSelection, signal: AbortSignal, answerCapture?: AgentAnswerCapture): Promise<SpeechSessionAdmission> {
  signal.throwIfAborted();
  const session = await speechRequest<SpeechSessionAdmission>({ operation: "open_session", selection,
    ...(answerCapture ? { answerCapture } : {})
  });
  const matches = session?.state === "open" && typeof session.sessionId === "string"
    && session.scopeId === selection.scopeId && session.language === selection.language
    && session.analytics?.mode === selection.analytics.mode && session.analytics.providerId === selection.analytics.providerId
    && session.analytics.modelId === selection.analytics.modelId
    && session.stt && session.stt.providerId === selection.stt?.providerId && session.stt.modelId === selection.stt.modelId
    && session.stt.boundary === "on_device" && session.stt.billing === "none" && session.stt.credential?.kind === "none"
    && session.stt.consent === "explicit_component" && session.stt.scope === "bound_voice_session"
    && session.tts === null && session.realtime === null;
  if (signal.aborted || !matches) {
    if (typeof session?.sessionId === "string") await closeSpeechSession(session.sessionId);
    signal.throwIfAborted();
    throw new Error("The local voice runtime returned a stale or incompatible microphone session. Retry voice input.");
  }
  return session;
}

export async function keepSpeechSession(sessionId: string): Promise<void> {
  await speechRequest({ operation: "keep_session", sessionId });
}

export async function closeSpeechSession(sessionId: string): Promise<void> {
  await speechRequest({ operation: "close_session", sessionId }).catch(() => undefined);
}

export async function transcribeSpeechWithProof(
  input: Omit<Extract<SpeechRequest, { operation: "transcribe" }>, "operation" | "jobId">,
  signal: AbortSignal
): Promise<CompletedSpeech> {
  signal.throwIfAborted();
  const capture = packagedCaptureSessions.get(input.sessionId);
  const jobId = crypto.randomUUID();
  const cancel = () => { void speechRequest({ operation: "cancel", sessionId: input.sessionId, jobId }).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let result = await speechRequest<SpeechJobResult & { recognitionProof?: string }>({ ...input, operation: "transcribe", jobId });
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    // Native IPC returns immediately; inference never holds the desktop command lock.
    const deadline = Date.now() + 60_000;
    while (result.state === "processing") {
      signal.throwIfAborted();
      if (Date.now() > deadline) { cancel(); throw new Error("Recognition took too long. Try the Tiny model."); }
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      signal.throwIfAborted();
      result = await speechRequest<SpeechJobResult & { recognitionProof?: string }>({ operation: "result", sessionId: input.sessionId, jobId });
    }
    signal.throwIfAborted();
    if (result.state === "error") throw new Error(result.error);
    if (result.state === "cancelled") throw new DOMException("Dictation cancelled", "AbortError");
    return { text: result.text, ...(!capture?.playbackStarted && typeof result.recognitionProof === "string" ? { recognitionProof: result.recognitionProof } : {}) };
  } finally { signal.removeEventListener("abort", cancel); }
}

export interface CompletedSpeech { text: string; recognitionProof?: string }
export async function transcribeSpeech(
  input: Parameters<typeof transcribeSpeechWithProof>[0],
  signal: AbortSignal
): Promise<string> {
  return (await transcribeSpeechWithProof(input, signal)).text;
}
