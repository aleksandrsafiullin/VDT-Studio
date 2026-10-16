"use client";

import { useEffect, useState } from "react";
import { createAgentClient, type AgentExecutionBindingSelection } from "@/lib/agent-client";
import { resolveExecutionBindingId } from "@/lib/agent-start-resolver";
import {
  resolveSelectedCliReadiness,
  type CliReadinessDetection,
  type CliRequestReadiness
} from "@/lib/cli-readiness";
import type { ExecutionSettings } from "@/lib/execution-mode-catalog";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";

export function describeCliChatReadiness(
  readiness: CliRequestReadiness | undefined,
  bindingAvailable: boolean | undefined,
  failed = false
): CliRequestReadiness | undefined {
  if (!readiness?.canExecute) return readiness;
  if (bindingAvailable) return { ...readiness, label: "Chat ready", message: "The CLI is signed in and the selected model is connected to chat." };
  if (bindingAvailable === undefined && !failed) {
    return { ...readiness, state: "checking", canExecute: false, label: "Connecting…", message: "Checking chat availability for the selected model." };
  }
  return {
    ...readiness,
    state: "warning",
    canExecute: false,
    label: "Chat unavailable",
    message: failed
      ? "Chat availability could not be checked. Rescan in Settings and try again."
      : "Chat is unavailable for the selected model on this server. Restart the local app or choose another model in Settings, then try again."
  };
}

export function useCliChatReadiness(
  settings: ExecutionSettings,
  detections: readonly CliReadinessDetection[] | undefined,
  options: { isScanning?: boolean | undefined; detectionError?: string | undefined }
): CliRequestReadiness | undefined {
  const readiness = resolveSelectedCliReadiness(settings, detections, options);
  const execution = resolveExecutionSettings(settings);
  const backendId = execution.providerConfig?.backendId;
  const modelId = execution.providerConfig?.model;
  const key = JSON.stringify([backendId, modelId]);
  const enabled = readiness?.canExecute === true;
  const [check, setCheck] = useState<{
    key: string;
    bindings?: AgentExecutionBindingSelection;
    failed?: boolean;
  }>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setCheck({ key });
    void createAgentClient().getExecutionBindings().then(
      (bindings) => { if (!cancelled) setCheck({ key, bindings }); },
      () => { if (!cancelled) setCheck({ key, failed: true }); }
    );
    return () => { cancelled = true; };
  }, [enabled, key]);

  const current = check?.key === key ? check : undefined;
  const available = current?.bindings
    ? resolveExecutionBindingId(current.bindings, settings, execution.providerId, execution.providerConfig) !== null
    : undefined;
  return describeCliChatReadiness(readiness, available, current?.failed);
}
