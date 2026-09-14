#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SQLITE_PATH = path.join(REPO_ROOT, "apps/web/.vdt/app.sqlite");
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const METRICS_SETTLE_MS = 500;
const TRANSPORT_RETRY_BUDGET = 3;
const TRANSPORT_RETRY_BACKOFF_MS = Object.freeze([250, 500, 1_000]);

/** Internally consistent haulage fixture numbers — operating hours reconcile with working days. */
const HAULAGE_FIXTURE = Object.freeze({
  trucks: 5,
  payloadTonnes: 40,
  haulDistanceKm: 2.7,
  loadedSpeedKmh: 7,
  emptySpeedKmh: 11,
  availabilityPct: 85,
  calendarHoursPerYear: 8760,
  workingDaysPerYear: 250,
  shiftsPerDay: 2,
  hoursPerShift: 8,
  operatingHoursPerYear: 4000
});

const VALID_BINDINGS = Object.freeze([
  "codex_session_canary",
  "cursor_session_canary",
  "claude_session_canary"
]);

const CLAUDE_SESSION_BINDING = "claude_session_canary";
export const CLAUDE_CLI_NOT_DETECTED_MESSAGE =
  "Claude CLI not detected; see docs/provider-compatibility.md";

const BINDING_EXPECTED_SKILL = Object.freeze({
  codex_session_canary: "mining.haulage_truck_cycle",
  cursor_session_canary: "mining.haulage_truck_cycle",
  claude_session_canary: "mining.haulage_truck_cycle"
});

const PROMPT = [
  "I have 5 trucks",
  "Average distance 2.7 km",
  "Average load speed - 7 km/h",
  "Average empty speed - 11 km/h"
].join("\n");

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "recovery_required"]);

class EnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentError";
  }
}

function usage() {
  return [
    "Usage: pnpm exec tsx scripts/live-cli-session-checkpoint-smoke.mjs --binding <id> [options]",
    "",
    "Opt-in live smoke for checkpoint session Supervisor engines (Codex/Cursor/Claude)",
    "via POST /api/agent/runs with executionBindingId.",
    "",
    "Prerequisites:",
    "  Terminal 1: VDT_CLI_SESSION_CANARY_ENABLED=true pnpm dev",
    "  Terminal 2: pnpm live:cli-session:codex:api",
    "  The canary flag must be set on the dev-server process, not this harness shell.",
    "  Claude: `claude` must be on PATH. On hosts without it, preflight exits 2.",
    "",
    "Required:",
    "  --binding <id>              codex_session_canary | cursor_session_canary | claude_session_canary",
    "",
    "Options:",
    "  --base-url <url>            Web app origin (default: http://127.0.0.1:3000)",
    "  --research-mode <mode>      auto | on | off (default: off) → options.researchMode",
    "  --poll-interval-ms <n>      Poll interval for GET /api/agent/runs/{runId} (default: 1500, min: 500)",
    "  --no-auto-answer            Poll only; exit 1 on first needs_user_input",
    "  --max-answer-rounds <n>     Clarification cap (default: 8, max: 10)",
    "  --timeout-ms <n>            Wall-clock cap for entire run loop (default: 300000, max: 600000)",
    "  --validate-graph            Assert haulage VDT graph + skill (default: on)",
    "  --no-validate-graph         Protocol-only smoke; skip graph/skill assertions",
    "  --sqlite-path <path>        SQLite DB for spawn metrics (default: apps/web/.vdt/app.sqlite)",
    "  --help                      Show this help",
    "",
    "Exit codes (aligned with cliq-02/03 Outcome class):",
    "  0  Terminal succeeded + graph validation pass (or --no-validate-graph)",
    "  1  Partial progress / protocol blocked / probe mode (see evidence summary outcomeClass)",
    "     cancelled terminal status → outcomeClass protocol_blocked",
    "  2  Environment blocker (binding absent from GET, Claude CLI not detected, bad CLI args, schema self-check failure)",
    "",
    "Spawn metrics (evidence summary):",
    "  cliSegmentCount       COUNT(distinct stable_call_key) completed receipts in SQLite",
    "  sessionBindingCount   COUNT(*) from agent_session_bindings_v2 (expect 1)",
    "  sessionEpoch          executionSummary.sessionEpoch (corroboration only)",
    "  Legacy baseline ~27 cold agent --print spawns; session path should be cliSegmentCount ≪ 27.",
    "",
    "Examples:",
    "  pnpm live:cli-session:codex:api",
    "  pnpm live:cli-session:cursor:api -- --timeout-ms 600000",
    "  pnpm live:cli-session:codex:api -- --no-validate-graph --research-mode auto",
    "  pnpm live:cli-session:claude              # expected fail-fast without `claude` CLI"
  ].join("\n");
}

function parseArgs(argv) {
  const result = {
    binding: undefined,
    baseUrl: DEFAULT_BASE_URL,
    researchMode: "off",
    pollIntervalMs: 1_500,
    autoAnswer: true,
    maxAnswerRounds: 8,
    timeoutMs: 300_000,
    validateGraph: true,
    sqlitePath: DEFAULT_SQLITE_PATH,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--binding") {
      result.binding = argv[++index] ?? "";
      continue;
    }
    if (arg === "--base-url") {
      result.baseUrl = argv[++index] ?? "";
      continue;
    }
    if (arg === "--research-mode") {
      result.researchMode = argv[++index] ?? "";
      continue;
    }
    if (arg === "--poll-interval-ms") {
      result.pollIntervalMs = Number(argv[++index] ?? "");
      continue;
    }
    if (arg === "--no-auto-answer") {
      result.autoAnswer = false;
      continue;
    }
    if (arg === "--max-answer-rounds") {
      result.maxAnswerRounds = Number(argv[++index] ?? "");
      continue;
    }
    if (arg === "--timeout-ms") {
      result.timeoutMs = Number(argv[++index] ?? "");
      continue;
    }
    if (arg === "--validate-graph") {
      result.validateGraph = true;
      continue;
    }
    if (arg === "--no-validate-graph") {
      result.validateGraph = false;
      continue;
    }
    if (arg === "--sqlite-path") {
      result.sqlitePath = argv[++index] ?? "";
      continue;
    }
    throw new EnvironmentError(`Unknown argument: ${arg}`);
  }

  if (!result.binding) {
    throw new EnvironmentError("--binding is required. Use --help for usage.");
  }
  if (!VALID_BINDINGS.includes(result.binding)) {
    throw new EnvironmentError(
      `Unsupported binding: ${result.binding}. Expected one of: ${VALID_BINDINGS.join(", ")}.`
    );
  }
  if (!["auto", "on", "off"].includes(result.researchMode)) {
    throw new EnvironmentError("--research-mode must be auto, on, or off.");
  }
  if (!Number.isSafeInteger(result.pollIntervalMs) || result.pollIntervalMs < 500) {
    throw new EnvironmentError("--poll-interval-ms must be an integer >= 500.");
  }
  if (!Number.isSafeInteger(result.maxAnswerRounds) || result.maxAnswerRounds <= 0 || result.maxAnswerRounds > 10) {
    throw new EnvironmentError("--max-answer-rounds must be a positive integer up to 10.");
  }
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0 || result.timeoutMs > 600_000) {
    throw new EnvironmentError("--timeout-ms must be a positive integer up to 600000.");
  }
  try {
    result.baseUrl = new URL(result.baseUrl).origin;
  } catch {
    throw new EnvironmentError("--base-url must be a valid URL.");
  }
  if (!path.isAbsolute(result.sqlitePath)) {
    result.sqlitePath = path.resolve(REPO_ROOT, result.sqlitePath);
  }
  return result;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatZodIssue(issue) {
  const pathLabel = issue.path.join(".");
  return pathLabel ? `${pathLabel}: ${issue.message}` : issue.message;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function printStep(status, label, detail = "") {
  const suffix = detail ? `: ${detail}` : "";
  process.stdout.write(`${status} ${label}${suffix}\n`);
}

function printEnvironmentEvidence(detail) {
  printStep("INFO", "evidence summary", `outcomeClass=environment_blocker; exitReason=environment_error; detail=${detail}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function questionContextText(question) {
  return `${question.id ?? ""} ${question.question ?? ""} ${question.reason ?? ""}`.toLowerCase();
}

function optionLabel(option) {
  return typeof option === "string" ? option : option.label;
}

function optionValue(option) {
  return typeof option === "string" ? option : option.value;
}

function optionRequiresFreeText(option) {
  return typeof option === "string" ? false : option.requiresFreeText === true;
}

function inferFreeTextAnswer(question) {
  const text = questionContextText(question);
  const f = HAULAGE_FIXTURE;
  if (/(working_time_basis|working time basis|time basis)/.test(text)) {
    return `${f.operatingHoursPerYear} operating hours per year from ${f.workingDaysPerYear} working days, ${f.shiftsPerDay} shifts per day, ${f.hoursPerShift} hours per shift`;
  }
  if (/(confirm_working|working_days|days_per_year|working days)/.test(text)) {
    return `${f.workingDaysPerYear} working days per year (${f.shiftsPerDay} shifts of ${f.hoursPerShift} hours, ${f.operatingHoursPerYear} operating hours per year)`;
  }
  if (/(payload|tonnes per trip|tons per trip|truck load|load per truck)/.test(text)) return `${f.payloadTonnes} tonnes per loaded trip`;
  if (/(availability|available)/.test(text)) return `${f.availabilityPct}% mechanical availability`;
  if (/(calendar|hours per year|annual hours|yearly hours)/.test(text)) return `${f.calendarHoursPerYear} calendar hours per year`;
  if (/(operating hours|working hours|productive hours|shift hours)/.test(text)) {
    return `${f.operatingHoursPerYear} operating hours per year (${f.workingDaysPerYear} days × ${f.shiftsPerDay} shifts × ${f.hoursPerShift} hours)`;
  }
  if (/(loading|load time)/.test(text)) return "4 minutes average loading time";
  if (/(dump|unload|tipping)/.test(text)) return "2 minutes average dumping time";
  if (/(queue|spotting|wait|delay)/.test(text)) return "3 minutes average queue and spotting time per cycle";
  if (/(allocation|ore|waste|dedicated)/.test(text)) return "All 5 trucks are dedicated to ore haulage in this VDT";
  if (/(mine type|open pit|underground|operation type)/.test(text)) return "Open-pit mine haulage";
  if (/(distance|haul)/.test(text)) return `Average one-way haul distance is ${f.haulDistanceKm} km`;
  if (/(loaded speed|load speed)/.test(text)) return `Average loaded speed is ${f.loadedSpeedKmh} km/h`;
  if (/(empty speed|return speed)/.test(text)) return `Average empty return speed is ${f.emptySpeedKmh} km/h`;
  if (/(truck|fleet|count|number)/.test(text)) return `${f.trucks} haul trucks`;
  return "Use a reasonable mining haulage assumption, include it as an assumption, and continue building the VDT.";
}

function inferNumberAnswer(question, field) {
  const text = `${field?.id ?? ""} ${field?.label ?? ""} ${field?.unit ?? ""} ${questionContextText(question)}`.toLowerCase();
  const f = HAULAGE_FIXTURE;
  if (/(working_days|days_per_year|confirm_working|working days)/.test(text)) return f.workingDaysPerYear;
  if (/(shifts_per_day|shifts per day)/.test(text)) return f.shiftsPerDay;
  if (/(hours_per_shift|hours per shift|shift length|shift hours)/.test(text)) return f.hoursPerShift;
  if (/(calendar|hours per year|annual hours|yearly hours)/.test(text)) return f.calendarHoursPerYear;
  if (/(operating hours|working hours|productive hours|working time|shift hours)/.test(text)) return f.operatingHoursPerYear;
  if (/(payload|tonnes|load)/.test(text)) return f.payloadTonnes;
  if (/(availability|available)/.test(text)) return f.availabilityPct;
  if (/(loading|load time)/.test(text)) return 4;
  if (/(dump|unload|tipping)/.test(text)) return 2;
  if (/(queue|spotting|wait|delay)/.test(text)) return 3;
  if (/(distance|haul)/.test(text)) return f.haulDistanceKm;
  if (/(loaded speed|load speed)/.test(text)) return f.loadedSpeedKmh;
  if (/(empty speed|return speed)/.test(text)) return f.emptySpeedKmh;
  if (/(truck|fleet|count|number)/.test(text)) return f.trucks;
  return 1;
}

function inferFieldValue(field, question) {
  if (field.kind === "number") return inferNumberAnswer(question, field);
  return inferFreeTextAnswer(question);
}

function scoreOption(option, question) {
  const questionText = questionContextText(question);
  const optionText = `${optionLabel(option)} ${optionValue(option)}`.toLowerCase();
  let score = 0;

  if (/(mine type|open pit|underground|operation type)/.test(questionText)) {
    if (/open[- ]?pit|surface/.test(optionText)) score += 10;
    if (/underground/.test(optionText)) score -= 4;
    if (/mixed/.test(optionText)) score -= 2;
  }
  if (/(allocation|ore|waste|dedicated)/.test(questionText)) {
    if (/ore|dedicated/.test(optionText)) score += 8;
    if (/waste|mixed/.test(optionText)) score -= 3;
  }
  if (/(working_time_basis|working time basis|time basis)/.test(questionText)) {
    if (/operating|shift|working day|productive/.test(optionText)) score += 10;
    if (/calendar|8760/.test(optionText)) score -= 2;
  }
  if (/(availability|available)/.test(questionText) && /85|percent|%/.test(optionText)) score += 6;
  if (/(calendar|hours per year|annual hours)/.test(questionText) && /8760|calendar/.test(optionText)) score += 6;
  if (/(operating hours|working hours|productive hours|shift hours|working time)/.test(questionText) && /4000|operating|shift/.test(optionText)) score += 6;
  if (/(working_days|days_per_year|confirm_working)/.test(questionText) && /250|working day/.test(optionText)) score += 8;
  if (/(payload|tonnes|load per truck)/.test(questionText) && /40|tonne|ton/.test(optionText)) score += 6;
  if (/(distance|haul)/.test(questionText) && /2\.7|km|distance/.test(optionText)) score += 4;
  if (/(loaded speed|load speed)/.test(questionText) && /7|loaded/.test(optionText)) score += 4;
  if (/(empty speed|return speed)/.test(questionText) && /11|empty|return/.test(optionText)) score += 4;
  if (/(truck|fleet|count|number)/.test(questionText) && /\b5\b|five|truck/.test(optionText)) score += 4;

  if (optionRequiresFreeText(option)) score -= 2;
  return score;
}

function pickSingleChoiceOption(question) {
  const options = question.options ?? [];
  if (options.length === 0) return null;
  const ranked = options
    .map((option, index) => ({ option, score: scoreOption(option, question), index }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.option ?? options[0];
}

function pickMultiChoiceOptions(question) {
  const options = question.options ?? [];
  if (options.length === 0) return [];
  const ranked = options
    .map((option, index) => ({ option, score: scoreOption(option, question), index }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const positive = ranked.filter((entry) => entry.score > 0).map((entry) => entry.option);
  if (positive.length > 0) return positive;
  return [ranked[0].option];
}

function fieldsForQuestion(question) {
  if (question.fields?.length) return question.fields;
  const answerKind = question.answerKind ?? question.expectedAnswerType ?? "text";
  if ((answerKind === "number" || answerKind === "text") && !(question.options?.length)) {
    return [{
      id: "answer",
      label: "Answer",
      kind: answerKind === "number" ? "number" : "text",
      required: question.required
    }];
  }
  return [];
}

function buildStructuredAnswer(question) {
  const answerKind = question.answerKind ?? question.expectedAnswerType ?? "text";
  const payload = { questionId: question.id };

  if (answerKind === "single_choice" || (question.options?.length && answerKind !== "multi_choice")) {
    const option = pickSingleChoiceOption(question);
    if (!option) {
      payload.freeText = inferFreeTextAnswer(question);
      return payload;
    }
    payload.selectedOptionIds = [optionValue(option)];
    const revealedFields = typeof option === "string" ? [] : option.revealsFields ?? [];
    if (revealedFields.length > 0) {
      payload.fields = Object.fromEntries(
        revealedFields.map((field) => [field.id, inferFieldValue(field, question)])
      );
    }
    if (optionRequiresFreeText(option)) {
      payload.freeText = inferFreeTextAnswer(question);
    }
    return payload;
  }

  if (answerKind === "multi_choice") {
    const selected = pickMultiChoiceOptions(question);
    payload.selectedOptionIds = selected.map((option) => optionValue(option));
    const revealedFields = selected.flatMap((option) =>
      typeof option === "string" ? [] : option.revealsFields ?? []
    );
    if (revealedFields.length > 0) {
      payload.fields = Object.fromEntries(
        revealedFields.map((field) => [field.id, inferFieldValue(field, question)])
      );
    }
    if (selected.some((option) => optionRequiresFreeText(option))) {
      payload.freeText = inferFreeTextAnswer(question);
    }
    return payload;
  }

  const fields = fieldsForQuestion(question);
  if (answerKind === "field_group" || fields.length > 0) {
    payload.fields = Object.fromEntries(
      fields.map((field) => [field.id, inferFieldValue(field, question)])
    );
    return payload;
  }

  if (answerKind === "number") {
    payload.freeText = String(inferNumberAnswer(question));
    return payload;
  }

  payload.freeText = inferFreeTextAnswer(question);
  return payload;
}

function answerRecordFromPayloads(structuredAnswers) {
  return Object.fromEntries(structuredAnswers.map((answer) => {
    const fields = answer.fields
      ? Object.entries(answer.fields)
        .filter(([, value]) => String(value).trim().length > 0)
        .map(([key, value]) => `${key}: ${value}`)
      : [];
    const selected = answer.selectedOptionIds && answer.selectedOptionIds.length > 0
      ? answer.selectedOptionIds
      : undefined;
    const freeText = answer.freeText?.trim();
    const combined = [...fields, freeText].filter((value) => Boolean(value));
    if (selected && combined.length === 0) return [answer.questionId, selected];
    if (selected && combined.length > 0) return [answer.questionId, [...selected, ...combined]];
    return [answer.questionId, combined.join("; ") || freeText || ""];
  }));
}

export function buildAnswerMessageForQuestions(questions) {
  const structuredAnswers = questions.map((question) => buildStructuredAnswer(question));
  return {
    type: "user_answer",
    answers: answerRecordFromPayloads(structuredAnswers),
    structuredAnswers
  };
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

let calculateGraphModule;
let schemaModules;

async function loadCalculateGraph() {
  if (!calculateGraphModule) {
    calculateGraphModule = await import("../packages/vdt-core/src/formula/calculate.ts");
  }
  return calculateGraphModule.calculateGraph;
}

async function loadSchemas() {
  if (!schemaModules) {
    const [agentRun, agentMessage] = await Promise.all([
      import("../packages/vdt-agent-runtime/src/schemas/agent-run.ts"),
      import("../packages/vdt-agent-runtime/src/schemas/agent-message.ts")
    ]);
    schemaModules = {
      agentStartRequestSchema: agentRun.agentStartRequestSchema,
      agentUserMessageSchema: agentMessage.agentUserMessageSchema
    };
  }
  return schemaModules;
}

async function validateOutboundStartRequest(request) {
  const { agentStartRequestSchema } = await loadSchemas();
  const parsed = agentStartRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EnvironmentError(`Outbound start request failed schema self-check: ${formatZodIssue(issue ?? { path: [], message: "Invalid agent start request." })}`);
  }
}

async function validateOutboundUserMessage(message) {
  const { agentUserMessageSchema } = await loadSchemas();
  const parsed = agentUserMessageSchema.safeParse(message);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EnvironmentError(`Outbound user message failed schema self-check: ${formatZodIssue(issue ?? { path: [], message: "Invalid agent user message." })}`);
  }
}

async function validateSnapshot(snapshot, options) {
  assert(snapshot.request?.input?.prompt?.includes("I have 5 trucks"), "Original user prompt was not retained in the agent run.");
  const selectedSkillIds = snapshot.selectedSkills?.map((skill) => skill.id) ?? [];
  const expectedSkillId = BINDING_EXPECTED_SKILL[options.binding];
  assert(
    selectedSkillIds.includes(expectedSkillId),
    `Expected ${expectedSkillId}, got ${selectedSkillIds.join(", ") || "none"}.`
  );
  assert(!selectedSkillIds.some((id) => id.startsWith("generic.")), `Generic fallback skill was selected: ${selectedSkillIds.join(", ")}`);
  assert(snapshot.draftProject, "Final snapshot has no draftProject.");
  const nodes = snapshot.draftProject.graph?.nodes ?? [];
  const rootNode = nodes.find((node) => node.id === snapshot.draftProject.rootNodeId);
  assert(rootNode?.formula?.trim(), "Final VDT root node has no formula.");
  const calculateGraph = await loadCalculateGraph();
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
    executionBindingId: options.binding,
    workspace: {
      projectId: "project_haulage_smoke"
    },
    options: {
      researchMode: options.researchMode,
      autoApplyPatches: true,
      maxSteps: 40
    }
  };
}

function isRecoveryRequired(snapshot) {
  return snapshot.status === "recovery_required"
    || snapshot.executionSummary?.sessionStatus === "recovery_required"
    || snapshot.executionSummary?.recoveryStatus === "recovery_required";
}

function isTerminalSnapshot(snapshot) {
  if (TERMINAL_STATUSES.has(snapshot.status)) return true;
  return isRecoveryRequired(snapshot);
}

function harnessFetchHeaders(extraHeaders = {}) {
  return { connection: "close", ...extraHeaders };
}

function isHttpResponseError(error) {
  const message = errorMessage(error);
  return /failed with HTTP \d{3}/.test(message);
}

function transportError(method, url, cause) {
  const error = new Error(`${method} ${url} failed: ${errorMessage(cause)}`);
  error.transportLevel = true;
  return error;
}

function transportExhaustedError(method, url, consecutiveFailures, cause) {
  const error = new Error(
    `${method} ${url} failed after ${consecutiveFailures} consecutive transport error(s): ${errorMessage(cause)}`
  );
  error.transportExhausted = true;
  error.consecutiveTransportFailures = consecutiveFailures;
  return error;
}

async function readJsonResponse(response, method, url) {
  const payload = await response.json().catch(() => undefined);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`${method} ${url} failed with HTTP ${response.status}: ${message}`);
  }
  return payload;
}

async function requestJsonOnce(method, url, { body } = {}) {
  const init = {
    method,
    headers: harnessFetchHeaders(body !== undefined ? { "content-type": "application/json" } : {})
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw transportError(method, url, error);
  }
  return readJsonResponse(response, method, url);
}

async function requestJsonWithTransportRetry(method, url, { body, deadlineMs } = {}) {
  let consecutiveFailures = 0;
  while (true) {
    if (deadlineMs !== undefined && Date.now() > deadlineMs) {
      throw new Error(`${method} ${url} aborted: wall-clock timeout reached during transport retry`);
    }
    try {
      return await requestJsonOnce(method, url, { body });
    } catch (error) {
      if (isHttpResponseError(error)) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= TRANSPORT_RETRY_BUDGET) {
        throw transportExhaustedError(method, url, consecutiveFailures, error);
      }
      const backoffMs = TRANSPORT_RETRY_BACKOFF_MS[consecutiveFailures - 1] ?? 1_000;
      printStep(
        "WARN:",
        "transport retry",
        `${method} ${url}; failure=${consecutiveFailures}/${TRANSPORT_RETRY_BUDGET}; backoffMs=${backoffMs}; error=${errorMessage(error)}`
      );
      await sleep(backoffMs);
    }
  }
}

async function getJson(url, { environmentOnNetwork = true, retryTransport = false, deadlineMs } = {}) {
  try {
    if (retryTransport) {
      return await requestJsonWithTransportRetry("GET", url, { deadlineMs });
    }
    return await requestJsonOnce("GET", url);
  } catch (error) {
    if (environmentOnNetwork) {
      throw new EnvironmentError(errorMessage(error));
    }
    throw error;
  }
}

async function postJson(url, body, { environmentOnNetwork = true, retryTransport = false, deadlineMs } = {}) {
  try {
    if (retryTransport) {
      return await requestJsonWithTransportRetry("POST", url, { body, deadlineMs });
    }
    return await requestJsonOnce("POST", url, { body });
  } catch (error) {
    if (environmentOnNetwork) {
      throw new EnvironmentError(errorMessage(error));
    }
    throw error;
  }
}

function claudeCliOnPath() {
  const probe = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  return probe.error?.code !== "ENOENT";
}

function throwClaudeCliNotDetected() {
  throw new EnvironmentError(CLAUDE_CLI_NOT_DETECTED_MESSAGE);
}

export async function preflight(baseUrl, binding) {
  let payload;
  try {
    payload = await getJson(`${baseUrl}/api/agent/runs`);
  } catch (error) {
    if (binding === CLAUDE_SESSION_BINDING && !claudeCliOnPath()) {
      throwClaudeCliNotDetected();
    }
    throw new EnvironmentError(errorMessage(error));
  }
  const bindingIds = (payload.bindings ?? []).map((entry) => entry.bindingId);
  if (!bindingIds.includes(binding)) {
    if (binding === CLAUDE_SESSION_BINDING) {
      throwClaudeCliNotDetected();
    }
    throw new EnvironmentError(
      [
        `Requested binding "${binding}" is absent from GET /api/agent/runs bindings[].`,
        `Available bindings: ${bindingIds.join(", ") || "none"}.`,
        "This usually means VDT_CLI_SESSION_CANARY_ENABLED=true was not set on the dev-server process.",
        "Set the flag on the server (Terminal 1: VDT_CLI_SESSION_CANARY_ENABLED=true pnpm dev), not on this harness shell."
      ].join("\n")
    );
  }
  printStep("PASS", "preflight", `binding=${binding}; available=${bindingIds.join(", ")}`);
}

function tallyEvents(events) {
  const list = events ?? [];
  return {
    assistant_message: list.filter((event) => event.type === "assistant_message").length,
    transport_error: list.filter((event) =>
      event.type === "error" && (
        String(event.metadata?.code ?? "").includes("TRANSPORT")
        || /transport/i.test(event.title ?? "")
        || /transport/i.test(event.message ?? "")
      )
    ).length,
    checkpoint: list.filter((event) => event.type === "checkpoint").length,
    checkpoint_engine_exchange: list.filter((event) =>
      event.type === "checkpoint" && event.payload?.reason === "engine_exchange"
    ).length,
    native_web_search: list.filter((event) =>
      event.metadata?.code === "NATIVE_WEB_SEARCH" || event.title === "Native web search"
    ).length
  };
}

function collectNativeWebSearchEvidence(snapshot) {
  const events = snapshot?.events ?? [];
  const chat = snapshot?.chatMessages ?? [];
  const searchEvents = events.filter((event) =>
    event.metadata?.code === "NATIVE_WEB_SEARCH" || event.title === "Native web search"
  );
  const searchChat = chat.filter((message) =>
    /Native web search used/i.test(message.text ?? "")
  );
  const queries = [];
  for (const item of [...searchEvents, ...searchChat]) {
    const text = String(item.message ?? item.text ?? "");
    for (const match of text.matchAll(/"([^"]{1,160})"/g)) {
      if (match[1] && !queries.includes(match[1])) queries.push(match[1]);
    }
  }
  const publicStatus = snapshot?.publicStatus?.message ?? "";
  return {
    eventCount: searchEvents.length,
    chatCount: searchChat.length,
    queries,
    publicStatusMentionsSearch: /Native web search used/i.test(publicStatus)
  };
}

function checkpointEngineExchangeKey(event) {
  return event.payload?.checkpointId
    ?? event.payload?.stableCallKey
    ?? event.metadata?.eventV2Id
    ?? event.id
    ?? null;
}

function collectMetricsFromSqlite(sqlitePath, runId) {
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const cliSegmentCount = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT stable_call_key
      FROM agent_engine_exchange_receipts_v2
      WHERE run_id = ? AND state = 'completed'
      GROUP BY stable_call_key
    )
  `).get(runId)?.count ?? 0;
  const sessionBindingCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM agent_session_bindings_v2
    WHERE run_id = ?
  `).get(runId)?.count ?? 0;
  return {
    cliSegmentCount,
    sessionBindingCount,
    source: "sqlite"
  };
}

function collectMetricsHttpFallback(snapshot) {
  const events = snapshot.events ?? [];
  const seen = new Set();
  for (const event of events) {
    if (event.type !== "checkpoint" || event.payload?.reason !== "engine_exchange") continue;
    const key = checkpointEngineExchangeKey(event);
    if (key) seen.add(key);
  }
  return {
    cliSegmentCount: seen.size,
    sessionBindingCount: null,
    source: "http_fallback"
  };
}

function collectSpawnMetrics(options, runId, snapshot) {
  if (existsSync(options.sqlitePath)) {
    try {
      return collectMetricsFromSqlite(options.sqlitePath, runId);
    } catch (error) {
      printStep("WARN:", "sqlite metrics", `${errorMessage(error)}; falling back to HTTP event approximation`);
    }
  } else {
    printStep("WARN:", "sqlite metrics", `${options.sqlitePath} not found; using HTTP event approximation`);
  }
  return collectMetricsHttpFallback(snapshot);
}

async function collectSpawnMetricsWithSettle(options, runId, snapshot, pollSnapshotFn) {
  await sleep(METRICS_SETTLE_MS);
  let settledSnapshot = snapshot;
  if (pollSnapshotFn) {
    try {
      settledSnapshot = await pollSnapshotFn();
    } catch {
      // Keep the last in-loop snapshot when the post-terminal refresh fails.
    }
  }
  const first = collectSpawnMetrics(options, runId, settledSnapshot);
  await sleep(300);
  const second = collectSpawnMetrics(options, runId, settledSnapshot);
  return {
    metrics: second.cliSegmentCount >= first.cliSegmentCount ? second : first,
    snapshot: settledSnapshot
  };
}

function classifyOutcome({
  snapshot,
  metrics,
  exitReason,
  graphValidationPassed
}) {
  const segments = metrics.cliSegmentCount ?? 0;

  if (exitReason === "no_auto_answer") return "probe_mode";
  if (exitReason === "waiting_approval") return segments >= 1 ? "partial_progress" : "protocol_blocked";
  if (exitReason === "retryable_error") return segments >= 1 ? "partial_progress" : "protocol_blocked";
  if (exitReason === "http_error" || exitReason === "transport_error_exhausted") {
    return segments >= 1 ? "partial_progress" : "protocol_blocked";
  }
  if (exitReason === "timeout") return segments >= 1 ? "partial_progress" : "protocol_blocked";
  if (exitReason === "max_answer_rounds") return segments >= 1 ? "partial_progress" : "protocol_blocked";
  if (exitReason === "needs_user_input_without_questions") return segments >= 1 ? "partial_progress" : "protocol_blocked";

  if (snapshot.status === "succeeded") {
    if (graphValidationPassed === false) return "partial_progress";
    return "full_success";
  }
  if (isRecoveryRequired(snapshot)) {
    return segments >= 1 ? "partial_progress" : "protocol_blocked";
  }
  if (snapshot.status === "failed" || snapshot.status === "cancelled") {
    return "protocol_blocked";
  }
  if (snapshot.status === "needs_user_input") {
    return segments >= 1 ? "partial_progress" : "protocol_blocked";
  }
  if (snapshot.status === "waiting_approval") {
    return segments >= 1 ? "partial_progress" : "protocol_blocked";
  }
  return "protocol_blocked";
}

function determineExitCode(outcome) {
  return outcome === "full_success" ? 0 : 1;
}

function printEvidenceSummary({
  snapshot,
  metrics,
  eventTallies,
  outcome,
  exitReason,
  exitError,
  consecutiveTransportFailures,
  graphValidationPassed,
  answerRounds,
  wallClockMs,
  runId,
  binding
}) {
  const fields = [
    `outcomeClass=${outcome}`,
    `exitReason=${exitReason ?? "terminal"}`,
    `terminalStatus=${snapshot?.status ?? "n/a"}`,
    `sessionStatus=${snapshot?.executionSummary?.sessionStatus ?? "n/a"}`,
    `recoveryStatus=${snapshot?.executionSummary?.recoveryStatus ?? "n/a"}`,
    `cliSegmentCount=${metrics.cliSegmentCount}${metrics.source === "http_fallback" ? " (approximate)" : ""}`,
    `sessionBindingCount=${metrics.sessionBindingCount ?? "n/a"}`,
    `sessionEpoch=${snapshot?.executionSummary?.sessionEpoch ?? "n/a"}`,
    `metricsSource=${metrics.source}`,
    `answerRounds=${answerRounds}`,
    `wallClockMs=${wallClockMs}`
  ];
  if (runId) fields.push(`runId=${runId}`);
  if (binding) fields.push(`binding=${binding}`);
  if (snapshot?.retryableError) {
    fields.push(`retryableErrorCode=${snapshot.retryableError.code ?? "n/a"}`);
    fields.push(`retryableErrorMessage=${snapshot.retryableError.message ?? "n/a"}`);
  }
  if (exitError) fields.push(`exitError=${exitError}`);
  if (consecutiveTransportFailures != null) {
    fields.push(`consecutiveTransportFailures=${consecutiveTransportFailures}`);
  }
  fields.push(`graphValidation=${graphValidationPassed === null ? "skipped" : graphValidationPassed ? "pass" : "fail"}`);
  fields.push(`events.assistant_message=${eventTallies.assistant_message}`);
  fields.push(`events.transport_error=${eventTallies.transport_error}`);
  fields.push(`events.checkpoint=${eventTallies.checkpoint}`);
  fields.push(`events.checkpoint_engine_exchange=${eventTallies.checkpoint_engine_exchange}`);
  fields.push(`events.native_web_search=${eventTallies.native_web_search}`);
  const nativeWebSearch = collectNativeWebSearchEvidence(snapshot);
  fields.push(`nativeWebSearch.chat=${nativeWebSearch.chatCount}`);
  fields.push(`nativeWebSearch.publicStatus=${nativeWebSearch.publicStatusMentionsSearch}`);
  if (nativeWebSearch.queries.length > 0) {
    fields.push(`nativeWebSearch.queries=${JSON.stringify(nativeWebSearch.queries)}`);
  }

  printStep("INFO", "evidence summary", fields.join("; "));

  if (metrics.source === "http_fallback") {
    printStep("WARN:", "cliSegmentCount is approximate (HTTP fallback, may over-count)");
  }
}

async function pollSnapshot(baseUrl, runId, deadlineMs) {
  const payload = await getJson(
    `${baseUrl}/api/agent/runs/${encodeURIComponent(runId)}`,
    { environmentOnNetwork: false, retryTransport: true, deadlineMs }
  );
  return payload.snapshot;
}

async function finalizeRunEvidence({
  options,
  runId,
  snapshot,
  exitReason,
  exitError,
  consecutiveTransportFailures,
  answerRounds,
  wallClockMs,
  pollSnapshotFn
}) {
  const { metrics, snapshot: settledSnapshot } = await collectSpawnMetricsWithSettle(
    options,
    runId,
    snapshot,
    pollSnapshotFn
  );
  const eventTallies = tallyEvents(settledSnapshot.events);

  let graphValidationPassed = null;
  if (options.validateGraph && settledSnapshot.status === "succeeded") {
    try {
      await validateSnapshot(settledSnapshot, options);
      graphValidationPassed = true;
      printStep("PASS", "graph validation", `nodes=${settledSnapshot.draftProject.graph.nodes.length}`);
    } catch (error) {
      graphValidationPassed = false;
      printStep("FAIL", "graph validation", errorMessage(error));
    }
  }

  const outcome = classifyOutcome({
    snapshot: settledSnapshot,
    metrics,
    exitReason,
    graphValidationPassed
  });
  const exitCode = determineExitCode(outcome);

  printEvidenceSummary({
    snapshot: settledSnapshot,
    metrics,
    eventTallies,
    outcome,
    exitReason,
    exitError,
    consecutiveTransportFailures,
    graphValidationPassed,
    answerRounds,
    wallClockMs,
    runId,
    binding: options.binding
  });

  if (exitCode === 0) {
    printStep("PASS", "checkpoint session smoke", `runId=${runId}; binding=${options.binding}`);
  } else {
    const detail = exitReason
      ? exitReason
      : graphValidationPassed === false
        ? "graph_validation_failed"
        : settledSnapshot.status;
    printStep("FAIL", "checkpoint session smoke", `runId=${runId}; ${detail}`);
  }

  return exitCode;
}

async function runCheckpointSmoke(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  await preflight(baseUrl, options.binding);

  const request = createStartRequest(options);
  await validateOutboundStartRequest(request);

  printStep("RUN", "start checkpoint session run", `${baseUrl}/api/agent/runs binding=${options.binding}`);
  let started;
  try {
    started = await postJson(`${baseUrl}/api/agent/runs`, request);
  } catch (error) {
    throw new EnvironmentError(errorMessage(error));
  }
  const runId = started.runId ?? started.snapshot?.runId;
  assert(runId, "Start response did not include runId.");

  const startedAt = Date.now();
  const runDeadlineMs = () => startedAt + options.timeoutMs;
  let answerRounds = 0;
  let exitReason = null;
  let exitError = null;
  let consecutiveTransportFailures = null;
  let snapshot = started.snapshot;
  const poll = () => pollSnapshot(baseUrl, runId, runDeadlineMs());
  printStep("INFO", "start result", `runId=${runId}; status=${snapshot.status}`);

  while (true) {
    try {
      if (Date.now() > runDeadlineMs()) {
        exitReason = "timeout";
        try {
          snapshot = await poll();
        } catch (error) {
          exitError = errorMessage(error);
          consecutiveTransportFailures = error.consecutiveTransportFailures ?? consecutiveTransportFailures;
        }
        break;
      }

      if (snapshot.status === "waiting_approval") {
        exitReason = "waiting_approval";
        break;
      }

      if (snapshot.status === "needs_user_input") {
        if (!options.autoAnswer) {
          exitReason = "no_auto_answer";
          break;
        }
        if (answerRounds >= options.maxAnswerRounds) {
          exitReason = "max_answer_rounds";
          break;
        }
        const questions = snapshot.pendingQuestions ?? [];
        if (questions.length === 0) {
          if (snapshot.retryableError) {
            exitReason = "retryable_error";
            break;
          }
          exitReason = "needs_user_input_without_questions";
          break;
        }
        const answerMessage = buildAnswerMessageForQuestions(questions);
        await validateOutboundUserMessage(answerMessage);
        answerRounds += 1;
        printStep(
          "RUN",
          `answer clarification round ${answerRounds}`,
          answerMessage.structuredAnswers.map((answer) => answer.questionId).join(", ")
        );
        const resumed = await postJson(
          `${baseUrl}/api/agent/runs/${encodeURIComponent(runId)}/messages`,
          answerMessage,
          { environmentOnNetwork: false, retryTransport: true, deadlineMs: runDeadlineMs() }
        );
        snapshot = resumed.snapshot;
        printStep("INFO", `round ${answerRounds} result`, `status=${snapshot.status}`);
        if (isTerminalSnapshot(snapshot)) break;
        continue;
      }

      if (isTerminalSnapshot(snapshot)) break;

      await sleep(options.pollIntervalMs);
      snapshot = await poll();
    } catch (error) {
      exitReason = error.transportExhausted ? "transport_error_exhausted" : "http_error";
      exitError = errorMessage(error);
      consecutiveTransportFailures = error.consecutiveTransportFailures ?? null;
      break;
    }
  }

  const wallClockMs = Date.now() - startedAt;
  return finalizeRunEvidence({
    options,
    runId,
    snapshot,
    exitReason,
    exitError,
    consecutiveTransportFailures,
    answerRounds,
    wallClockMs,
    pollSnapshotFn: poll
  });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parseArgs(argv);
  const exitCode = await runCheckpointSmoke(options);
  if (exitCode !== 0) process.exit(exitCode);
}

const executedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (executedDirectly) {
  main().catch((error) => {
    const detail = errorMessage(error);
    printEnvironmentEvidence(detail);
    if (error instanceof EnvironmentError) {
      process.stderr.write(`live-cli-session-checkpoint-smoke environment error: ${detail}\n`);
      process.exit(2);
    }
    process.stderr.write(`live-cli-session-checkpoint-smoke failed: ${detail}\n`);
    process.exit(1);
  });
}
