function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function scrubPersistedProviderSecrets(persistedState: unknown): unknown {
  if (!isRecord(persistedState) || !isRecord(persistedState.providerConfig)) {
    return persistedState;
  }

  const providerConfig = { ...persistedState.providerConfig };
  delete providerConfig.apiKey;
  delete providerConfig.localApiKey;

  return {
    ...persistedState,
    providerConfig
  };
}
