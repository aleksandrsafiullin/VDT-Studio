#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateGraph, validateGraph } from "../packages/vdt-core/src/index.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
export const DEFAULT_FIXTURE_PATH = resolve(SCRIPT_DIR, "fixtures/ore-hauled-two-fleet.v1.json");
export const DEFAULT_FIXTURE_HASH = "sha256:c116319d9ba1a8d6b95c0846b20314cd50dac900bb9853ac3316a50bf4e2edc0";

const RECORD_TYPE = "vdt_agent_build_benchmark_run";
const REPORT_TYPE = "vdt_agent_build_benchmark_report";
const TERMINAL_OR_STOPPED_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "needs_user_input",
  "waiting_approval",
  "recovery_required"
]);
const VALID_PROFILES = new Set(["external_cli_agent", "model_agent"]);
const VALID_SAMPLE_TEMPERATURES = new Set(["cold", "warm"]);
const FORBIDDEN_METRICS_KEYS = new Set([
  "prompt",
  "rawprompt",
  "systemprompt",
  "userprompt",
  "request",
  "requestbody",
  "response",
  "responsebody",
  "raw",
  "input",
  "output",
  "result",
  "payload",
  "body",
  "headers",
  "environment",
  "env",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "password",
  "credential",
  "database",
  "dbpath",
  "snapshot",
  "events",
  "messages",
  "graph",
  "project",
  "content"
]);
const SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/giu,
  /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9._-]{8,}\b/giu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/giu
];
const KNOWN_DISQUALIFYING_FAILURES = [
  "MAX_STEPS_EXCEEDED",
  "ENUM_FIELD_MISMATCH",
  "FORMULA_PARSE_ERROR",
  "UNSUPPORTED_TOKEN"
];
const REQUIRED_TELEMETRY_PATHS = [
  "timing.elapsedWallMs",
  "timing.activeWallMs",
  "timing.timeToFirstEventMs",
  "timing.timeToFirstDurableAgentMessageMs",
  "timing.modelMs",
  "timing.toolMs",
  "timing.gatewayMs",
  "timing.persistenceMs",
  "counts.processSpawns",
  "counts.logicalSessions",
  "counts.resumes",
  "counts.modelTurns",
  "counts.toolCalls",
  "counts.failures",
  "counts.corrections",
  "counts.pauses",
  "counts.approvals",
  "counts.recoveries",
  "bytes.contextInputBytes",
  "bytes.promptBytes",
  "bytes.streamBytes",
  "bytes.structuredOutputBytes",
  "bytes.toolResultBytes",
  "bytes.finalSnapshotBytes"
];
const AGGREGATED_METRICS = [
  "timing.elapsedWallMs",
  "timing.activeWallMs",
  "timing.timeToFirstEventMs",
  "timing.timeToFirstDurableAgentMessageMs",
  "timing.modelMs",
  "timing.toolMs",
  "timing.gatewayMs",
  "timing.persistenceMs",
  "counts.processSpawns",
  "counts.logicalSessions",
  "counts.resumes",
  "counts.modelTurns",
  "counts.toolCalls",
  "counts.failures",
  "counts.corrections",
  "counts.pauses",
  "counts.approvals",
  "counts.recoveries",
  "bytes.contextInputBytes",
  "bytes.promptBytes",
  "bytes.streamBytes",
  "bytes.structuredOutputBytes",
  "bytes.toolResultBytes",
  "bytes.finalSnapshotBytes",
  "bytes.httpResponseBytes",
  "usage.inputTokens",
  "usage.cachedInputTokens",
  "usage.outputTokens",
  "usage.totalTokens"
];

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  const input = typeof value === "string" ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function computeFixtureHash(fixture) {
  return sha256(fixture);
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function containsSecret(text) {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function redactSensitiveText(value) {
  let result = String(value);
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Benchmark artifacts are deliberately narrower than runtime snapshots. This
 * guard fails if a future edit accidentally serializes prompts, messages,
 * projects, credentials, or raw provider content into an artifact.
 */
export function assertMetricsOnly(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMetricsOnly(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && containsSecret(value)) {
      fail(`Sensitive value is not allowed in benchmark output at ${path}.`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_METRICS_KEYS.has(normalizeKey(key))) {
      fail(`Raw or sensitive field "${key}" is not allowed in benchmark output at ${path}.`);
    }
    assertMetricsOnly(entry, `${path}.${key}`);
  }
}

function requireExactKeys(value, keys, path) {
  if (!isRecord(value)) fail(`${path} must be an object.`);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail(`${path}.${key} is not a supported benchmark field.`);
  }
  for (const key of keys) {
    if (!(key in value)) fail(`${path}.${key} is required.`);
  }
}

function requireString(value, path, { max = 200, pattern } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(`${path} must be a non-empty string up to ${max} characters.`);
  }
  if (containsSecret(value)) fail(`${path} looks like a credential and is not allowed.`);
  if (pattern && !pattern.test(value)) fail(`${path} has an invalid format.`);
}

function requireTimestamp(value, path) {
  requireString(value, path, { max: 64 });
  if (!Number.isFinite(Date.parse(value))) fail(`${path} must be an ISO timestamp.`);
}

function requireNumberOrNull(value, path, { integer = false } = {}) {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    fail(`${path} must be a non-negative${integer ? " integer" : " number"} or null.`);
  }
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") fail(`${path} must be a boolean.`);
}

function safeLabel(value, path) {
  requireString(value, path, { max: 200, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u });
  return value;
}

function safeDisplayLabel(value, path) {
  requireString(value, path, { max: 200, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/@()+ -]*$/u });
  return value;
}

function safeCode(value, fallback = "UNCLASSIFIED") {
  if (typeof value !== "string" || containsSecret(value)) return fallback;
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9_.:-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return code.slice(0, 120) || fallback;
}

export async function loadBenchmarkFixture(path = DEFAULT_FIXTURE_PATH) {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  validateFixture(fixture);
  if (resolve(path) === DEFAULT_FIXTURE_PATH && computeFixtureHash(fixture) !== DEFAULT_FIXTURE_HASH) {
    fail("The pinned Ore hauled benchmark fixture hash changed; create a new version instead of mutating v1.");
  }
  return fixture;
}

function validateFixture(fixture) {
  if (!isRecord(fixture) || fixture.schemaVersion !== 1) fail("Benchmark fixture must use schemaVersion 1.");
  safeLabel(fixture.id, "fixture.id");
  safeLabel(fixture.version, "fixture.version");
  if (!isRecord(fixture.startRequest) || fixture.startRequest.mode !== "continue_project") {
    fail("Benchmark fixture must contain a continue_project startRequest.");
  }
  if (!isRecord(fixture.startRequest.input) || !isRecord(fixture.startRequest.input.project)) {
    fail("Benchmark fixture must include its sanitized starting project.");
  }
  if (!isRecord(fixture.acceptance)) fail("Benchmark fixture acceptance contract is required.");
  if (fixture.acceptance.rootNodeType !== "root_kpi") {
    fail("Benchmark fixture acceptance.rootNodeType must be root_kpi.");
  }
  for (const key of ["nodeCount", "edgeCount", "depth", "maxElapsedWallMs", "stretchMedianWallMs"]) {
    requireNumberOrNull(fixture.acceptance[key], `fixture.acceptance.${key}`, { integer: true });
    if (fixture.acceptance[key] === null) fail(`fixture.acceptance.${key} cannot be null.`);
  }
  if (!Array.isArray(fixture.acceptance.requiredFleetLabels) || fixture.acceptance.requiredFleetLabels.length !== 2) {
    fail("Benchmark fixture must define exactly two requiredFleetLabels.");
  }
}

export function validateBenchmarkRecord(record) {
  requireExactKeys(record, [
    "schemaVersion",
    "recordType",
    "capturedAt",
    "runIdHash",
    "fixture",
    "sample",
    "execution",
    "timing",
    "counts",
    "bytes",
    "outcome",
    "usage",
    "diagnostics",
    "provenance"
  ], "record");
  if (record.schemaVersion !== 1 || record.recordType !== RECORD_TYPE) fail("Unsupported benchmark record schema.");
  requireTimestamp(record.capturedAt, "record.capturedAt");
  requireString(record.runIdHash, "record.runIdHash", { max: 71, pattern: /^sha256:[a-f0-9]{64}$/u });

  requireExactKeys(record.fixture, ["id", "version", "hash"], "record.fixture");
  safeLabel(record.fixture.id, "record.fixture.id");
  safeLabel(record.fixture.version, "record.fixture.version");
  requireString(record.fixture.hash, "record.fixture.hash", { max: 71, pattern: /^sha256:[a-f0-9]{64}$/u });

  requireExactKeys(record.sample, ["temperature", "ordinal"], "record.sample");
  if (!VALID_SAMPLE_TEMPERATURES.has(record.sample.temperature)) fail("record.sample.temperature must be cold or warm.");
  requireNumberOrNull(record.sample.ordinal, "record.sample.ordinal", { integer: true });
  if (record.sample.ordinal === null || record.sample.ordinal < 1) fail("record.sample.ordinal must be positive.");

  requireExactKeys(record.execution, [
    "profile",
    "adapter",
    "backend",
    "model",
    "version",
    "protocolVersion",
    "toolIsolation",
    "qualificationStatus",
    "capabilityEvidenceHash",
    "capabilityProfileHash",
    "toolCatalogHash"
  ], "record.execution");
  if (!VALID_PROFILES.has(record.execution.profile)) fail("record.execution.profile is invalid.");
  for (const key of ["adapter", "backend"]) safeLabel(record.execution[key], `record.execution.${key}`);
  for (const key of ["model", "version"]) safeDisplayLabel(record.execution[key], `record.execution.${key}`);
  if (record.execution.protocolVersion !== null) {
    safeDisplayLabel(record.execution.protocolVersion, "record.execution.protocolVersion");
  }
  if (!["unverified", "permission_only", "hard_verified"].includes(record.execution.toolIsolation)) {
    fail("record.execution.toolIsolation is invalid.");
  }
  if (!["unverified", "qualified", "rejected", "revoked"].includes(record.execution.qualificationStatus)) {
    fail("record.execution.qualificationStatus is invalid.");
  }
  for (const key of ["capabilityEvidenceHash", "capabilityProfileHash", "toolCatalogHash"]) {
    if (record.execution[key] !== null) {
      requireString(record.execution[key], `record.execution.${key}`, {
        max: 71,
        pattern: /^sha256:[a-f0-9]{64}$/u
      });
    }
  }

  requireExactKeys(record.timing, [
    "elapsedWallMs",
    "activeWallMs",
    "timeToFirstEventMs",
    "timeToFirstDurableAgentMessageMs",
    "modelMs",
    "toolMs",
    "gatewayMs",
    "persistenceMs"
  ], "record.timing");
  for (const [key, value] of Object.entries(record.timing)) requireNumberOrNull(value, `record.timing.${key}`);

  requireExactKeys(record.counts, [
    "processSpawns",
    "logicalSessions",
    "resumes",
    "modelTurns",
    "toolCalls",
    "failures",
    "corrections",
    "pauses",
    "approvals",
    "recoveries"
  ], "record.counts");
  for (const [key, value] of Object.entries(record.counts)) requireNumberOrNull(value, `record.counts.${key}`, { integer: true });

  requireExactKeys(record.bytes, [
    "contextInputBytes",
    "promptBytes",
    "streamBytes",
    "structuredOutputBytes",
    "toolResultBytes",
    "finalSnapshotBytes",
    "httpResponseBytes"
  ], "record.bytes");
  for (const [key, value] of Object.entries(record.bytes)) requireNumberOrNull(value, `record.bytes.${key}`, { integer: true });

  requireExactKeys(record.outcome, [
    "terminalStatus",
    "valid",
    "calculable",
    "formulaBacklogCount",
    "finiteRoot",
    "topology"
  ], "record.outcome");
  safeLabel(record.outcome.terminalStatus, "record.outcome.terminalStatus");
  for (const key of ["valid", "calculable", "finiteRoot"]) requireBoolean(record.outcome[key], `record.outcome.${key}`);
  requireNumberOrNull(record.outcome.formulaBacklogCount, "record.outcome.formulaBacklogCount", { integer: true });
  requireExactKeys(record.outcome.topology, [
    "nodeCount",
    "edgeCount",
    "depth",
    "rootMatchesFixture",
    "requiredFleetLabelsPresent",
    "twoFleetBranchShapeMatches",
    "matchesFixture"
  ], "record.outcome.topology");
  for (const key of ["nodeCount", "edgeCount", "depth"]) {
    requireNumberOrNull(record.outcome.topology[key], `record.outcome.topology.${key}`, { integer: true });
  }
  for (const key of ["rootMatchesFixture", "requiredFleetLabelsPresent", "twoFleetBranchShapeMatches", "matchesFixture"]) {
    requireBoolean(record.outcome.topology[key], `record.outcome.topology.${key}`);
  }

  if (record.usage !== null) {
    requireExactKeys(record.usage, ["inputTokens", "cachedInputTokens", "outputTokens", "totalTokens"], "record.usage");
    for (const [key, value] of Object.entries(record.usage)) requireNumberOrNull(value, `record.usage.${key}`, { integer: true });
  }

  requireExactKeys(record.diagnostics, ["failureCodes", "correctionCodes"], "record.diagnostics");
  for (const key of ["failureCodes", "correctionCodes"]) {
    if (!Array.isArray(record.diagnostics[key])) fail(`record.diagnostics.${key} must be an array.`);
    for (const value of record.diagnostics[key]) safeLabel(value, `record.diagnostics.${key}[]`);
  }

  requireExactKeys(record.provenance, ["timingSource", "executionIdentitySource", "transportMode", "completeEventRangeObserved", "derivedFields"], "record.provenance");
  safeLabel(record.provenance.timingSource, "record.provenance.timingSource");
  safeLabel(record.provenance.executionIdentitySource, "record.provenance.executionIdentitySource");
  safeLabel(record.provenance.transportMode, "record.provenance.transportMode");
  requireBoolean(record.provenance.completeEventRangeObserved, "record.provenance.completeEventRangeObserved");
  if (!Array.isArray(record.provenance.derivedFields)) fail("record.provenance.derivedFields must be an array.");
  for (const field of record.provenance.derivedFields) {
    requireString(field, "record.provenance.derivedFields[]", { max: 120, pattern: /^[A-Za-z][A-Za-z0-9.]*$/u });
  }

  if (record.provenance.executionIdentitySource === "legacy_request_echo") {
    if (record.execution.profile !== "model_agent"
      || record.execution.adapter !== "micro_cli_compatibility"
      || record.execution.protocolVersion !== null
      || record.execution.capabilityEvidenceHash !== null
      || record.execution.capabilityProfileHash !== null
      || record.execution.toolCatalogHash !== null) {
      fail("Legacy request-echo identity is restricted to the Model Agent micro-CLI compatibility baseline.");
    }
  } else if (record.provenance.executionIdentitySource === "runtime_binding_evidence") {
    if (record.execution.protocolVersion === null
      || record.execution.capabilityEvidenceHash === null
      || record.execution.capabilityProfileHash === null
      || record.execution.toolCatalogHash === null
      || record.execution.qualificationStatus !== "qualified"
      || (record.execution.profile === "external_cli_agent" && record.execution.toolIsolation !== "hard_verified")) {
      fail("Runtime binding identity is missing qualified immutable capability evidence.");
    }
  } else {
    fail("record.provenance.executionIdentitySource is invalid.");
  }

  assertMetricsOnly(record);
  return record;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteInteger(value) {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => isRecord(current) ? current[key] : undefined, value);
}

function firstMetric(objects, paths, { integer = false } = {}) {
  for (const object of objects) {
    for (const path of paths) {
      const value = valueAtPath(object, path);
      const normalized = integer ? finiteInteger(value) : finiteNumber(value);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

function validTimestampMs(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedBetween(start, end) {
  const startMs = validTimestampMs(start);
  const endMs = validTimestampMs(end);
  return startMs === null || endMs === null ? null : Math.max(0, endMs - startMs);
}

function eventTimestamp(event) {
  return validTimestampMs(event?.timestamp ?? event?.createdAt);
}

function allRuntimeEvents(snapshot) {
  const candidates = [snapshot.agentRunEventsV2, snapshot.eventsV2, snapshot.events];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function completeEventRangeObserved(snapshot, events) {
  const explicit = snapshot.performanceSummary?.completeEventRangeObserved
    ?? snapshot.performanceTelemetry?.completeEventRangeObserved
    ?? snapshot.telemetry?.completeEventRangeObserved;
  if (explicit === true) return true;
  if (events.length === 0) return false;
  const sequences = events.map((event) => event.seq);
  if (!sequences.every((value) => Number.isInteger(value) && value > 0)) return false;
  if (sequences[0] !== 1 || sequences.some((value, index) => value !== index + 1)) return false;
  const terminalEvent = events.at(-1);
  if (["run_completed", "final"].includes(terminalEvent?.type)) return true;
  if (["failed", "cancelled"].includes(snapshot.status) && terminalEvent?.type === "error") return true;
  if (terminalEvent?.type !== "runtime_status") return false;
  const runtimeTerminal = String(terminalEvent.payload?.state ?? terminalEvent.payload?.code ?? "").toLowerCase();
  return ["succeeded", "failed", "cancelled", "run_completed", "run_complete"].includes(runtimeTerminal);
}

function firstEventElapsed(snapshot, events) {
  const createdAt = validTimestampMs(snapshot.createdAt);
  const first = events.map(eventTimestamp).filter((value) => value !== null).sort((left, right) => left - right)[0];
  return createdAt === null || first === undefined ? null : Math.max(0, first - createdAt);
}

function firstDurableAgentMessageElapsed(snapshot, events) {
  const createdAt = validTimestampMs(snapshot.createdAt);
  if (createdAt === null) return null;
  const eventTimes = events
    .filter((event) => event.type === "assistant_message" && ["external_agent", "vdt_agent", undefined].includes(event.source))
    .map(eventTimestamp)
    .filter((value) => value !== null);
  const chatTimes = (Array.isArray(snapshot.chatMessages) ? snapshot.chatMessages : [])
    .filter((message) => isRecord(message) && message.role === "assistant" && message.kind === "assistant_message")
    .map((message) => validTimestampMs(message.createdAt))
    .filter((value) => value !== null);
  const first = [...eventTimes, ...chatTimes].sort((left, right) => left - right)[0];
  return first === undefined ? null : Math.max(0, first - createdAt);
}

function sumSpans(snapshot, names) {
  const spans = [
    snapshot.performanceTelemetry?.spans,
    snapshot.performanceSummary?.spans,
    snapshot.telemetry?.spans
  ].find(Array.isArray);
  if (!Array.isArray(spans)) return null;
  const accepted = new Set(names);
  let total = 0;
  let seen = false;
  for (const span of spans) {
    if (!isRecord(span)) continue;
    const kind = String(span.kind ?? span.category ?? span.name ?? "").toLowerCase();
    const duration = finiteNumber(span.durationMs ?? span.elapsedMs);
    if (accepted.has(kind) && duration !== null) {
      seen = true;
      total += duration;
    }
  }
  return seen ? total : null;
}

function pairedLegacyDuration(events, kind) {
  const started = new Map();
  let total = 0;
  let paired = 0;
  for (const event of events) {
    const timestamp = eventTimestamp(event);
    if (timestamp === null || !isRecord(event.metadata)) continue;
    const taskType = typeof event.metadata.taskType === "string" ? event.metadata.taskType : "";
    const toolName = typeof event.metadata.toolName === "string" ? event.metadata.toolName : "";
    const isModel = taskType === "agent_decision" || taskType === "orchestrator_first_response";
    const matches = kind === "model" ? isModel : !isModel && toolName.length > 0;
    if (!matches) continue;
    const key = kind === "model" ? taskType : toolName;
    if (event.type === "tool_call_started") {
      const queue = started.get(key) ?? [];
      queue.push(timestamp);
      started.set(key, queue);
    } else if (event.type === "tool_call_completed") {
      const queue = started.get(key);
      const start = queue?.shift();
      if (start !== undefined) {
        paired += 1;
        total += Math.max(0, timestamp - start);
      }
    }
  }
  return paired > 0 ? total : null;
}

function graphDepth(project) {
  const nodes = Array.isArray(project?.graph?.nodes) ? project.graph.nodes : [];
  const edges = Array.isArray(project?.graph?.edges) ? project.graph.edges : [];
  const children = new Map();
  for (const edge of edges) {
    if (!isRecord(edge) || typeof edge.sourceNodeId !== "string" || typeof edge.targetNodeId !== "string") continue;
    const list = children.get(edge.sourceNodeId) ?? [];
    list.push(edge.targetNodeId);
    children.set(edge.sourceNodeId, list);
  }
  const rootId = typeof project?.rootNodeId === "string" ? project.rootNodeId : nodes[0]?.id;
  if (typeof rootId !== "string") return 0;
  const queue = [{ id: rootId, depth: 0 }];
  const bestDepth = new Map();
  let maxDepth = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > nodes.length) continue;
    const previous = bestDepth.get(current.id);
    if (previous !== undefined && previous >= current.depth) continue;
    bestDepth.set(current.id, current.depth);
    maxDepth = Math.max(maxDepth, current.depth);
    for (const childId of children.get(current.id) ?? []) queue.push({ id: childId, depth: current.depth + 1 });
  }
  return maxDepth;
}

function formulaBacklogCount(project) {
  const nodes = Array.isArray(project?.graph?.nodes) ? project.graph.nodes : [];
  const edges = Array.isArray(project?.graph?.edges) ? project.graph.edges : [];
  const parentIds = new Set(edges.map((edge) => edge?.sourceNodeId).filter((value) => typeof value === "string"));
  return nodes.filter((node) =>
    isRecord(node)
    && parentIds.has(node.id)
    && (node.type === "root_kpi" || node.type === "calculated")
    && (typeof node.formula !== "string" || node.formula.trim().length === 0)
  ).length;
}

function normalizedNodeText(node) {
  return [node?.id, node?.name, node?.description]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, " ")
    .trim();
}

function topologyResult(project, fixture) {
  const nodes = Array.isArray(project?.graph?.nodes) ? project.graph.nodes : [];
  const edges = Array.isArray(project?.graph?.edges) ? project.graph.edges : [];
  const depth = graphDepth(project);
  const nodeText = nodes.map(normalizedNodeText);
  const labelsPresent = fixture.acceptance.requiredFleetLabels.every((label) => {
    const normalizedLabel = normalizedNodeText({ name: label });
    return nodeText.some((text) => text.includes(normalizedLabel));
  });
  const rootId = typeof project?.rootNodeId === "string" ? project.rootNodeId : fixture.acceptance.rootNodeId;
  const rootNode = nodes.find((node) => node?.id === rootId);
  const rootMatchesFixture = rootId === fixture.acceptance.rootNodeId
    && rootNode?.type === fixture.acceptance.rootNodeType;
  const childrenByParent = new Map();
  for (const edge of edges) {
    if (!isRecord(edge) || typeof edge.sourceNodeId !== "string" || typeof edge.targetNodeId !== "string") continue;
    const children = childrenByParent.get(edge.sourceNodeId) ?? [];
    children.push(edge.targetNodeId);
    childrenByParent.set(edge.sourceNodeId, children);
  }
  const rootChildren = [...new Set(childrenByParent.get(rootId) ?? [])];
  const descendantsIncludingRoot = (branchRootId) => {
    const visited = new Set();
    const queue = [branchRootId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (typeof nodeId !== "string" || visited.has(nodeId)) continue;
      visited.add(nodeId);
      for (const childId of childrenByParent.get(nodeId) ?? []) queue.push(childId);
    }
    return visited;
  };
  const branchSets = rootChildren.map(descendantsIncludingRoot);
  const branchLabelMatches = fixture.acceptance.requiredFleetLabels.map((label) => {
    const normalizedLabel = normalizedNodeText({ name: label });
    return branchSets
      .map((branch, index) => [...branch].some((nodeId) => {
        const node = nodes.find((candidate) => candidate?.id === nodeId);
        return normalizedNodeText(node).includes(normalizedLabel);
      }) ? index : -1)
      .filter((index) => index >= 0);
  });
  const coveredNodeIds = new Set(branchSets.flatMap((branch) => [...branch]));
  const branchSetsDisjoint = branchSets.length === 2
    && [...branchSets[0]].every((nodeId) => !branchSets[1].has(nodeId));
  const twoFleetBranchShapeMatches = rootChildren.length === 2
    && branchSets.every((branch) => branch.size === 36)
    && branchSetsDisjoint
    && coveredNodeIds.size === nodes.length - 1
    && !coveredNodeIds.has(rootId)
    && branchLabelMatches.every((matches) => matches.length === 1)
    && new Set(branchLabelMatches.flat()).size === 2;
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    depth,
    rootMatchesFixture,
    requiredFleetLabelsPresent: labelsPresent,
    twoFleetBranchShapeMatches,
    matchesFixture:
      nodes.length === fixture.acceptance.nodeCount
      && edges.length === fixture.acceptance.edgeCount
      && depth === fixture.acceptance.depth
      && rootMatchesFixture
      && labelsPresent
      && twoFleetBranchShapeMatches
  };
}

function projectOutcome(snapshot, fixture) {
  const project = isRecord(snapshot.project)
    ? snapshot.project
    : isRecord(snapshot.draftProject)
      ? snapshot.draftProject
      : null;
  if (!project) {
    return {
      valid: false,
      calculable: false,
      formulaBacklogCount: null,
      finiteRoot: false,
      topology: {
        nodeCount: 0,
        edgeCount: 0,
        depth: 0,
        rootMatchesFixture: false,
        requiredFleetLabelsPresent: false,
        twoFleetBranchShapeMatches: false,
        matchesFixture: false
      },
      failureCodes: ["PROJECT_MISSING"]
    };
  }

  const failureCodes = [];
  let valid = false;
  let calculable = false;
  let finiteRoot = false;
  try {
    const validation = validateGraph(project);
    valid = validation.valid;
    failureCodes.push(...validation.errors.map((error) => safeCode(error.type, "GRAPH_VALIDATION_ERROR")));
  } catch {
    failureCodes.push("GRAPH_VALIDATION_EXCEPTION");
  }
  try {
    const calculation = calculateGraph(project);
    finiteRoot = typeof calculation.rootValue === "number" && Number.isFinite(calculation.rootValue);
    calculable = calculation.errors.length === 0 && finiteRoot;
    failureCodes.push(...calculation.errors.map((error) => safeCode(error.type, "CALCULATION_ERROR")));
  } catch {
    failureCodes.push("CALCULATION_EXCEPTION");
  }
  return {
    valid,
    calculable,
    formulaBacklogCount: formulaBacklogCount(project),
    finiteRoot,
    topology: topologyResult(project, fixture),
    failureCodes
  };
}

function diagnosticCodes(snapshot, events, projectFailures) {
  const failureCodes = [...projectFailures];
  const correctionCodes = [];
  if (isRecord(snapshot.error)) failureCodes.push(safeCode(snapshot.error.code, "RUN_ERROR"));
  if (isRecord(snapshot.retryableError)) failureCodes.push(safeCode(snapshot.retryableError.code, "RETRYABLE_ERROR"));
  for (const event of events) {
    if (!isRecord(event)) continue;
    const metadata = isRecord(event.metadata) ? event.metadata : {};
    const code = metadata.code ?? event.payload?.code ?? event.payload?.resultCode;
    const failedTool = event.type === "tool_result" && ["failed", "waiting_user", "waiting_approval"].includes(event.payload?.status);
    const legacyFailedTool = event.type === "tool_call_completed" && (metadata.ok === false || metadata.status === "failed");
    if (event.type === "error" || failedTool || legacyFailedTool) failureCodes.push(safeCode(code, "TOOL_OR_RUNTIME_ERROR"));
    if (event.type === "repair_started") correctionCodes.push(safeCode(code, "AGENT_REPAIR"));
  }
  const repairCount = finiteInteger(snapshot.performanceSummary?.repairCount) ?? 0;
  if (repairCount > 0) correctionCodes.push("STRUCTURED_OUTPUT_REPAIR");
  return {
    failureCodes: [...new Set(failureCodes)].sort(),
    correctionCodes: [...new Set(correctionCodes)].sort(),
    repairCount
  };
}

function usageMetrics(snapshot) {
  const usage = snapshot.performanceSummary?.usage ?? snapshot.performanceTelemetry?.usage ?? snapshot.usage;
  if (!isRecord(usage)) return null;
  const result = {
    inputTokens: finiteInteger(usage.inputTokens ?? usage.promptTokens),
    cachedInputTokens: finiteInteger(usage.cachedInputTokens ?? usage.cachedPromptTokens),
    outputTokens: finiteInteger(usage.outputTokens ?? usage.completionTokens),
    totalTokens: finiteInteger(usage.totalTokens)
  };
  return Object.values(result).every((value) => value === null) ? null : result;
}

function resolveExecutionIdentity(snapshot, declared, transportMode) {
  const summary = isRecord(snapshot.executionSummary) ? snapshot.executionSummary : null;
  if (!summary) {
    if (transportMode !== "legacy_provider_config"
      || declared.profile !== "model_agent"
      || declared.adapter !== "micro_cli_compatibility") {
      fail("External or native-session benchmark records require a runtime executionSummary.");
    }
    const requestConfig = isRecord(snapshot.request?.providerConfig) ? snapshot.request.providerConfig : null;
    if (!requestConfig
      || requestConfig.backendId !== declared.backend
      || requestConfig.model !== declared.model) {
      fail("Legacy benchmark execution identity does not match the durable request echo.");
    }
    return {
      execution: {
        ...declared,
        protocolVersion: null,
        toolIsolation: "unverified",
        qualificationStatus: "unverified",
        capabilityEvidenceHash: null,
        capabilityProfileHash: null,
        toolCatalogHash: null
      },
      source: "legacy_request_echo"
    };
  }
  const protocolVersion = summary.protocolVersion;
  const cliVersion = summary.cliVersion;
  const capabilityEvidenceHash = summary.capabilityEvidenceHash ?? null;
  const capabilityProfileHash = summary.capabilityProfileHash ?? null;
  const toolCatalogHash = summary.toolCatalogHash ?? null;
  const toolIsolation = summary.toolIsolation ?? null;
  const qualificationStatus = summary.qualificationStatus ?? null;
  if (typeof protocolVersion !== "string"
    || !/^sha256:[a-f0-9]{64}$/u.test(capabilityEvidenceHash)
    || !/^sha256:[a-f0-9]{64}$/u.test(capabilityProfileHash)
    || !/^sha256:[a-f0-9]{64}$/u.test(toolCatalogHash)
    || !["unverified", "permission_only", "hard_verified"].includes(toolIsolation)
    || qualificationStatus !== "qualified") {
    fail("Target benchmark identity requires qualified server-binding executionSummary evidence, including protocol, capability profile, tool isolation, and tool catalog hashes.");
  }
  if (summary.executionProfile === "external_cli_agent") {
    if (typeof cliVersion !== "string"
      || !/^sha256:[a-f0-9]{64}$/u.test(capabilityEvidenceHash)
      || toolIsolation !== "hard_verified") {
      fail("External benchmark identity requires a qualified hard-verified capability, server-owned runtime version, and evidence hash.");
    }
  }
  const runtimeVersion = typeof cliVersion === "string" ? cliVersion : protocolVersion;
  const authoritative = {
    profile: summary.executionProfile,
    adapter: summary.engineAdapterId,
    backend: summary.backendId,
    model: summary.modelId,
    version: runtimeVersion,
    protocolVersion,
    toolIsolation,
    qualificationStatus,
    capabilityEvidenceHash,
    capabilityProfileHash,
    toolCatalogHash
  };
  for (const key of ["profile", "adapter", "backend", "model", "version"]) {
    if (authoritative[key] !== declared[key]) {
      fail(`Runtime execution identity does not match the benchmark declaration for ${key}.`);
    }
  }
  return {
    execution: authoritative,
    source: "runtime_binding_evidence"
  };
}

export function createBenchmarkRecordFromSnapshot({
  snapshot,
  fixture,
  execution,
  sample,
  observedAt = new Date().toISOString(),
  httpResponseBytes = null,
  transportMode = "offline_snapshot"
}) {
  validateFixture(fixture);
  if (!isRecord(snapshot)) fail("HTTP benchmark response did not include a snapshot object.");
  if (!VALID_PROFILES.has(execution.profile)) fail("execution.profile must be external_cli_agent or model_agent.");
  if (!VALID_SAMPLE_TEMPERATURES.has(sample.temperature)) fail("sample.temperature must be cold or warm.");
  const events = allRuntimeEvents(snapshot);
  const summary = isRecord(snapshot.performanceSummary) ? snapshot.performanceSummary : {};
  const telemetry = isRecord(snapshot.performanceTelemetry) ? snapshot.performanceTelemetry : {};
  const metricSources = [summary, telemetry, snapshot];
  const derivedFields = [];
  const resolvedExecution = resolveExecutionIdentity(snapshot, execution, transportMode);
  const completeEventRange = completeEventRangeObserved(snapshot, events);

  const durableElapsedWallMs = snapshot.completedAt === undefined
    ? null
    : elapsedBetween(snapshot.createdAt, snapshot.completedAt);
  const elapsedWallMs = durableElapsedWallMs
    ?? firstMetric(metricSources, ["wallClockMs", "elapsedWallMs", "timing.elapsedWallMs"])
    ?? elapsedBetween(snapshot.createdAt, observedAt);
  let activeWallMs = firstMetric(metricSources, ["activeWallMs", "timing.activeWallMs"]);
  const pauseObserved = ["needs_user_input", "waiting_approval"].includes(snapshot.status)
    || events.some((event) => ["question", "approval_required", "clarifying_questions"].includes(event.type))
    || (Array.isArray(snapshot.chatMessages) && snapshot.chatMessages.some((message) => message?.kind === "question"));
  if (activeWallMs === null && elapsedWallMs !== null && completeEventRange && !pauseObserved) {
    activeWallMs = elapsedWallMs;
    derivedFields.push("timing.activeWallMs");
  }

  const explicitModelMs = firstMetric(metricSources, ["modelMs", "providerMs", "modelDurationMs", "timing.modelMs"]);
  const modelMs = explicitModelMs ?? sumSpans(snapshot, ["model", "provider", "inference"]) ?? pairedLegacyDuration(events, "model");
  if (explicitModelMs === null && modelMs !== null) derivedFields.push("timing.modelMs");
  const explicitToolMs = firstMetric(metricSources, ["toolMs", "toolDurationMs", "timing.toolMs"]);
  const toolMs = explicitToolMs ?? sumSpans(snapshot, ["tool", "domain_tool"]) ?? pairedLegacyDuration(events, "tool");
  if (explicitToolMs === null && toolMs !== null) derivedFields.push("timing.toolMs");

  const modelTurns = firstMetric(metricSources, ["modelTurnCount", "providerTurnCount", "llmDecisionCount", "counts.modelTurns"], { integer: true });
  let processSpawns = firstMetric(metricSources, ["processSpawnCount", "processSpawns", "counts.processSpawns"], { integer: true });
  if (processSpawns === null && execution.adapter === "micro_cli_compatibility" && modelTurns !== null) {
    processSpawns = modelTurns;
    derivedFields.push("counts.processSpawns");
  }
  const sessionIds = new Set(events.map((event) => event.sessionId).filter((value) => typeof value === "string"));
  let logicalSessions = firstMetric(metricSources, ["logicalSessionCount", "sessionCount", "logicalSessions", "counts.logicalSessions"], { integer: true });
  if (logicalSessions === null && sessionIds.size > 0) {
    logicalSessions = sessionIds.size;
    derivedFields.push("counts.logicalSessions");
  } else if (logicalSessions === null && isRecord(snapshot.executionSummary)) {
    logicalSessions = 1;
    derivedFields.push("counts.logicalSessions");
  } else if (logicalSessions === null && typeof snapshot.runId === "string" && execution.profile === "model_agent") {
    logicalSessions = 1;
    derivedFields.push("counts.logicalSessions");
  }
  let resumes = firstMetric(metricSources, ["resumeCount", "resumes", "counts.resumes"], { integer: true });
  const sessionEpoch = finiteInteger(snapshot.executionSummary?.sessionEpoch);
  if (resumes === null && sessionEpoch !== null && sessionEpoch > 0) {
    resumes = sessionEpoch - 1;
    derivedFields.push("counts.resumes");
  } else if (resumes === null && execution.adapter === "micro_cli_compatibility") {
    resumes = 0;
    derivedFields.push("counts.resumes");
  }

  const outcome = projectOutcome(snapshot, fixture);
  const diagnostics = diagnosticCodes(snapshot, events, outcome.failureCodes);
  const eventFailureCount = events.filter((event) => event.type === "error"
    || (event.type === "tool_result" && event.payload?.status === "failed")
    || (event.type === "tool_call_completed" && event.metadata?.ok === false)).length;
  const explicitFailures = firstMetric(metricSources, ["failureCount", "failures", "counts.failures"], { integer: true });
  const failureCount = explicitFailures
    ?? (completeEventRange
      ? Math.max(eventFailureCount, diagnostics.failureCodes.length, snapshot.status === "succeeded" ? 0 : 1)
      : null);
  const explicitCorrections = firstMetric(metricSources, ["correctionCount", "repairCount", "corrections", "counts.corrections"], { integer: true });
  const correctionCount = explicitCorrections === null
    ? completeEventRange ? Math.max(diagnostics.repairCount, diagnostics.correctionCodes.length) : null
    : completeEventRange ? Math.max(explicitCorrections, diagnostics.correctionCodes.length) : explicitCorrections;
  const pauseEventCount = events.filter((event) => ["question", "clarifying_questions"].includes(event.type)).length;
  const approvalEventCount = events.filter((event) => event.type === "approval_required").length;
  const recoveryEventCount = events.filter((event) =>
    (event.type === "checkpoint" && event.payload?.reason === "recovery")
    || (event.type === "runtime_status" && String(event.payload?.code ?? "").toLowerCase().includes("recovery"))
  ).length;
  const explicitPauses = firstMetric(metricSources, ["pauseCount", "counts.pauses"], { integer: true });
  const explicitApprovals = firstMetric(metricSources, ["approvalCount", "counts.approvals"], { integer: true });
  const explicitRecoveries = firstMetric(metricSources, ["recoveryCount", "counts.recoveries"], { integer: true });
  if (explicitFailures === null && completeEventRange) derivedFields.push("counts.failures");
  if (explicitCorrections === null && completeEventRange) derivedFields.push("counts.corrections");
  if (explicitPauses === null && completeEventRange) derivedFields.push("counts.pauses");
  if (explicitApprovals === null && completeEventRange) derivedFields.push("counts.approvals");
  if (explicitRecoveries === null && completeEventRange) derivedFields.push("counts.recoveries");

  const record = {
    schemaVersion: 1,
    recordType: RECORD_TYPE,
    capturedAt: observedAt,
    runIdHash: sha256(typeof snapshot.runId === "string" ? snapshot.runId : stableStringify({ observedAt, sample })),
    fixture: {
      id: fixture.id,
      version: fixture.version,
      hash: computeFixtureHash(fixture)
    },
    sample: {
      temperature: sample.temperature,
      ordinal: sample.ordinal
    },
    execution: {
      profile: resolvedExecution.execution.profile,
      adapter: safeLabel(resolvedExecution.execution.adapter, "execution.adapter"),
      backend: safeLabel(resolvedExecution.execution.backend, "execution.backend"),
      model: safeDisplayLabel(resolvedExecution.execution.model, "execution.model"),
      version: safeDisplayLabel(resolvedExecution.execution.version, "execution.version"),
      protocolVersion: resolvedExecution.execution.protocolVersion === null
        ? null
        : safeDisplayLabel(resolvedExecution.execution.protocolVersion, "execution.protocolVersion"),
      toolIsolation: resolvedExecution.execution.toolIsolation,
      qualificationStatus: resolvedExecution.execution.qualificationStatus,
      capabilityEvidenceHash: resolvedExecution.execution.capabilityEvidenceHash,
      capabilityProfileHash: resolvedExecution.execution.capabilityProfileHash,
      toolCatalogHash: resolvedExecution.execution.toolCatalogHash
    },
    timing: {
      elapsedWallMs,
      activeWallMs,
      timeToFirstEventMs: firstMetric(metricSources, ["timeToFirstEventMs", "ttfeMs", "timing.timeToFirstEventMs"]) ?? firstEventElapsed(snapshot, events),
      timeToFirstDurableAgentMessageMs: firstMetric(metricSources, ["timeToFirstDurableAgentMessageMs", "firstAgentMessageMs", "timing.timeToFirstDurableAgentMessageMs"])
        ?? firstDurableAgentMessageElapsed(snapshot, events),
      modelMs,
      toolMs,
      gatewayMs: firstMetric(metricSources, ["gatewayMs", "toolGatewayMs", "timing.gatewayMs"]) ?? sumSpans(snapshot, ["gateway", "tool_gateway"]),
      persistenceMs: firstMetric(metricSources, ["persistenceMs", "storageMs", "timing.persistenceMs"]) ?? sumSpans(snapshot, ["persistence", "storage"])
    },
    counts: {
      processSpawns,
      logicalSessions,
      resumes,
      modelTurns,
      toolCalls: firstMetric(metricSources, ["toolCallCount", "toolCalls", "counts.toolCalls"], { integer: true }),
      failures: failureCount,
      corrections: correctionCount,
      pauses: explicitPauses ?? (completeEventRange ? pauseEventCount : null),
      approvals: explicitApprovals ?? (completeEventRange ? approvalEventCount : null),
      recoveries: explicitRecoveries ?? (completeEventRange ? recoveryEventCount : null)
    },
    bytes: {
      contextInputBytes: firstMetric(metricSources, ["contextInputBytes", "inputBytes", "bytes.contextInputBytes"], { integer: true }),
      promptBytes: firstMetric(metricSources, ["promptBytes", "bytes.promptBytes"], { integer: true }),
      streamBytes: firstMetric(metricSources, ["streamBytes", "stdoutBytes", "providerOutputBytes", "bytes.streamBytes"], { integer: true }),
      structuredOutputBytes: firstMetric(metricSources, ["structuredOutputBytes", "outputBytes", "bytes.structuredOutputBytes"], { integer: true }),
      toolResultBytes: firstMetric(metricSources, ["toolResultBytes", "bytes.toolResultBytes"], { integer: true }),
      finalSnapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      httpResponseBytes: finiteInteger(httpResponseBytes)
    },
    outcome: {
      terminalStatus: safeLabel(typeof snapshot.status === "string" ? snapshot.status : "unknown", "snapshot.status"),
      valid: outcome.valid,
      calculable: outcome.calculable,
      formulaBacklogCount: outcome.formulaBacklogCount,
      finiteRoot: outcome.finiteRoot,
      topology: outcome.topology
    },
    usage: usageMetrics(snapshot),
    diagnostics: {
      failureCodes: diagnostics.failureCodes,
      correctionCodes: diagnostics.correctionCodes
    },
    provenance: {
      timingSource: durableElapsedWallMs !== null ? "durable_timestamps" : isRecord(snapshot.performanceSummary) ? "runtime_summary" : "observed_timestamps",
      executionIdentitySource: resolvedExecution.source,
      transportMode: safeLabel(transportMode, "transportMode"),
      completeEventRangeObserved: completeEventRange,
      derivedFields: [...new Set(derivedFields)].sort()
    }
  };
  return validateBenchmarkRecord(record);
}

export function percentileNearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (typeof percentile !== "number" || percentile <= 0 || percentile > 1) fail("Percentile must be in (0, 1].");
  const sorted = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function metricSummary(values) {
  const available = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (available.length === 0) return { available: 0, min: null, p50: null, p95: null, max: null, mean: null };
  const sum = available.reduce((total, value) => total + value, 0);
  return {
    available: available.length,
    min: Math.min(...available),
    p50: percentileNearestRank(available, 0.5),
    p95: percentileNearestRank(available, 0.95),
    max: Math.max(...available),
    mean: sum / available.length
  };
}

function hasKnownFailure(record) {
  return record.diagnostics.failureCodes.some((code) =>
    KNOWN_DISQUALIFYING_FAILURES.some((known) => code.includes(known))
  );
}

function executionIdentityVerified(record) {
  if (record.execution.profile === "external_cli_agent") {
    return record.provenance.executionIdentitySource === "runtime_binding_evidence"
      && record.execution.capabilityEvidenceHash !== null
      && record.execution.capabilityProfileHash !== null
      && record.execution.toolCatalogHash !== null
      && record.execution.protocolVersion !== null
      && record.execution.toolIsolation === "hard_verified"
      && record.execution.qualificationStatus === "qualified";
  }
  if (record.execution.adapter === "micro_cli_compatibility") {
    return record.provenance.executionIdentitySource === "legacy_request_echo";
  }
  return record.provenance.executionIdentitySource === "runtime_binding_evidence"
    && record.execution.protocolVersion !== null
    && record.execution.capabilityEvidenceHash !== null
    && record.execution.capabilityProfileHash !== null
    && record.execution.toolCatalogHash !== null
    && record.execution.qualificationStatus === "qualified";
}

export function benchmarkRunPasses(record) {
  validateBenchmarkRecord(record);
  return record.outcome.terminalStatus === "succeeded"
    && record.outcome.valid
    && record.outcome.calculable
    && record.outcome.formulaBacklogCount === 0
    && record.outcome.finiteRoot
    && record.outcome.topology.matchesFixture
    && record.counts.logicalSessions === 1
    && record.counts.failures === 0
    && record.counts.pauses === 0
    && record.counts.approvals === 0
    && record.counts.recoveries === 0
    && executionIdentityVerified(record)
    && !hasKnownFailure(record);
}

function telemetryComplete(record) {
  return REQUIRED_TELEMETRY_PATHS.every((path) => typeof valueAtPath(record, path) === "number");
}

function summarizeTemperature(records) {
  const passed = records.filter(benchmarkRunPasses).length;
  return {
    count: records.length,
    passed,
    failed: records.length - passed,
    telemetryComplete: records.filter(telemetryComplete).length,
    metrics: Object.fromEntries(
      AGGREGATED_METRICS.map((path) => [path, metricSummary(records.map((record) => valueAtPath(record, path)))])
    )
  };
}

function assertUniqueQualificationSamples(records) {
  const sampleKeys = new Set();
  const runHashes = new Set();
  for (const record of records) {
    const sampleKey = `${record.sample.temperature}\u0000${record.sample.ordinal}`;
    if (sampleKeys.has(sampleKey) || runHashes.has(record.runIdHash)) {
      fail("Qualification cannot reuse a run or sample ordinal.");
    }
    sampleKeys.add(sampleKey);
    runHashes.add(record.runIdHash);
  }
}

export function qualifyBenchmarkGroup(records, thresholds = {}) {
  if (!Array.isArray(records) || records.length === 0) fail("Qualification requires at least one benchmark record.");
  records.forEach(validateBenchmarkRecord);
  const fixtureHashes = new Set(records.map((record) => record.fixture.hash));
  const executionKeys = new Set(records.map((record) => stableStringify(record.execution)));
  if (fixtureHashes.size !== 1 || executionKeys.size !== 1) fail("Qualification records must use one fixture and one execution identity.");
  assertUniqueQualificationSamples(records);

  const cold = records.filter((record) => record.sample.temperature === "cold");
  const warm = records.filter((record) => record.sample.temperature === "warm");
  const maxElapsedWallMs = thresholds.maxElapsedWallMs ?? 420_000;
  const stretchMedianWallMs = thresholds.stretchMedianWallMs ?? 180_000;
  const reasons = [];
  if (cold.length < 3) reasons.push("COLD_SAMPLE_COUNT_LT_3");
  if (warm.length < 20) reasons.push("WARM_SAMPLE_COUNT_LT_20");
  if (cold.some((record) => !benchmarkRunPasses(record))) reasons.push("COLD_FUNCTIONAL_FAILURE");
  if (warm.some((record) => !benchmarkRunPasses(record))) reasons.push("WARM_FUNCTIONAL_FAILURE");
  if (records.some((record) => record.counts.logicalSessions !== 1)) reasons.push("LOGICAL_SESSION_COUNT_NOT_1");
  if (records.some((record) => !executionIdentityVerified(record))) reasons.push("EXECUTION_IDENTITY_UNVERIFIED");
  if (records.some((record) => record.counts.pauses !== 0 || record.counts.approvals !== 0 || record.counts.recoveries !== 0)) {
    reasons.push("PAUSE_APPROVAL_OR_RECOVERY_OBSERVED");
  }
  if (cold.some((record) => record.timing.elapsedWallMs === null || record.timing.elapsedWallMs > maxElapsedWallMs)) {
    reasons.push("COLD_RUN_OVER_WALL_TARGET");
  }
  const warmP95 = percentileNearestRank(warm.map((record) => record.timing.elapsedWallMs).filter((value) => value !== null), 0.95);
  if (warm.length >= 20 && (warmP95 === null || warmP95 > maxElapsedWallMs)) reasons.push("WARM_P95_OVER_WALL_TARGET");
  if (records.some((record) => !telemetryComplete(record))) reasons.push("TELEMETRY_INCOMPLETE");
  const warmMedian = percentileNearestRank(warm.map((record) => record.timing.elapsedWallMs).filter((value) => value !== null), 0.5);
  return {
    qualified: reasons.length === 0,
    reasons,
    coldRequired: 3,
    coldCompleted: cold.length,
    coldPassed: cold.filter(benchmarkRunPasses).length,
    warmRequired: 20,
    warmCompleted: warm.length,
    warmPassed: warm.filter(benchmarkRunPasses).length,
    maxElapsedWallMs,
    warmP95ElapsedWallMs: warmP95,
    stretchMedianWallMs,
    warmMedianElapsedWallMs: warmMedian,
    stretchTargetMet: warm.length >= 20 && warmMedian !== null && warmMedian <= stretchMedianWallMs
  };
}

function groupKey(record) {
  return stableStringify({ fixture: record.fixture, execution: record.execution });
}

export function aggregateBenchmarkRecords(records, { generatedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(records) || records.length === 0) fail("At least one benchmark record is required.");
  records.forEach(validateBenchmarkRecord);
  const duplicateKeys = new Set();
  const sampleKeys = new Set();
  const runHashes = new Set();
  for (const record of records) {
    const sampleKey = `${groupKey(record)}\u0000${record.sample.temperature}\u0000${record.sample.ordinal}`;
    if (sampleKeys.has(sampleKey)) duplicateKeys.add(sampleKey);
    sampleKeys.add(sampleKey);
    if (runHashes.has(record.runIdHash)) duplicateKeys.add(record.runIdHash);
    runHashes.add(record.runIdHash);
  }
  if (duplicateKeys.size > 0) fail("Duplicate benchmark runs or sample ordinals were provided.");

  const grouped = new Map();
  for (const record of records) {
    const key = groupKey(record);
    const values = grouped.get(key) ?? [];
    values.push(record);
    grouped.set(key, values);
  }
  const groups = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, values]) => {
    const first = values[0];
    const cold = values.filter((record) => record.sample.temperature === "cold");
    const warm = values.filter((record) => record.sample.temperature === "warm");
    return {
      fixture: first.fixture,
      execution: first.execution,
      cold: summarizeTemperature(cold),
      warm: summarizeTemperature(warm),
      qualification: qualifyBenchmarkGroup(values, {
        maxElapsedWallMs: 420_000,
        stretchMedianWallMs: 180_000
      })
    };
  });
  const report = {
    schemaVersion: 1,
    reportType: REPORT_TYPE,
    generatedAt,
    thresholds: {
      coldRuns: 3,
      warmRuns: 20,
      maxElapsedWallMs: 420_000,
      stretchMedianWallMs: 180_000
    },
    recordCount: records.length,
    groups,
    runs: [...records].sort((left, right) =>
      groupKey(left).localeCompare(groupKey(right))
      || left.sample.temperature.localeCompare(right.sample.temperature)
      || left.sample.ordinal - right.sample.ordinal
    )
  };
  assertMetricsOnly(report);
  return report;
}

async function fetchJson(fetchImpl, url, init, { deadlineAt, timeoutLabel = "Agent endpoint request" } = {}) {
  const remainingMs = deadlineAt === undefined ? null : Math.floor(deadlineAt - Date.now());
  if (remainingMs !== null && remainingMs <= 0) fail(`${timeoutLabel} exceeded the benchmark deadline.`);
  const controller = new AbortController();
  let timeout = null;
  const timeoutPromise = remainingMs === null ? null : new Promise((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The benchmark request timed out.", "AbortError"));
    }, remainingMs);
  });
  try {
    const requestPromise = fetchImpl(url, { ...init, signal: controller.signal });
    const response = await (timeoutPromise ? Promise.race([requestPromise, timeoutPromise]) : requestPromise);
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      fail(`Agent endpoint returned non-JSON with HTTP ${response.status}.`);
    }
    if (!response.ok || !payload?.ok) {
      const code = safeCode(payload?.error?.code, `HTTP_${response.status}`);
      fail(`Agent endpoint failed with ${code}.`);
    }
    return { payload, bytes };
  } catch (error) {
    if (controller.signal.aborted) fail(`${timeoutLabel} exceeded the benchmark deadline.`);
    throw error;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function validateLoopbackBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("--base-url must be a valid URL.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (!["http:", "https:"].includes(url.protocol) || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    fail("HTTP benchmarks are restricted to an unauthenticated loopback base URL.");
  }
  return url.origin;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export async function runHttpBenchmark({
  baseUrl,
  bindingId,
  backend,
  model,
  version,
  profile,
  adapter,
  sampleTemperature,
  sampleOrdinal,
  fixturePath = DEFAULT_FIXTURE_PATH,
  providerTimeoutMs = 180_000,
  deadlineMs = 900_000,
  pollIntervalMs = 1_000,
  legacyBaseline = false,
  fetchImpl = fetch,
  now = () => new Date().toISOString()
}) {
  const origin = validateLoopbackBaseUrl(baseUrl);
  for (const [path, value] of Object.entries({ bindingId, backend, adapter })) safeLabel(value, path);
  for (const [path, value] of Object.entries({ model, version })) safeDisplayLabel(value, path);
  if (!VALID_PROFILES.has(profile)) fail("profile must be external_cli_agent or model_agent.");
  if (!VALID_SAMPLE_TEMPERATURES.has(sampleTemperature)) fail("sampleTemperature must be cold or warm.");
  requireNumberOrNull(sampleOrdinal, "sampleOrdinal", { integer: true });
  if (sampleOrdinal === null || sampleOrdinal < 1) fail("sampleOrdinal must be positive.");
  if (legacyBaseline && (!Number.isSafeInteger(providerTimeoutMs) || providerTimeoutMs < 1_000 || providerTimeoutMs > 300_000)) {
    fail("providerTimeoutMs must be between 1000 and 300000.");
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 50 || deadlineMs > 1_800_000) {
    fail("deadlineMs must be between 50 and 1800000.");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 10_000) {
    fail("pollIntervalMs must be between 0 and 10000.");
  }

  const fixture = await loadBenchmarkFixture(fixturePath);
  if (legacyBaseline && (profile !== "model_agent" || adapter !== "micro_cli_compatibility")) {
    fail("Legacy HTTP baseline requires model_agent with micro_cli_compatibility.");
  }
  const request = legacyBaseline
    ? {
        ...structuredClone(fixture.startRequest),
        providerId: bindingId,
        providerConfig: {
          backendId: backend,
          model,
          timeoutMs: providerTimeoutMs
        }
      }
    : {
        ...structuredClone(fixture.startRequest),
        executionBindingId: bindingId
      };
  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  let httpResponseBytes = 0;
  const started = await fetchJson(fetchImpl, `${origin}/api/agent/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  }, { deadlineAt, timeoutLabel: "Agent start request" });
  httpResponseBytes += started.bytes;
  let snapshot = started.payload.snapshot;
  if (!isRecord(snapshot)) fail("Agent start response did not include a snapshot.");
  const runId = typeof snapshot.runId === "string" ? snapshot.runId : started.payload.runId;
  safeLabel(runId, "runId");

  const cancelRun = async () => {
    try {
      await fetchJson(fetchImpl, `${origin}/api/agent/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }, { deadlineAt: Date.now() + 5_000, timeoutLabel: "Agent cancellation request" });
    } catch {
      // The benchmark error remains primary; cancellation is best-effort.
    }
  };

  try {
    while (!TERMINAL_OR_STOPPED_STATUSES.has(snapshot.status)) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        fail("Agent benchmark exceeded its local deadline and cancellation was requested.");
      }
      if (pollIntervalMs > 0) await sleep(Math.min(pollIntervalMs, remainingMs));
      const polled = await fetchJson(fetchImpl, `${origin}/api/agent/runs/${encodeURIComponent(runId)}`, { method: "GET" }, {
        deadlineAt,
        timeoutLabel: "Agent poll request"
      });
      httpResponseBytes += polled.bytes;
      snapshot = polled.payload.snapshot;
      if (!isRecord(snapshot)) fail("Agent poll response did not include a snapshot.");
    }
  } catch (error) {
    if (!TERMINAL_OR_STOPPED_STATUSES.has(snapshot.status)) await cancelRun();
    throw error;
  }

  return createBenchmarkRecordFromSnapshot({
    snapshot,
    fixture,
    execution: { profile, adapter, backend, model, version },
    sample: { temperature: sampleTemperature, ordinal: sampleOrdinal },
    observedAt: now(),
    httpResponseBytes,
    transportMode: legacyBaseline ? "legacy_provider_config" : "target_binding"
  });
}

export async function loadBenchmarkRecords(paths) {
  if (!Array.isArray(paths) || paths.length === 0) fail("At least one --input file is required.");
  const records = [];
  for (const path of paths) {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    assertMetricsOnly(parsed);
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed?.recordType === RECORD_TYPE
        ? [parsed]
        : Array.isArray(parsed?.runs)
          ? parsed.runs
          : Array.isArray(parsed?.records)
            ? parsed.records
            : fail(`Input ${path} is not a normalized benchmark record or report.`);
    for (const candidate of candidates) records.push(validateBenchmarkRecord(candidate));
  }
  return records;
}

async function writeMetricsJson(value, outputPath) {
  assertMetricsOnly(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, serialized);
  } else {
    process.stdout.write(serialized);
  }
}

function usage() {
  return [
    "Usage:",
    "  node --import tsx scripts/agent-build-benchmark.mjs run-http [options]",
    "  node --import tsx scripts/agent-build-benchmark.mjs run-http-legacy-baseline [options]",
    "  node --import tsx scripts/agent-build-benchmark.mjs aggregate --input <record.json> [--input <record.json> ...] [--output <report.json>]",
    "",
    "HTTP required options:",
    "  --base-url <loopback-url>  Running trusted VDT web app, for example http://127.0.0.1:3000",
    "  --binding-id <id>          Server-managed execution binding id (legacy mode: provider binding id)",
    "  --backend <id>             Backend identity recorded in metrics",
    "  --model <id>               Exact model identity recorded in metrics",
    "  --version <version>        Exact CLI/provider version recorded in metrics",
    "  --profile <profile>        external_cli_agent or model_agent",
    "  --adapter <id>             Adapter identity, for example cursor_acp or micro_cli_compatibility",
    "  --sample <cold|warm>       Sample temperature",
    "  --ordinal <number>         1-based sample ordinal",
    "",
    "HTTP optional options:",
    "  --deadline-ms <n>          Whole-run deadline (default: 900000)",
    "  --poll-ms <n>              Snapshot poll interval (default: 1000)",
    "  --output <path>            Write metrics-only JSON instead of stdout",
    "",
    "run-http sends only the fixed fixture plus executionBindingId.",
    "run-http-legacy-baseline sends providerId plus backend/model/timeout for the current micro-CLI baseline.",
    "  --provider-timeout-ms <n>  Legacy per-provider timeout (default: 180000)",
    "",
    "The runner accepts no API keys, tokens, executable paths, raw request files, or arbitrary prompts."
  ].join("\n");
}

function parseFlags(args) {
  const flags = { input: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith("--")) fail(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const value = args[++index];
    if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value.`);
    if (key === "input") flags.input.push(value);
    else flags[key] = value;
  }
  return flags;
}

function requiredFlag(flags, key) {
  const value = flags[key];
  if (typeof value !== "string" || value.length === 0) fail(`--${key} is required.`);
  return value;
}

function rejectUnsupportedFlags(flags, allowed) {
  for (const [key, value] of Object.entries(flags)) {
    if (key === "input" && Array.isArray(value) && value.length === 0) continue;
    if (key === "help") continue;
    if (!allowed.has(key)) fail(`--${key} is not supported for this command.`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const flags = parseFlags(rest);
  if (flags.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "aggregate") {
    rejectUnsupportedFlags(flags, new Set(["input", "output"]));
    const records = await loadBenchmarkRecords(flags.input);
    await writeMetricsJson(aggregateBenchmarkRecords(records), flags.output);
    return;
  }
  const legacyBaseline = command === "run-http-legacy-baseline";
  if (command !== "run-http" && !legacyBaseline) fail(`Unknown command: ${command}`);
  const allowedHttpFlags = new Set([
    "base-url",
    "binding-id",
    "backend",
    "model",
    "version",
    "profile",
    "adapter",
    "sample",
    "ordinal",
    "deadline-ms",
    "poll-ms",
    "output"
  ]);
  if (legacyBaseline) allowedHttpFlags.add("provider-timeout-ms");
  rejectUnsupportedFlags(flags, allowedHttpFlags);
  const record = await runHttpBenchmark({
    baseUrl: requiredFlag(flags, "base-url"),
    bindingId: requiredFlag(flags, "binding-id"),
    backend: requiredFlag(flags, "backend"),
    model: requiredFlag(flags, "model"),
    version: requiredFlag(flags, "version"),
    profile: requiredFlag(flags, "profile"),
    adapter: requiredFlag(flags, "adapter"),
    sampleTemperature: requiredFlag(flags, "sample"),
    sampleOrdinal: Number(requiredFlag(flags, "ordinal")),
    fixturePath: DEFAULT_FIXTURE_PATH,
    providerTimeoutMs: flags["provider-timeout-ms"] === undefined ? 180_000 : Number(flags["provider-timeout-ms"]),
    deadlineMs: flags["deadline-ms"] === undefined ? 900_000 : Number(flags["deadline-ms"]),
    pollIntervalMs: flags["poll-ms"] === undefined ? 1_000 : Number(flags["poll-ms"]),
    legacyBaseline
  });
  await writeMetricsJson(record, flags.output);
  if (!benchmarkRunPasses(record)) process.exitCode = 2;
}

if (process.argv[1] === SCRIPT_PATH) {
  main().catch((error) => {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    process.stderr.write(`agent-build-benchmark failed: ${message}\n`);
    process.exitCode = 1;
  });
}
