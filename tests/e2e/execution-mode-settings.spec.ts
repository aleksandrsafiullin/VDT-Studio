import { expect, test, type Page } from "@playwright/test";

const detection = (id: string, status = "ready") => ({
  id, installed: true, executable: `/usr/local/bin/${id}`, alias: id, version: "1.0.0", status,
  authSummary: status === "ready" ? "Provider session verified." : "Sign in with your provider to verify access.",
  diagnostics: ["Raw CLI diagnostic details stay in the disclosure."]
});

async function openLocalSettings(page: Page) {
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("local-cli-scan-status")).toHaveCount(0);
}

async function mockDetection(page: Page, agents = [detection("claude"), detection("codex"), detection("cursor-agent")]) {
  await page.route("**/api/ai/detect-clis**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    await route.fulfill({ json: { agents: id ? agents.filter((agent) => agent.id === id) : agents, modelsByAgent: { codex: ["model-a"] } } });
  });
}

test("subscriptions remove, persist through reload and rescan, and can be added back", async ({ page }) => {
  await mockDetection(page);
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-select-claude").click();
  await page.getByTestId("local-cli-memory-accordion").getByRole("button").click();
  await page.getByTestId("local-cli-memory-mode").selectOption("selected_cli");
  await page.getByTestId("local-cli-memory-agent").selectOption("claude");
  await page.getByTestId("cli-agent-remove-claude").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toHaveCount(0);
  await expect(page.getByTestId("local-cli-removed-notice")).toContainText("Chat now uses Cursor Agent");
  await expect(page.getByTestId("local-cli-removed-notice")).toContainText("Memory now follows chat");
  await expect(page.getByTestId("local-cli-undo-remove")).toBeFocused();
  await expect(page.getByTestId("local-cli-memory-mode")).toHaveValue("same_as_chat");
  await page.reload();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("cli-agent-card-cursor-agent")).toBeVisible();
  await expect(page.getByTestId("cli-agent-card-claude")).toHaveCount(0);
  await page.getByTestId("local-cli-rescan").click();
  await expect(page.getByTestId("local-cli-scan-status")).toHaveCount(0);
  await expect(page.getByTestId("cli-agent-card-claude")).toHaveCount(0);
  await page.getByTestId("local-cli-add-provider").click();
  await page.getByTestId("cli-agent-restore-claude").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toBeVisible();
  await expect(page.getByTestId("cli-agent-select-cursor-agent")).toHaveAttribute("aria-pressed", "true");
});

test("removing the final subscription clears chat and Undo restores an accessible provider choice", async ({ page }) => {
  await mockDetection(page, [detection("claude")]);
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-select-claude").click();
  await page.getByTestId("cli-agent-remove-claude").click();
  await expect(page.getByTestId("local-cli-active-selection")).toContainText("No provider selected");
  await expect(page.getByTestId("local-cli-removed-notice")).toContainText("Choose another provider");
  await page.getByTestId("local-cli-undo-remove").click();
  await expect(page.getByTestId("cli-agent-select-claude")).toBeFocused();
  await expect(page.getByTestId("cli-agent-select-claude")).toHaveAttribute("aria-pressed", "false");
});

test("Test exposes busy, failure and retry states without duplicate requests", async ({ page }) => {
  await mockDetection(page, [detection("claude")]);
  let calls = 0;
  let releaseTest: (() => void) | undefined;
  await page.route("**/api/ai/dev-runtime", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ operation: "test", backendId: "claude_subscription" });
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((resolve) => { releaseTest = resolve; });
      await route.fulfill({ status: 502, json: { ok: false, error: "Provider session expired. Sign in and retry." } });
    } else await route.fulfill({ json: { ok: true } });
  });
  await openLocalSettings(page);
  const button = page.getByTestId("cli-agent-test-claude");
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toContainText("Testing");
  await expect(page.getByTestId("cli-agent-remove-claude")).toBeDisabled();
  await button.evaluate((element) => (element as HTMLButtonElement).click());
  await expect.poll(() => calls).toBe(1);
  await expect.poll(() => Boolean(releaseTest)).toBe(true);
  releaseTest!();
  await expect(page.getByTestId("provider-test-status-claude")).toContainText("Provider session expired");
  await expect(page.getByTestId("cli-agent-readiness-claude")).toHaveAttribute("data-readiness", "warning");
  await expect(page.getByTestId("cli-agent-authenticate-claude")).toBeVisible();
  await expect(button).toHaveText("Retry test");
  await button.click();
  await expect(page.getByTestId("provider-test-status-claude")).toContainText("CLI access verified");
  expect(calls).toBe(2);
});

test("managed Sign in verifies readiness before success and allows retry", async ({ page }) => {
  let ready = false;
  let authCalls = 0;
  let releaseAuth: (() => void) | undefined;
  await page.route("**/api/ai/detect-clis**", async (route) => route.fulfill({ json: { agents: [detection("cursor-agent", ready ? "ready" : "authentication_required")] } }));
  await page.route("**/api/ai/dev-runtime", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "test") {
      await route.fulfill({ status: 401, json: { ok: false, error: "AUTH_REQUIRED: reconnect the provider session." } });
      return;
    }
    expect(body).toEqual({ operation: "open_provider_auth", backendId: "cursor_subscription" });
    authCalls += 1;
    if (authCalls === 1) await new Promise<void>((resolve) => { releaseAuth = resolve; });
    await route.fulfill({ json: { ok: true, action: "authenticated" } });
  });
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-test-cursor-agent").click();
  await expect(page.getByTestId("provider-test-status-cursor-agent")).toContainText("AUTH_REQUIRED");
  await page.getByTestId("cli-agent-authenticate-cursor-agent").click();
  await expect(page.getByTestId("provider-test-status-cursor-agent")).toHaveCount(0);
  await expect(page.getByTestId("cli-agent-authenticate-cursor-agent")).toBeDisabled();
  await expect(page.getByTestId("cli-agent-test-cursor-agent")).toBeDisabled();
  await expect(page.getByTestId("cli-agent-remove-cursor-agent")).toBeDisabled();
  await expect.poll(() => Boolean(releaseAuth)).toBe(true);
  releaseAuth!();
  await expect(page.getByTestId("provider-auth-status-cursor-agent")).toContainText("not confirmed");
  await expect(page.getByTestId("provider-auth-status-cursor-agent")).not.toContainText("sign-in verified");
  ready = true;
  await page.getByTestId("cli-agent-authenticate-cursor-agent").click();
  await expect(page.getByTestId("provider-auth-status-cursor-agent")).toContainText("sign-in verified");
  expect(authCalls).toBe(2);
});

test("sign-in guidance opens during the click and retains a direct fallback link", async ({ page }) => {
  await mockDetection(page, [detection("claude", "authentication_required")]);
  await page.addInitScript(() => {
    Reflect.set(window, "__signInOpens", []);
    window.open = ((url: string) => {
      Reflect.get(window, "__signInOpens").push({ url, active: navigator.userActivation.isActive });
      return null;
    }) as typeof window.open;
  });
  await page.route("**/api/ai/dev-runtime", async (route) => route.fulfill({ json: { ok: true, action: "instructions", instructions: "Run claude login, then Test." } }));
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-authenticate-claude").click();
  await expect(page.getByTestId("provider-auth-status-claude")).toContainText("Run claude login");
  await expect(page.getByTestId("cli-agent-sign-in-guide-claude")).toBeVisible();
  const opens = await page.evaluate(() => Reflect.get(window, "__signInOpens"));
  expect(opens).toEqual([{ url: "https://docs.anthropic.com/en/docs/claude-code", active: true }]);
  await expect(page.getByTestId("provider-auth-status-claude")).not.toContainText("verified");
});

test("subscription hierarchy stays compact on a narrow screen with secondary options collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDetection(page);
  await openLocalSettings(page);
  await expect(page.getByRole("heading", { name: "Your subscriptions", exact: true })).toHaveCount(1);
  await expect(page.getByTestId("local-model-settings")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Local models", exact: true })).toBeVisible();
  await expect(page.getByTestId("local-cli-memory-accordion").getByRole("button")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("cli-agent-details-claude")).not.toHaveAttribute("open");
  const widths = await page.getByTestId("local-cli-settings").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

test("Local models opens independently, restores server/model choices and preserves the memory override", async ({ page }) => {
  let cliScans = 0;
  await page.addInitScript(() => {
    if (localStorage.getItem("vdt-studio-state")) return;
    localStorage.setItem("vdt-studio-state", JSON.stringify({ version: 2, state: {
      providerId: "local_runner", providerConfig: {},
      executionSettings: {
        executionMode: "local_cli", runnerProviderId: "local_http_stub", localRunnerPresetId: "lm_studio_openai", localModel: "local-saved", localBaseUrl: "http://127.0.0.1:1234/v1",
        selectedCliAgentId: "codex", cliModelSelection: { source: "custom", customModel: "cloud-saved" },
        memoryModelMode: "selected_cli", memoryCliAgentId: "claude", gatewayPresetId: "openai-default", byokProtocol: "openai", byokGateway: "none", baseUrl: "https://api.openai.com/v1", model: "api-saved"
      }
    } }));
  });
  await page.route("**/api/ai/detect-clis**", async (route) => {
    cliScans += 1;
    await route.fulfill({ json: { agents: [detection("codex")] } });
  });
  await page.route("**/api/ai/dev-runtime", async (route) => {
    expect(route.request().postDataJSON().operation).toBe("list_models");
    await route.fulfill({ json: { ok: true, models: ["local-saved", "second-local"] } });
  });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("execution-mode-tab-local-models")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("local-model-model-lm_studio_openai")).toHaveValue("local-saved");
  await expect(page.getByText("Loading available models...")).toHaveCount(0);
  expect(cliScans).toBe(0);
  await expect(page.getByTestId("local-cli-settings")).toHaveCount(0);
  await page.getByTestId("local-cli-memory-accordion").getByRole("button").click();
  await expect(page.getByTestId("local-cli-memory-mode")).toHaveValue("selected_cli");
  await expect(page.getByTestId("local-cli-memory-agent")).toHaveValue("claude");
  await page.getByTestId("local-model-model-lm_studio_openai").selectOption("second-local");
  await page.getByTestId("settings-modal-close").click();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("execution-mode-tab-local-models")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("local-model-model-lm_studio_openai")).toHaveValue("second-local");
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await expect(page.getByTestId("cli-agent-card-codex")).toBeVisible();
  await expect(page.getByTestId("cli-agent-model-custom-codex")).toHaveValue("cloud-saved");
  await expect(page.getByTestId("local-model-settings")).toHaveCount(0);
  await page.getByTestId("execution-mode-tab-byok").click();
  await page.reload();
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("execution-mode-tab-byok")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("execution-mode-tab-local-models").click();
  await expect(page.getByTestId("local-model-model-lm_studio_openai")).toHaveValue("second-local");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.executionSettings);
  expect(saved).toMatchObject({ memoryModelMode: "selected_cli", memoryCliAgentId: "claude", model: "api-saved", localRunnerPresetId: "lm_studio_openai", localModel: "second-local" });
});

test("execution tabs support arrow wrapping, Home and End with correct panel routing", async ({ page }) => {
  await mockDetection(page, [detection("codex")]);
  await page.route("**/api/ai/dev-runtime", async (route) => route.fulfill({ json: { ok: true, models: ["qwen3"] } }));
  await openLocalSettings(page);
  const cli = page.getByRole("tab", { name: "CLI", exact: true });
  const local = page.getByRole("tab", { name: "Local models", exact: true });
  const api = page.getByRole("tab", { name: "API keys", exact: true });
  await cli.focus();
  await cli.press("ArrowRight");
  await expect(local).toBeFocused();
  await expect(page.getByTestId("execution-mode-panel-local-models")).toBeVisible();
  await local.press("ArrowRight");
  await expect(api).toBeFocused();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
  await api.press("ArrowRight");
  await expect(cli).toBeFocused();
  await cli.press("ArrowLeft");
  await expect(api).toBeFocused();
  await api.press("Home");
  await expect(cli).toBeFocused();
  await expect(page.getByTestId("execution-mode-panel-local-cli")).toBeVisible();
  await cli.press("End");
  await expect(api).toBeFocused();
  await expect(page.getByTestId("execution-mode-panel-byok")).toBeVisible();
});
