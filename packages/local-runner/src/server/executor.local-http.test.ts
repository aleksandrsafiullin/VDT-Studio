import { describe, expect, it } from "vitest";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

function localHttpManifest() {
  return createManifestRegistry().get("ollama")!;
}

function chatResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function chatTextResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("local HTTP executor repair", () => {
  it.each([["vdt-fast", false], ["vdt-fast", "low"], [true, true], ["high", "high"]])(
    "sends the exact native Ollama reasoning preference %s resolved as %s",
    async (preference, effective) => {
      const bodies: Array<Record<string, unknown>> = [];
      const fetch: typeof globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/api/show")) return Response.json({ thinking: { values: effective === "low" ? ["high", "low"] : [true, false, "high"] } });
        expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
        expect(init?.redirect).toBe("error");
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ done: true, done_reason: "stop", message: { content: '{"ok":true}', thinking: "private trace" } });
      };
      const result = await executeCompletion(localHttpManifest(), {
        requestId: crypto.randomUUID(), backendId: "ollama", taskType: "generate_tree",
        schemaId: "connection-test-v1", input: { probe: true }, model: "qwen3", modelReasoning: preference
      }, new AbortController().signal, { fetch });
      expect(bodies).toEqual([expect.objectContaining({ model: "qwen3", think: effective,
        format: expect.objectContaining({ properties: { ok: { const: true, type: "boolean" } } }) })]);
      expect(result.output).toEqual({ ok: true });
      expect(JSON.stringify(result)).not.toContain("private trace");
    }
  );

  it("preserves Provider default when Fast metadata is unavailable", async () => {
    const fetch: typeof globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/api/show")) return new Response("Unknown endpoint", { status: 404 });
      expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
      expect(JSON.parse(String(init?.body))).not.toHaveProperty("think");
      return chatResponse({ ok: true });
    };
    await expect(executeCompletion(localHttpManifest(), {
      requestId: crypto.randomUUID(), backendId: "ollama", taskType: "generate_tree",
      schemaId: "connection-test-v1", input: { probe: true }, model: "qwen3", modelReasoning: "vdt-fast"
    }, new AbortController().signal, { fetch })).resolves.toMatchObject({ output: { ok: true } });
  });
  it("uses agent-decision-v2 strict JSON Schema and normalizes callsJson", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return chatResponse({
        type: "call_tools",
        toolName: "",
        argsJson: "{}",
        callsJson: "[{\"toolName\":\"project.get_node\",\"args\":{\"nodeId\":\"root\"}},{\"toolName\":\"project.get_subtree\",\"args\":{\"nodeId\":\"root\",\"maxDepth\":2}}]",
        statusMessage: "Inspecting the project.",
        questionsJson: "[]",
        summary: "",
        nextSuggestedActions: []
      });
    };

    const result = await executeCompletion(
      localHttpManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "ollama",
        taskType: "agent_decision",
        schemaId: "agent-decision-v2",
        input: { runId: "run", currentProject: { nodes: [] } }
      },
      new AbortController().signal,
      { fetch: fetchMock }
    );

    expect(result.output).toEqual({
      type: "call_tools",
      calls: [
        { toolName: "project.get_node", args: { nodeId: "root" } },
        { toolName: "project.get_subtree", args: { nodeId: "root", maxDepth: 2 } }
      ],
      statusMessage: "Inspecting the project."
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("performs one bounded repair attempt after schema validation fails", async () => {
    const bodies: Array<{ messages?: Array<{ role: string; content: string }> }> = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? chatResponse({ invalid: true })
        : chatResponse({
            projectTitle: "Repaired tree",
            rootNodeId: "root",
            nodes: [{ id: "root" }],
            edges: [],
            assumptions: [],
            questionsForUser: [],
            warnings: []
          });
    };

    const result = await executeCompletion(
      localHttpManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "ollama",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { businessContext: "original project context must not be sent to repair" }
      },
      new AbortController().signal,
      { fetch: fetchMock }
    );

    expect(result.schemaValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.repairAttempted).toBe(true);
    expect(result.repairSucceeded).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Repaired tree", rootNodeId: "root" });
    expect(bodies).toHaveLength(2);

    const repairBody = bodies[1]!;
    const repairPrompt = repairBody.messages?.map((message) => message.content).join("\n") ?? "";
    const repairPayload = JSON.parse(repairBody.messages?.find((message) => message.role === "user")?.content ?? "{}") as {
      invalidJsonExcerpt?: string;
    };
    expect(repairPrompt).toContain("validationErrors");
    expect(repairPrompt).toContain("invalidJsonExcerpt");
    expect(repairPrompt).toContain("generate-tree-v1");
    expect(repairPayload.invalidJsonExcerpt).toBe('{"invalid":true}');
    expect(repairPrompt).not.toContain("original project context must not be sent to repair");
  });

  it("repairs a malformed JSON response once", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? chatTextResponse("not json")
        : chatResponse({
            projectTitle: "Formatting repaired tree",
            rootNodeId: "root",
            nodes: [{ id: "root" }],
            edges: [],
            assumptions: [],
            questionsForUser: [],
            warnings: []
          });
    };

    const result = await executeCompletion(
      localHttpManifest(),
      {
        requestId: crypto.randomUUID(),
        backendId: "ollama",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: { prompt: "Build a tree" }
      },
      new AbortController().signal,
      { fetch: fetchMock }
    );

    expect(result.schemaValid).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.output).toMatchObject({ projectTitle: "Formatting repaired tree" });
    expect(calls).toBe(2);
  });

  it("fails after exactly one unsuccessful repair attempt", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      return chatResponse({ invalid: true });
    };

    await expect(
      executeCompletion(
        localHttpManifest(),
        {
          requestId: crypto.randomUUID(),
          backendId: "ollama",
          taskType: "generate_tree",
          schemaId: "generate-tree-v1",
          input: { prompt: "Build a tree" }
        },
        new AbortController().signal,
        { fetch: fetchMock }
      )
    ).rejects.toMatchObject({ code: "SCHEMA_INVALID", repairAttempted: true, repairSucceeded: false });

    expect(calls).toBe(2);
  });
});
