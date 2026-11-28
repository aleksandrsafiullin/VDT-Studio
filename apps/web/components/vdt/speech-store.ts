"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { isSpeechLanguage, isSpeechModelId, type AppleSpeechLanguage, type AppleVoicePreviewSelection, type AppleVoiceStatus, type SpeechLanguage, type SpeechModelId, type SpeechStatus } from "@vdt-studio/local-runner/speech-catalog";
import { resolveVdtAppMode } from "@/lib/app-mode";
import { speechRequest } from "@/lib/speech-client";

const STORAGE_KEY = "vdt-studio-voice-input-v1";
type AppleVoicePreference = Omit<AppleVoicePreviewSelection, "locale">;
type AppleVoicePreferences = Partial<Record<AppleSpeechLanguage, AppleVoicePreference>>;

function boundedPercent(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function normalizeVoicePreference(value?: Partial<AppleVoicePreference>): AppleVoicePreference {
  return {
    voiceId: typeof value?.voiceId === "string" && value.voiceId.length <= 200 ? value.voiceId : "",
    ratePercent: boundedPercent(value?.ratePercent, 75, 125, 100),
    volumePercent: boundedPercent(value?.volumePercent, 0, 100, 70)
  };
}

function restoreVoicePreferences(input: unknown): AppleVoicePreferences {
  const preferences: AppleVoicePreferences = {};
  if (!input || typeof input !== "object") return preferences;
  for (const [locale, value] of Object.entries(input)) {
    if (isSpeechLanguage(locale) && locale !== "auto" && value && typeof value === "object") {
      preferences[locale] = normalizeVoicePreference(value);
    }
  }
  return preferences;
}

export function installedAppleVoices(status: AppleVoiceStatus | undefined, locale: AppleSpeechLanguage) {
  if (!status?.supported) return [];
  return status.voices.filter(voice => voice.locale.toLowerCase().split(/[-_]/)[0] === locale)
    .sort((left, right) => right.quality - left.quality
      || Number(right.systemDefault === true) - Number(left.systemDefault === true)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

export function selectedAppleVoice(settings: Pick<SpeechStore, "ttsLocale" | "appleStatus" | "appleVoicePreferences">, requirePinned = false): AppleVoicePreviewSelection | undefined {
  const { ttsLocale: locale, appleStatus, appleVoicePreferences } = settings;
  const preference = normalizeVoicePreference(appleVoicePreferences[locale]);
  if (requirePinned && !preference.voiceId) return undefined;
  const voices = installedAppleVoices(appleStatus, locale);
  const voice = preference.voiceId ? voices.find(entry => entry.id === preference.voiceId) : voices[0];
  return voice ? { ...preference, locale, voiceId: voice.id } : undefined;
}

interface SpeechStore {
  modelId: SpeechModelId;
  language: SpeechLanguage;
  stt: "off" | "whisper_local" | "apple_local";
  tts: "off" | "apple_local";
  ttsLocale: AppleSpeechLanguage;
  appleVoicePreferences: AppleVoicePreferences;
  autoSpeak: boolean;
  spokenMuted: boolean;
  realtime: "off";
  status: SpeechStatus | undefined;
  appleStatus: AppleVoiceStatus | undefined;
  error: string | undefined;
  setModel: (modelId: SpeechModelId) => void;
  setLanguage: (language: SpeechLanguage) => void;
  setEnabled: (enabled: boolean) => void;
  setStt: (stt: SpeechStore["stt"]) => void;
  setTts: (tts: SpeechStore["tts"]) => void;
  setSpokenMuted: (muted: boolean) => void;
  setAutoSpeak: (enabled: boolean) => void;
  setAppleVoicePreference: (locale: AppleSpeechLanguage, update: Partial<AppleVoicePreference>) => void;
  setTtsLocale: (locale: AppleSpeechLanguage) => void;
  refreshApple: () => Promise<void>;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  cancelInstall: () => Promise<void>;
}

let statusRequest: Promise<void> | undefined;
let appleStatusRequest: Promise<void> | undefined;
let hydrated = false;
function savePreferences() {
  const { modelId, language, stt, tts, ttsLocale, appleVoicePreferences, autoSpeak, realtime } = useSpeechStore.getState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ modelId, language, stt, tts, ttsLocale, appleVoicePreferences, autoSpeak, realtime })); } catch { /* Session preferences still work. */ }
}

export const useSpeechStore = create<SpeechStore>((set, get) => ({
  modelId: "base", language: "ru", stt: "off", tts: "off", ttsLocale: "en", appleVoicePreferences: {}, autoSpeak: false, spokenMuted: false, realtime: "off", status: undefined, appleStatus: undefined, error: undefined,
  setModel: (modelId) => { set({ modelId }); savePreferences(); },
  setLanguage: (language) => { set({ language }); savePreferences(); },
  setEnabled: (enabled) => { set({ stt: enabled ? "whisper_local" : "off" }); savePreferences(); },
  setStt: (stt) => { set({ stt }); savePreferences(); },
  setTts: (tts) => { set(tts === "off" ? { tts, autoSpeak: false } : { tts }); savePreferences(); },
  setSpokenMuted: (spokenMuted) => set({ spokenMuted }),
  setAutoSpeak: (enabled) => {
    const state = get();
    const voice = enabled && state.tts === "apple_local" ? selectedAppleVoice(state) : undefined;
    if (voice) {
      const { locale, ...preference } = voice;
      set({ autoSpeak: true, appleVoicePreferences: { ...state.appleVoicePreferences, [locale]: preference } });
    } else set({ autoSpeak: false });
    savePreferences();
  },
  setAppleVoicePreference: (locale, update) => {
    const { appleVoicePreferences } = get();
    set({ appleVoicePreferences: { ...appleVoicePreferences,
      [locale]: normalizeVoicePreference({ ...appleVoicePreferences[locale], ...update }) } });
    savePreferences();
  },
  setTtsLocale: (ttsLocale) => {
    const state = get();
    const voice = state.autoSpeak ? selectedAppleVoice({ ...state, ttsLocale }) : undefined;
    if (voice) {
      const { locale, ...preference } = voice;
      set({ ttsLocale, appleVoicePreferences: { ...state.appleVoicePreferences, [locale]: preference } });
    } else set({ ttsLocale });
    savePreferences();
  },
  refreshApple: () => {
    if (resolveVdtAppMode() !== "desktop") return Promise.resolve();
    appleStatusRequest ??= speechRequest<AppleVoiceStatus>({ operation: "apple_status" })
      .then(appleStatus => set({ appleStatus }))
      .catch(() => set({ appleStatus: undefined }))
      .finally(() => { appleStatusRequest = undefined; });
    return appleStatusRequest;
  },
  refresh: () => {
    if (statusRequest) return statusRequest;
    if (resolveVdtAppMode() === "hosted_web") {
      set({ error: "Local voice input is available in VDT Studio Desktop or on localhost." });
      return Promise.resolve();
    }
    statusRequest = speechRequest<SpeechStatus>({ operation: "status" })
      .then((status) => { set({ status, error: undefined }); })
      .catch((error: unknown) => { set({ error: error instanceof Error ? error.message : "Voice input is unavailable." }); })
      .finally(() => { statusRequest = undefined; });
    return statusRequest;
  },
  install: async () => {
    try {
      const status = await speechRequest<SpeechStatus>({ operation: "install", modelId: get().modelId, confirmed: true });
      set({ status, error: undefined, stt: "whisper_local" });
      savePreferences();
    } catch (error) { set({ error: error instanceof Error ? error.message : "The download could not be started." }); }
  },
  cancelInstall: async () => {
    try { set({ status: await speechRequest<SpeechStatus>({ operation: "cancel_install" }) }); }
    catch (error) { set({ error: error instanceof Error ? error.message : "The download could not be cancelled." }); }
  }
}));

export function useSpeechSettings() {
  const store = useSpeechStore();
  const phase = store.status?.installation.state;
  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (saved && typeof saved === "object") {
          const value = saved as Record<string, unknown>;
          useSpeechStore.setState({
            modelId: isSpeechModelId(value.modelId) ? value.modelId : "base",
            language: isSpeechLanguage(value.language) ? value.language : "ru",
            tts: value.tts === "apple_local" ? "apple_local" : "off",
            appleVoicePreferences: restoreVoicePreferences(value.appleVoicePreferences),
            autoSpeak: value.tts === "apple_local" && value.autoSpeak === true,
            ttsLocale: isSpeechLanguage(value.ttsLocale) && value.ttsLocale !== "auto" ? value.ttsLocale : "en",
            stt: value.stt === "apple_local" ? "apple_local"
              : value.stt === "whisper_local" || (value.stt === undefined && value.enabled === true) ? "whisper_local" : "off"
          });
        }
      } catch { /* Invalid old preferences use the defaults. */ }
    }
    const refresh = () => {
      void useSpeechStore.getState().refresh();
      void useSpeechStore.getState().refreshApple();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (phase !== "downloading" && phase !== "verifying") return;
    const timer = setInterval(() => { void useSpeechStore.getState().refresh(); }, 700);
    return () => clearInterval(timer);
  }, [phase]);
  const appleReadiness = store.appleStatus?.recognition.find(entry => entry.locale === store.language);
  const whisperReady = Boolean(store.status?.engineReady && store.status.installedModels.includes(store.modelId)
    && !(store.status.installation.modelId === store.modelId && store.status.installation.state === "error"));
  return {
    ...store,
    appleReadiness,
    whisperReady,
    enabled: store.stt !== "off",
    ready: store.stt === "apple_local" ? appleReadiness?.status === "installed" : store.stt === "whisper_local" && whisperReady,
    installing: phase === "downloading" || phase === "verifying"
  };
}
