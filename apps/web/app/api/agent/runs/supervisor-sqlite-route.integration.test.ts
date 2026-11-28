import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { openVdtDatabase } from "@vdt-studio/storage";
import { AgentRunEventOutbox, type AgentSessionBinding, type VdtAgentOutcome } from "@vdt-studio/vdt-agent-runtime";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-supervisor-route-"));

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("public Model Agent route with a persistent run store", { timeout: 60_000 }, () => {
  it("uses normalized Sequence 4 authority and retains the legacy run projection", async () => {
    vi.resetModules();
    vi.stubEnv("VDT_APP_MODE", "development_web");
    vi.stubEnv("VDT_DATA_DIR", dataDir);
    const [{ POST }, runtime, supervisorRuntime] = await Promise.all([
      import("./route"),
      import("./runtime"),
      import("./supervisor-runtime")
    ]);
    const toolCatalogHash = supervisorRuntime.currentModelAgentToolCatalogHash();
    const bindingId = `sqlite_route_binding_${Date.now()}`;
    const dispose = runtime.agentExecutionBindingRegistry.register({
      bindingId,
      enabled: true,
      modelId: "server-owned-test-model",
      capability: {
        schemaVersion: 1,
        executionProfile: "model_agent",
        engineId: "in-product-model-agent",
        engineAdapterId: "sqlite-route-test-v1",
        backendId: "openai_compatible",
        protocolVersion: "structured-turn-v1",
        sessionStrategy: "structured_turn",
        toolCatalogHash,
        toolIsolation: "permission_only",
        qualification: {
          status: "unverified",
          platform: { os: "test", arch: "test", runtimeVersion: "node-test" },
          testedAt: null,
          evidenceHash: null
        },
        supportsNativeSession: false,
        supportsResume: false,
        supportsStructuredEvents: true,
        supportsToolBridge: true,
        supportsQuestions: true,
        supportsCancellation: true,
        supportsUsageMetrics: false,
        cli: null
      },
      modelEngineAdapter: {
        providerId: "openai_compatible",
        providerConfig: {
          baseUrl: "https://models.example.test/v1",
          apiKey: "test-secret"
        }
      }
    });
    const fetchFixture = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const requestBody = String(init?.body ?? "");
      const isReopenedQuestion = requestBody.includes("What output scope did we agree?");
      const answer = requestBody.includes("saleable tonnes") ? "The agreed output is saleable tonnes." : "Output scope is unspecified.";
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          turnId: "turn-1",
          sessionState: "Goal: build Ore hauled VDT. Pending: confirm the reporting period.",
          assistantMessage: {
            messageId: "message-1",
            text: isReopenedQuestion ? answer : "The persistent Model Agent session is ready. Old formula = legacy_mined_tonnes."
          },
          action: {
            type: "question",
            messageId: "question-message-1",
            questionSetId: "question-set-1",
            questions: [{
              id: "period",
              question: "Which reporting period should be used?",
              reason: "The model needs one time basis.",
              required: true,
              expectedAnswerType: "text"
            }]
          }
        }) } }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchFixture);

    let startedRunId: string | undefined;
    try {
      const scope = {
        projectId: "route_conversation_project",
        vdtId: "route_conversation_vdt",
        conversationId: "route_conversation"
      };
      const database = openVdtDatabase(process.cwd(), { dataDir });
      try {
        const projectId = database.createProject({ id: scope.projectId, name: "Mine" }).id;
        const conversationVdt = database.createVdt({ id: scope.vdtId, projectId, name: "Ore", rootKpi: "Ore" });
        const otherVdt = database.createVdt({ id: "route_other_vdt", projectId, name: "Waste", rootKpi: "Waste" });
        const conversation = database.createConversation({ id: scope.conversationId, projectId, vdtId: conversationVdt.id });
        const denied = await POST(new Request("http://localhost:3000/api/agent/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "continue_project",
            input: { prompt: "Continue this conversation." },
            workspace: { projectId, vdtId: otherVdt.id },
            conversationId: conversation.id,
            executionBindingId: bindingId
          })
        }));
        expect(denied.status).toBe(404);
        expect(await denied.json()).toMatchObject({ error: { code: "VDT_NOT_FOUND" } });
        expect(database.listAgentRuns(projectId)).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        database.close();
      }
      const response = await POST(new Request("http://localhost:3000/api/agent/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "generate_vdt",
          input: { rootKpi: "Ore hauled", prompt: "Define output as saleable tonnes." },
          workspace: { projectId: scope.projectId, vdtId: scope.vdtId },
          conversationId: scope.conversationId,
          executionBindingId: bindingId
        })
      }));
      const body = await response.json() as { ok: boolean; runId: string };
      startedRunId = body.runId;
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(runtime.hasSqliteAgentRunPersistence(runtime.agentRuntime.store)).toBe(true);
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = runtime.agentRuntime.store.getState(body.runId);
        if (state.status === "needs_user_input" && (state.pendingQuestions?.length ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(runtime.agentRuntime.store.getState(body.runId)).toMatchObject({
        status: "needs_user_input",
        pendingQuestions: [expect.objectContaining({ id: "period" })]
      });

      const db = new DatabaseSync(path.join(dataDir, "app.sqlite"));
      try {
        db.exec("PRAGMA foreign_keys = ON;");
        expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 5 });
        expect(db.prepare("SELECT conversation_id, vdt_id FROM agent_runs WHERE id = ?").get(body.runId)).toEqual({
          conversation_id: scope.conversationId, vdt_id: scope.vdtId
        });
        expect(db.prepare(`
          SELECT binding.project_id AS binding_project_id,
                 run.project_id AS run_project_id,
                 binding.session_epoch AS initial_epoch
          FROM agent_session_bindings_v2 binding
          JOIN agent_runs run ON run.id = binding.run_id
          WHERE binding.run_id = ?
        `).get(body.runId)).toEqual({
          binding_project_id: scope.projectId,
          run_project_id: scope.projectId,
          initial_epoch: 1
        });
        const normalizedCounts = db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM agent_session_epochs_v2 WHERE run_id = ?) AS epochs,
            (SELECT COUNT(*) FROM agent_engine_checkpoints_v2 WHERE run_id = ?) AS checkpoints,
            (SELECT COUNT(*) FROM agent_run_event_outbox_v2 WHERE run_id = ?) AS events
        `).get(body.runId, body.runId, body.runId) as {
          epochs: number;
          checkpoints: number;
          events: number;
        };
        expect(normalizedCounts.epochs).toBe(1);
        expect(normalizedCounts.checkpoints).toBeGreaterThanOrEqual(1);
        expect(normalizedCounts.events).toBeGreaterThanOrEqual(3);
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        const legacy = db.prepare(`
          SELECT internal_state_json FROM agent_runs WHERE id = ?
        `).get(body.runId) as { internal_state_json: string };
        expect(JSON.parse(legacy.internal_state_json)).toMatchObject({
          supervisorPersistenceV2: {
            schemaVersion: 2,
            binding: { runId: body.runId }
          }
        });
      } finally {
        db.close();
      }

      const { GET: getRun } = await import("./[runId]/route");
      const { POST: sendMessage } = await import("./[runId]/messages/route");
      const get = (runId: string) => getRun(new Request(`http://localhost:3000/api/agent/runs/${runId}`), {
        params: Promise.resolve({ runId })
      });
      const switchBinding = `${bindingId}_switched`;
      const disposeSwitched = runtime.agentExecutionBindingRegistry.register({
        ...runtime.agentExecutionBindingRegistry.resolve(bindingId),
        bindingId: switchBinding,
        modelId: "switched-test-model"
      });
      let continuedRun: string | undefined;
      try {
        await supervisorRuntime.cancelStructuredModelAgentRun(body.runId, true);
        expect(await (await get(body.runId)).json()).toMatchObject({
          snapshot: { request: { conversationId: scope.conversationId }, status: "cancelled" }
        });
        const currentProject = openVdtDatabase(process.cwd(), { dataDir });
        try {
          currentProject.saveVdtRevision({
            id: "route_user_revision",
            projectId: scope.projectId,
            vdtId: scope.vdtId,
            revisionNo: 1,
            source: "user",
            project: productionVolumeProject
          });
        } finally {
          currentProject.close();
        }
        const start = async (prompt: string, conversationId?: string, priorConversationRunId?: string, outcome?: VdtAgentOutcome) => {
          const result = await POST(new Request("http://localhost:3000/api/agent/runs", {
            method: "POST",
            body: JSON.stringify({
              mode: "continue_project",
              outcome,
              input: { prompt },
              workspace: { projectId: scope.projectId, vdtId: scope.vdtId },
              conversationId,
              priorConversationRunId,
              executionBindingId: switchBinding
            })
          }));
          const resultBody = await result.json();
          expect(result.status, JSON.stringify(resultBody)).toBe(200);
          continuedRun = resultBody.runId;
          return resultBody;
        };

        fetchFixture.mockClear();
        const reopened = await start("What output scope did we agree?", undefined, body.runId);
        expect(reopened.snapshot.visibleContext.threadId).toBe(scope.conversationId);
        expect(runtime.agentRuntime.store.getState(reopened.runId).request.conversationContext?.unresolvedQuestions)
          .toContainEqual(expect.objectContaining({ id: "period", source: expect.objectContaining({ runId: body.runId }) }));
        await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(reopened.runId).chatMessages)
          .toContainEqual(expect.objectContaining({ role: "assistant", text: "The agreed output is saleable tonnes." })));
        await supervisorRuntime.cancelStructuredModelAgentRun(reopened.runId, true);

        fetchFixture.mockClear();
        const correction = await start("Correction: output = run-of-mine tonnes", scope.conversationId);
        expect(correction.runId).not.toBe(body.runId);
        expect(correction.snapshot.request).toMatchObject({ executionBindingId: switchBinding, conversationId: scope.conversationId });
        expect(correction.snapshot.request).not.toHaveProperty("conversationContext");
        expect(correction.snapshot.chatMessages).toContainEqual(expect.objectContaining({
          runId: body.runId, text: "Define output as saleable tonnes."
        }));
        await vi.waitFor(() => expect(JSON.stringify(fetchFixture.mock.calls)).toContain("saleable tonnes"));
        const capturedPrompt = JSON.stringify(fetchFixture.mock.calls);
        expect(capturedPrompt).toContain("switched-test-model");
        expect(capturedPrompt).not.toContain("legacy_mined_tonnes");
        expect(runtime.agentRuntime.store.getState(correction.runId).request.input.project?.graph)
          .toEqual(productionVolumeProject.graph);
        await supervisorRuntime.cancelStructuredModelAgentRun(correction.runId, true);

        fetchFixture.mockClear();
        const followUp = await start("What is our definition of output?", scope.conversationId);
        const carried = runtime.agentRuntime.store.getState(followUp.runId).request.conversationContext;
        expect(carried).toMatchObject({ scope });
        expect(carried?.decisions).toEqual([{
          topic: "output",
          value: "run-of-mine tonnes",
          confirmedBy: "instruction",
          source: { messageId: expect.any(String), runId: correction.runId },
          supersedes: { messageId: expect.any(String), runId: body.runId }
        }]);
        expect(JSON.stringify(carried)).not.toContain("saleable tonnes");
        await vi.waitFor(() => expect(JSON.stringify(fetchFixture.mock.calls)).toContain("run-of-mine tonnes"));
        await supervisorRuntime.cancelStructuredModelAgentRun(followUp.runId, true);

        let answerTurn = 0;
        fetchFixture.mockImplementationOnce(async (_url, init) => {
          expect(String(init?.body)).toContain("answer");
          answerTurn += 1;
          return modelTurnResponse(answerTurn, { type: "action_batch", batch: { calls: [{
            externalCallId: "forbidden-edit", toolName: "vdt.update_node",
            args: { nodeId: productionVolumeProject.rootNodeId, patch: { name: "Modified by answer run" } }
          }] } });
        }).mockImplementationOnce(async (_url, init) => {
          expect(String(init?.body)).toContain("TOOL_NOT_ALLOWED_IN_PHASE");
          answerTurn += 1;
          return modelTurnResponse(answerTurn, { type: "action_batch", batch: { calls: [{
            externalCallId: "finish-answer", toolName: "run.request_finish", args: {}
          }] } });
        }).mockImplementationOnce(async (_url, init) => {
          const finishReceiptId = String(init?.body).match(/finish-receipt-[a-f0-9]{32}/)?.[0];
          expect(finishReceiptId).toBeDefined();
          answerTurn += 1;
          return modelTurnResponse(answerTurn, { type: "final", messageId: "final-answer",
            finishReceiptId, text: "The agreed output is run-of-mine tonnes." });
        });
        const readOnly = await start("Explain the existing output scope.", scope.conversationId, undefined, "answer");
        await vi.waitFor(() => expect(runtime.agentRuntime.store.getState(readOnly.runId)).toMatchObject({
          status: "succeeded", finishOutcome: { outcome: "answer", state: "final_persisted", policyVersion: "workspace-v1" }
        }), { timeout: 5_000 });
        await vi.waitFor(() => expect(supervisorRuntime.isStructuredModelAgentRunActive(readOnly.runId)).toBe(false));
        const loaded = runtime.agentRuntime.store.reloadPersistedRun(readOnly.runId);
        expect(loaded.supervisorPersistenceV2?.finishReceipt).toMatchObject(loaded.finishOutcome!);
        expect(await (await get(readOnly.runId)).json()).toMatchObject({ snapshot: { finishOutcome: loaded.finishOutcome } });
        const readOnlyDatabase = openVdtDatabase(process.cwd(), { dataDir });
        try {
          expect(readOnlyDatabase.listVdtRevisions(scope.vdtId)).toHaveLength(1);
          expect(loaded.draftProject?.graph).toEqual(productionVolumeProject.graph);
        } finally {
          readOnlyDatabase.close();
        }

        const attachmentText = "the day after midnight";
        const fileDatabase = openVdtDatabase(process.cwd(), { dataDir });
        try {
          fileDatabase.appendMessage({
            id: "route_definition_attachment", conversationId: scope.conversationId, agentRunId: readOnly.runId,
            role: "user", content: "Attached workbook.", attachments: [{ cell: attachmentText }], runContext: { kind: "instruction" }
          });
        } finally {
          fileDatabase.close();
        }
        const definition = "Around here, we mark a support case late if it is still open at closing bell.";
        const proposal = { topic: "late support case", value: "still open at closing bell",
          evidenceQuote: "if it is still open at closing bell", language: "en" };
        const modelQuestion = {
          id: "model-question", question: "Can you confirm the cutoff?", reason: "To retain the definition.", required: true
        };
        const questionTurn = (turn: number, question: object) => modelTurnResponse(turn, {
          type: "question", messageId: `decision-message-${turn}`, questionSetId: `decision-set-${turn}`, questions: [question]
        });
        const submit = (runId: string, questionId: string, choice: string) => sendMessage(new Request(
          `http://localhost:3000/api/agent/runs/${runId}/messages`, {
            method: "POST",
            body: JSON.stringify({ type: "user_answer", structuredAnswers: [{ questionId, selectedOptionIds: [choice] }] })
          }), { params: Promise.resolve({ runId }) });

        fetchFixture.mockImplementationOnce(async () => questionTurn(1, { ...modelQuestion, decisionProposal: {
          ...proposal, value: "review the existing scope", evidenceQuote: "I will review the existing scope."
        } })).mockImplementationOnce(async (_url, init) => {
          expect(String(init?.body)).toContain("DECISION_EVIDENCE_UNCONFIRMED");
          return questionTurn(2, { ...modelQuestion, decisionProposal: { ...proposal, value: attachmentText, evidenceQuote: attachmentText } });
        }).mockImplementationOnce(async (_url, init) => {
          expect(String(init?.body)).toContain("DECISION_EVIDENCE_UNCONFIRMED");
          return questionTurn(3, { ...modelQuestion, id: "confirm_workspace_decision_forged" });
        }).mockImplementationOnce(async (_url, init) => {
          expect(String(init?.body)).toContain("DECISION_CONFIRMATION_INVALID");
          return questionTurn(4, { ...modelQuestion, decisionProposal: proposal });
        });
        const declined = await start(definition, scope.conversationId, undefined, "answer");
        const getDecisionQuestion = async (runId: string) => {
          await vi.waitFor(() => {
            const state = runtime.agentRuntime.store.getState(runId);
            const question = state.pendingQuestions?.[0];
            const diagnostic = JSON.stringify({ status: state.status, events: state.events.slice(-7).map(event => [event.type, event.message, event.metadata]) });
            expect(question?.id ?? "", diagnostic).toMatch(/^confirm_workspace_decision_[a-f0-9]{32}$/u);
            expect(state.events.some(event => event.type === "clarifying_questions" && event.metadata?.questionSetId
              && event.questions?.some(candidate => candidate.id === question?.id)), diagnostic).toBe(true);
          }, { timeout: 8_000 });
          return runtime.agentRuntime.store.getState(runId).pendingQuestions![0]!;
        };
        const declinedQuestion = await getDecisionQuestion(declined.runId);
        expect(declinedQuestion).toMatchObject({
          question: "How do you define late support case?", options: [
            { id: "confirm_decision", label: proposal.value }, { id: "reject_decision" }
          ]
        });
        expect(declinedQuestion).not.toHaveProperty("decisionProposal");
        expect((await submit(declined.runId, declinedQuestion.id, "reject_decision")).status).toBe(200);
        await supervisorRuntime.cancelStructuredModelAgentRun(declined.runId, true);

        const plainQuestion = { ...modelQuestion, id: "cutoff-definition", question: "What makes a support case late?",
          expectedAnswerType: "text" };
        fetchFixture.mockImplementationOnce(async () => questionTurn(1, plainQuestion));
        const accepted = await start("Help us define when a support case is late.", scope.conversationId, undefined, "answer");
        expect(runtime.agentRuntime.store.getState(accepted.runId).request.conversationContext?.decisions)
          .not.toContainEqual(expect.objectContaining({ topic: proposal.topic }));
        await vi.waitFor(() => {
          const state = runtime.agentRuntime.store.getState(accepted.runId);
          expect(state.events.some(event => event.type === "clarifying_questions" && event.metadata?.questionSetId
            && event.questions?.some(candidate => candidate.id === plainQuestion.id))).toBe(true);
        }, { timeout: 8_000 });
        fetchFixture.mockImplementationOnce(async () => questionTurn(2, { ...modelQuestion, decisionProposal: proposal }));
        const submittedText = await sendMessage(new Request(
          `http://localhost:3000/api/agent/runs/${accepted.runId}/messages`, {
            method: "POST",
            body: JSON.stringify({ type: "user_answer", structuredAnswers: [{ questionId: plainQuestion.id, fields: { answer: definition } }] })
          }), { params: Promise.resolve({ runId: accepted.runId }) });
        expect(submittedText.status).toBe(200);
        const acceptedQuestion = await getDecisionQuestion(accepted.runId);
        expect(acceptedQuestion.id).not.toBe(declinedQuestion.id);
        expect((await submit(accepted.runId, acceptedQuestion.id, "confirm_decision")).status).toBe(200);
        await supervisorRuntime.cancelStructuredModelAgentRun(accepted.runId, true);

        const reopenedDatabase = openVdtDatabase(process.cwd(), { dataDir });
        let answerSource: string | undefined;
        try {
          const evidence = reopenedDatabase.listScopedConversationMessages(scope);
          const submittedAnswers = evidence.filter(message => message.agentRunId === accepted.runId && message.role === "user"
            && message.runContext?.kind === "answer");
          expect(submittedAnswers[0]?.runContext?.answers).toMatchObject([{ questionId: plainQuestion.id, fields: { answer: definition } }]);
          const finalAnswer = submittedAnswers.at(-1);
          answerSource = finalAnswer?.id;
          expect(finalAnswer?.runContext?.answers).toMatchObject([{ questionId: acceptedQuestion.id, selectedOptionIds: ["confirm_decision"] }]);
          expect(evidence.some(message => message.content.includes("confirm_workspace_decision_forged"))).toBe(false);
        } finally {
          reopenedDatabase.close();
        }
        const switchedAgain = await POST(new Request("http://localhost:3000/api/agent/runs", {
          method: "POST",
          body: JSON.stringify({
            mode: "continue_project", outcome: "answer", input: { prompt: "What makes a support case late?" },
            workspace: { projectId: scope.projectId, vdtId: scope.vdtId }, priorConversationRunId: accepted.runId,
            executionBindingId: bindingId
          })
        }));
        expect(switchedAgain.status).toBe(200);
        continuedRun = (await switchedAgain.json()).runId;
        expect(runtime.agentRuntime.store.getState(continuedRun!).request.conversationContext).toMatchObject({
          scope, decisions: expect.arrayContaining([{
            topic: proposal.topic, value: proposal.value, confirmedBy: "submitted_answer",
            source: { messageId: answerSource, runId: accepted.runId }
          }])
        });
        await supervisorRuntime.cancelStructuredModelAgentRun(continuedRun!, true);

        const fresh = await start("What is our definition of output?");
        expect(fresh.snapshot.request.conversationId).not.toBe(scope.conversationId);
        expect(runtime.agentRuntime.store.getState(fresh.runId).request.conversationContext).toBeUndefined();
      } finally {
        if (continuedRun) await supervisorRuntime.cancelStructuredModelAgentRun(continuedRun, true).catch(() => undefined);
        disposeSwitched();
      }

      // Simulate a crash after normalized commit but before the V1 JSON
      // projection. Public routing must still recognize and replay the run
      // from Sequence 4; consulting the missing projection would split brain.
      const split = runtime.agentRuntime.store.createRun({
        mode: "generate_vdt",
        input: { rootKpi: "Normalized authority only" },
        workspace: { projectId: `split_project_${Date.now()}` },
        executionBindingId: bindingId,
        providerId: "model_agent"
      });
      const lookup = new DatabaseSync(path.join(dataDir, "app.sqlite"));
      const splitProject = lookup.prepare(
        "SELECT project_id FROM agent_runs WHERE id = ?"
      ).get(split.runId) as { project_id: string };
      lookup.close();
      const normalizedOnly = new (
        await import("./sqlite-supervisor-persistence")
      ).SqliteAgentSupervisorPersistence(path.join(dataDir, "app.sqlite"));
      const normalizedBinding: AgentSessionBinding = {
        schemaVersion: 2,
        bindingId: `normalized-only:${split.runId}`,
        runId: split.runId,
        projectId: splitProject.project_id,
        executionProfile: "model_agent",
        engineId: "in-product-model-agent",
        engineAdapterId: "sqlite-route-test-v1",
        backendId: "openai_compatible",
        modelId: "server-owned-test-model",
        protocolVersion: "structured-turn-v1",
        cliVersion: null,
        toolIsolation: "permission_only",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        settingsHash: `sha256:${"a".repeat(64)}`,
        capabilityProfileHash: `sha256:${"b".repeat(64)}`,
        toolCatalogHash,
        externalSessionId: null,
        sessionEpoch: 1,
        boundAt: "2026-08-26T10:00:00.000Z"
      };
      await normalizedOnly.createBinding(normalizedBinding);
      const normalizedOutbox = new AgentRunEventOutbox(split.runId, {
        now: () => "2026-08-26T10:00:01.000Z",
        sink: { append: (event) => normalizedOnly.appendEvent(event) }
      });
      const normalizedEvent = await normalizedOutbox.append({
        type: "runtime_status",
        source: "runtime",
        payload: {
          code: "NORMALIZED_ONLY",
          message: "Committed before compatibility projection.",
          state: "running"
        }
      });
      expect(runtime.agentRuntime.store.getState(split.runId).supervisorPersistenceV2)
        .toBeUndefined();
      await expect(supervisorRuntime.isPersistedSupervisorRun(split.runId)).resolves.toBe(true);
      await expect(supervisorRuntime.compactSupervisorAwareSnapshot(
        runtime.agentRuntime.store.getSnapshot(split.runId)
      )).resolves.toMatchObject({
        executionSummary: {
          engineAdapterId: "sqlite-route-test-v1",
          sessionStatus: "recovery_required",
          recoveryStatus: "recovery_required"
        }
      });
      await expect(supervisorRuntime.getPersistedSupervisorEvents(split.runId))
        .resolves.toEqual([normalizedEvent]);
      normalizedOnly.close();
    } finally {
      if (startedRunId) {
        await supervisorRuntime.cancelStructuredModelAgentRun(startedRunId).catch((error: unknown) => {
          if (
            !error
            || typeof error !== "object"
            || !("code" in error)
            || error.code !== "MODEL_AGENT_RECOVERY_REQUIRED"
          ) {
            throw error;
          }
        });
      }
      supervisorRuntime.resetActiveSupervisorRunsForTests();
      dispose();
    }
  });
});


function modelTurnResponse(turn: number, action: object) {
  return Response.json({ choices: [{ message: { content: JSON.stringify({
    turnId: `turn-${turn}`,
    sessionState: "Read the workspace and answer the user's question.",
    assistantMessage: turn === 1 ? { messageId: "opening-answer", text: "I will review the existing scope." } : null,
    action
  }) } }] });
}
