import { mkdtemp, rm, copyFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { updateHarnessProfiles } from "@vdt-studio/model-bridge/node";
import { registerHarnessSessionBindings, isCurrentHarnessSession, isAdmittedHarnessSession } from "./harness-session-bindings";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it("keeps active engine definitions immutable and retires edited/deleted profiles from new starts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-bindings-")); roots.push(root);
  const executable = path.join(root, "fixture.cjs");
  await copyFile(fileURLToPath(new URL("../../../../../../packages/model-bridge/src/harness/fixtures/fake-harness.cjs", import.meta.url)), executable); await chmod(executable, 0o700);
  vi.stubEnv("VDT_HARNESS_CONFIG", path.join(root, "profiles.json"));
  vi.stubEnv("PATH", `${root}${path.delimiter}${path.dirname(process.execPath)}`);
  const profile = { id: "custom-binding-fixture", name: "Before", command: executable, args: [], transport: "acp", defaultModel: "test-model", timeoutMs: 5000 };
  await updateHarnessProfiles({ profile });
  const registered: Array<{ bindingId: string; engine: unknown; modelId: string }> = [];
  const options = { toolCatalogHash: `sha256:${"a".repeat(64)}`, allowedToolNames: ["project.get_current"], forbiddenRoots: [], register: (entry: typeof registered[number]) => { registered.push(entry); }, resolveBinding: async () => { throw new Error("No run is opened by metadata registration"); } };
  await registerHarnessSessionBindings(options);
  const before = registered.find(b => !b.bindingId.includes("_model_"))!;
  expect(before.modelId).toBe("test-model"); expect(isCurrentHarnessSession(before.bindingId)).toBe(true);
  expect(isAdmittedHarnessSession({ bindingId: before.bindingId, engineAdapterId: "custom-binding-fixture-acp-checkpoint-v1" })).toBe(true);
  registered.length = 0;
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
  await registerHarnessSessionBindings(options);
  expect(registered).toHaveLength(0); // A rescan must retain the active engine/session map.
  await updateHarnessProfiles({ profile: { ...profile, name: "After", timeoutMs: 6000 } });
  await registerHarnessSessionBindings(options);
  const after = registered.find(b => !b.bindingId.includes("_model_"))!;
  expect(after.bindingId).not.toBe(before.bindingId); expect(after.engine).not.toBe(before.engine);
  expect(isCurrentHarnessSession(before.bindingId)).toBe(false); expect(isCurrentHarnessSession(after.bindingId)).toBe(true);
  await updateHarnessProfiles({ removeId: "custom-binding-fixture" });
  expect(isCurrentHarnessSession(after.bindingId)).toBe(false);
}, 15_000);
