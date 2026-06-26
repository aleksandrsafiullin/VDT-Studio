#!/usr/bin/env node
const { readFileSync } = require("node:fs");

const mode = process.env.VDT_FAKE_CURSOR_MODE ?? "stream-json";

function readPromptPayload(text) {
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
  if (process.argv.includes("--help")) {
    process.stdout.write("Usage: cursor-agent [options]\n");
    process.stdout.write("  --trust\n");
    process.exit(0);
  }

  if (process.argv.includes("--version")) {
    process.stdout.write("2026.06.19-test\n");
    process.exit(0);
  }

  if (process.argv.includes("status") && process.argv.includes("--format")) {
    process.stdout.write(`${JSON.stringify({ loggedIn: true, status: "ready" })}\n`);
    process.exit(0);
  }

  if (process.argv.includes("models")) {
    process.stdout.write("auto - Cursor automatic model\n");
    process.stdout.write("gpt-5.5-high - GPT high reasoning\n");
    process.exit(0);
  }

  const prompt = readFileSync(0, "utf8");
  const payload = readPromptPayload(prompt);

  if (mode === "slow") {
    setTimeout(() => process.exit(0), 30_000);
    return;
  }

  if (mode === "result-then-slow") {
    writeStreamJson(buildOutput(payload));
    setTimeout(() => process.exit(0), 30_000);
    return;
  }

  if (mode === "honey-read") {
    const honeyPath = process.env.HONEY_PATH;
    if (honeyPath) {
      try {
        const leaked = readFileSync(honeyPath, "utf8");
        writeStreamJson({ ok: true, leaked });
        process.exit(0);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "READ_FAILED";
        writeStreamJson({ ok: true, leaked: String(code) });
        process.exit(1);
      }
    }
    writeStreamJson({ ok: true });
    process.exit(0);
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

  if (mode === "reversed-tree") {
    writeStreamJson({
      projectTitle: "Fake Cursor tree",
      rootNodeId: "root",
      nodes: [{ id: "root" }, { id: "child" }],
      edges: [{ id: "edge_child_root", sourceNodeId: "child", targetNodeId: "root", relation: "positive_driver" }],
      assumptions: [],
      questionsForUser: [],
      warnings: []
    });
    process.exit(0);
  }

  if (mode === "duplicate-edge-tree") {
    writeStreamJson({
      projectTitle: "Fake Cursor tree",
      rootNodeId: "root",
      nodes: [{ id: "root" }, { id: "child" }],
      edges: [
        { id: "edge_formula", sourceNodeId: "root", targetNodeId: "child", relation: "formula_dependency" },
        { id: "edge_driver", sourceNodeId: "root", targetNodeId: "child", relation: "multiplicative_driver" }
      ],
      assumptions: [],
      questionsForUser: [],
      warnings: []
    });
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
