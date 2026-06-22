import { describe, expect, it } from "vitest";
import { findExecutableOnPath, testCopilotConnection } from "@vdt-studio/model-bridge";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const liveEnabled = process.env.VDT_LIVE_COPILOT === "1";

describe.skipIf(!liveEnabled)("copilot live integration", () => {
  it("probes plan authentication", async () => {
    const match = await findExecutableOnPath(["copilot"]);
    expect(match).not.toBeNull();
    await expect(testCopilotConnection(match!.executable)).resolves.toMatchObject({ status: "ready" });
  });

  it("runs a tool-free schema-valid connection test", async () => {
    const result = await executeCompletion(
      createManifestRegistry().get("copilot_subscription")!,
      { requestId: crypto.randomUUID(), backendId: "copilot_subscription", taskType: "generate_tree", schemaId: "connection-test-v1", input: { probe: true } },
      new AbortController().signal
    );
    expect(result.output).toEqual({ ok: true });
  }, 120_000);
});
