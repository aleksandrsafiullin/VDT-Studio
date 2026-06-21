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
    executionSettings?: {
      byokProtocol?: string;
      gatewayPresetId?: string;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
      localApiKey?: string;
    };
    project?: {
      graph?: {
        nodes?: Array<{ id: string; position?: { x: number; y: number } }>;
      };
    };
  };
};

type TestProviderRequestBody = {
  providerId?: string;
  operation?: string;
  providerConfig?: {
    backendId?: string;
    pairingToken?: string;
    timeoutMs?: number;
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

async function readPersistedExecutionSettings(page: Page) {
  const persisted = await readPersistedState(page);
  return persisted?.state?.executionSettings;
}

function assertExpectedCliTestProviderBody(body: TestProviderRequestBody | undefined) {
  expect(body?.operation).toBe("connection_test");
  expect(body?.providerId).toBe("local_runner");
  expect(body?.providerConfig?.backendId).toBe("claude_subscription");
  expect(body?.providerConfig?.pairingToken).toBe("e2e-session-token");
  expect(body?.providerConfig?.timeoutMs).toBe(60_000);
}

async function pairLocalRunner(page: Page) {
  await page.route("http://127.0.0.1:8765/v1/pair", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ code: "123456" });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, session: { token: "e2e-session-token", expiresAt: "2099-01-01T00:00:00.000Z" } })
    });
  });
  await page.getByTestId("local-runner-pairing-code").fill("123456");
  await page.getByTestId("local-runner-pair").click();
  await expect(page.getByTestId("local-runner-pairing-status")).toContainText("paired for this browser session");
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

async function openSettingsModal(page: Page, section: "execution" | "display" = "execution") {
  await page.getByTestId("settings-button").click();
  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();
  if (section === "display") {
    await page.getByTestId("settings-nav-display").click();
  }
  return modal;
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

test("renders the workspace without invoking a mock provider", async ({ page }, testInfo) => {
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

test("opens settings modal on execution mode with Local CLI and BYOK tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings modal smoke runs on desktop viewport.");

  const modal = await openSettingsModal(page);
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});

test("settings modal keeps stable size across sections", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings modal size stability runs on desktop viewport.");

  const modal = await openSettingsModal(page, "execution");
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();

  const executionBox = await modal.boundingBox();
  expect(executionBox).not.toBeNull();

  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();

  const localCliBox = await modal.boundingBox();
  expect(localCliBox).not.toBeNull();
  expect(Math.abs(localCliBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(localCliBox!.width).toBe(executionBox!.width);

  await page.getByTestId("execution-mode-tab-byok").click();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();

  const byokBox = await modal.boundingBox();
  expect(byokBox).not.toBeNull();
  expect(Math.abs(byokBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(byokBox!.width).toBe(executionBox!.width);

  await page.getByTestId("settings-nav-display").click();
  await expect(modal.getByRole("heading", { name: "Display" })).toBeVisible();

  const displayBox = await modal.boundingBox();
  expect(displayBox).not.toBeNull();
  expect(Math.abs(displayBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(displayBox!.width).toBe(executionBox!.width);

  await page.getByTestId("settings-nav-execution").click();
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();

  const executionAgainBox = await modal.boundingBox();
  expect(executionAgainBox).not.toBeNull();
  expect(Math.abs(executionAgainBox!.height - executionBox!.height)).toBeLessThanOrEqual(2);
  expect(executionAgainBox!.width).toBe(executionBox!.width);
});

test("setup rail Configure opens settings modal on execution mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Setup rail configure runs on desktop viewport.");
  const setupRail = page.locator("section").filter({ hasText: "New VDT" }).first();

  await setupRail.getByTestId("execution-mode-configure").click();

  const modal = page.getByTestId("settings-modal");
  await expect(modal).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
});

test("detects installed CLI and tests it through the application API", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  let testProviderRequestBody: TestProviderRequestBody | undefined;

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "claude",
            installed: true,
            executable: "/usr/local/bin/claude",
            alias: "/usr/local/bin/claude",
            version: "1.0.0"
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/generate-vdt", async (route) => {
    testProviderRequestBody = route.request().postDataJSON() as TestProviderRequestBody;

    try {
      assertExpectedCliTestProviderBody(testProviderRequestBody);
    } catch (error) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unexpected Local CLI test body."
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true
      })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible({ timeout: 10_000 });
  await pairLocalRunner(page);
  expect(JSON.stringify(await readPersistedState(page))).not.toContain("e2e-session-token");

  await page.getByTestId("cli-agent-select-claude").click();
  await page.getByTestId("cli-agent-test-claude").click();
  await expect(page.getByText("Claude Code connection test passed.")).toBeVisible();
  assertExpectedCliTestProviderBody(testProviderRequestBody);
});

test("shows a real Local CLI connection error without falling back to mock", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Local CLI settings smoke runs on desktop viewport.");

  await page.route("**/api/ai/detect-clis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "claude",
            installed: true,
            executable: "/usr/local/bin/claude",
            alias: "/usr/local/bin/claude",
            version: "1.0.0"
          }
        ]
      })
    });
  });

  await page.route("**/api/ai/generate-vdt", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Claude Code authentication failed." })
    });
  });

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible({ timeout: 10_000 });
  await pairLocalRunner(page);

  await page.getByTestId("cli-agent-select-claude").click();
  await expect(page.getByText("Catalog suggestions")).toBeVisible();
  await expect(page.getByTestId("cli-agent-model-claude")).toContainText("claude-opus-4-8");
  await expect(page.getByTestId("cli-agent-model-claude")).toContainText("claude-sonnet-4-6");

  await page.getByTestId("cli-agent-test-claude").click();
  await expect(page.getByText("Claude Code authentication failed.")).toBeVisible();
  await expect(page.getByText("Claude Code connection test passed.")).toHaveCount(0);
});

test("configures BYOK Anthropic without persisting API keys", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "BYOK settings smoke runs on desktop viewport.");

  let generateRequestBody: {
    providerId?: string;
    providerConfig?: { baseUrl?: string; model?: string; apiKey?: string };
  } | undefined;

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-preset-form")).toBeVisible();

  await page.getByTestId("byok-api-key").fill("session-only-key");
  await page.getByTestId("byok-model-select").selectOption("__custom__");
  await page.getByTestId("byok-model-custom").fill("vdt-production-model");

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("session-only-key");

  await page.route("**/api/ai/generate-vdt", async (route) => {
    generateRequestBody = route.request().postDataJSON() as typeof generateRequestBody;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Captured by e2e." })
    });
  });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Generate VDT with AI/i }).click();
  await expect.poll(() => generateRequestBody?.providerId).toBe("anthropic");
  expect(generateRequestBody?.providerConfig?.baseUrl).toBe("https://api.anthropic.com");
  expect(generateRequestBody?.providerConfig?.model).toBe("vdt-production-model");
  expect(generateRequestBody?.providerConfig?.apiKey).toBe("session-only-key");

  await page.reload();

  const persistedAfterReload = await readPersistedExecutionSettings(page);
  expect(persistedAfterReload?.byokProtocol).toBe("anthropic");
  expect(persistedAfterReload?.gatewayPresetId).toBe("anthropic-claude");
  expect(persistedAfterReload?.model).toBe("vdt-production-model");
  expect(persistedAfterReload?.baseUrl).toBe("https://api.anthropic.com");
  expect(persistedAfterReload?.apiKey).toBeUndefined();
  expect(persistedAfterReload?.localApiKey).toBeUndefined();

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-api-key")).toHaveValue("");

  await page.evaluate(() => {
    const raw = localStorage.getItem("vdt-studio-state");
    if (!raw) {
      throw new Error("Missing persisted VDT state");
    }
    const persisted = JSON.parse(raw) as {
      version?: number;
      state?: {
        providerConfig?: Record<string, unknown>;
        executionSettings?: Record<string, unknown>;
      };
    };
    persisted.version = 0;
    persisted.state ??= {};
    persisted.state.providerConfig ??= {};
    persisted.state.providerConfig.apiKey = "legacy-openai-secret";
    persisted.state.providerConfig.localApiKey = "legacy-local-secret";
    persisted.state.executionSettings ??= {};
    persisted.state.executionSettings.apiKey = "legacy-execution-secret";
    persisted.state.executionSettings.localApiKey = "legacy-execution-local-secret";
    localStorage.setItem("vdt-studio-state", JSON.stringify(persisted));
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-openai-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-local-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-execution-secret");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("vdt-studio-state") ?? ""))
    .not.toContain("legacy-execution-local-secret");
});

test("blocks BYOK test connection when required fields are missing", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "BYOK validation smoke runs on desktop viewport.");

  await openSettingsModal(page);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.getByTestId("byok-protocol-anthropic").click();
  await expect(page.getByTestId("byok-preset-form")).toBeVisible();

  await page.getByTestId("byok-test-connection").click();
  await expect(page.getByTestId("byok-api-key")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status")).toHaveCount(0);
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

test("keeps execution settings reachable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Mobile execution settings smoke only runs on the mobile project.");

  const modal = await openSettingsModal(page);
  await expect(modal.getByRole("heading", { name: "Execution mode" })).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-local-cli")).toBeVisible();
  await expect(page.getByTestId("execution-mode-tab-byok")).toBeVisible();
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("local-cli-settings")).toBeVisible();

  await page.getByTestId("execution-mode-tab-byok").click();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
  await expect(page.getByTestId("byok-settings")).toBeVisible();

  const [dialogBox, viewport] = await Promise.all([modal.boundingBox(), Promise.resolve(page.viewportSize())]);
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
});

test("persists font and panel scale from settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Settings persistence runs on desktop viewport.");

  await openSettingsModal(page, "display");
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

  await openSettingsModal(page, "display");
  await page.getByTestId("font-scale-slider").fill("80");
  await page.getByTestId("panel-scale-slider").fill("75");
  await page.keyboard.press("Escape");

  await page.getByTestId("collapse-left-panel").click();
  await page.getByTestId("collapse-right-panel").click();
  await page.getByTestId("collapse-scenario-drawer").click();

  await openSettingsModal(page, "display");
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
