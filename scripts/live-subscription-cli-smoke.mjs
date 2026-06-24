#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  getSubscriptionCliAdapter,
  validateRegisteredSchema
} from "../packages/model-bridge/src/index.ts";
import { detectSubscriptionCli } from "../packages/model-bridge/src/detection.ts";
import {
  createManifestRegistry,
  executeCompletion
} from "../packages/local-runner/src/index.ts";

const BACKENDS = Object.freeze({
  codex_subscription: Object.freeze({ label: "Codex CLI", cliId: "codex" }),
  cursor_subscription: Object.freeze({ label: "Cursor Agent", cliId: "cursor-agent" })
});

function usage() {
  return [
    "Usage: node --import tsx scripts/live-subscription-cli-smoke.mjs [options]",
    "",
    "Options:",
    "  --backend <id|all>        codex_subscription, cursor_subscription, or all (default: all)",
    "  --model <model>           Optional model id passed to the provider CLI",
    "  --timeout-ms <number>     Per completion timeout, max 120000 (default: 120000)",
    "  --connection-only         Skip generate-tree and run install/auth/models/connection only",
    "  --help                    Show this help",
    "",
    "Examples:",
    "  pnpm live:codex",
    "  pnpm live:cursor",
    "  pnpm live:local-ai -- --connection-only"
  ].join("\n");
}

function parseArgs(argv) {
  const result = {
    backend: "all",
    timeoutMs: 120_000,
    connectionOnly: false,
    model: undefined
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--connection-only") {
      result.connectionOnly = true;
      continue;
    }
    if (arg === "--backend") {
      result.backend = argv[++index] ?? "";
      continue;
    }
    if (arg === "--model") {
      result.model = argv[++index] ?? "";
      continue;
    }
    if (arg === "--timeout-ms") {
      result.timeoutMs = Number(argv[++index] ?? "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.backend !== "all" && !(result.backend in BACKENDS)) {
    throw new Error(`Unsupported backend: ${result.backend}`);
  }
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0 || result.timeoutMs > 120_000) {
    throw new Error("--timeout-ms must be a positive integer up to 120000.");
  }
  if (result.model !== undefined && (result.model.length === 0 || result.model.length > 160 || result.model.includes("\0"))) {
    throw new Error("--model must be a non-empty bounded string.");
  }
  return result;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function diagnosticText(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  return ` (${value.map((entry) => String(entry)).join("; ")})`;
}

function printStep(status, label, detail = "") {
  const suffix = detail ? `: ${detail}` : "";
  process.stdout.write(`${status} ${label}${suffix}\n`);
}

async function step(label, action, options = {}) {
  const required = options.required !== false;
  try {
    const value = await action();
    printStep("PASS", label, options.describe?.(value) ?? "");
    return { ok: true, value };
  } catch (error) {
    const status = required ? "FAIL" : "WARN";
    printStep(status, label, errorMessage(error));
    return { ok: !required, error };
  }
}

function summarizeGenerateOutput(output) {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return "schema-valid object";
  const record = output;
  const projectTitle = typeof record.projectTitle === "string" ? record.projectTitle : "untitled";
  const nodes = Array.isArray(record.nodes) ? record.nodes.length : 0;
  const edges = Array.isArray(record.edges) ? record.edges.length : 0;
  return `${projectTitle}; nodes=${nodes}; edges=${edges}`;
}

async function runBackend(backendId, options) {
  const spec = BACKENDS[backendId];
  const manifest = createManifestRegistry().get(backendId);
  const adapter = getSubscriptionCliAdapter(backendId);
  let failed = false;

  process.stdout.write(`\n== ${spec.label} (${backendId}) ==\n`);

  if (!manifest) {
    printStep("FAIL", "manifest", "backend manifest is missing");
    return false;
  }
  if (!adapter) {
    printStep("FAIL", "adapter", "subscription CLI adapter is missing");
    return false;
  }

  const install = await step("detect executable", () => detectSubscriptionCli(spec.cliId), {
    describe: (result) => result.installed && result.executable
      ? `${result.alias ?? spec.cliId} -> ${result.executable}${result.version ? ` (${result.version})` : ""}`
      : "not installed"
  });
  if (!install.ok || !install.value.installed || !install.value.executable) {
    printStep("FAIL", "install gate", `${spec.label} was not found on PATH.`);
    return false;
  }

  const executable = install.value.executable;
  const auth = await step("auth probe", () => adapter.probeAuth?.(executable) ?? Promise.resolve({
    backendId,
    status: "installed",
    diagnostics: ["Adapter has no auth probe."]
  }), {
    describe: (result) => `${result.status}${result.authSummary ? ` - ${result.authSummary}` : ""}${diagnosticText(result.diagnostics)}`
  });
  if (!auth.ok || auth.value.status !== "ready") {
    failed = true;
    printStep("FAIL", "auth gate", `expected ready, received ${auth.value?.status ?? "unknown"}`);
  }

  const models = await step("model discovery", async () => {
    if (!adapter.listModels) return [];
    return adapter.listModels(executable);
  }, {
    required: false,
    describe: (result) => result.length > 0 ? result.join(", ") : "no models reported"
  });
  if (models.ok && Array.isArray(models.value) && models.value.length === 0) {
    printStep("WARN", "model discovery gate", "provider returned an empty list; UI can still use manual/catalog model ids.");
  }

  if (auth.value?.status !== "ready") {
    return false;
  }

  const executorOptions = { resolveExecutable: async () => executable };
  const connection = await step("connection-test-v1", () => executeCompletion(
    manifest,
    {
      requestId: randomUUID(),
      backendId,
      taskType: "generate_tree",
      schemaId: "connection-test-v1",
      input: { probe: true },
      ...(options.model ? { model: options.model } : {}),
      timeoutMs: options.timeoutMs
    },
    new AbortController().signal,
    executorOptions
  ), {
    describe: (result) => validateRegisteredSchema("connection-test-v1", result.output)
      ? `schemaValid=${result.schemaValid}`
      : "invalid connection output"
  });
  if (!connection.ok || !connection.value.schemaValid) failed = true;

  if (!options.connectionOnly) {
    const generate = await step("generate-tree-v1", () => executeCompletion(
      manifest,
      {
        requestId: randomUUID(),
        backendId,
        taskType: "generate_tree",
        schemaId: "generate-tree-v1",
        input: {
          prompt: "Return a minimal valid Value Driver Tree for Revenue with one root node and clear business drivers. Output only JSON for generate-tree-v1."
        },
        ...(options.model ? { model: options.model } : {}),
        timeoutMs: options.timeoutMs
      },
      new AbortController().signal,
      executorOptions
    ), {
      describe: (result) => `${summarizeGenerateOutput(result.output)}; schemaValid=${result.schemaValid}`
    });
    if (!generate.ok || !generate.value.schemaValid) failed = true;
  }

  return !failed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const backends = options.backend === "all" ? Object.keys(BACKENDS) : [options.backend];
  const results = [];
  for (const backendId of backends) {
    results.push(await runBackend(backendId, options));
  }
  const passed = results.filter(Boolean).length;
  process.stdout.write(`\nLive subscription CLI smoke: ${passed}/${results.length} backend(s) passed.\n`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`live-subscription-cli-smoke failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
