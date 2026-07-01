import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "./tools";
import { toolEnvelopeToMcpResult, toolRegistryToMcpSpecs } from "./mcp-shape";

describe("MCP-shaped tool adapter", () => {
  it("maps every registered tool to an MCP-shaped spec", () => {
    const registry = createDefaultToolRegistry();
    const specs = toolRegistryToMcpSpecs(registry);

    expect(specs).toHaveLength(registry.list().length);
    expect(specs.every((spec) => spec.name && spec.description && spec.inputSchema.type === "object")).toBe(true);
    expect(specs.find((spec) => spec.name === "vdt.add_driver")).toMatchObject({
      vdt: { mutatesProject: true, requiresDraftProject: true },
      annotations: { readOnlyHint: false }
    });
    expect(specs.find((spec) => spec.name === "skill.search")).toMatchObject({
      vdt: { mutatesProject: false },
      annotations: { readOnlyHint: true }
    });
    expect(specs.find((spec) => spec.name === "research.search_web")).toMatchObject({
      annotations: { openWorldHint: true }
    });
  });

  it("converts tool envelopes to MCP-shaped call results", () => {
    const ok = toolEnvelopeToMcpResult({
      toolName: "skill.search",
      ok: true,
      output: { candidates: [] },
      projectChanged: false,
      emittedEventIds: []
    });
    const failed = toolEnvelopeToMcpResult({
      toolName: "vdt.add_driver",
      ok: false,
      error: { code: "INVALID_TOOL_ARGS", message: "Expected string" },
      projectChanged: false,
      emittedEventIds: []
    });

    expect(ok).toMatchObject({
      content: [{ type: "json", json: { candidates: [] } }],
      structuredContent: { candidates: [] }
    });
    expect(failed).toMatchObject({
      isError: true,
      content: [{ type: "json", json: { error: { code: "INVALID_TOOL_ARGS" } } }],
      structuredContent: { ok: false, toolName: "vdt.add_driver" }
    });
  });
});
