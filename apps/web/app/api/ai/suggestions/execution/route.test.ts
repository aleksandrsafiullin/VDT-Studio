import { afterEach, expect, it, vi } from "vitest";
const resolve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/smart-kpi-host-identity", () => ({ resolveSmartHostIdentity: resolve }));
import { POST } from "./route";
afterEach(() => { vi.useRealTimers(); resolve.mockReset(); });
it("admits metadata from the direct loopback Host when Next reconstructs its request URL with localhost", async () => {
  const identity = { backendId: "codex_subscription", modelId: "selected", requestModel: "selected", bindingVersion: "fixture", credentialEpoch: "fixture", modelResolution: "exact", reasoningValues: [false, "low"] };
  resolve.mockResolvedValue(identity);
  const response = await POST(new Request("http://localhost:3192/api/ai/suggestions/execution", { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3192", origin: "http://127.0.0.1:3192", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ backendId: "codex_subscription", model: "selected" }) }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, identity });
  expect(resolve).toHaveBeenCalledOnce();
});
it("caps metadata-only admission by the lower raw user deadline and waits probe cleanup", async () => {
  vi.useFakeTimers(); let reject!: (reason: unknown) => void, signal!: AbortSignal;
  resolve.mockImplementation(async (_backend: unknown, _model: unknown, current: AbortSignal) => { signal = current; return new Promise((_done, fail) => { reject = fail; }); });
  let settled = false;
  const pending = POST(new Request("http://localhost:3000/api/ai/suggestions/execution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ backendId: "codex_subscription", timeoutMs: 20 }) })).finally(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(25); expect(signal.aborted).toBe(true); expect(settled).toBe(false);
  reject(Object.assign(new Error("Owned probe closed."), { code: "CANCELLED" })); expect((await pending).status).toBe(409);
});
