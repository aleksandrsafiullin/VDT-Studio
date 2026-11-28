import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateGraph, calculateScenario, createVersionSnapshot, getExcelWorkbookCells, importProjectJson } from "@vdt-studio/vdt-core";
import { revisionCasFromHead, runtimeCasFromState } from "@/lib/vdt-storage-client";
import { openVdtDatabase } from "@vdt-studio/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadWorkspaceOracle, loadWorkspaceRequest } from "../../../../../../scripts/evaluate-agent-autonomy-workspace.mjs";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";

function request(path: string, body?: object) {
  return new Request(new URL(path, "http://localhost:3000"), body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
}

function workbookParts(bytes: Uint8Array) {
  const requireCoreDependency = createRequire(createRequire(import.meta.url).resolve("@vdt-studio/vdt-core"));
  const { unzipSync, strFromU8 } = requireCoreDependency("fflate") as {
    unzipSync(data: Uint8Array): Record<string, Uint8Array>;
    strFromU8(data: Uint8Array): string;
  };
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, part]) => [name, strFromU8(part)]));
}

function cell(sheet: string, address: string) {
  const content = sheet.match(new RegExp(`<c r="${address}"[^>]*>[\\s\\S]*?<\\/c>`))?.[0];
  expect(content, `Cell ${address}`).toBeDefined();
  return { value: Number(content?.match(/<v>(.*?)<\/v>/)?.[1]), formula: content?.match(/<f>(.*?)<\/f>/)?.[1] };
}

type Turn = { exchangeId: string; delta: { type: string; results?: Array<{
  status: string; toolName: string; resultCode: string; payload: { output?: Record<string, unknown>; receiptId?: string };
}> } };

const runPath = "/api/agent/runs";
const vdtPath = "/api/vdt/vdts";
const caseId = "VDT-professional";

describe("Q02 professional workspace, generated through the public routes", { timeout: 90_000 }, () => {
  let temp: string;
  beforeAll(() => {
    temp = mkdtempSync(join(tmpdir(), "vdt-q02-professional-"));
    vi.resetModules();
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", temp);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    if (temp) rmSync(temp, { recursive: true, force: true });
  });

  it.each(["en", "ru"])("retains the manual winner and issues the exact Recovery workbook (%s)", async locale => {
    const [runs, runtime, supervisor, messages, revisionRoute, vdtRoute, workbookRoute] = await Promise.all([
      import("./route"), import("./runtime"), import("./supervisor-runtime"), import("./[runId]/messages/route"),
      import("../../vdt/vdts/[vdtId]/revisions/route"), import("../../vdt/vdts/[vdtId]/route"),
      import("./[runId]/excel-workbook/route")
    ]);
    const db = openVdtDatabase(process.cwd(), { dataDir: temp });
    const projectId = `q02_professional_${locale}`, vdtId = `q02_production_${locale}`;
    const bindingId = `q02_mock_${locale}`;
    const conversationId = `q02_conversation_${locale}`;
    const dispose = runtime.agentExecutionBindingRegistry.register({
      bindingId, enabled: true, modelId: "q02-structured-fixture",
      capability: {
        schemaVersion: 1, executionProfile: "model_agent", engineId: "in-product-model-agent",
        engineAdapterId: "q02-structured-fixture", backendId: "openai_compatible", protocolVersion: "structured-turn-v1",
        sessionStrategy: "structured_turn", toolCatalogHash: supervisor.currentModelAgentToolCatalogHash(),
        toolIsolation: "permission_only",
        qualification: { status: "unverified", platform: { os: "test", arch: "test", runtimeVersion: "node-test" }, testedAt: null, evidenceHash: null },
        supportsNativeSession: false, supportsResume: false, supportsStructuredEvents: true, supportsToolBridge: true,
        supportsQuestions: true, supportsCancellation: true, supportsUsageMetrics: false, cli: null
      },
      modelEngineAdapter: { providerId: "openai_compatible", providerConfig: {
        baseUrl: "https://q02-workspace.example.test/v1", apiKey: "synthetic-request-only"
      } }
    });
    const activeIds: string[] = [];
    let providerError: unknown;
    const routeParams = { params: Promise.resolve({ vdtId }) };
    const currentHead = () => db.getVdtRevisionHead(vdtId)!;
    const saved = () => db.readVdtRevision(db.getVdtRevision(currentHead().activeRevisionId!)!);
    const runParams = (runId: string) => ({ params: Promise.resolve({ runId }) });
    const tool = (turnId: string, toolName: string, args: object = {}) => ({
      type: "action_batch", batch: { calls: [{ externalCallId: `${turnId}:call`, toolName, args }] }
    });
    const finish = (turnId: string, receiptId?: string) => {
      expect(receiptId).toBeTruthy();
      return { type: "final", messageId: `${turnId}:result`, finishReceiptId: receiptId, text: "Completed the verified workspace operation." };
    };
    const useModel = (prompt: string, choose: (turn: Turn) => object) => {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, init) => {
        try {
          expect(String(url)).toBe("https://q02-workspace.example.test/v1/chat/completions");
          const { messages } = JSON.parse(String(init?.body));
          const turn = JSON.parse(messages.filter(({ role }: { role: string }) => role === "user").at(-1).content) as Turn;
          if (turn.delta.type === "initial_context") expect(JSON.stringify(turn)).toContain(prompt);
          const output = { turnId: turn.exchangeId, sessionState: "Q02 controlled checkpoint", assistantMessage: null, action: choose(turn) };
          return Response.json({ choices: [{ message: { content: JSON.stringify(output) } }] });
        } catch (error) { providerError = error; throw error; }
      }));
    };
    async function start(prompt: string) {
      const head = currentHead();
      const authority = db.getProjectRuntimeState(projectId)!;
      const response = await runs.POST(request(runPath, {
        executionBindingId: bindingId, conversationId, mode: "continue_project", outcomeSelection: "automatic",
        workspace: { projectId, vdtId, expectedRevision: {
          expectedActiveRevisionId: head.activeRevisionId, expectedActiveContentIdentity: head.activeContentIdentity,
          expectedCommitGeneration: head.commitGeneration, expectedRuntimeGeneration: authority.runtimeGeneration,
          expectedGenerationVersion: authority.generationVersion
        } }, input: { project: saved(), prompt, activeScenarioId: "baseline" },
        options: { autoApplyPatches: true, researchMode: "off" }
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      const runId = body.runId as string;
      activeIds.push(runId);
      return runId;
    }
    async function waitFor(runId: string, status: string) {
      await vi.waitFor(() => {
        if (providerError) throw providerError;
        const state = runtime.agentRuntime.store.getState(runId);
        expect(state.status, JSON.stringify(state.error)).toBe(status);
      }, { timeout: 12_000, interval: 40 });
      return runtime.agentRuntime.store.getState(runId);
    }

    try {
      const publicCase = await loadWorkspaceRequest(caseId, locale);
      const oracle = await loadWorkspaceOracle(caseId);
      const [recoveryPrompt, restorePrompt, exportPrompt] = publicCase.turns.map(({ prompt }: { prompt: string }) => prompt);
      const source = importProjectJson(readFileSync(join(process.cwd(), "eval/agent-autonomy", publicCase.setup.fixture), "utf8"));
      const initial = createVersionSnapshot(source, { name: "Start of shift" }, { id: "start_of_shift", createdAt: source.createdAt });
      db.createProject({ id: projectId, name: initial.name });
      const storageRuntime = db.getProjectRuntimeState(projectId)!;
      const initialSaved = db.createVdtWithInitialSnapshot({
        actor: createStorageWriteActor(projectId, { env: { VDT_APP_MODE: "development_web" } }),
        command: {
          schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId, expectedRuntimeGeneration: storageRuntime.runtimeGeneration,
          expectedGenerationVersion: storageRuntime.generationVersion, idempotencyKey: "initial-professional",
          vdt: { requestedVdtId: vdtId, name: initial.name, rootKpi: "Output", unit: "t", timePeriod: null, status: "draft", metadata: null },
          revisionIntent: { source: "user", summary: "Start of shift", validation: null, calculation: null }
        }, project: JSON.parse(JSON.stringify(initial))
      });
      db.createConversation({ id: conversationId, projectId, vdtId });
      expect(calculateGraph(saved()).rootValue).toBe(oracle.checkpoints.baseline.root);

      useModel(recoveryPrompt, ({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return tool(exchangeId, "run.propose_outcome", {
          outcome: "structural_model", evidenceQuote: recoveryPrompt, artifact: null
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return tool(exchangeId, "scenario.list");
        if (result?.toolName === "scenario.list") return tool(exchangeId, "scenario.save", {
          name: "Recovery", overrides: [{ nodeId: "downtime", value: 90 }]
        });
        if (result?.toolName === "scenario.save") return tool(exchangeId, "scenario.compare", {
          scenarioId: saved().scenarios.find(scenario => scenario.name === "Recovery")?.id
        });
        if (result?.toolName === "scenario.compare") return tool(exchangeId, "run.request_finish");
        return finish(exchangeId, result?.payload.receiptId);
      });
      const recoveryRun = await start(recoveryPrompt);
      await waitFor(recoveryRun, "succeeded");
      const withRecovery = saved();
      const recovery = withRecovery.scenarios.find(scenario => scenario.name === "Recovery")!;
      expect(calculateScenario(withRecovery, recovery).scenarioValue).toBe(oracle.checkpoints.recovery.scenario.result);

      useModel(restorePrompt, ({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return tool(exchangeId, "run.propose_outcome", {
          outcome: "structural_model", evidenceQuote: restorePrompt, artifact: null
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return tool(exchangeId, "version.list");
        if (result?.toolName === "version.list") return tool(exchangeId, "version.edit", { kind: "restore", versionId: "start_of_shift" });
        return { type: "question", messageId: `${exchangeId}:q`, questionSetId: `${exchangeId}:qs`,
          questions: [{ id: "reconcile", question: "Which saved revision should I inspect?", required: true, expectedAnswerType: "text" }] };
      });
      const restoreRun = await start(restorePrompt);
      const waiting = await waitFor(restoreRun, "waiting_approval");
      const proposal = waiting.pendingMutationProposal!;
      const before = currentHead();
      const corrected = structuredClone(saved());
      const downtime = corrected.graph.nodes.find(node => node.id === "downtime")!;
      downtime.value = downtime.baselineValue = 110;
      const manual = await revisionRoute.POST(request(`${vdtPath}/${vdtId}/revisions`, {
        schemaVersion: "manual_vdt_revision_commit_request.v1", idempotencyKey: "manual-100-to-110",
        expectedHead: revisionCasFromHead(before),
        expectedRuntime: runtimeCasFromState(db.getProjectRuntimeState(projectId)!),
        summary: "Correct actual downtime from 100 h to 110 h", project: corrected
      }), routeParams);
      expect(manual.status, await manual.clone().text()).toBe(201);
      const manuallySavedHead = currentHead().activeRevisionId;
      expect(manuallySavedHead).not.toBe(before.activeRevisionId);
      const approval = await messages.POST(request(`${runPath}/${restoreRun}/messages`, {
        type: "approval", approved: true, proposalId: proposal.id, selectedChangeIds: proposal.selectedChangeIds,
        expectedProposal: { runId: restoreRun, projectId, vdtId, proposalId: proposal.id, baseRevisionId: before.activeRevisionId, baseRevision: proposal.baseRevision }
      }), runParams(restoreRun));
      const approvalBody = await approval.json();
      const approvalEvents = await supervisor.getPersistedSupervisorEvents(restoreRun);
      const controlReceipt = approvalEvents.find(event => event.type === "tool_result"
        && event.payload.toolName === "control.apply_approved_proposal");
      const rejectedProof = JSON.stringify({ approvalBody, controlReceipt });
      expect(rejectedProof).toMatch(/STALE_REVISION|AGENT_INTERACTION_STALE/u);
      expect(currentHead().activeRevisionId).toBe(manuallySavedHead);
      expect(calculateGraph(saved()).rootValue).toBe(oracle.checkpoints.final.root);
      await supervisor.cancelStructuredModelAgentRun(restoreRun, true);
      const reopen = await vdtRoute.GET(request(`${vdtPath}/${vdtId}`), routeParams);
      expect(reopen.status).toBe(200);
      const reopened = await reopen.json();
      expect(reopened.activeRevision.id).toBe(manuallySavedHead);
      expect(calculateGraph(reopened.activeProject).rootValue).toBe(oracle.checkpoints.final.root);
      const revisionsBeforeExport = db.listVdtRevisions(vdtId).length;

      useModel(exportPrompt, ({ exchangeId, delta }) => {
        if (delta.type === "initial_context") return tool(exchangeId, "run.propose_outcome", {
          outcome: "structural_model", evidenceQuote: exportPrompt, artifact: { kind: "excel_workbook", scenarioName: "Recovery" }
        });
        const result = delta.results?.at(-1);
        if (result?.toolName === "run.propose_outcome") return tool(exchangeId, "version.edit", { kind: "save", name: "Recovery review" });
        if (result?.toolName === "version.edit") return tool(exchangeId, "export.excel");
        if (result?.toolName === "export.excel") return tool(exchangeId, "run.request_finish");
        return finish(exchangeId, result?.payload.receiptId);
      });
      const exportRun = await start(exportPrompt);
      const completed = await waitFor(exportRun, "succeeded");
      expect(completed.request.input.activeScenarioId).toBe("baseline");
      const descriptor = completed.artifacts?.find(artifact => artifact.type === "excel_workbook")?.payload as {
        id: string; revisionId: string; scenarioId: string; filename: string; downloadUrl: string;
      };
      expect(descriptor).toMatchObject({ revisionId: currentHead().activeRevisionId, scenarioId: recovery.id });
      expect(db.getAgentRun(exportRun)?.publicSnapshot?.artifacts).toContainEqual(expect.objectContaining({
        runId: exportRun, type: "excel_workbook", id: descriptor.id, payload: descriptor
      }));
      const finalReopen = await vdtRoute.GET(request(`${vdtPath}/${vdtId}`), routeParams);
      expect(finalReopen.status).toBe(200);
      const finalSnapshot = await finalReopen.json();
      expect(finalSnapshot.activeRevision.id).toBe(descriptor.revisionId);
      expect(finalSnapshot.revisions).toHaveLength(revisionsBeforeExport + 1);
      const finalProject = finalSnapshot.activeProject as ReturnType<typeof saved>;
      expect(finalProject.versions.filter(version => version.name === oracle.checkpoints.final.version)).toHaveLength(1);
      expect(calculateGraph(finalProject).rootValue).toBe(oracle.checkpoints.final.root);
      expect(calculateScenario(finalProject, recovery).scenarioValue).toBe(oracle.checkpoints.final.scenario.result);
      const download = await workbookRoute.GET(request(descriptor.downloadUrl), runParams(exportRun));
      expect(download.status).toBe(200);
      const bytes = new Uint8Array(await download.arrayBuffer());
      const parts = workbookParts(bytes);
      const mapping = getExcelWorkbookCells(finalProject, { scenarioId: recovery.id });
      const root = mapping.tree[finalProject.rootNodeId]!;
      const baselineCell = cell(parts["xl/worksheets/sheet1.xml"]!, root.baselineCell);
      const recoveryCell = cell(parts["xl/worksheets/sheet1.xml"]!, root.potentialCell);
      const sourceCell = cell(parts["xl/worksheets/sheet3.xml"]!, mapping.source.downtime!.valueCell);
      expect(baselineCell).toMatchObject({ value: oracle.checkpoints.final.root, formula: expect.any(String) });
      expect(recoveryCell).toMatchObject({ value: oracle.checkpoints.final.scenario.result, formula: expect.any(String) });
      expect(sourceCell).toEqual({ value: oracle.checkpoints.final.roles.downtime, formula: undefined });

      const evidence = process.env.VDT_Q02_EVIDENCE_DIR;
      if (evidence) {
        mkdirSync(evidence, { recursive: true });
        const workbook = `recovery-${locale}.xlsx`;
        writeFileSync(join(evidence, workbook), bytes);
        writeFileSync(join(evidence, `professional-${locale}.json`), JSON.stringify({
          caseId, locale, conversationId, runIds: { recovery: recoveryRun, restore: restoreRun, export: exportRun }, prompts: [recoveryPrompt, restorePrompt, exportPrompt], provider: "controlled synthetic responses",
          initialHead: initialSaved.revision.id, approvalBasis: { proposalId: proposal.id, builderRevision: proposal.baseRevision, revisionId: before.activeRevisionId },
          manualWinner: manuallySavedHead, approvalStatus: approval.status, approvalResult: rejectedProof.match(/STALE_REVISION|AGENT_INTERACTION_STALE/u)?.[0],
          finalHead: descriptor.revisionId, baselineScenarioId: completed.request.input.activeScenarioId,
          recoveryScenarioId: descriptor.scenarioId, namedVersion: finalProject.versions.find(version => version.name === "Recovery review")?.id,
          reopenedStatus: { corrected: reopen.status, final: finalReopen.status }, workbook, artifact: descriptor,
          workbookSha256: createHash("sha256").update(bytes).digest("hex"),
          cells: { baseline: { address: root.baselineCell, ...baselineCell }, recovery: { address: root.potentialCell, ...recoveryCell },
            source: { address: mapping.source.downtime!.valueCell, ...sourceCell } }
        }, null, 2) + "\n");
      }
    } finally {
      try {
        for (const runId of activeIds) if (supervisor.isStructuredModelAgentRunActive(runId)) await supervisor.cancelStructuredModelAgentRun(runId, true);
      } finally {
        dispose();
        db.close();
        vi.unstubAllGlobals();

      }
    }
  });
});
