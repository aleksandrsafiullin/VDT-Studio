import { expect, test } from "@playwright/test";

test("release smoke renders the workspace and settings in WebKit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "webkit", "Release WebKit smoke only runs in the WebKit project.");
  await page.goto("/");
  await expect(page).toHaveTitle(/VDT Studio/);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});
