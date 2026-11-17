import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { selectCanvasKpi } from "./workspace-fixture";
import type { VdtProject } from "../../packages/vdt-core/src/types";

for (const dirty of [false, true]) test(`continues from a saved copy with a ${dirty ? "dirty" : "clean"} draft and retains source access @chromium`, async ({ page, request, context }, testInfo) => {
  const owned = process.env.VDT_E2E_SAVED_COPY_ROOT;
  test.skip(!owned, "Run this test through the dedicated saved-copy gate.");
  const { dataDir } = JSON.parse(fs.readFileSync(path.join(owned!, "server-owner.json"), "utf8")) as { dataDir: string };
  expect(path.dirname(fs.realpathSync(dataDir))).toBe(owned);
  const suffix = randomUUID().replaceAll("-", "");
  const projectId = `project_recovery_${suffix}`;
  const vdtId = `vdt_recovery_${suffix}`;
  const runId = `run_recovery_${suffix}`;
  const csv = "Sales,Orders\n42,7\n51,9\n";
  const graph = JSON.parse(fs.readFileSync(path.resolve("examples/production-volume.json"), "utf8")) as VdtProject;
  const created = await request.post("/api/vdt/projects", { data: { id: projectId, name: "Interrupted agent fixture" } });
  expect(created.status(), await created.text()).toBe(201);
  let detachedContext: import("@playwright/test").BrowserContext | undefined;
  try {
    const { summary: { runtimeState } } = await created.json();
    const save = (project: VdtProject) => request.post(`/api/vdt/projects/${projectId}/vdts`, { data: {
      schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: runId,
      expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: runtimeState.runtimeGeneration, generationVersion: runtimeState.generationVersion },
      vdt: { requestedVdtId: vdtId, name: graph.name, rootKpi: "Production Volume", unit: null, timePeriod: null, status: "draft", metadata: null },
      project
    } });
    const upload = await request.post("/api/data/files", { multipart: { projectId,
      file: { name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }
    } });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const { datasetId } = await upload.json();
    graph.dataSources.push({ id: "sales_source", name: "Sales fixture", type: "file", file: {
      fileName: "sales.csv", mimeType: "text/csv", storageRef: datasetId, sizeBytes: Buffer.byteLength(csv), tableCount: 1,
      contentHash: `sha256:${createHash("sha256").update(csv).digest("hex")}`, uploadedAt: "2026-11-13T00:00:00.000Z"
    } });
    const saved = await save(graph);
    expect(saved.status(), await saved.text()).toBe(201);
    const { head } = await saved.json();
    const attached = await request.patch(`/api/data/files/${datasetId}?projectId=${projectId}`, { data: { action: "attach", vdtId } });
    expect(attached.ok(), await attached.text()).toBeTruthy();
    execFileSync(process.execPath, ["--import", "tsx", "tests/e2e/seed-saved-copy-recovery.ts", dataDir, projectId, vdtId, runId], {
      env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json") }, encoding: "utf8", timeout: 15_000
    });
    const snapshotResponse = await request.get(`/api/agent/runs/${runId}`);
    expect(snapshotResponse.ok(), await snapshotResponse.text()).toBeTruthy();
    const { snapshot } = await snapshotResponse.json();
    expect(snapshot.status).toBe("recovery_required");
    const url = `/projects/${projectId}?vdt=${vdtId}`;
    await page.goto(url);
    await expect(page.getByTestId("vdt-canvas")).toBeVisible();

    await page.addInitScript(({ snapshot, runId, projectId, vdtId }) => {
      if (sessionStorage.getItem("w1-browser-run-seeded")) return;
      sessionStorage.setItem("w1-browser-run-seeded", "true");
      const key = "vdt-studio-state";
      const persisted = JSON.parse(localStorage.getItem(key)!);
      const time = snapshot.updatedAt;
      persisted.state.agentRun = snapshot;
      persisted.state.activeAgentRunId = runId;
      persisted.state.pendingIncomingKpiRestart = { runId, workspaceId: projectId, vdtId };
      persisted.state.generateActivity = {
        runId, status: "recovery_required", phase: "preparing_request", phaseStartedAt: time, startedAt: time, updatedAt: time,
        providerId: "mock", providerLabel: "Model Agent", appMode: "development_web", canCancel: true, cancelRequested: false,
        publicStatus: snapshot.publicStatus, runtimeAgentRun: snapshot
      };
      localStorage.setItem(key, JSON.stringify(persisted));
    }, { snapshot, runId, projectId, vdtId });
    await page.reload();
    const copy = page.getByRole("button", { name: "Continue from saved copy", exact: true });
    await expect(copy).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("interrupted-run.png") });
    await selectCanvasKpi(page, "Nominal Rate");
    const input = page.getByTestId("right-panel").getByRole("spinbutton", { name: "Baseline value", exact: true });
    if (dirty) await input.fill("250");
    const post = page.waitForResponse(response => response.url().endsWith(`/${runId}/saved-copy`));
    await copy.click();
    const copied = await post;
    expect(copied.ok(), await copied.text()).toBeTruthy();
    const { vdtId: copyId } = await copied.json();
    if (dirty) detachedContext = await context.browser()!.newContext({ baseURL: new URL(page.url()).origin });
    const copyContext = detachedContext ?? context;
    const copyPage = dirty ? await copyContext.newPage() : page;
    if (dirty) {
      const outcome = page.getByTestId("saved-copy-outcome");
      await expect(outcome).toHaveText("The saved copy is in this project's VDT list. Your open draft was kept.");
      await expect(outcome).toBeInViewport({ ratio: 1 });
      await expect(input).toHaveValue("250");
      await page.screenshot({ path: testInfo.outputPath("dirty-draft-preserved.png") });
      await copyPage.goto(`/projects/${projectId}?vdt=${copyId}`);
    }
    await expect.poll(() => copyPage.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.workspace.activeVdtId)).toBe(copyId);
    await expect(copyPage.getByTestId("vdt-canvas")).toBeVisible();
    await expect(copyPage.getByRole("button", { name: "Continue from saved copy", exact: true })).toHaveCount(0);
    expect((await (await request.get(`/api/vdt/vdts/${vdtId}`)).json()).head).toEqual(head);
    await copyPage.getByRole("button", { name: "Open VDT files", exact: true }).click();
    const downloadLink = copyPage.getByRole("link", { name: "Download sales.csv", exact: true });
    await expect(downloadLink).toBeVisible();
    await copyPage.screenshot({ path: testInfo.outputPath("saved-copy-files.png") });
    const scoped = await copyPage.request.get(`/api/data/files/${datasetId}?projectId=${projectId}&vdtId=${copyId}`);
    expect(scoped.ok(), await scoped.text()).toBeTruthy();
    expect(await scoped.text()).toBe(csv);
    const downloaded = copyPage.waitForEvent("download");
    await downloadLink.click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("sales.csv");
    expect(fs.readFileSync((await download.path())!, "utf8")).toBe(csv);
    const originalRun = await request.get(`/api/agent/runs/${runId}`);
    expect((await originalRun.json()).snapshot.status).toBe("recovery_required");
  } finally {
    await detachedContext?.close();
    const deleted = await request.delete(`/api/vdt/projects/${projectId}`);
    expect([200, 404]).toContain(deleted.status());
  }
});
