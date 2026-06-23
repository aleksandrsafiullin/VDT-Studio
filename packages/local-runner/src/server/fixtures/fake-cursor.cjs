#!/usr/bin/env node
const { readFileSync } = require("node:fs");

const mode = process.env.VDT_FAKE_CURSOR_MODE ?? "stream-json";

function readPromptPayload() {
  const text = process.argv.at(-1) ?? "";
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
    return { ok: true, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() };
  }
  return {
    projectTitle: "Fake Cursor tree",
    rootNodeId: "root",
    nodes: [{ id: "root" }],
    edges: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
  };
}

function writeStreamJson(result) {
  const serialized = JSON.stringify(result);
  const events = [
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: serialized }] }
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: serialized
    }
  ];
  for (const event of events) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  }
}

function main() {
  const prompt = process.argv.at(-1) ?? "";
  const payload = readPromptPayload();

  if (mode === "slow") {
    setTimeout(() => process.exit(0), 30_000);
    return;
  }

  if (mode === "honey-read") {
    const honeyPath = process.env.HONEY_PATH;
    if (honeyPath) {
      try {
        const leaked = readFileSync(honeyPath, "utf8");
        process.stdout.write(`LEAKED:${leaked}`);
        process.exit(0);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "READ_FAILED";
        process.stderr.write(String(code));
        process.exit(1);
      }
    }
    process.stderr.write("HONEY_PATH missing");
    process.exit(1);
  }

  if (mode === "auth-required") {
    if (process.argv.includes("stream-json")) {
      process.stdout.write(`${JSON.stringify({ type: "error", message: "Authentication required. Please sign in to Cursor." })}\n`);
      process.exit(1);
    }
    process.stderr.write("Authentication required. Please sign in to Cursor.");
    process.exit(1);
  }

  if (mode === "bad-schema") {
    const invalid = { invalid: true };
    if (process.argv.includes("stream-json")) {
      writeStreamJson(invalid);
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(invalid));
    process.exit(0);
  }

  if (mode === "repairable") {
    if (!payload.invalidJsonExcerpt || prompt.includes("repair-secret")) {
      writeStreamJson({ invalid: true });
      process.exit(0);
    }
  }

  const output = buildOutput(payload);

  if (mode === "valid") {
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  }

  writeStreamJson(output);
  process.exit(0);
}

main();
