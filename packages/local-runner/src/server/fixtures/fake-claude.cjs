#!/usr/bin/env node

const mode = process.env.VDT_FAKE_CLAUDE_MODE ?? "json";

function promptFromArgs() {
  return process.argv[process.argv.length - 1] ?? "";
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
    return { ok: true, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() };
  }
  return {
    projectTitle: "Fake Claude tree",
    rootNodeId: "root",
    nodes: [{ id: "root" }],
    edges: [],
    assumptions: [],
    questionsForUser: [],
    warnings: []
  };
}

function writeEnvelope(structuredOutput, isError = false) {
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: isError ? "error" : "success",
      is_error: isError,
      result: isError ? structuredOutput : "Done.",
      ...(isError ? {} : { structured_output: structuredOutput })
    })
  );
}

function main() {
  const payload = parsePromptPayload(promptFromArgs());

  if (mode === "slow") {
    setTimeout(() => process.exit(0), 30_000);
    return;
  }

  if (mode === "auth-required") {
    writeEnvelope("Authentication required. Please run claude login.", true);
    process.stderr.write("Claude Code authentication failed.");
    process.exit(1);
  }

  if (mode === "bad-schema") {
    writeEnvelope({ invalid: true });
    process.exit(0);
  }

  writeEnvelope(buildOutput(payload));
  process.exit(0);
}

main();
