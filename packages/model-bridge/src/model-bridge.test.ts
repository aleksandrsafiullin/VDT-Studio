import { describe, expect, it } from "vitest";
import { FakeModelBackend } from "./fake-backend";
import { MODEL_BACKEND_DEFINITIONS, getModelBackendDefinition } from "./registry";
import { extractBoundedJson } from "./safe-json";

describe("model backend contract", () => {
  it("registers unique production-facing backend ids", () => {
    expect(new Set(MODEL_BACKEND_DEFINITIONS.map((backend) => backend.id)).size).toBe(MODEL_BACKEND_DEFINITIONS.length);
    expect(getModelBackendDefinition("cursor_subscription").mode).toBe("subscription_cli");
    expect(getModelBackendDefinition("ollama").mode).toBe("local_http");
  });

  it("returns a contract-shaped result from the fake backend", async () => {
    const backend = new FakeModelBackend((input) => ({ accepted: input }));
    const result = await backend.completeStructured<{ kpi: string }, { accepted: { kpi: string } }>({
      requestId: "request-1",
      taskType: "generate_tree",
      input: { kpi: "Production Volume" },
      systemPrompt: "System",
      userPrompt: "User",
      schemaId: "generate-tree-v1",
      timeoutMs: 1_000,
      maxOutputBytes: 10_000
    });
    expect(result.output.accepted.kpi).toBe("Production Volume");
    expect(result.validation).toEqual({ schemaValid: true, repaired: false });
  });
});

describe("bounded JSON extraction", () => {
  it("extracts one balanced object without accepting trailing prose", () => {
    expect(extractBoundedJson('result: {"value":"} inside string","nested":{"ok":true}} trailing', 1_000))
      .toEqual({ value: "} inside string", nested: { ok: true } });
  });

  it("rejects oversized and malformed output", () => {
    expect(() => extractBoundedJson('{"value":"large"}', 4)).toThrow("exceeds");
    expect(() => extractBoundedJson("not json", 100)).toThrow("complete JSON object");
  });
});
