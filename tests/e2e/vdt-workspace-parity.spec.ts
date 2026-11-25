import { expect } from "@playwright/test";
import type { VdtProject } from "../../packages/vdt-core/src/types";
import { selectCanvasKpi, test } from "./workspace-fixture";

test("duplicates a saved VDT and creates an example without changing the source", async ({ page, request, productionWorkspace }) => {
  const { projectId, vdtId } = productionWorkspace;
  const saved = async (id: string) => (await request.get(`/api/vdt/vdts/${id}`)).json();
  const copies = async () => (await (await request.get(`/api/vdt/projects/${projectId}/vdts`)).json()).vdts as
    { vdt: { id: string; name: string } }[];
  const original = await saved(vdtId);
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: `Duplicate ${original.activeProject.name}`, exact: true }).click();
  await expect.poll(async () => (await copies()).length).toBe(2);
  const copy = (await copies()).find(({ vdt }) => vdt.id !== vdtId)!;
  const copiedModel = (await saved(copy.vdt.id)).activeProject as VdtProject;
  expect(copiedModel.graph).toEqual(original.activeProject.graph);
  expect(copiedModel.scenarios).toEqual(original.activeProject.scenarios);
  expect((await saved(vdtId)).head).toEqual(original.head);

  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("new-vdt-button").click();
  await page.getByLabel("Start from").selectOption("oee");
  await page.getByTestId("new-vdt-modal-confirm").click();
  await expect.poll(async () => (await copies()).length).toBe(3);
  const example = (await copies()).find(({ vdt }) => vdt.id !== vdtId && vdt.id !== copy.vdt.id)!;
  const exampleModel = (await saved(example.vdt.id)).activeProject as VdtProject;
  expect(exampleModel.rootNodeId).toBe("oee");
  expect(exampleModel.graph.nodes).toHaveLength(10);
  expect((await saved(vdtId)).head).toEqual(original.head);
});

test("adds, changes and removes an outgoing KPI link through the inspector", async ({ page, request, productionWorkspace }) => {
  const { projectId, vdtId } = productionWorkspace;
  const saved = async () => (await request.get(`/api/vdt/vdts/${vdtId}`)).json();
  const original = await saved();
  const editor = `/projects/${projectId}?vdt=${vdtId}`;
  const findLink = (project: VdtProject) => project.graph.edges.find(edge =>
    edge.sourceNodeId === "production_volume" && edge.targetNodeId === "calendar_time");
  await page.goto(editor);
  await selectCanvasKpi(page, "Production Volume");
  await page.getByText("Outgoing links", { exact: true }).click();
  await page.getByLabel("Target KPI").selectOption("calendar_time");
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByLabel("Link action").selectOption("edit");
  const options = page.getByLabel("Link to edit");
  const edgeId = await options.getByRole("option", { name: /^Calendar Time/ }).getAttribute("value");
  expect(edgeId).toBeTruthy();
  await options.selectOption(edgeId!);
  await page.getByLabel("Link relation").selectOption("positive_driver");
  await page.getByRole("button", { name: "Apply relation" }).click();
  expect((await saved()).head).toEqual(original.head);

  // The existing workspace navigation guard saves the edited draft.
  await page.getByTestId("back-to-project-workspace").click();
  await expect.poll(async () => findLink((await saved()).activeProject)?.relation).toBe("positive_driver");
  const edited = await saved();
  expect(edited.head.activeRevisionId).not.toBe(original.head.activeRevisionId);
  expect(edited.activeProject.graph.nodes).toEqual(original.activeProject.graph.nodes);

  await page.goto(editor);
  await selectCanvasKpi(page, "Production Volume");
  await page.getByText("Outgoing links", { exact: true }).click();
  await page.getByLabel("Link action").selectOption("edit");
  await page.getByLabel("Link to edit").selectOption(edgeId!);
  await page.getByRole("button", { name: "Remove link" }).click();
  expect((await saved()).head).toEqual(edited.head);
  await page.getByTestId("back-to-project-workspace").click();
  await expect.poll(async () => findLink((await saved()).activeProject)).toBeUndefined();
  expect((await saved()).activeProject.graph.edges).toEqual(original.activeProject.graph.edges);
});
