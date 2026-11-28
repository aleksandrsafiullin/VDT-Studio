import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_SETTINGS } from "@/lib/execution-mode-catalog";
import { selectExecutionCategory } from "@/lib/execution-category";
import { resolveExecutionSettings } from "@/lib/execution-mode-resolver";
import { useVdtStudioStore as store } from "./vdt-store";

afterEach(() => {
  store.setState(store.getInitialState(), true);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["graph", "scenario", "kpi", "clear-kpi", "unchanged", "fixed"] as const)(
  "rechecks adaptive admission against the captured draft (%s)", async (change) => {
    vi.stubEnv("VDT_APP_MODE", "development_web");
    const initial = store.getInitialState();
    store.setState({
      ...initial,
      executionSettings: selectExecutionCategory(DEFAULT_EXECUTION_SETTINGS, "local_models"),
      workspace: { ...initial.workspace, activeProjectId: "project", activeVdtId: "tree" }
    }, true);
    store.getState().createScenario();
    const state = store.getState();
    const modelId = resolveExecutionSettings(state.executionSettings).providerConfig?.model;
    const adaptive = change !== "fixed";
    const binding = {
      bindingId: adaptive ? "local_model_ollama_adaptive_test" : "local_model_ollama_fixed_test",
      executionProfile: "model_agent", backendId: "ollama", modelId, modelReasoning: false,
      admission: { mode: "legacy", providerId: "ollama", modelId, modelRevision: null, profileVersion: 1 },
      ...(adaptive ? { adaptiveReasoning: { start: false, repair: "low" } } : {})
    };
    let notifyAdmissionRequested!: () => void;
    const requested = new Promise<void>(resolve => { notifyAdmissionRequested = resolve; });
    let returnAdmission!: (response: Response) => void;
    const admitted = new Promise<Response>(resolve => { returnAdmission = resolve; });
    const starts: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url === "/api/agent/runs" && init?.method === "POST") {
        starts.push(JSON.parse(String(init.body)));
        return Response.json({ ok: false, error: "synthetic stop after observing start request" }, { status: 400 });
      }
      if (url === "/api/agent/runs") return Response.json({ ok: true, schemaVersion: 1, defaultBindingId: null, bindings: [] });
      if (url === "/api/agent/bindings/provider") {
        expect(JSON.parse(String(init?.body)).adaptiveReasoning).toBe(adaptive ? true : undefined);
        notifyAdmissionRequested();
        return admitted;
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const node = state.project.graph.nodes.find(candidate => candidate.id !== state.project.rootNodeId)!;
    if (change === "clear-kpi") store.getState().selectNode(node.id);
    const pending = state.startAgentRun("Build from this VDT.", {
      includeCurrentProject: true, adaptiveReasoning: adaptive,
      ...(change === "clear-kpi" ? { selectedNodeId: node.id } : {})
    });
    await requested;
    if (change === "graph" || change === "fixed") store.getState().updateNodeBaselineValue(node.id, 862);
    if (change === "scenario") {
      const other = state.project.scenarios.find(value => value.id !== state.activeScenarioId)!;
      store.getState().setActiveScenarioId(other.id);
    }
    if (change === "kpi") store.getState().selectNode(node.id);
    if (change === "clear-kpi") {
      store.getState().clearAgentKpiContext();
      expect(store.getState().selectedNodeId).toBe(node.id);
      expect(store.getState().chatKpiContextExcludedVdtId).toBe("tree");
    }
    returnAdmission(Response.json({ ok: true, binding }));
    expect(await pending).toBe(false);
    if (change === "unchanged" || change === "fixed") {
      expect(starts).toEqual([expect.objectContaining({ executionBindingId: binding.bindingId, expectedExecution: binding.admission })]);
    } else {
      expect(starts).toEqual([]);
      expect(store.getState().agentError).toContain("VDT changed");
    }
  }
);
