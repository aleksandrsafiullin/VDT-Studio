import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openVdtDatabase } from "@vdt-studio/storage";
import { productionVolumeProject } from "@vdt-studio/vdt-core";
import { AgentExecutionBindingRegistry } from "./execution-bindings";
import { createLocalModelAgentBinding } from "./local-model-bindings";

const hash = `sha256:${"d".repeat(64)}`;
const scope = { projectId: "adaptive_start_project", vdtId: "adaptive_start_vdt" };
const expected = { mode: "legacy", profileVersion: 1, providerId: "ollama", modelId: "selected-model", modelRevision: null } as const;
const fixture = () => createLocalModelAgentBinding("ollama", expected.modelId, hash, false, undefined, { start: false, repair: "low" });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("expires and bounds private adaptive offers, with an atomic exact consume", () => {
  const registry = new AgentExecutionBindingRegistry();
  expect(() => registry.register(fixture())).toThrow("scoped start offer");
  const first = registry.offerAdaptiveStart(fixture(), scope, 0);
  for (let i = 1; i < 32; i++) registry.offerAdaptiveStart(fixture(), scope, 0);
  expect(() => registry.offerAdaptiveStart(fixture(), scope, 119_999)).toThrow("unavailable");
  expect(registry.summaries()).toEqual([]);
  expect(() => registry.resolveAdaptiveStart(first.bindingId, scope, expected, true, 120_000)).toThrow("Reconnect");
  const next = registry.offerAdaptiveStart(fixture(), scope, 120_000);
  expect(() => registry.resolveAdaptiveStart(next.bindingId, { ...scope, vdtId: "wrong" }, expected, true, 120_001)).toThrow("Reconnect");
  expect(() => registry.resolveAdaptiveStart(next.bindingId, scope, { ...expected, modelId: "wrong" }, true, 120_001)).toThrow("identity");
  expect(registry.resolveAdaptiveStart(next.bindingId, scope, expected, true, 120_001)).toMatchObject({ modelId: expected.modelId });
  expect(() => registry.resolveAdaptiveStart(next.bindingId, scope, expected, true, 120_002)).toThrow("Reconnect");
});

it("admits only a fresh explicitly scoped adaptive start through the public route", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "vdt-adaptive-start-"));
  vi.stubEnv("VDT_DATA_DIR", dataDir);
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("No provider calls expected"); }));
  const db = openVdtDatabase(process.cwd(), { dataDir });
  try {
    db.createProject({ id: scope.projectId, name: "Scoped workspace" });
    db.createVdt({ id: scope.vdtId, projectId: scope.projectId, name: "Scoped VDT", rootKpi: "Capacity" });
    db.saveVdtRevision({ id: "adaptive_start_base", vdtId: scope.vdtId, projectId: scope.projectId,
      revisionNo: 1, source: "user", project: productionVolumeProject });
    const [runtime, supervisor, route] = await Promise.all([import("./runtime"), import("./supervisor-runtime"), import("./route")]);
    const startRunner = vi.spyOn(supervisor, "startStructuredModelAgentRun")
      .mockRejectedValue(new supervisor.PublicSupervisorRunError("FIXTURE_RUNNER_REACHED", "Fixture runner reached."));
    const staticBinding = createLocalModelAgentBinding("ollama", "static-model", hash, false);
    const closeStatic = runtime.agentExecutionBindingRegistry.register(staticBinding);
    try {
      const offered = runtime.agentExecutionBindingRegistry.offerAdaptiveStart(fixture(), scope);
      const get = await route.GET(new Request("http://localhost:3000/api/agent/runs", {
        headers: { "x-vdt-skip-packaged-cursor-discovery": "1" }
      }));
      const ids = (await get.json()).bindings.map((binding: { bindingId: string }) => binding.bindingId);
      expect(ids).toContain(staticBinding.bindingId);
      expect(ids).not.toContain(offered.bindingId);
      const start = (workspace: object, expectedExecution?: object, id = offered.bindingId) =>
        route.POST(new Request("http://localhost:3000/api/agent/runs", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ executionBindingId: id,
            mode: "continue_project", workspace, input: { prompt: "Inspect this saved VDT." }, expectedExecution }) }));
      for (const refusal of [
        await start(scope),
        await start({ ...scope, projectId: "wrong_project" }, expected),
        await start({ ...scope, vdtId: "wrong_vdt" }, expected),
        await start(scope, { ...expected, modelId: "wrong-model" })
      ]) {
        expect(refusal.status).toBe(409);
      }
      expect(startRunner).not.toHaveBeenCalled();
      const reached = await start(scope, expected);
      expect(await reached.json()).toMatchObject({ error: { code: "FIXTURE_RUNNER_REACHED" } });
      expect(startRunner).toHaveBeenCalledTimes(1);
      expect(startRunner.mock.calls[0]?.[0].bindingDefinition).toMatchObject({ modelId: expected.modelId,
        modelEngineAdapter: { adaptiveReasoning: { start: false, repair: "low" } } });
      expect((await start(scope, expected)).status).toBe(409);
      expect(startRunner).toHaveBeenCalledTimes(1);
      const fixed = await start(scope, undefined, staticBinding.bindingId);
      expect(await fixed.json()).toMatchObject({ error: { code: "FIXTURE_RUNNER_REACHED" } });
      expect(startRunner.mock.calls[1]?.[0].bindingDefinition.modelEngineAdapter).not.toHaveProperty("adaptiveReasoning");
    } finally { closeStatic(); }
  } finally { db.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
