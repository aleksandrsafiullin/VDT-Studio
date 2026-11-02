import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import { createManifestRegistry } from "./manifests";
import { executeCompletion } from "./executor";
import { profileDefinition, validateHarnessProfile } from "@vdt-studio/model-bridge/node";
import { schemaIdForTask } from "@vdt-studio/model-bridge";
import { ALL_VDT_TASK_TYPES } from "./manifests";

const piFixture = fileURLToPath(new URL("../../../model-bridge/src/harness/fixtures/fake-pi.cjs", import.meta.url));
const harnesses = ["codex", "cursor", "claude", "copilot", "opencode", "hermes", "kiro", "kimi", "vibe", "kilo", "qwen", "grok-build", "pi"];
const rpcFixture = fileURLToPath(new URL("../../../model-bridge/src/harness/fixtures/fake-harness.cjs", import.meta.url));
const empty = { status: "empty", rationale: "No additional fixture components.", limitations: [], groups: [] };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("all harnesses share the structured task boundary", () => {
  it("distinguishes a structured task deadline from caller cancellation", async () => {
    await expect(executeCompletion(createManifestRegistry().get("opencode_subscription")!, { requestId: crypto.randomUUID(), backendId: "opencode_subscription", taskType: "generate_tree", schemaId: "connection-test-v1", input: {}, timeoutMs: 100 }, AbortSignal.timeout(3000), { resolveExecutable: async () => rpcFixture, env: { ...process.env, NODE_ENV: "test", VDT_FAKE_HARNESS_MODE: "slow" } })).rejects.toMatchObject({ code: "TIMEOUT" });
  });
  it.each(harnesses)("waits for cancellation of %s and preserves the source graph", async id => {
    const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-cancel-")); roots.push(root);
    const backendId = `${id}_subscription`, manifest = createManifestRegistry().get(backendId)!;
    let executable = id === "pi" ? piFixture : rpcFixture;
    if (["codex", "cursor", "claude"].includes(id)) {
      executable = path.join(root, "slow.cjs");
      await writeFile(executable, "process.stdin.resume(); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
    }
    const project = createSmartKpiMeasuredFixture(), before = JSON.stringify(project);
    const input = buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(project, { workspaceId: "cancel-matrix", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-11", grain: "month" } }));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 150);
    try { await expect(executeCompletion(manifest, { requestId: crypto.randomUUID(), backendId, taskType: "suggest_incoming_kpis", schemaId: "suggest-incoming-kpis-v1", input, model: id === "pi" ? "fixture/test-model" : "test-model", timeoutMs: 3000 }, controller.signal, { resolveExecutable: async () => executable, env: { ...process.env, NODE_ENV: "test", VDT_FAKE_HARNESS_MODE: "slow" } })).rejects.toMatchObject({ code: "CANCELLED" }); }
    finally { clearTimeout(timer); }
    expect(JSON.stringify(project)).toBe(before);
  });
  it.each([...harnesses, "custom-acp", "custom-jsonl"])("dispatches all registered AI contracts through %s", async id => {
    const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-contracts-")); roots.push(root);
    const manifests = createManifestRegistry();
    const custom = id.startsWith("custom-") ? profileDefinition(validateHarnessProfile({ id: "custom-contracts", name: "Contracts", command: rpcFixture, args: [], transport: id === "custom-acp" ? "acp" : "vdt-jsonl" })) : undefined;
    const manifest = custom ? { ...manifests.get("opencode_subscription")!, id: custom.backendId, harness: custom } : manifests.get(`${id}_subscription`)!;
    const smartInput = buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: "all-contracts", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-11", grain: "month" } }));
    for (const taskType of ALL_VDT_TASK_TYPES) {
      const schemaId = schemaIdForTask(taskType), input = taskType === "suggest_incoming_kpis" ? smartInput : {};
      const request = { requestId: crypto.randomUUID(), backendId: manifest.id, taskType, schemaId, input, model: id === "pi" ? "fixture/test-model" : "test-model", timeoutMs: 3000 };
      const expected = await executeCompletion(manifests.get("mock")!, { ...request, backendId: "mock" }, AbortSignal.timeout(3000));
      let executable = id === "pi" ? piFixture : rpcFixture;
      if (["codex", "cursor", "claude"].includes(id)) {
        executable = path.join(root, `${id}.cjs`);
        const frames = id === "codex" ? [{ type: "thread.started" }, { type: "turn.started" }, { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(expected.output) } }, { type: "turn.completed" }]
          : [{ type: "result", subtype: "success", is_error: false, num_turns: 1, result: JSON.stringify(expected.output), structured_output: expected.output }];
        await writeFile(executable, `process.stdin.resume();process.stdin.on('end',()=>{${frames.map(f => `console.log(${JSON.stringify(JSON.stringify(f))})`).join(";")}});`);
      }
      const result = await executeCompletion(manifest, request, AbortSignal.timeout(3000), { resolveExecutable: async () => executable, env: { ...process.env, NODE_ENV: "test", VDT_FAKE_HARNESS_OUTPUT: JSON.stringify(expected.output) } });
      expect(result.schemaValid, taskType).toBe(true);
      expect(result.output, taskType).toEqual(expected.output);
    }
  }, 30_000);
  it.each(harnesses)("prepares Suggested KPI with %s and leaves the source graph unchanged", async id => {
    const root = await mkdtemp(path.join(tmpdir(), "vdt-harness-matrix-")); roots.push(root);
    const backendId = `${id}_subscription`, manifest = createManifestRegistry().get(backendId)!;
    let executable = id === "pi" ? piFixture : rpcFixture;
    if (["codex", "cursor", "claude"].includes(id)) {
      executable = path.join(root, `${id}.cjs`);
      const frames = id === "codex" ? [{ type: "thread.started" }, { type: "turn.started" }, { type: "item.completed", item: { type: "agent_message", text: JSON.stringify(empty) } }, { type: "turn.completed" }]
        : [{ type: "result", subtype: "success", is_error: false, num_turns: 1, result: JSON.stringify(empty), structured_output: empty }];
      await writeFile(executable, `if(process.argv.includes('--version')){console.log('1.0.0');process.exit(0)};process.stdin.resume();process.stdin.on('end',()=>{${frames.map(f => `console.log(${JSON.stringify(JSON.stringify(f))})`).join(";")}});`);
    }
    const project = createSmartKpiMeasuredFixture(), before = JSON.stringify(project);
    const context = await buildKpiSuggestionContext(project, { workspaceId: "matrix", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-11", grain: "month" } });
    const result = await executeCompletion(manifest, { requestId: crypto.randomUUID(), backendId, taskType: "suggest_incoming_kpis", schemaId: "suggest-incoming-kpis-v1", input: buildKpiSuggestionTaskInput(context), model: id === "pi" ? "fixture/test-model" : "test-model", timeoutMs: 3000 }, new AbortController().signal, { resolveExecutable: async () => executable });
    expect(result.schemaValid).toBe(true); expect(result.repaired).toBe(false); expect(result.output).toMatchObject({ status: "empty", groups: [] });
    expect(JSON.stringify(project)).toBe(before);
  });
  it.each(["acp", "vdt-jsonl"] as const)("executes registered task schemas through a custom %s profile", async transport => {
    const h = profileDefinition(validateHarnessProfile({ id: "custom-matrix", name: "Matrix", command: rpcFixture, transport, args: [] }));
    const manifest = { ...createManifestRegistry().get("opencode_subscription")!, id: h.backendId, kind: "custom_cli" as const, harness: h };
    const result = await executeCompletion(manifest, { requestId: crypto.randomUUID(), backendId: h.backendId, taskType: "generate_tree", schemaId: "connection-test-v1", input: {} }, AbortSignal.timeout(3000), { resolveExecutable: async () => rpcFixture });
    expect(result.output).toEqual({ ok: true });
  });
});
