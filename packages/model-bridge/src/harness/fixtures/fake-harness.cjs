#!/usr/bin/env node
// Protocol fixture: no inference, network, accounts, or provider credentials.
if (process.argv.includes("--version")) { process.stdout.write("vdt-fixture 1.0.0\n"); process.exit(0); }
const readline = require("node:readline");
const mode = process.argv.includes("--checkpoint-engine-fixture") ? "checkpoint-engine" : process.env.VDT_HARNESS_FIXTURE_MODE ?? process.env.VDT_FAKE_HARNESS_MODE ?? "ok";
const send = v => process.stdout.write(JSON.stringify(v) + "\n");
let active, timer;
let promptCount = 0;
const sessionId = "fixture-session";
const modelConfig = { id: "model", category: "model", currentValue: "test-model", options: [{ value: "test-model", name: "Fixture model" }] };
const thinkingConfig = { id: "reasoning", category: "thought_level", currentValue: "high", options: [{ value: "off", name: "Off" }, { value: "low", name: "Low" }, { value: "high", name: "High" }] };
readline.createInterface({ input: process.stdin }).on("line", line => {
  const { id, method, params = {} } = JSON.parse(line);
  if (process.env.VDT_FAKE_HARNESS_LOG) require("node:fs").appendFileSync(process.env.VDT_FAKE_HARNESS_LOG, line + "\n");
  const reply = result => send({ jsonrpc: "2.0", id, result: mode === "metadata-padding" && ["initialize", "session/new"].includes(method) ? { ...result, padding: "m".repeat(40 * 1024) } : result });
  if (method === "initialize" || method === "vdt/initialize") return reply({ protocolVersion: mode === "protocol-version" ? 2 : 1, capabilities: { agentSession: true, structuredCompletion: true, cancellation: mode !== "missing-capability" }, agentCapabilities: { loadSession: true }, authMethods: [{ id: "cached_token" }] });
  if (method === "authenticate") return reply({});
  if (method === "_auth/status") return reply({ authenticated: true, authState: process.env.VDT_FAKE_VIBE_AUTH_SOURCE ?? "vibe_home_env_file" });
  if (method === "session/new" || method === "session/load") {
    if (mode === "auth") return send({ jsonrpc: "2.0", id, error: { code: -32000, message: "Authentication required" } });
    return reply({ sessionId: params.sessionId ?? sessionId, configOptions: mode === "missing-reasoning" ? [modelConfig] : [modelConfig, thinkingConfig] });
  }
  if (method === "session/set_model" || method === "session/set_config_option") {
    if (mode === "model-mismatch") return reply({ configOptions: [{ id: "model", currentValue: "wrong-model" }] });
    if (params.configId === "reasoning") { thinkingConfig.currentValue = mode === "reasoning-mismatch" ? "high" : params.value; return reply({ configOptions: [modelConfig, thinkingConfig] }); }
    return reply({});
  }
  if (method === "session/cancel") {
    if (mode === "ignore-cancel") return;
    if (timer) clearTimeout(timer);
    if (active !== undefined) send({ jsonrpc: "2.0", id: active, result: { stopReason: "cancelled" } });
    active = undefined; return;
  }
  if (method === "session/prompt" || method === "vdt/complete") {
    active = id;
    if (mode === "disconnect") process.exit(3);
    if (mode === "malformed") { process.stdout.write("private-provider-diagnostic is not JSON\n"); return; }
    if (mode === "ignore-cancel" || mode === "slow") { timer = setTimeout(() => reply({ stopReason: "end_turn" }), 30000); return; }
    if (mode === "quota") return send({ jsonrpc: "2.0", id, error: { code: -32000, message: "Quota limit reached" } });
    if (mode === "thought-overflow") {
      let emitted = 0;
      timer = setInterval(() => {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "t".repeat(4096) } } } });
        if (++emitted === 17) { clearInterval(timer); send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: '{"ok":true}' } } } }); active = undefined; reply({ stopReason: "end_turn" }); }
      }, 2);
      return;
    }
    if (mode === "metadata-padding") send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "t".repeat(40 * 1024) } } } });
    if (mode === "tool") send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "tool_call", title: "native terminal" } } });
    let output = { ok: true };
    const prompt = params.prompt?.[0]?.text ?? "";
    if (params.schemaId === "suggest-incoming-kpis-v1" || prompt.includes('"status"') && prompt.includes('"groups"')) output = { status: "empty", rationale: "No applicable fixture suggestion.", limitations: [], groups: [] };
    if (prompt.includes('"projectTitle"')) output = { projectTitle: process.env.VDT_HARNESS_FIXTURE_PROJECT_TITLE ?? "Fixture tree", rootNodeId: "root", nodes: [{ id: "root" }], edges: [], assumptions: [], questionsForUser: [], warnings: [] };
    if (mode === "bad-schema") output = { wrong: true };
    if (prompt.includes("__checkpoint_fixture__")) output = { protocolVersion: "vdt-checkpoint-turn-v1", assistantMessage: { messageId: "fixture-message", text: "I will inspect the current model." }, action: { type: "action_batch", batch: { calls: [{ externalCallId: "fixture-call", toolName: "project.get_current", args: {} }] } } };
    if (mode === "checkpoint-engine") output = { protocolVersion: "vdt-checkpoint-turn-v1", assistantMessage: promptCount === 0 ? { messageId: "fixture-open", text: "I will inspect the model and confirm its calculation period." } : null, action: { type: "action_batch", batch: { calls: promptCount++ === 0 ? [{ externalCallId: "fixture-read", toolName: "project.get_current", args: {} }] : [{ externalCallId: "fixture-question", toolName: "user.ask", args: { questions: [{ id: "time-horizon", question: "What time horizon should the model use?", reason: "The model needs a calculation period.", required: true, answerKind: "number" }] } }] } } };
    if (process.env.VDT_FAKE_HARNESS_OUTPUT) output = JSON.parse(process.env.VDT_FAKE_HARNESS_OUTPUT);
    if (method === "vdt/complete") return reply({ output });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(output) } } } });
    active = undefined; return reply({ stopReason: "end_turn" });
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown method" } });
});
