import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("support report requires a local preview and downloads exactly the reviewed snapshot", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("github.com")) externalRequests.push(request.url()); });
  await page.route("**/api/support/build", route => route.fulfill({ json: {
    version: "0.1.0-alpha.2", commit: "a".repeat(40), dirty: false, builtAt: "2026-11-13T10:30:00.000Z",
    platform: "win32", architecture: "x64", nodeVersion: "v24.15.0", apiKey: "sk-private-test-value", personalPath: "C:\\Users\\Private\\project"
  } }));
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-nav-support").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("support-build-identity")).toContainText("0.1.0-alpha.2 · aaaaaaaaaaaa");
  const downloadButton = page.getByRole("button", { name: "Download diagnostics", exact: true });
  const prepare = page.getByRole("button", { name: "Prepare diagnostic report", exact: true });
  const includeNames = page.getByRole("checkbox", { name: "Include model names" });
  await expect(includeNames).not.toBeChecked();
  await expect(downloadButton).toBeDisabled();
  await prepare.focus();
  await page.keyboard.press("Enter");
  const preview = page.getByRole("textbox", { name: "Diagnostic report preview", exact: true });
  await expect(preview).toBeFocused();
  expect(JSON.parse(await preview.inputValue())).toMatchObject({
    modelNames: "omitted", execution: { chat: { model: "omitted" }, suggestedKpi: { model: "omitted" } }
  });
  await includeNames.focus();
  await page.keyboard.press("Space");
  await expect(includeNames).toBeChecked();
  await expect(preview).toHaveCount(0);
  await expect(downloadButton).toBeDisabled();
  await prepare.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toBeFocused();
  const json = await preview.inputValue();
  expect(JSON.parse(json)).toMatchObject({ modelNames: "explicitly_included_when_eligible" });
  expect(JSON.parse(json)).toMatchObject({ schemaVersion: "vdt_support_report.v1", build: { version: "0.1.0-alpha.2", platform: "win32", architecture: "x64" } });
  expect(json).not.toContain("sk-private-test-value");
  expect(json).not.toContain("C:\\Users");
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^vdt-diagnostics-.*\.json$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await readFile(path!, "utf8")).toBe(json);
  await includeNames.focus();
  await page.keyboard.press("Space");
  await expect(includeNames).not.toBeChecked();
  await expect(preview).toHaveCount(0);
  await expect(downloadButton).toBeDisabled();
  expect(externalRequests).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-button")).toBeFocused();
});

test("support keeps diagnostics available when platform metadata cannot load", async ({ page }) => {
  await page.route("**/api/support/build", route => route.fulfill({ status: 500, json: { error: "private server path /Users/Private/key" } }));
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("settings-nav-support").click();
  await expect(page.getByText("Platform details could not be loaded.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("support-settings")).not.toContainText("/Users/Private");
  await page.getByRole("button", { name: "Prepare diagnostic report", exact: true }).click();
  const report = JSON.parse(await page.getByRole("textbox", { name: "Diagnostic report preview", exact: true }).inputValue());
  expect(report.build.platform).toBe("unknown");
  expect(report.build.architecture).toBe("unknown");
  await expect(page.getByRole("textbox", { name: "Report address", exact: true })).toHaveValue("https://github.com/aleksandrsafiullin/VDT-Studio/issues/new/choose");
});
