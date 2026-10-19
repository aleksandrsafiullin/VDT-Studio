/** Plaintext credentials excluded from ordinary persistence/export/localStorage.
 * BYOK apiKey has separate encrypted storage; other credentials remain session-only.
 * The legacy helper names are retained for existing callers. */
export const SESSION_ONLY_SECRET_FIELDS = [
  "apiKey",
  "localApiKey",
  "pairingToken",
  "runnerPairingToken",
  "accessToken",
  "providerToken"
] as const;

export type SessionOnlySecretField = (typeof SESSION_ONLY_SECRET_FIELDS)[number];

export function stripSessionOnlySecrets<T extends Record<string, unknown>>(config: T): T {
  const next = { ...config };
  for (const field of SESSION_ONLY_SECRET_FIELDS) {
    delete next[field];
  }
  return next;
}

export function jsonContainsSessionSecretFields(json: string): boolean {
  return SESSION_ONLY_SECRET_FIELDS.some((field) => new RegExp(`"${field}"\\s*:`).test(json));
}
