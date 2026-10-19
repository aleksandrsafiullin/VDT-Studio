import { expect } from "@playwright/test";
import { test } from "./workspace-fixture";

test("saves, compares, restores and undoes a version, then retains the restored model after reload", async ({ page, productionWorkspace }) => {
  await page.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
  await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.getByTestId("version-history-button").click();
  const versions = page.getByTestId("version-history-panel");
  await versions.getByRole("button", { name: "Save version", exact: true }).click();
  await versions.getByRole("textbox", { name: "New version name", exact: true }).fill("Alpha baseline");
  await versions.getByRole("button", { name: "Save", exact: true }).click();
  await expect(versions.getByRole("heading", { name: "Alpha baseline", exact: true })).toBeVisible();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();

  await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
  const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  await expect(input).toHaveValue("220");
  await input.fill("250");
  await page.getByTestId("version-history-button").click();
  const comparison = versions.getByTestId("comparison-root-delta");
  await expect(comparison).toContainText("126,720");
  await expect(comparison).toContainText("144,000");
  await expect(versions.getByTestId("version-changes-table")).toContainText("Nominal Rate");

  await versions.getByRole("button", { name: "Restore this version", exact: true }).click();
  await expect(versions.getByRole("group", { name: "Confirm restoration", exact: true })).toBeVisible();
  await versions.getByTestId("confirm-version-restore").click();
  await expect(versions.getByTestId("version-restore-feedback")).toContainText("Your previous state was saved as a separate version.");
  await versions.getByTestId("undo-version-restore").click();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();
  await expect(input).toHaveValue("250");

  await page.getByTestId("version-history-button").click();
  await versions.getByRole("button", { name: /^Alpha baseline/ }).click();
  await versions.getByRole("button", { name: "Restore this version", exact: true }).click();
  await versions.getByTestId("confirm-version-restore").click();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();
  await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
  await expect(input).toHaveValue("220");
  await page.reload();
  await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
  await expect(input).toHaveValue("220");
  await page.getByTestId("version-history-button").click();
  await expect(versions.getByRole("button", { name: /^Alpha baseline/ })).toBeVisible();
  await expect(versions.getByRole("button", { name: /Before restoring/ }).first()).toBeVisible();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();
  await page.getByTestId("back-to-project-workspace").click();
  await page.getByTestId(`project-vdt-card-${productionWorkspace.vdtId}`).getByRole("button", { name: "Open Production Volume Driver Model", exact: true }).click();
  await page.getByTestId("version-history-button").click();
  await expect(versions.getByRole("button", { name: /^Alpha baseline/ })).toBeVisible();
  await expect(versions.getByRole("button", { name: /Before restoring/ }).first()).toBeVisible();
});
