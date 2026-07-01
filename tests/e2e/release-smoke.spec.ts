import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const E2E_PROJECT_ID = "project_e2e_release_smoke";
const E2E_VDT_ID = "vdt_e2e_release_smoke";
const productionVolumeExamplePath = path.join(process.cwd(), "examples", "production-volume.json");

async function openReleaseSmokeEditor(page: Page) {
  const project = JSON.parse(fs.readFileSync(productionVolumeExamplePath, "utf8")) as Record<string, unknown>;
  const createProject = await page.request.post("/api/vdt/projects", {
    data: {
      id: E2E_PROJECT_ID,
      name: "Release smoke project",
      industry: project.industry
    }
  });
  if (createProject.status() !== 409) {
    expect(createProject.ok()).toBeTruthy();
  }

  const createVdt = await page.request.post(`/api/vdt/projects/${E2E_PROJECT_ID}/vdts`, {
    data: {
      id: E2E_VDT_ID,
      name: project.name,
      rootKpi: "Production Volume",
      project
    }
  });
  if (createVdt.status() !== 409) {
    expect(createVdt.ok()).toBeTruthy();
  }

  await page.goto(`/projects/${E2E_PROJECT_ID}?vdt=${E2E_VDT_ID}`);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
}

test("release smoke renders the workspace and settings in WebKit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit", "Release WebKit smoke only runs in the WebKit project.");
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await openReleaseSmokeEditor(page);
  await expect(page).toHaveTitle(/VDT Studio/);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});
