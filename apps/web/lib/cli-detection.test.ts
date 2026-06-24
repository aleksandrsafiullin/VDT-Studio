import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import {
  mergeCliDetectionAgents,
  patchSelectedCliCommandAfterRescan,
  resolveCliCommandForAgent
} from "./cli-detection";

describe("cli-detection", () => {
  it("resolves command from detection alias with catalog fallback", () => {
    expect(resolveCliCommandForAgent("claude")).toBe("claude");
    expect(
      resolveCliCommandForAgent("claude", [{ id: "claude", alias: "/usr/local/bin/claude" }])
    ).toBe("/usr/local/bin/claude");
  });

  it("patches selected CLI command after full rescan when alias changes", () => {
    const settings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: "claude" as const,
      command: "claude",
      localRunnerPresetId: "custom_cli_json" as const,
      runnerProviderId: "cli_stub" as const
    };

    const agents = [{ id: "claude" as const, alias: "/opt/homebrew/bin/claude" }];

    expect(patchSelectedCliCommandAfterRescan(settings, agents)).toMatchObject({
      command: "/opt/homebrew/bin/claude"
    });
  });

  it("auto-selects Cursor Agent after a full rescan when no CLI is selected", () => {
    const settings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: undefined
    };

    const agents = [
      { id: "claude" as const, installed: true, alias: "/opt/homebrew/bin/claude", status: "ready" },
      { id: "cursor-agent" as const, installed: true, alias: "agent", status: "ready" }
    ];

    expect(patchSelectedCliCommandAfterRescan(settings, agents)).toMatchObject({
      executionMode: "local_cli",
      selectedCliAgentId: "cursor-agent",
      localRunnerPresetId: "custom_cli_json",
      runnerProviderId: "cli_stub",
      command: "agent"
    });
  });

  it("auto-selects Codex CLI after a full rescan when Cursor Agent is unavailable", () => {
    const settings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: undefined
    };

    const agents = [
      { id: "claude" as const, installed: true, alias: "/opt/homebrew/bin/claude", status: "ready" },
      { id: "codex" as const, installed: true, alias: "codex", status: "ready" },
      { id: "cursor-agent" as const, installed: false, alias: null, status: "not_installed" }
    ];

    expect(patchSelectedCliCommandAfterRescan(settings, agents)).toMatchObject({
      executionMode: "local_cli",
      selectedCliAgentId: "codex",
      localRunnerPresetId: "custom_cli_json",
      runnerProviderId: "cli_stub",
      command: "codex"
    });
  });

  it("switches away from an unavailable selected CLI after a full rescan", () => {
    const settings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: "claude" as const,
      command: "claude"
    };

    const agents = [
      { id: "claude" as const, installed: false, alias: null, status: "not_installed" },
      { id: "cursor-agent" as const, installed: true, alias: "agent", status: "ready" }
    ];

    expect(patchSelectedCliCommandAfterRescan(settings, agents)).toMatchObject({
      selectedCliAgentId: "cursor-agent",
      command: "agent"
    });
  });

  it("patches selected CLI command after single-agent rescan only when that agent is selected", () => {
    const settings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      executionMode: "local_cli" as const,
      selectedCliAgentId: "claude" as const,
      command: "claude"
    };

    const codexAgent = { id: "codex" as const, alias: "codex-cli" };
    const claudeAgent = { id: "claude" as const, alias: "/bin/claude" };

    expect(patchSelectedCliCommandAfterRescan(settings, [codexAgent], "codex")).toBe(settings);
    expect(patchSelectedCliCommandAfterRescan(settings, [claudeAgent], "claude")).toMatchObject({
      command: "/bin/claude"
    });
  });

  it("merges single-agent rescan results into existing detection list", () => {
    const existing = [
      { id: "claude" as const, alias: "claude" },
      { id: "codex" as const, alias: "codex" }
    ];
    const updated = { id: "claude" as const, alias: "/usr/bin/claude" };

    expect(mergeCliDetectionAgents(existing, updated, "claude")).toEqual([
      { id: "claude", alias: "/usr/bin/claude" },
      { id: "codex", alias: "codex" }
    ]);
    expect(mergeCliDetectionAgents(undefined, updated, "claude")).toEqual([updated]);
  });
});
