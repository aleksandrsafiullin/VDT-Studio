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
    return { ok: true };
  }
  if (payload.schemaId === "agent-decision-v2") {
    return {
      type: "call_tools",
      toolName: "",
      argsJson: "{}",
      callsJson: JSON.stringify([
        { toolName: "project.get_node", args: { nodeId: "root" } },
        { toolName: "project.get_subtree", args: { nodeId: "root", maxDepth: 2 } }
      ]),
      statusMessage: "Inspecting the project.",
      questionsJson: "[]",
      summary: "",
      nextSuggestedActions: []
    };
  }
  return {
    projectTitle: "Fake Claude tree",
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
  const prompt = promptFromArgs();
  const payload = parsePromptPayload(prompt);
  const schemaIndex = process.argv.indexOf("--json-schema");
  if (payload.taskType === "suggest_incoming_kpis" || payload.taskType === "suggest_chat_starters") {
    const turnIndex = process.argv.indexOf("--max-turns");
    if (schemaIndex !== -1 || turnIndex < 0 || process.argv[turnIndex + 1] !== "1" || !payload.outputJsonSchema) {
      process.stderr.write("Expected the schema in a single-turn prompt.\n");
      process.exit(1);
    }
    if (payload.taskType === "suggest_chat_starters") {
      const systemIndex = process.argv.indexOf("--system-prompt");
      const effortIndex = process.argv.indexOf("--effort");
      if (systemIndex < 0 || !process.argv[systemIndex + 1]?.includes("Formula excerpts may be incomplete")
        || effortIndex < 0 || process.argv[effortIndex + 1] !== "low") {
        process.stderr.write("Expected the compact starter system prompt and low Haiku effort.\n");
        process.exit(1);
      }
    }
    const output = payload.taskType === "suggest_chat_starters"
      ? { prompts: ["Check the root formula.", "Which inputs are missing?", "Review the main drivers."] }
      : { status: "empty", rationale: "No suitable immediate children.", limitations: [], groups: [] };
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 1, result: JSON.stringify(output) }));
    return;
  }
  try {
    const schema = schemaIndex >= 0 && JSON.parse(process.argv[schemaIndex + 1]);
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error();
  } catch {
    process.stderr.write("--json-schema requires an inline JSON schema.\n");
    process.exit(1);
  }

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

  if (mode === "repairable") {
    if (!payload.invalidJsonExcerpt || prompt.includes("repair-secret")) {
      writeEnvelope({ invalid: true });
      process.exit(0);
    }
  }

  writeEnvelope(buildOutput(payload));
  process.exit(0);
}

main();
