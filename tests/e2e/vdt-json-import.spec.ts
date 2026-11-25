import { expect } from "@playwright/test";
import { createVersionSnapshot, exportProjectJson } from "../../packages/vdt-core/src/index";
import type { VdtProject } from "../../packages/vdt-core/src/types";
import { test } from "./workspace-fixture";

test("reviews a portable JSON VDT and saves a new copy after a failed create", async ({ page, request, productionWorkspace }) => {
  const { projectId, vdtId } = productionWorkspace;
  const vdtsUrl = "/api/vdt/projects/" + projectId + "/vdts";
  const existing = async () => (await request.get("/api/vdt/vdts/" + vdtId)).json();
  const original = await existing();
  const storedVdts = async () => (await (await request.get(vdtsUrl)).json()).vdts as { vdt: { id: string; name: string } }[];
  const initialVdtIds = (await storedVdts()).map(({ vdt }) => vdt.id);
  const model = structuredClone(original.activeProject as VdtProject);
  model.name = "From portable VDT";
  const rate = model.graph.nodes.find(({ id }) => id === "nominal_rate")!;
  const downtime = model.graph.nodes.find(({ id }) => id === "planned_downtime")!;
  delete rate.baselineValue;
  delete rate.value;
  rate.valueStatus = "unknown";
  downtime.baselineValue = 0;
  downtime.dataMapping = { sourceId: "external_rate", field: "Hours" };
  downtime.valueSource = { sourceTier: "file", catalogRef: "foreign_data_ref", note: "Confirmed from the approved extract." };
  model.scenarios[0]!.comments = [{ nodeId: downtime.id, text: "Reviewer checked zero." }];
  model.dataSources = [{ id: "external_rate", type: "file", name: "Original file", file: {
    fileName: "old.csv", storageRef: "foreign_data_ref", contentHash: "sha256:example",
    sizeBytes: 32, mimeType: "text/csv", uploadedAt: model.updatedAt, tableCount: 1
  } }];
  const portable = createVersionSnapshot(model, { name: "Reviewed version" });
  const file = (name: string, text: string) => ({ name, mimeType: "application/json", buffer: Buffer.from(text) });
  await page.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
  await page.goto("/projects/" + projectId);

  await page.getByTestId("import-vdt-json").click();
  const review = page.getByTestId("import-vdt-json-review");
  const picker = page.getByTestId("import-vdt-json-file");
  const confirm = page.getByTestId("import-vdt-json-create");
  await expect(review).toBeVisible();
  await picker.setInputFiles(file("broken.json", "{"));
  await expect(review.getByRole("alert")).toContainText("could not be parsed");
  await expect(confirm).toBeDisabled();
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).toBeHidden();
  expect((await storedVdts()).map(({ vdt }) => vdt.id)).toEqual(initialVdtIds);

  await page.evaluate(() => {
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "slow.json") return originalText.call(this);
      return new Promise<string>((resolve) => {
        document.addEventListener("test:release-slow-vdt", () => void originalText.call(this).then(resolve), { once: true });
      });
    };
  });
  await page.getByTestId("import-vdt-json").click();
  await picker.setInputFiles(file("slow.json", exportProjectJson({ ...portable, name: "Superseded candidate" })));
  await expect(review.getByRole("status")).toContainText("Reading file");
  await picker.setInputFiles(file("new-vdt.json", exportProjectJson(portable)));
  const summary = page.getByTestId("import-vdt-json-summary");
  await expect(summary).toContainText("From portable VDT");
  await expect(summary).toContainText("Source attachments and external mappings are detached");
  await page.evaluate(() => document.dispatchEvent(new Event("test:release-slow-vdt")));
  await expect(summary).toContainText("From portable VDT");
  expect((await storedVdts()).map(({ vdt }) => vdt.id)).toEqual(initialVdtIds);

  const attempts: unknown[] = [];
  await page.route("**" + vdtsUrl, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    return attempts.length === 1
      ? route.fulfill({ status: 503, json: { ok: false, error: { code: "TEMPORARY", message: "Temporary test storage failure.", retryable: true } } })
      : route.continue();
  });
  await confirm.click();
  await expect(review.getByRole("alert")).toContainText("Temporary test storage failure.");
  await expect(summary).toContainText("From portable VDT");
  expect((await storedVdts()).map(({ vdt }) => vdt.id)).toEqual(initialVdtIds);
  expect((await existing()).head).toEqual(original.head);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === vdtsUrl && response.ok());
  await confirm.click();
  await created;
  await expect(review).toBeHidden();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  const copies = (await storedVdts()).filter(({ vdt }) => !initialVdtIds.includes(vdt.id));
  expect(copies).toHaveLength(1);
  const copyId = copies[0]!.vdt.id;
  expect(copies[0]?.vdt.name).toBe(portable.name);
  const { activeProject } = await (await request.get("/api/vdt/vdts/" + copyId)).json() as { activeProject: VdtProject };
  expect(activeProject.id).toBe(portable.id);
  expect(activeProject.graph.edges).toEqual(portable.graph.edges);
  expect(activeProject.graph.nodes.find(({ id }) => id === rate.id)).toMatchObject({ valueStatus: "unknown" });
  expect(activeProject.graph.nodes.find(({ id }) => id === rate.id)?.baselineValue).toBeUndefined();
  expect(activeProject.graph.nodes.find(({ id }) => id === downtime.id)).toMatchObject({ baselineValue: 0, valueSource: { note: downtime.valueSource.note } });
  expect(activeProject.graph.nodes.find(({ id }) => id === downtime.id)?.dataMapping).toBeUndefined();
  expect(activeProject.scenarios).toEqual(portable.scenarios);
  expect(activeProject.dataSources).toEqual([]);
  expect(activeProject.versions.at(-1)?.name).toBe("Reviewed version");
  expect(activeProject.versions.at(-1)?.projectSnapshot.dataSources).toEqual([]);
  expect(JSON.stringify(activeProject)).not.toContain("foreign_data_ref");
  expect((await existing()).head).toEqual(original.head);
});
