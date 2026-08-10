import { describe, expect, it } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { describeCliDetection, resolveSelectedCliReadiness } from "./cli-readiness";

const cursorSettings = {
  ...DEFAULT_EXECUTION_SETTINGS,
  executionMode: "local_cli" as const,
  selectedCliAgentId: "cursor-agent" as const,
  localRunnerPresetId: "custom_cli_json" as const,
  runnerProviderId: "cli_stub" as const,
  command: "agent"
};

describe("CLI request readiness", () => {
  it("stays in a non-executable checking state until detection completes", () => {
    expect(resolveSelectedCliReadiness(cursorSettings, undefined)).toMatchObject({
      state: "checking",
      canExecute: false,
      label: "Checking…"
    });
  });

  it("is ready only when the selected CLI is installed and reports ready", () => {
    expect(
      resolveSelectedCliReadiness(cursorSettings, [
        { id: "cursor-agent", installed: true, status: "ready" }
      ])
    ).toMatchObject({ state: "ready", canExecute: true, label: "Ready" });

    expect(
      resolveSelectedCliReadiness(cursorSettings, [
        { id: "cursor-agent", installed: true, status: "installed" }
      ])
    ).toMatchObject({ state: "warning", canExecute: false, label: "Verification required" });
  });

  it("uses warning states for installed agents that cannot run now", () => {
    expect(
      describeCliDetection("cursor-agent", {
        id: "cursor-agent",
        installed: true,
        status: "authentication_required"
      })
    ).toMatchObject({ state: "warning", canExecute: false, label: "Sign in required" });

    expect(
      describeCliDetection("cursor-agent", {
        id: "cursor-agent",
        installed: true,
        status: "error"
      })
    ).toMatchObject({ state: "warning", canExecute: false, label: "Check failed" });
  });

  it("uses a blocked not-installed state only after detection confirms it", () => {
    expect(
      describeCliDetection("cursor-agent", {
        id: "cursor-agent",
        installed: false,
        status: "not_installed"
      })
    ).toMatchObject({ state: "not_installed", canExecute: false, label: "Not installed" });

    expect(describeCliDetection("cursor-agent", undefined)).toMatchObject({
      state: "warning",
      canExecute: false,
      label: "Status unavailable"
    });
  });

  it("reports scanning during an active rescan even when a stale ready snapshot exists", () => {
    expect(
      resolveSelectedCliReadiness(
        cursorSettings,
        [{ id: "cursor-agent", installed: true, status: "ready" }],
        { isScanning: true }
      )
    ).toMatchObject({ state: "checking", canExecute: false });
  });
});
