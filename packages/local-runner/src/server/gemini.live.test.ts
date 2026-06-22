import { describe, expect, it } from "vitest";
import { findExecutableOnPath, testGeminiConnection } from "@vdt-studio/model-bridge";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const liveEnabled = process.env.VDT_LIVE_GEMINI === "1";

describe.skipIf(!liveEnabled)("gemini live integration", () => {
  it("probes account authentication", async () => {
    const match = await findExecutableOnPath(["gemini"]);
    expect(match).not.toBeNull();
    await expect(testGeminiConnection(match!.executable)).resolves.toMatchObject({ status: "ready" });
  });

  it("runs a tool-free schema-valid connection test", async () => {
    const result = await executeCompletion(
      createManifestRegistry().get("gemini_subscription")!,
      { requestId: crypto.randomUUID(), backendId: "gemini_subscription", taskType: "generate_tree", schemaId: "connection-test-v1", input: { probe: true } },
      new AbortController().signal
    );
    expect(result.output).toEqual({ ok: true });
  }, 120_000);
});
