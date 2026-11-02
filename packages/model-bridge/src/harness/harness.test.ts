import { describe, expect, it, afterEach } from "vitest";
import { mkdtemp, rm, readFile, copyFile, chmod } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { BUILTIN_HARNESSES } from "./catalog";
import { updateHarnessProfiles, readHarnessProfiles, profileDefinition, validateHarnessProfile } from "./profiles";
import { withHarnessSession, probeHarnessModels } from "./rpc-session";
import { HarnessCheckpointTransport, createHarnessCheckpointEngine } from "./checkpoint-engine";
import { resolveSmartHarnessIdentity } from "./smart-identity";
import { createHash } from "node:crypto";
import { resumeCheckpointCapabilityHash } from "../agent-engines/resume-checkpoint-engine-core";
import type { AgentSessionBinding, AgentEngineEvent } from "@vdt-studio/vdt-agent-runtime";

const fixture = fileURLToPath(new URL("./fixtures/fake-harness.cjs", import.meta.url));
const roots: string[] = [];
async function scratch() { const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-test-")); roots.push(root); return root; }
function definition(mode = "ok", transport: "acp" | "vdt-jsonl" = "acp") {
  return profileDefinition(validateHarnessProfile({ id: "custom-fixture", name: "Fixture", command: fixture, args: [], environmentRefs: { VDT_HARNESS_FIXTURE_MODE: "VDT_HARNESS_FIXTURE_MODE" }, transport, timeoutMs: 5000, defaultModel: "test-model" }));
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("shared harness registry and protocol", () => {
  it("ships exactly the thirteen current systems", () => {
    expect(BUILTIN_HARNESSES.map(h => h.id).sort()).toEqual(["claude", "codex", "copilot", "cursor-agent", "grok-build", "hermes", "kilo", "kimi", "kiro", "opencode", "pi", "qwen", "vibe"]);
  });
  it("persists concurrent additions atomically without storing environment values", async () => {
    const root = await scratch(), env = { ...process.env, VDT_HARNESS_CONFIG: path.join(root, "harnesses.json") };
    await Promise.all(["one", "two"].map(name => updateHarnessProfiles({ profile: { id: `custom-${name}`, name, command: fixture, args: [], transport: "acp", environmentRefs: { TOKEN: "MY_TOKEN" } } }, env)));
    expect(readHarnessProfiles(env)).toHaveLength(2);
    expect(await readFile(env.VDT_HARNESS_CONFIG, "utf8")).toContain('"TOKEN": "MY_TOKEN"');
    await updateHarnessProfiles({ removeId: "custom-one" }, env);
    expect(readHarnessProfiles(env).map(p => p.id)).toEqual(["custom-two"]);
  });
  it.each(["sh", "bash", "cmd.exe"])("rejects shell executables (%s)", command => {
    expect(() => validateHarnessProfile({ name: "Unsafe", command, args: [], transport: "acp" })).toThrow();
  });
  it("rejects bypass flags, reserved environment overrides and built-in ID collisions", () => {
    for (const patch of [{ id: "codex" }, { args: ["--yolo"] }, { environmentRefs: { NODE_OPTIONS: "OPTS" } }]) expect(() => validateHarnessProfile({ name: "Unsafe", command: fixture, args: [], transport: "acp", ...patch })).toThrow();
  });
  it("preserves the last valid store when a new definition exceeds the file bound", async () => {
    const root = await scratch(), env = { ...process.env, VDT_HARNESS_CONFIG: path.join(root, "profiles.json") };
    await updateHarnessProfiles({ profile: { id: "custom-original", name: "Original", command: fixture, args: [], transport: "acp" } }, env);
    await expect(updateHarnessProfiles({ profile: { name: "Too large", command: fixture, args: Array(64).fill("x".repeat(4096)), transport: "acp" } }, env)).rejects.toMatchObject({ code: "INVALID_HARNESS_PROFILE" });
    expect(readHarnessProfiles(env).map(p => p.id)).toEqual(["custom-original"]);
  });
  it("resolves custom wrapper metadata and its exact saved default without inference", async () => {
    const root = await scratch(), env = { ...process.env, VDT_HARNESS_CONFIG: path.join(root, "profiles.json") };
    await updateHarnessProfiles({ profile: { id: "custom-metadata", name: "Wrapper", command: process.execPath, args: [fixture], defaultModel: "test-model", transport: "acp" } }, env);
    expect(await resolveSmartHarnessIdentity("custom-metadata_subscription", undefined, AbortSignal.timeout(3000), env)).toMatchObject({ backendId: "custom-metadata_subscription", modelId: "test-model", requestModel: "test-model", modelResolution: "exact" });
  });
  it.each(["acp", "vdt-jsonl"] as const)("discovers account models and runs a completion using %s", async transport => {
    const env = { ...process.env, VDT_HARNESS_FIXTURE_MODE: "ok" }, h = definition("ok", transport);
    expect(await probeHarnessModels(h, AbortSignal.timeout(3000), env)).toEqual([{ id: "test-model", label: "Fixture model" }]);
    const result = await withHarnessSession(h, AbortSignal.timeout(3000), async s => { await s.selectModel("test-model", AbortSignal.timeout(1000)); return s.prompt("Reply with JSON", AbortSignal.timeout(1000), { schemaId: "connection-test-v1", schema: {}, input: {} }); }, { env });
    expect(JSON.parse(result)).toEqual({ ok: true });
  });
  it("rejects native tool activity instead of accepting a later valid answer", async () => {
    await expect(withHarnessSession(definition(), AbortSignal.timeout(3000), s => s.prompt("Reply with JSON", AbortSignal.timeout(1000)), { env: { ...process.env, VDT_HARNESS_FIXTURE_MODE: "tool" } })).rejects.toMatchObject({ code: "TOOL_ACTIVITY_REJECTED" });
  });
  it("maps missing sign-in without exposing provider diagnostics", async () => {
    await expect(probeHarnessModels(definition(), AbortSignal.timeout(3000), { ...process.env, VDT_HARNESS_FIXTURE_MODE: "auth" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
  it.each([["protocol-version", "UNSUPPORTED_PROTOCOL"], ["missing-capability", "HARNESS_CAPABILITY_MISSING"]])("rejects incompatible JSONL adapters (%s)", async (mode, code) => {
    await expect(probeHarnessModels(definition(mode, "vdt-jsonl"), AbortSignal.timeout(3000), { ...process.env, VDT_HARNESS_FIXTURE_MODE: mode })).rejects.toMatchObject({ code });
  });
  it("rejects an upstream model substitution", async () => {
    await expect(withHarnessSession(definition(), AbortSignal.timeout(3000), s => s.selectModel("test-model", AbortSignal.timeout(1000)), { env: { ...process.env, VDT_HARNESS_FIXTURE_MODE: "model-mismatch" } })).rejects.toMatchObject({ code: "MODEL_MISMATCH" });
  });
  it.each([["quota", "RATE_LIMITED"], ["disconnect", "HARNESS_PROCESS_EXITED"], ["malformed", "INVALID_RESPONSE"]])("fails closed on %s", async (mode, code) => {
    const error = await withHarnessSession(definition(), AbortSignal.timeout(3000), s => s.prompt("Reply", AbortSignal.timeout(1000)), { env: { ...process.env, VDT_HARNESS_FIXTURE_MODE: mode } }).then(() => undefined, e => e);
    expect(error).toMatchObject({ code }); expect(error.message).not.toContain("private-provider-diagnostic");
  });
  it("waits for an acknowledged cancellation", async () => {
    await expect(withHarnessSession(definition(), AbortSignal.timeout(3000), s => s.prompt("Wait", AbortSignal.timeout(50)), { env: { ...process.env, VDT_HARNESS_FIXTURE_MODE: "slow" } })).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("retains cleanup uncertainty when a daemon ignores cancellation", async () => {
    const error = await withHarnessSession(definition(), AbortSignal.timeout(3000), s => s.prompt("Wait", AbortSignal.timeout(50)), { env: { ...process.env, VDT_HARNESS_FIXTURE_MODE: "ignore-cancel" } }).then(() => undefined, e => e);
    expect(error).toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    // The fixture owns no daemon. Its viewer has closed; retain/report metadata,
    // then remove only this test's explicitly returned directory.
    expect(path.basename(error.retainedDirectory)).toMatch(/^vdt-harness-/);
    roots.push(error.retainedDirectory);
    expect(JSON.parse(await readFile(path.join(error.retainedDirectory, "cleanup-status.json"), "utf8"))).toMatchObject({ harnessId: "custom-fixture", status: "cleanup_unconfirmed" });
  });
  it("runs the standalone JSONL adapter through its real process boundary", async () => {
    const adapter = fileURLToPath(new URL("../../../../examples/harness-jsonl-adapter.mjs", import.meta.url));
    const h = profileDefinition(validateHarnessProfile({ name: "External adapter", command: process.execPath, args: [adapter, "--command", process.execPath, "--", fixture], transport: "vdt-jsonl" }));
    const output = await withHarnessSession(h, AbortSignal.timeout(5000), s => s.prompt("Return one JSON object.", AbortSignal.timeout(3000), { schemaId: "connection-test-v1", schema: {}, input: {} }));
    expect(JSON.parse(output)).toEqual({ ok: true });
  });
  it.each(["acp", "vdt-jsonl"] as const)("preserves a %s logical session across checkpoint segments", async protocol => {
    const root = await scratch(), executable = path.join(root, "fixture.cjs"); await copyFile(fixture, executable); await chmod(executable, 0o700);
    const h = profileDefinition(validateHarnessProfile({ name: "Fixture", command: executable, args: [], transport: protocol }));
    const transport = new HarnessCheckpointTransport(h, executable, "1.0.0");
    const environment = { environmentId: "fixture-env", privateWorkspacePath: root, privateStatePath: root, forbiddenRoots: [] };
    const first = await transport.executeSegment({ mode: "open", environment, model: "test-model", prompt: "__checkpoint_fixture__", signal: AbortSignal.timeout(3000) }, ["project.get_current"]);
    const next = await transport.executeSegment({ mode: "resume", expectedSessionId: first.sessionId, environment, model: "test-model", prompt: "__checkpoint_fixture__", signal: AbortSignal.timeout(3000) }, ["project.get_current"]);
    expect(next.sessionId).toBe(first.sessionId); expect(first.turn.action.type).toBe("action_batch"); expect(next.processSpawnCount).toBe(0);
    await transport.closeEnvironment(environment.environmentId);
  });
  it.each(["acp", "vdt-jsonl"] as const)("runs a %s agent session through the canonical tool-result and question contract", async protocol => {
    const root = await scratch();
    const h = profileDefinition(validateHarnessProfile({ id: "custom-engine", name: "Engine fixture", command: fixture, args: ["--checkpoint-engine-fixture"], transport: protocol }));
    const transport = new HarnessCheckpointTransport(h, fixture, "1.0.0"), sha = `sha256:${"b".repeat(64)}`;
    const environment = { environmentId: "engine-env", privateWorkspacePath: root, privateStatePath: root, forbiddenRoots: [], close: () => transport.closeEnvironment("engine-env") };
    const engine = createHarnessCheckpointEngine({ definition: h, executable: fixture, cliVersion: "1.0.0", transport, toolCatalogHash: sha, allowedToolNames: ["project.get_current", "user.ask"], enableUnverifiedCanary: true, sessionEnvironmentFactory: () => environment, resolveBinding: async () => { throw new Error("No recovery is requested"); } });
    const capability = engine.capability;
    const binding: AgentSessionBinding = { schemaVersion: 2, bindingId: "fixture-binding", runId: "fixture-run", projectId: "fixture-project", executionProfile: "external_cli_agent", engineId: capability.engineId, engineAdapterId: capability.engineAdapterId, backendId: capability.backendId, modelId: "test-model", protocolVersion: capability.protocolVersion, cliVersion: capability.cli.version, toolIsolation: "unverified", qualificationStatus: "unverified", capabilityEvidenceHash: null, settingsHash: sha, capabilityProfileHash: resumeCheckpointCapabilityHash(capability), toolCatalogHash: sha, externalSessionId: null, sessionEpoch: 1, boundAt: "2026-11-01T10:00:00.000Z" };
    const initialContext = { request: "Inspect the model, then ask for its period." }, executed: string[] = [];
    const session = await engine.openSession({ binding, initialContext, initialContextHash: `sha256:${createHash("sha256").update(JSON.stringify(initialContext)).digest("hex")}` }, { signal: AbortSignal.timeout(5000), executeTool: async call => {
      executed.push(call.toolName);
      return { externalCallId: call.externalCallId, toolName: call.toolName, status: call.toolName === "user.ask" ? "waiting_user" : "succeeded", resultCode: call.toolName === "user.ask" ? "QUESTION_REQUIRED" : "OK", resultHash: sha, payload: { ok: true } };
    } });
    try {
      const events: AgentEngineEvent[] = []; for await (const event of session.events()) events.push(event);
      expect(events.find(e => e.type === "transport_error"), JSON.stringify(events)).toBeUndefined();
      expect(executed, JSON.stringify(events)).toEqual(["project.get_current", "user.ask"]);
      expect(events.some(e => e.type === "question")).toBe(true);
      expect(session.binding.externalSessionId).toBe("fixture-session");
      expect(transport.sessions.size).toBe(1);
    } finally { await session.close(); }
    expect(transport.sessions.size).toBe(0);
  });
});
