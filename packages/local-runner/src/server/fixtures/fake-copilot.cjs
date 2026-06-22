#!/usr/bin/env node

const mode = process.env.VDT_FAKE_COPILOT_MODE ?? "jsonl";
const promptIndex = process.argv.indexOf("--prompt");
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] ?? "" : "";
const lastLine = prompt.trim().split(/\r?\n/).at(-1) ?? "{}";
let payload = {};
try { payload = JSON.parse(lastLine); } catch {}

if (mode === "slow") return void setTimeout(() => process.exit(0), 30_000);
if (mode === "auth-required") {
  process.stdout.write(`${JSON.stringify({ type: "error", message: "GitHub authentication required. Run copilot login." })}\n`);
  process.exit(1);
}
const output = mode === "bad-schema"
  ? { invalid: true }
  : payload.schemaId === "connection-test-v1"
    ? { ok: true }
    : { projectTitle: "Fake Copilot tree", rootNodeId: "root", nodes: [{ id: "root" }], edges: [], assumptions: [], questionsForUser: [], warnings: [] };
process.stdout.write(`${JSON.stringify({ type: "assistant.message", data: { content: JSON.stringify(output) } })}\n`);
process.stdout.write(`${JSON.stringify({ type: "result", status: "success" })}\n`);
