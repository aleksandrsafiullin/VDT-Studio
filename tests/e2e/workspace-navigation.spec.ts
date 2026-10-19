import { expect } from "@playwright/test";
import { test } from "./workspace-fixture";

for (const destination of ["project", "home"] as const) {
  test(`retains manual model edits after leaving for ${destination} and reopening the VDT`, async ({ page, productionWorkspace }) => {
    await page.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
    await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
    await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
    const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
    await input.fill("250");
    await page.getByTestId(destination === "project" ? "back-to-project-workspace" : "workspace-home").click();
    if (destination === "home") {
      await expect(page.getByTestId("projects-home")).toBeVisible();
      await page.getByTestId(`open-project-${productionWorkspace.projectId}`).click();
    }
    await expect(page.getByTestId("project-vdt-list")).toBeVisible();
    await page.getByTestId(`project-vdt-card-${productionWorkspace.vdtId}`).getByRole("button", { name: "Open Production Volume Driver Model", exact: true }).click();
    await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
    await expect(input).toHaveValue("250");
    const loaded = await page.request.get(`/api/vdt/vdts/${productionWorkspace.vdtId}`);
    expect(loaded.ok()).toBeTruthy();
    const stored = await loaded.json();
    expect(stored.activeProject.graph.nodes.find((node: { id: string }) => node.id === "nominal_rate").baselineValue).toBe(250);
  });
}

test("blocks navigation on a revision conflict and preserves the visible local edits", async ({ page, productionWorkspace }) => {
  await page.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
  await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
  await page.getByRole("button", { name: "Select Nominal Rate", exact: true }).click();
  const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  await input.fill("250");
  const revisionUrl = `**/api/vdt/vdts/${productionWorkspace.vdtId}/revisions`;
  await page.route(revisionUrl, (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 409, json: { ok: false, error: "This VDT changed on the server.", code: "REVISION_CONFLICT", retryable: false } })
    : route.fallback());
  await page.getByTestId("back-to-project-workspace").click();
  await expect(page.getByTestId("workspace-navigation-error")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`vdt=${productionWorkspace.vdtId}`));
  await expect(input).toHaveValue("250");
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  await page.unroute(revisionUrl);
  await page.getByTestId("back-to-project-workspace").click();
  await expect(page.getByTestId("project-vdt-list")).toBeVisible();
});
