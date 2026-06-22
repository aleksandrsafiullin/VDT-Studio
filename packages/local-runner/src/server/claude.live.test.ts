import { describe, expect, it } from "vitest";
import { findExecutableOnPath } from "../../../model-bridge/src/detection";
import { testClaudeConnection } from "@vdt-studio/model-bridge";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const liveEnabled = process.env.VDT_LIVE_CLAUDE === "1";

describe.skipIf(!liveEnabled)("claude live integration", () => {
  it("probes auth for claude on PATH", async () => {
    const match = await findExecutableOnPath(["claude"]);
    expect(match).not.toBeNull();
    const result = await testClaudeConnection(match!.executable);
    expect(result.status).toBe("ready");
  });

  it("runs connection test through the certified executor", async () => {
    const result = await executeCompletion(
      createManifestRegistry().get("claude_subscription")!,
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "connection-test-v1",
        input: { probe: true }
      },
      new AbortController().signal
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
  }, 120_000);

  it("returns schema-valid generate-tree output", async () => {
    const result = await executeCompletion(
      createManifestRegistry().get("claude_subscription")!,
      {
        requestId: crypto.randomUUID(),
        backendId: "claude_subscription",
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {
          prompt: "Return a minimal valid generate-tree-v1 JSON object with one root node named Revenue."
        },
        timeoutMs: 120_000
      },
      new AbortController().signal
    );
    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({
      projectTitle: expect.any(String),
      rootNodeId: expect.any(String),
      nodes: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })])
    });
  }, 180_000);
});
