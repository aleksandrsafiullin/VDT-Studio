import { expect, it } from "vitest";
import { taskExecutionAssertion } from "./task-execution-expectation";

it("retains the exact model in registered task-mode assertions without promoting third-party local HTTP", () => {
  expect(taskExecutionAssertion("local_runner", { backendId: "ollama", model: "qwen3" })).toEqual({
    expectedExecution: { mode: "legacy", profileVersion: 1, providerId: "ollama", modelId: "qwen3", modelRevision: null }
  });
  expect(taskExecutionAssertion("local_runner", { backendId: "codex_subscription", model: "fixture" })).toEqual({
    expectedExecution: { mode: "cli_subscription", profileVersion: 1, providerId: "codex_subscription", modelId: "fixture", modelRevision: null }
  });
  expect(taskExecutionAssertion("azure_openai", { endpoint: "https://azure.example", apiKey: "test-key", deployment: "my-deployment", model: "ignored" })).toEqual({
    expectedExecution: { mode: "api_keys", profileVersion: 1, providerId: "azure_openai", modelId: "my-deployment", modelRevision: null }
  });
});

it("omits assertions for manual file analysis, pairing and configuration without a selected credential or destination", () => {
  for (const [providerId, config] of [
    [undefined, undefined],
    ["local_runner", { backendId: "codex_subscription" }],
    ["local_runner", { backendId: "codex_subscription", model: "fixture", pairingToken: "paired" }],
    ["openai_compatible", { model: "fixture", baseUrl: "https://api.openai.com/v1" }],
    ["openai_compatible", { model: "fixture", apiKey: "test-key" }]
  ] as const) expect(taskExecutionAssertion(providerId, config)).toEqual({});
});
