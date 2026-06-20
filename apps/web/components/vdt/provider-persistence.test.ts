import { describe, expect, it } from "vitest";
import { scrubPersistedProviderSecrets } from "./provider-persistence";

describe("provider persistence", () => {
  it("removes legacy provider secrets without changing non-secret settings", () => {
    expect(
      scrubPersistedProviderSecrets({
        providerId: "local_runner",
        providerConfig: {
          baseUrl: "https://models.example.test/v1",
          model: "vdt-model",
          apiKey: "legacy-openai-secret",
          localBaseUrl: "http://127.0.0.1:11434/v1",
          localModel: "qwen3",
          localApiKey: "legacy-local-secret"
        }
      })
    ).toEqual({
      providerId: "local_runner",
      providerConfig: {
        baseUrl: "https://models.example.test/v1",
        model: "vdt-model",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3"
      }
    });
  });

  it("leaves unrelated legacy payloads unchanged", () => {
    expect(scrubPersistedProviderSecrets({ providerId: "mock" })).toEqual({ providerId: "mock" });
    expect(scrubPersistedProviderSecrets(undefined)).toBeUndefined();
  });
});
