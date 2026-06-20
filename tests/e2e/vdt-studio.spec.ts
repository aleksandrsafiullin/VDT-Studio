import { expect, test, type Page } from "@playwright/test";

type PersistedVdtState = {
  state?: {
    ui?: {
      fontScale?: number;
      panelScale?: number;
      leftPanelCollapsed?: boolean;
      rightPanelCollapsed?: boolean;
      scenarioDrawerCollapsed?: boolean;
    };
    project?: {
      graph?: {
        nodes?: Array<{ id: string; position?: { x: number; y: number } }>;
      };
    };
  };
};

async function readPersistedState(page: Page): Promise<PersistedVdtState | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as PersistedVdtState;
    } catch {
      return null;
    }
  });
}

async function readNodePosition(page: Page, nodeId: string) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.project?.graph?.nodes?.find((candidate) => candidate.id === nodeId)?.position;
}

async function countNodeOverlaps(page: Page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    const boxes = nodes
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);

    let overlaps = 0;
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        const a = boxes[left]!;
        const b = boxes[right]!;
        const horizontalOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const verticalOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (horizontalOverlap > 20 && verticalOverlap > 20) {
          overlaps += 1;
        }
      }
    }
    return overlaps;
  });
}

function reactFlowNode(page: Page, nodeId: string) {
  return page.locator(`.react-flow__node[data-id="${nodeId}"]`);
}

async function readNodeYOrder(page: Page, nodeIds: string[]): Promise<string[]> {
  const tops = await page.evaluate((ids) => {
    return ids.map((id) => {
      const element = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      return {
        id,
        top: element ? element.getBoundingClientRect().top : Number.POSITIVE_INFINITY
      };
    });
  }, nodeIds);

  return tops
    .slice()
    .sort((left, right) => left.top - right.top)
    .map((entry) => entry.id);
}

async function readClusterYRange(page: Page, nodeIds: string[]) {
  return page.evaluate((ids) => {
    const tops = ids.map((id) => {
      const element = document.querySelector(`.react-flow__node[data-id="${id}"]`);
      return element ? element.getBoundingClientRect().top : null;
    });
    const values = tops.filter((top): top is number => top !== null);

    return {
      tops,
      minTop: values.length > 0 ? Math.min(...values) : null,
      maxTop: values.length > 0 ? Math.max(...values) : null
    };
  }, nodeIds);
}

async function readClusterBounds(page: Page, upperIds: string[], lowerIds: string[]) {
  const [upper, lower] = await Promise.all([
    readClusterYRange(page, upperIds),
    readClusterYRange(page, lowerIds)
  ]);

  return {
    upperTops: upper.tops,
    lowerTops: lower.tops,
    maxUpper: upper.maxTop,
    minLower: lower.minTop
  };
}

async function assertClusteredAbove(
  page: Page,
  upperIds: string[],
  lowerIds: string[],
  tolerancePx = 4
) {
  const bounds = await readClusterBounds(page, upperIds, lowerIds);

  expect(bounds.upperTops).toHaveLength(upperIds.length);
  expect(bounds.lowerTops).toHaveLength(lowerIds.length);
  expect(bounds.upperTops.every((top) => top !== null)).toBe(true);
  expect(bounds.lowerTops.every((top) => top !== null)).toBe(true);
  expect(bounds.maxUpper).not.toBeNull();
  expect(bounds.minLower).not.toBeNull();
  expect(bounds.maxUpper! + tolerancePx).toBeLessThan(bounds.minLower!);
}

async function assertClustersDoNotInterleave(page: Page, clusterA: string[], clusterB: string[]) {
  const [rangeA, rangeB] = await Promise.all([
    readClusterYRange(page, clusterA),
    readClusterYRange(page, clusterB)
  ]);

  expect(rangeA.tops.every((top) => top !== null)).toBe(true);
  expect(rangeB.tops.every((top) => top !== null)).toBe(true);
  expect(rangeA.minTop).not.toBeNull();
  expect(rangeA.maxTop).not.toBeNull();
  expect(rangeB.minTop).not.toBeNull();
  expect(rangeB.maxTop).not.toBeNull();

  const aAboveB = rangeA.maxTop! <= rangeB.minTop!;
  const bAboveA = rangeB.maxTop! <= rangeA.minTop!;
  expect(aAboveB || bAboveA).toBe(true);
}

async function dragNodeBelowSibling(page: Page, sourceId: string, targetId: string) {
  await page.getByTestId("collapse-scenario-drawer").click();
  await page.getByTestId("collapse-right-panel").click();

  const source = reactFlowNode(page, sourceId);
  const target = reactFlowNode(page, targetId);
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.click({ force: true });

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const startX = sourceBox!.x + 40;
  const startY = sourceBox!.y + 30;
  const endY = targetBox!.y + targetBox!.height + 48;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 16 });
  await page.mouse.up();
}

/** Simulates a manual sibling reorder when canvas drag misses (pointer targeting). */
async function applyPersistedSiblingYOrderFallback(page: Page, sourceId: string, targetId: string) {
  await page.evaluate(
    ({ sourceId: draggedId, targetId: anchorId }) => {
      const raw = localStorage.getItem("vdt-studio-state");
      if (!raw) {
        throw new Error("Missing persisted VDT state");
      }

      const persisted = JSON.parse(raw) as {
        state?: { project?: { graph?: { nodes?: Array<{ id: string; position?: { x: number; y: number } }> } } };
      };
      const nodes = persisted.state?.project?.graph?.nodes ?? [];
      const source = nodes.find((node) => node.id === draggedId);
      const target = nodes.find((node) => node.id === anchorId);
      if (!source?.position || !target?.position) {
        throw new Error(`Missing positions for ${draggedId} / ${anchorId}`);
      }

      const sourcePosition = { ...source.position };
      source.position = { ...sourcePosition, y: target.position.y + 200 };
      target.position = { ...target.position, y: sourcePosition.y };
      localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
    },
    { sourceId, targetId }
  );

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();
}

async function readPersistedYOrder(page: Page, nodeIds: string[]): Promise<string[]> {
  const persisted = await readPersistedState(page);
  const nodes = persisted?.state?.project?.graph?.nodes ?? [];

  return nodeIds
    .slice()
    .sort((left, right) => {
      const leftY = nodes.find((node) => node.id === left)?.position?.y ?? Number.POSITIVE_INFINITY;
      const rightY = nodes.find((node) => node.id === right)?.position?.y ?? Number.POSITIVE_INFINITY;
      return leftY - rightY;
    });
}

function expectPositionMoved(
  baseline: { x: number; y: number } | undefined,
  moved: { x: number; y: number } | undefined,
  epsilon = 10
) {
  expect(baseline).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  expect(moved).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  const deltaX = Math.abs(moved!.x - baseline!.x);
  const deltaY = Math.abs(moved!.y - baseline!.y);
  expect(deltaX + deltaY).toBeGreaterThan(epsilon);
}

async function readPersistedUi(page: Page) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.ui;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const capturedExports: { filename: string; type: string; text: string }[] = [];
    Reflect.set(window, "__vdtCapturedExports", capturedExports);
    Reflect.set(window, "__vdtCaptureDownload", (artifact: { filename: string; type: string; text: string }) => {
      capturedExports.push(artifact);
    });
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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

test("opens checked-in examples and syncs the setup brief", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Example selector smoke runs on desktop viewport.");
  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();

  await setupRail.getByRole("combobox", { name: "Example model" }).selectOption("oee");
  await setupRail.getByRole("button", { name: "Open example" }).click();

  await expect(page.getByRole("heading", { name: "OEE Driver Model" })).toBeVisible();
  await expect(setupRail.getByRole("textbox", { name: "Root KPI" })).toHaveValue("Overall Equipment Effectiveness");
  await expect(setupRail.getByRole("textbox", { name: "Industry" })).toHaveValue("Manufacturing / Industrial Operations");
  await expect(setupRail.getByRole("textbox", { name: "Unit" })).toHaveValue("%");
  await expect(reactFlowNode(page, "oee")).toBeVisible();
});

test("configures and tests local runner presets", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local runner provider UI smoke runs on desktop viewport.");
  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();
  let generateRequestBody: {
    providerId?: string;
    providerConfig?: { baseUrl?: string; model?: string };
  } | undefined;

  await setupRail.getByRole("combobox", { name: "Provider" }).selectOption("local_runner");
  await setupRail.getByRole("combobox", { name: "Preset" }).selectOption("vllm_openai");

  await expect(setupRail.getByRole("textbox", { name: "Base URL" })).toHaveValue("http://127.0.0.1:8000/v1");
  await expect(setupRail.getByRole("textbox", { name: "Model" })).toHaveValue("local-model");
  await page.route("**/api/ai/generate-vdt", async (route) => {
    generateRequestBody = route.request().postDataJSON() as typeof generateRequestBody;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Captured by e2e." })
    });
  });
  await setupRail.getByRole("button", { name: /Generate VDT with AI/i }).click();
  await expect.poll(() => generateRequestBody?.providerConfig?.baseUrl).toBe("http://127.0.0.1:8000/v1");
  expect(generateRequestBody?.providerId).toBe("local_runner");
  expect(generateRequestBody?.providerConfig?.model).toBe("local-model");

  await setupRail.getByRole("combobox", { name: "Preset" }).selectOption("custom_cli_json");
  await expect(setupRail.getByRole("combobox", { name: "Runner adapter" })).toHaveValue("cli_stub");
  await expect(setupRail.getByRole("textbox", { name: "Command" })).toHaveValue("vdt-model-adapter");

  await setupRail.getByRole("combobox", { name: "Preset" }).selectOption("ollama_openai");
  await page.route("http://127.0.0.1:8765/test-provider", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        providerId: "local_http_stub",
        taskType: "connection_test",
        models: ["qwen3"]
      })
    });
  });

  await setupRail.getByRole("button", { name: "Test connection" }).click();
  await expect(setupRail.getByText("Connection test passed. Models: qwen3.")).toBeVisible();
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

test("persists font and panel scale from settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings persistence runs on desktop viewport.");

  await page.getByTestId("settings-button").click();
  await page.getByTestId("font-scale-slider").fill("80");
  await page.getByTestId("panel-scale-slider").fill("75");
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.fontScale).toBeCloseTo(0.8, 2);

  await page.reload();

  const ui = await readPersistedUi(page);
  expect(ui?.fontScale).toBeCloseTo(0.8, 2);
  expect(ui?.panelScale).toBeCloseTo(0.75, 2);
});

test("collapses and expands the setup rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Panel collapse runs on desktop viewport.");

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await page.getByTestId("collapse-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);
  await page.getByTestId("expand-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
});

test("collapses and expands the scenario drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario drawer collapse runs on desktop viewport.");

  await expect(page.getByText("Overrides")).toBeVisible();
  await page.getByTestId("collapse-scenario-drawer").click();
  await expect(page.getByText("Overrides")).toHaveCount(0);
  await page.getByTestId("expand-scenario-drawer").click();
  await expect(page.getByText("Overrides")).toBeVisible();
});

test("auto-distributes nodes without overlap", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Auto-distribute runs on desktop viewport.");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);
  await expect.poll(async () => countNodeOverlaps(page)).toBe(0);
});

test("auto-distribute groups cousin nodes by parent", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Layout grouping runs on desktop viewport.");

  const effectiveWorkingTimeChildren = ["calendar_time", "planned_downtime", "unplanned_downtime"];
  const averageProductivityChildren = ["nominal_rate", "utilization_factor", "yield_factor"];

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);

  await expect
    .poll(async () => {
      try {
        await assertClusteredAbove(
          page,
          averageProductivityChildren,
          effectiveWorkingTimeChildren
        );
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  await expect
    .poll(async () => {
      try {
        await assertClustersDoNotInterleave(
          page,
          averageProductivityChildren,
          effectiveWorkingTimeChildren
        );
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);

  // Within-cluster Y order mirrors vdt-core compareSiblingOrder (name, then id) for this fixture.
  await expect
    .poll(async () => readNodeYOrder(page, effectiveWorkingTimeChildren))
    .toEqual(effectiveWorkingTimeChildren);

  await expect
    .poll(async () => readNodeYOrder(page, averageProductivityChildren))
    .toEqual(averageProductivityChildren);
});

test("auto-distribute preserves manual sibling order after drag or persisted Y fallback", async ({
  page
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Manual order preservation runs on desktop viewport.");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);

  const baselineOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  expect(baselineOrder[0]).toBe("calendar_time");
  expect(baselineOrder[1]).toBe("unplanned_downtime");

  // Real drag first; persisted-Y fallback validates the redistributor contract when pointer targeting fails.
  await dragNodeBelowSibling(page, "calendar_time", "unplanned_downtime");

  let draggedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  if (draggedOrder[0] !== "unplanned_downtime") {
    testInfo.annotations.push({
      type: "note",
      description:
        "Canvas drag did not reorder siblings; using persisted Y fallback to exercise auto-distribute manual-order preservation."
    });
    await applyPersistedSiblingYOrderFallback(page, "calendar_time", "unplanned_downtime");
    draggedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
  }

  expect(draggedOrder[0]).toBe("unplanned_downtime");
  expect(draggedOrder[1]).toBe("calendar_time");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => countNodeOverlaps(page)).toBe(0);

  await expect
    .poll(async () => {
      const persistedOrder = await readPersistedYOrder(page, ["calendar_time", "unplanned_downtime"]);
      return persistedOrder[0] === "unplanned_downtime" && persistedOrder[1] === "calendar_time";
    })
    .toBe(true);

  await expect
    .poll(async () => {
      const renderedOrder = await readNodeYOrder(page, ["calendar_time", "unplanned_downtime"]);
      return renderedOrder[0] === "unplanned_downtime" && renderedOrder[1] === "calendar_time";
    })
    .toBe(true);
});

test("persists dragged node positions after reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Drag persistence runs on desktop viewport.");

  await page.getByTestId("auto-distribute-layout").click();
  await expect.poll(async () => page.locator(".react-flow__node").count()).toBeGreaterThan(0);

  const node = page.locator(".react-flow__node").first();
  const nodeId = await node.getAttribute("data-id");
  expect(nodeId).toBeTruthy();

  await expect.poll(async () => readNodePosition(page, nodeId!)).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number)
  });
  const baselinePosition = await readNodePosition(page, nodeId!);

  const box = await node.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 60, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const position = await readNodePosition(page, nodeId!);
      if (!position || !baselinePosition) {
        return null;
      }
      const deltaX = Math.abs(position.x - baselinePosition.x);
      const deltaY = Math.abs(position.y - baselinePosition.y);
      return deltaX + deltaY > 10 ? position : null;
    })
    .not.toBeNull();

  const draggedPosition = await readNodePosition(page, nodeId!);
  expectPositionMoved(baselinePosition, draggedPosition);

  await page.reload();
  await page.getByTestId("vdt-canvas").waitFor();

  await expect.poll(async () => readNodePosition(page, nodeId!)).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number)
  });
  const reloadedPosition = await readNodePosition(page, nodeId!);

  expect(reloadedPosition?.x).toBeCloseTo(draggedPosition!.x, 0);
  expect(reloadedPosition?.y).toBeCloseTo(draggedPosition!.y, 0);
});

test("resets display preferences to defaults", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Reset UI preferences runs on desktop viewport.");

  await page.getByTestId("settings-button").click();
  await page.getByTestId("font-scale-slider").fill("80");
  await page.getByTestId("panel-scale-slider").fill("75");
  await page.keyboard.press("Escape");

  await page.getByTestId("collapse-left-panel").click();
  await page.getByTestId("collapse-right-panel").click();
  await page.getByTestId("collapse-scenario-drawer").click();

  await page.getByTestId("settings-button").click();
  await page.getByTestId("reset-ui-preferences").click();
  await page.keyboard.press("Escape");

  await expect.poll(async () => (await readPersistedUi(page))?.fontScale).toBeCloseTo(0.9, 2);
  await expect.poll(async () => (await readPersistedUi(page))?.panelScale).toBeCloseTo(0.85, 2);
  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelCollapsed).toBe(false);
  await expect.poll(async () => (await readPersistedUi(page))?.rightPanelCollapsed).toBe(false);
  await expect.poll(async () => (await readPersistedUi(page))?.scenarioDrawerCollapsed).toBe(false);

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByTestId("right-panel")).toBeVisible();
  await expect(page.getByText("Overrides")).toBeVisible();
});

test("persists left panel collapse across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Left panel persistence runs on desktop viewport.");

  await page.getByTestId("collapse-left-panel").click();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);

  await expect.poll(async () => (await readPersistedUi(page))?.leftPanelCollapsed).toBe(true);

  await page.reload();

  await expect(page.getByRole("textbox", { name: "Root KPI" })).toHaveCount(0);
  await expect(page.getByTestId("expand-left-panel")).toBeVisible();
  expect((await readPersistedUi(page))?.leftPanelCollapsed).toBe(true);
});

test("persists right panel collapse across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Right panel persistence runs on desktop viewport.");

  await page.getByTestId("collapse-right-panel").click();
  await expect(page.getByTestId("right-panel")).toHaveCount(0);
  await expect(page.getByTestId("expand-right-panel")).toBeVisible();

  await expect.poll(async () => (await readPersistedUi(page))?.rightPanelCollapsed).toBe(true);

  await page.reload();

  await expect(page.getByTestId("right-panel")).toHaveCount(0);
  await expect(page.getByTestId("expand-right-panel")).toBeVisible();
  expect((await readPersistedUi(page))?.rightPanelCollapsed).toBe(true);
});

test("persists scenario drawer collapse across reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Scenario drawer persistence runs on desktop viewport.");

  await page.getByTestId("collapse-scenario-drawer").click();
  await expect(page.getByText("Overrides")).toHaveCount(0);

  await expect.poll(async () => (await readPersistedUi(page))?.scenarioDrawerCollapsed).toBe(true);

  await page.reload();

  await expect(page.getByText("Overrides")).toHaveCount(0);
  await expect(page.getByTestId("expand-scenario-drawer")).toBeVisible();
  expect((await readPersistedUi(page))?.scenarioDrawerCollapsed).toBe(true);
});

test("shows full setup rail on mobile when left panel was collapsed on desktop", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile collapse override only runs on mobile project.");

  await page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    const persisted = raw ? JSON.parse(raw) : { state: {} };
    persisted.state = {
      ...persisted.state,
      ui: {
        ...(persisted.state?.ui ?? {}),
        leftPanelCollapsed: true
      }
    };
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  });
  await page.reload();

  await expect(page.getByText("New VDT")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Root KPI" })).toBeVisible();
  await expect(page.getByTestId("expand-left-panel")).toHaveCount(0);
});
