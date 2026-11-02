#!/usr/bin/env node
// Current Pi RPC process fixture: no accounts, inference, files, or native tools.
if (process.argv.includes("--version")) { console.log("pi 1.0.0"); process.exit(0); }
const readline = require("node:readline");
const mode = process.argv.includes("--checkpoint-engine-fixture") ? "checkpoint-engine" : process.env.VDT_FAKE_HARNESS_MODE ?? "ok";
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let model = { provider: "fixture", id: "test-model", name: "Fixture model", reasoning: true };
let level = "high", active = false, timer, promptCount = 0;
readline.createInterface({ input: process.stdin }).on("line", line => {
  const { id, type, ...params } = JSON.parse(line);
  if (process.env.VDT_FAKE_HARNESS_LOG) require("node:fs").appendFileSync(process.env.VDT_FAKE_HARNESS_LOG, line + "\n");
  const reply = data => send({ id, type: "response", command: type, success: true, data: mode === "metadata-padding" && type.startsWith("get_") ? { ...data, padding: "m".repeat(40 * 1024) } : data });
  const failure = error => send({ id, type: "response", command: type, success: false, error });
  if (mode === "auth") return failure("Login required: private-provider-diagnostic");
  if (type === "get_state") return reply({ sessionId: "pi-fixture-session", model, thinkingLevel: mode === "reasoning-mismatch" ? "high" : level, isStreaming: active, isCompacting: false, pendingMessageCount: 0 });
  if (type === "get_available_models") return reply({ models: [model] });
  if (type === "get_available_thinking_levels") return reply({ levels: ["off", "low", "high"] });
  if (type === "set_model") { model = { ...model, provider: params.provider, id: mode === "model-mismatch" ? "wrong-model" : params.modelId }; return reply(model); }
  if (type === "set_thinking_level") { level = params.level; return reply({}); }
  if (type === "clear_queue") return reply({ steering: [], followUp: [] });
  if (type === "abort") {
    if (mode === "ignore-cancel") return;
    clearTimeout(timer); active = false;
    send({ type: "agent_end", messages: [] }); send({ type: "agent_settled" }); return reply({});
  }
  if (type === "prompt") {
    if (mode === "disconnect") process.exit(3);
    if (mode === "malformed") return process.stdout.write("private-provider-diagnostic is not JSON\n");
    if (mode === "quota") return failure("Quota limit reached: private-provider-diagnostic");
    active = true; reply({ disposition: "started" }); send({ type: "agent_start" });
    if (["slow", "ignore-cancel"].includes(mode)) { timer = setTimeout(() => { active = false; send({ type: "agent_settled" }); }, 30000); return; }
    if (mode === "thought-overflow") {
      let emitted = 0;
      timer = setInterval(() => {
        send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "t".repeat(4096) } });
        if (++emitted === 17) { clearInterval(timer); send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"ok":true}' } }); active = false; send({ type: "agent_settled", aborted: false }); }
      }, 2);
      return;
    }
    const prompt = params.message;
    let output = { ok: true };
    if (prompt.includes('"status"') && prompt.includes('"groups"')) output = { status: "empty", rationale: "No applicable fixture suggestion.", limitations: [], groups: [] };
    if (prompt.includes('"projectTitle"')) output = { projectTitle: "Fixture tree", rootNodeId: "root", nodes: [{ id: "root" }], edges: [], assumptions: [], questionsForUser: [], warnings: [] };
    if (process.env.VDT_FAKE_HARNESS_OUTPUT) output = JSON.parse(process.env.VDT_FAKE_HARNESS_OUTPUT);
    if (prompt.includes("__checkpoint_fixture__")) output = { protocolVersion: "vdt-checkpoint-turn-v1", assistantMessage: { messageId: "pi-fixture-message", text: "I will inspect the current model." }, action: { type: "action_batch", batch: { calls: [{ externalCallId: "pi-fixture-call", toolName: "project.get_current", args: {} }] } } };
    if (mode === "checkpoint-engine") output = { protocolVersion: "vdt-checkpoint-turn-v1", assistantMessage: promptCount === 0 ? { messageId: "pi-fixture-open", text: "I will inspect the model and confirm its period." } : null, action: { type: "action_batch", batch: { calls: promptCount++ === 0 ? [{ externalCallId: "pi-fixture-read", toolName: "project.get_current", args: {} }] : [{ externalCallId: "pi-fixture-question", toolName: "user.ask", args: { questions: [{ id: "time-horizon", question: "What time horizon should the model use?", reason: "The model needs a calculation period.", required: true, answerKind: "number" }] } }] } } };
    send({ type: "message_start", message: { role: "assistant", content: [], stopReason: "pending" } });
    if (mode === "metadata-padding") send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "t".repeat(40 * 1024) } });
    if (["tool", "tool-then-retry"].includes(mode)) send({ type: "tool_execution_start", toolCallId: "forbidden", toolName: "bash" });
    if (["retry-success", "overflow-success", "tool-then-retry", "retry-exhausted"].includes(mode)) {
      send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: '{"partial":' } });
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: '{"partial":' }], stopReason: mode === "overflow-success" ? "length" : "error", errorMessage: "529 overloaded: private-provider-diagnostic" } });
      send({ type: "agent_end", messages: [], willRetry: true });
      if (mode === "retry-exhausted") { send({ type: "auto_retry_end", success: false, attempt: 3, finalError: "Quota limit: private-provider-diagnostic" }); active = false; send({ type: "agent_settled", aborted: false }); return; }
      if (mode === "overflow-success") { send({ type: "compaction_start", reason: "overflow" }); send({ type: "compaction_end", reason: "overflow", result: { summary: "Fixture compaction" }, aborted: false, willRetry: true }); }
      else send({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 1 });
      send({ type: "agent_start" });
      send({ type: "message_start", message: { role: "assistant", content: [], stopReason: "pending" } });
    }
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: mode === "delta-replaced" ? '{"ok":false}' : JSON.stringify(output) } });
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(output) }], stopReason: mode === "error-after-accept" ? "error" : "stop", ...(mode === "error-after-accept" ? { errorMessage: "Quota limit: private-provider-diagnostic" } : {}) } });
    if (["retry-success", "tool-then-retry"].includes(mode)) send({ type: "auto_retry_end", success: true, attempt: 2 });
    send({ type: "agent_end", messages: [] });
    if (mode === "agent-end-only") return;
    const finish = () => { active = false; send({ type: "agent_settled", aborted: mode === "aborted-settle" }); };
    if (mode === "delayed-settle") timer = setTimeout(finish, 180); else finish();
    return;
  }
  failure("Unknown RPC command");
});
