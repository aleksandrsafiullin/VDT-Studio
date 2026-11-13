import { expect, type Page } from "@playwright/test";
import { selectCanvasKpi, test } from "./workspace-fixture";

for (const destination of ["project", "home"] as const) {
  test(`retains manual model edits after leaving for ${destination} and reopening the VDT`, async ({ page, productionWorkspace }) => {
    await page.route("**/api/ai/detect-clis**", (route) => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
    await page.goto(`/projects/${productionWorkspace.projectId}?vdt=${productionWorkspace.vdtId}`);
    await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    const storageUrl = `/api/vdt/vdts/${productionWorkspace.vdtId}`;
    const storedModel = async () => {
      const loaded = await page.request.get(storageUrl, { maxRetries: 1 });
      expect(loaded.ok()).toBeTruthy();
      return loaded.json();
    };
    async function leaveAndReopen() {
      await page.getByTestId(destination === "project" ? "back-to-project-workspace" : "workspace-home").click();
      if (destination === "home") {
        await expect(page.getByTestId("projects-home")).toBeVisible();
        await page.getByTestId(`open-project-${productionWorkspace.projectId}`).click();
      }
      await expect(page.getByTestId("project-vdt-list")).toBeVisible();
      await page.getByTestId(`project-vdt-card-${productionWorkspace.vdtId}`).getByRole("button", { name: "Open Production Volume Driver Model", exact: true }).click();
      await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    }
    const initial = await storedModel();
    await leaveAndReopen();
    const unchanged = await storedModel();
    expect(unchanged.head).toEqual(initial.head);
    expect(unchanged.revisions).toHaveLength(initial.revisions.length);
    await selectCanvasKpi(page, "Nominal Rate");
    const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
    await input.fill("250");
    await leaveAndReopen();
    await selectCanvasKpi(page, "Nominal Rate");
    await expect(input).toHaveValue("250");
    const stored = await storedModel();
    expect(stored.revisions).toHaveLength(initial.revisions.length + 1);
    expect(stored.head.commitGeneration).toBe(initial.head.commitGeneration + 1);
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
    await selectCanvasKpi(tab, name);
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

test("cold Home launch restores an unsaved draft in its original VDT", async ({ page, productionWorkspace, request }) => {
  const { projectId, vdtId } = productionWorkspace;
  const saved = async () => (await request.get(`/api/vdt/vdts/${vdtId}`)).json();
  await page.goto(`/projects/${projectId}?vdt=${vdtId}`);
  await selectCanvasKpi(page, "Nominal Rate");
  const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  const before = await saved();
  await input.fill("250");
  await expect(input).toHaveValue("250");
  const versions = page.getByTestId("version-history-panel");
  await page.getByTestId("version-history-button").click();
  await versions.getByRole("button", { name: "Save version", exact: true }).click();
  await versions.getByRole("textbox", { name: "New version name", exact: true }).fill("Draft milestone");
  await versions.getByRole("button", { name: "Save", exact: true }).click();
  await expect(versions.getByRole("heading", { name: "Draft milestone", exact: true })).toBeVisible();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?vdt=${vdtId}$`));
  await selectCanvasKpi(page, "Nominal Rate");
  await expect(input).toHaveValue("250");
  expect((await saved()).head).toEqual(before.head);
  await page.getByTestId("version-history-button").click();
  await expect(versions.getByRole("button", { name: /^Draft milestone/ })).toBeVisible();
  await versions.getByRole("button", { name: "Close versions", exact: true }).click();
  await page.getByTestId("workspace-home").click();
  await expect(page.getByTestId("projects-home")).toBeVisible();
  expect((await saved()).activeProject.graph.nodes.find((node: { id: string }) => node.id === "nominal_rate").baselineValue).toBe(250);
});


test("cold Home launch keeps a deleted VDT draft available for explicit download", async ({ page, productionWorkspace, request }) => {
  const { projectId, vdtId } = productionWorkspace;
  await page.goto(`/projects/${projectId}?vdt=${vdtId}`);
  await selectCanvasKpi(page, "Nominal Rate");
  const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  await input.fill("250");
  expect((await request.delete(`/api/vdt/vdts/${vdtId}`)).ok()).toBeTruthy();
  await page.goto("/");
  const download = page.getByRole("button", { name: "Download local draft" });
  await expect(download).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await download.click();
  expect((await downloaded).suggestedFilename()).toBe("recovered-vdt-draft.json");
  await expect(page).toHaveURL(/\/$/);
});

test("cold Home launch retains a stale draft without replacing the newer saved VDT", async ({ page, context, productionWorkspace, request }) => {
  const { projectId, vdtId } = productionWorkspace;
  const url = `/projects/${projectId}?vdt=${vdtId}`;
  const baseline = (editor: Page) => editor.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  await page.goto(url);
  const otherContext = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const other = await otherContext.newPage();
    await other.goto(url);
    await selectCanvasKpi(other, "Nominal Rate");
    await baseline(other).fill("275");
    await other.getByTestId("workspace-home").click();
    await expect(other.getByTestId("projects-home")).toBeVisible();
    await selectCanvasKpi(page, "Nominal Rate");
    await baseline(page).fill("250");
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?vdt=${vdtId}$`));
    await selectCanvasKpi(page, "Nominal Rate");
    await expect(baseline(page)).toHaveValue("250");
    await page.getByTestId("workspace-home").click();
    await expect(page.getByTestId("workspace-navigation-error")).toBeVisible();
    const saved = await (await request.get(`/api/vdt/vdts/${vdtId}`)).json();
    expect(saved.activeProject.graph.nodes.find((node: { id: string }) => node.id === "nominal_rate").baselineValue).toBe(275);
  } finally {
    await otherContext.close();
  }
});
