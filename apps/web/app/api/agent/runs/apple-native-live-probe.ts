/** Disposable, synthetic route smoke. Run with an owned data dir and helper. */
import { openVdtDatabase } from "@vdt-studio/storage";
import { VdtBuilderSession, buildKpiSuggestionContext, buildKpiSuggestionTaskInput, productionVolumeProject } from "@vdt-studio/vdt-core";
import { createStorageWriteActor } from "../../vdt/storage-write-adapter";
import { POST as admit } from "../bindings/apple/route";
import { POST as start } from "./route";
import { POST as prepareSmart } from "../../ai/suggestions/route";
import { agentRuntime } from "./runtime";
import { cancelStructuredModelAgentRun, getPersistedSupervisorEvents, isStructuredModelAgentRunActive } from "./supervisor-runtime";

if (!process.env.VDT_DATA_DIR || !process.env.VDT_APPLE_FOUNDATION_MODELS_HELPER_PATH) {
  throw new Error("An owned disposable data directory and helper are required.");
}
const started = new Date().toISOString();
const projectId = "apple-live-a03", vdtId = "apple-live-vdt";
const builder = new VdtBuilderSession();
builder.createDraft({ projectTitle: "Native fixture", rootKpi: "Monthly production volume", unit: "t" });
const project = builder.getProject();
const database = openVdtDatabase(process.cwd(), { dataDir: process.env.VDT_DATA_DIR });
try {
  database.createProject({ id: projectId, name: "Synthetic native fixture" });
  const basis = database.getProjectRuntimeState(projectId);
  if (!basis) throw new Error("Missing synthetic fixture generation.");
  database.createVdtWithInitialSnapshot({
    actor: createStorageWriteActor(projectId),
    command: {
      schemaVersion: "create_vdt_with_initial_snapshot.v1", projectId, expectedRuntimeGeneration: basis.runtimeGeneration,
      expectedGenerationVersion: basis.generationVersion, idempotencyKey: "apple-a03-seed",
      vdt: {
        requestedVdtId: vdtId, name: "Native fixture", rootKpi: "Monthly production volume",
        unit: "t", timePeriod: "month", status: "draft", metadata: null
      },
      revisionIntent: { source: "user", summary: "Synthetic new VDT fixture", validation: null, calculation: null }
    },
    project
  });
} finally { database.close(); }
const req = (path: string, body: unknown) => new Request(`http://localhost:3000${path}`, {
  method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" },
  body: JSON.stringify(body)
});
const admitted = await admit(req("/api/agent/bindings/apple", { locale: "en-US" }));
const ad = await admitted.json();
if (!admitted.ok) throw new Error(`ADMISSION_${ad.code}`);
const { binding } = ad;
const expectedExecution = { mode: "local", providerId: binding.backendId, modelId: binding.modelId, profileVersion: 1, modelRevision: null };
const initial = performance.now();
let chat: Record<string, unknown>;
const response = await start(req("/api/agent/runs", {
  executionBindingId: binding.bindingId, expectedExecution, mode: "generate_vdt", outcome: "structural_model",
  workspace: { projectId, vdtId }, input: {
    rootKpi: "Monthly production volume", unit: "t", timePeriod: "month",
    prompt: "Build the editable factor structure for monthly haulage output measured at the primary crusher. Truck loads, payload per load, and active haulage time are known drivers. Leave measurements blank for now."
  }, options: { researchMode: "off", maxSteps: 16 }
}));
const body = await response.json();
if (!response.ok) chat = { startStatus: response.status, code: body.error?.code };
else {
  const runId = body.runId as string;
  let snapshot = agentRuntime.store.getSnapshot(runId);
  const firstSeen: Record<string, number> = {};
  while (performance.now() - initial < 45_000 && !["succeeded", "failed", "cancelled", "needs_user_input", "waiting_approval", "recovery_required"].includes(snapshot.status)) {
    for (const event of snapshot.events) {
      const tool = event.metadata?.toolName;
      if (typeof tool === "string" && event.type === "tool_call_completed" && firstSeen[tool] === undefined) {
        firstSeen[tool] = Math.round(performance.now() - initial);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 175));
    snapshot = agentRuntime.store.getSnapshot(runId);
  }
  const actions = snapshot.events.filter(event => ["tool_call_completed", "skill_selected"].includes(event.type))
    .map(event => ({ type: event.type, tool: event.metadata?.toolName, ok: event.metadata?.ok, code: event.metadata?.code }));
  const runtimeEvents = (await getPersistedSupervisorEvents(runId)).flatMap(event => event.type === "runtime_status" || event.type === "error"
    ? [{ type: event.type, code: "code" in event.payload ? event.payload.code : undefined }] : []);
  chat = { startStatus: response.status, status: snapshot.status, errorCode: snapshot.error?.code ?? null, firstSeen, actions, runtimeEvents,
    selectedSkills: snapshot.selectedSkills.map(skill => ({ id: skill.id, version: skill.version, source: skill.source })),
    finish: snapshot.finishOutcome ?? null, elapsedMs: Math.round(performance.now() - initial) };
  if (isStructuredModelAgentRunActive(runId)) {
    await cancelStructuredModelAgentRun(runId, true);
    chat.cleanupConfirmed = !isStructuredModelAgentRunActive(runId);
  }
}
const context = await buildKpiSuggestionContext(productionVolumeProject, {
  targetNodeId: productionVolumeProject.rootNodeId, workspaceId: "apple-live-smart", vdtId: null,
  period: { key: "explicit:2026-11-01–2026-11-30", grain: "custom" }
});
const smartStart = performance.now();
const smart = await prepareSmart(req("/api/ai/suggestions", {
  input: buildKpiSuggestionTaskInput(context), providerId: binding.backendId,
  providerConfig: { bindingId: binding.bindingId }, expectedExecution, timeoutMs: 15_000
}));
const prepared = await smart.json();
console.log("A03_RECEIPT " + JSON.stringify({
  started, finished: new Date().toISOString(), binding: { provider: binding.backendId, model: binding.modelId,
    appleIdentity: binding.appleIdentity, admission: binding.admission }, chat,
  smart: { status: smart.status, resultStatus: prepared.result?.status, groups: prepared.result?.groups?.length,
    errorCode: prepared.error?.code, elapsedMs: Math.round(performance.now() - smartStart) }
}));
