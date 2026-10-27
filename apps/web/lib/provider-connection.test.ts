import { afterEach, describe, expect, it, vi } from "vitest";
import { connectProviderConnection, type ProviderConnectionCheck } from "./provider-connection";
import { DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "./execution-mode-catalog";

function fixture(initial: ExecutionSettings = { ...DEFAULT_EXECUTION_SETTINGS, apiKey: "test-private" }) {
  let settings = initial, visible = true, listener = () => {};
  const checks: ProviderConnectionCheck[] = [];
  const probe = vi.fn(async () => undefined);
  const connector = connectProviderConnection({ getSettings: () => settings, subscribe: (fn) => { listener = fn; return () => { listener = () => {}; }; },
    probe, publish: (value) => checks.push(value), isVisible: () => visible });
  return { connector, checks, probe, set(next: ExecutionSettings) { settings = next; listener(); }, settings: () => settings, visible(value: boolean) { visible = value; connector.visibilityChanged(); } };
}
afterEach(() => { vi.useRealTimers(); });
describe("automatic API/local connection", () => {
  it("connects without Settings/Test and does not recheck for unrelated UI or reasoning changes", async () => {
    const f = fixture();
    await vi.waitFor(() => expect(f.checks.at(-1)?.state).toBe("ready"));
    f.set({ ...f.settings(), modelReasoningBySource: { source: "high" } });
    expect(f.probe).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.checks)).not.toContain("test-private");
    f.connector.dispose();
  });
  it("waits for vault hydration and connects as soon as the key arrives", async () => {
    const f = fixture({ ...DEFAULT_EXECUTION_SETTINGS, apiKey: undefined });
    expect(f.checks.at(-1)?.state).toBe("warning"); expect(f.probe).not.toHaveBeenCalled();
    f.set({ ...f.settings(), apiKey: "new-private" });
    await vi.waitFor(() => expect(f.checks.at(-1)?.state).toBe("ready"));
    expect(f.probe).toHaveBeenCalledTimes(1); f.connector.dispose();
  });
  it("cancels and ignores old results when credentials rotate at the same model", async () => {
    const f = fixture(); await vi.waitFor(() => expect(f.probe).toHaveBeenCalledTimes(1));
    let release!: () => void;
    f.probe.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(undefined); }));
    f.set({ ...f.settings(), apiKey: "intermediate-private" });
    const oldSignal = (f.probe.mock.calls.at(-1) as unknown as [unknown, AbortSignal])[1];
    f.set({ ...f.settings(), apiKey: "final-private" });
    expect(oldSignal.aborted).toBe(true);
    await vi.waitFor(() => expect(f.checks.at(-1)?.state).toBe("ready"));
    const count = f.checks.length; release(); await Promise.resolve(); await Promise.resolve();
    expect(f.checks).toHaveLength(count); f.connector.dispose();
  });
  it("retries offline models while visible and resumes when the app returns", async () => {
    vi.useFakeTimers();
    const f = fixture({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", localModel: "installed-model" });
    await vi.runAllTicks(); await Promise.resolve(); await Promise.resolve();
    f.probe.mockRejectedValueOnce(new Error("offline"));
    vi.advanceTimersByTime(3001); f.connector.refresh();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.checks.at(-1)?.state).toBe("warning");
    f.visible(false); await vi.advanceTimersByTimeAsync(3001);
    const count = f.probe.mock.calls.length;
    f.visible(true); await Promise.resolve(); await Promise.resolve();
    expect(f.probe.mock.calls.length).toBe(count + 1); f.connector.dispose();
  });
});
