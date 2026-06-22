import { stripSessionOnlySecrets } from "@/lib/session-secrets";

export { SESSION_ONLY_SECRET_FIELDS, jsonContainsSessionSecretFields, stripSessionOnlySecrets } from "@/lib/session-secrets";
export type { SessionOnlySecretField } from "@/lib/session-secrets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scrubPersistedProviderSecrets(persistedState: unknown): unknown {
  if (!isRecord(persistedState)) {
    return persistedState;
  }

  let nextState: Record<string, unknown> = stripSessionOnlySecrets({ ...persistedState });

  if (isRecord(persistedState.providerConfig)) {
    nextState = {
      ...nextState,
      providerConfig: stripSessionOnlySecrets(persistedState.providerConfig)
    };
  }

  if (isRecord(persistedState.executionSettings)) {
    nextState = {
      ...nextState,
      executionSettings: stripSessionOnlySecrets(persistedState.executionSettings)
    };
  }

  return nextState;
}

/** Ephemeral store fields excluded from Zustand `partialize` (session-only or transient UI). */
export const PARTIALIZE_EPHEMERAL_STATE_KEYS = [
  "runnerPairingToken",
  "cliTestStatusByAgent",
  "providerTestStatus"
] as const;
