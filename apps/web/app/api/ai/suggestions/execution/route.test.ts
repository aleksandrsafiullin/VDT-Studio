import { afterEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/smart-kpi-host-identity", () => ({ resolveSmartCodexHostIdentity: resolve }));
import { POST } from "./route";
afterEach(() => { vi.useRealTimers(); resolve.mockReset(); });
it("caps metadata-only admission by the lower raw user deadline and waits probe cleanup", async () => {
  vi.useFakeTimers(); let reject!: (reason: unknown) => void, signal!: AbortSignal;
  resolve.mockImplementation(async (_model: unknown, current: AbortSignal) => { signal = current; return new Promise((_done, fail) => { reject = fail; }); });
  let settled = false;
  const pending = POST(new Request("http://localhost:3000/api/ai/suggestions/execution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ backendId: "codex_subscription", timeoutMs: 20 }) })).finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(25); expect(signal.aborted).toBe(true); expect(settled).toBe(false);
  reject(Object.assign(new Error("Owned probe closed."), { code: "CANCELLED" })); expect((await pending).status).toBe(409);
});
