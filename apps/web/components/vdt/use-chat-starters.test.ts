import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { resolveSpeculativeChatStarterRequest } from "./use-chat-starters";

const configured = {
  ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli" as const, localRunnerPresetId: "ollama_openai" as const,
  runnerProviderId: "local_http_stub" as const, localModel: "qwen-test", analyticalSourceChoice: "manual" as const
};

describe("speculative chat starter admission", () => {
  it("does not occupy the Apple owner or fall back while Apple is selected", () => {
    expect(resolveSpeculativeChatStarterRequest(configured, "desktop", undefined, true)).toBeUndefined();
    expect(resolveSpeculativeChatStarterRequest({ ...configured, analyticalSourceChoice: "apple_manual" },
      "desktop", undefined, false)).toBeUndefined();
    expect(resolveSpeculativeChatStarterRequest({ ...configured, analyticalSourceChoice: "untouched" },
      "desktop", undefined, false, { status: "checking", firstLaunchDefaultEnabled: true })).toBeUndefined();
  });

  it("preserves configured non-Apple background starters", () => {
    expect(resolveSpeculativeChatStarterRequest(configured, "desktop", undefined, false))
      .toMatchObject({ providerId: "local_runner", providerConfig: { backendId: "ollama", model: "qwen-test" } });
  });
});
