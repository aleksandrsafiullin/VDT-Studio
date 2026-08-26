import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AgentRunEventOutbox, type AgentSessionBinding } from "@vdt-studio/vdt-agent-runtime";
import { afterAll, describe, expect, it, vi } from "vitest";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-supervisor-route-"));

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("public Model Agent route with a persistent run store", () => {
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        turnId: "turn-1",
        sessionState: "Goal: build Ore hauled VDT. Pending: confirm the reporting period.",
        assistantMessage: {
          messageId: "message-1",
          text: "The persistent Model Agent session is ready."
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
    })));

    let startedRunId: string | undefined;
    try {
      const response = await POST(new Request("http://localhost:3000/api/agent/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "generate_vdt",
          input: { rootKpi: "Ore hauled" },
          executionBindingId: bindingId
        })
      }));
      const body = await response.json() as { ok: boolean; runId: string };
      startedRunId = body.runId;
      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(runtime.hasSqliteAgentRunPersistence(runtime.agentRuntime.store)).toBe(true);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (runtime.agentRuntime.store.getState(body.runId).status === "needs_user_input") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(runtime.agentRuntime.store.getState(body.runId).status).toBe("needs_user_input");

      const db = new DatabaseSync(path.join(dataDir, "app.sqlite"));
      try {
        db.exec("PRAGMA foreign_keys = ON;");
        expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
        expect(db.prepare(`
          SELECT binding.project_id AS binding_project_id,
                 run.project_id AS run_project_id,
                 binding.session_epoch AS initial_epoch
          FROM agent_session_bindings_v2 binding
          JOIN agent_runs run ON run.id = binding.run_id
          WHERE binding.run_id = ?
        `).get(body.runId)).toEqual({
          binding_project_id: "project_agent_workspace",
          run_project_id: "project_agent_workspace",
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
