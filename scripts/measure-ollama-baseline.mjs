import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadavg } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMetricsOnly, createBenchmarkRecordFromSnapshot, sha256 } from "./agent-build-benchmark.mjs";

const origin = "http://127.0.0.1:11434";
const app = "http://127.0.0.1:30191";
const realFetch = globalThis.fetch;
const stopRequested = new AbortController();
const pinnedDigests = {
  "qwen3.5:4b-q4_K_M": "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04",
  "qwen3.5:9b-q4_K_M": "56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90"
};
const scalar = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const elapsed = (started) => Math.round((performance.now() - started) * 10) / 10;
const ms = (ns) => scalar(ns) === null ? null : ns / 1e6;
const bytes = (value) => value === undefined ? null : Buffer.byteLength(JSON.stringify(value));
const json = async (path) => (await realFetch(origin + path, { signal: AbortSignal.timeout(5_000), redirect: "error" })).json();
const command = (bin, args) => execFileSync(bin, args, { encoding: "utf8", timeout: 3_000 }).trim();
const observeCommand = (bin, args) => { try { return command(bin, args); } catch { return null; } };

async function resources(model) {
  const status = await json("/api/ps").catch(() => null);
  const resident = status?.models?.find((entry) => entry.name === model);
  const sizeBytes = scalar(resident?.size);
  const vramBytes = scalar(resident?.size_vram);
  return {
    resident: status ? Boolean(resident) : null,
    loadAverage1Minute: loadavg()[0],
    sizeBytes, vramBytes,
    activeContextTokens: scalar(resident?.context_length),
    placement: vramBytes === null || !sizeBytes ? null : vramBytes === 0 ? "cpu_reported" : vramBytes >= sizeBytes ? "gpu_reported" : "mixed_reported",
    freeMemoryPercent: scalar(Number(observeCommand("/usr/bin/memory_pressure", ["-Q"])?.match(/free percentage:\s*(\d+)%/u)?.[1])),
    swapUsedMiB: scalar(Number(observeCommand("/usr/sbin/sysctl", ["-n", "vm.swapusage"])?.match(/used = ([0-9.]+)M/u)?.[1]))
  };
}

function watchFetch(model, calls, started) {
  return async (url, options) => {
    const target = new URL(String(url));
    if (target.origin !== origin) throw new Error("Baseline process permits only loopback Ollama");
    if (!["/api/chat", "/v1/chat/completions"].includes(target.pathname)) {
      if (!["/api/show", "/api/tags", "/v1/models", "/api/version", "/api/status", "/api/ps"].includes(target.pathname)) {
        throw new Error("Baseline permits only Ollama discovery and inference");
      }
      return realFetch(url, { ...options, redirect: "error" });
    }
    const request = JSON.parse(options?.body ?? "{}");
    if (request.model !== model || request.stream !== true || calls.length >= 128) {
      throw new Error("Unexpected model, streaming format or call count");
    }
    const began = performance.now();
    const requestBytes = Buffer.byteLength(options.body);
    const asciiUnits = (options.body.match(/[\x00-\x7f]/g) ?? []).length;
    const estimatedSerializedInputTokens = Math.ceil(asciiUnits / 3 + (requestBytes - asciiUnits) / 2 + 64);
    const call = {
      ordinal: calls.length + 1, startedMs: elapsed(started), endpoint: target.pathname,
      requestBytes, estimatedSerializedInputTokens, messagesBytes: bytes(request.messages),
      schemaBytes: bytes(request.format ?? request.response_format), messageCount: request.messages?.length ?? null,
      contextRequestedTokens: scalar(request.options?.num_ctx), outputRequestedTokens: scalar(request.options?.num_predict ?? request.max_tokens),
      temperature: scalar(request.options?.temperature ?? request.temperature),
      think: typeof request.think === "boolean" ? request.think : null,
      firstContentMs: null, firstThinkingMs: null, httpHeadersMs: null, wallMs: null,
      ollamaTotalMs: null, ollamaLoadMs: null, ollamaPromptEvalMs: null, ollamaGenerationMs: null,
      ollamaPromptTokens: null, ollamaOutputTokens: null, ollamaCachedPromptTokens: null, terminalFrame: false
    };
    calls.push(call);
    let response;
    try {
      response = await realFetch(url, { ...options, redirect: "error" });
    } catch (error) {
      call.observedUntilMs = elapsed(began);
      throw error;
    }
    call.httpStatus = response.status;
    call.httpHeadersMs = elapsed(began);
    if (!response.ok || !response.body) {
      call.observedUntilMs = elapsed(began);
      return response;
    }
    const decoder = new TextDecoder();
    let tail = "";
    const observeLine = (line) => {
      try {
        const data = JSON.parse(line.startsWith("data:") ? line.slice(5) : line);
        const delta = data.message ?? data.choices?.[0]?.delta;
        if (delta?.content && call.firstContentMs === null) call.firstContentMs = elapsed(began);
        if (delta?.thinking && call.firstThinkingMs === null) call.firstThinkingMs = elapsed(began);
        if (data.done === true || data.choices?.[0]?.finish_reason) {
          call.terminalFrame = true;
          call.stopReason = ["stop", "length"].includes(data.done_reason) ? data.done_reason : null;
          call.wallMs = elapsed(began);
          call.ollamaTotalMs = ms(data.total_duration);
          call.ollamaLoadMs = ms(data.load_duration);
          call.ollamaPromptEvalMs = ms(data.prompt_eval_duration);
          call.ollamaGenerationMs = ms(data.eval_duration);
          call.ollamaPromptTokens = scalar(data.prompt_eval_count ?? data.usage?.prompt_tokens);
          call.ollamaOutputTokens = scalar(data.eval_count ?? data.usage?.completion_tokens);
          call.ollamaCachedPromptTokens = scalar(data.usage?.prompt_tokens_details?.cached_tokens);
        }
      } catch { /* The original unmodified bytes still reach the runtime parser. */ }
    };
    const body = response.body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        tail += decoder.decode(chunk, { stream: true });
        const lines = tail.split("\n");
        tail = lines.pop() ?? "";
        lines.forEach(observeLine);
        controller.enqueue(chunk);
      },
      flush() { observeLine(tail + decoder.decode()); }
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

async function invoke(handler, path, body, params = {}) {
  const request = new Request(app + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: app },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    const code = payload.code ?? payload.error?.code;
    const safeCode = /^[A-Z][A-Z0-9_]{0,79}$/u.test(code ?? "") ? code : "NO_PUBLIC_ERROR_CODE";
    throw new Error(`Route handler refused the request (${response.status}, ${safeCode}).`);
  }
  return payload;
}

async function pinnedFixture(path, expectedHash) {
  const buffer = await readFile(path);
  if (createHash("sha256").update(buffer).digest("hex") !== expectedHash) {
    throw new Error("The historical library fixture digest changed.");
  }
  return JSON.parse(buffer);
}

async function libraryCase({ historicalDirectory, output, model, reasoning, deadlineMs, ordinal }) {
  const original = "autonomous-qwen35-library-v2";
  const [historicalStart, create] = await Promise.all([
    pinnedFixture(join(historicalDirectory, original + "-start-request.json"), "02e75086be5380afa68f00f75b60bc8128e79480fd0fb8742bd6293f9043d59b"),
    pinnedFixture(join(historicalDirectory, original + "-create-request.json"), "07b913f771faea5790c7190f22eff0bcaa47f874722fd58d2fb57a4e42e7986c")
  ]);
  const projectId = "project_l01_" + randomUUID();
  const vdtId = "vdt_" + randomUUID();
  create.idempotencyKey = "baseline-" + randomUUID();
  create.vdt.requestedVdtId = vdtId;
  create.project.id = "project_l01_draft_" + randomUUID();
  const startRequest = {
    ...historicalStart,
    workspace: { ...historicalStart.workspace, projectId, vdtId },
    input: { ...historicalStart.input, project: create.project }
  };
  const createProject = (await import("../apps/web/app/api/vdt/projects/route.ts")).POST;
  const createVdt = (await import("../apps/web/app/api/vdt/projects/[projectId]/vdts/route.ts")).POST;
  const selection = await import("../apps/web/app/api/skills/selection/route.ts");
  const admit = (await import("../apps/web/app/api/agent/bindings/provider/route.ts")).POST;
  const start = (await import("../apps/web/app/api/agent/runs/route.ts")).POST;
  const poll = (await import("../apps/web/app/api/agent/runs/[runId]/route.ts")).GET;
  const cancel = (await import("../apps/web/app/api/agent/runs/[runId]/cancel/route.ts")).POST;
  const caseName = "historical_load_and_haul_v2_pinned";
  if (!process.env.VDT_DATA_DIR) throw new Error("Set a disposable VDT_DATA_DIR before running the library case.");
  const report = await metadata(model, reasoning, caseName, ordinal);
  const calls = [];
  const started = performance.now();
  globalThis.fetch = watchFetch(model, calls, started);
  try {
    const created = await invoke(createProject, "/api/vdt/projects", { id: projectId, name: "L01 synthetic reference" });
    create.expectedRuntime.runtimeGeneration = created.summary.runtimeState.runtimeGeneration;
    create.expectedRuntime.generationVersion = created.summary.runtimeState.generationVersion;
    await invoke(createVdt, "/api/vdt/projects/vdts", create, { projectId });
    const initialSkill = await invoke(selection.GET, `/api/skills/selection?projectId=${projectId}&vdtId=${vdtId}`);
    const pin = await invoke(selection.POST, "/api/skills/selection", { projectId, vdtId, skillId: "mining.load_and_haul", version: 1, expectedRevision: initialSkill.selection?.revision ?? 0 });
    const binding = await invoke(admit, "/api/agent/bindings/provider", {
      operation: "admit", providerId: "local_runner",
      providerConfig: { backendId: "ollama", model, ...(reasoning === "default" ? {} : { modelReasoning: reasoning === "on" }) }
    });
    startRequest.executionBindingId = binding.binding.bindingId;
    const admittedWallTime = Date.now();
    const admittedAt = performance.now();
    const launched = await invoke(start, "/api/agent/runs", startRequest);
    const { runId } = launched.snapshot;
    const deadline = admittedAt + deadlineMs;
    const resourceSamples = [];
    let nextResourceSample = admittedAt;
    let snapshot = launched.snapshot;
    let timedOut = false;
    let observationWallMs;
    let observedAt;
    let cancellationAcknowledged = null;
    try {
      const stop = new Set(["succeeded", "failed", "cancelled", "needs_user_input", "waiting_approval", "recovery_required", "partial"]);
      while (!stop.has(snapshot.status) && performance.now() < deadline && !interrupted) {
        await sleep(Math.min(1000, Math.max(0, deadline - performance.now())));
        if (performance.now() >= nextResourceSample) {
          const sampledMs = elapsed(admittedAt);
          resourceSamples.push({ sampledMs, ...await resources(model) });
          nextResourceSample = performance.now() + 10_000;
        }
        snapshot = (await invoke(poll, "/api/agent/runs/owned-run", undefined, { runId })).snapshot;
      }
      timedOut = !stop.has(snapshot.status) && !interrupted;
    } finally {
      observationWallMs = elapsed(admittedAt);
      observedAt = new Date().toISOString();
      if (!["succeeded", "failed", "cancelled"].includes(snapshot.status)) {
        const result = await invoke(cancel, "/api/agent/runs/owned-run/cancel", { awaitTerminal: true }, { runId });
        cancellationAcknowledged = result.snapshot?.status === "cancelled" || result.status === "cancelled";
        if (!cancellationAcknowledged) {
          const cancelled = (await invoke(poll, "/api/agent/runs/owned-run", undefined, { runId })).snapshot;
          cancellationAcknowledged = cancelled.status === "cancelled";
        }
      }
    }
    const fixture = {
      schemaVersion: 1, id: caseName, version: "1.0.0", startRequest: historicalStart,
      acceptance: { rootNodeId: historicalStart.input.project.rootNodeId, rootNodeType: "root_kpi", nodeCount: 35, edgeCount: 34, depth: 5, maxElapsedWallMs: 180_000, stretchMedianWallMs: 180_000, requiredFleetLabels: ["Excavation", "Haulage"] }
    };
    let benchmark = null;
    let benchmarkExportFailed = false;
    try {
      benchmark = createBenchmarkRecordFromSnapshot({
        snapshot, fixture,
        execution: { profile: "model_agent", adapter: "local-http-structured-turn-v1", backend: "ollama", model, version: "structured-turn-v1" },
        transportMode: "local_compatibility_baseline", observedAt,
        sample: { temperature: report.resourcesBefore.resident ? "warm" : "cold", ordinal }
      });
    } catch {
      benchmarkExportFailed = true;
    }
    let receiptMetrics = null;
    try {
      receiptMetrics = readReceiptMetrics(process.env.VDT_DATA_DIR, runId, vdtId, admittedWallTime);
    } catch {
      // Missing receipt data does not suppress independent transport and snapshot measurements.
    }
    const firstContent = calls.find((call) => call.firstContentMs !== null);
    await emit(output, {
      ...report, admissionMs: calls[0] ? Math.max(0, calls[0].startedMs - (admittedAt - started)) : null,
      firstContentFromAdmissionMs: firstContent ? firstContent.startedMs + firstContent.firstContentMs - (admittedAt - started) : null,
      hostQueueMs: null, ollamaQueueMs: null, repairMs: null, voiceEnabled: false,
      appliedMutations: Array.isArray(snapshot.appliedMutationHistory)
        ? snapshot.appliedMutationHistory.length + (snapshot.snapshotProjection?.omittedAppliedHistory ?? 0) : null,
      receiptMetrics,
      modelStepBudget: startRequest.options.maxSteps,
      independentSemanticAccepted: null,
      verifiedFinishAccepted: receiptMetrics ? snapshot.status === "succeeded" && receiptMetrics.finishState === "final_persisted" : null,
      admissionMetric: "start to first Ollama request, includes host setup", observationDeadlineMs: deadlineMs,
      originalBriefHash: sha256(historicalStart.input.prompt), selectedSkill: pin.skill.id, selectedSkillVersion: pin.skill.version,
      wallMs: observationWallMs, interrupted, timedOut, cancellationAcknowledged, benchmarkExportFailed, benchmark, calls,
      observationStatus: snapshot.status,
      terminalStatus: cancellationAcknowledged ? "cancelled" : ["succeeded", "failed", "cancelled"].includes(snapshot.status) ? snapshot.status : null,
      resourceSamples, resourcesAfter: await resources(model)
    });
  } catch (error) {
    if (error.code === "EEXIST") throw error;
    await emit(output, { ...report, terminalStatus: "harness_error", calls, resourcesAfter: await resources(model) });
    throw error;
  } finally { globalThis.fetch = realFetch; }
}

function intervalUnionMs(intervals) {
  let total = 0;
  let end = 0;
  for (const [from, to] of intervals.sort(([left], [right]) => left - right)) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    total += Math.max(0, to - Math.max(from, end));
    end = Math.max(end, to);
  }
  return total;
}

function readReceiptMetrics(dataDir, runId, vdtId, admittedWallTime) {
  const db = new DatabaseSync(join(dataDir, "app.sqlite"), { readOnly: true });
  try {
    const exchanges = db.prepare(`SELECT state, result_code AS code, started_at AS started, updated_at AS ended
        FROM agent_latest_engine_exchange_receipts_v2 WHERE run_id = ? ORDER BY started_at LIMIT 128`).all(runId);
    const tools = db.prepare(`SELECT state, result_code AS code, started_at AS started, updated_at AS ended,
        committed_revision IS NOT NULL AND (expected_revision IS NULL OR committed_revision > expected_revision) AS mutated
        FROM agent_latest_tool_operation_receipts_v2 WHERE run_id = ? ORDER BY started_at LIMIT 512`).all(runId);
    const saves = db.prepare(`SELECT reserved_at AS started, committed_at AS ended
        FROM revision_commit_records WHERE vdt_id = ? AND revision_no > 1 AND state = 'committed'
        ORDER BY revision_no LIMIT 512`).all(vdtId);
    const verifiedFinish = db.prepare(`SELECT state, project_revision AS revision, verified_at AS verified, final_persisted_at AS persisted
         FROM agent_latest_finish_receipts_v2 WHERE run_id = ?`).get(runId);
    const completed = exchanges.find((entry) => entry.state === "completed");
    const codeCounts = {};
    for (const { code } of [...exchanges, ...tools]) {
      if (/^[A-Z][A-Z0-9_]{0,79}$/u.test(code ?? "")) codeCounts[code] = (codeCounts[code] ?? 0) + 1;
    }
    const ended = tools.filter((entry) => ["completed", "failed"].includes(entry.state));
    return {
      firstCompletedEngineExchangeMs: completed ? scalar(Date.parse(completed.ended) - admittedWallTime) : null,
      engineExchanges: exchanges.length, completedEngineExchanges: exchanges.filter((entry) => entry.state === "completed").length,
      toolCalls: tools.length, toolMutations: tools.filter((entry) => entry.mutated).length,
      toolReceiptWallMs: intervalUnionMs(ended.map((entry) => [Date.parse(entry.started), Date.parse(entry.ended)])),
      saveCommitCount: saves.length,
      saveReceiptWallMs: intervalUnionMs(saves.map((entry) => [entry.started, entry.ended])),
      rejectedRepeatReceipts: codeCounts.MODEL_TOOL_RETRY_LIMIT_EXCEEDED ?? null,
      codeCounts,
      finishState: verifiedFinish?.state ?? null, finishRevision: verifiedFinish?.revision ?? null,
      finishVerifiedMs: scalar(Date.parse(verifiedFinish?.verified) - admittedWallTime),
      finishPersistedMs: scalar(Date.parse(verifiedFinish?.persisted) - admittedWallTime)
    };
  } finally {
    db.close();
  }
}

async function greetingCase({ output, model, reasoning, deadlineMs, ordinal }) {
  const report = await metadata(model, reasoning, "direct_ru_en_greeting", ordinal);
  const samples = [];
  for (const [language, expected] of [["ru", "Привет!"], ["en", "Hello!"]]) {
    for (const attempt of [1, 2, 3]) {
      if (interrupted) break;
      const resourcesBefore = await resources(model);
      const calls = [];
      const started = performance.now();
      const infer = watchFetch(model, calls, started);
      let final = "";
      let timedOut = false;
      let failed = false;
      const deadline = AbortSignal.timeout(deadlineMs);
      const signal = AbortSignal.any([deadline, stopRequested.signal]);
      try {
        const response = await infer(origin + "/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({
            model, stream: true,
            ...(reasoning === "default" ? {} : { think: reasoning === "on" }),
            options: { temperature: 0, num_ctx: 16_384, num_predict: 256 },
            messages: [{ role: "user", content: language === "ru" ? "Ответь ровно одним словом: Привет!" : "Respond with exactly one word: Hello!" }]
          })
        });
        if (!response.ok) throw new Error("Ollama greeting request failed");
        const decoder = new TextDecoder();
        let tail = "";
        for await (const chunk of response.body) {
          tail += decoder.decode(chunk, { stream: true });
          const lines = tail.split("\n");
          tail = lines.pop() ?? "";
          for (const line of lines) final += JSON.parse(line).message?.content ?? "";
        }
        if (tail.trim()) final += JSON.parse(tail).message?.content ?? "";
      } catch {
        timedOut = deadline.aborted;
        failed = !timedOut && !interrupted;
      }
      samples.push({
        language, attempt, timedOut, failed, interrupted, wallMs: elapsed(started),
        accepted: calls.some((call) => call.terminalFrame && call.stopReason !== "length") && final.trim() === expected,
        resourcesBefore, calls
      });
    }
  }
  await emit(output, { ...report, samples, resourcesAfter: await resources(model) });
}

async function metadata(model, reasoning, caseName, ordinal) {
  const [tags, version, status, resourcesBefore] = await Promise.all([json("/api/tags"), json("/api/version"), json("/api/status").catch(() => null), resources(model)]);
  const tag = tags.models.find((entry) => entry.name === model);
  if (!tag || tag.digest !== pinnedDigests[model] || tag.remote_host || tag.remote_model) throw new Error("Pinned local model digest missing");
  return {
    schemaVersion: 1, capturedAt: new Date().toISOString(), caseName, ordinal, model, digest: tag.digest, quantization: tag.details.quantization_level,
    modelBytes: tag.size, advertisedContextTokens: tag.details.context_length, reasoning,
    ollamaVersion: version.version, ollamaCloudDisabled: typeof status?.cloud?.disabled === "boolean" ? status.cloud.disabled : typeof status?.cloud_disabled === "boolean" ? status.cloud_disabled : null,
    hardware: observeCommand("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]),
    memoryBytes: scalar(Number(observeCommand("/usr/sbin/sysctl", ["-n", "hw.memsize"]) ?? undefined)),
    os: observeCommand("/usr/bin/sw_vers", ["-productVersion"]), osBuild: observeCommand("/usr/bin/sw_vers", ["-buildVersion"]),
    sdk: observeCommand("/usr/bin/xcrun", ["--show-sdk-version", "--sdk", "macosx"]),
    nodeVersion: process.version,
    loadCondition: process.env.VDT_BASELINE_LOAD_CONDITION === "concurrent_offline_rust_build"
      ? "concurrent_offline_rust_build" : null,
    resourcesBefore
  };
}

async function emit(path, report) {
  assertMetricsOnly(report);
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function exportCsv(directory, prefix) {
  const runs = [];
  const calls = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!/^(?:greeting|library)-.*\.json$/u.test(name)) continue;
    const report = JSON.parse(await readFile(join(directory, name), "utf8"));
    assertMetricsOnly(report);
    if (report.kind === "instrumentation_shakedown") continue;
    const samples = report.samples ?? [report];
    for (const sample of samples) {
      const resources = sample.resourcesBefore;
      const key = [name, report.model, report.reasoning, sample.language, sample.attempt ?? sample.ordinal];
      const receipt = sample.receiptMetrics;
      runs.push([
        ...key, report.loadCondition, resources?.resident, resources?.placement, resources?.freeMemoryPercent, resources?.swapUsedMiB, resources?.loadAverage1Minute,
        sample.wallMs, sample.timedOut, sample.interrupted, sample.accepted ?? sample.independentSemanticAccepted,
        sample.observationStatus, sample.terminalStatus, sample.verifiedFinishAccepted, sample.firstContentFromAdmissionMs, receipt?.firstCompletedEngineExchangeMs,
        sample.calls?.length, receipt?.toolCalls, receipt?.toolReceiptWallMs, receipt?.toolMutations,
        receipt?.saveCommitCount, receipt?.saveReceiptWallMs, receipt?.finishState
      ]);
      for (const call of sample.calls ?? []) {
        calls.push([
          ...key, call.ordinal, call.endpoint, call.startedMs, call.requestBytes, call.estimatedSerializedInputTokens, call.messagesBytes, call.schemaBytes,
          call.contextRequestedTokens, call.outputRequestedTokens, call.think, call.temperature, call.firstContentMs,
          call.firstThinkingMs, call.wallMs, call.ollamaTotalMs, call.ollamaLoadMs, call.ollamaPromptEvalMs,
          call.ollamaGenerationMs, call.ollamaPromptTokens, call.ollamaOutputTokens, call.ollamaCachedPromptTokens
        ]);
      }
    }
  }
  const keyColumns = "artifact,model,reasoning,language,attempt";
  for (const [suffix, columns, rows] of [
    ["runs", "loadCondition,resident,placement,freeMemoryPercent,swapUsedMiB,loadAverage1Minute,wallMs,timedOut,interrupted,semanticAccepted,observationStatus,terminalStatus,verifiedFinishAccepted,firstContentFromAdmissionMs,firstCompletedExchangeMs,inferenceCalls,toolCalls,toolReceiptWallMs,toolMutations,saveCommitCount,saveReceiptWallMs,finishState", runs],
    ["calls", "call,endpoint,startedMs,requestBytes,estimatedSerializedInputTokens,messagesBytes,schemaBytes,contextRequestedTokens,outputRequestedTokens,think,temperature,firstContentMs,firstThinkingMs,wallMs,ollamaTotalMs,ollamaLoadMs,ollamaPromptEvalMs,ollamaGenerationMs,ollamaPromptTokens,ollamaOutputTokens,ollamaCachedPromptTokens", calls]
  ]) {
    await writeFile(`${prefix}-${suffix}.csv`, [keyColumns + "," + columns, ...rows.map((row) => row.map(csvValue).join(","))].join("\n") + "\n");
  }
}

let interrupted = false;
function requestStop() {
  interrupted = true;
  stopRequested.abort();
}
process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);
const [historicalDirectory, output, model, reasoning, deadline, sampleOrdinal] = process.argv.slice(2);
if (historicalDirectory === "csv") {
  await exportCsv(output, model);
  process.exit(0);
}
if (!Object.hasOwn(pinnedDigests, model) || !["off", "on", "default"].includes(reasoning) || !(Number(deadline) >= 1_000 && Number(deadline) <= 1_800_000) || !Number.isSafeInteger(Number(sampleOrdinal)) || Number(sampleOrdinal) < 1) {
  throw new Error("Usage: measure-ollama-baseline.mjs HISTORICAL_DIR OUTPUT_JSON PINNED_MODEL off|on|default DEADLINE_MS ORDINAL");
}
const run = historicalDirectory === "greeting" ? greetingCase : libraryCase;
await run({ historicalDirectory, output, model, reasoning, deadlineMs: Number(deadline), ordinal: Number(sampleOrdinal) });
