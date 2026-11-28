import type { PublicAgentExecutionBindingSummary } from "./agent-client";

export type AnalyticalSourceChoice = "untouched" | "manual" | "apple_default" | "apple_manual";

export interface AppleLaunchAvailability {
  enabled: boolean;
  firstLaunchDefaultEnabled: boolean;
}

export type AppleFirstLaunchStatus =
  | { status: "checking"; firstLaunchDefaultEnabled: boolean; selectManually?: boolean }
  | { status: "ready"; firstLaunchDefaultEnabled: boolean }
  | { status: "unavailable"; firstLaunchDefaultEnabled: boolean; message: string }
  | { status: "inactive"; firstLaunchDefaultEnabled: false };

export function isAppleAnalyticalChoice(choice: AnalyticalSourceChoice | undefined): boolean {
  return choice === "apple_default" || choice === "apple_manual";
}

/** Older records cannot distinguish a deliberate default-looking choice from
 * a generated one. Preserve their recorded connection on upgrade. */
export function restoreAnalyticalSourceChoice(value: unknown, hasPriorConnection: boolean): AnalyticalSourceChoice {
  if (value === "untouched" || value === "manual" || value === "apple_default" || value === "apple_manual") return value;
  return hasPriorConnection ? "manual" : "untouched";
}

export function shouldCheckAppleDefault(choice: AnalyticalSourceChoice | undefined, availability: AppleLaunchAvailability): boolean {
  return availability.enabled && (choice === "apple_manual" || (choice !== "manual" && availability.firstLaunchDefaultEnabled));
}

export function appleIsExpected(choice: AnalyticalSourceChoice | undefined, status?: AppleFirstLaunchStatus): boolean {
  return isAppleAnalyticalChoice(choice) || (choice === "untouched" && status?.firstLaunchDefaultEnabled === true);
}

export function readAppleLaunchBinding(binding: PublicAgentExecutionBindingSummary, locale: string): PublicAgentExecutionBindingSummary {
  const admission = binding.admission;
  if (binding.backendId !== "apple_foundation_models" || binding.executionProfile !== "model_agent"
    || admission?.mode !== "local" || admission.providerId !== binding.backendId
    || admission.modelId !== binding.modelId || admission.profileVersion !== 1
    || binding.appleIdentity?.locale !== locale || !binding.appleIdentity.osBuild) {
    throw new Error("The desktop could not verify the Apple model for the current language. Choose a model or check Apple availability again.");
  }
  return binding;
}

export function appleRecoveryMessage(status?: AppleFirstLaunchStatus): string {
  if (status?.status === "unavailable") return status.message;
  return "Apple on-device analytics is waiting for a verified model connection. Check Apple availability or choose another model.";
}

export function appleUnavailability(availability: AppleLaunchAvailability, choice: AnalyticalSourceChoice): string {
  return availability.enabled && choice === "apple_default" && !availability.firstLaunchDefaultEnabled
    ? "The Apple analytical default is disabled in this release. Choose Apple explicitly when available or select another model."
    : "Apple on-device analytics is unavailable on this desktop. Check Apple Intelligence or choose another model.";
}
