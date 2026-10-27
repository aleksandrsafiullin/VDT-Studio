"use client";

import { useEffect } from "react";
import { createAgentClient } from "@/lib/agent-client";
import { hasLocalAiUi } from "@/lib/app-mode";
import { connectCliConnection } from "@/lib/cli-connection";
import { useCliConnectionCheck } from "@/lib/cli-connection-state";
import { useVdtStudioStore } from "./vdt-store";

export function CliConnection() {
  useEffect(() => {
    if (!hasLocalAiUi()) return;
    let connection: ReturnType<typeof connectCliConnection> | undefined;
    function start() {
      connection?.dispose();
      connection = connectCliConnection({
        getSnapshot: () => {
          const state = useVdtStudioStore.getState();
          return {
            settings: state.executionSettings,
            detections: state.cliDetectionAgents,
            detectionError: state.cliDetectionError,
            scanning: state.isRescanningClis,
            testing: Boolean(state.executionSettings.selectedCliAgentId && state.isTestingCliByAgent[state.executionSettings.selectedCliAgentId]),
            removedAgentIds: state.removedCliAgentIds,
            vdtId: state.workspace.activeVdtId
          };
        },
        subscribe: (listener) => useVdtStudioStore.subscribe(listener),
        rescan: (agentId) => useVdtStudioStore.getState().rescanClis(agentId),
        getBindings: () => createAgentClient().getExecutionBindings(),
        publish: (check) => useCliConnectionCheck.setState({
          ...check, catalog: check.bindings ?? useCliConnectionCheck.getState().catalog
        }, true),
        isVisible: () => document.visibilityState !== "hidden"
      });
    }
    // The saved category, provider and model must hydrate before discovery.
    const stopHydration = useVdtStudioStore.persist.onFinishHydration(start);
    if (useVdtStudioStore.persist.hasHydrated()) start();
    const refresh = () => connection?.refresh();
    const visibilityChanged = () => connection?.visibilityChanged();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stopHydration();
      connection?.dispose();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, []);
  return null;
}
