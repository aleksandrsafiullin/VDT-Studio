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
