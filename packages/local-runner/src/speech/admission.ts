import {
  isSpeechLanguage, isSpeechModelId,
  type AppleVoicePreviewSelection, type SpeechAnalyticsMode, type SpeechComponent, type SpeechProvider, type SpeechSelection, type SpeechSessionAdmission
} from "./catalog";

export class SpeechError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

const analyticsModes: readonly SpeechAnalyticsMode[] = ["local", "cli_subscription", "api_keys", "legacy"];
const providers: readonly SpeechProvider[] = ["whisper_local", "apple_local", "subscription", "api"];

function closedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SpeechError("Invalid voice route selection.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || fields.some(field => !Object.hasOwn(record, field))) {
    throw new SpeechError("Voice route selection contains an unsupported or missing field.");
  }
  return record;
}

function boundedText(value: unknown, max = 240): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

function readComponent(value: unknown): SpeechSelection[SpeechComponent] {
  if (value === null) return null;
  const record = closedRecord(value, ["providerId", "modelId"]);
  if (!providers.includes(record.providerId as SpeechProvider) || !boundedText(record.modelId)) throw new SpeechError("Invalid voice component.");
  return { providerId: record.providerId as SpeechProvider, modelId: record.modelId };
}

export function parseSpeechSelection(input: unknown): SpeechSelection {
  const record = closedRecord(input, ["version", "analytics", "scopeId", "language", "stt", "tts", "realtime"]);
  const analytics = closedRecord(record.analytics, ["mode", "providerId", "modelId"]);
  if (record.version !== 1 || !boundedText(record.scopeId, 400) || !isSpeechLanguage(record.language)
    || !analyticsModes.includes(analytics.mode as SpeechAnalyticsMode) || !boundedText(analytics.providerId)
    || (analytics.modelId !== null && !boundedText(analytics.modelId))) throw new SpeechError("Invalid voice route identity or language.");
  return {
    version: 1, language: record.language, scopeId: record.scopeId,
    analytics: { mode: analytics.mode as SpeechAnalyticsMode, providerId: analytics.providerId, modelId: analytics.modelId },
    stt: readComponent(record.stt), tts: readComponent(record.tts), realtime: readComponent(record.realtime)
  };
}

/** Eligibility before checking installed host adapters. A browser selection alone cannot supply these grants. */
export function speechRouteEligible(
  mode: SpeechAnalyticsMode,
  route: { component: SpeechComponent; boundary: "on_device" | "provider_service"; billing: "none" | "subscription" | "api" },
  grants: { explicitComponentConsent: boolean; verifiedSubscription?: boolean; explicitApiBilling?: boolean }
): boolean {
  if (!grants.explicitComponentConsent) return false;
  if (route.boundary === "on_device") return route.billing === "none" && route.component !== "realtime";
  if (mode === "cli_subscription" && route.billing === "subscription") return grants.verifiedSubscription === true;
  return (mode === "api_keys" || mode === "cli_subscription") && route.billing === "api" && grants.explicitApiBilling === true;
}

export function parseAppleVoicePreview(input: unknown): AppleVoicePreviewSelection {
  const preview = closedRecord(input, ["locale", "voiceId", "ratePercent", "volumePercent"]);
  if (!isSpeechLanguage(preview.locale) || preview.locale === "auto" || !boundedText(preview.voiceId, 200)
    || typeof preview.ratePercent !== "number" || !Number.isInteger(preview.ratePercent) || preview.ratePercent < 75 || preview.ratePercent > 125
    || typeof preview.volumePercent !== "number" || !Number.isInteger(preview.volumePercent) || preview.volumePercent < 0 || preview.volumePercent > 100) {
    throw new SpeechError("Choose an installed system voice and a valid preview rate and volume.");
  }
  return { locale: preview.locale, voiceId: preview.voiceId, ratePercent: preview.ratePercent, volumePercent: preview.volumePercent };
}

export function admitDictationSelection(selection: SpeechSelection, hasAppleVoice = false): Omit<SpeechSessionAdmission, "sessionId"> {
  if (selection.realtime && (selection.stt || selection.tts)) throw new SpeechError("Choose unified voice or separate voice components.", 409);
  const component = selection.stt;
  let identity: Pick<SpeechSessionAdmission["stt"], "providerId" | "modelId">;
  // Only a host-supplied Apple adapter can expose native speech. The analytics
  // label scopes the session and supplies no provider entitlement.
  if (component?.providerId === "whisper_local" && isSpeechModelId(component.modelId)) {
    identity = { providerId: "whisper_local", modelId: component.modelId };
  } else if (hasAppleVoice && component?.providerId === "apple_local" && component.modelId === "system" && selection.language !== "auto") {
    identity = { providerId: "apple_local", modelId: "system" };
  } else throw new SpeechError("The selected speech component is unavailable. Choose an installed local recognizer.", 409);
  if (selection.tts || selection.realtime) throw new SpeechError("The selected spoken response or realtime component is unavailable.", 409);

  const route = {
    boundary: "on_device", billing: "none", credential: { kind: "none" },
    consent: "explicit_component", scope: "bound_voice_session"
  } as const;
  if (!speechRouteEligible(selection.analytics.mode, { ...route, component: "stt" }, { explicitComponentConsent: true })) throw new SpeechError("This voice route cannot be used with the selected analytics mode.", 409);
  const stt = { ...route, ...identity } as SpeechSessionAdmission["stt"];
  return { state: "open", scopeId: selection.scopeId, language: selection.language, analytics: selection.analytics, stt, tts: null, realtime: null };
}
