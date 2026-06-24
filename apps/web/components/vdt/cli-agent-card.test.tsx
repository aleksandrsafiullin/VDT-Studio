import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CliAgentCard } from "./cli-agent-card";
import { getCliCatalogEntry } from "@/lib/execution-mode-catalog";

function hasNestedButtonMarkup(html: string): boolean {
  const tagRegex = /<\/?button\b[^>]*>/gi;
  let depth = 0;

  for (const match of html.matchAll(tagRegex)) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      continue;
    }
    if (tag.endsWith("/>")) {
      continue;
    }
    depth += 1;
    if (depth > 1) {
      return true;
    }
  }

  return false;
}

describe("CliAgentCard", () => {
  const claudeCatalog = getCliCatalogEntry("claude");
  const codexCatalog = getCliCatalogEntry("codex");
  const cursorCatalog = getCliCatalogEntry("cursor-agent");

  it("renders sibling buttons without nesting", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={claudeCatalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0",
          status: "installed"
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={["claude-sonnet-4-5"]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(hasNestedButtonMarkup(html)).toBe(false);
    expect(html).toContain('data-testid="cli-agent-select-claude"');
    expect(html).toContain('data-testid="cli-agent-test-claude"');
    expect(html).toContain(`aria-label="Select ${claudeCatalog.displayName}"`);
  });

  it("keeps the model panel outside the selection button when selected", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={claudeCatalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0",
          status: "installed"
        }}
        selected
        modelSelection={{ source: "agent_default" }}
        discoveredModels={["claude-sonnet-4-5"]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(hasNestedButtonMarkup(html)).toBe(false);
    expect(html).toContain('data-testid="cli-agent-model-claude"');
    expect(html).toContain("Live from CLI");
  });

  it("shows catalog suggestions and models without live discovery", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={claudeCatalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0",
          status: "installed"
        }}
        selected
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain("Catalog suggestions");
    expect(html).not.toContain("Live from CLI");
    expect(html).toContain("claude-sonnet-4-6");
    expect(html).toContain("claude-opus-4-8");
    expect(html).toContain("Usage and limits are managed by the provider");
  });

  it("exposes async test status to assistive tech with distinct info styling", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={claudeCatalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0",
          status: "installed"
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        testStatus={{ kind: "info", message: "CLI responded; model list unavailable." }}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("CLI responded; model list unavailable.");
    expect(html).toContain('data-testid="provider-test-status-claude"');
    expect(html).toContain("border-slate-200");
    expect(html).toContain("bg-slate-50");
  });

  it("shows ready Cursor state with compatible version chip and auth summary", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={cursorCatalog}
        detection={{
          id: "cursor-agent",
          installed: true,
          executable: "/usr/local/bin/agent",
          alias: "agent",
          version: "0.46.0",
          status: "ready",
          authSummary: "Cursor account is authenticated and ready."
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={["auto"]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain('data-testid="cli-agent-version-chip-cursor-agent"');
    expect(html).toContain("Compatible");
    expect(html).toContain("Cursor account is authenticated and ready.");
    expect(html).not.toContain('disabled=""');
  });

  it("shows authentication_required guidance without disabling select", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={cursorCatalog}
        detection={{
          id: "cursor-agent",
          installed: true,
          executable: "/usr/local/bin/agent",
          alias: "agent",
          version: "0.46.0",
          status: "authentication_required",
          authSummary: "Cursor sign-in required. Run `agent login` in a terminal."
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onAuthenticate={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain('data-testid="cli-agent-auth-guidance-cursor-agent"');
    expect(html).toContain('data-testid="cli-agent-authenticate-cursor-agent"');
    expect(html).toContain("Authenticate");
    expect(html).toContain("Cursor sign-in required");
    expect(html).toContain("Compatible");
    expect(html).not.toMatch(/data-testid="cli-agent-test-cursor-agent"[^>]*disabled/);
  });

  it("disables test for unsupported_version and shows incompatible chip", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={cursorCatalog}
        detection={{
          id: "cursor-agent",
          installed: true,
          executable: "/usr/local/bin/agent",
          alias: "agent",
          version: "0.40.0",
          status: "unsupported_version",
          authSummary: "Cursor Agent CLI version is not supported.",
          diagnostics: ["Cursor Agent 0.40.0 is below the minimum supported version 0.45.0."]
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain("Incompatible");
    expect(html).toContain("Cursor Agent CLI version is not supported.");
    expect(html).toMatch(/data-testid="cli-agent-test-cursor-agent"[^>]*disabled/);
  });

  it("shows ready Codex state with compatible version chip and auth summary", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={codexCatalog}
        detection={{
          id: "codex",
          installed: true,
          executable: "/usr/local/bin/codex",
          alias: "codex",
          version: "0.25.0",
          status: "ready",
          authSummary: "ChatGPT subscription is authenticated and ready."
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain('data-testid="cli-agent-version-chip-codex"');
    expect(html).toContain("Compatible");
    expect(html).toContain("ChatGPT subscription is authenticated");
  });

  it("shows Claude authentication_required guidance", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={claudeCatalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: "claude",
          version: "1.2.0",
          status: "authentication_required",
          authSummary: "Claude Pro sign-in required. Run `claude login` in a terminal."
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toContain('data-testid="cli-agent-auth-guidance-claude"');
    expect(html).toContain("Claude Pro sign-in required");
    expect(html).not.toMatch(/data-testid="cli-agent-test-claude"[^>]*disabled/);
  });

  it("disables test when codex is not installed", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={codexCatalog}
        detection={{
          id: "codex",
          installed: false,
          executable: null,
          alias: null,
          version: null,
          status: "not_installed"
        }}
        selected={false}
        modelSelection={{ source: "agent_default" }}
        discoveredModels={[]}
        isTesting={false}
        onSelect={() => undefined}
        onTest={() => undefined}
        onModelSelectionChange={() => undefined}
      />
    );

    expect(html).toMatch(/data-testid="cli-agent-test-codex"[^>]*disabled/);
  });
});
