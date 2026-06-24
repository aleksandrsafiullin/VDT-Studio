import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const fakeGemini = fileURLToPath(new URL("./fixtures/fake-gemini.cjs", import.meta.url));
const fakeCopilot = fileURLToPath(new URL("./fixtures/fake-copilot.cjs", import.meta.url));

function request(backendId: string, schemaId = "generate-tree-v1") {
  return {
    requestId: crypto.randomUUID(), backendId, taskType: "generate_tree" as const, schemaId,
    input: { prompt: "Build a tree" }
  };
}

describe("Gemini and Copilot subscription executors", () => {
  for (const provider of [
    { id: "gemini_subscription", fake: fakeGemini, title: "Fake Gemini tree", envKey: "VDT_FAKE_GEMINI_MODE" },
    { id: "copilot_subscription", fake: fakeCopilot, title: "Fake Copilot tree", envKey: "VDT_FAKE_COPILOT_MODE" }
  ] as const) {
    it(`returns schema-valid output from ${provider.id}`, async () => {
      const result = await executeCompletion(
        createManifestRegistry().get(provider.id)!, request(provider.id), new AbortController().signal,
        { resolveExecutable: async () => provider.fake }
      );
      expect(result.schemaValid).toBe(true);
      expect(result.output).toMatchObject({ projectTitle: provider.title, rootNodeId: "root" });
    });

    it(`rejects invalid schema output from ${provider.id}`, async () => {
      await expect(executeCompletion(
        createManifestRegistry().get(provider.id)!, request(provider.id), new AbortController().signal,
        { env: { ...process.env, [provider.envKey]: "bad-schema" }, resolveExecutable: async () => provider.fake }
      )).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    });

    it(`classifies authentication failures from ${provider.id}`, async () => {
      await expect(executeCompletion(
        createManifestRegistry().get(provider.id)!, request(provider.id, "connection-test-v1"), new AbortController().signal,
        { env: { ...process.env, [provider.envKey]: "auth-required" }, resolveExecutable: async () => provider.fake }
      )).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    });

    it(`cancels ${provider.id} without accepting partial output`, async () => {
      const controller = new AbortController();
      const completion = executeCompletion(
        createManifestRegistry().get(provider.id)!, request(provider.id), controller.signal,
        { env: { ...process.env, [provider.envKey]: "slow" }, resolveExecutable: async () => provider.fake }
      );
      setTimeout(() => controller.abort(), 50);
      await expect(completion).rejects.toMatchObject({ code: "CANCELLED" });
    });
  }

});
