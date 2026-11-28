import { readBoundedText } from "@vdt-studio/ai-harness/browser";
import { SPEECH_SAMPLE_RATE } from "@vdt-studio/local-runner/speech-catalog";
import { z } from "zod";
import type { VdtStudioState } from "@/components/vdt/vdt-store";
import { apiKeyScope } from "./api-key-persistence";
import { audioBase64 } from "./live-dictation";
import { selectedSpeechAnalytics } from "./speech-client";

export interface OpenAiSpeechCredentialTarget {
  runId: string;
  analyticsBindingId: string;
  scope: { projectId: string; vdtId: string; revisionId: string; commitGeneration: number };
}

const directOpenAiKeyScope = JSON.stringify(["byok.v1", "openai", "none", "https://api.openai.com/v1"]);
const activeStatuses = new Set(["queued", "running", "needs_user_input", "waiting_approval"]);
const presenceResponse = z.object({ state: z.literal("existing_credential_status"), present: z.boolean() }).strict();
const separatePresenceResponse = z.object({ state: z.literal("separate_credential_status"), present: z.boolean() }).strict();
const synthesisGrant = z.object({ state: z.literal("granted"), grantId: z.uuid(), direction: z.literal("tts") });
const synthesisSession = z.object({ state: z.literal("open"), sessionId: z.uuid(), stt: z.literal("off"), tts: z.object({
  provider: z.literal("openai"), transport: z.literal("realtime_synthesis"), boundary: z.literal("provider_service"),
  billing: z.literal("api"), aiGeneratedVoice: z.literal(true)
}) });
const separateSynthesisGrant = synthesisGrant.extend({ purpose: z.literal("separate_host_sample") });
const separateSynthesisSession = synthesisSession.extend({ tts: synthesisSession.shape.tts.extend({ purpose: z.literal("separate_host_sample") }) });
const maxWaveBase64 = Math.ceil((24_000 * 2 * 24 + 44) / 3) * 4;
const synthesisResult = z.object({ state: z.literal("synthesized"), playbackId: z.uuid(), aiGeneratedVoice: z.literal(true),
  waveformBase64: z.string().min(60).max(maxWaveBase64).regex(/^[A-Za-z0-9+/]+={0,2}$/) });
const closed = z.object({ state: z.literal("closed") });
const recognitionGrant = z.object({ state: z.literal("granted"), grantId: z.uuid(), direction: z.literal("stt") });
const opened = z.object({ state: z.literal("open"), sessionId: z.uuid() }).passthrough();
const recognitionSession = z.object({ scope: z.object({ projectId: z.string(), vdtId: z.string(), revisionId: z.string(),
  commitGeneration: z.number().int().nonnegative() }), tts: z.enum(["off", "apple_local"]), stt: z.object({
  provider: z.literal("openai"), model: z.literal("gpt-transcribe"), boundary: z.literal("provider_service"), billing: z.literal("api")
}) });
const recognitionResult = z.object({ state: z.literal("transcribed"), text: z.string().max(4096) }).strict();

/** Project the selected connection and saved VDT identity, never its credential. */
export function openAiSpeechCredentialTarget(state: Pick<VdtStudioState, "workspace" | "executionSettings" | "activeAgentRunId" | "agentRun">): OpenAiSpeechCredentialTarget | undefined {
  const { executionSettings, agentRun } = state;
  const summary = agentRun?.executionSummary;
  const analytics = selectedSpeechAnalytics(executionSettings);
  if (summary?.executionMode !== "api_keys" || summary.backendId !== "openai_compatible"
    || analytics.mode !== "api_keys" || analytics.providerId !== "openai_compatible" || analytics.modelId !== summary.modelId
    || apiKeyScope(executionSettings) !== directOpenAiKeyScope) return;
  return savedOpenAiSpeechTarget(state);
}

/** The separate host credential requires a saved run, independent of its analytical backend. */
export function savedOpenAiSpeechTarget(state: Pick<VdtStudioState, "workspace" | "activeAgentRunId" | "agentRun">): OpenAiSpeechCredentialTarget | undefined {
  const { workspace, activeAgentRunId, agentRun } = state;
  const { activeProjectId, activeVdtId, draftRevisionBase } = workspace;
  if (!activeProjectId || !activeVdtId || !draftRevisionBase || workspace.pendingRevisionCommit
    || draftRevisionBase.projectId !== activeProjectId || draftRevisionBase.vdtId !== activeVdtId
    || !agentRun || agentRun.runId !== activeAgentRunId || !activeStatuses.has(agentRun.status)) return;
  const runScope = agentRun.request.workspace;
  const analyticsBindingId = agentRun.request.executionBindingId;
  if (!analyticsBindingId || runScope?.projectId !== activeProjectId || runScope?.vdtId !== activeVdtId) return;

  const { activeRevisionId, commitGeneration } = draftRevisionBase.expectedHead;
  const selectedHead = workspace.projectSummaries.find(item => item.project.id === activeProjectId)?.vdts
    .find(item => item.vdt.id === activeVdtId)?.head;
  const runHead = agentRun.workspaceRevision?.head;
  if (!activeRevisionId || !Number.isSafeInteger(commitGeneration) || commitGeneration < 0 || !selectedHead || selectedHead.projectId !== activeProjectId
    || selectedHead.vdtId !== activeVdtId || selectedHead.pendingRevisionId !== null || selectedHead.activeRevisionId !== activeRevisionId
    || selectedHead.commitGeneration !== commitGeneration
    || (runHead?.activeRevisionId ?? runScope.expectedRevision?.expectedActiveRevisionId) !== activeRevisionId
    || (runHead?.commitGeneration ?? runScope.expectedRevision?.expectedCommitGeneration) !== commitGeneration) return;
  return { runId: activeAgentRunId, analyticsBindingId, scope: {
    projectId: activeProjectId, vdtId: activeVdtId, revisionId: activeRevisionId, commitGeneration
  } };
}

export async function checkSeparateOpenAiVoiceCredential(target: OpenAiSpeechCredentialTarget, signal: AbortSignal,
  isCurrent: () => boolean, port = fetch) {
  if (signal.aborted || !isCurrent()) return undefined;
  const status = await voiceRequest(target, { operation: "separate_credential_status" }, separatePresenceResponse, signal, port, 512);
  return !signal.aborted && isCurrent() ? status.present : undefined;
}

export async function checkOpenAiSpeechCredential(target: OpenAiSpeechCredentialTarget, signal: AbortSignal, isCurrent: () => boolean, port = fetch) {
  if (signal.aborted || !isCurrent()) return undefined;
  try {
    const status = await voiceRequest(target, { operation: "existing_credential_status" }, presenceResponse, signal, port, 512);
    return !signal.aborted && isCurrent() ? status.present : undefined;
  } catch (error) {
    if (!signal.aborted && isCurrent()) throw error;
    return undefined;
  }
}

async function voiceRequest<T>(target: OpenAiSpeechCredentialTarget, operation: object, schema: z.ZodType<T>,
  signal: AbortSignal, port: typeof fetch, limit = 2_048): Promise<T> {
  const { runId, analyticsBindingId, scope: { projectId, vdtId, revisionId, commitGeneration } } = target;
  const response = await port("/api/speech/byok", {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", credentials: "same-origin",
    mode: "same-origin", redirect: "error", signal,
    body: JSON.stringify({ ...operation, runId, analyticsBindingId, scope: { projectId, vdtId, revisionId, commitGeneration } })
  });
  const body: unknown = JSON.parse(await readBoundedText(response, limit, "OpenAI voice response", signal));
  if (!response.ok) {
    const failure = z.object({ error: z.string() }).safeParse(body);
    const code = failure.success ? failure.data.error : undefined;
    if (code === "quota_exhausted") throw new Error("OpenAI API quota is exhausted. Check API billing or use a local voice.");
    if (code === "rate_limited") throw new Error("OpenAI API voice is rate limited. Wait and try again.");
    if (code === "voice_busy") throw new Error("The previous voice request is still closing. Try again in up to two minutes.");
    if (code === "cleanup_unconfirmed") throw new Error("The OpenAI voice session could not close. Reopen VDT Studio before retrying.");
    throw new Error("The OpenAI voice request could not finish.");
  }
  return schema.parse(body);
}

/** Call after explicit paid recognition consent and a single finished microphone capture. */
export async function transcribeOpenAiDictation(target: OpenAiSpeechCredentialTarget, samples: Float32Array, selection: {
  recognitionLanguage: "en" | "ru" | "auto";
  synthesisLanguage: "en" | "ru";
  localSynthesis: "off" | "apple_local";
}, signal: AbortSignal, isCurrent: () => boolean, port = fetch): Promise<string | undefined> {
  const current = () => !signal.aborted && isCurrent();
  if (!current() || !samples.length) return;
  if (samples.length > SPEECH_SAMPLE_RATE * 10) throw new Error("OpenAI dictation is limited to ten seconds per recording.");
  const { recognitionLanguage, synthesisLanguage, localSynthesis } = selection;
  const grant = await voiceRequest(target, { operation: "grant", selection: {
    direction: "stt", provider: "openai", credentialSource: "active_direct_openai", consent: "send_audio_openai_api_billing"
  } }, recognitionGrant, AbortSignal.timeout(8_000), port);
  if (!current()) return;
  const session = await voiceRequest(target, { operation: "open", selection: {
    stt: { provider: "openai", grantId: grant.grantId }, tts: localSynthesis, recognitionLanguage, synthesisLanguage
  } }, opened, AbortSignal.timeout(8_000), port);
  let text: string | undefined;
  let recognitionFailed = false;
  try {
    if (!current()) return;
    const { scope, tts } = recognitionSession.parse(session);
    const expected = target.scope;
    if (scope.projectId !== expected.projectId || scope.vdtId !== expected.vdtId || scope.revisionId !== expected.revisionId
      || scope.commitGeneration !== expected.commitGeneration || tts !== localSynthesis) throw new Error("The OpenAI recognition session changed scope or voice selection.");
    const result = await voiceRequest(target, { operation: "transcribe", sessionId: session.sessionId,
      operationId: crypto.randomUUID(), audioBase64: audioBase64(samples)
    }, recognitionResult, AbortSignal.any([signal, AbortSignal.timeout(26_000)]), port, 32_768);
    text = result.text.trim();
  } catch (error) {
    recognitionFailed = true;
    if (current()) throw error;
  } finally {
    try {
      await voiceRequest(target, { operation: "close", sessionId: session.sessionId }, closed, AbortSignal.timeout(5_000), port);
    } catch (error) {
      if (!recognitionFailed && current()) throw error;
    }
  }
  return current() ? text : undefined;
}

/** The settings preview sends a fixed, host-owned sample through one paid grant. */
export async function prepareOpenAiVoicePreview(target: OpenAiSpeechCredentialTarget, locale: "en" | "ru",
  signal: AbortSignal, isCurrent: () => boolean, port = fetch): Promise<Blob | undefined> {
  return prepareVoicePreview(target, locale, signal, isCurrent, port, false);
}

export async function prepareSeparateOpenAiVoicePreview(target: OpenAiSpeechCredentialTarget, locale: "en" | "ru",
  signal: AbortSignal, isCurrent: () => boolean, port = fetch): Promise<Blob | undefined> {
  return prepareVoicePreview(target, locale, signal, isCurrent, port, true);
}

async function prepareVoicePreview(target: OpenAiSpeechCredentialTarget, locale: "en" | "ru",
  signal: AbortSignal, isCurrent: () => boolean, port: typeof fetch, separate: boolean): Promise<Blob | undefined> {
  const current = () => !signal.aborted && isCurrent();
  if (!current()) return;
  // Let admission return its lease ID so scope loss during open can still close it.
  const admissionSignal = AbortSignal.timeout(8_000);
  const grant = await voiceRequest(target, {
    operation: "grant", selection: separate ? {
      direction: "tts", provider: "openai", credentialSource: "host_voice_key",
      consent: "send_sample_openai_voice_api_billing", purpose: "separate_host_sample"
    } : {
      direction: "tts", provider: "openai", credentialSource: "active_direct_openai", consent: "send_text_openai_api_billing_ai_voice"
    }
  }, separate ? separateSynthesisGrant : synthesisGrant, admissionSignal, port);
  if (!current()) return;
  const session = await voiceRequest(target, {
    operation: "open", selection: {
      stt: "off", tts: { provider: "openai", grantId: grant.grantId, transport: "realtime_synthesis" },
      recognitionLanguage: "auto", synthesisLanguage: locale
    }
  }, opened, admissionSignal, port);
  let preview: Blob | undefined;
  let synthesisFailed = false;
  try {
    if (!current()) return;
    (separate ? separateSynthesisSession : synthesisSession).parse(session);
    const result = await voiceRequest(target, {
      operation: "synthesize", sessionId: session.sessionId, operationId: crypto.randomUUID(), source: { kind: "sample" }
    }, synthesisResult, AbortSignal.any([signal, AbortSignal.timeout(26_000)]), port, maxWaveBase64 + 512);
    if (!current()) return;
    const decoded = atob(result.waveformBase64);
    if (decoded.length <= 44 || decoded.slice(0, 4) !== "RIFF" || decoded.slice(8, 12) !== "WAVE") {
      throw new Error("OpenAI returned invalid preview audio.");
    }
    preview = new Blob([Uint8Array.from(decoded, character => character.charCodeAt(0))], { type: "audio/wav" });
  } catch (error) {
    synthesisFailed = true;
    throw error;
  } finally {
    try {
      await voiceRequest(target, { operation: "close", sessionId: session.sessionId }, closed, AbortSignal.timeout(5_000), port);
    } catch (error) {
      if (!synthesisFailed && current()) throw error;
    }
  }
  return current() ? preview : undefined;
}
