import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.addInitScript(() => {
    const capturedExports: { filename: string; type: string; text: string }[] = [];
    Reflect.set(window, "__vdtCapturedExports", capturedExports);
    Reflect.set(window, "__vdtCaptureDownload", (artifact: { filename: string; type: string; text: string }) => {
      capturedExports.push(artifact);
    });
  });
  await page.goto("/");
});

test("renders the workspace and can regenerate the mock VDT", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Full workspace smoke runs on desktop viewport.");

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await expect(page).toHaveTitle(/VDT Studio/);
  await expect(page.getByRole("button", { name: /Generate VDT with AI/i })).toBeVisible();
  await expect(page.getByText("Visual flow: root to drivers.")).toBeVisible();

  await page.getByRole("button", { name: /Generate VDT with AI/i }).click();

  await expect(page.getByRole("heading", { name: "Production Volume Driver Model" })).toBeVisible();
  await expect(page.getByText("Model graph valid")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("runs the downtime scenario and shows impacted drivers", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Detailed scenario smoke runs on desktop viewport.");

  const unplannedDowntimeOverride = page
    .locator("label")
    .filter({ hasText: "Unplanned Downtime" })
    .getByRole("spinbutton");

  await unplannedDowntimeOverride.fill("60");

  await expect(page.getByText("117,849.6").first()).toBeVisible();
  await expect(page.getByText("Impacted drivers")).toBeVisible();
  await expect(page.getByText(/mainly through/i)).toBeVisible();
  await expect(page.getByText("Unplanned Downtime").last()).toBeVisible();
});

test("generates JSON and SVG export artifacts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Export artifact smoke runs on desktop viewport.");

  await expect(page.getByText("Model graph valid")).toBeVisible();
  await expect(page.getByRole("button", { name: "JSON" })).toBeVisible();
  await page.getByRole("button", { name: "JSON" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.length ?? 0))
    .toBeGreaterThanOrEqual(1);
  const jsonArtifact = await page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.[0]);
  const json = JSON.parse(jsonArtifact.text) as { rootNodeId?: string };
  expect(jsonArtifact.type).toBe("application/json");
  expect(json.rootNodeId).toBe("production_volume");

  await page.getByRole("button", { name: "SVG" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.length ?? 0))
    .toBeGreaterThanOrEqual(2);
  const svgArtifact = await page.evaluate(() => Reflect.get(window, "__vdtCapturedExports")?.[1]);
  expect(svgArtifact.type).toBe("image/svg+xml");
  expect(svgArtifact.text).toContain("<svg");
  expect(svgArtifact.text).toContain("Production Volume Driver Model");
});

test("keeps the primary creation flow usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile smoke only runs on the mobile project.");

  await expect(page.getByText("New VDT")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate VDT with AI/i })).toBeVisible();
});
