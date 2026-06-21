import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { formatExecutionModeSummary } from "./format-execution-summary";

describe("formatExecutionModeSummary", () => {
  it("summarizes the default real BYOK execution", () => {
    expect(formatExecutionModeSummary(DEFAULT_EXECUTION_SETTINGS)).toEqual({
      modeLabel: "BYOK",
      primary: "OpenAI · OpenAI",
      secondary: "gpt-5.5"
    });
  });

  it("summarizes local CLI HTTP preset", () => {
    expect(
      formatExecutionModeSummary({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        localRunnerPresetId: "ollama_openai",
        localModel: "qwen3"
      })
    ).toEqual({
      modeLabel: "Local CLI",
      primary: "Ollama",
      secondary: "qwen3"
    });
  });

  it("summarizes local CLI agent selection", () => {
    expect(
      formatExecutionModeSummary({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "claude",
        localRunnerPresetId: "custom_cli_json",
        runnerProviderId: "cli_stub",
        cliModelSelection: { source: "custom", customModel: "claude-sonnet-4-5" }
      })
    ).toEqual({
      modeLabel: "Local CLI",
      primary: "Claude Code",
      secondary: "claude-sonnet-4-5"
    });
  });

  it("summarizes HTTP preset when cli_stub would fall back to HTTP", () => {
    expect(
      formatExecutionModeSummary({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "local_cli",
        selectedCliAgentId: "claude",
        localRunnerPresetId: "ollama_openai",
        runnerProviderId: "cli_stub",
        localModel: "qwen3"
      })
    ).toEqual({
      modeLabel: "Local CLI",
      primary: "Ollama",
      secondary: "qwen3"
    });
  });

  it("summarizes BYOK preset and model", () => {
    expect(
      formatExecutionModeSummary({
        ...DEFAULT_EXECUTION_SETTINGS,
        executionMode: "byok",
        useMockProvider: false,
        gatewayPresetId: "openai-default",
        byokProtocol: "openai",
        model: "gpt-5.4-mini"
      })
    ).toEqual({
      modeLabel: "BYOK",
      primary: "OpenAI · OpenAI",
      secondary: "gpt-5.4-mini"
    });
  });
});
