"use client";

import { useEffect, useMemo, useState } from "react";
import { buildChatStarterInput, chatStarterTimeoutMs, validateChatStarterOutput, type ChatStarterOutput } from "@vdt-studio/vdt-core";
import { appleIsExpected, type AppleFirstLaunchStatus } from "@/lib/apple-first-launch";
import { createAiExecutionClient } from "@/lib/ai-execution-client";
import { hasByokFieldErrors, validateByokSettings } from "@/lib/byok-validation";
import { resolveSelectedCliReadiness } from "@/lib/cli-readiness";
import { hasLocalAiUi, resolveVdtAppMode, type VdtAppMode } from "@/lib/app-mode";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { selectedCliScanStatus, useVdtStudioStore } from "./vdt-store";

export function resolveSpeculativeChatStarterRequest(
  settings: ExecutionSettings, mode: VdtAppMode, pairingToken: string | undefined,
  appleSelected: boolean, appleLaunch?: AppleFirstLaunchStatus
) {
  // Apple has one native owner for metadata and generation. Keep it available
  // for foreground work and never substitute a saved provider in the preview.
  if (appleSelected || appleIsExpected(settings.analyticalSourceChoice, appleLaunch)) return undefined;
  const { providerId, providerConfig } = resolveExecutionSettings(settings);
  if (providerId === "mock" || (providerId === "local_runner" && !hasLocalAiUi(mode))) return undefined;
  if (settings.executionMode === "byok" && hasByokFieldErrors(validateByokSettings(settings))) return undefined;
  return { mode, providerId, providerConfig, pairingToken };
}

export function useChatStarters(vdtId: string | undefined, enabled: boolean) {
  const settings = useVdtStudioStore((state) => state.executionSettings);
  const appleLaunch = useVdtStudioStore(state => state.appleFirstLaunch);
  const apple = useVdtStudioStore(state => state.appleNativePreview?.settings === state.executionSettings
    ? state.appleNativePreview.binding : undefined);
  const pairingToken = useVdtStudioStore((state) => state.runnerPairingToken);
  const detections = useVdtStudioStore((state) => state.cliDetectionAgents);
  const isScanning = useVdtStudioStore((state) => selectedCliScanStatus(state).isScanning);
  const detectionError = useVdtStudioStore((state) => selectedCliScanStatus(state).detectionError);
  const cli = resolveSelectedCliReadiness(settings, detections, { isScanning, detectionError });
  const cliReady = cli?.canExecute ?? true;
  const request = useMemo(() => enabled && vdtId
    ? resolveSpeculativeChatStarterRequest(settings, resolveVdtAppMode(), pairingToken, Boolean(apple), appleLaunch)
    : undefined, [enabled, vdtId, settings, pairingToken, apple, appleLaunch]);
  const [result, setResult] = useState<{
    request: NonNullable<typeof request>;
    prompts?: ChatStarterOutput["prompts"];
  }>();
  const settled = request !== undefined && result?.request === request;

  useEffect(() => {
    // The short completion uses the authenticated CLI directly. The separate
    // session binding is required when a user sends a full chat message.
    if (!request || !cliReady || settled) return;
    const controller = new AbortController();
    const { signal } = controller;
    const { mode, providerId, providerConfig, pairingToken } = request;
    const generate = async () => {
      // Keep the selected model and let the starter task choose its own reasoning behavior.
      const timeoutMs = chatStarterTimeoutMs(providerConfig?.backendId);
      const config: Record<string, unknown> = { ...providerConfig, timeoutMs };
      delete config.modelReasoning;
      const project = useVdtStudioStore.getState().project;
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 2_500)]);
      try {
        const input = buildChatStarterInput(project, document.documentElement.lang || "en");
        const response = await createAiExecutionClient(mode).complete({
          taskType: "suggest_chat_starters",
          input,
          providerId,
          providerConfig: { ...config, ...(pairingToken ? { pairingToken } : {}) }
        }, requestSignal);
        requestSignal.throwIfAborted();
        if (response.kind !== "chat_starters") throw new Error("Unexpected chat starter response.");
        const { prompts } = validateChatStarterOutput({ prompts: response.prompts });
        setResult({ request, prompts });
      } catch {
        // Keep the panel blank, but let Smart KPI use the connection again.
        if (!signal.aborted) setResult({ request });
      }
    };
    // If the effect is replaced immediately, avoid launching an obsolete model call.
    queueMicrotask(() => { if (!signal.aborted) void generate(); });
    return () => controller.abort();
  }, [request, cliReady, settled]);

  return {
    prompts: settled ? result?.prompts : undefined,
    pending: Boolean(request && !settled && (cliReady || (cli?.state === "checking" && !detectionError)))
  };
}
