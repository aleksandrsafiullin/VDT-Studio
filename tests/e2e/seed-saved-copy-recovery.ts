import { openVdtDatabase } from "../../packages/vdt-storage/src/index";
import { SqliteAgentSupervisorPersistence } from "../../apps/web/app/api/agent/runs/sqlite-supervisor-persistence";

async function main() {
  const [dataDir, projectId, vdtId, runId] = process.argv.slice(2);
  if (!dataDir || !projectId || !vdtId || !runId) throw new Error("An owned fixture scope is required.");
  const database = openVdtDatabase(process.cwd(), { dataDir });
  const authority = new SqliteAgentSupervisorPersistence(database.databasePath);
  try {
    const vdt = database.getVdt(vdtId);
    if (vdt?.projectId !== projectId || !vdt.activeRevisionId) throw new Error("Fixture revision was not committed.");
    const store = await import("../../packages/vdt-agent-runtime/src/index");
    const runStore = new store.AgentRunStore();
    const run = runStore.createRun({ mode: "generate_vdt", executionBindingId: "browser-fixture",
      providerId: "model_agent", input: { rootKpi: vdt.rootKpi }, workspace: { projectId, vdtId } });
    const internalState = store.serializeAgentRunState({ ...run, runId, status: "running", visibleContext: { ...run.visibleContext, threadId: runId } });
    database.createAgentRun({ id: runId, projectId, vdtId, status: "running", phase: run.phase,
      request: internalState.snapshot.request as unknown as Record<string, unknown>,
      internalState: internalState as unknown as Record<string, unknown> });
    const hash = `sha256:${"a".repeat(64)}` as const;
    await authority.createBinding({ schemaVersion: 2, bindingId: `binding:${runId}`, runId, projectId,
      executionProfile: "model_agent", engineId: "in-product-model-agent", engineAdapterId: "http-structured-browser-fixture",
      backendId: "openai_compatible", modelId: "fixture", protocolVersion: "structured-turn-v1", cliVersion: null,
      toolIsolation: "permission_only", qualificationStatus: "unverified", capabilityEvidenceHash: null,
      settingsHash: hash, capabilityProfileHash: hash, toolCatalogHash: hash, externalSessionId: null, sessionEpoch: 1, boundAt: new Date().toISOString() });
  } finally {
    authority.close();
    database.close();
  }
}

void main();
