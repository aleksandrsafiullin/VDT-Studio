import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRuntimeContext, runtimeHarnessSettings, completeRuntime } from "./runtime";
import { handleSidecarRequest } from "../sidecar/runtime";
import { parseSidecarFrame } from "../sidecar/protocol";

const roots: string[] = [];
const fixture = fileURLToPath(new URL("../../../model-bridge/src/harness/fixtures/fake-harness.cjs", import.meta.url));
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("host-owned custom connections", () => {
  it("saves, reloads, executes and deletes a profile through the private pipe", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-settings-")); roots.push(root);
    const config = { executor: { env: { ...process.env, VDT_HARNESS_CONFIG: path.join(root, "profiles.json") } }, auditSink: () => {} };
    const context = createLocalRuntimeContext(config);
    const profile = { id: "custom-pipe", name: "Pipe agent", transport: "acp", command: fixture, args: [] };
    const frame = parseSidecarFrame(JSON.stringify({ protocolVersion: 1, type: "request", requestId: crypto.randomUUID(), method: "harness_settings", payload: { action: "save", profile } }));
    if (frame.type !== "request") throw new Error("Expected a request");
    expect(await handleSidecarRequest(frame, context)).toMatchObject({ ok: true, payload: { profiles: [{ id: "custom-pipe" }] } });
    const restored = createLocalRuntimeContext(config);
    expect(restored.manifests.get("custom-pipe_subscription")?.harness?.name).toBe("Pipe agent");
    const result = await completeRuntime({ requestId: crypto.randomUUID(), backendId: "custom-pipe_subscription", taskType: "generate_tree", schemaId: "connection-test-v1", input: {} }, restored);
    expect(result.payload).toMatchObject({ ok: true, output: { ok: true } });
    await runtimeHarnessSettings({ action: "remove", removeId: "custom-pipe" }, restored);
    expect(restored.manifests.has("custom-pipe_subscription")).toBe(false);
  });
  it("does not accept shell/credential values or replace a built-in definition", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-settings-")); roots.push(root);
    const context = createLocalRuntimeContext({ executor: { env: { ...process.env, VDT_HARNESS_CONFIG: path.join(root, "profiles.json") } } });
    await expect(runtimeHarnessSettings({ action: "save", profile: { id: "codex", name: "Override", transport: "acp", command: "sh", args: ["-c", "echo test"] } }, context)).rejects.toMatchObject({ code: "INVALID_HARNESS_PROFILE" });
    expect(context.manifests.get("codex_subscription")?.harness?.command).toBe("codex");
  });
});
