import { AppleTransportError, type AppleCompletionRequest, type AppleModelCapability } from "@vdt-studio/local-runner/apple-foundation-models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicAgentExecutionBindingSummary } from "@/lib/agent-client";
import { runAppleInferenceDiagnostic } from "@/lib/apple-native-client";
import { POST as prepare } from "../route";
import { POST } from "./route";

const fixture = vi.hoisted(() => ({
  port: { discover: vi.fn(), complete: vi.fn() },
  enabled: true,
  catalog: "sha256:" + "a".repeat(64)
}));

vi.mock("../../../runs/apple-native-host", async importOriginal => ({
  ...await importOriginal<typeof import("../../../runs/apple-native-host")>(),
  packagedAppleNativePort: () => fixture.enabled ? fixture.port : null
}));

vi.mock("../../../runs/runtime", async () => {
  const { AgentExecutionBindingRegistry } = await import("../../../runs/execution-bindings");
  return { agentExecutionBindingRegistry: new AgentExecutionBindingRegistry(), agentRuntime: { tools: {} } };
});

vi.mock("../../../runs/model-agent-tool-catalog", () => ({ modelAgentToolCatalogHash: () => fixture.catalog }));

const capability: AppleModelCapability = {
  identity: { model: "SystemLanguageModel.default", profile: "vdt-native-guided-v1", osBuild: "fixture build", modelRevision: null },
  locale: "en-US",
  contextSize: 8_192,
  tokenBudgetVerified: true
};
const host = "http://localhost:3000";
const diagnosticPath = "/api/agent/bindings/apple/diagnostic";
function request(path: string, body: unknown, signal?: AbortSignal, origin = host) {
  return new Request(new URL(path, host), {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {})
  });
}

function routeFetch(): typeof fetch {
  return vi.fn<typeof fetch>(async (path, init) => {
    expect(path).toBe(diagnosticPath);
    return POST(new Request(new URL(diagnosticPath, host), {
      ...init, headers: { ...init?.headers, origin: host }
    }));
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.enabled = true;
  fixture.catalog = "sha256:" + "a".repeat(64);
  fixture.port.discover.mockResolvedValue(capability);
  fixture.port.complete.mockImplementation(async (input: AppleCompletionRequest, verify: (value: unknown) => unknown) => {
    expect(input).toMatchObject({
      expectedIdentity: capability.identity, locale: capability.locale, maxOutputTokens: 128,
      prompt: "Calculate revenue for 100 units at 20 USD each. Return the integer amount and ISO currency code."
    });
    return {
      value: verify({ value: 2_000, unit: "USD" }),
      context: { inputTokens: 41, contextSize: 8_192, reservedOutputTokens: 128 }
    };
  });
});

async function selectedBinding() {
  const response = await prepare(request("/api/agent/bindings/apple", { locale: "en-US" }));
  expect(response.status).toBe(200);
  const { binding } = await response.json();
  expect(fixture.port.complete).not.toHaveBeenCalled();
  fixture.port.discover.mockClear();
  return binding as PublicAgentExecutionBindingSummary;
}

function requestInput(binding: PublicAgentExecutionBindingSummary) {
  const { mode, profileVersion, providerId, modelId, modelRevision } = binding.admission!;
  return { bindingId: binding.bindingId, locale: "en-US", expectedExecution: { mode, profileVersion, providerId, modelId, modelRevision } };
}

describe("Apple Settings inference diagnostic", () => {
  it("reads the verified model result and exact admitted identity from the normal route", async () => {
    const binding = await selectedBinding();
    const receipt = await runAppleInferenceDiagnostic(binding, "en-US", new AbortController().signal, routeFetch());
    expect(receipt).toMatchObject({
      bindingId: binding.bindingId, providerId: binding.backendId, locale: "en-US", identity: capability.identity,
      result: { value: 2_000, unit: "USD" }
    });
    expect(fixture.port.discover).toHaveBeenCalledOnce();
    expect(fixture.port.complete).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin, extra fields, forged bindings, mismatched locale or expectation before helper invocation", async () => {
    const binding = await selectedBinding();
    const input = requestInput(binding);
    expect((await POST(request(diagnosticPath, input, undefined, "https://example.com"))).status).toBe(403);
    for (const [body, code] of [
      [{ ...input, prompt: "user content" }, "invalid_request"],
      [{ ...input, bindingId: `apple_native_${"0".repeat(64)}` }, "stale_identity"],
      [{ ...input, locale: "en-GB" }, "stale_identity"],
      [{ ...input, expectedExecution: { ...input.expectedExecution, modelId: "forged" } }, "stale_identity"]
    ] as const) {
      const response = await POST(request(diagnosticPath, body));
      expect(await response.json()).toMatchObject({ ok: false, code });
    }
    fixture.catalog = "sha256:" + "b".repeat(64);
    const response = await POST(request(diagnosticPath, input));
    expect(await response.json()).toMatchObject({ ok: false, code: "stale_identity" });
    expect(fixture.port.discover).not.toHaveBeenCalled();
    expect(fixture.port.complete).not.toHaveBeenCalled();
  });

  it("fences a disabled packaged host and a stale device identity before generation", async () => {
    const binding = await selectedBinding();
    const signal = new AbortController().signal;
    fixture.enabled = false;
    await expect(runAppleInferenceDiagnostic(binding, "en-US", signal, routeFetch())).rejects.toThrow("unavailable");
    expect(fixture.port.discover).not.toHaveBeenCalled();

    fixture.enabled = true;
    fixture.port.discover.mockResolvedValue({ ...capability, identity: { ...capability.identity, osBuild: "changed" } });
    await expect(runAppleInferenceDiagnostic(binding, "en-US", signal, routeFetch())).rejects.toThrow("identity changed");
    expect(fixture.port.complete).not.toHaveBeenCalled();
  });

  it("reports failure, timeout and cancellation without a receipt", async () => {
    const binding = await selectedBinding();
    const input = requestInput(binding);
    fixture.port.complete.mockImplementationOnce(async (_request, verify) => {
      try {
        verify({ value: 1999, unit: "USD" });
      } catch { throw new AppleTransportError("invalid_output", "canonical_validation"); }
      return { value: { value: 1999, unit: "USD" }, context: {} };
    });
    await expect(runAppleInferenceDiagnostic(binding, "en-US", new AbortController().signal, routeFetch()))
      .rejects.toThrow("expected result");

    fixture.port.complete.mockRejectedValueOnce(new AppleTransportError("timeout"));
    const timedOut = await POST(request(diagnosticPath, input));
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toMatchObject({ ok: false, code: "timeout" });

    const controller = new AbortController();
    fixture.port.complete.mockImplementationOnce(async (input: AppleCompletionRequest, verify: (value: unknown) => unknown) => {
      controller.abort();
      expect(input.signal?.aborted).toBe(true);
      return {
        value: verify({ value: 2_000, unit: "USD" }),
        context: { inputTokens: 41, contextSize: 8_192, reservedOutputTokens: 128 }
      };
    });
    const cancelled = await POST(request(diagnosticPath, input, controller.signal));
    expect(await cancelled.json()).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("rejects a changed identity in an otherwise successful client receipt", async () => {
    const binding = await selectedBinding();
    const originalFetch = routeFetch();
    const fakeFetch: typeof fetch = async (path, init) => {
      const response = await originalFetch(path, init);
      const receipt = await response.json();
      return Response.json({ ...receipt, identity: { ...receipt.identity, osBuild: "forged" } });
    };
    await expect(runAppleInferenceDiagnostic(binding, "en-US", new AbortController().signal, fakeFetch))
      .rejects.toThrow("could not verify");
  });
});
