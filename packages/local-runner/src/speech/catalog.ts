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

export type SpeechRequest =
  | { operation: "status" }
  | { operation: "install"; modelId: SpeechModelId; confirmed: true }
  | { operation: "cancel_install" }
  | { operation: "transcribe"; modelId: SpeechModelId; language: SpeechLanguage; audioBase64: string; jobId: string }
  | { operation: "result" | "cancel"; jobId: string };

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
