import { describe, expect, it } from "vitest";
import { detectSubscriptionCli, enrichSubscriptionCliDetections } from "@vdt-studio/model-bridge/local-runtime";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";

const liveEnabled = process.env.VDT_LIVE_COPILOT === "1";

describe.skipIf(!liveEnabled)("copilot live integration", () => {
  it("opens an authenticated ACP session", async () => {
    const detected = await detectSubscriptionCli("copilot");
    expect(detected.installed).toBe(true);
    await expect(enrichSubscriptionCliDetections([detected])).resolves.toEqual([
      expect.objectContaining({ id: "copilot", status: "ready" })
    ]);
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
