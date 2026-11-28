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
  await page.getByTestId("cli-agent-remove-claude").click();
  await expect(page.getByTestId("cli-agent-card-claude")).toHaveCount(0);
  await expect(page.getByTestId("local-cli-removed-notice")).toContainText("Chat now uses Cursor Agent");
  await expect(page.getByTestId("local-cli-undo-remove")).toBeFocused();
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

test("removing the final subscription clears chat and Undo restores the ready provider", async ({ page }) => {
  await mockDetection(page, [detection("claude")]);
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-select-claude").click();
  await page.getByTestId("cli-agent-remove-claude").click();
  await expect(page.getByTestId("local-cli-active-selection")).toContainText("No provider selected");
  await expect(page.getByTestId("local-cli-removed-notice")).toContainText("Choose another provider");
  await page.getByTestId("local-cli-undo-remove").click();
  await expect(page.getByTestId("cli-agent-select-claude")).toBeFocused();
  await expect(page.getByTestId("cli-agent-select-claude")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => {
    const { state } = JSON.parse(localStorage.getItem("vdt-studio-state")!);
    return { selected: state.executionSettings.selectedCliAgentId, removed: state.removedCliAgentIds };
  })).toEqual({ selected: "claude", removed: [] });

  await page.reload();
  await page.getByTestId("settings-button").click();
  await page.getByTestId("execution-mode-tab-local-cli").click();
  await page.getByTestId("local-cli-rescan").click();
  await expect(page.getByTestId("local-cli-scan-status")).toHaveCount(0);
  await expect(page.getByTestId("cli-agent-select-claude")).toHaveAttribute("aria-pressed", "true");
});

test("Test exposes busy, failure and retry states without duplicate requests", async ({ page }) => {
  const claude = detection("claude");
  await mockDetection(page, [claude]);
  let calls = 0;
  let releaseTest: (() => void) | undefined;
  await page.route("**/api/ai/dev-runtime", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "harness_settings") return route.fallback();
    expect(body).toEqual({ operation: "test", backendId: "claude_subscription" });
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((resolve) => { releaseTest = resolve; });
      Object.assign(claude, detection("claude", "authentication_required"));
      await route.fulfill({ status: 502, json: { ok: false, error: "Provider session expired. Sign in and retry." } });
    } else {
      Object.assign(claude, detection("claude"));
      await route.fulfill({ json: { ok: true } });
    }
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
    if (body.operation === "harness_settings") return route.fallback();
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
  await page.route("**/api/ai/dev-runtime", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "harness_settings") return route.fallback();
    expect(body).toEqual({ operation: "open_provider_auth", backendId: "claude_subscription" });
    await route.fulfill({ json: { ok: true, action: "instructions", instructions: "Run claude login, then Test." } });
  });
  await openLocalSettings(page);
  await page.getByTestId("cli-agent-authenticate-claude").click();
  await expect(page.getByTestId("provider-auth-status-claude")).toContainText("Run claude login");
  await expect(page.getByTestId("cli-agent-sign-in-guide-claude")).toBeVisible();
  const opens = await page.evaluate(() => Reflect.get(window, "__signInOpens"));
  expect(opens).toEqual([{ url: "https://code.claude.com/docs/en/setup", active: true }]);
  await expect(page.getByTestId("cli-agent-sign-in-guide-claude")).toHaveAttribute("href", opens[0].url);
  await expect(page.getByTestId("provider-auth-status-claude")).not.toContainText("verified");
});

test("subscription hierarchy stays compact on a narrow screen with secondary options collapsed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDetection(page);
  await openLocalSettings(page);
  await expect(page.getByRole("heading", { name: "Your subscriptions", exact: true })).toHaveCount(1);
  await expect(page.getByTestId("local-model-settings")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Local models", exact: true })).toBeVisible();
  await expect(page.getByTestId("cli-agent-details-claude")).not.toHaveAttribute("open");
  const widths = await page.getByTestId("local-cli-settings").evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

test("Local models opens independently, restores server/model choices and preserves legacy preferences", async ({ page }) => {
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
    const body = route.request().postDataJSON();
    if (body.operation === "harness_settings") return route.fallback();
    expect(body.operation).toBe("list_models");
    await route.fulfill({ json: { ok: true, models: ["local-saved", "second-local"] } });
  });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await expect(page.getByTestId("execution-mode-tab-local-models")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("local-model-model-lm_studio_openai")).toHaveValue("local-saved");
  await expect(page.getByText("Loading available models...")).toHaveCount(0);
  expect(cliScans).toBe(0);
  await expect(page.getByTestId("local-cli-settings")).toHaveCount(0);
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

test("a late local model list does not supersede an explicit Apple readiness check", async ({ page }) => {
  test.skip(process.env.VDT_E2E_DESKTOP_MODE !== "1", "Requires the desktop execution client.");
  await page.addInitScript(() => {
    const mock = { ollamaListPending: false, releaseOllama: undefined as (() => void) | undefined };
    const modelListGate = new Promise<void>(resolve => { mock.releaseOllama = resolve; });
    Reflect.set(window, "__appleSettingsRace", mock);
    Reflect.set(window, "__TAURI__", { core: { invoke: async (method: string, args: { backendId?: string }) => {
      if (method !== "ai_list_models" || args.backendId !== "ollama") throw new Error("No native backend in the browser fixture.");
      mock.ollamaListPending = true;
      await modelListGate;
      return ["late-ollama-model"];
    } } });
  });
  let releaseApple: (() => void) | undefined;
  await page.route("**/api/agent/bindings/apple", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, firstLaunchDefaultEnabled: false } });
    const { locale } = route.request().postDataJSON();
    await new Promise<void>(resolve => { releaseApple = resolve; });
    const providerId = "apple_foundation_models", modelId = "SystemLanguageModel.default";
    await route.fulfill({ json: { ok: true, binding: { bindingId: "apple_native_settings_race", executionProfile: "model_agent",
      backendId: providerId, modelId, appleIdentity: { locale, osBuild: "fixture" },
      admission: { mode: "local", providerId, modelId, profileVersion: 1, modelRevision: null } } } });
  });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByTestId("execution-mode-tab-local-models").click();
  await page.getByTestId("local-model-select-ollama_openai").click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "__appleSettingsRace").ollamaListPending)).toBe(true);
  const card = page.getByTestId("apple-local-model");
  await card.getByRole("button", { name: "Select", exact: true }).click();
  await expect.poll(() => Boolean(releaseApple)).toBe(true);
  try {
    await page.evaluate(() => Reflect.get(window, "__appleSettingsRace").releaseOllama());
    await expect(page.getByTestId("local-model-model-ollama_openai").locator('option[value="late-ollama-model"]')).toHaveCount(1);
    await expect(card.getByText("Checking Apple model availability…")).toBeVisible();
    const model = await page.evaluate(() => JSON.parse(localStorage.getItem("vdt-studio-state")!).state.executionSettings.localModel);
    expect(model).not.toBe("late-ollama-model");
  } finally {
    releaseApple?.();
  }
  await expect(card.getByRole("button", { name: "Selected", exact: true })).toBeDisabled();
});

test("desktop Pro setup copies public addresses and keeps the address usable without clipboard access", async ({ page }) => {
  test.skip(process.env.VDT_E2E_DESKTOP_MODE !== "1", "Requires the desktop settings presentation.");
  await page.addInitScript(() => {
    const clipboard = { text: "https://example.invalid/clipboard-fixture", denied: false };
    Reflect.set(window, "__voiceSetupClipboard", clipboard);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => {
        if (clipboard.denied) throw new DOMException("Fixture denied writeText", "NotAllowedError");
        clipboard.text = text;
      } }
    });
  });
  await page.goto("/");
  await page.getByTestId("settings-button").click();
  await page.getByRole("button", { name: "Voice input", exact: true }).click();
  await page.getByText("Using ChatGPT Pro with voice", { exact: true }).click();
  await page.getByRole("button", { name: "Copy link to OpenAI API keys" }).click();
  await expect(page.getByText("OpenAI API keys link copied. Paste it into your browser.")).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "__voiceSetupClipboard").text)).toBe("https://platform.openai.com/api-keys");

  await page.evaluate(() => { Reflect.get(window, "__voiceSetupClipboard").denied = true; });
  await page.getByRole("button", { name: "Copy link to Credit grants" }).click();
  const fallback = page.getByRole("textbox", { name: "Setup link address" });
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveValue("https://platform.openai.com/settings/organization/billing/credit-grants");
  expect(await fallback.evaluate(input => (input as HTMLInputElement).readOnly)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, "__voiceSetupClipboard").text)).toBe("https://platform.openai.com/api-keys");
});
