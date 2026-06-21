import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import {
  hasByokFieldErrors,
  resolveEffectiveByokUrls,
  validateByokSettings
} from "./byok-validation";

describe("byok-validation", () => {
  it("uses preset baseUrl when customizeBaseUrl is false", () => {
    expect(
      resolveEffectiveByokUrls(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "byok",
          useMockProvider: false,
          gatewayPresetId: "openai-default",
          byokProtocol: "openai",
          customizeBaseUrl: false,
          baseUrl: "https://stale.example.com/v1"
        },
        {
          id: "openai-default",
          label: "OpenAI",
          protocol: "openai",
          gateway: "none",
          proxyProvider: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          models: ["gpt-4.1-mini"]
        }
      )
    ).toEqual({ baseUrl: "https://api.openai.com/v1" });
  });

  it("uses settings baseUrl when customizeBaseUrl is true", () => {
    expect(
      resolveEffectiveByokUrls(
        {
          ...DEFAULT_EXECUTION_SETTINGS,
          executionMode: "byok",
          useMockProvider: false,
          gatewayPresetId: "openai-default",
          byokProtocol: "openai",
          customizeBaseUrl: true,
          baseUrl: "https://custom.example.com/v1"
        },
        {
          id: "openai-default",
          label: "OpenAI",
          protocol: "openai",
          gateway: "none",
          proxyProvider: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4.1-mini",
          models: ["gpt-4.1-mini"]
        }
      )
    ).toEqual({ baseUrl: "https://custom.example.com/v1" });
  });

  it("requires api key and model for non-mock BYOK settings", () => {
    const errors = validateByokSettings({
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "byok",
      useMockProvider: false,
      gatewayPresetId: "openai-default",
      byokProtocol: "openai",
      apiKey: "",
      model: ""
    });

    expect(errors.apiKey).toBeTruthy();
    expect(errors.model).toBeTruthy();
    expect(hasByokFieldErrors(errors)).toBe(true);
  });

  it("skips BYOK validation for mock provider", () => {
    expect(
      validateByokSettings({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: true,
        gatewayPresetId: "mock"
      })
    ).toEqual({});
  });

  it("returns apiKey error when test connection validation runs without a key", () => {
    const errors = validateByokSettings({
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "byok",
      useMockProvider: false,
      gatewayPresetId: "anthropic-claude",
      byokProtocol: "anthropic",
      apiKey: "",
      model: "claude-sonnet-4-5"
    });

    expect(errors.apiKey).toBe("API key is required.");
    expect(errors.model).toBeUndefined();
    expect(hasByokFieldErrors(errors)).toBe(true);
  });
});
