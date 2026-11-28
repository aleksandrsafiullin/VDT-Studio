import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CodexSpeechCapabilityResult, CodexSubscriptionSpeechStatus, requestCodexSpeechCapability } from "./codex-subscription-speech-status";
import { SpeechSettings } from "./speech-settings";

const activeProvider = vi.hoisted(() => ({ id: "codex" as "codex" | "claude" }));
vi.mock("./vdt-store", async () => {
  const { DEFAULT_EXECUTION_SETTINGS } = await import("@/lib/execution-mode-catalog");
  const executionSettings = () => ({ ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli" as const,
    localRunnerPresetId: "custom_cli_json" as const, runnerProviderId: "cli_stub" as const, selectedCliAgentId: activeProvider.id });
  return { useVdtStudioStore: (select: (state: { executionSettings: ReturnType<typeof executionSettings> }) => unknown) =>
    select({ executionSettings: executionSettings() }) };
});

const protocol = { surface: "experimental", cliVersion: "0.171.0-alpha.13.2", buildFingerprint: "a".repeat(64) } as const;
const result = { scope: "installed_codex_cli", protocol, accountVoiceAvailability: "unknown" } as const;

afterEach(() => { activeProvider.id = "codex"; vi.unstubAllEnvs(); });

it("renders an explicit diagnostic and keeps local choices visible", () => {
  const html = renderToStaticMarkup(<CodexSubscriptionSpeechStatus isCurrent={() => true} />);
  expect(html).toContain("Check installed Codex voice protocol");
  expect(html).toContain("Whisper or Apple Speech when available");
  expect(html).not.toContain("Start voice");
});

it("offers the check through Voice Input only for the selected local Codex connection", () => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
  const selected = renderToStaticMarkup(<SpeechSettings />);
  expect(selected).toContain("Check installed Codex voice protocol");
  expect(selected).toContain("<dt>Realtime voice</dt><dd>Off</dd>");
  expect(selected).toContain('data-testid="speech-download-button"');
  activeProvider.id = "claude";
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toContain("Check installed Codex voice protocol");
  activeProvider.id = "codex";
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toContain("Check installed Codex voice protocol");
});

it("distinguishes current experimental and unknown local protocol evidence from account availability", () => {
  const experimental = renderToStaticMarkup(<CodexSpeechCapabilityResult protocol={protocol} />);
  expect(experimental).toContain("Experimental voice protocol in Codex 0.171.0-alpha.13.2.");
  expect(experimental).toContain("Account voice availability is unknown.");
  const unknown = renderToStaticMarkup(<CodexSpeechCapabilityResult protocol={{ surface: "unknown", cliVersion: null, buildFingerprint: null }} />);
  expect(unknown).toContain("Installed Codex voice protocol unknown.");
  expect(unknown).toContain("Account voice availability is unknown.");
});

it("sends only installed protocol scope and rejects forged response scope or account availability", async () => {
  const signal = new AbortController().signal;
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json(result))
    .mockResolvedValueOnce(Response.json({ ...result, scope: "another_connection" }))
    .mockResolvedValueOnce(Response.json({ ...result, accountVoiceAvailability: "included" }));
  await expect(requestCodexSpeechCapability(signal, () => true, fetch)).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledWith("/api/speech/subscription-capability", expect.objectContaining({
    method: "POST", signal, body: '{"scope":"installed_codex_cli"}'
  }));
  await expect(requestCodexSpeechCapability(signal, () => true, fetch)).rejects.toThrow();
  await expect(requestCodexSpeechCapability(signal, () => true, fetch)).rejects.toThrow();
});

it("drops a late response for a changed selection or cancelled check even when transport responds", async () => {
  let isCurrent = true;
  const controller = new AbortController();
  const port = vi.fn<typeof fetch>().mockImplementationOnce(async () => {
    isCurrent = false;
    return Response.json(result);
  }).mockImplementationOnce(async () => {
    controller.abort();
    return Response.json(result);
  });
  await expect(requestCodexSpeechCapability(controller.signal, () => isCurrent, port)).resolves.toBeUndefined();
  await expect(requestCodexSpeechCapability(controller.signal, () => true, port)).resolves.toBeUndefined();
  expect(port).toHaveBeenCalledTimes(2);
});
