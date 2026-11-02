#!/usr/bin/env node
/** Runnable VDT JSONL v1 adapter for an existing ACP agent.
 * node harness-jsonl-adapter.mjs --command /path/to/agent -- acp
 * Replace the upstream launch/RPC mapping to adapt a different native SDK.
 * No API keys, models, billing fallbacks, or permission approvals are provided. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) { process.stdout.write("vdt-jsonl-adapter 1.0.0\n"); process.exit(0); }
const args = process.argv.slice(2), separator = args.indexOf("--");
if (args[0] !== "--command" || !args[1] || separator !== 2) {
  process.stderr.write("Usage: node harness-jsonl-adapter.mjs --command EXECUTABLE -- ACP_ARGUMENTS\n"); process.exit(2);
}
const child = spawn(args[1], args.slice(separator + 1), { stdio: ["pipe", "pipe", "inherit"], shell: false });
let nextId = 1;
const pending = new Map(), outputs = new Map();
const send = v => process.stdout.write(`${JSON.stringify(v)}\n`);
const write = v => child.stdin.write(`${JSON.stringify(v)}\n`);
const error = (id, message) => send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
createInterface({ input: process.stdin }).on("line", line => {
  let v;
  try { v = JSON.parse(line); } catch { process.stderr.write("Invalid host JSON frame\n"); return; }
  if (!v.method) return;
  if (v.id === undefined) { write(v); return; }
  const id = `adapter-${nextId++}`;
  pending.set(id, { originalId: v.id, method: v.method, sessionId: v.params?.sessionId });
  if (v.method === "vdt/complete") {
    if (outputs.has(v.params.sessionId)) { pending.delete(id); error(v.id, "A request is already active in this session"); return; }
    outputs.set(v.params.sessionId, { text: "", nativeTool: false });
    write({ jsonrpc: "2.0", id, method: "session/prompt", params: { sessionId: v.params.sessionId, prompt: [{ type: "text", text: v.params.instructions ?? `Return exactly one JSON value for this independent read-only completion. Do not call native tools.\n${JSON.stringify({ schema: v.params.schema, schemaId: v.params.schemaId, input: v.params.input })}` }] } });
  } else write({ ...v, id, method: v.method === "vdt/initialize" ? "initialize" : v.method });
}).on("close", () => child.stdin.end());

createInterface({ input: child.stdout }).on("line", line => {
  let v;
  try { v = JSON.parse(line); } catch { process.stderr.write("Invalid upstream JSON frame\n"); child.kill("SIGTERM"); return; }
  if (v.method) {
    if (v.method === "session/request_permission") { write({ jsonrpc: "2.0", id: v.id, result: { outcome: { outcome: "cancelled" } } }); const active = outputs.get(v.params?.sessionId); if (active) active.nativeTool = true; return; }
    if (v.id !== undefined) { write({ jsonrpc: "2.0", id: v.id, error: { code: -32601, message: "Unsupported host capability" } }); return; }
    const active = outputs.get(v.params?.sessionId), update = v.params?.update;
    if (active && v.method === "session/update") {
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") active.text += update.content.text;
      if (["tool_call", "tool_call_update"].includes(update?.sessionUpdate)) active.nativeTool = true;
      if (Buffer.byteLength(active.text) > 1024 * 1024) { child.kill("SIGTERM"); return; }
    } else send(v);
    return;
  }
  const request = pending.get(v.id); if (!request) return;
  pending.delete(v.id);
  if (v.error) { outputs.delete(request.sessionId); send({ ...v, id: request.originalId }); return; }
  if (request.method === "vdt/initialize") send({ jsonrpc: "2.0", id: request.originalId, result: { protocolVersion: v.result?.protocolVersion, capabilities: { agentSession: true, structuredCompletion: true, cancellation: true } } });
  else if (request.method === "vdt/complete") {
    const active = outputs.get(request.sessionId); outputs.delete(request.sessionId);
    if (v.result?.stopReason === "cancelled") { send({ jsonrpc: "2.0", id: request.originalId, result: { stopReason: "cancelled" } }); return; }
    if (active?.nativeTool || v.result?.stopReason !== "end_turn") { error(request.originalId, "Upstream completion did not finish without native tools"); return; }
    try { send({ jsonrpc: "2.0", id: request.originalId, result: { output: JSON.parse(active.text) } }); }
    catch { error(request.originalId, "Upstream completion did not return one JSON value"); }
  } else send({ ...v, id: request.originalId });
});
child.on("error", () => { for (const p of pending.values()) error(p.originalId, "Upstream agent could not start"); process.exitCode = 1; });
child.on("close", code => { for (const p of pending.values()) error(p.originalId, "Upstream agent exited before completion"); process.exit(code ?? 1); });
process.on("SIGTERM", () => { child.kill("SIGTERM"); setTimeout(() => { child.kill("SIGKILL"); process.exit(1); }, 250).unref(); });
