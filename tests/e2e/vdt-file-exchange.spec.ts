import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import type { VdtProject } from "../../packages/vdt-core/src/types";
import { selectCanvasKpi, test } from "./workspace-fixture";

test("downloads the visible VDT as CLI-compatible JSON and Markdown", async ({ page, request, productionWorkspace }, testInfo) => {
  const { projectId, vdtId } = productionWorkspace;
  const stored = async () => (await request.get(`/api/vdt/vdts/${vdtId}`)).json();
  const initial = await stored();
  await page.route("**/api/ai/detect-clis**", route => route.fulfill({ json: { agents: [], modelsByAgent: {} } }));
  await page.goto(`/projects/${projectId}?vdt=${vdtId}`);

  const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
  await selectCanvasKpi(page, "Nominal Rate");
  await input.clear();
  await selectCanvasKpi(page, "Planned Downtime");
  await input.fill("0");
  await input.blur();

  const trigger = page.getByTestId("vdt-export-formats");
  const exportJson = page.getByRole("button", { name: "Export to JSON", exact: true });
  const exportMarkdown = page.getByRole("button", { name: "Export to Markdown", exact: true });
  await expect(exportJson).toBeHidden();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(exportJson).toBeVisible();
  await exportJson.focus();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(exportJson).toBeHidden();

  async function download(format: "json" | "md") {
    await trigger.click();
    const pending = page.waitForEvent("download");
    await (format === "json" ? exportJson : exportMarkdown).click();
    const result = await pending;
    expect(result.suggestedFilename()).toBe(`Production Volume Driver Model.${format}`);
    await expect(trigger).toBeFocused();
    return result;
  }

  const jsonPath = testInfo.outputPath("visible-vdt.json");
  await (await download("json")).saveAs(jsonPath);
  const project = JSON.parse(await readFile(jsonPath, "utf8")) as VdtProject;
  expect(project.graph.nodes.find(node => node.id === "nominal_rate")?.baselineValue).toBeUndefined();
  expect(project.graph.nodes.find(node => node.id === "planned_downtime")?.baselineValue).toBe(0);

  const markdownPath = testInfo.outputPath("visible-vdt.md");
  await (await download("md")).saveAs(markdownPath);
  const markdown = await readFile(markdownPath, "utf8");
  expect(markdown).toContain("**Production Volume**: n/a");
  expect(markdown).toContain("Missing value for Nominal Rate.");
  expect(markdown).toContain("**Planned Downtime** = 0");
  function cliExport(format: "json" | "markdown") {
    return execFileSync(process.execPath, ["--import", "tsx", "packages/cli/src/bin.ts", "export", jsonPath, "--format", format], { encoding: "utf8" });
  }
  expect(JSON.parse(cliExport("json"))).toEqual(project);
  expect(cliExport("markdown")).toBe(markdown);
  expect((await stored()).head).toEqual(initial.head);
});
