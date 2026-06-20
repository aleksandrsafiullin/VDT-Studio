import { describe, expect, it } from "vitest";
import { handleMcpRequest } from "./mcp-server";

function textPayload(result: unknown) {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text;
  if (!text) {
    throw new Error("Expected MCP text payload.");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe("VDT MCP server tools", () => {
  it("advertises read-only VDT tools", async () => {
    const result = await handleMcpRequest({ method: "tools/list", id: 1 });
    const tools = (result as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).toEqual(["list_examples", "get_example", "validate_project"]);
  });

  it("lists checked-in calculable examples", async () => {
    const result = await handleMcpRequest({
      method: "tools/call",
      id: 1,
      params: { name: "list_examples", arguments: {} }
    });
    const payload = textPayload(result);

    expect(payload.ok).toBe(true);
    expect((payload.examples as Array<{ file: string }>).map((example) => example.file)).toContain("oee.json");
  });

  it("gets and validates an example project", async () => {
    const exampleResult = await handleMcpRequest({
      method: "tools/call",
      id: 1,
      params: { name: "get_example", arguments: { id: "oee" } }
    });
    const examplePayload = textPayload(exampleResult) as { project: unknown };

    const validationResult = await handleMcpRequest({
      method: "tools/call",
      id: 2,
      params: { name: "validate_project", arguments: { projectJson: JSON.stringify(examplePayload.project) } }
    });
    const validationPayload = textPayload(validationResult);

    expect(validationPayload.ok).toBe(true);
    expect(validationPayload.rootNodeId).toBe("oee");
    expect(validationPayload.rootValue).toBeCloseTo(64.772727, 5);
  });
});
