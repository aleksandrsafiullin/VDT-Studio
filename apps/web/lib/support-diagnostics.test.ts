import { afterEach, describe, expect, it, vi } from "vitest";
import { useVdtStudioStore, type VdtStudioState } from "@/components/vdt/vdt-store";
import { applyLocalRunnerPreset, DEFAULT_EXECUTION_SETTINGS } from "./execution-mode-catalog";
import { updateSmartKpiPreferences } from "./smart-kpi-settings";
import { modelReasoningKey } from "@vdt-studio/ai-harness/browser";
import { compiledSupportBuildInfo, createSupportReport, sanitizeSupportBuildInfo, supportReportFilename } from "./support-diagnostics";
import { clearSupportErrors, readSupportErrors, recordSupportError, supportGuidance } from "./support-error-events";

const now = new Date("2026-11-13T10:30:00.000Z");
const runId = "a29153c4-77ba-4424-ac13-b23120b08923";
const revisionId = "84346bd4-b8d3-47f4-bb71-94418b8f6419";
const build = sanitizeSupportBuildInfo({ version: "0.1.0-alpha.2", commit: "a".repeat(40), dirty: false,
  builtAt: now.toISOString(), platform: "win32", architecture: "x64", nodeVersion: "v24.15.0" });

function source(): VdtStudioState {
  return { ...useVdtStudioStore.getInitialState(), executionSettings: { ...DEFAULT_EXECUTION_SETTINGS, useMockProvider: false, gatewayPresetId: "openai-default", model: "gpt-5-nano" } };
}

afterEach(() => { clearSupportErrors(); vi.unstubAllEnvs(); });

describe("reviewable support diagnostics", () => {
  it("exports only allowed runtime fields even when every surrounding object carries private content", () => {
    const state = source();
    state.executionSettings = { ...state.executionSettings, apiKey: "sk-secret-do-not-share", baseUrl: "https://private.example/tenant?token=abc", command: "/Users/person/private-command", argsText: "--token very-secret" };
    state.providerConfig = { apiKey: "legacy-secret-do-not-share", localApiKey: "local-secret-do-not-share" };
    state.runnerPairingToken = "pairing-secret-do-not-share";
    state.agentRun = {
      runId, status: "recovery_required", createdAt: now.toISOString(), updatedAt: now.toISOString(),
      error: { code: "MODEL_AGENT_RECOVERY_REQUIRED", message: "private prompt /Users/person/account.xlsx sk-secret-do-not-share" },
      request: { prompt: "Private business instructions" }, draftProject: { name: "Private project", rootValue: 987654321 },
      chatMessages: [{ text: "Private user conversation" }],
      executionSummary: { externalSessionId: "private-session-id" }
    } as unknown as NonNullable<VdtStudioState["agentRun"]>;
    state.agentEvents = [{ id: "event-1", runId, seq: 1, phase: "building_graph", type: "error", timestamp: now.toISOString(), metadata: { code: "PROVIDER_UNAVAILABLE", request: "private-request-body" },
      message: "sensitive failure", title: "Secret source workbook" }] as VdtStudioState["agentEvents"];
    state.workspace = { ...state.workspace, error: "private storage path", lastSavedAt: now.toISOString(), draftRevisionBase: {
      projectId: "Private project identity", vdtId: "Private tree identity", expectedHead: { activeRevisionId: revisionId, commitGeneration: 8 }
    } as VdtStudioState["workspace"]["draftRevisionBase"] };
    const report = createSupportReport(state, build, "desktop", now);
    const json = JSON.stringify(report);
    for (const forbidden of ["sk-secret", "legacy-secret", "local-secret", "pairing-secret", "private.example", "/Users/", "private-command", "very-secret",
      "Private business", "Private project", "Private tree", "Private user", "private-session", "private-request", "sensitive failure", "Secret source", "987654321"]) expect(json).not.toContain(forbidden);
    expect(report.build).toEqual(build);
    expect(report.run).toMatchObject({ id: runId, status: "recovery_required" });
    expect(report.revision).toEqual({ id: revisionId, generation: 8, savedAt: now.toISOString() });
    expect(report.recentErrors.map(item => item.code)).toEqual(["PROVIDER_UNAVAILABLE", "MODEL_AGENT_RECOVERY_REQUIRED", "STORAGE_REQUEST_FAILED"]);
    expect(report.execution.chat).toEqual({ backend: "openai_compatible", model: "omitted", reasoning: null });
  });

  it.each(["private/budget.xlsx", "corp.example", "internal-project-name", "opaqueUnknownCredential123"])("omits arbitrary names in both selections by default: %s", model => {
    const state = source();
    state.executionSettings.model = model;
    state.executionSettings.smartKpiBySource = updateSmartKpiPreferences(state.executionSettings, { model: `smart-${model}` });
    const report = createSupportReport(state, build, "desktop", now);
    expect(report.modelNames).toBe("omitted");
    expect(report.execution.chat.model).toBe("omitted");
    expect(report.execution.suggestedKpi.model).toBe("omitted");
    expect(JSON.stringify(report)).not.toContain(model);
  });

  it.each(["/Users/person/model.gguf", "C:\\Users\\person\\model.gguf", "https://private.example/model", "sk-example-private", "ghp_example-private", "ns/ghp_example-private", "xoxb-example-private", "AIza" + "a".repeat(35), "AKIA" + "A".repeat(16), "gpt-5\nprivate text", "..", "plain-secret-value"])("omits unsafe or credential-valued model identity: %s", model => {
    const state = source();
    state.executionSettings.model = model;
    state.executionSettings.apiKey = "plain-secret-value";
    state.executionSettings.smartKpiBySource = updateSmartKpiPreferences(state.executionSettings, { model });
    const report = createSupportReport(state, build, "desktop", now, { includeModelNames: true });
    expect(report.execution.chat.model).toBe("omitted");
    expect(report.execution.suggestedKpi.model).toBe("omitted");
  });

  it("preserves safe namespaced/local model identifiers and explicit reasoning", () => {
    const state = source();
    state.executionSettings = { ...applyLocalRunnerPreset(DEFAULT_EXECUTION_SETTINGS, "ollama_openai"), localModel: "Qwen/Qwen3:32b" };
    const key = modelReasoningKey("local_runner", { backendId: "ollama", model: "Qwen/Qwen3:32b", runnerUrl: "http://127.0.0.1:8765" });
    state.executionSettings.modelReasoningBySource = { [key]: false };
    state.executionSettings.smartKpiBySource = updateSmartKpiPreferences(state.executionSettings, { model: "corp.example" });
    const report = createSupportReport(state, build, "desktop", now, { includeModelNames: true });
    expect(report.modelNames).toBe("explicitly_included_when_eligible");
    expect(report.execution.chat).toEqual({ backend: "ollama", model: "Qwen/Qwen3:32b", reasoning: false });
    expect(report.execution.suggestedKpi.model).toBe("corp.example");
  });

  it("drops arbitrary identifiers, statuses and error text instead of merely truncating them", () => {
    const state = source();
    state.agentRun = { runId: "/Users/person/private", status: "private status", error: { code: "PRIVATE_TOKEN_VALUE", message: "private body" },
      createdAt: "private timestamp", updatedAt: now.toISOString() } as unknown as NonNullable<VdtStudioState["agentRun"]>;
    const report = createSupportReport(state, build, "desktop", now);
    expect(report.run).toMatchObject({ id: null, status: "unknown", createdAt: null });
    expect(report.recentErrors).toEqual([{ code: "UNCLASSIFIED_ERROR", at: now.toISOString() }]);
    expect(JSON.stringify(report)).not.toContain("private");
  });

  it("keeps only bounded sanitized error codes in memory and returns detached snapshots", () => {
    for (let i = 0; i < 30; i++) recordSupportError(i === 29 ? "Bearer confidential-token" : "DATA_PARSER_LIMIT", new Date(now.getTime() + i));
    const events = readSupportErrors();
    expect(events).toHaveLength(20);
    expect(events.at(-1)?.code).toBe("UNCLASSIFIED_ERROR");
    events[0]!.code = "private-mutated-value";
    expect(readSupportErrors()[0]!.code).toBe("DATA_PARSER_LIMIT");
    const report = createSupportReport(source(), build, "desktop", now);
    expect(report.recentErrors).toHaveLength(20);
    expect(JSON.stringify(report)).not.toContain("confidential-token");
    expect(supportGuidance("DATA_PARSER_LIMIT")).toContain("compact table");
    clearSupportErrors();
    expect(readSupportErrors()).toEqual([]);
  });

  it("marks absent build identity unknown and rejects contaminated identity fields", () => {
    expect(sanitizeSupportBuildInfo({ version: "private version", commit: "/Users/private", platform: "private-host", architecture: "my-laptop", dirty: "false", nodeVersion: "24.0.0 secret", builtAt: "today", secret: "must not survive" })).toEqual({
      version: null, commit: null, platform: "unknown", architecture: "unknown", osRelease: null, dirty: null, nodeVersion: null, builtAt: null
    });
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_VERSION", "0.1.0-alpha.2");
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_COMMIT", "b".repeat(40));
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_DIRTY", "true");
    vi.stubEnv("NEXT_PUBLIC_VDT_BUILD_TIME", now.toISOString());
    expect(compiledSupportBuildInfo()).toMatchObject({ version: "0.1.0-alpha.2", commit: "b".repeat(40), dirty: true, builtAt: now.toISOString() });
    expect(supportReportFilename(createSupportReport(source(), build, "desktop", now))).toBe("vdt-diagnostics-2026-11-13T10-30-00-000Z.json");
  });
});
