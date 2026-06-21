function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scrubSecretFields(config: Record<string, unknown>) {
  const nextConfig = { ...config };
  delete nextConfig.apiKey;
  delete nextConfig.localApiKey;
  return nextConfig;
}

export function scrubPersistedProviderSecrets(persistedState: unknown): unknown {
  if (!isRecord(persistedState)) {
    return persistedState;
  }

  let nextState: Record<string, unknown> = { ...persistedState };

  if (isRecord(persistedState.providerConfig)) {
    nextState = {
      ...nextState,
      providerConfig: scrubSecretFields(persistedState.providerConfig)
    };
  }

  if (isRecord(persistedState.executionSettings)) {
    nextState = {
      ...nextState,
      executionSettings: scrubSecretFields(persistedState.executionSettings)
    };
  }

  return nextState;
}
