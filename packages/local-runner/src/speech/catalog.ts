/** Browser-safe, closed catalog. URLs and executable paths belong to the runtime. */
export const SPEECH_MODELS = [
  { id: "tiny", label: "Tiny", description: "Fastest, lower accuracy", bytes: 77_691_713 },
  { id: "base", label: "Base", description: "Balanced speed and accuracy", bytes: 147_951_465 },
  { id: "small", label: "Small", description: "Higher accuracy, more processing", bytes: 487_601_967 }
] as const;

export type SpeechModelId = (typeof SPEECH_MODELS)[number]["id"];
export const SPEECH_LANGUAGES = [
  { id: "auto", label: "Detect automatically" },
  { id: "ru", label: "Русский" },
  { id: "en", label: "English" },
  { id: "kk", label: "Қазақша" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Français" },
  { id: "es", label: "Español" },
  { id: "zh", label: "中文" }
] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]["id"];

export interface SpeechStatus {
  supported: boolean;
  engineReady: boolean;
  installedModels: SpeechModelId[];
  installation: {
    state: "idle" | "downloading" | "verifying" | "ready" | "error" | "cancelled";
    modelId?: SpeechModelId;
    phase?: "engine" | "model";
    downloadedBytes: number;
    totalBytes: number;
    error?: string;
  };
  message?: string;
}

export type SpeechAnalyticsMode = "local" | "cli_subscription" | "api_keys" | "legacy";
export type SpeechComponent = "stt" | "tts" | "realtime";
export type SpeechProvider = "whisper_local" | "apple_local" | "subscription" | "api";

export interface SpeechAnalyticsSelection {
  mode: SpeechAnalyticsMode;
  providerId: string;
  modelId: string | null;
}

export interface SpeechSelection {
  version: 1;
  analytics: SpeechAnalyticsSelection;
  scopeId: string;
  language: SpeechLanguage;
  stt: { providerId: SpeechProvider; modelId: string } | null;
  tts: { providerId: SpeechProvider; modelId: string } | null;
  realtime: { providerId: SpeechProvider; modelId: string } | null;
}

export type AppleSpeechLanguage = Exclude<SpeechLanguage, "auto">;
export type AppleRecognitionAvailability = "installed" | "asset_required" | "downloading" | "unsupported_locale" | "unsupported_os_or_sdk" | "unavailable";
export interface AppleVoiceStatus {
  state: "apple_voice_status";
  supported: boolean;
  recognition: { locale: AppleSpeechLanguage; systemLocale?: string; status: AppleRecognitionAvailability }[];
  voices: { id: string; label: string; locale: string; quality: number; systemDefault?: boolean }[];
}
export interface AppleAssetOffer {
  state: "apple_asset_offer";
  setupId: string;
  locale: AppleSpeechLanguage;
  systemLocale: string;
}
export interface AppleAssetSetup {
  state: "apple_asset_setup";
  phase: "preparing" | "downloading" | "verifying" | "ready" | "cancelling" | "cancelled" | "error";
  locale: AppleSpeechLanguage;
  fraction?: number;
  error?: string;
}
export interface AppleVoicePreviewSelection {
  locale: AppleSpeechLanguage;
  voiceId: string;
  ratePercent: number;
  volumePercent: number;
}
export interface AppleVoicePreview {
  state: "apple_voice_preview";
  waveformBase64: string;
}

export const SPEECH_TTS_MAX_TEXT = 120;
export const SPEECH_TTS_MAX_WAVE_BASE64 = 613_336;
export interface SpeechSynthesisGrant {
  state: "tts_open";
  sessionId: string;
  eventId: string;
  scopeId: string;
  boundary: "on_device";
  billing: "none";
  consent: "explicit_component";
}
export type SpeechSynthesisResult =
  | { state: "tts_processing" }
  | { state: "tts_complete"; eventId: string; waveformBase64: string }
  | { state: "tts_error"; code?: "waveform_too_large"; eventId?: string };

export interface SpeechSessionAdmission {
  state: "open";
  sessionId: string;
  scopeId: string;
  language: SpeechLanguage;
  analytics: SpeechAnalyticsSelection;
  stt: ({ providerId: "whisper_local"; modelId: SpeechModelId } | { providerId: "apple_local"; modelId: "system" }) & {
    boundary: "on_device";
    billing: "none";
    credential: { kind: "none" };
    consent: "explicit_component";
    scope: "bound_voice_session";
  };
  tts: null;
  realtime: null;
}

export type SpeechRequest =
  | { operation: "status" }
  | { operation: "install"; modelId: SpeechModelId; confirmed: true }
  | { operation: "cancel_install" }
  | { operation: "apple_status" }
  | { operation: "apple_install_offer"; locale: AppleSpeechLanguage }
  | { operation: "apple_install"; locale: AppleSpeechLanguage; setupId: string; confirmed: true }
  | { operation: "apple_install_status"; setupId: string }
  | { operation: "apple_cancel_install"; setupId: string }
  | { operation: "apple_preview"; preview: AppleVoicePreviewSelection }
  | { operation: "open_tts"; selection: SpeechSelection; preview: AppleVoicePreviewSelection; eventId: string; text: string; confirmed: true }
  | { operation: "tts_result"; sessionId: string }
  | { operation: "close_tts"; sessionId: string }
  | { operation: "open_session"; selection: SpeechSelection }
  | { operation: "close_session"; sessionId: string }
  | { operation: "keep_session"; sessionId: string }
  | { operation: "transcribe"; sessionId: string; audioBase64: string; jobId: string }
  | { operation: "result" | "cancel"; sessionId: string; jobId: string };

export type SpeechResponse = SpeechStatus | AppleAssetOffer | AppleAssetSetup | AppleVoiceStatus | AppleVoicePreview | SpeechJobResult | SpeechSessionAdmission | SpeechSynthesisGrant | SpeechSynthesisResult | { state: "active" | "closed" };

export type SpeechJobResult =
  | { state: "processing" }
  | { state: "complete"; text: string }
  | { state: "error"; error: string }
  | { state: "cancelled" };

export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_MAX_SECONDS = 12;
export const SPEECH_MAX_AUDIO_BYTES = 44 + SPEECH_SAMPLE_RATE * SPEECH_MAX_SECONDS * 2;

export function isSpeechModelId(value: unknown): value is SpeechModelId {
  return SPEECH_MODELS.some((model) => model.id === value);
}

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return SPEECH_LANGUAGES.some((language) => language.id === value);
}

export function speechModelSize(bytes: number): string {
  return `${Math.ceil(bytes / 1024 / 1024)} MB`;
}
