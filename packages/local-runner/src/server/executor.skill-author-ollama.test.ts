import { afterEach, describe, expect, it, vi } from "vitest";
import { getStrictResponseJsonSchema } from "@vdt-studio/model-bridge";
import type { CompletionRequest } from "../cli/types";
import { createManifestRegistry } from "./manifests";
import { executeCompletion, EXECUTION_LIMITS } from "./executor";

afterEach(() => vi.useRealTimers());

const roles = ["vdt_skill_author", "vdt_skill_update_author"] as const;
const toolName = (role: typeof roles[number]) => role === "vdt_skill_author" ? "skill.author_draft" : "skill.author_update";
const request = (role: typeof roles[number] = "vdt_skill_author", padding = ""): CompletionRequest => ({
  requestId: crypto.randomUUID(), backendId: "ollama", taskType: "agent_decision", schemaId: "agent-decision-v2",
  model: "qwen3.6:27b", timeoutMs: 300_000,
  input: { data: { role, source: { context: `Keep the entire source: ${padding}` }, outputContract: { toolName: toolName(role) } },
    systemPrompt: "The complete host-owned skill author guidance.", userPrompt: "Use input.data as the canonical context." }
});
const wire = (role: typeof roles[number] = "vdt_skill_author") => ({ type: "call_tool", toolName: toolName(role), argsJson: JSON.stringify({ title: "Reusable method" }),
  callsJson: "[]", statusMessage: "Draft ready for review.", questionsJson: "[]", summary: "", nextSuggestedActions: [] });
const nativeResponse = (role: typeof roles[number] = "vdt_skill_author") => ({ message: { role: "assistant", content: JSON.stringify(wire(role)) }, done: true, done_reason: "stop" });
const metadata = (context = 262_144) => ({ model_info: { "general.architecture": "qwen35", "qwen35.context_length": context } });
const manifest = () => createManifestRegistry().get("ollama")!;

function fixtureFetch(payload: unknown = nativeResponse(), context = 262_144) {
  const calls: { url: string; body: Record<string, unknown>; signal: AbortSignal | undefined }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal ?? undefined });
    return Response.json(String(url).endsWith("/api/show") ? metadata(context) : payload);
  };
  return { fetcher, calls };
}

describe("scoped native Ollama Skill Author budgets", () => {
  it.each(roles)("uses native bounded context for %s while retaining exact messages, schema, model and effective default thinking", async role => {
    const input = request(role), { fetcher, calls } = fixtureFetch(nativeResponse(role));
    const result = await executeCompletion(manifest(), input, new AbortController().signal, { fetch: fetcher });
    expect(calls.map(call => call.url)).toEqual(["http://127.0.0.1:11434/api/show", "http://127.0.0.1:11434/api/chat"]);
    expect(calls[0]!.body).toEqual({ model: "qwen3.6:27b" });
    expect(calls[1]!.body).toEqual({ model: "qwen3.6:27b", stream: false, format: getStrictResponseJsonSchema("agent-decision-v2"),
      options: { num_ctx: 16_384, num_predict: 7000, temperature: 0 }, messages: [
        { role: "system", content: "Return one JSON object for VDT task agent_decision matching approved schema agent-decision-v2." },
        { role: "user", content: JSON.stringify(input.input) }
      ] });
    expect(calls[1]!.body).not.toHaveProperty("think");
    expect(calls[1]!.body).not.toHaveProperty("reasoning_effort");
    expect(result).toMatchObject({ schemaValid: true, output: { type: "call_tool", toolName: toolName(role), args: { title: "Reusable method" } } });
    expect(result).not.toHaveProperty("repaired");
  });

  it("selects 32K using UTF-8 bytes and keeps the complete longer prompt", async () => {
    const input = request("vdt_skill_update_author", "界".repeat(2700)), { fetcher, calls } = fixtureFetch(nativeResponse("vdt_skill_update_author"));
    await executeCompletion(manifest(), input, new AbortController().signal, { fetch: fetcher });
    expect(calls[1]!.body.options).toMatchObject({ num_ctx: 32_768, num_predict: 7000 });
    expect(calls[1]!.body.messages).toEqual([
      { role: "system", content: "Return one JSON object for VDT task agent_decision matching approved schema agent-decision-v2." },
      { role: "user", content: JSON.stringify(input.input) }
    ]);
  });

  it("rejects complete prompts that cannot fit the 32K bound before inference or metadata access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(executeCompletion(manifest(), request("vdt_skill_author", "я".repeat(12_000)), new AbortController().signal, { fetch: fetcher }))
      .rejects.toMatchObject({ code: "SKILL_AUTHOR_CONTEXT_LIMIT" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([8192, 16_384])("rejects a model's insufficient advertised context %s without truncating or generating", async context => {
    const { fetcher, calls } = fixtureFetch(nativeResponse(), context);
    const input = context === 8192 ? request() : request("vdt_skill_author", "x".repeat(10_000));
    await expect(executeCompletion(manifest(), input, new AbortController().signal, { fetch: fetcher })).rejects.toMatchObject({ code: "SKILL_AUTHOR_CONTEXT_LIMIT" });
    expect(calls.map(call => call.url)).toEqual(["http://127.0.0.1:11434/api/show"]);
  });

  it.each([
    ["ordinary agent", (value: CompletionRequest) => { value.input = { data: { role: "ordinary_agent", outputContract: { toolName: "skill.author_draft" } } }; }],
    ["role prefix", (value: CompletionRequest) => { value.input = { data: { role: "vdt_skill_author_extra", outputContract: { toolName: "skill.author_draft" } } }; }],
    ["mismatched expected tool", (value: CompletionRequest) => { value.input = { data: { role: "vdt_skill_author", outputContract: { toolName: "vdt.delete_node" } } }; }],
    ["unwrapped role", (value: CompletionRequest) => { value.input = { role: "vdt_skill_author", outputContract: { toolName: "skill.author_draft" } }; }],
    ["another task", (value: CompletionRequest) => { value.taskType = "review_model"; }],
    ["compatibility schema", (value: CompletionRequest) => { value.schemaId = "agent-decision-v1"; }]
  ] as const)("leaves %s on the existing OpenAI-compatible path", async (label, alter) => {
    const input = request(); alter(input);
    const calls: string[] = [], fetcher: typeof fetch = async url => { calls.push(String(url)); return Response.json({ choices: [{ message: { content: JSON.stringify(wire()) } }] }); };
    expect((await executeCompletion(manifest(), input, new AbortController().signal, { fetch: fetcher })).schemaValid).toBe(true);
    expect(calls, label).toEqual(["http://127.0.0.1:11434/v1/chat/completions"]);
  });

  it("leaves another local provider on its existing endpoint even for the exact author role", async () => {
    const input = { ...request(), backendId: "lm_studio" }, local = createManifestRegistry().get("lm_studio")!, calls: string[] = [];
    const fetcher: typeof fetch = async url => { calls.push(String(url)); return Response.json({ choices: [{ message: { content: JSON.stringify(wire()) } }] }); };
    expect((await executeCompletion(local, input, new AbortController().signal, { fetch: fetcher })).schemaValid).toBe(true);
    expect(calls).toEqual([`${local.localHttp!.baseUrl}/chat/completions`]);
  });

  it.each([
    [{ message: { content: "", thinking: "private reasoning only" }, done: true, done_reason: "length" }, "SKILL_AUTHOR_OUTPUT_LIMIT"],
    [{ ...nativeResponse(), done: false }, "INVALID_PROVIDER_RESPONSE"],
    [{ ...nativeResponse(), done_reason: "unknown" }, "INVALID_PROVIDER_RESPONSE"],
    [{ message: { content: "", thinking: "private reasoning only" }, done: true, done_reason: "stop" }, "INVALID_PROVIDER_RESPONSE"],
    [{ ...nativeResponse(), message: { content: "   " } }, "INVALID_PROVIDER_RESPONSE"],
    [{ ...nativeResponse(), message: { ...nativeResponse().message, role: "tool" } }, "INVALID_PROVIDER_RESPONSE"],
    [{ ...nativeResponse(), message: { ...nativeResponse().message, tool_calls: [{ function: { name: "delete" } }] } }, "TOOL_ACTIVITY_REJECTED"],
    [{ ...nativeResponse(), tool_calls: [{ function: { name: "delete" } }] }, "TOOL_ACTIVITY_REJECTED"],
    [{ ...nativeResponse(), message: { ...nativeResponse().message, function_call: {} } }, "TOOL_ACTIVITY_REJECTED"],
    [null, "INVALID_PROVIDER_RESPONSE"]
  ] as const)("rejects incomplete/length/tool-bearing native response %j", async (payload, code) => {
    const { fetcher, calls } = fixtureFetch(payload);
    await expect(executeCompletion(manifest(), request(), new AbortController().signal, { fetch: fetcher })).rejects.toMatchObject({ code });
    expect(calls).toHaveLength(2);
  });

  it("keeps registered validation strict without adding a repair or endpoint fallback", async () => {
    const { fetcher, calls } = fixtureFetch({ ...nativeResponse(), message: { content: JSON.stringify({ arbitrary: "not an agent decision" }) } });
    await expect(executeCompletion(manifest(), request(), new AbortController().signal, { fetch: fetcher })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    expect(calls).toHaveLength(2);
    const rejected: typeof fetch = async url => String(url).endsWith("/api/show") ? Response.json(metadata()) : Response.json({ error: "format not supported" }, { status: 400 });
    await expect(executeCompletion(manifest(), request(), new AbortController().signal, { fetch: rejected })).rejects.toMatchObject({ code: "LOCAL_HTTP_FAILED" });
  });

  it("preserves an explicit provider context rejection as a safe context-limit diagnostic", async () => {
    const fetcher: typeof fetch = async url => String(url).endsWith("/api/show") ? Response.json(metadata()) : Response.json({ error: "input exceeds context length: private input details" }, { status: 400 });
    await expect(executeCompletion(manifest(), request(), new AbortController().signal, { fetch: fetcher })).rejects.toMatchObject({ code: "SKILL_AUTHOR_CONTEXT_LIMIT", message: "The local model rejected the bounded Skill Author context." });
  });

  it("keeps the existing bounded response size guard", async () => {
    const fetcher: typeof fetch = async url => String(url).endsWith("/api/show") ? Response.json(metadata()) : new Response("", { headers: { "content-length": String(EXECUTION_LIMITS.maxStdoutBytes + 1) } });
    await expect(executeCompletion(manifest(), request(), new AbortController().signal, { fetch: fetcher })).rejects.toMatchObject({ code: "OUTPUT_TOO_LARGE" });
  });

  it("cancels native inference through the same signal and cannot accept a late completed response", async () => {
    let arrived = () => {}, finish: (value: Response) => void = () => {}, signal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { arrived = resolve; }), deferred = new Promise<Response>(resolve => { finish = resolve; });
    const fetcher: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/api/show")) return Response.json(metadata());
      signal = init?.signal ?? undefined; arrived(); return deferred;
    };
    const caller = new AbortController(), pending = executeCompletion(manifest(), request(), caller.signal, { fetch: fetcher });
    await started; caller.abort(); expect(signal?.aborted).toBe(true);
    finish(Response.json(nativeResponse()));
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
