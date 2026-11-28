import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexResumeCheckpointEngine, CodexResumeCheckpointTransport } from "@vdt-studio/model-bridge/node";
import { createVersionSnapshot, importProjectJson } from "@vdt-studio/vdt-core";
import { expect, it, vi } from "vitest";
import { VDT_CHECKPOINT_TURN_PROTOCOL_VERSION } from "../../../../../../packages/model-bridge/src/agent-engines/persistent-cli-checkpoint-canaries";

const bindingId = "codex_session_canary";
const projectId = "q03_terminal_project";
const vdtId = "q03_terminal_vdt";
const conversationId = "q03_terminal_conversation";
const modelId = "gpt-6.2-sol";
const cliVersion = "codex-cli 0.171.0-alpha.13.2";
const prompt = "Check what limits output and save a scenario called Recovery using 90 hours of downtime.";

function request(path: string, body?: object) {
  return new Request(new URL(path, "http://localhost:3000"), body ? {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)
  } : undefined);
}

async function payload(response: Response, status = 200) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body.error)).toBe(status);
  return body;
}

it("preserves released Codex canary tool receipts and a completed run on Cancel", async () => {
  const root = mkdtempSync(join(tmpdir(), "vdt-codex-terminal-"));
  const data = join(root, "data"), workspace = join(root, "workspace"), state = join(root, "state");
  for (const folder of [data, workspace, state]) mkdirSync(folder, {mode: 0o700});
  vi.resetModules();
  const detectSubscriptionCli = vi.fn(async (id: string) => ({
    id, installed: false, executable: null, version: null, alias: null
  }));
  const getSubscriptionCliAdapter = vi.fn(() => {
    throw new Error("The terminal fixture must not look up an ambient subscription adapter.");
  });
  const fetch = vi.fn(() => {
    throw new Error("The terminal fixture must not contact a provider.");
  });
  vi.doMock("@vdt-studio/model-bridge/node", async importOriginal => ({
    ...await importOriginal<typeof import("@vdt-studio/model-bridge/node")>(),
    detectSubscriptionCli,
    probeHarnessModels: getSubscriptionCliAdapter
  }));
  vi.doMock("@vdt-studio/model-bridge", async importOriginal => ({
    ...await importOriginal<typeof import("@vdt-studio/model-bridge")>(),
    getSubscriptionCliAdapter
  }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("__vdtExternalAgentEngines", new Map());
  vi.stubGlobal("__vdtClaudeCliCatalog", {
    executable: "/q03-ambient-claude-must-not-execute",
    version: "fixture",
    models: [{id: "q03_ambient_catalog_model"}],
    observedAt: Date.now()
  });
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_DATA_DIR", data);
  vi.stubEnv("VDT_CLI_SESSION_CANARY_ENABLED", "true");
  const globals = globalThis as typeof globalThis & {
    __vdtExternalAgentEngines: Map<string, CodexResumeCheckpointEngine>;
  };
  vi.stubGlobal("__vdtCliReasoningRegistrationVersion", 4);
  vi.stubGlobal("__vdtCliSessionRegistrationOutcomes", new Map([
    ["cursor", "absent"], ["claude", "absent"], ["codex", "registered"]
  ]));
  vi.stubGlobal("__vdtCliSessionRegistrationTimes", new Map(
    ["cursor", "claude", "codex"].map(name => [name, Date.now()])
  ));

  let runId: string | undefined;
  let dispose: (() => void) | undefined;
  let cancel: typeof import("./[runId]/cancel/route") | undefined;
  try {
    const [runs, snapshots, projects, vdts, reopen, runtime, persistence, supervisor] = await Promise.all([
      import("./route"), import("./[runId]/route"), import("../../vdt/projects/route"),
      import("../../vdt/projects/[projectId]/vdts/route"), import("../../vdt/vdts/[vdtId]/route"),
      import("./runtime"), import("./persistence"), import("./supervisor-runtime")
    ]);
    cancel = await import("./[runId]/cancel/route");
    const fixture = readFileSync("eval/agent-autonomy/assets/workspace-legacy-manual.v1.json", "utf8");
    const source = importProjectJson(fixture);
    const initial = createVersionSnapshot(source, {name: "Start of shift"}, {id: "start_of_shift", createdAt: source.createdAt});
    const created = await payload(await projects.POST(request("/api/vdt/projects", {id: projectId, name: initial.name})), 201);
    const runtimeState = created.summary.runtimeState;
    await payload(await vdts.POST(request("/api/vdt/projects/" + projectId + "/vdts", {
      schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: "q03-terminal",
      expectedRuntime: {schemaVersion: "project_runtime_cas.v1", runtimeGeneration: runtimeState.runtimeGeneration,
        generationVersion: runtimeState.generationVersion},
      vdt: {requestedVdtId: vdtId, name: initial.name, rootKpi: "Output", unit: "t", timePeriod: null, status: "draft", metadata: null},
      project: initial
    }), {params: Promise.resolve({projectId})}), 201);
    const db = persistence.openAgentRunPersistenceDatabase(process.cwd());
    try { db.createConversation({id: conversationId, projectId, vdtId}); } finally { db.close(); }

    let segments = 0;
    const scriptedTools = [
      {toolName: "run.propose_outcome", args: {outcome: "calculated_baseline", evidenceQuote: prompt, artifact: null}},
      {toolName: "scenario.save", args: {name: "Recovery", overrides: [{nodeId: "downtime", value: 90}]}},
      {toolName: "run.request_finish", args: {}}
    ];
    const transport = new CodexResumeCheckpointTransport({
      executable: "/q03-terminal-injected-runner", validatedCliVersion: cliVersion, runner: {
        async run(input) {
          const tool = scriptedTools[segments];
          let action: object;
          if (tool) {
            action = {type: "action_batch", batch: {calls: [{
              externalCallId: "q03-tool-" + segments, toolName: tool.toolName, argsJson: JSON.stringify(tool.args)
            }]}};
          } else {
            expect(segments).toBe(3);
            const receipt = [...input.stdin.matchAll(/"receiptId"\s*:\s*"([^"]+)"/gu)].at(-1)?.[1];
            expect(receipt).toBeTruthy();
            action = {type: "final", messageId: "q03-final", text: "Verified fixture.", finishReceiptId: receipt};
          }
          const assistantMessage = segments++ === 0 ? {messageId: "q03-intro", text: "I will check the saved model."} : null;
          const text = JSON.stringify({protocolVersion: VDT_CHECKPOINT_TURN_PROTOCOL_VERSION, assistantMessage, action});
          const stdout = [
            {type: "thread.started", thread_id: "q03-fixture-session"},
            {type: "turn.started"},
            {type: "item.completed", item: {id: "q03-output-" + segments, type: "agent_message", text}},
            {type: "turn.completed"}
          ].map(event => JSON.stringify(event)).join("\n");
          return {exitCode: 0, signal: null, stderr: "", stdout};
        }
      }
    });
    const engine = new CodexResumeCheckpointEngine({
      transport, cliVersion, toolCatalogHash: supervisor.currentModelAgentToolCatalogHash(),
      allowedToolNames: scriptedTools.map(tool => tool.toolName), enableUnverifiedCanary: true,
      sessionEnvironmentFactory: () => ({environmentId: "q03-fixture", privateWorkspacePath: workspace,
        privateStatePath: state, forbiddenRoots: persistence.resolveCliSessionForbiddenRoots()}),
      resolveBinding: async () => { throw new Error("Fixture only opens one session."); }
    });
    const capability = engine.capability;
    dispose = runtime.agentExecutionBindingRegistry.register({bindingId, enabled: true, modelId, capability,
      currentQualification: {engineAdapterId: capability.engineAdapterId, backendId: capability.backendId,
        cliVersion, protocolVersion: capability.protocolVersion, toolCatalogHash: capability.toolCatalogHash,
        platform: capability.qualification.platform}
    });
    globals.__vdtExternalAgentEngines.set(bindingId, engine);
    const vdtPath = "/api/vdt/vdts/" + vdtId;
    const current = await payload(await reopen.GET(request(vdtPath), {params: Promise.resolve({vdtId})}));
    const accepted = await payload(await runs.POST(request("/api/agent/runs", {
      executionBindingId: bindingId, conversationId, mode: "continue_project", outcomeSelection: "automatic",
      expectedExecution: {mode: "cli_subscription", profileVersion: 1, providerId: "codex_subscription", modelId, modelRevision: null},
      workspace: {projectId, vdtId, expectedRevision: {expectedActiveRevisionId: current.head.activeRevisionId,
        expectedActiveContentIdentity: current.head.activeContentIdentity, expectedCommitGeneration: current.head.commitGeneration,
        expectedRuntimeGeneration: current.runtimeState.runtimeGeneration, expectedGenerationVersion: current.runtimeState.generationVersion}},
      input: {project: current.activeProject, prompt, activeScenarioId: "baseline"},
      options: {autoApplyPatches: true, researchMode: "off"}
    })));
    runId = accepted.runId;
    const id = accepted.runId as string;
    await vi.waitFor(() => expect(supervisor.isStructuredModelAgentRunActive(id)).toBe(false), {timeout: 5_000});
    const runPath = "/api/agent/runs/" + id;
    const params = {params: Promise.resolve({runId: id})};
    const before = (await payload(await snapshots.GET(request(runPath), params))).snapshot;
    const events = await supervisor.getPersistedSupervisorEvents(id);
    const reply = await payload(await cancel.POST(request(runPath + "/cancel", {awaitTerminal: true}), params));
    const after = (await payload(await snapshots.GET(request(runPath), params))).snapshot;
    expect(detectSubscriptionCli).toHaveBeenCalledWith("claude");
    expect(getSubscriptionCliAdapter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(before.status).toBe("succeeded");
    expect(before.finishOutcome?.state).toBe("final_persisted");
    expect(segments).toBe(4);
    expect.soft(events).toEqual(expect.arrayContaining([
      expect.objectContaining({type: "tool_result", payload: expect.objectContaining({toolName: "scenario.save", resultCode: "OK"})}),
      expect.objectContaining({type: "tool_result", payload: expect.objectContaining({toolName: "run.request_finish", resultCode: "FINISH_VERIFIED"})})
    ]));
    expect.soft(reply.terminalCleanupConfirmed).toBe(true);
    expect(after.status).toBe("succeeded");
  } finally {
    if (runId && cancel) {
      const {isStructuredModelAgentRunActive} = await import("./supervisor-runtime");
      if (isStructuredModelAgentRunActive(runId)) {
        await cancel.POST(request("/api/agent/runs/" + runId + "/cancel", {awaitTerminal: true}), {params: Promise.resolve({runId})});
      }
    }
    globals.__vdtExternalAgentEngines?.delete(bindingId);
    dispose?.();
    vi.doUnmock("@vdt-studio/model-bridge/node");
    vi.doUnmock("@vdt-studio/model-bridge");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(root, {recursive: true, force: true});
  }
}, 15_000);
