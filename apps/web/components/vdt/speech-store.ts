"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { isSpeechLanguage, isSpeechModelId, type SpeechLanguage, type SpeechModelId, type SpeechStatus } from "@vdt-studio/local-runner/speech-catalog";
import { resolveVdtAppMode } from "@/lib/app-mode";
import { speechRequest } from "@/lib/speech-client";

const STORAGE_KEY = "vdt-studio-voice-input-v1";
interface SpeechStore {
  modelId: SpeechModelId;
  language: SpeechLanguage;
  enabled: boolean;
  status: SpeechStatus | undefined;
  error: string | undefined;
  setModel: (modelId: SpeechModelId) => void;
  setLanguage: (language: SpeechLanguage) => void;
  setEnabled: (enabled: boolean) => void;
  refresh: () => Promise<void>;
  install: () => Promise<void>;
  cancelInstall: () => Promise<void>;
}

let statusRequest: Promise<void> | undefined;
let hydrated = false;
function savePreferences() {
  const { modelId, language, enabled } = useSpeechStore.getState();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ modelId, language, enabled })); } catch { /* Session preferences still work. */ }
}

export const useSpeechStore = create<SpeechStore>((set, get) => ({
  modelId: "base", language: "ru", enabled: true, status: undefined, error: undefined,
  setModel: (modelId) => { set({ modelId }); savePreferences(); },
  setLanguage: (language) => { set({ language }); savePreferences(); },
  setEnabled: (enabled) => { set({ enabled }); savePreferences(); },
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
      set({ status, error: undefined, enabled: true });
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
            enabled: value.enabled !== false
          });
        }
      } catch { /* Invalid old preferences use the defaults. */ }
    }
    void useSpeechStore.getState().refresh();
    const refresh = () => { void useSpeechStore.getState().refresh(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (phase !== "downloading" && phase !== "verifying") return;
    const timer = setInterval(() => { void useSpeechStore.getState().refresh(); }, 700);
    return () => clearInterval(timer);
  }, [phase]);
  return {
    ...store,
    ready: Boolean(store.enabled && store.status?.engineReady && store.status.installedModels.includes(store.modelId)
      && !(store.status.installation.modelId === store.modelId && store.status.installation.state === "error")),
    installing: phase === "downloading" || phase === "verifying"
  };
}
