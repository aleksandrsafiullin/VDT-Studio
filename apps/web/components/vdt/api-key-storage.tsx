"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { connectApiKeyPersistence, type ApiKeyStorageStatus } from "@/lib/api-key-persistence";
import { IndexedDbApiKeyVault } from "@/lib/api-key-vault";
import { useVdtStudioStore } from "./vdt-store";

export const useApiKeyStorage = create<{
  status: ApiKeyStorageStatus;
  remove: () => void;
  retry: () => void;
}>(() => ({ status: "loading", remove: () => undefined, retry: () => undefined }));

/** Mounted once for the app, including when Settings is closed. */
export function ApiKeyStorage() {
  useEffect(() => {
    const vault = new IndexedDbApiKeyVault();
    let channel: BroadcastChannel | undefined;
    try {
      if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel("vdt-api-key-changes");
    } catch { /* Optional cross-tab notifications may be denied by browser policy. */ }
    let active = true;
    const announce = (scope: string) => {
      try { if (active) channel?.postMessage({ scope }); } catch { /* The vault commit has already succeeded. */ }
    };
    const persistence = connectApiKeyPersistence({
      getSettings: () => useVdtStudioStore.getState().executionSettings,
      setApiKey: (apiKey) => {
        useVdtStudioStore.getState().setExecutionSettingsField("apiKey", apiKey);
      },
      subscribe: (listener) => useVdtStudioStore.subscribe((state, previous) => {
        if (state.executionSettings !== previous.executionSettings) listener(state.executionSettings);
      })
    }, {
      read: (scope) => vault.read(scope),
      write: async (scope, value) => { await vault.write(scope, value); announce(scope); },
      remove: async (scope) => { await vault.remove(scope); announce(scope); }
    }, (status) => useApiKeyStorage.setState({ status }));
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (typeof data === "object" && data !== null && "scope" in data && typeof data.scope === "string") {
        void persistence.refresh(data.scope);
      }
    };
    useApiKeyStorage.setState({
      remove: () => { void persistence.remove(); },
      retry: () => { void persistence.retry(); }
    });
    return () => { active = false; persistence.dispose(); channel?.close(); };
  }, []);
  return null;
}
