#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createVdtAgentRuntime } from "../packages/vdt-agent-runtime/src/orchestrator.ts";
import {
  cancelRuntimeRequest,
  completeRuntime,
  createLocalRuntimeContext
} from "../packages/local-runner/src/server/runtime.ts";
import { calculateGraph } from "../packages/vdt-core/src/formula/calculate.ts";

const BACKENDS = Object.freeze({
  codex_subscription: Object.freeze({ label: "Codex CLI", expectedSkillId: "mining.haulage_truck_cycle" }),
  cursor_subscription: Object.freeze({ label: "Cursor Agent", expectedSkillId: "mining.haulage_truck_cycle" })
});

const PROMPT = [
  "I have 5 trucks",
  "Average distance 2.7 km",
  "Average load speed - 7 km/h",
  "Average empty speed - 11 km/h"
].join("\n");

function usage() {
  return [
    "Usage: pnpm exec tsx scripts/live-agent-cli-smoke.mjs [options]",
    "",
    "Options:",
    "  --backend <id>            codex_subscription or cursor_subscription (default: codex_subscription)",
    "  --model <model>           Optional model id passed to the provider CLI",
    "  --base-url <url>          Optional running web app URL; exercises /api/agent/runs instead of in-process runtime",
    "  --timeout-ms <number>     Per model call timeout, max 120000 (default: 120000)",
    "  --max-rounds <number>     Maximum clarification rounds (default: 5)",
    "  --help                    Show this help",
    "",
    "Examples:",
    "  pnpm live:agent:codex",
    "  pnpm live:agent:codex:api",
    "  pnpm live:agent:codex -- --model gpt-5.5"
  ].join("\n");
}

function parseArgs(argv) {
  const result = {
    backend: "codex_subscription",
    model: undefined,
    baseUrl: undefined,
    timeoutMs: 120_000,
    maxRounds: 5
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      result.help = true;
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
    if (arg === "--base-url") {
      result.baseUrl = argv[++index] ?? "";
      continue;
    }
    if (arg === "--timeout-ms") {
      result.timeoutMs = Number(argv[++index] ?? "");
      continue;
    }
    if (arg === "--max-rounds") {
      result.maxRounds = Number(argv[++index] ?? "");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!(result.backend in BACKENDS)) throw new Error(`Unsupported backend: ${result.backend}`);
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0 || result.timeoutMs > 120_000) {
    throw new Error("--timeout-ms must be a positive integer up to 120000.");
  }
  if (!Number.isSafeInteger(result.maxRounds) || result.maxRounds <= 0 || result.maxRounds > 10) {
    throw new Error("--max-rounds must be a positive integer up to 10.");
  }
  if (result.model !== undefined && (result.model.length === 0 || result.model.length > 160 || result.model.includes("\0"))) {
    throw new Error("--model must be a non-empty bounded string.");
  }
  if (result.baseUrl !== undefined) {
    try {
      result.baseUrl = new URL(result.baseUrl).origin;
    } catch {
      throw new Error("--base-url must be a valid URL.");
    }
  }
  return result;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printStep(status, label, detail = "") {
  const suffix = detail ? `: ${detail}` : "";
  process.stdout.write(`${status} ${label}${suffix}\n`);
}

function createLivePlanningProvider(options) {
  const runtimeContext = createLocalRuntimeContext({
    auditSink: (event) => {
      process.stdout.write(`${JSON.stringify({ event: "live_agent_runtime_audit", ...event })}\n`);
    }
  });

  return {
    id: "local_runner",
    async completeStructured(params) {
      const requestId = randomUUID();
      const abort = () => {
        try {
          cancelRuntimeRequest(requestId, runtimeContext);
        } catch {
          // The local runtime request may not be registered yet, or may already be terminal.
        }
      };
      params.signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await completeRuntime({
          requestId,
          backendId: options.backend,
          taskType: "agent_decision",
          schemaId: "agent-decision-v1",
          input: {
            data: params.input,
            systemPrompt: params.systemPrompt,
            userPrompt: params.userPrompt
          },
          ...(options.model ? { model: options.model } : {}),
          timeoutMs: options.timeoutMs
        }, runtimeContext);
        const payload = result.payload;
        if (result.statusCode < 200 || result.statusCode >= 300 || !payload?.ok) {
          throw new Error(payload?.error?.message ?? "Live CLI agent decision failed.");
        }
        if (payload.run?.repairAttempted || payload.run?.repaired) {
          throw new Error("Live CLI agent decision required structured-output repair; primary agent-decision output is not readiness-clean.");
        }
        return payload.output;
      } finally {
        params.signal?.removeEventListener("abort", abort);
      }
    }
  };
}

function answerQuestion(question) {
  const text = `${question.id ?? ""} ${question.question ?? ""} ${question.reason ?? ""}`.toLowerCase();
  if (/(payload|tonnes per trip|tons per trip|truck load|load per truck)/.test(text)) return "40 tonnes per loaded trip";
  if (/(availability|available)/.test(text)) return "85% mechanical availability";
  if (/(utilization|utilisation)/.test(text)) return "90% utilization of available truck time";
  if (/(calendar|hours per year|annual hours|yearly hours)/.test(text)) return "8760 calendar hours per year";
  if (/(operating hours|working hours|productive hours|shift hours)/.test(text)) return "4000 operating hours per year";
  if (/(loading|load time)/.test(text)) return "4 minutes average loading time";
  if (/(dump|unload|tipping)/.test(text)) return "2 minutes average dumping time";
  if (/(queue|spotting|wait|delay)/.test(text)) return "3 minutes average queue and spotting time per cycle";
  if (/(allocation|ore|waste|dedicated)/.test(text)) return "All 5 trucks are dedicated to ore haulage in this VDT";
  if (/(mine type|open pit|underground|operation type)/.test(text)) return "Open-pit mine haulage";
  if (/(distance|haul)/.test(text)) return "Average one-way haul distance is 2.7 km";
  if (/(loaded speed|load speed)/.test(text)) return "Average loaded speed is 7 km/h";
  if (/(empty speed|return speed)/.test(text)) return "Average empty return speed is 11 km/h";
  if (/(truck|fleet|count|number)/.test(text)) return "5 haul trucks";
  return "Use a reasonable mining haulage assumption, include it as an assumption, and continue building the VDT.";
}

function collectNodeText(node) {
  return [node.id, node.name, node.description, node.unit, node.formula].filter(Boolean).join(" ").toLowerCase();
}

function hasNodeValue(nodes, patterns, expected) {
  return nodes.some((node) => {
    if (typeof node.baselineValue !== "number") return false;
    if (Math.abs(node.baselineValue - expected) > 0.001) return false;
    const text = collectNodeText(node);
    return patterns.some((pattern) => text.includes(pattern));
  });
}

function validateSnapshot(snapshot, options) {
  assert(snapshot.request?.input?.prompt?.includes("I have 5 trucks"), "Original user prompt was not retained in the agent run.");
  const selectedSkillIds = snapshot.selectedSkills?.map((skill) => skill.id) ?? [];
  assert(
    selectedSkillIds.includes(BACKENDS[options.backend].expectedSkillId),
    `Expected ${BACKENDS[options.backend].expectedSkillId}, got ${selectedSkillIds.join(", ") || "none"}.`
  );
  assert(!selectedSkillIds.some((id) => id.startsWith("generic.")), `Generic fallback skill was selected: ${selectedSkillIds.join(", ")}`);
  assert(snapshot.draftProject, "Final snapshot has no draftProject.");
  const nodes = snapshot.draftProject.graph?.nodes ?? [];
  const rootNode = nodes.find((node) => node.id === snapshot.draftProject.rootNodeId);
  assert(rootNode?.formula?.trim(), "Final VDT root node has no formula.");
  const calculation = calculateGraph(snapshot.draftProject);
  assert(calculation.errors.length === 0, `Final VDT calculation has errors: ${calculation.errors.map((error) => error.message).join("; ")}`);
  assert(
    typeof calculation.values[snapshot.draftProject.rootNodeId] === "number" &&
      Number.isFinite(calculation.values[snapshot.draftProject.rootNodeId]),
    "Final VDT root KPI did not calculate to a finite value."
  );
  assert(nodes.length >= 5, `Expected a non-trivial VDT graph, got ${nodes.length} node(s).`);
  assert(hasNodeValue(nodes, ["truck"], 5), "VDT graph does not contain the 5-truck input.");
  assert(hasNodeValue(nodes, ["distance", "haul"], 2.7), "VDT graph does not contain the 2.7 km haul distance input.");
  assert(hasNodeValue(nodes, ["loaded", "load speed"], 7), "VDT graph does not contain the 7 km/h loaded speed input.");
  assert(hasNodeValue(nodes, ["empty", "return"], 11), "VDT graph does not contain the 11 km/h empty speed input.");
  assert(hasNodeValue(nodes, ["payload", "load"], 40), "VDT graph does not contain the answered 40 tonnes payload input.");
}

function createStartRequest(options) {
  return {
    mode: "generate_vdt",
    input: {
      prompt: PROMPT,
      rootKpi: "Ore haulage",
      unit: "tonnes/year",
      timePeriod: "year"
    },
    providerId: "local_runner",
    providerConfig: {
      backendId: options.backend,
      timeoutMs: options.timeoutMs,
      ...(options.model ? { model: options.model } : {})
    },
    options: { continueWithAssumptions: false }
  };
}

async function finishRunLoop(snapshot, options, sendAnswers) {
  const sawClarifyingQuestions = snapshot.status === "needs_user_input";
  printStep("INFO", "start result", `status=${snapshot.status}; skills=${snapshot.selectedSkills.map((skill) => skill.id).join(", ") || "none"}`);

  for (let round = 1; snapshot.status === "needs_user_input" && round <= options.maxRounds; round += 1) {
    const questions = snapshot.pendingQuestions ?? [];
    assert(questions.length > 0, "Agent reported needs_user_input without pending questions.");
    const answers = Object.fromEntries(questions.map((question) => [question.id, answerQuestion(question)]));
    printStep("RUN", `answer clarification round ${round}`, Object.keys(answers).join(", "));
    snapshot = await sendAnswers(snapshot.runId, answers);
    printStep("INFO", `round ${round} result`, `status=${snapshot.status}`);
  }

  assert(sawClarifyingQuestions, "Agent did not ask for missing haulage data before building.");
  assert(snapshot.status !== "needs_user_input", `Agent still needs user input after ${options.maxRounds} round(s).`);
  assert(snapshot.status !== "failed", `Agent failed: ${snapshot.error?.message ?? "unknown error"}`);
  assert(snapshot.status === "succeeded", `Expected succeeded, got ${snapshot.status}.`);
  validateSnapshot(snapshot, options);
  printStep("PASS", "live agent VDT smoke", `runId=${snapshot.runId}; nodes=${snapshot.draftProject.graph.nodes.length}`);
}

async function runLiveAgentSmoke(options) {
  const runtime = createVdtAgentRuntime();
  const provider = createLivePlanningProvider(options);
  const request = createStartRequest(options);

  printStep("RUN", "start agent run", `${BACKENDS[options.backend].label} via local_runner`);
  const snapshot = await runtime.startRun(request, { provider });
  await finishRunLoop(snapshot, options, (runId, answers) =>
    runtime.handleMessage(runId, { type: "user_answer", answers }, { provider })
  );
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || !payload?.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}: ${payload?.error?.message ?? "invalid response"}`);
  }
  return payload;
}

async function runLiveAgentApiSmoke(options) {
  const request = createStartRequest(options);
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  printStep("RUN", "start API agent run", `${baseUrl}/api/agent/runs via ${BACKENDS[options.backend].label}`);
  const started = await postJson(`${baseUrl}/api/agent/runs`, request);
  await finishRunLoop(started.snapshot, options, async (runId, answers) => {
    const resumed = await postJson(`${baseUrl}/api/agent/runs/${encodeURIComponent(runId)}/messages`, {
      type: "user_answer",
      answers
    });
    return resumed.snapshot;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.baseUrl) {
    await runLiveAgentApiSmoke(options);
  } else {
    await runLiveAgentSmoke(options);
  }
}

main().catch((error) => {
  process.stderr.write(`live-agent-cli-smoke failed: ${errorMessage(error)}\n`);
  process.exit(1);
});
