import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AgentRunStore, AgentSupervisorToolGatewayLedger, ToolRegistry, VdtToolGateway,
  type AgentCapabilityProfile, type AgentSessionBinding, type AgentToolContext
} from "@vdt-studio/vdt-agent-runtime";
import { productionVolumeProject, VdtBuilderSession, type IncomingKpiBatchInput } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { GET as loadVdt } from "../../../vdt/vdts/[vdtId]/route";
import { GET as loadRevisions, POST as commitRevision } from "../../../vdt/vdts/[vdtId]/revisions/route";
import { createStorageWriteActor } from "../../../vdt/storage-write-adapter";
import { runtimeCasFromState, workspaceDraftBase, type StoredProjectSummary } from "@/lib/vdt-storage-client";
import { EDITOR_HANDOFF_TOOL_NAMES, registerEditorHandoffTools } from "../editor-handoff-tools";
import { createSqliteAgentRunPersistence } from "../persistence";
import { SqliteAgentSupervisorPersistence } from "../sqlite-supervisor-persistence";

const directory = process.env.VDT_DATA_DIR;
assert(directory);
const [mode, runId] = process.argv.slice(2);
const openDatabase = () => openVdtDatabase(directory, { dataDir: directory });
const projectId = "handoff_restart_project";
const vdtId = "handoff_restart_vdt";
const targetNodeId = "unplanned_downtime";
const baseUrl = `http://localhost:3000/api/vdt/vdts/${vdtId}`;
const params = { params: Promise.resolve({ vdtId }) };

async function readOffer(id: string) {
  const database = openDatabase();
  const authority = new SqliteAgentSupervisorPersistence(database.databasePath);
  try {
    const runs = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(database) });
    const artifacts = runs.getSnapshot(id).artifacts;
    const stored = await authority.load(id);
    assert(stored);
    return { artifacts, receipts: stored.toolOperationReceipts.filter((receipt) => receipt.state === "completed") };
  } finally {
    authority.close(); database.close();
  }
}

async function issueOffers() {
  const database = openDatabase();
  const authority = new SqliteAgentSupervisorPersistence(database.databasePath);
  try {
    const actor = createStorageWriteActor(projectId);
    database.createProject({ id: projectId, name: "Synthetic handoff restart" });
    const runtime = database.getProjectRuntimeState(projectId)!;
    const project = structuredClone(productionVolumeProject);
    project.scenarios = [{ ...project.scenarios[0]!, overrides: [] }];
    const saved = database.createVdtWithInitialSnapshot({
      actor,
      command: {
        schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId,
        expectedRuntimeGeneration: runtime.runtimeGeneration, expectedGenerationVersion: runtime.generationVersion,
        idempotencyKey: "handoff-initial",
        vdt: { requestedVdtId: vdtId, name: project.name, rootKpi: "Production Volume", unit: null,
          timePeriod: "month", status: "draft", metadata: null },
        revisionIntent: { source: "user", summary: "Initial handoff target", validation: null, calculation: null }
      },
      project
    });
    const head = database.getVdtRevisionHead(vdtId)!;
    const store = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(database) });
    const builder = new VdtBuilderSession({ project: database.readVdtRevision(saved.revision) });
    const run = store.createRun({
      providerId: "mock", mode: "continue_project", outcome: "answer", options: { autoApplyPatches: false },
      input: { project: builder.getProject(), selectedNodeId: targetNodeId },
      workspace: { projectId, vdtId, expectedRevision: {
        expectedActiveRevisionId: head.activeRevisionId,
        expectedActiveContentIdentity: head.activeContentIdentity,
        expectedCommitGeneration: head.commitGeneration,
        expectedRuntimeGeneration: runtime.runtimeGeneration,
        expectedGenerationVersion: runtime.generationVersion
      } }
    });
    store.updateRun(run.runId, { status: "running", builder, draftProject: builder.getProject() });
    const hash = `sha256:${"a".repeat(64)}` as const;
    const capability: AgentCapabilityProfile = {
      schemaVersion: 1, executionProfile: "model_agent", engineId: "test-model", engineAdapterId: "structured-test",
      backendId: "mock", protocolVersion: "model-turn.v1", sessionStrategy: "structured_turn",
      toolCatalogHash: hash, toolIsolation: "permission_only",
      qualification: { status: "unverified", platform: { os: "test", arch: "test", runtimeVersion: null },
        testedAt: null, evidenceHash: null },
      supportsNativeSession: false, supportsResume: true, supportsStructuredEvents: true,
      supportsToolBridge: true, supportsQuestions: true, supportsCancellation: true, supportsUsageMetrics: false, cli: null
    };
    const binding: AgentSessionBinding = {
      schemaVersion: 2, bindingId: "handoff-restart", runId: run.runId, projectId,
      executionProfile: capability.executionProfile, engineId: capability.engineId, engineAdapterId: capability.engineAdapterId,
      backendId: capability.backendId, modelId: "mock-model", protocolVersion: capability.protocolVersion, cliVersion: null,
      toolIsolation: capability.toolIsolation, qualificationStatus: capability.qualification.status, capabilityEvidenceHash: null,
      settingsHash: hash, capabilityProfileHash: hash, toolCatalogHash: hash, externalSessionId: null, sessionEpoch: 1,
      boundAt: new Date().toISOString()
    };
    await authority.createBinding(binding);
    const tools = new ToolRegistry();
    registerEditorHandoffTools(tools, openDatabase);
    const gateway = new VdtToolGateway({
      binding, capability, tools, allowedTools: new Set(EDITOR_HANDOFF_TOOL_NAMES),
      ledger: new AgentSupervisorToolGatewayLedger({ binding, persistence: authority, getRevision: () => builder.getRevision() }),
      toolContext: (): AgentToolContext => ({
        runId: run.runId, store, builder, signal: run.abortController.signal,
        getRun: () => store.getSnapshot(run.runId),
        emit: (event) => { store.appendEvent(run.runId, event); },
        updateRun: (patch) => { store.updateRun(run.runId, patch); }
      })
    });
    for (const toolName of EDITOR_HANDOFF_TOOL_NAMES) {
      const args = toolName === "data.open_file_import" || toolName === "vdt.open_suggested_kpis" ? { nodeId: targetNodeId } : {};
      const call = { externalCallId: toolName, toolName, args };
      const result = await gateway.execute(call);
      assert.equal(result.status, "succeeded", JSON.stringify(result));
      assert.deepEqual(await gateway.execute(call), JSON.parse(JSON.stringify(result)));
    }
    assert.deepEqual(database.getVdtRevisionHead(vdtId), head);
    store.updateRun(run.runId, { status: "succeeded" });
    return { runId: run.runId, head, ...(await readOffer(run.runId)) };
  } finally {
    authority.close(); database.close();
  }
}

async function smartCommit(id: string, loseResponse: boolean) {
  const prior = await readOffer(id);
  const storagePath = path.join(directory!, "synthetic-browser-journal.json");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: () => {
      try { return readFileSync(storagePath, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    setItem: (_key: string, value: string) => writeFileSync(storagePath, value)
  } });
  const { useVdtStudioStore: store } = await import("@/components/vdt/vdt-store");
  const posts: string[] = [];
  const committed: unknown[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), `/api/vdt/vdts/${vdtId}/revisions`);
    if (init?.method !== "POST") return loadRevisions(new Request(baseUrl, init), params);
    posts.push(String(init.body));
    const response = await commitRevision(new Request(baseUrl, init), params);
    committed.push(await response.clone().json());
    assert.equal(response.status, 201, JSON.stringify(committed.at(-1)));
    if (loseResponse) throw new Error("Lost response after the committed Smart revision.");
    return response;
  };
  let recovered: boolean | undefined;
  let staleSave: { status: number; body: unknown } | undefined;
  let operationId: string | undefined;
  if (loseResponse) {
    const saved = await (await loadVdt(new Request(baseUrl), params)).json() as {
      activeProject: typeof productionVolumeProject; summary: StoredProjectSummary
    };
    const project = saved.activeProject;
    store.setState({
      project, projectRevision: 1, selectedNodeId: targetNodeId, activeScenarioId: project.scenarios[0]!.id,
      workspace: { activePanel: "vdt", activeProjectId: projectId, activeVdtId: vdtId,
        projectSummaries: [saved.summary], isLoading: false, isMutating: false,
        draftRevisionBase: workspaceDraftBase(saved.summary.vdts[0]!.head, runtimeCasFromState(saved.summary.runtimeState)) },
      isGenerating: false, agentConnectionStatus: "idle"
    });
    const context = await store.getState().buildIncomingKpiContext(targetNodeId);
    const first = `m_${"1".repeat(32)}` as const;
    const second = `m_${"2".repeat(32)}` as const;
    const input: IncomingKpiBatchInput = { schemaVersion: "incoming_kpi_apply.v2", context, draft: {
      schemaVersion: "incoming_kpi_draft.v2", targetNodeId, contextHash: context.contextHash, revision: 0,
      source: { kind: "manual" }, childKeys: [], existingFactors: [], formulaAuthorship: "user",
      manualChildren: [
        { key: first, name: "Mechanical downtime", unit: "h/month", selected: true },
        { key: second, name: "Electrical downtime", unit: "h/month", selected: true }
      ], formula: `${first} + ${second}`, inputValues: { [first]: "30", [second]: "50" }
    } };
    const result = await store.getState().applySmartKpiSuggestion(input);
    assert.equal(result.ok, false, JSON.stringify(result));
    operationId = store.getState().smartKpiOperation?.id;
    assert(operationId, JSON.stringify(result));
  } else {
    await store.persist.rehydrate();
    operationId = store.getState().smartKpiOperation?.id;
    assert(operationId);
    recovered = await store.getState().reconcilePendingSmartKpiCommit();
    assert(recovered, JSON.stringify(store.getState().smartKpiMutation));
    const priorRequest = JSON.parse(posts[0]!);
    const response = await commitRevision(new Request(baseUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...priorRequest, idempotencyKey: "new-request-from-stale-head" })
    }), params);
    staleSave = { status: response.status, body: await response.json() };
  }
  const revisions = await (await loadRevisions(new Request(baseUrl), params)).json();
  return { operationId, posts, committed, recovered, staleSave, revisions, prior,
    editorNodeIds: store.getState().project.graph.nodes.map((node) => node.id), ...(await readOffer(id)) };
}

async function main() {
  if (mode === "issue") return issueOffers();
  assert(runId && (mode === "commit" || mode === "recover"));
  return smartCommit(runId, mode === "commit");
}

void main().then(
  (result) => process.stdout.write(JSON.stringify({ pid: process.pid, ...result })),
  (error: unknown) => { console.error(error); process.exitCode = 1; }
);
