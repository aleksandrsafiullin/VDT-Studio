#!/usr/bin/env node
const { readFileSync } = require("node:fs");

const mode = process.env.VDT_FAKE_CODEX_MODE ?? "jsonl";

function readStdinPrompt() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePromptPayload(text) {
  const lines = text.trim().split(/\r?\n/);
  const lastLine = lines[lines.length - 1] ?? "";
  try {
    return JSON.parse(lastLine);
  } catch {
    return {};
  }
}

function buildOutput(payload) {
  if (payload.schemaId === "connection-test-v1") {
    return { ok: true };
  }
  return {
    projectTitle: "Fake Codex tree",
    rootNodeId: "root",
    nodes: [
      {
        id: "root",
        name: "Root KPI",
        description: "Synthetic root KPI for executor tests.",
        type: "root_kpi",
        unit: "units",
        aiConfidence: 0.9,
        aiRationale: "Fixture output for schema-valid tests.",
        controllability: "medium",
        materiality: "high"
      }
    ],
    edges: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
  };
}

function writeJsonl(result) {
  const serialized = JSON.stringify(result);
  const events = [
    { type: "thread.started", thread_id: "fake-thread" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: serialized }
    },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }
  ];
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

function main() {
  if (process.argv.includes("debug") && process.argv.includes("models")) {
    process.stdout.write(`${JSON.stringify({ models: [{ slug: "gpt-5.5" }, { id: "gpt-5.2" }, { id: "gpt-5.3-codex" }, { id: "codex-auto-review" }] })}\n`);
    process.exit(0);
  }

  const prompt = readStdinPrompt();
  const payload = parsePromptPayload(prompt);

  if (mode === "slow") {
    setTimeout(() => process.exit(0), 30_000);
    return;
  }

  if (mode === "auth-required") {
    process.stdout.write(`${JSON.stringify({ type: "error", message: "Authentication required. Please sign in to ChatGPT." })}\n`);
    process.stderr.write("Authentication required. Please sign in to ChatGPT.");
    process.exit(1);
  }

  if (mode === "bad-schema") {
    const invalid = { invalid: true };
    if (mode === "bad-schema" && process.argv.includes("--json")) {
      writeJsonl(invalid);
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(invalid));
    process.exit(0);
  }

  if (mode === "repairable") {
    if (!payload.invalidJsonExcerpt || prompt.includes("repair-secret")) {
      writeJsonl({ invalid: true });
      process.exit(0);
    }
  }

  const output = buildOutput(payload);

  if (mode === "structured") {
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  writeJsonl(output);
  process.exit(0);
}

main();
