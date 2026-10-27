"use client";

import { cliConnectionKey } from "@/lib/cli-connection";
import { useCliConnectionCheck } from "@/lib/cli-connection-state";
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
      ? "Chat availability could not be checked. Reconnecting automatically."
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
  const key = cliConnectionKey(settings);
  const check = useCliConnectionCheck();
  const current = check?.key === key ? check : undefined;
  const available = current?.bindings
    ? resolveExecutionBindingId(current.bindings, settings, execution.providerId, execution.providerConfig) !== null
    : undefined;
  return describeCliChatReadiness(readiness, available, current?.failed);
}
