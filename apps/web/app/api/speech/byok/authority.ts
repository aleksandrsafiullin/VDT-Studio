import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SPEECH_MAX_AUDIO_BYTES } from "@vdt-studio/local-runner/speech-catalog";
import { hostExecutionAdmission } from "../../agent/runs/execution-binding-admission";
import { isStructuredModelExecutionBinding, type AgentExecutionBindingRegistry } from "../../agent/runs/execution-bindings";
import { isOpenAiSessionBinding, openAiSessionBindings } from "../../agent/runs/byok-bindings";
import { assertOpenAiSpeechCompatibility, OpenAiAudio, OpenAiAudioError, OPENAI_SPEECH_MODEL, OPENAI_SPEECH_SHUTDOWN,
  OPENAI_TRANSCRIPTION_MODEL } from "./openai-audio";
import { OpenAiRealtimeSpeech, OPENAI_REALTIME_SPEECH_MODEL } from "./openai-realtime";

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const scopeSchema = z.object({ projectId: identifier, vdtId: identifier, revisionId: identifier, commitGeneration: z.number().int().nonnegative() }).strict();
const credentialRef = z.string().regex(/^(?:openai_byok_session_|api_byok_session_)[0-9a-f]{32}$/);
const credentialSource = { credentialRef: credentialRef.optional(), credentialSource: z.literal("active_direct_openai").optional() };
const cloudStt = z.object({ provider: z.literal("openai"), ...credentialSource, consent: z.literal("send_audio_openai_api_billing") }).strict();
const cloudTts = z.object({ provider: z.literal("openai"), ...credentialSource, consent: z.literal("send_text_openai_api_billing_ai_voice") }).strict();
const cloudTtsCompatibility = cloudTts.extend({ consent: z.literal("send_text_openai_http_compatibility_api_billing_ai_voice") });
const separateVoiceTts = z.object({ provider: z.literal("openai"), direction: z.literal("tts"),
  credentialSource: z.literal("host_voice_key"), consent: z.literal("send_sample_openai_voice_api_billing"),
  purpose: z.literal("separate_host_sample") }).strict();
const cloudRealtime = z.object({ provider: z.literal("openai"), ...credentialSource, consent: z.literal("send_audio_openai_realtime_api_billing_ai_voice") }).strict();
const connection = { scope: scopeSchema, analyticsBindingId: identifier, runId: identifier.optional() };
const active = { ...connection, sessionId: z.uuid() };
const cloudGrant = z.object({ provider: z.literal("openai"), grantId: z.uuid() }).strict();
const cloudTtsGrant = cloudGrant.extend({ transport: z.enum(["realtime_synthesis", "http_compatibility"]).optional() });
const language = z.enum(["en", "ru"]);
const MAX_AUDIO_BASE64 = Math.ceil(SPEECH_MAX_AUDIO_BYTES / 3) * 4;

export const byokVoiceRequest = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("existing_credential_status"), ...connection, runId: identifier }).strict(),
  z.object({ operation: z.literal("separate_credential_status"), ...connection, runId: identifier }).strict(),
  z.object({ operation: z.literal("grant"), ...connection, selection: z.union([separateVoiceTts, z.discriminatedUnion("direction", [
    cloudStt.extend({ direction: z.literal("stt") }),
    cloudTts.extend({ direction: z.literal("tts"), purpose: z.literal("current_run_readback").optional() }),
    cloudTtsCompatibility.extend({ direction: z.literal("tts_compatibility") }),
    cloudRealtime.extend({ direction: z.literal("realtime") })
  ]).refine(selection => Boolean(selection.credentialRef) !== Boolean(selection.credentialSource))]) }).strict(),
  z.object({ operation: z.literal("open"), ...connection, selection: z.object({
    stt: z.union([z.enum(["off", "apple_local", "whisper_local"]), cloudGrant]),
    tts: z.union([z.enum(["off", "apple_local"]), cloudTtsGrant]),
    recognitionLanguage: z.enum(["en", "ru", "auto"]), synthesisLanguage: language
  }).strict() }).strict(),
  z.object({ operation: z.literal("transcribe"), ...active, operationId: z.uuid(), audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64) }).strict(),
  z.object({ operation: z.literal("synthesize"), ...active, operationId: z.uuid(), source: z.union([
    z.object({ kind: z.literal("sample") }).strict(),
    z.object({ kind: z.literal("verified_event"), runId: identifier, notificationKey: z.string().min(1).max(512) }).strict()
  ]) }).strict(),
  z.object({ operation: z.literal("release_playback"), ...active, playbackId: z.uuid() }).strict(),
  z.object({ operation: z.literal("close"), ...active }).strict(),
  z.object({ operation: z.literal("realtime_eligibility"), ...connection, selection: cloudGrant }).strict()
]);

export type ByokVoiceRequest = z.infer<typeof byokVoiceRequest>;
type VoiceScope = z.infer<typeof scopeSchema>;
type VoiceConnection = Pick<ByokVoiceRequest, "scope" | "analyticsBindingId" | "runId">;
type OpenSelection = Extract<ByokVoiceRequest, { operation: "open" }>["selection"];
type Notification = Extract<ByokVoiceRequest, { operation: "synthesize" }>["source"] & { kind: "verified_event" };
type SynthesisTransport = NonNullable<z.infer<typeof cloudTtsGrant>["transport"]>;
type SpeechFailure = "scope_unavailable" | "api_mode_required" | "voice_busy" | "consent_required" | "stale_session"
  | "operation_replayed" | "notification_unavailable" | "readback_already_requested";

export class ByokVoiceError extends Error {
  constructor(readonly code: SpeechFailure) { super(code); this.name = "ByokVoiceError"; }
}

export interface ByokVoiceHost {
  confirmWorkspace(scope: VoiceScope): boolean;
  analyticsIdentity(connection: VoiceConnection, useSeparateVoice?: boolean): AnalyticsEvidence | undefined;
  isActiveReadbackIdentity(runId: string, identity: string): boolean;
  resolveOpenAiKey(reference: string): string | undefined;
  consumeReference(reference: string): boolean;
  withCurrentOpenAiKey<Result>(connection: VoiceConnection, identity: string, invoke: (credential: string) => Result): Result | undefined;
  withSeparateOpenAiVoiceKey<Result>(connection: VoiceConnection, identity: string, invoke: (credential: string) => Result): Result | undefined;
  notificationText(scope: VoiceScope, request: Notification, locale: "en" | "ru", afterSequence: number): string | undefined;
  currentReadbackText(scope: VoiceScope, request: Notification, locale: "en" | "ru"): string | undefined;
}

interface AnalyticsEvidence {
  identity: string;
  eventSequence: number;
  canStart: boolean;
  directOpenAiCredentialPresent: boolean;
  separateVoiceCredentialPresent?: boolean;
}

/** The protected provider registrar is the only source of pending session keys. */
export function byokVoiceCredentials(registry: AgentExecutionBindingRegistry) {
  return {
    pendingIdentity(bindingId: string) {
      try {
        const admission = hostExecutionAdmission(registry.resolve(bindingId));
        if (admission.mode === "api_keys") return { identity: JSON.stringify([bindingId, admission.providerId, admission.modelId]),
          eventSequence: 0, canStart: true, directOpenAiCredentialPresent: false };
      } catch { return undefined; }
    },
    resolveOpenAiKey(reference: string) {
      if (!isOpenAiSessionBinding(reference)) return undefined;
      try {
        const binding = registry.resolve(reference);
        if (!isStructuredModelExecutionBinding(binding) || hostExecutionAdmission(binding).mode !== "api_keys"
          || binding.modelEngineAdapter.providerId !== "openai_compatible") return undefined;
        const config = binding.modelEngineAdapter.providerConfig;
        return config?.baseUrl === "https://api.openai.com/v1" && typeof config.apiKey === "string" ? config.apiKey : undefined;
      } catch { return undefined; }
    },
    consumeReference: (reference: string) => openAiSessionBindings(registry).consume(reference)
  };
}

const leaseLifetimeMs = 120_000;
const grantLifetimeMs = 45_000;
const outputLifetimeMs = 30_000;
const maxRequests = 16;
const sample = { en: "This is an AI-generated OpenAI voice preview.", ru: "Это пример голоса, созданного искусственным интеллектом OpenAI." } as const;

type VoiceCredential = { kind: "registered"; key: string } | { kind: "active_direct_openai" } | { kind: "host_voice_key" };
type SynthesisPurpose = "current_run_readback" | "separate_host_sample" | undefined;

interface VoiceLease {
  id: string;
  connection: VoiceConnection;
  identity: string;
  eventSequence: number;
  selection: Pick<OpenSelection, "recognitionLanguage" | "synthesisLanguage">;
  stt?: VoiceCredential;
  tts?: { credential: VoiceCredential; transport: SynthesisTransport; purpose: SynthesisPurpose };
  controller: AbortController;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  operations: Set<string>;
  notifications: Set<string>;
  running: boolean;
  separateSampleRequested?: true;
  playback?: { id: string; timer: ReturnType<typeof setTimeout> };
}

interface VoiceGrant {
  connection: VoiceConnection;
  identity: string;
  direction: Extract<ByokVoiceRequest, { operation: "grant" }>["selection"]["direction"];
  purpose: SynthesisPurpose;
  credential: VoiceCredential;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

function copyConnection({ scope, analyticsBindingId, runId }: VoiceConnection): VoiceConnection {
  return { scope: { ...scope }, analyticsBindingId, runId };
}

function sameConnection(first: VoiceConnection, next: VoiceConnection) {
  return first.analyticsBindingId === next.analyticsBindingId && first.runId === next.runId
    && first.scope.projectId === next.scope.projectId && first.scope.vdtId === next.scope.vdtId
    && first.scope.revisionId === next.scope.revisionId && first.scope.commitGeneration === next.scope.commitGeneration;
}

function decodeWave(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new OpenAiAudioError("invalid_audio");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > SPEECH_MAX_AUDIO_BYTES || bytes.toString("base64") !== value) throw new OpenAiAudioError("invalid_audio");
  return bytes;
}

/** One active cloud voice lease. It cannot send analytical messages or mutate the VDT. */
export class ByokVoiceAuthority {
  #lease: VoiceLease | undefined;
  #cleanupUnconfirmed = false;
  #grants = new Map<string, VoiceGrant>();
  #paidReadbacks = new Map<string, { runId: string; keys: Set<string> }>();
  constructor(private readonly host: ByokVoiceHost, private readonly audio = new OpenAiAudio(),
    private readonly realtimeSpeech = new OpenAiRealtimeSpeech()) {}

  async dispatch(request: ByokVoiceRequest, caller: AbortSignal) {
    if (caller.aborted) throw new OpenAiAudioError("cancelled");
    if (this.#cleanupUnconfirmed) throw new OpenAiAudioError("cleanup_unconfirmed");
    if (request.operation === "existing_credential_status") {
      const evidence = this.host.confirmWorkspace(request.scope) ? this.host.analyticsIdentity(request) : undefined;
      return { state: "existing_credential_status" as const, present: evidence?.canStart === true && evidence.directOpenAiCredentialPresent };
    }
    if (request.operation === "separate_credential_status") {
      const evidence = this.host.confirmWorkspace(request.scope) ? this.host.analyticsIdentity(request, true) : undefined;
      return { state: "separate_credential_status" as const, present: evidence?.canStart === true && evidence.separateVoiceCredentialPresent === true };
    }
    if (request.operation === "grant" || request.operation === "open" || request.operation === "realtime_eligibility") {
      if (!this.host.confirmWorkspace(request.scope)) throw new ByokVoiceError("scope_unavailable");
      const useSeparateVoice = request.operation === "grant" ? request.selection.credentialSource === "host_voice_key"
        : request.operation === "open" && typeof request.selection.tts === "object"
          && this.#grants.get(request.selection.tts.grantId)?.purpose === "separate_host_sample";
      const evidence = this.host.analyticsIdentity(request, useSeparateVoice);
      if (!evidence?.canStart) throw new ByokVoiceError("api_mode_required");
      if (this.#lease && this.#lease.expiresAt <= Date.now()) this.#close(this.#lease);
      if (this.#lease) throw new ByokVoiceError("voice_busy");
      if (request.operation === "grant") return this.#grant(request, evidence);
      if (request.operation === "open") return this.#open(request, evidence);
      const grant = this.#getGrant(request.selection.grantId, "realtime", request, evidence.identity);
      if (grant.credential.kind === "active_direct_openai" && !evidence.directOpenAiCredentialPresent) throw new OpenAiAudioError("credential_unavailable");
      return { state: "eligible_envelope_only" as const, provider: "openai", billing: "api", boundary: "provider_service",
        transportEnabled: false, aiGeneratedVoice: true, model: OPENAI_REALTIME_SPEECH_MODEL, envelope: { type: "session.update", session: {
          type: "realtime", output_modalities: ["audio"], tools: [], tool_choice: "none", tracing: null,
          audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, turn_detection: null },
            output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "alloy" } }
        } } };
    }
    const lease = this.#lease;
    if (!lease || lease.id !== request.sessionId || !sameConnection(lease.connection, request) || lease.controller.signal.aborted
      || lease.expiresAt <= Date.now()) throw new ByokVoiceError("stale_session");
    if (request.operation === "close") { this.#close(lease); return { state: "closed" as const }; }
    const usesActiveCredential = lease.stt?.kind === "active_direct_openai" || lease.tts?.credential.kind === "active_direct_openai";
    const usesSeparateVoice = lease.tts?.credential.kind === "host_voice_key";
    const requireCurrent = () => {
      const evidence = this.#lease === lease && !lease.controller.signal.aborted && this.host.confirmWorkspace(request.scope)
        ? this.host.analyticsIdentity(request, usesSeparateVoice) : undefined;
      // Provider callbacks may run after the absolute deadline and before the expiry timer.
      if (lease.expiresAt <= Date.now() || evidence?.identity !== lease.identity || (usesSeparateVoice && !evidence.canStart)) {
        this.#close(lease);
        throw new ByokVoiceError("stale_session");
      }
      if ((usesActiveCredential && !evidence.directOpenAiCredentialPresent)
        || (usesSeparateVoice && !evidence.separateVoiceCredentialPresent)) {
        this.#close(lease);
        throw new OpenAiAudioError("credential_unavailable");
      }
    };
    requireCurrent();
    if (request.operation === "release_playback") {
      if (lease.playback?.id !== request.playbackId) throw new ByokVoiceError("stale_session");
      this.#endPlayback(lease);
      return { state: "playback_released" as const };
    }
    if (lease.running || lease.playback) throw new ByokVoiceError("voice_busy");
    if (lease.operations.has(request.operationId) || lease.operations.size >= maxRequests) throw new ByokVoiceError("operation_replayed");
    const synthesis = lease.tts;
    const recognition = lease.stt;
    if ((request.operation === "transcribe" && !recognition) || (request.operation === "synthesize" && !synthesis)) {
      throw new ByokVoiceError("consent_required");
    }
    lease.operations.add(request.operationId);
    lease.running = true;
    const signal = AbortSignal.any([lease.controller.signal, caller]);
    try {
      if (request.operation === "transcribe") {
        const wave = decodeWave(request.audioBase64);
        const text = await this.#useCredential(lease, recognition!, key =>
          this.audio.transcribe(key, wave, lease.selection.recognitionLanguage, signal, requireCurrent));
        if (signal.aborted) throw new OpenAiAudioError("cancelled");
        requireCurrent();
        return { state: "transcribed" as const, text };
      }
      const locale = lease.selection.synthesisLanguage;
      const readbackOnly = synthesis!.purpose === "current_run_readback";
      if (usesSeparateVoice && lease.separateSampleRequested) throw new ByokVoiceError("operation_replayed");
      const notificationKey = request.source.kind === "verified_event" ? JSON.stringify([request.source.runId, request.source.notificationKey]) : undefined;
      if (notificationKey && lease.notifications.has(notificationKey)) throw new ByokVoiceError("operation_replayed");
      const readText = () => {
        if (request.source.kind === "sample") return readbackOnly ? undefined : sample[locale];
        if (usesSeparateVoice || request.source.runId !== lease.connection.runId) return undefined;
        return readbackOnly ? this.host.currentReadbackText(lease.connection.scope, request.source, locale)
          : this.host.notificationText(lease.connection.scope, request.source, locale, lease.eventSequence);
      };
      const text = readText();
      if (!text) throw new ByokVoiceError("notification_unavailable");
      if (notificationKey) lease.notifications.add(notificationKey);
      const requireCurrentNotification = () => {
        requireCurrent();
        if (readText() !== text) throw new ByokVoiceError("notification_unavailable");
        requireCurrent();
      };
      const transport = synthesis!.transport === "realtime_synthesis" ? this.realtimeSpeech : this.audio;
      const wave = await this.#useCredential(lease, synthesis!.credential, key => {
        if (readbackOnly && notificationKey) {
          requireCurrentNotification();
          this.#reservePaidReadback(lease, notificationKey);
        }
        if (usesSeparateVoice) lease.separateSampleRequested = true;
        return transport.synthesize(key, text, signal, requireCurrentNotification);
      });
      if (signal.aborted) throw new OpenAiAudioError("cancelled");
      requireCurrentNotification();
      const playbackId = randomUUID();
      const timer = setTimeout(() => this.#endPlayback(lease), outputLifetimeMs);
      timer.unref?.();
      lease.playback = { id: playbackId, timer };
      return { state: "synthesized" as const, playbackId, waveformBase64: wave.toString("base64"), aiGeneratedVoice: true };
    } catch (error) {
      if (error instanceof OpenAiAudioError && error.code === "cleanup_unconfirmed") {
        this.#cleanupUnconfirmed = true;
        for (const grant of this.#grants.values()) clearTimeout(grant.timer);
        this.#grants.clear();
        this.#close(lease);
      }
      throw error;
    } finally {
      lease.running = false;
      if (lease.controller.signal.aborted && this.#lease === lease) this.#lease = undefined;
    }
  }

  #grant(request: Extract<ByokVoiceRequest, { operation: "grant" }>, evidence: AnalyticsEvidence) {
    const { credentialSource, direction } = request.selection;
    const purpose = direction === "tts" ? request.selection.purpose : undefined;
    if (purpose === "current_run_readback" && credentialSource !== "active_direct_openai") throw new ByokVoiceError("consent_required");
    if (this.#grants.size >= 12) throw new ByokVoiceError("voice_busy");
    if (direction === "tts_compatibility") assertOpenAiSpeechCompatibility();
    let credential: VoiceCredential;
    if (credentialSource === "host_voice_key") {
      if (!request.runId || !evidence.separateVoiceCredentialPresent) throw new OpenAiAudioError("credential_unavailable");
      credential = { kind: "host_voice_key" };
    } else if (credentialSource === "active_direct_openai") {
      if (!request.runId || !evidence.directOpenAiCredentialPresent) throw new OpenAiAudioError("credential_unavailable");
      credential = { kind: "active_direct_openai" };
    } else {
      const { credentialRef } = request.selection;
      const key = !credentialRef || credentialRef === request.analyticsBindingId ? undefined : this.host.resolveOpenAiKey(credentialRef);
      if (!key || !credentialRef || !this.host.consumeReference(credentialRef)) throw new OpenAiAudioError("credential_unavailable");
      credential = { kind: "registered", key };
    }
    const grantId = randomUUID();
    const timer = setTimeout(() => this.#grants.delete(grantId), grantLifetimeMs);
    timer.unref?.();
    this.#grants.set(grantId, { direction, purpose, identity: evidence.identity, connection: copyConnection(request), credential,
      expiresAt: Date.now() + grantLifetimeMs, timer });
    return { state: "granted" as const, grantId, direction, ...(purpose ? { purpose } : {}) };
  }

  #getGrant(grantId: string, direction: VoiceGrant["direction"], connection: VoiceConnection, identity: string) {
    const grant = this.#grants.get(grantId);
    if (!grant || grant.expiresAt <= Date.now() || grant.direction !== direction || grant.identity !== identity
      || !sameConnection(grant.connection, connection)) throw new ByokVoiceError("consent_required");
    return grant;
  }

  #open(request: Extract<ByokVoiceRequest, { operation: "open" }>, evidence: AnalyticsEvidence) {
    const { identity, eventSequence, directOpenAiCredentialPresent } = evidence;
    const { stt, tts, recognitionLanguage, synthesisLanguage } = request.selection;
    const recognition = typeof stt === "object" ? this.#getGrant(stt.grantId, "stt", request, identity).credential : undefined;
    const synthesis = typeof tts === "object" ? this.#admitSynthesis(tts, request, identity) : undefined;
    if (!recognition && !synthesis) throw new ByokVoiceError("consent_required");
    if (synthesis?.purpose && stt !== "off") throw new ByokVoiceError("consent_required");
    if (!directOpenAiCredentialPresent && (recognition?.kind === "active_direct_openai" || synthesis?.credential.kind === "active_direct_openai")) {
      throw new OpenAiAudioError("credential_unavailable");
    }
    for (const component of [stt, tts]) if (typeof component === "object") {
      clearTimeout(this.#grants.get(component.grantId)?.timer);
      this.#grants.delete(component.grantId);
    }
    const timer = setTimeout(() => this.#close(lease), leaseLifetimeMs);
    timer.unref?.();
    const lease: VoiceLease = { id: randomUUID(), connection: copyConnection(request), identity, eventSequence, expiresAt: Date.now() + leaseLifetimeMs,
      selection: { recognitionLanguage, synthesisLanguage }, ...(recognition ? { stt: recognition } : {}), ...(synthesis ? { tts: synthesis } : {}),
      controller: new AbortController(), timer, operations: new Set(), notifications: new Set(), running: false };
    this.#lease = lease;
    return { state: "open" as const, sessionId: lease.id, expiresAt: lease.expiresAt, scope: lease.connection.scope,
      stt: typeof stt === "string" ? stt : { provider: "openai", model: OPENAI_TRANSCRIPTION_MODEL, boundary: "provider_service", billing: "api" },
      tts: synthesis ? { provider: "openai", transport: synthesis.transport, boundary: "provider_service", billing: "api", aiGeneratedVoice: true,
        ...(synthesis.purpose ? { purpose: synthesis.purpose } : {}),
        ...(synthesis.transport === "realtime_synthesis" ? { model: OPENAI_REALTIME_SPEECH_MODEL }
          : { model: OPENAI_SPEECH_MODEL, compatibilityShutdown: OPENAI_SPEECH_SHUTDOWN }) } : tts };
  }

  #admitSynthesis(tts: z.infer<typeof cloudTtsGrant>, request: VoiceConnection, identity: string): NonNullable<VoiceLease["tts"]> {
    const transport = tts.transport ?? "realtime_synthesis";
    if (transport === "http_compatibility") assertOpenAiSpeechCompatibility();
    const grant = this.#getGrant(tts.grantId, transport === "http_compatibility" ? "tts_compatibility" : "tts", request, identity);
    return { transport, credential: grant.credential, purpose: grant.purpose };
  }

  #reservePaidReadback(lease: VoiceLease, key: string) {
    let entry = this.#paidReadbacks.get(lease.identity);
    if (!entry) {
      // Keep active identities intact. Released Supervisor identities cannot authorize another paid operation.
      if (this.#paidReadbacks.size >= 256) {
        for (const [identity, receipt] of this.#paidReadbacks) {
          if (!this.host.isActiveReadbackIdentity(receipt.runId, identity)) this.#paidReadbacks.delete(identity);
        }
        if (this.#paidReadbacks.size >= 256) throw new ByokVoiceError("voice_busy");
      }
      entry = { runId: lease.connection.runId!, keys: new Set<string>() };
      this.#paidReadbacks.set(lease.identity, entry);
    }
    if (entry.keys.has(key)) throw new ByokVoiceError("readback_already_requested");
    if (entry.keys.size >= 512) throw new ByokVoiceError("voice_busy");
    // Reserve before provider dispatch so an interrupted request never triggers an automatic second charge.
    entry.keys.add(key);
  }

  #useCredential<Result>(lease: VoiceLease, credential: VoiceCredential, invoke: (key: string) => Result): Result {
    if (credential.kind === "registered") return invoke(credential.key);
    const result = credential.kind === "host_voice_key"
      ? this.host.withSeparateOpenAiVoiceKey(lease.connection, lease.identity, invoke)
      : this.host.withCurrentOpenAiKey(lease.connection, lease.identity, invoke);
    if (result === undefined) throw new OpenAiAudioError("credential_unavailable");
    return result;
  }

  #endPlayback(lease: VoiceLease) {
    if (lease.playback) clearTimeout(lease.playback.timer);
    delete lease.playback;
  }

  #close(lease: VoiceLease) {
    clearTimeout(lease.timer);
    this.#endPlayback(lease);
    delete lease.stt;
    delete lease.tts;
    lease.controller.abort();
    if (!lease.running && this.#lease === lease) this.#lease = undefined;
  }
}
