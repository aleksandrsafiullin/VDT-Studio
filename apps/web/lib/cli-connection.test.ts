import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentExecutionBindingSelection } from "./agent-client";
import { cliConnectionKey, connectCliConnection, type CliConnectionCheck, type CliConnectionSnapshot } from "./cli-connection";
import { DEFAULT_EXECUTION_SETTINGS, type CliAgentId } from "./execution-mode-catalog";

const settings = {
  ...DEFAULT_EXECUTION_SETTINGS,
  executionMode: "local_cli" as const,
  selectedCliAgentId: "codex" as const,
  runnerProviderId: "cli_stub" as const,
  localRunnerPresetId: "custom_cli_json" as const,
  command: "codex",
  cliModelSelection: { source: "custom" as const, customModel: "saved-model" }
};
const ready = { id: "codex" as const, installed: true, status: "ready" as const };
const bindings: AgentExecutionBindingSelection = {
  schemaVersion: 1, ok: true, defaultBindingId: null,
  bindings: [{ bindingId: "saved-binding", executionProfile: "external_cli_agent", engineId: "codex",
    engineAdapterId: "codex", backendId: "codex_subscription", modelId: "saved-model" }]
};
const connections: ReturnType<typeof connectCliConnection>[] = [];

function harness(initial: Partial<CliConnectionSnapshot> = {}) {
  let state: CliConnectionSnapshot = { settings, detections: undefined, scanning: false, testing: false, removedAgentIds: [], ...initial };
  let visible = true;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<CliConnectionSnapshot>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const publish = vi.fn<(check: CliConnectionCheck) => void>();
  const rescan = vi.fn<(agentId?: CliAgentId) => Promise<void>>(async () => {
    update({ scanning: true });
    await Promise.resolve();
    update({ scanning: false, detections: [ready], detectionError: undefined });
  });
  const getBindings = vi.fn(async () => bindings);
  const start = () => {
    const connection = connectCliConnection({ getSnapshot: () => state, subscribe: (listener) => {
      listeners.add(listener); return () => listeners.delete(listener);
    }, rescan, getBindings, publish, isVisible: () => visible });
    connections.push(connection);
    return connection;
  };
  return { update, publish, rescan, getBindings, start, getState: () => state, setVisible: (value: boolean) => { visible = value; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T00:00:00Z")); });
afterEach(() => { connections.splice(0).forEach((connection) => connection.dispose()); vi.useRealTimers(); });
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("automatic CLI connection lifecycle", () => {
  it("checks the saved CLI and its exact chat model at app startup, before opening a VDT", async () => {
    const app = harness();
    app.start();
    expect(app.rescan).toHaveBeenCalledExactlyOnceWith("codex");
    expect(app.getBindings).not.toHaveBeenCalled();
    await settle();
    expect(app.getBindings).toHaveBeenCalledOnce();
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
    expect(app.getState().settings).toBe(settings);
    app.update({ vdtId: "opened-tree" });
    await settle();
    expect(app.rescan).toHaveBeenCalledOnce();
    expect(app.getBindings).toHaveBeenCalledOnce();
  });

  it("does not trust an earlier session's ready result on remount", async () => {
    const app = harness({ detections: [ready] });
    app.rescan.mockImplementationOnce(async () => app.update({ detections: [{ ...ready, status: "authentication_required" }] }));
    app.start();
    await settle();
    expect(app.rescan).toHaveBeenCalledExactlyOnceWith("codex");
    expect(app.getBindings).not.toHaveBeenCalled();
    expect(app.publish.mock.lastCall?.[0].bindings).toBeUndefined();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.rescan).toHaveBeenCalledOnce();
  });

  it("starts the initial check even when the app opens in a background tab", async () => {
    const app = harness();
    app.setVisible(false);
    app.start();
    await settle();
    expect(app.rescan).toHaveBeenCalledExactlyOnceWith("codex");
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
  });

  it("discovers a provider when CLI mode has no saved selection and uses that fresh result", async () => {
    const app = harness({ settings: { ...settings, selectedCliAgentId: undefined } });
    app.rescan.mockImplementationOnce(async () => app.update({ detections: [ready], settings }));
    app.start();
    await settle();
    expect(app.rescan).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(app.getBindings).toHaveBeenCalledOnce();
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
  });

  it.each([
    { settings: DEFAULT_EXECUTION_SETTINGS },
    { settings: { ...settings, runnerProviderId: "local_http_stub" as const, localRunnerPresetId: "ollama_openai" as const } },
    { removedAgentIds: ["codex" as const] },
    { settings: { ...settings, selectedCliAgentId: undefined }, removedAgentIds: ["codex" as const] }
  ])("preserves other execution categories and removed subscriptions: %j", async (initial) => {
    const app = harness(initial);
    const connection = app.start();
    connection.refresh();
    await settle();
    expect(app.rescan).not.toHaveBeenCalled();
    expect(app.getBindings).not.toHaveBeenCalled();
  });

  it("retries transient startup failure automatically with bounded backoff", async () => {
    const app = harness();
    app.rescan.mockImplementationOnce(async () => app.update({ detections: [], detectionError: "Runtime starting" }));
    app.start();
    await settle();
    expect(app.getBindings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.rescan).toHaveBeenCalledTimes(2);
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.rescan).toHaveBeenCalledTimes(2);
  });

  it("retries a failed chat binding lookup without a Settings Test", async () => {
    const app = harness();
    app.getBindings.mockRejectedValueOnce(new Error("Server warming up"));
    app.start();
    await settle();
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), failed: true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.getBindings).toHaveBeenCalledTimes(2);
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
  });

  it("keeps an unbound model unavailable and backs off repeated failures", async () => {
    const app = harness();
    app.getBindings.mockResolvedValue({ ...bindings, bindings: [] });
    app.start();
    await settle();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.rescan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(app.rescan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(app.rescan).toHaveBeenCalledTimes(3);
    expect(app.publish.mock.lastCall?.[0].bindings?.bindings).toEqual([]);
  });

  it("deduplicates focus/online notifications, then revalidates a stale ready connection", async () => {
    const app = harness();
    const connection = app.start();
    connection.refresh();
    connection.refresh();
    await settle();
    connection.refresh();
    expect(app.rescan).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    connection.refresh();
    connection.refresh();
    await settle();
    expect(app.rescan).toHaveBeenCalledTimes(2);
  });

  it("stops retries while hidden and recovers on returning after provider sign-in", async () => {
    const app = harness();
    app.rescan.mockImplementationOnce(async () => app.update({ detections: [{ ...ready, status: "authentication_required" }] }));
    const connection = app.start();
    await settle();
    app.setVisible(false);
    connection.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    connection.refresh();
    expect(app.rescan).toHaveBeenCalledOnce();
    app.setVisible(true);
    connection.visibilityChanged();
    await settle();
    expect(app.rescan).toHaveBeenCalledTimes(2);
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
  });

  it("does not repeat a scan already running in Settings or a Strict Mode mount", async () => {
    const app = harness({ scanning: true });
    app.start();
    expect(app.rescan).not.toHaveBeenCalled();
    app.update({ scanning: false, detections: [ready] });
    await settle();
    expect(app.rescan).not.toHaveBeenCalled();
    expect(app.getBindings).toHaveBeenCalledOnce();
  });

  it("resumes recovery if a hidden failed startup becomes visible during the cooldown", async () => {
    const app = harness();
    app.setVisible(false);
    app.rescan.mockImplementationOnce(async () => app.update({ detections: [], detectionError: "Runtime starting" }));
    const connection = app.start();
    await settle();
    app.setVisible(true);
    connection.visibilityChanged();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(app.rescan).toHaveBeenCalledTimes(2);
    expect(app.publish).toHaveBeenLastCalledWith({ key: cliConnectionKey(settings), bindings });
  });

  it("refreshes chat bindings after manual verification without another CLI probe", async () => {
    const app = harness();
    app.start();
    await settle();
    app.update({ testing: true, detections: [{ ...ready, status: "installed" }] });
    app.update({ testing: false, detections: [ready] });
    await settle();
    expect(app.rescan).toHaveBeenCalledOnce();
    expect(app.getBindings).toHaveBeenCalledTimes(2);
  });

  it.each(["model", "reasoning"])("ignores a late lookup after %s change and verifies the new selection", async (change) => {
    const app = harness();
    let finish!: (value: AgentExecutionBindingSelection) => void;
    app.getBindings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    app.start();
    await settle();
    const changed = { ...settings, cliModelSelection: change === "model"
      ? { source: "custom" as const, customModel: "another-model" }
      : { source: "custom" as const, customModel: "saved-model", reasoningEffort: "high" as const } };
    app.update({ settings: changed });
    finish(bindings);
    await settle();
    expect(app.publish.mock.calls.some(([check]) => check.key === cliConnectionKey(settings) && check.bindings)).toBe(false);
    expect(app.rescan).toHaveBeenCalledTimes(2);
    expect(app.publish.mock.lastCall?.[0].key).toBe(cliConnectionKey(changed));
  });

  it("disposes timers/subscriptions and ignores late results", async () => {
    const app = harness();
    let finish!: (value: AgentExecutionBindingSelection) => void;
    app.getBindings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const connection = app.start();
    await settle();
    connection.dispose();
    const published = app.publish.mock.calls.length;
    finish(bindings);
    await settle();
    app.update({ vdtId: "later-tree" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(app.publish).toHaveBeenCalledTimes(published);
    expect(app.rescan).toHaveBeenCalledOnce();
  });

  it("rejects an old binding lookup after switching away and back to the same CLI/model", async () => {
    const app = harness();
    let finish!: (value: AgentExecutionBindingSelection) => void;
    app.getBindings.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    app.start();
    await settle();
    app.update({ settings: DEFAULT_EXECUTION_SETTINGS });
    app.update({ settings });
    finish(bindings);
    await settle();
    expect(app.rescan).toHaveBeenCalledTimes(2);
    expect(app.getBindings).toHaveBeenCalledTimes(2);
    expect(app.publish.mock.calls.filter(([check]) => check.bindings)).toHaveLength(1);
  });
});
