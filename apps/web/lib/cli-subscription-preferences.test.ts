import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { normalizeRemovedCliAgentIds, reconcileRemovedCliSelections } from "./cli-subscription-preferences";

const selected = {
  ...DEFAULT_EXECUTION_SETTINGS,
  executionMode: "local_cli" as const,
  runnerProviderId: "cli_stub" as const,
  localRunnerPresetId: "custom_cli_json" as const,
  selectedCliAgentId: "claude" as const,
  command: "claude",
  cliModelSelection: { source: "custom" as const, customModel: "claude-model" },
  memoryModelMode: "selected_cli" as const,
  memoryCliAgentId: "claude" as const
};

describe("subscription removal preferences", () => {
  it("accepts known unique provider IDs and ignores malformed persisted values", () => {
    expect(normalizeRemovedCliAgentIds(["claude", "unknown", "claude", 5, "codex"])).toEqual(["codex", "claude"]);
    expect(normalizeRemovedCliAgentIds("claude")).toEqual([]);
    expect(normalizeRemovedCliAgentIds(null)).toEqual([]);
  });

  it("replaces a removed chat provider only with a ready remaining provider and resets memory", () => {
    expect(reconcileRemovedCliSelections(selected, ["claude"], [
      { id: "cursor-agent", installed: true, status: "authentication_required", alias: "agent" },
      { id: "codex", installed: true, status: "ready", alias: "codex" }
    ], { codex: { source: "custom", customModel: "codex-model" } })).toMatchObject({
      selectedCliAgentId: "codex", command: "codex",
      cliModelSelection: { source: "custom", customModel: "codex-model" },
      memoryModelMode: "same_as_chat", memoryCliAgentId: undefined
    });
  });

  it("clears a removed selection on reload or when remaining providers are blocked", () => {
    const settings = reconcileRemovedCliSelections(selected, ["claude"], [
      { id: "codex", installed: true, status: "authentication_required", alias: "codex" }
    ]);
    expect(settings.selectedCliAgentId).toBeUndefined();
    expect(settings.command).toBeUndefined();
    expect(settings.cliModelSelection).toEqual({ source: "agent_default" });
    expect(reconcileRemovedCliSelections(selected, ["claude"]).selectedCliAgentId).toBeUndefined();
  });

  it("does not change an unrelated chat or memory choice", () => {
    expect(reconcileRemovedCliSelections(selected, ["gemini"])).toBe(selected);
  });
});
