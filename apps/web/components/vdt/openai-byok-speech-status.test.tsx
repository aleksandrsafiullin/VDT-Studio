import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/speech/byok/route";
import { openAiSessionBindings } from "@/app/api/agent/runs/byok-bindings";
import { agentExecutionBindingRegistry } from "@/app/api/agent/runs/runtime";
import { activeSupervisorApiSpeechBinding } from "@/app/api/agent/runs/supervisor-runtime";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { checkOpenAiSpeechCredential, openAiSpeechCredentialTarget } from "@/lib/openai-byok-speech-client";
import { SpeechSettings } from "./speech-settings";
import type { VdtStudioState } from "./vdt-store";

const fixture = vi.hoisted(() => ({
  state: undefined as unknown,
  saved: true,
  head: { projectId: "project1", vdtId: "vdt1", activeRevisionId: "revision1", commitGeneration: 7, pendingRevisionId: null },
  fetch: vi.fn<typeof fetch>()
}));

vi.mock("./vdt-store", () => ({ useVdtStudioStore: Object.assign(
  (select: (state: unknown) => unknown) => select(fixture.state), { getState: () => fixture.state }
) }));
vi.mock("./api-key-storage", () => ({ useApiKeyStorage: (select: (state: { status: string }) => unknown) =>
  select({ status: fixture.saved ? "saved" : "empty" }) }));
vi.mock("@/app/api/vdt/storage-database", () => ({ openVdtStorageDatabase: () => ({
  getVdtRevisionHead: (vdtId: string) => vdtId === fixture.head.vdtId ? fixture.head : null, close() {}
}) }));
vi.mock("@/app/api/agent/runs/runtime", async () => {
  const { AgentExecutionBindingRegistry } = await import("@/app/api/agent/runs/execution-bindings");
  return { agentExecutionBindingRegistry: new AgentExecutionBindingRegistry(), agentRuntime: { store: {
    has: (id: string) => id === (fixture.state as VdtStudioState).agentRun?.runId,
    getSnapshot: () => (fixture.state as VdtStudioState).agentRun
  } } };
});

const activeRuns = (globalThis as typeof globalThis & { __vdtActiveSupervisorRuns: Map<string, unknown> }).__vdtActiveSupervisorRuns;
const state = () => fixture.state as VdtStudioState;
const button = /<button\b[^>]*>Check active OpenAI connection<\/button>/;
const fakeSecret = "synthetic-studio-key-fixture";
let bindingId = "";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
  vi.stubGlobal("fetch", fixture.fetch);
  fixture.fetch.mockReset();
  fixture.saved = true;
  bindingId = openAiSessionBindings(agentExecutionBindingRegistry).admit({ apiKey: fakeSecret, model: DEFAULT_EXECUTION_SETTINGS.model! },
    "sha256:" + "a".repeat(64)).bindingId;
  const { projectId, vdtId, activeRevisionId, commitGeneration } = fixture.head;
  fixture.state = {
    executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, apiKey: fakeSecret }, activeAgentRunId: "run1", workspace: {
      activeProjectId: projectId, activeVdtId: vdtId,
      draftRevisionBase: { projectId, vdtId, expectedHead: { activeRevisionId, commitGeneration } },
      projectSummaries: [{ project: { id: projectId }, vdts: [{ vdt: { id: vdtId }, head: fixture.head }] }]
    }, agentRun: { runId: "run1", status: "waiting_approval", request: { executionBindingId: bindingId, workspace: { projectId, vdtId } },
      workspaceRevision: { head: fixture.head }, events: [],
      executionSummary: { executionMode: "api_keys", backendId: "openai_compatible", modelId: DEFAULT_EXECUTION_SETTINGS.model } }
  };
  activeRuns.set("run1", { bindingDefinition: agentExecutionBindingRegistry.resolve(bindingId),
    supervisor: { binding: { sessionEpoch: 1 }, status: "waiting_approval" } });
});

afterEach(() => {
  activeRuns.delete("run1");
  openAiSessionBindings(agentExecutionBindingRegistry).consume(bindingId);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("renders an explicit presence check in Voice Input and uses the actual same-origin active route", async () => {
  const html = renderToStaticMarkup(<SpeechSettings />);
  expect(html).toMatch(button);
  expect(html).toContain("Separate OpenAI voice key");
  expect(html).toContain("Check separate voice key");
  expect(html).not.toContain("Generate with separate voice key");
  expect(html).toContain("Generate OpenAI sample · API usage");
  expect(html).toContain("This check reports credential presence.");
  expect(html).not.toContain("This uses your OpenAI API organization’s credits or paid balance.");
  expect(html).toContain("<dt>Realtime voice</dt><dd>Off</dd>");
  expect(html).toContain('data-testid="speech-download-button"');
  expect(html).not.toContain(fakeSecret);
  expect(fixture.fetch).not.toHaveBeenCalled();

  expect(activeSupervisorApiSpeechBinding("run1")).toMatchObject({ bindingId, directOpenAiCredentialPresent: true });
  const target = openAiSpeechCredentialTarget(state())!;
  const transport = vi.fn<typeof fetch>((path, options) => {
    const url = new URL(String(path), "http://127.0.0.1:37541");
    const headers = new Headers(options?.headers);
    headers.set("origin", url.origin);
    return POST(new Request(url, { ...options, headers }));
  });
  await expect(checkOpenAiSpeechCredential(target, new AbortController().signal, () => true, transport)).resolves.toBe(true);
  const [path, options] = transport.mock.calls[0]!;
  expect(path).toBe("/api/speech/byok");
  expect(options).toMatchObject({ credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store" });
  expect(JSON.parse(String(options?.body))).toEqual({ operation: "existing_credential_status", runId: "run1", analyticsBindingId: bindingId,
    scope: { projectId: "project1", vdtId: "vdt1", revisionId: "revision1", commitGeneration: 7 } });
  expect(options?.body).not.toContain(fakeSecret);

  activeRuns.delete("run1");
  await expect(checkOpenAiSpeechCredential(target, new AbortController().signal, () => true, transport)).resolves.toBe(false);
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it("stays off by default and outside the local app even with an eligible saved run", () => {
  vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "");
  const disabled = renderToStaticMarkup(<SpeechSettings />);
  expect(disabled).not.toMatch(button);
  expect(disabled).not.toContain("Separate OpenAI voice key");
  vi.stubEnv("NEXT_PUBLIC_VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "desktop");
  const desktop = renderToStaticMarkup(<SpeechSettings />);
  expect(desktop).toMatch(button);
  expect(desktop).not.toContain("Separate OpenAI voice key");
  vi.stubEnv("NEXT_PUBLIC_VDT_APP_MODE", "hosted_web");
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
});

it("keeps the check out of saved-key absence, Local, CLI, and stale saved VDT views", () => {
  fixture.saved = false;
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
  fixture.saved = true;
  const original = state();
  fixture.state = { ...original, executionSettings: { ...original.executionSettings, analyticalSourceChoice: "apple_manual" } };
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
  fixture.state = { ...original, executionSettings: { ...original.executionSettings, executionMode: "local_cli", localRunnerPresetId: "custom_cli_json",
    runnerProviderId: "cli_stub", selectedCliAgentId: "codex" } };
  const cli = renderToStaticMarkup(<SpeechSettings />);
  expect(cli).not.toMatch(button);
  expect(cli).toContain("Check installed Codex voice protocol");
  fixture.state = { ...original, activeAgentRunId: "different-run" };
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
  fixture.state = { ...original, executionSettings: { ...original.executionSettings, customizeBaseUrl: true, baseUrl: "https://proxy.test/v1" } };
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
  fixture.state = { ...original, executionSettings: { ...original.executionSettings, model: "another-model" } };
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
  fixture.state = { ...original, workspace: { ...original.workspace, draftRevisionBase: { ...original.workspace.draftRevisionBase!,
    expectedHead: { ...original.workspace.draftRevisionBase!.expectedHead, commitGeneration: 8 } } } };
  expect(renderToStaticMarkup(<SpeechSettings />)).not.toMatch(button);
});

it("refuses malformed responses, discarded scope, and late cancelled results", async () => {
  const target = openAiSpeechCredentialTarget(state())!;
  const status = { state: "existing_credential_status", present: true };
  const controller = new AbortController();
  let current = true;
  const port = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...status, credential: fakeSecret }))
    .mockImplementationOnce(async () => { current = false; return Response.json(status); })
    .mockImplementationOnce(async () => { controller.abort(); return Response.json(status); });
  await expect(checkOpenAiSpeechCredential(target, controller.signal, () => current, port)).rejects.toThrow();
  await expect(checkOpenAiSpeechCredential(target, controller.signal, () => current, port)).resolves.toBeUndefined();
  await expect(checkOpenAiSpeechCredential(target, controller.signal, () => true, port)).resolves.toBeUndefined();
  await expect(checkOpenAiSpeechCredential(target, controller.signal, () => true, port)).resolves.toBeUndefined();
  expect(port).toHaveBeenCalledTimes(3);
});
