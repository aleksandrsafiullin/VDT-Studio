import type { SpeechJobResult, SpeechRequest, SpeechStatus } from "@vdt-studio/local-runner/speech-catalog";
import { resolveVdtAppMode } from "./app-mode";

interface SpeechBridge { __TAURI__?: { core?: { invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown> }; invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown> } }

export async function speechRequest<T extends SpeechStatus | SpeechJobResult>(request: SpeechRequest): Promise<T> {
  const mode = resolveVdtAppMode();
  if (mode === "hosted_web") throw new Error("Local voice input is available in VDT Studio Desktop or on localhost.");
  if (mode === "desktop") {
    const bridge = (globalThis as SpeechBridge).__TAURI__;
    const invoke = bridge?.core?.invoke ?? bridge?.invoke;
    if (!invoke) throw new Error("The local voice input runtime is unavailable. Restart VDT Studio Desktop.");
    try { return await invoke("speech_request", { request }) as T; }
    catch (error) { throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : "Local voice input failed."); }
  }
  let response: Response;
  try {
    response = await fetch("/api/speech", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), cache: "no-store", signal: AbortSignal.timeout(30_000)
    });
  } catch {
    throw new Error("The local voice runtime did not respond. Retry when the application is ready.");
  }
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Local voice input failed.");
  return result;
}

export async function transcribeSpeech(
  input: Omit<Extract<SpeechRequest, { operation: "transcribe" }>, "operation" | "jobId">,
  signal: AbortSignal
): Promise<string> {
  signal.throwIfAborted();
  const jobId = crypto.randomUUID();
  const cancel = () => { void speechRequest({ operation: "cancel", jobId }).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    let result = await speechRequest<SpeechJobResult>({ ...input, operation: "transcribe", jobId });
    if (signal.aborted) { cancel(); signal.throwIfAborted(); }
    // Native IPC returns immediately; inference never holds the desktop command lock.
    const deadline = Date.now() + 60_000;
    while (result.state === "processing") {
      signal.throwIfAborted();
      if (Date.now() > deadline) { cancel(); throw new Error("Recognition took too long. Try the Tiny model."); }
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      signal.throwIfAborted();
      result = await speechRequest<SpeechJobResult>({ operation: "result", jobId });
    }
    signal.throwIfAborted();
    if (result.state === "error") throw new Error(result.error);
    if (result.state === "cancelled") throw new DOMException("Dictation cancelled", "AbortError");
    return result.text;
  } finally { signal.removeEventListener("abort", cancel); }
}
