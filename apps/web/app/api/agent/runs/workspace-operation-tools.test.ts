import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  AgentRunStore, AgentSupervisorToolGatewayLedger, InMemoryAgentSupervisorPersistence,
  ToolRegistry, VdtToolGateway, applyPendingMutationProposal, rejectPendingMutationProposal,
  type AgentCapabilityProfile, type AgentSessionBinding, type AgentToolContext, type VdtAgentStartRequest
} from "@vdt-studio/vdt-agent-runtime";
import { createExcelWorkbook, getExcelWorkbookCells, EXCEL_MIME_TYPE, VdtBuilderSession, productionVolumeProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { describe, expect, it, vi } from "vitest";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";
import { createSqliteAgentRunPersistence } from "./persistence";
import { namedVersionWorkbookDelivery, registerWorkspaceOperationTools, requestedExcelScenarioId, requestedVersionRestoreId, verifyRequestedExcelDelivery, WORKSPACE_OPERATION_TOOL_NAMES } from "./workspace-operation-tools";
import { registerEditorHandoffTools, EDITOR_HANDOFF_TOOL_NAMES } from "./editor-handoff-tools";
import { describeExcelWorkbook } from "./excel-workbook";
import { GET as downloadExcel } from "./[runId]/excel-workbook/route";

const now = "2026-11-24T00:00:00.000Z";
const projectId = "workspace_operations";
const vdtId = "production_model";
const downtime = "unplanned_downtime";
const hash = `sha256:${"a".repeat(64)}` as const;
const initial = structuredClone(productionVolumeProject);
const inputValues = new Map([
  ["calendar_time", 1000], ["planned_downtime", 0], [downtime, 100],
  ["nominal_rate", 2], ["yield_factor", 1]
]);
for (const node of initial.graph.nodes) {
  if (inputValues.has(node.id)) node.baselineValue = inputValues.get(node.id);
}
initial.scenarios = [{ ...initial.scenarios[0]!, overrides: [] }];

describe("workspace operations at the Gateway", () => {
  it("pins only an explicit single restore for an existing version ID", () => {
    const id = "version_operation_edit_saved";
    const versions = [{ id, name: "Checkpoint", projectSnapshot: initial, createdAt: now }];
    expect(requestedVersionRestoreId(versions, "Please restore my saved version “Checkpoint” (version ID " + id + ").")).toBe(id);
    expect(requestedVersionRestoreId(versions, "Explain how to restore the saved version ID " + id + ".")).toBeUndefined();
    expect(requestedVersionRestoreId(versions, "Restore my saved version ID " + id + " and then save another version.")).toBeUndefined();
    expect(requestedVersionRestoreId(versions, "Restore the version ID missing.")).toBeUndefined();
  });

  it("uses names scoped to Excel wording and prioritizes exact names over qualifiers", () => {
    const scenarios = [
      { id: "recovery", name: "Recovery" },
      { id: "recovery_scenario", name: "Recovery scenario" },
      { id: "q4", name: "Recovery, Q4" },
      { id: "resume", name: "Résumé" }
    ].map((scenario) => ({ ...initial.scenarios[0]!, ...scenario }));
    expect(requestedExcelScenarioId(scenarios, "Save a version called “Excel workbook for Recovery.” and give me the workbook.")).toBeUndefined();
    expect(requestedExcelScenarioId(scenarios, "Save a version called Excel workbook for Recovery.")).toBeUndefined();
    expect(requestedExcelScenarioId(scenarios, "Give me the Excel workbook for Recovery scenario.")).toBe("recovery_scenario");
    expect(requestedExcelScenarioId(scenarios, "Give me the Excel workbook for “Recovery, Q4”.")).toBe("q4");
    expect(requestedExcelScenarioId(scenarios, "Export the scenario “RÉSUMÉ” to an editable Excel workbook.")).toBe("resume");
    expect(requestedExcelScenarioId(scenarios, "Give me the Excel workbook for the active scenario.")).toBeUndefined();
    expect(() => requestedExcelScenarioId(scenarios, "Give me a workbook for Recovery and a workbook for “Recovery, Q4”."))
      .toThrow(expect.objectContaining({ code: "EXCEL_SCENARIO_AMBIGUOUS" }));
    expect(() => requestedExcelScenarioId([...scenarios, { ...scenarios[0]!, id: "recovery_copy" }], "Give me the workbook for Recovery."))
      .toThrow(expect.objectContaining({ code: "EXCEL_SCENARIO_AMBIGUOUS" }));
  });

  it("saves scenario and version changes, replays calls and exports the matching immutable head", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "vdt-workspace-tool-test-"));
    const openDatabase = () => openVdtDatabase(directory, { dataDir: directory });
    const database = openDatabase();
    try {
      const actor = createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } });
      database.createProject({ id: projectId, name: "Mine" });
      const runtime = database.getProjectRuntimeState(projectId)!;
      const seeded = database.createVdtWithInitialSnapshot({
        actor,
        command: {
          schemaVersion: "create_vdt_with_initial_snapshot.v1",
          projectId,
          expectedRuntimeGeneration: runtime.runtimeGeneration,
          expectedGenerationVersion: runtime.generationVersion,
          idempotencyKey: "initial-manual",
          vdt: { requestedVdtId: vdtId, name: initial.name, rootKpi: "Production Volume", unit: null,
            timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Initial saved model", validation: null, calculation: null }
        },
        project: initial
      });
      const builder = new VdtBuilderSession({ project: database.readVdtRevision(seeded.revision), now: () => now });
      const store = new AgentRunStore({ persistence: createSqliteAgentRunPersistence(database, { actorFactory: () => actor }) });
      async function openRun(prompt?: string, artifactIntent?: VdtAgentStartRequest["artifactIntent"], automatic = false) {
        const head = database.getVdtRevisionHead(vdtId)!;
        const run = store.createRun({
          ...(automatic ? { outcomeSelection: "automatic", outcome: "answer", artifactIntent } as const : {}),
          providerId: "mock", mode: "continue_project", options: { autoApplyPatches: true },
          input: { project: builder.getProject(), selectedNodeId: downtime, activeScenarioId: initial.scenarios[0]!.id, ...(prompt ? { prompt } : {}) },
          workspace: { projectId, vdtId, expectedRevision: {
            expectedActiveRevisionId: head.activeRevisionId,
            expectedActiveContentIdentity: head.activeContentIdentity,
            expectedCommitGeneration: head.commitGeneration,
            expectedRuntimeGeneration: runtime.runtimeGeneration,
            expectedGenerationVersion: runtime.generationVersion
          } }
        });
        store.updateRun(run.runId, { status: "running", builder, draftProject: builder.getProject() });
        const context = (): AgentToolContext => ({
          runId: run.runId, store, builder, signal: run.abortController.signal,
          getRun: () => store.getSnapshot(run.runId),
          emit: (event) => { store.appendEvent(run.runId, event); },
          updateRun: (patch) => { store.updateRun(run.runId, patch); }
        });
        const capability: AgentCapabilityProfile = {
          schemaVersion: 1, executionProfile: "model_agent", engineId: "test-model", engineAdapterId: "structured-test",
          backendId: "mock", protocolVersion: "model-turn.v1", sessionStrategy: "structured_turn",
          toolCatalogHash: hash, toolIsolation: "permission_only",
          qualification: { status: "unverified", platform: { os: "test", arch: "test", runtimeVersion: null },
            testedAt: null, evidenceHash: null },
          supportsNativeSession: false, supportsResume: true, supportsStructuredEvents: true, supportsToolBridge: true,
          supportsQuestions: true, supportsCancellation: true, supportsUsageMetrics: false, cli: null
        };
        const binding: AgentSessionBinding = {
          schemaVersion: 2, bindingId: `workspace-tools-${run.runId}`, runId: run.runId, projectId,
          executionProfile: capability.executionProfile, engineId: capability.engineId, engineAdapterId: capability.engineAdapterId,
          backendId: capability.backendId, modelId: "mock-model", protocolVersion: capability.protocolVersion, cliVersion: null,
          toolIsolation: capability.toolIsolation, qualificationStatus: capability.qualification.status, capabilityEvidenceHash: null,
          settingsHash: hash, capabilityProfileHash: hash, toolCatalogHash: hash, externalSessionId: null, sessionEpoch: 1, boundAt: now
        };
        const tools = new ToolRegistry();
        registerWorkspaceOperationTools(tools, openDatabase);
        registerEditorHandoffTools(tools, openDatabase);
        const persistence = new InMemoryAgentSupervisorPersistence();
        await persistence.createBinding(binding);
        const ledger = new AgentSupervisorToolGatewayLedger({ binding, persistence, getRevision: () => builder.getRevision() });
        const makeGateway = () => new VdtToolGateway({
          binding, capability, ledger, tools, toolContext: context,
          allowedTools: new Set([...WORKSPACE_OPERATION_TOOL_NAMES, ...EDITOR_HANDOFF_TOOL_NAMES]),
          now: () => now
        });
        const gateway = makeGateway();
        const call = (externalCallId: string, toolName: string, args: Record<string, unknown> = {}) =>
          gateway.execute({ externalCallId, toolName, args });
        return { head, run, context, gateway, makeGateway, call };
      }
      const { head, run, context, gateway, makeGateway, call } = await openRun();

      expect(await call("list", "scenario.list")).toMatchObject({
        status: "succeeded", payload: { output: { activeScenarioId: initial.scenarios[0]?.id,
          selectedNodeId: downtime, savedRevisionId: head.activeRevisionId } }
      });
      const saveScenario = { name: "Recovery", overrides: [{ nodeId: downtime, value: 90 }] };
      expect(await call("create", "scenario.save", saveScenario))
        .toMatchObject({ status: "succeeded", payload: { output: { operationId: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
      const scenarioId = builder.getProject().scenarios.at(-1)!.id;
      const comparisonHead = database.getVdtRevisionHead(vdtId)!.activeRevisionId;
      expect(await call("create-new-call-id", "scenario.save", saveScenario)).toMatchObject({
        status: "succeeded", payload: { projectChanged: false, output: { savedRevisionId: comparisonHead, result: { scenarioId } } }
      });
      expect(database.getVdtRevisionHead(vdtId)!.activeRevisionId).toBe(comparisonHead);
      expect(await call("compare", "scenario.compare", { scenarioId })).toMatchObject({
        status: "succeeded", payload: { projectChanged: false, output: { savedRevisionId: comparisonHead, result: {
          baselineValue: 1800, scenarioValue: 1820, absoluteChange: 20
        } } }
      });

      const combinedPrompt = "Save the current model as a version called Recovery review and give me an editable Excel workbook for Recovery.";
      store.appendChatMessage(run.runId, { role: "user", kind: "instruction", text: combinedPrompt });
      const delivery = () => namedVersionWorkbookDelivery(store.getSnapshot(run.runId), builder.getProject(), builder.getRevision());
      expect(delivery()).toEqual({ versionName: "Recovery review", nextTool: "version.edit" });
      const save = { externalCallId: "save", toolName: "version.edit", args: { kind: "save", name: "Recovery review" } };
      const saved = await gateway.execute(save);
      expect(saved).toMatchObject({ status: "succeeded" });
      expect(await makeGateway().execute(save)).toEqual(saved);
      const version = builder.getProject().versions.at(-1)!;
      expect(version.projectSnapshot.scenarios.at(-1)?.id).toBe(scenarioId);
      expect(delivery()?.nextTool).toBe("export.excel");

      const exportCall = { externalCallId: "export", toolName: "export.excel", args: { scenarioId } };
      const workbook = await gateway.execute(exportCall);
      const revisionId = database.getVdtRevisionHead(vdtId)!.activeRevisionId;
      expect(workbook).toMatchObject({ status: "succeeded", payload: { projectChanged: false, output: {
        savedRevisionId: revisionId, artifact: { kind: "excel_workbook", scenarioId, revisionId }
      } } });
      expect(await makeGateway().execute(exportCall)).toEqual(workbook);
      expect(database.getAgentRun(run.runId)?.publicSnapshot?.artifacts).toEqual(store.getSnapshot(run.runId).artifacts);
      expect(store.getSnapshot(run.runId).artifacts).toHaveLength(1);
      expect(delivery()?.nextTool).toBe("run.request_finish");

      // Exercise both sealed Q01 prompts without editing their wording or feeding the oracle to a provider.
      const requests = JSON.parse(readFileSync(path.resolve("eval/agent-autonomy/workspace-requests.v2.json"), "utf8"));
      const workbookRequests = requests.cases.find((request: { id: string }) => request.id === "REV-03-workbook");
      const verify = (id: string) => verifyRequestedExcelDelivery(store.getState(id), builder.getProject(), openDatabase);
      const replayIssuedWorkbooks: Array<() => Promise<void>> = [];
      vi.stubEnv("VDT_APP_MODE", "development_web");
      vi.stubEnv("VDT_DATA_DIR", directory);
      for (const locale of ["en", "ru"]) {
        const [delivery, discussion] = workbookRequests.variants[locale].turns;
        const admitted = await openRun(delivery.prompt, { kind: "excel_workbook", scenarioName: "Recovery", scenarioId }, true);
        const runId = admitted.run.runId;
        expect(verify(runId)).toMatchObject({ blocker: { code: "EXCEL_REQUESTED_ARTIFACT_MISSING" } });
        expect(await admitted.call("wrong-target", "export.excel", { scenarioId: initial.scenarios[0]!.id }))
          .toMatchObject({ resultCode: "EXCEL_SCENARIO_CONFLICT" });
        const scope = { runId, projectId, vdtId, revisionId, scenarioId };
        const unissued = describeExcelWorkbook(database, scope);
        const url = new URL(unissued.downloadUrl, "https://localhost:3000");
        const params = { params: Promise.resolve({ runId }) };
        const download = () => downloadExcel(new Request(url, { headers: { origin: url.origin } }), params);
        expect(await download()).toMatchObject({ status: 404 });
        const old = describeExcelWorkbook(database, { ...scope, revisionId: comparisonHead });
        for (const wrong of [old, describeExcelWorkbook(database, { ...scope, scenarioId: initial.scenarios[0]!.id }),
          { ...unissued, downloadUrl: "/unverified" }]) {
          store.updateRun(runId, { artifacts: [{ runId, id: wrong.id, type: "excel_workbook", payload: wrong, summary: wrong.filename, createdAt: now }] });
          expect(verify(runId)).toMatchObject({ blocker: { code: "EXCEL_REQUESTED_ARTIFACT_MISSING" } });
        }
        store.updateRun(runId, { artifacts: [] });
        const submit = { externalCallId: "deliver", toolName: "export.excel", args: {} };
        const exported = await admitted.gateway.execute(submit);
        expect(exported).toMatchObject({ status: "succeeded", payload: { projectChanged: false, output: { artifact: unissued } } });
        expect(await admitted.makeGateway().execute(submit)).toEqual(exported);
        expect(verify(runId)).toEqual({ artifact: unissued });
        replayIssuedWorkbooks.push(async () => {
          expect(verify(runId)).toMatchObject({ blocker: { code: "EXCEL_REQUESTED_ARTIFACT_MISSING" } });
          expect(await admitted.makeGateway().execute(submit)).toEqual(exported);
          expect((await download()).status).toBe(200);
        });
        const response = await download();
        expect(response.status).toBe(200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const savedProject = database.readVdtRevision(database.getVdtRevision(revisionId!)!);
        expect(bytes).toEqual(createExcelWorkbook(savedProject, scenarioId));
        const requireCoreDependency = createRequire(createRequire(import.meta.url).resolve("@vdt-studio/vdt-core"));
        const { unzipSync, strFromU8 } = requireCoreDependency("fflate") as { unzipSync(data: Uint8Array): Record<string, Uint8Array>; strFromU8(data: Uint8Array): string };
        const sheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet1.xml"]!);
        const mapping = getExcelWorkbookCells(savedProject, { scenarioId });
        const rootCells = mapping.tree[savedProject.rootNodeId]!;
        for (const [address, value] of [[rootCells.baselineCell, 1800], [rootCells.potentialCell, 1820]]) {
          expect(sheet.match(new RegExp(`<c r="${address}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0]).toContain(`<v>${value}</v>`);
        }
        const discuss = await openRun(discussion.prompt, undefined, true);
        expect(verify(discuss.run.runId)).toBeUndefined();
      }
      const historical = await openRun(`Export Recovery from revision ${comparisonHead}.`,
        { kind: "excel_workbook", scenarioName: "Recovery", revisionId: comparisonHead! }, true);
      expect(await historical.call("old-pinned", "export.excel")).toMatchObject({
        status: "succeeded", payload: { output: { artifact: { revisionId: comparisonHead, scenarioId } } }
      });
      expect(verify(historical.run.runId)).toMatchObject({ artifact: { revisionId: comparisonHead, scenarioId } });
      const missingTarget = await openRun("Export Missing.", { kind: "excel_workbook", scenarioName: "Missing" }, true);
      expect(await missingTarget.call("missing-target", "export.excel"))
        .toMatchObject({ resultCode: "EXCEL_SCENARIO_UNAVAILABLE" });

      const recovery = await openRun(combinedPrompt);
      const newInstruction = { role: "user", kind: "instruction", text: combinedPrompt } as const;
      store.appendChatMessage(recovery.run.runId, newInstruction);
      expect(namedVersionWorkbookDelivery(recovery.context().getRun(), builder.getProject(), builder.getRevision())?.nextTool)
        .toBe("version.edit");
      const recoveryCall = { externalCallId: "export-recovery", toolName: "export.excel", args: {} };
      const recoveryWorkbook = await recovery.gateway.execute(recoveryCall);
      expect(recoveryWorkbook).toMatchObject({ status: "succeeded", payload: { projectChanged: false, output: {
        savedRevisionId: revisionId, artifact: { kind: "excel_workbook", scenarioId, revisionId }
      } } });
      expect(await recovery.makeGateway().execute(recoveryCall)).toEqual(recoveryWorkbook);
      expect(await recovery.call("export-conflicting-id", "export.excel", { scenarioId: initial.scenarios[0]!.id }))
        .toMatchObject({ status: "failed", resultCode: "EXCEL_SCENARIO_CONFLICT" });
      expect(await recovery.call("export-conflicting-name", "export.excel", { scenarioName: initial.scenarios[0]!.name }))
        .toMatchObject({ status: "failed", resultCode: "EXCEL_SCENARIO_CONFLICT" });
      expect(store.getSnapshot(recovery.run.runId).artifacts).toHaveLength(1);
      const fallback = await openRun("Save the current model as a version named Recovery and give me an editable Excel workbook for the team.");
      expect(await fallback.call("export-active", "export.excel"))
        .toMatchObject({ status: "succeeded", payload: { output: { artifact: { scenarioId: initial.scenarios[0]!.id } } } });
      expect(await fallback.call("export-by-name", "export.excel", { scenarioName: "Recovery" }))
        .toMatchObject({ status: "succeeded", payload: { output: { artifact: { scenarioId } } } });
      store.appendChatMessage(fallback.run.runId, { role: "user", kind: "instruction", text: "Give me the Excel workbook for Recovery." });
      store.appendChatMessage(fallback.run.runId, { role: "assistant", kind: "assistant_message", text: "Give me the Excel workbook for Baseline." });
      expect(await fallback.call("export-current-instruction", "export.excel"))
        .toMatchObject({ status: "succeeded", payload: { output: { artifact: { scenarioId } } } });
      store.appendChatMessage(fallback.run.runId, { role: "user", kind: "instruction", text: "Now give me an Excel workbook for the currently selected scenario." });
      expect(await fallback.call("export-current-selection", "export.excel"))
        .toMatchObject({ status: "succeeded", payload: { output: { artifact: { scenarioId: initial.scenarios[0]!.id } } } });
      const ambiguous = await openRun(`Give me an Excel workbook for Recovery or ${initial.scenarios[0]!.name}.`);
      expect(await ambiguous.call("export-ambiguous", "export.excel"))
        .toMatchObject({ status: "failed", resultCode: "EXCEL_SCENARIO_AMBIGUOUS" });
      expect(store.getSnapshot(ambiguous.run.runId).artifacts ?? []).toHaveLength(0);
      const unavailable = await openRun("Give me an Excel workbook for the scenario named Missing.");
      expect(await unavailable.call("export-missing-scenario", "export.excel"))
        .toMatchObject({ status: "failed", resultCode: "EXCEL_SCENARIO_UNAVAILABLE" });

      const artifact = store.getSnapshot(recovery.run.runId).artifacts![0]!.payload as { downloadUrl: string };
      vi.stubEnv("VDT_APP_MODE", "development_web");
      vi.stubEnv("VDT_DATA_DIR", directory);
      const downloadUrl = new URL(artifact.downloadUrl, "https://localhost:3000");
      const params = { params: Promise.resolve({ runId: recovery.run.runId }) };
      const file = await downloadExcel(new Request(downloadUrl, { headers: { origin: downloadUrl.origin } }), params);
      expect(file.status).toBe(200);
      expect(file.headers.get("Content-Type")).toBe(EXCEL_MIME_TYPE);
      const revision = database.getVdtRevision(revisionId!)!;
      const project = database.readVdtRevision(revision);
      const bytes = new Uint8Array(await file.arrayBuffer());
      expect(bytes).toEqual(createExcelWorkbook(project, scenarioId));
      expect(bytes).not.toEqual(createExcelWorkbook(project, initial.scenarios[0]!.id));
      downloadUrl.searchParams.set("scenarioId", initial.scenarios[0]!.id);
      expect(await downloadExcel(new Request(downloadUrl, { headers: { origin: downloadUrl.origin } }), params))
        .toMatchObject({ status: 404 });
      expect(await call("smart-handoff", "vdt.open_suggested_kpis", { nodeId: downtime })).toMatchObject({
        status: "succeeded", payload: { projectChanged: false, output: { action: "suggested_kpis", status: "user_action_available" } }
      });
      const projectLink = { externalCallId: "workspace-handoff", toolName: "project.open_workspace", args: {} };
      const offered = await gateway.execute(projectLink);
      expect(offered.status).toBe("succeeded");
      expect(await makeGateway().execute(projectLink)).toEqual(offered);
      expect(await call("file-handoff", "data.open_file_import", { nodeId: downtime })).toMatchObject({ status: "succeeded" });
      expect(await call("export-handoff", "vdt.open_export_formats", {})).toMatchObject({
        status: "succeeded", payload: { projectChanged: false, output: { action: "vdt_export", status: "user_action_available" } }
      });
      expect(await call("invalid-handoff", "vdt.open_suggested_kpis", { nodeId: initial.rootNodeId }))
        .toMatchObject({ status: "failed", resultCode: "SUGGESTED_KPI_NOT_AVAILABLE" });
      expect(store.getSnapshot(run.runId).artifacts?.filter(item => item.type === "editor_handoff").map(item => item.payload)).toEqual([
        { action: "suggested_kpis", projectId, vdtId, revisionId, nodeId: downtime },
        { action: "project_workspace", projectId, vdtId, revisionId },
        { action: "file_import", projectId, vdtId, revisionId, nodeId: downtime },
        { action: "vdt_export", projectId, vdtId, revisionId }
      ]);
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(revisionId);


      expect(await call("delete", "scenario.edit", { kind: "delete", scenarioId })).toMatchObject({
        status: "waiting_approval", payload: { output: { status: "approval_required", proposalId: expect.any(String) } }
      });
      rejectPendingMutationProposal(context(), "Keep Recovery.");
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(revisionId);
      expect(builder.getProject().scenarios.some(scenario => scenario.id === scenarioId)).toBe(true);

      expect(await call("restore", "version.edit", { kind: "restore", versionId: version.id }))
        .toMatchObject({ status: "waiting_approval" });
      builder.updateNode({ nodeId: downtime, patch: { baselineValue: 95 } });
      expect(() => applyPendingMutationProposal(context())).toThrow(expect.objectContaining({ code: "STALE_REVISION" }));
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).toBe(revisionId);
      store.updateRun(run.runId, { status: "running", pendingMutationProposal: undefined });
      expect(delivery()?.nextTool).toBe("version.edit");
      expect(await call("export-unsaved", "export.excel", { scenarioId })).toMatchObject({
        status: "failed", resultCode: "EXCEL_SAVED_REVISION_REQUIRED"
      });
      expect(store.getSnapshot(run.runId).artifacts?.filter(item => item.type === "excel_workbook")).toHaveLength(1);
      const savedHead = database.getVdtRevisionHead(vdtId)!;
      const activeRuntime = database.getProjectRuntimeState(projectId)!;
      database.commitVdtRevision({
        projectId, vdtId, actor, project: builder.getProject(),
        command: {
          schemaVersion: "revision_commit.v2",
          expectedActiveRevisionId: savedHead.activeRevisionId,
          expectedActiveContentIdentity: savedHead.activeContentIdentity,
          expectedCommitGeneration: savedHead.commitGeneration,
          expectedRuntimeGeneration: activeRuntime.runtimeGeneration,
          expectedGenerationVersion: activeRuntime.generationVersion,
          idempotencyKey: "manual-corrected-head",
          intent: { source: "user", summary: "Save manual correction", validation: null, calculation: null }
        }
      });
      expect(database.getVdtRevisionHead(vdtId)?.activeRevisionId).not.toBe(revisionId);
      for (const replay of replayIssuedWorkbooks) await replay();
    } finally {
      vi.unstubAllEnvs();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
