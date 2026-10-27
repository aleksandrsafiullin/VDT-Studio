"use client";
import { useEffect } from "react";
import { hasLocalAiUi } from "@/lib/app-mode";
import { connectProviderConnection } from "@/lib/provider-connection";
import { useProviderConnectionCheck } from "@/lib/provider-connection-state";
import { requestProviderModelCapabilities } from "@/lib/provider-agent-binding";
import { useVdtStudioStore } from "./vdt-store";

export function ProviderConnection() {
  useEffect(() => {
    if (!hasLocalAiUi()) return;
    let connection: ReturnType<typeof connectProviderConnection> | undefined;
    function start() {
      connection?.dispose();
      connection = connectProviderConnection({
        getSettings: () => useVdtStudioStore.getState().executionSettings,
        subscribe: (listener) => useVdtStudioStore.subscribe(listener),
        probe: requestProviderModelCapabilities,
        publish: (check) => useProviderConnectionCheck.setState(check, true),
        isVisible: () => document.visibilityState !== "hidden"
      });
    }
    const stopHydration = useVdtStudioStore.persist.onFinishHydration(start);
    if (useVdtStudioStore.persist.hasHydrated()) start();
    const refresh = () => connection?.refresh();
    const visible = () => connection?.visibilityChanged();
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopHydration(); connection?.dispose();
      window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return null;
}
