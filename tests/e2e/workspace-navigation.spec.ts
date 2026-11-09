import { expect, type Page } from "@playwright/test";
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
    const loaded = await page.request.get(`/api/vdt/vdts/${productionWorkspace.vdtId}`, { maxRetries: 1 });
    expect(loaded.ok()).toBeTruthy();
    const stored = await loaded.json();
    expect(stored.activeProject.graph.nodes.find((node: { id: string }) => node.id === "nominal_rate").baselineValue).toBe(250);
  });
}

test("a stale second tab keeps its draft and cannot overwrite another tab's saved revision", async ({ page, context, productionWorkspace }) => {
  const { projectId, vdtId } = productionWorkspace;
  const editorUrl = `/projects/${projectId}?vdt=${vdtId}`;
  const storageUrl = `/api/vdt/vdts/${vdtId}`;
  const second = await context.newPage();

  async function openEditor(tab: Page) {
    await tab.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
    await tab.goto(editorUrl);
    await expect(tab.getByTestId("vdt-canvas")).toBeVisible();
  }
  async function selectValue(tab: Page, name: string) {
    await tab.getByRole("button", { name: `Select ${name}`, exact: true }).click();
    return tab.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  }
  async function storedModel() {
    const response = await page.request.get(storageUrl, { maxRetries: 1 });
    expect(response.ok()).toBeTruthy();
    const { head, activeProject } = await response.json();
    const value = (id: string) => activeProject.graph.nodes.find((node: { id: string }) => node.id === id)?.baselineValue;
    return { head, rate: value("nominal_rate"), downtime: value("planned_downtime") };
  }

  try {
    await openEditor(page);
    await openEditor(second);
    await (await selectValue(page, "Nominal Rate")).fill("321");
    const secondValue = await selectValue(second, "Planned Downtime");
    await secondValue.fill("45");

    await page.getByTestId("back-to-project-workspace").click();
    await expect(page.getByTestId("project-vdt-list")).toBeVisible();
    const saved = await storedModel();
    expect(saved).toMatchObject({ head: { commitGeneration: 2 }, rate: 321, downtime: 40 });

    const secondBack = second.getByTestId("back-to-project-workspace");
    const error = second.getByTestId("workspace-navigation-error");
    let attempts = 0;
    second.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`${storageUrl}/revisions`)) attempts++;
    });
    const conflict = second.waitForResponse((response) => response.url().endsWith(`${storageUrl}/revisions`)
      && response.request().method() === "POST");
    await secondBack.click();
    expect((await conflict).status()).toBe(409);
    await expect(error).toContainText("Your local edits are still open");
    await expect(secondBack).toHaveAttribute("aria-busy", "false");
    await secondBack.click();
    await expect(error).toContainText("Your local edits are still open");
    await expect(secondBack).toHaveAttribute("aria-busy", "false");
    await expect(second).toHaveURL(new RegExp(`vdt=${vdtId}`));
    await expect(secondValue).toHaveValue("45");
    expect(attempts).toBe(1);
    expect(await storedModel()).toEqual(saved);

    await error.getByRole("button", { name: "Discard local edits and reload" }).click();
    await expect(error).toBeHidden();
    await expect(await selectValue(second, "Nominal Rate")).toHaveValue("321");
    const reloadedDowntime = await selectValue(second, "Planned Downtime");
    await expect(reloadedDowntime).toHaveValue("40");
    await reloadedDowntime.fill("45");
    await secondBack.click();
    await expect(second.getByTestId("project-vdt-list")).toBeVisible();
    expect(await storedModel()).toMatchObject({ head: { commitGeneration: 3 }, rate: 321, downtime: 45 });
  } finally {
    await second.close();
  }
});
