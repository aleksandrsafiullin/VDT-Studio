import { expect } from "@playwright/test";
import { test } from "./workspace-fixture";

test("local API agent admission accepts the browser origin without exposing its key", async ({ page }) => {
  await page.goto("/");
  // Admission is local and does not execute a provider request.
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/agent/bindings/openai", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "e2e-synthetic-admission-key", model: "gpt-6-luna", maxTokens: 1024 })
    });
    return { status: response.status, body: await response.text() };
  });
  expect(result.status, result.body).toBe(200);
  expect(JSON.parse(result.body)).toMatchObject({ ok: true, binding: { executionProfile: "model_agent", modelId: "gpt-6-luna" } });
  expect(result.body).not.toContain("e2e-synthetic-admission-key");
  expect(result.body).not.toContain("apiKey");
});

test("release smoke renders the workspace and settings in WebKit", { tag: "@webkit" }, async ({ page, productionWorkspace }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit", "Release WebKit smoke only runs in the WebKit project.");
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
  await expect(page).toHaveTitle(/VDT Studio/);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});
