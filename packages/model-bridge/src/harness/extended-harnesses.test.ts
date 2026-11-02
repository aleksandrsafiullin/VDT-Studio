import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { builtinHarness, type BuiltinHarnessId } from "./catalog";
import { createHarnessSession, harnessEnvironment, harnessOpaqueIdentity, withHarnessSession } from "./rpc-session";
import { HarnessCheckpointTransport, createHarnessCheckpointEngine } from "./checkpoint-engine";
import { resumeCheckpointCapabilityHash } from "../agent-engines/resume-checkpoint-engine-core";
import type { AgentEngineEvent, AgentSessionBinding } from "@vdt-studio/vdt-agent-runtime";

const added = ["kimi", "vibe", "kilo", "qwen", "grok-build", "pi"] as const;
const acp = fileURLToPath(new URL("./fixtures/fake-harness.cjs", import.meta.url));
const pi = fileURLToPath(new URL("./fixtures/fake-pi.cjs", import.meta.url));
const roots: string[] = [];
const fixtureDefinition = (id: BuiltinHarnessId, checkpoint = false) => {
  const h = builtinHarness(id)!;
  return { ...h, command: id === "pi" ? pi : acp, args: [...h.args, ...(checkpoint ? ["--checkpoint-engine-fixture"] : [])] };
};
async function scratch() { const root = await mkdtemp(path.join(tmpdir(), "vdt-added-harness-test-")); roots.push(root); return root; }
const testEnv = (mode = "ok", extra: Record<string, string> = {}) => ({ ...process.env, NODE_ENV: "test", VDT_FAKE_HARNESS_MODE: mode, ...extra });
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("six current harness integrations", () => {
  it("preserves configured Kimi/Pi account locations and invalidates opaque identity when credentials change", async () => {
    const root = await scratch();
    for (const id of ["kimi", "pi"] as const) {
      const h = fixtureDefinition(id), dir = path.join(root, id);
      await mkdir(dir);
      const env = testEnv("ok", id === "kimi" ? { KIMI_CODE_HOME: dir } : { PI_CODING_AGENT_DIR: dir });
      expect(harnessEnvironment(h, env)[id === "kimi" ? "KIMI_CODE_HOME" : "PI_CODING_AGENT_DIR"]).toBe(dir);
      const before = harnessOpaqueIdentity(h, h.command, "1.0.0", env);
      if (id === "kimi") await mkdir(path.join(dir, "credentials")); else await writeFile(path.join(dir, "auth.json"), '{"synthetic":"fixture-only"}');
      expect(harnessOpaqueIdentity(h, h.command, "1.0.0", env).credentialEpoch).not.toBe(before.credentialEpoch);
    }
  });
  it.each(added)("discovers %s metadata without inference and confirms exact reasoning before a prompt", async id => {
    const root = await scratch(), log = path.join(root, "commands.jsonl");
    const result = await withHarnessSession(fixtureDefinition(id), AbortSignal.timeout(5000), async session => {
      const expectedModel = id === "pi" ? "fixture/test-model" : "test-model";
      expect(session.models().map(m => m.id)).toContain(expectedModel);
      expect(await readFile(log, "utf8")).not.toMatch(/"(?:method|type)":"(?:prompt|session\/prompt)"/);
      await session.selectModel(expectedModel, AbortSignal.timeout(1000));
      expect(session.reasoningValues()).toEqual([false, "low", "high"]);
      await session.selectReasoning(false, AbortSignal.timeout(1000));
      return session.prompt("Return JSON", AbortSignal.timeout(1000));
    }, { env: testEnv("ok", { VDT_FAKE_HARNESS_LOG: log }) });
    expect(JSON.parse(result)).toEqual({ ok: true });
    const commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    if (id === "grok-build") expect(commands.find(c => c.method === "authenticate")?.params).toEqual({ methodId: "cached_token", _meta: { headless: true } });
    if (id === "pi") expect(commands.find(c => c.type === "set_thinking_level")).toMatchObject({ level: "off" });
    else expect(commands.find(c => c.method === "session/set_config_option" && c.params.configId === "reasoning")).toMatchObject({ params: { value: "off" } });
  });
  it.each(added)("preserves %s's agent session through Gateway tool results and a question", async id => {
    const root = await scratch(), definition = fixtureDefinition(id, true), executable = definition.command;
    const transport = new HarnessCheckpointTransport(definition, executable, "1.0.0"), sha = `sha256:${"b".repeat(64)}`;
    const environment = { environmentId: `${id}-env`, privateWorkspacePath: root, privateStatePath: root, forbiddenRoots: [], close: () => transport.closeEnvironment(`${id}-env`) };
    const engine = createHarnessCheckpointEngine({ definition, executable, cliVersion: "1.0.0", transport, toolCatalogHash: sha, allowedToolNames: ["project.get_current", "user.ask"], enableUnverifiedCanary: true, sessionEnvironmentFactory: () => environment, resolveBinding: async () => { throw new Error("No recovery requested"); } });
    const capability = engine.capability;
    const binding: AgentSessionBinding = { schemaVersion: 2, bindingId: `${id}-binding`, runId: `${id}-run`, projectId: "fixture-project", executionProfile: "external_cli_agent", engineId: capability.engineId, engineAdapterId: capability.engineAdapterId, backendId: capability.backendId, modelId: id === "pi" ? "fixture/test-model" : "test-model", protocolVersion: capability.protocolVersion, cliVersion: capability.cli.version, toolIsolation: "unverified", qualificationStatus: "unverified", capabilityEvidenceHash: null, settingsHash: sha, capabilityProfileHash: resumeCheckpointCapabilityHash(capability), toolCatalogHash: sha, externalSessionId: null, sessionEpoch: 1, boundAt: "2026-11-02T00:00:00.000Z" };
    const initialContext = { request: "Inspect the model, then ask for its period." }, tools: string[] = [];
    const session = await engine.openSession({ binding, initialContext, initialContextHash: `sha256:${createHash("sha256").update(JSON.stringify(initialContext)).digest("hex")}` }, { signal: AbortSignal.timeout(5000), executeTool: async call => {
      tools.push(call.toolName);
      return { externalCallId: call.externalCallId, toolName: call.toolName, status: call.toolName === "user.ask" ? "waiting_user" : "succeeded", resultCode: call.toolName === "user.ask" ? "QUESTION_REQUIRED" : "OK", resultHash: sha, payload: { ok: true } };
    } });
    try {
      const events: AgentEngineEvent[] = []; for await (const event of session.events()) events.push(event);
      expect(events.find(e => e.type === "transport_error"), JSON.stringify(events)).toBeUndefined();
      expect(tools, JSON.stringify(events)).toEqual(["project.get_current", "user.ask"]);
      expect(events.some(e => e.type === "question")).toBe(true);
      expect(session.binding.externalSessionId).toBe(id === "pi" ? "pi-fixture-session" : "fixture-session");
      expect(transport.sessions.size).toBe(1);
    } finally { await session.close(); }
    expect(transport.sessions.size).toBe(0);
  });
  it("does not infer ACP reasoning-off from an absent control", async () => {
    await expect(withHarnessSession(fixtureDefinition("kimi"), AbortSignal.timeout(3000), async session => {
      expect(session.reasoningValues()).toEqual([]);
      await session.selectReasoning(false, AbortSignal.timeout(1000));
    }, { env: testEnv("missing-reasoning") })).rejects.toMatchObject({ code: "REASONING_UNSUPPORTED" });
  });
  it.each(["kimi", "pi"] as const)("rejects an ignored %s reasoning selection before inference", async id => {
    const root = await scratch(), log = path.join(root, "commands.jsonl");
    await expect(withHarnessSession(fixtureDefinition(id), AbortSignal.timeout(3000), s => s.selectReasoning(false, AbortSignal.timeout(1000)), { env: testEnv("reasoning-mismatch", { VDT_FAKE_HARNESS_LOG: log }) })).rejects.toMatchObject({ code: "REASONING_MISMATCH" });
    expect(await readFile(log, "utf8")).not.toMatch(/"(?:method|type)":"(?:prompt|session\/prompt)"/);
  });
});

describe("current Pi RPC lifecycle", () => {
  it.each(["retry-success", "overflow-success", "delta-replaced"])("returns the authoritative final assistant message after %s", async mode => {
    const result = await withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.prompt("Return JSON", AbortSignal.timeout(1000)), { env: testEnv(mode) });
    expect(JSON.parse(result)).toEqual({ ok: true });
  });
  it.each([["tool-then-retry", "TOOL_ACTIVITY_REJECTED"], ["retry-exhausted", "RATE_LIMITED"], ["aborted-settle", "INCOMPLETE_RESPONSE"]])("does not hide %s behind recovered or partial valid JSON", async (mode, code) => {
    await expect(withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.prompt("Return JSON", AbortSignal.timeout(1000)), { env: testEnv(mode) })).rejects.toMatchObject({ code });
  });
  it("waits beyond agent_end until agent_settled", async () => {
    const started = Date.now();
    const result = await withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.prompt("Return JSON", AbortSignal.timeout(1000)), { env: testEnv("delayed-settle") });
    expect(JSON.parse(result)).toEqual({ ok: true }); expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
  it("does not accept a bare model alias that could switch providers", async () => {
    await expect(withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.selectModel("test-model", AbortSignal.timeout(1000)), { env: testEnv() })).rejects.toMatchObject({ code: "MODEL_MISMATCH" });
  });
  it.each([["model-mismatch", "MODEL_MISMATCH"], ["auth", "AUTH_REQUIRED"], ["quota", "RATE_LIMITED"], ["tool", "TOOL_ACTIVITY_REJECTED"], ["error-after-accept", "RATE_LIMITED"], ["malformed", "INVALID_RESPONSE"], ["disconnect", "HARNESS_PROCESS_EXITED"]])("fails closed on %s", async (mode, code) => {
    const error = await withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), async s => { await s.selectModel("fixture/test-model", AbortSignal.timeout(1000)); return s.prompt("Return JSON", AbortSignal.timeout(1000)); }, { env: testEnv(mode) }).then(() => undefined, error => error);
    expect(error).toMatchObject({ code }); expect(error.message).not.toContain("private-provider-diagnostic");
  });
  it("confirms abort by clearing queued work and observing idle", async () => {
    const root = await scratch(), log = path.join(root, "commands.jsonl");
    await expect(withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.prompt("Wait", AbortSignal.timeout(60)), { env: testEnv("slow", { VDT_FAKE_HARNESS_LOG: log }) })).rejects.toMatchObject({ code: "CANCELLED" });
    const commands = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line).type);
    expect(commands).toContain("clear_queue"); expect(commands.indexOf("clear_queue")).toBeLessThan(commands.indexOf("abort"));
  });
  it("quarantines an unacknowledged abort even after the client process exits", async () => {
    const error = await withHarnessSession(fixtureDefinition("pi"), AbortSignal.timeout(3000), s => s.prompt("Wait", AbortSignal.timeout(60)), { env: testEnv("ignore-cancel") }).then(() => undefined, error => error);
    expect(error).toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    expect(path.basename(error.retainedDirectory)).toMatch(/^vdt-harness-/); roots.push(error.retainedDirectory);
    expect(JSON.parse(await readFile(path.join(error.retainedDirectory, "cleanup-status.json"), "utf8"))).toMatchObject({ harnessId: "pi", status: "cleanup_unconfirmed" });
  });
  it("requires recovery when the bound conversation process has been lost", async () => {
    const root = await scratch(), h = fixtureDefinition("pi"), session = createHarnessSession(h, { executable: pi, cwd: root, environment: harnessEnvironment(h, testEnv()) });
    try { await expect(session.open(AbortSignal.timeout(1000), "old-pi-session")).rejects.toMatchObject({ code: "RECOVERY_REQUIRED" }); }
    finally { await session.close(); }
  });
  it("launches only the owned tool-free in-memory profile", () => {
    expect(builtinHarness("pi")!.args).toEqual(expect.arrayContaining(["--mode", "rpc", "--no-session", "--no-tools", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve"]));
  });
});

describe("bounded complete harness response stream", () => {
  it.each(["kimi", "pi"] as const)("includes every %s thinking/event byte in the 64 KiB prompt budget", async id => {
    // The fixture spaces 17 individually valid 4 KiB thought records so no
    // single frame is oversized, then emits a short valid JSON answer.
    await expect(withHarnessSession(fixtureDefinition(id), AbortSignal.timeout(3000), s => s.prompt("Return JSON", AbortSignal.timeout(1000)), { env: testEnv("thought-overflow"), maxBytes: 64 * 1024 })).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  });
  it.each(["kimi", "pi"] as const)("gives %s a fresh response budget after metadata and between prompts", async id => {
    const results = await withHarnessSession(fixtureDefinition(id), AbortSignal.timeout(3000), async session => {
      // Metadata responses together exceed 64 KiB; each individual frame is
      // bounded. They are not model output and cannot consume a prompt budget.
      await session.selectReasoning(false, AbortSignal.timeout(1000));
      return [await session.prompt("Return JSON", AbortSignal.timeout(1000)), await session.prompt("Return JSON again", AbortSignal.timeout(1000))];
    }, { env: testEnv("metadata-padding"), maxBytes: 64 * 1024 });
    expect(results.map(result => JSON.parse(result))).toEqual([{ ok: true }, { ok: true }]);
  });
});
