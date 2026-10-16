import { afterEach, describe, expect, it, vi } from "vitest";
import { speechRequest, transcribeSpeech } from "./speech-client";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("speech client transport", () => {
  it("uses the reviewed private desktop command without HTTP", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    const invoke = vi.fn(async () => ({ supported: true }));
    const fetcher = vi.fn();
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    vi.stubGlobal("fetch", fetcher);
    await speechRequest({ operation: "status" });
    expect(invoke).toHaveBeenCalledWith("speech_request", { request: { operation: "status" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails closed in hosted mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(speechRequest({ operation: "status" })).rejects.toThrow(/Desktop or on localhost/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels again if capture is stopped before the submission acknowledgement arrives", async () => {
    vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
    let acknowledge: (value: unknown) => void = () => undefined;
    const invoke = vi.fn((_command: string, args: { request: { operation: string } }) => args.request.operation === "transcribe"
      ? new Promise((resolve) => { acknowledge = resolve; }) : Promise.resolve({ state: "cancelled" }));
    vi.stubGlobal("__TAURI__", { core: { invoke } });
    const controller = new AbortController();
    const pending = transcribeSpeech({ modelId: "base", language: "ru", audioBase64: "AA==" }, controller.signal);
    controller.abort();
    acknowledge({ state: "processing" });
    await expect(pending).rejects.toThrow();
    expect(invoke.mock.calls.filter(([, args]) => args.request.operation === "cancel")).toHaveLength(2);
  });
});
