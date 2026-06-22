import { exportProjectJson, productionVolumeProject } from "@vdt-studio/vdt-core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import {
  PARTIALIZE_EPHEMERAL_STATE_KEYS,
  scrubPersistedProviderSecrets,
  SESSION_ONLY_SECRET_FIELDS
} from "./provider-persistence";
import { jsonContainsSessionSecretFields } from "@/lib/session-secrets";

function secretFixture() {
  return Object.fromEntries(SESSION_ONLY_SECRET_FIELDS.map((field) => [field, `${field}-secret`]));
}

describe("provider persistence", () => {
  it("removes all secret field names from legacy providerConfig", () => {
    const scrubbed = scrubPersistedProviderSecrets({
      providerId: "local_runner",
      providerConfig: {
        baseUrl: "https://models.example.test/v1",
        model: "vdt-model",
        localBaseUrl: "http://127.0.0.1:11434/v1",
        localModel: "qwen3",
        ...secretFixture()
      }
    }) as { providerConfig: Record<string, unknown> };

    for (const field of SESSION_ONLY_SECRET_FIELDS) {
      expect(scrubbed.providerConfig).not.toHaveProperty(field);
    }
    expect(scrubbed.providerConfig.baseUrl).toBe("https://models.example.test/v1");
    expect(scrubbed.providerConfig.localModel).toBe("qwen3");
  });

  it("removes all secret field names from executionSettings", () => {
    const scrubbed = scrubPersistedProviderSecrets({
      executionSettings: {
        executionMode: "byok",
        baseUrl: "https://api.openai.com/v1",
        gatewayPresetId: "alibaba-coding-plan",
        ...secretFixture()
      }
    }) as { executionSettings: Record<string, unknown> };

    for (const field of SESSION_ONLY_SECRET_FIELDS) {
      expect(scrubbed.executionSettings).not.toHaveProperty(field);
    }
    expect(scrubbed.executionSettings.executionMode).toBe("byok");
    expect(scrubbed.executionSettings.gatewayPresetId).toBe("alibaba-coding-plan");
  });

  it("removes top-level runnerPairingToken and pairingToken from migrated state", () => {
    expect(
      scrubPersistedProviderSecrets({
        runnerPairingToken: "legacy-top-level-runner",
        pairingToken: "legacy-top-level-pairing",
        providerId: "local_runner"
      })
    ).toEqual({ providerId: "local_runner" });
  });

  it("leaves unrelated legacy payloads unchanged", () => {
    expect(scrubPersistedProviderSecrets({ providerId: "mock" })).toEqual({ providerId: "mock" });
    expect(scrubPersistedProviderSecrets(undefined)).toBeUndefined();
  });

  it("documents ephemeral keys excluded from partialize", () => {
    expect(PARTIALIZE_EPHEMERAL_STATE_KEYS).toEqual([
      "runnerPairingToken",
      "cliTestStatusByAgent",
      "providerTestStatus"
    ]);
  });

  it("exportProjectJson contains no provider credential fields", () => {
    const json = exportProjectJson(productionVolumeProject);
    expect(jsonContainsSessionSecretFields(json)).toBe(false);
  });
});

describe("store persist round-trip", () => {
  it("partialize + migrate scrub leaves no session secrets in serialized state", async () => {
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        }
      };
    })();

    vi.stubGlobal("localStorage", localStorageMock);

    const { useVdtStudioStore } = await import("./vdt-store");
    localStorageMock.clear();

    useVdtStudioStore.setState({
      executionSettings: {
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        gatewayPresetId: "alibaba-coding-plan",
        apiKey: "round-trip-api-secret",
        localApiKey: "round-trip-local-secret"
      },
      providerConfig: {
        apiKey: "provider-config-secret",
        localApiKey: "provider-local-secret",
        ...({ pairingToken: "provider-pairing-secret" } as Record<string, string>)
      },
      runnerPairingToken: "runner-session-token",
      cliTestStatusByAgent: { claude: { kind: "success", message: "ok" } },
      providerTestStatus: { kind: "success", message: "connected" }
    });

    const raw = localStorageMock.getItem("vdt-studio-state");
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw!) as { state?: Record<string, unknown> };
    const scrubbed = scrubPersistedProviderSecrets(parsed.state) as Record<string, unknown>;

    for (const field of SESSION_ONLY_SECRET_FIELDS) {
      expect(JSON.stringify(scrubbed)).not.toContain(`${field}-secret`);
      expect(JSON.stringify(scrubbed)).not.toContain("runner-session-token");
    }

    for (const key of PARTIALIZE_EPHEMERAL_STATE_KEYS) {
      expect(scrubbed).not.toHaveProperty(key);
    }

    expect(scrubbed.executionSettings).toMatchObject({
      executionMode: "byok",
      gatewayPresetId: "alibaba-coding-plan"
    });
  });
});
