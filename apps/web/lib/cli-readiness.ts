import {
  getCliCatalogEntry,
  getLocalRunnerPreset,
  type CliAgentId,
  type ExecutionSettings
} from "./execution-mode-catalog";

export type CliReadinessBackendStatus =
  | "not_installed"
  | "installed"
  | "authentication_required"
  | "ready"
  | "rate_limited"
  | "unsupported_version"
  | "unsafe_configuration"
  | "unavailable"
  | "error";

export interface CliReadinessDetection {
  id: CliAgentId;
  installed: boolean;
  status?: CliReadinessBackendStatus | undefined;
}

export type CliRequestReadinessState = "checking" | "ready" | "warning" | "not_installed";

export interface CliRequestReadiness {
  agentId?: CliAgentId | undefined;
  state: CliRequestReadinessState;
  canExecute: boolean;
  label: string;
  message: string;
}

function subscriptionCliAgentId(settings: ExecutionSettings): CliAgentId | null | undefined {
  if (settings.executionMode !== "local_cli") return undefined;

  const preset = getLocalRunnerPreset(settings.localRunnerPresetId ?? "ollama_openai");
  let runnerProviderId = settings.runnerProviderId ?? preset.runnerProviderId;
  if (runnerProviderId === "cli_stub" && preset.runnerProviderId === "local_http_stub") {
    runnerProviderId = "local_http_stub";
  }

  if (runnerProviderId !== "cli_stub") return undefined;
  return settings.selectedCliAgentId ?? null;
}

export function describeCliDetection(
  agentId: CliAgentId,
  detection: CliReadinessDetection | undefined
): CliRequestReadiness {
  const agentName = getCliCatalogEntry(agentId).displayName;

  if (!detection) {
    return {
      agentId,
      state: "warning",
      canExecute: false,
      label: "Status unavailable",
      message: `${agentName} readiness could not be verified. Rescan before sending a request.`
    };
  }

  if (detection.status === "ready" && detection.installed) {
    return {
      agentId,
      state: "ready",
      canExecute: true,
      label: "Ready",
      message: `${agentName} is installed, authenticated, and ready to run requests.`
    };
  }

  if (detection.status === "not_installed" || (!detection.installed && detection.status === undefined)) {
    return {
      agentId,
      state: "not_installed",
      canExecute: false,
      label: "Not installed",
      message: `${agentName} is not installed. Install it from Execution mode settings, then rescan.`
    };
  }

  const warning = (label: string, message: string): CliRequestReadiness => ({
    agentId,
    state: "warning",
    canExecute: false,
    label,
    message
  });

  switch (detection.status) {
    case "authentication_required":
      return warning("Sign in required", `${agentName} is installed, but provider sign-in is required before it can run requests.`);
    case "rate_limited":
      return warning("Rate limited", `${agentName} is currently rate limited and cannot run this request yet.`);
    case "unsupported_version":
      return warning("Update required", `${agentName} is installed, but its CLI version is not supported.`);
    case "unsafe_configuration":
      return warning("Configuration blocked", `${agentName} cannot run because its current configuration is unsafe.`);
    case "unavailable":
      return warning("Unavailable", `${agentName} is currently unavailable. Rescan or choose another provider.`);
    case "error":
      return warning("Check failed", `${agentName} is installed, but its readiness check failed.`);
    case "installed":
    case undefined:
      return warning("Verification required", `${agentName} is installed, but readiness has not been confirmed.`);
    case "ready":
      return warning("Status unavailable", `${agentName} returned an inconsistent readiness status. Rescan before sending a request.`);
  }
}

export function resolveSelectedCliReadiness(
  settings: ExecutionSettings,
  detections: readonly CliReadinessDetection[] | undefined,
  options: { isScanning?: boolean | undefined; detectionError?: string | undefined } = {}
): CliRequestReadiness | undefined {
  const agentId = subscriptionCliAgentId(settings);
  if (agentId === undefined) return undefined;

  if (agentId === null) {
    return {
      state: "warning",
      canExecute: false,
      label: "Select an agent",
      message: "Select a subscription CLI agent before sending a request."
    };
  }

  const agentName = getCliCatalogEntry(agentId).displayName;
  if (options.isScanning || detections === undefined) {
    return {
      agentId,
      state: "checking",
      canExecute: false,
      label: "Checking…",
      message: `Checking whether ${agentName} can run requests.`
    };
  }

  if (options.detectionError) {
    return {
      agentId,
      state: "warning",
      canExecute: false,
      label: "Status unavailable",
      message: `${agentName} readiness could not be verified: ${options.detectionError}`
    };
  }

  return describeCliDetection(agentId, detections.find((detection) => detection.id === agentId));
}

export function isConfirmedNotInstalled(detection: CliReadinessDetection | undefined): boolean {
  return Boolean(
    detection &&
      (detection.status === "not_installed" || (!detection.installed && detection.status === undefined))
  );
}
