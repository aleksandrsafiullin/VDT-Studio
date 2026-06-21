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
  const catalog = getCliCatalogEntry("claude");

  it("renders sibling buttons without nesting", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={catalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0"
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
    expect(html).toContain(`aria-label="Select ${catalog.displayName}"`);
  });

  it("keeps the model panel outside the selection button when selected", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={catalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0"
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
        catalog={catalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0"
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
  });

  it("exposes async test status to assistive tech with distinct info styling", () => {
    const html = renderToStaticMarkup(
      <CliAgentCard
        catalog={catalog}
        detection={{
          id: "claude",
          installed: true,
          executable: "/usr/local/bin/claude",
          alias: null,
          version: "1.0.0"
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
    expect(html).toContain("border-slate-200");
    expect(html).toContain("bg-slate-50");
  });
});
