import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput } from "@vdt-studio/vdt-core";
import { createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import { createManifestRegistry } from "./manifests";
import { executeCompletion, type ExecutorOptions } from "./executor";
import { parseSmartCodexOutput, readSmartResponse } from "./smart-suggestions";
import { cancelRuntimeRequestWithAcknowledgement, completeRuntime, createLocalRuntimeContext, getRuntimeRun } from "./runtime";
import { handleSidecarRequest } from "../sidecar/runtime";
import { SIDECAR_PROTOCOL_VERSION } from "../sidecar/protocol";

const empty = { status: "empty", rationale: "Контекст без подтверждённого разложения.", limitations: [], groups: [] };
const json = (value: unknown) => new Response(JSON.stringify(value));
const directories: string[] = [];
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-smart-test-")); directories.push(dir); return dir; }
async function request(backendId = "codex_subscription") {
  const context = await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(), { workspaceId: "qa", vdtId: null, targetNodeId: "measured_output", period: { key: "2026-10", grain: "month" } });
  return { requestId: crypto.randomUUID(), backendId, taskType: "suggest_incoming_kpis" as const, schemaId: "suggest-incoming-kpis-v1", input: buildKpiSuggestionTaskInput(context), model: "selected", timeoutMs: 2000 };
}
function child() { return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), unref: vi.fn() }); }
const frames = (output: unknown) => [JSON.stringify({ type: "thread.started" }), JSON.stringify({ type: "turn.started" }),
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(output) } }), JSON.stringify({ type: "turn.completed" })].join("\n") + "\n";
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("Smart local response reader ownership", () => {
  it("awaits cancellation of an open tail after malformed UTF-8", async () => {
    let finish!: () => void, started!: () => void, settled = false;
    const cancelling = new Promise<void>(resolve => { started = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); },
      cancel() { started(); return new Promise<void>(resolve => { finish = resolve; }); } }));
    const pending = readSmartResponse(response, new AbortController().signal).finally(() => { settled = true; }); void pending.catch(() => {});
    await cancelling; expect(settled).toBe(false); expect(response.body?.locked).toBe(true);
    finish(); await expect(pending).rejects.toBeInstanceOf(TypeError); expect(response.body?.locked).toBe(false);
  });
  it("prioritizes unconfirmed reader cancellation over malformed UTF-8", async () => {
    vi.useFakeTimers(); let started!: () => void;
    const cancelling = new Promise<void>(resolve => { started = resolve; });
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0xc3, 0x28])); },
      cancel() { started(); return new Promise<void>(() => {}); } }));
    const pending = readSmartResponse(response, new AbortController().signal); void pending.catch(() => {});
    await cancelling; await vi.advanceTimersByTimeAsync(1251);
    await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
});

describe("Smart task-scoped local transport", () => {
  it("dispatches the exact registered task/schema through the native sidecar boundary", async () => {
    const input = await request("mock");
    const result = await handleSidecarRequest({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId: input.requestId, method: "complete",
      payload: { backendId: input.backendId, taskType: input.taskType, schemaId: input.schemaId, input: input.input as never, model: input.model, timeoutMs: input.timeoutMs } }, createLocalRuntimeContext({ auditSink: () => {} }));
    expect(result).toMatchObject({ ok: true, payload: { ok: true, run: { taskType: "suggest_incoming_kpis" }, output: { status: "empty", groups: [] } } });
  });
  for (const backend of ["ollama", "lm_studio", "vllm"]) {
    it(`${backend} uses only the manifest destination, one response, and generation-token cap`, async () => {
      const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json(backend === "ollama" ? { message: { content: JSON.stringify(empty) }, done: true, done_reason: "stop" } : { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(empty) } }] }));
      const result = await executeCompletion(createManifestRegistry().get(backend)!, await request(backend), new AbortController().signal, { fetch });
      expect(result).toMatchObject({ output: empty, repaired: false }); expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0]!; const payload = JSON.parse(String(init?.body));
      expect(String(url)).toBe(backend === "ollama" ? "http://127.0.0.1:11434/api/chat" : backend === "lm_studio" ? "http://127.0.0.1:1234/v1/chat/completions" : "http://127.0.0.1:8000/v1/chat/completions");
      expect(payload.options?.num_predict ?? payload.max_tokens).toBe(2048); expect(init?.redirect).toBe("error");
      expect(JSON.stringify(payload)).not.toContain("agent_decision"); expect(JSON.stringify(payload)).not.toContain("project.get_node");
    });
  }
  it("never repairs or retries a local protocol failure, tools, truncation or oversized envelopes", async () => {
    for (const payload of [{ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(empty), tool_calls: [{}] } }] },
      { choices: [{ finish_reason: "length", message: { content: JSON.stringify(empty) } }] }, { choices: [{ finish_reason: "stop", message: { content: "invalid JSON" } }] }, { padding: "x".repeat(65_537) }]) {
      const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => json(payload));
      await expect(executeCompletion(createManifestRegistry().get("lm_studio")!, await request("lm_studio"), new AbortController().signal, { fetch })).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("propagates caller abort to the HTTP request and waits for its confirmed rejection", async () => {
    const controller = new AbortController(); let rejectHttp!: (error: Error) => void, signal!: AbortSignal;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { signal = init!.signal!; return new Promise<Response>((_resolve, reject) => { rejectHttp = reject; }); });
    let settled = false; const pending = executeCompletion(createManifestRegistry().get("ollama")!, await request("ollama"), controller.signal, { fetch }).finally(() => { settled = true; }); void pending.catch(() => {});
    await vi.waitFor(() => expect(rejectHttp).toBeTypeOf("function")); controller.abort(); await Promise.resolve();
    expect(signal.aborted).toBe(true); expect(settled).toBe(false);
    rejectHttp(new DOMException("HTTP closed", "AbortError")); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("quarantines a non-cooperative HTTP request after bounded closure grace", async () => {
    const controller = new AbortController();
    const pending = executeCompletion(createManifestRegistry().get("ollama")!, await request("ollama"), controller.signal, { fetch: async () => new Promise<Response>(() => {}) }); void pending.catch(() => {});
    controller.abort(); await expect(pending).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
  });
  it("rejects an oversized final input before invoking any adapter", async () => {
    const fetch = vi.fn(); const input = await request("ollama");
    await expect(executeCompletion(createManifestRegistry().get("ollama")!, { ...input, input: { ...input.input, extra: "x".repeat(25_000) } }, new AbortController().signal, { fetch })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Smart Codex owned invocation", () => {
  it("rejects malformed UTF-8 without silently replacing characters", async () => {
    const root = await directory(), running = child();
    const spawn = () => { queueMicrotask(() => { running.stdout.write(Buffer.from([0xc3, 0x28])); running.emit("close", 0); }); return running; };
    await expect(executeCompletion(createManifestRegistry().get("codex_subscription")!, await request(), new AbortController().signal,
      { tempRoot: root, env: { ...process.env }, resolveExecutable: async () => "/bin/echo", spawn } as unknown as ExecutorOptions)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(await readdir(root)).toEqual([]);
  });
  it("uses one isolated restrictive invocation, streaming UTF-8 and cleans its own directory", async () => {
    const root = await directory(), running = child(), spawn = vi.fn((_file: unknown, args: readonly string[], config: Record<string, unknown>) => {
      const wire = Buffer.from(frames(empty)); const split = wire.indexOf(Buffer.from("К")) + 1;
      queueMicrotask(() => { running.stdout.write(wire.subarray(0, split)); running.stdout.write(wire.subarray(split)); running.emit("close", 0); });
      expect(args).toContain("--ignore-user-config"); expect(args).toContain("--ignore-rules"); expect(args).toContain("--strict-config");
      expect(args).toContain("read-only"); expect(args).toContain('web_search="disabled"'); expect(args).toContain("shell_tool"); expect(args).toContain("unified_exec");
      expect(config.cwd).not.toBe(process.cwd()); expect((config.env as NodeJS.ProcessEnv).OPENAI_API_KEY).toBeUndefined();
      return running;
    });
    const output = await executeCompletion(createManifestRegistry().get("codex_subscription")!, await request(), new AbortController().signal,
      { tempRoot: root, env: { PATH: process.env.PATH, OPENAI_API_KEY: "synthetic-not-forwarded" }, resolveExecutable: async () => "/bin/echo", spawn } as unknown as ExecutorOptions);
    expect(output).toMatchObject({ output: empty, repaired: false }); expect(spawn).toHaveBeenCalledTimes(1); expect(await readdir(root)).toEqual([]);
  });
  it("rejects reported tool/unknown events and more than one turn", () => {
    for (const prefix of [{ type: "item.started", item: { type: "command_execution", command: "touch bad" } }, { type: "unexpected" }, { type: "turn.started" }]) {
      expect(() => parseSmartCodexOutput(JSON.stringify(prefix) + "\n" + frames(empty))).toThrow();
    }
  });
  it("does not settle cancellation or its terminal acknowledgement before delayed child close", async () => {
    const root = await directory(), running = child(); let spawned = false;
    const context = createLocalRuntimeContext({ executor: { tempRoot: root, env: {}, resolveExecutable: async () => "/bin/echo", spawn: (() => { spawned = true; return running; }) as unknown as NonNullable<ExecutorOptions["spawn"]> } });
    const input = await request(); const pending = completeRuntime(input, context); await vi.waitFor(() => expect(spawned).toBe(true));
    let acknowledged = false; const ack = cancelRuntimeRequestWithAcknowledgement(input.requestId, context).then(result => { acknowledged = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(acknowledged).toBe(false); expect(getRuntimeRun(input.requestId, context)).toMatchObject({ payload: { run: { status: "running" } } }); expect((await readdir(root)).length).toBe(1);
    await expect(completeRuntime({ ...input, requestId: crypto.randomUUID() }, context)).rejects.toMatchObject({ code: "PREPARATION_IN_PROGRESS" });
    running.emit("close", null); await expect(pending).resolves.toMatchObject({ payload: { error: { code: "CANCELLED" } } });
    await expect(ack).resolves.toMatchObject({ payload: { cleanupConfirmed: true, status: "cancelled" } }); expect(await readdir(root)).toEqual([]);
  });
  it("bounds escaped-pipe cleanup, retains owned evidence and reports unconfirmed terminal ack", async () => {
    const root = await directory(), running = child(); let spawned = false;
    const context = createLocalRuntimeContext({ executor: { tempRoot: root, env: {}, resolveExecutable: async () => "/bin/echo", spawn: (() => { spawned = true; return running; }) as unknown as NonNullable<ExecutorOptions["spawn"]> } });
    const input = await request(); const pending = completeRuntime(input, context); await vi.waitFor(() => expect(spawned).toBe(true));
    const ack = cancelRuntimeRequestWithAcknowledgement(input.requestId, context);
    await expect(pending).resolves.toMatchObject({ payload: { error: { code: "CLEANUP_UNCONFIRMED" } } }); await expect(ack).resolves.toMatchObject({ payload: { cleanupConfirmed: false, error: { code: "CLEANUP_UNCONFIRMED" } } });
    await expect(completeRuntime({ ...input, requestId: crypto.randomUUID() }, context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    await expect(completeRuntime({ ...input, requestId: crypto.randomUUID(), backendId: "mock" }, context)).resolves.toMatchObject({ payload: { ok: true } });
    await expect(completeRuntime({ ...input, requestId: crypto.randomUUID() }, context)).rejects.toMatchObject({ code: "CLEANUP_UNCONFIRMED" });
    const retained = await readdir(root); expect(retained).toHaveLength(1); expect(await readFile(path.join(root, retained[0]!, "schema.json"), "utf8")).toContain("additionalProperties");
    expect(running.stdout.destroyed).toBe(true); expect(running.unref).toHaveBeenCalled(); running.emit("close", null);
  });
});
