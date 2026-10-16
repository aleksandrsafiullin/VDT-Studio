import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Page, type Response as BrowserResponse } from "@playwright/test";
import { productionVolumeProject, type VdtProject } from "../../packages/vdt-core/src/index";
import type { DataDiscoveryRunSnapshot } from "../../packages/data-harness/src/index";
import { revisionCasFromHead, runtimeCasFromState, type ProjectRuntimeStateV1, type VdtRevisionHeadV2 } from "../../apps/web/lib/vdt-storage-client";

// Reuse the parser package's existing dependency; no test-only workbook library.
const XLSX = createRequire(path.resolve("packages/data-harness/package.json"))("xlsx") as {
  utils: { book_new(): unknown; aoa_to_sheet(rows: unknown[][]): unknown; book_append_sheet(book: unknown, sheet: unknown, name: string): void };
  write(book: unknown, options: { type: "buffer"; bookType: "xlsx" }): Buffer;
};

interface OwnedFixture { projectId: string; vdtId: string }
const SERVER_TIMEOUT = 120_000;
interface OwnedCleanup {
  fixture?: OwnedFixture;
  serverRequests: Set<Promise<void>>;
  cleaningUp: boolean;
}
const cleanupByTestId = new Map<string, OwnedCleanup>();

test.afterEach(async ({ page }, testInfo) => {
  // Teardown gets a separate budget even when the test's own timeout was exhausted.
  testInfo.setTimeout(SERVER_TIMEOUT * 2 + 10_000);
  const cleanup = cleanupByTestId.get(testInfo.testId);
  if (!cleanup) return;
  cleanup.cleaningUp = true;
  while (cleanup.serverRequests.size) await Promise.allSettled([...cleanup.serverRequests]);
  if (cleanup.fixture) {
    const deleted = await page.request.delete(`/api/vdt/projects/${cleanup.fixture.projectId}`, { timeout: SERVER_TIMEOUT });
    expect([200, 404], "Only this test's disposable project is deleted").toContain(deleted.status());
  }
  cleanupByTestId.delete(testInfo.testId);
});

function waitForDataResponse(page: Page, pathname: string | RegExp, method: "GET" | "POST") {
  return page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return response.request().method() === method && (typeof pathname === "string" ? path === pathname : pathname.test(path));
  }, { timeout: SERVER_TIMEOUT });
}

async function requireOk(response: BrowserResponse) {
  if (!response.ok()) throw new Error(`${response.request().method()} ${new URL(response.url()).pathname} returned ${response.status()}: ${(await response.text()).slice(0, 2000)}`);
}

async function analyzeAndWait(page: Page) {
  const discovery = waitForDataResponse(page, "/api/data/discovery/runs", "POST");
  await page.getByTestId("data-import-analyze").click();
  await requireOk(await discovery);
  await expect(page.getByTestId("data-import-result")).toBeVisible({ timeout: SERVER_TIMEOUT });
}

async function stageAndWait(page: Page) {
  const validation = waitForDataResponse(page, /\/api\/data\/discovery\/runs\/[^/]+\/apply$/, "POST");
  await page.getByTestId("data-import-stage-preview").click();
  await requireOk(await validation);
  await expect(page.getByTestId("data-import-wizard")).toHaveCount(0);
}

async function createFixture(page: Page, register: (fixture: OwnedFixture) => void): Promise<OwnedFixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const projectId = `project_file_ui_${suffix}`;
  const vdtId = `vdt_file_ui_${suffix}`;
  const created = await page.request.post("/api/vdt/projects", { timeout: SERVER_TIMEOUT, data: { id: projectId, name: "Disposable file KPI UI test" } });
  expect(created.ok()).toBeTruthy();
  register({ projectId, vdtId });
  const payload = await created.json() as { summary: { runtimeState: { runtimeGeneration: "v1" | "v2"; generationVersion: number } } };
  const project = structuredClone(productionVolumeProject);
  // Imported/legacy graphs retain their own identity, distinct from the stored VDT record.
  project.id = `legacy_graph_file_ui_${suffix}`;
  project.name = "File KPI test";
  const now = "2026-10-16T00:00:00.000Z";
  project.rootNodeId = "test_root";
  project.graph = {
    nodes: [
      { id: "test_root", name: "All downtime", type: "root_kpi", status: "accepted", aiGenerated: false, unit: "h/day", formula: "downtime_target + other_target", position: { x: 0, y: 100 }, createdAt: now, updatedAt: now },
      { id: "downtime_target", name: "Простои в сутки", type: "input", status: "accepted", aiGenerated: false, unit: "h/day", baselineValue: 0, position: { x: 330, y: 30 }, createdAt: now, updatedAt: now },
      { id: "other_target", name: "Other downtime", type: "input", status: "accepted", aiGenerated: false, unit: "h/day", baselineValue: 1, position: { x: 330, y: 270 }, createdAt: now, updatedAt: now }
    ],
    edges: [
      { id: "target_edge", sourceNodeId: "test_root", targetNodeId: "downtime_target", relation: "additive_component", aiGenerated: false },
      { id: "other_edge", sourceNodeId: "test_root", targetNodeId: "other_target", relation: "additive_component", aiGenerated: false }
    ]
  };
  project.scenarios = [];
  project.versions = [];
  project.dataSources = [];
  const saved = await page.request.post(`/api/vdt/projects/${projectId}/vdts`, {
    timeout: SERVER_TIMEOUT,
    data: {
      schemaVersion: "create_vdt_with_initial_http_request.v1", idempotencyKey: `create:${vdtId}`,
      expectedRuntime: { schemaVersion: "project_runtime_cas.v1", runtimeGeneration: payload.summary.runtimeState.runtimeGeneration, generationVersion: payload.summary.runtimeState.generationVersion },
      vdt: { requestedVdtId: vdtId, name: project.name, rootKpi: "All downtime", unit: "h/day", timePeriod: "daily", status: "draft", metadata: null }, project
    }
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/projects/${projectId}?vdt=${vdtId}`, { timeout: SERVER_TIMEOUT });
  await expect(page.getByTestId("vdt-canvas")).toBeVisible();
  return { projectId, vdtId };
}

function workbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Group", "Reason", "Minutes"],
    ...Array.from({ length: 10 }, (_entry, index) => [index < 5 ? "Planned" : "Unplanned", `Reason ${index + 1}`, 60])
  ]), "Downtime events");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

async function readBrowserProject(page: Page): Promise<VdtProject> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.project as VdtProject);
}

async function confirmNestedMapping(page: Page) {
  await page.getByLabel("Source table", { exact: true }).selectOption({ label: "Downtime events · 10 rows · 3 columns" });
  while (await page.getByRole("button", { name: /Remove category level/ }).count()) await page.getByRole("button", { name: /Remove category level/ }).last().click();
  await page.getByRole("button", { name: "Add category level", exact: true }).click();
  await page.getByLabel("Category level 1", { exact: true }).selectOption("Group");
  await page.getByRole("button", { name: "Add category level", exact: true }).click();
  await page.getByLabel("Category level 2", { exact: true }).selectOption("Reason");
  await page.getByLabel("How is the value recorded?", { exact: true }).selectOption("column");
  await page.getByLabel("Value / duration column", { exact: true }).selectOption("Minutes");
  await page.getByLabel("Value / duration unit", { exact: true }).selectOption("minutes");
  await page.getByLabel("Number format", { exact: true }).selectOption("decimal_dot");
  await page.getByLabel("Reporting value", { exact: true }).selectOption("per_day");
  await page.getByLabel("Inclusive period start", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Inclusive period end", { exact: true }).fill("2026-10-02");
  await page.getByLabel("Denominator, including zero-event days", { exact: true }).fill("2");
  await page.getByTestId("data-import-confirm-mapping").check();
  const calculation = waitForDataResponse(page, /\/api\/data\/discovery\/runs\/[^/]+\/user-input$/, "POST");
  await page.getByTestId("data-import-calculate-preview").click();
  await requireOk(await calculation);
  await expect(page.getByTestId("data-import-hierarchy-row")).toHaveCount(12);
  await expect(page.getByTestId("data-import-hierarchy")).toContainText("Reason 10");
  await expect(page.getByTestId("data-import-coverage")).toContainText("10 of 10 rows included");
  await expect(page.getByTestId("data-import-stage-preview")).toBeEnabled();
}

function semanticDefinition(node: VdtProject["graph"]["nodes"][number]) {
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "position" && key !== "updatedAt"));
}

test("creates and reviews every Excel category, reloads and reuses its original source for another complete applied hierarchy", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const cleanup: OwnedCleanup = { serverRequests: new Set<Promise<void>>(), cleaningUp: false };
  cleanupByTestId.set(testInfo.testId, cleanup);
  const fixture = await createFixture(page, (ownedFixture) => { cleanup.fixture = ownedFixture; });
  const original = workbook();
  const observedTargets: string[] = [];
  // Exercise real parsing, storage and deterministic execution without live provider calls.
  // Proxy and track every owned data request so cleanup cannot delete its owner while a cold route is still executing.
  await page.route("**/api/data/**", (route) => {
    if (cleanup.cleaningUp) return route.abort();
    const request = (async () => {
      let postData: string | undefined;
      if (new URL(route.request().url()).pathname === "/api/data/discovery/runs" && route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown> & { entryContext: { targetNodeId: string } };
        observedTargets.push(body.entryContext.targetNodeId);
        delete body.providerId;
        delete body.providerConfig;
        postData = JSON.stringify(body);
      }
      const response = await route.fetch({ timeout: SERVER_TIMEOUT, ...(postData ? { postData } : {}) });
      if (cleanup.cleaningUp) await route.abort().catch(() => {});
      else await route.fulfill({ response });
    })();
    cleanup.serverRequests.add(request);
    return request.finally(() => cleanup.serverRequests.delete(request));
  });
  const evidenceDir = path.resolve("output/playwright/file-incoming-kpis", testInfo.project.name);
  fs.mkdirSync(evidenceDir, { recursive: true });
  try {
    // Another KPI is selected; the clicked toolbar still pins downtime_target.
    await page.getByRole("button", { name: "Select Other downtime", exact: true }).click();
    const firstSourceList = waitForDataResponse(page, "/api/data/files", "GET");
    await page.locator('.react-flow__node[data-id="downtime_target"]').getByTestId("node-add-file-incoming-kpis").click({ force: true });
    await requireOk(await firstSourceList);
    await expect(page.getByTestId("data-import-target")).toHaveText("Target: Простои в сутки");
    await page.getByTestId("data-import-file-input").setInputFiles({ name: "downtime-events.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: original });
    const upload = waitForDataResponse(page, "/api/data/files", "POST");
    await analyzeAndWait(page);
    await requireOk(await upload);
    await expect(page.getByTestId("data-import-stage-preview")).toBeDisabled();
    await confirmNestedMapping(page);
    await page.screenshot({ path: path.join(evidenceDir, "review.png") });
    await stageAndWait(page);
    const preview = page.getByTestId("change-set-preview");
    await expect(preview).toBeVisible();
    await preview.getByRole("checkbox").first().uncheck();
    await expect(page.getByTestId("change-set-apply")).toBeDisabled();
    await preview.getByRole("checkbox").first().check();
    await page.getByTestId("change-set-apply").click();
    await expect(page.getByTestId("change-set-preview")).toHaveCount(0);
    await expect.poll(async () => (await readBrowserProject(page)).graph.nodes.length).toBe(15);
    const applied = await readBrowserProject(page);
    const categories = applied.graph.nodes.filter((node) => node.tags?.includes("incoming_kpi_breakdown"));
    expect(categories).toHaveLength(12);
    expect(categories.every((node) => node.description?.includes("downtime-events.xlsx") && node.description.includes("sha256:"))).toBe(true);
    const target = applied.graph.nodes.find((node) => node.id === "downtime_target")!;
    expect(target.formula).toBeTruthy();
    expect(applied.graph.nodes.find((node) => node.id === "other_target")!.formula).toBeUndefined();
    await page.getByTestId("vdt-canvas").getByRole("button", { name: "Fit View", exact: true }).click();
    await page.screenshot({ path: path.join(evidenceDir, "applied.png") });
    // Use the same public CAS commit boundary as the store's explicit Save action.
    const revisionState = await page.request.get(`/api/vdt/vdts/${fixture.vdtId}/revisions`, { timeout: SERVER_TIMEOUT });
    expect(revisionState.ok()).toBeTruthy();
    const state = await revisionState.json() as { head: VdtRevisionHeadV2; runtimeState: ProjectRuntimeStateV1 };
    const save = await page.request.post(`/api/vdt/vdts/${fixture.vdtId}/revisions`, { timeout: SERVER_TIMEOUT, data: {
      schemaVersion: "manual_vdt_revision_commit_request.v1", idempotencyKey: `save-file-test:${fixture.vdtId}`,
      expectedHead: revisionCasFromHead(state.head), expectedRuntime: runtimeCasFromState(state.runtimeState),
      summary: "File KPI UI test reviewed hierarchy", project: applied
    } });
    expect(save.ok(), await save.text()).toBeTruthy();
    await page.evaluate(() => localStorage.clear());
    await page.reload({ timeout: SERVER_TIMEOUT });
    await expect(page.getByTestId("vdt-canvas")).toBeVisible();
    await expect.poll(async () => (await readBrowserProject(page)).graph.nodes.length).toBe(15);
    await expect(page.locator(".react-flow__node")).toHaveCount(15);
    await page.getByTestId("vdt-canvas").getByRole("button", { name: "Fit View", exact: true }).click();
    await expect(page.getByRole("button", { name: "Select Other downtime", exact: true })).toBeInViewport();
    await page.getByRole("button", { name: "Select Other downtime", exact: true }).click();
    const savedSourceList = waitForDataResponse(page, "/api/data/files", "GET");
    await page.getByTestId("data-import-attachment-button").click();
    await requireOk(await savedSourceList);
    await expect(page.getByTestId("data-import-target")).toHaveText("Target: Other downtime");
    const source = page.getByLabel("Saved project sources", { exact: true });
    await expect(source.locator("option")).toHaveCount(2);
    await source.selectOption({ index: 1 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: SERVER_TIMEOUT }), page.getByTestId("data-import-download").click()]);
    const downloaded = fs.readFileSync((await download.path())!);
    expect(createHash("sha256").update(downloaded).digest("hex")).toBe(createHash("sha256").update(original).digest("hex"));
    await analyzeAndWait(page);
    await expect(page.getByTestId("data-import-stage-preview")).toBeDisabled();
    await confirmNestedMapping(page);
    await stageAndWait(page);
    await expect(page.getByTestId("change-set-preview")).toBeVisible();
    await page.getByTestId("change-set-apply").click();
    await expect(page.getByTestId("change-set-preview")).toHaveCount(0);
    await expect.poll(async () => (await readBrowserProject(page)).graph.nodes.length).toBe(27);
    const reused = await readBrowserProject(page);
    const firstNodeIds = new Set(["downtime_target", ...categories.map((node) => node.id)]);
    expect(reused.graph.nodes.filter((node) => firstNodeIds.has(node.id)).map(semanticDefinition))
      .toEqual(applied.graph.nodes.filter((node) => firstNodeIds.has(node.id)).map(semanticDefinition));
    for (const source of applied.dataSources) expect(reused.dataSources.find((entry) => entry.id === source.id)).toEqual(source);
    const secondCategories = reused.graph.nodes.filter((node) => node.tags?.includes("incoming_kpi_breakdown") && !firstNodeIds.has(node.id));
    expect(secondCategories).toHaveLength(12);
    expect(reused.graph.nodes.find((node) => node.id === "other_target")!.formula).toBeTruthy();
    expect(secondCategories.every((node) => reused.dataSources.some((source) => source.id === node.dataMapping?.sourceId))).toBe(true);
    expect(observedTargets).toEqual(["downtime_target", "other_target"]);
    const retained = await page.request.get(`/api/data/files?projectId=${fixture.projectId}&vdtId=${fixture.vdtId}`, { timeout: SERVER_TIMEOUT });
    expect(retained.ok()).toBeTruthy();
    const retainedSources = (await retained.json()).sources as Array<{ file: { contentHash: string } }>;
    expect(retainedSources).toHaveLength(1);
    expect(retainedSources[0]!.file.contentHash).toBe(`sha256:${createHash("sha256").update(original).digest("hex")}`);
  } finally {
    // Fence further requests immediately; afterEach drains and deletes with its own teardown budget.
    cleanup.cleaningUp = true;
  }
});

test("keeps colliding legacy warnings and exact duplicates visible without React key errors across recalculation", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1600, height: 1100 });
  const cleanup: OwnedCleanup = { serverRequests: new Set<Promise<void>>(), cleaningUp: false };
  cleanupByTestId.set(testInfo.testId, cleanup);
  await createFixture(page, (fixture) => { cleanup.fixture = fixture; });
  const reactKeyErrors: string[] = [];
  const pageErrors: string[] = [];
  const collectKeyError = (message: string) => { if (/same key|unique[^\n]*key/i.test(message)) reactKeyErrors.push(message); };
  page.on("console", (message) => { if (message.type() === "error") collectKeyError(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const prefix = "The reporting extract does not state whether every recorded downtime interval is included in the complete reporting period ";
  const first = `${prefix}for all equipment.`;
  const second = `${prefix}for the selected equipment only.`;
  await page.route("**/api/data/**", (route) => {
    if (cleanup.cleaningUp) return route.abort();
    const pending = (async () => {
      const pathname = new URL(route.request().url()).pathname;
      let postData: string | undefined;
      if (pathname === "/api/data/discovery/runs" && route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        delete body.providerId;
        delete body.providerConfig;
        postData = JSON.stringify(body);
      }
      const response = await route.fetch({ timeout: SERVER_TIMEOUT, ...(postData ? { postData } : {}) });
      if (cleanup.cleaningUp) return route.abort().catch(() => {});
      if (response.ok() && route.request().method() === "POST" && (pathname === "/api/data/discovery/runs" || /\/user-input$/.test(pathname))) {
        // Simulate already persisted snapshots: legacy IDs collide, including an exact duplicate occurrence.
        const body = await response.json() as { snapshot: DataDiscoveryRunSnapshot };
        body.snapshot.warnings.push(...[first, second, first].map((message) => ({ id: "legacy_collision", severity: "warning" as const, type: "data_discovery_low_confidence" as const, message })));
        body.snapshot.validationResults.push(...["Legacy validation one.", "Legacy validation two."].map((message) => ({ id: "legacy_collision", status: "warning" as const, message })));
        await route.fulfill({ response, json: body });
      } else await route.fulfill({ response });
    })();
    cleanup.serverRequests.add(pending);
    return pending.finally(() => cleanup.serverRequests.delete(pending));
  });
  try {
    const sourceList = waitForDataResponse(page, "/api/data/files", "GET");
    await page.locator('.react-flow__node[data-id="downtime_target"]').getByTestId("node-add-file-incoming-kpis").click({ force: true });
    await requireOk(await sourceList);
    await page.getByTestId("data-import-file-input").setInputFiles({ name: "legacy-warning-events.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook() });
    await analyzeAndWait(page);
    const notices = page.getByTestId("data-import-warnings");
    const assertOccurrences = async () => {
      await expect(notices.getByText(first, { exact: true })).toHaveCount(2);
      await expect(notices.getByText(second, { exact: true })).toHaveCount(1);
      await expect(notices.getByText("Legacy validation one.", { exact: true })).toHaveCount(1);
      await expect(notices.getByText("Legacy validation two.", { exact: true })).toHaveCount(1);
      expect(reactKeyErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    };
    await assertOccurrences();
    await confirmNestedMapping(page);
    await assertOccurrences();
  } finally {
    cleanup.cleaningUp = true;
  }
});
