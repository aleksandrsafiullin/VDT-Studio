import { afterEach, expect, it, vi } from "vitest";
import { createSmartKpiMeasuredFixture } from "../../../../packages/vdt-core/src/suggestions/fixtures";
import { listenForSuggestedKpiReview, requestSuggestedKpiReview } from "./suggested-kpi-handoff";

afterEach(() => vi.unstubAllGlobals());

it("selects the requested input before opening its canvas review and rejects a stale or unavailable handoff", () => {
  const project = createSmartKpiMeasuredFixture();
  const nodeId = project.rootNodeId;
  const node = project.graph.nodes.find(node => node.id === nodeId)!;
  node.type = "input";
  const initialProject = structuredClone(project);
  let selectedNode = "other";
  const selectNode = vi.fn((id: string) => { selectedNode = id; });
  const baseState = { project, workspace: { activeProjectId: "project", activeVdtId: "vdt" }, selectNode };
  let state = baseState;
  const rail = {} as HTMLElement;
  const canvasButton = { closest: () => rail } as unknown as HTMLButtonElement;
  const chatButton = {} as HTMLButtonElement;
  const querySelector = vi.fn((): HTMLButtonElement | null => canvasButton);
  const canvas = { querySelector } as unknown as HTMLElement;
  const openReview = vi.fn(() => { expect(selectedNode).toBe(nodeId); });
  const target = new EventTarget();
  const request = { projectId: "project", vdtId: "vdt", nodeId, trigger: chatButton };
  vi.stubGlobal("CSS", { escape: (id: string) => id });
  const detach = listenForSuggestedKpiReview(target, () => canvas, () => state, openReview);

  expect(requestSuggestedKpiReview(target, request)).toBe(true);
  expect(querySelector).toHaveBeenCalledWith(`.react-flow__node[data-id="${nodeId}"] [data-smart-trigger]`);
  expect(openReview).toHaveBeenCalledExactlyOnceWith(nodeId, rail, canvasButton, chatButton);
  expect(project).toEqual(initialProject);

  state = { ...baseState, workspace: { ...baseState.workspace, activeVdtId: "different" } };
  expect(requestSuggestedKpiReview(target, request)).toBe(false);
  state = { ...baseState, workspace: { ...baseState.workspace, activeProjectId: "different" } };
  expect(requestSuggestedKpiReview(target, request)).toBe(false);
  state = baseState;
  node.formula = "manual_formula";
  expect(requestSuggestedKpiReview(target, request)).toBe(false);
  delete node.formula;
  querySelector.mockReturnValueOnce(null);
  expect(requestSuggestedKpiReview(target, request)).toBe(false);
  detach();
  expect(requestSuggestedKpiReview(target, request)).toBe(false);
  expect(openReview).toHaveBeenCalledTimes(1);
  expect(selectNode).toHaveBeenCalledExactlyOnceWith(nodeId);
});
