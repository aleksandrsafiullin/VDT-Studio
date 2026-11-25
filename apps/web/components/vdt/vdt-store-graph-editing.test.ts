import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentRunStore, createDefaultToolRegistry, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { calculateGraph, validateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { afterEach, expect, it, vi } from "vitest";
import { BranchParentEditor } from "./branch-parent-editor";
import { GraphLinkEditor } from "./graph-link-editor";
import { useVdtStudioStore as store } from "./vdt-store";

afterEach(() => vi.unstubAllGlobals());

it("repairs, adds, edits and deletes drivers through editor actions", () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ projectTitle: "Haulage", rootKpi: "Ore hauled" });
  const root = builder.getProject().rootNodeId;
  builder.addDriver({
    parentNodeId: root, nodeId: "truck_working_time", name: "Truck working time", type: "input", baselineValue: 10
  });
  builder.addDriver({
    parentNodeId: root, nodeId: "truck_count", name: "Truck count", type: "input", baselineValue: 2
  });
  const formula = "min(truck_working_time, 50) * min";
  const repaired = "min(truck_working_time, 50) * truck_count";
  builder.setFormula({ nodeId: root, formula });
  store.setState({ project: builder.getProject(), sendManualProjectChange: vi.fn() });
  const project = () => store.getState().project;
  const node = (id: string) => project().graph.nodes.find(candidate => candidate.id === id);
  const editor = store.getState();

  editor.selectNode(root);
  expect(node(store.getState().selectedNodeId!)).toMatchObject({ id: root, formula });
  expect(validateGraph(project())).toMatchObject({
    valid: false, errors: expect.arrayContaining([expect.objectContaining({ type: "unknown_reference" })])
  });
  editor.updateNode(root, { formula: repaired });
  expect(validateGraph(project()).valid).toBe(true);
  expect(calculateGraph(project()).rootValue).toBe(20);

  editor.addManualIncomingKpi(root);
  const first = store.getState().selectedNodeId!;
  editor.updateNodeBaselineValue(first, 3);
  editor.addManualIncomingKpi(root);
  const second = store.getState().selectedNodeId!;
  editor.updateNodeBaselineValue(second, 4);
  editor.updateNode(root, { formula: `${repaired} + ${first} + ${second}` });
  expect(calculateGraph(project()).rootValue).toBe(27);
  for (const id of [first, second]) {
    expect(project().graph.edges).toContainEqual(expect.objectContaining({
      sourceNodeId: root, targetNodeId: id, relation: "formula_dependency"
    }));
  }
  const patch = { name: "Revised adjustment", unit: "1", description: "Revised adjustment description", type: "input" } as const;
  editor.updateNode(first, patch);
  expect(node(first)).toMatchObject(patch);
  editor.deleteNode(first);
  expect(validateGraph(project()).valid).toBe(false);
  expect(node(first)).toBeUndefined();
  editor.updateNode(root, { formula: `${repaired} + ${second}` });
  editor.deleteNode(root);
  expect(project().graph.nodes.map(candidate => candidate.id)).toEqual([root, "truck_working_time", "truck_count", second]);
  expect(project().graph.edges.map(edge => edge.targetNodeId)).toEqual(["truck_working_time", "truck_count", second]);
  expect(validateGraph(project()).valid).toBe(true);
  expect(calculateGraph(project()).rootValue).toBe(24);
});

it("matches the hierarchy tool on branch moves and protects the editor draft from a stale move", async () => {
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Output", projectTitle: "Hierarchy" });
  builder.addDriver({
    nodeId: "production", parentNodeId: "output", name: "Production", type: "calculated", formula: "hours * rate"
  });
  builder.addDriver({ nodeId: "hours", parentNodeId: "output", name: "Hours", baselineValue: 3 });
  builder.addDriver({ nodeId: "rate", parentNodeId: "production", name: "Rate", baselineValue: 2 });
  builder.updateNode({ nodeId: "hours", patch: { valueSource: { sourceTier: "uploaded_data", note: "Original source" } } });
  builder.setFormula({ nodeId: "output", formula: "production" });
  const initial = builder.getProject();
  const agentStore = new AgentRunStore();
  const run = agentStore.createRun({
    mode: "continue_project", providerId: "mock", input: { project: initial }, options: { autoApplyPatches: true }
  });
  agentStore.updateRun(run.runId, { builder, draftProject: initial });
  const context: AgentToolContext = {
    runId: run.runId, store: agentStore, builder, signal: run.abortController.signal,
    emit: event => { agentStore.appendEvent(run.runId, event); },
    getRun: () => agentStore.getSnapshot(run.runId),
    updateRun: patch => { agentStore.updateRun(run.runId, patch); }
  };
  const registry = createDefaultToolRegistry();
  const workspace = { ...store.getState().workspace, activeProjectId: "workspace", activeVdtId: "vdt" };
  const manualChange = vi.fn();
  const browserDraft = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => browserDraft.get(key) ?? null,
    setItem: (key: string, value: string) => browserDraft.set(key, value),
    removeItem: (key: string) => browserDraft.delete(key)
  });
  store.setState({ project: initial, workspace, selectedNodeId: "hours", selectedPanelTab: "properties",
    sendManualProjectChange: manualChange });
  const inspector = renderToStaticMarkup(createElement(BranchParentEditor, {
    project: initial, workspaceProjectId: "workspace", vdtId: "vdt", nodeId: "hours"
  }));
  expect(inspector).toContain('aria-label="Branch parent"');
  expect(inspector).toContain("New parent");
  expect(inspector).toContain('value="production"');
  expect(inspector).toContain("Move branch");
  const links = renderToStaticMarkup(createElement(GraphLinkEditor, {
    project: initial, workspaceProjectId: "workspace", vdtId: "vdt", nodeId: "production"
  }));
  expect(links).toContain("Outgoing links");
  expect(links).toContain("Edit or remove link");
  expect(links).toContain('value="rate"');

  const originalSelection = { project: initial, workspaceProjectId: "workspace", vdtId: "vdt" };
  const input = { nodeId: "hours", fromParentNodeId: "output", parentNodeId: "production" };
  const draftRevision = store.getState().projectRevision;
  store.getState().selectNode("rate");
  expect(store.getState().reparentBranch(input, originalSelection)).toMatchObject({ code: "STALE_BRANCH_SELECTION" });
  expect(store.getState().project).toBe(initial);
  expect(store.getState().projectRevision).toBe(draftRevision);
  expect(manualChange).not.toHaveBeenCalled();

  store.getState().selectNode("hours");
  expect(await registry.run("vdt.reparent_branch", input, context)).toMatchObject({ ok: true });
  expect(store.getState().reparentBranch(input, originalSelection)).toEqual({ ok: true });
  const moved = store.getState().project;
  expect(moved.graph).toEqual(builder.getProject().graph);
  expect(moved.graph.nodes).toEqual(initial.graph.nodes);
  expect(moved.graph.edges.find(edge => edge.targetNodeId === "hours")).toMatchObject({
    sourceNodeId: "production", relation: "positive_driver"
  });
  expect(calculateGraph(moved).rootValue).toBe(6);
  expect(store.getState().projectRevision).toBe(draftRevision + 1);
  expect(manualChange).toHaveBeenCalledOnce();
  const persisted = JSON.parse(browserDraft.get("vdt-studio-state")!);
  expect(persisted.state).toMatchObject({
    project: { graph: { edges: moved.graph.edges } },
    projectRevision: draftRevision + 1
  });

  const moveProduction = { nodeId: "production", fromParentNodeId: "output", parentNodeId: "hours" };
  store.getState().selectNode("production");
  expect(await registry.run("vdt.reparent_branch", moveProduction, context))
    .toMatchObject({ ok: false, error: { code: "HIERARCHY_CYCLE" } });
  expect(store.getState().reparentBranch(moveProduction, { ...originalSelection, project: moved }))
    .toMatchObject({ ok: false, code: "HIERARCHY_CYCLE" });
  expect(store.getState().project).toBe(moved);
  expect(builder.getProject().graph).toEqual(moved.graph);
  expect(store.getState().projectRevision).toBe(draftRevision + 1);
  expect(manualChange).toHaveBeenCalledOnce();
});
