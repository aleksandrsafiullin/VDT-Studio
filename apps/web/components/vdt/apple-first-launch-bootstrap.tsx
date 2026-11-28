"use client";

import { useEffect } from "react";
import { resolveVdtAppMode } from "@/lib/app-mode";
import { useVdtStudioStore } from "./vdt-store";

export function AppleFirstLaunchBootstrap() {
  useEffect(() => {
    if (resolveVdtAppMode() !== "desktop") return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") void useVdtStudioStore.getState().refreshAppleAnalyticalDefault();
    };
    const stopHydration = useVdtStudioStore.persist.onFinishHydration(refresh);
    if (useVdtStudioStore.persist.hasHydrated()) refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("languagechange", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopHydration();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("languagechange", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return null;
}
