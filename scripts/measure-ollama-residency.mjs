import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveLocalHttpFetch } from "../packages/model-bridge/src/local-execution-http.ts";
import { assertMetricsOnly } from "../packages/vdt-agent-runtime/src/metrics-only.ts";

const modelPins = {
  "qwen3.5:4b-q4_K_M": {
    tag: "4b-q4_K_M",
    compatibilityCatalogDigest: "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04",
    manifestDigest: "0bfd9b30a103a15f8293afaf1846a5073890afad5248553f3ea978626372c586"
  },
  "qwen3.5:9b-q4_K_M": {
    tag: "9b-q4_K_M",
    compatibilityCatalogDigest: "56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90",
    manifestDigest: "7dd7bb310c1f18ad132c7fd72e73d4f6cff2e916c596a818701d2a1269037c7f"
  }
};
const supportedMinutes = [5, 15, 30];
const pollMs = 2_000;
const timingToleranceMs = 2_000;
const expiryGraceMs = 12_000;
const ollamaBinary = "/Applications/Ollama.app/Contents/Resources/ollama";
const finite = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const duration = (value) => finite(value) === null ? null : value / 1e6;
const stopped = new AbortController();
process.on("SIGINT", () => stopped.abort());
process.on("SIGTERM", () => stopped.abort());

async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file, { signal: stopped.signal })) digest.update(chunk);
  return digest.digest("hex");
}

async function verifyModelStore(directory, { tag, manifestDigest }) {
  const relative = join("manifests/registry.ollama.ai/library/qwen3.5", tag);
  const manifestPath = join(directory, relative);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (await realpath(manifestPath) !== manifestPath || await sha256File(manifestPath) !== manifestDigest) {
    throw new Error("Owned model manifest differs from the pinned installation.");
  }
  const assets = [manifest.config, ...manifest.layers];
  for (const { digest, size } of assets) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new Error("Invalid manifest digest.");
    const location = join(directory, "blobs", digest.replace(":", "-"));
    const stat = await lstat(location);
    if (!stat.isFile() || await realpath(location) !== location || stat.size !== size || await sha256File(location) !== digest.slice(7)) {
      throw new Error("An owned model asset failed verification.");
    }
  }
  return assets.length;
}

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function signalGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}

function groupAlive(child) {
  try { process.kill(-child.pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function stopDaemon(child, exited) {
  signalGroup(child, "SIGTERM");
  const timeout = performance.now() + 4_000;
  while (groupAlive(child) && performance.now() < timeout) await sleep(50);
  if (groupAlive(child)) signalGroup(child, "SIGKILL");
  const joined = await Promise.race([
    exited.then(() => true),
    sleep(2_000, false, { ref: false })
  ]);
  if (!joined) throw new Error("The owned Ollama process did not exit.");
  const settled = performance.now() + 2_000;
  while (groupAlive(child) && performance.now() < settled) await sleep(50);
  if (groupAlive(child)) throw new Error("The owned Ollama process group did not settle.");
}

async function launchOwnedDaemon(directory, policy, model, manifestDigest, profile, use) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = { HOME: process.env.HOME, TMPDIR: dirname(directory), PATH: "/usr/bin:/bin",
    OLLAMA_MODELS: directory, OLLAMA_HOST: `127.0.0.1:${port}`,
    OLLAMA_NO_CLOUD: "1", OLLAMA_NUM_PARALLEL: "1", OLLAMA_MAX_LOADED_MODELS: "1" };
  const child = spawn("/usr/bin/sandbox-exec", ["-f", policy, ollamaBinary, "serve"], {
    env, detached: true, stdio: "ignore"
  });
  const exited = new Promise(resolve => child.once("exit", resolve));
  await once(child, "spawn");
  profile.daemonStarted = true;
  profile.status = "starting_daemon";
  try {
    const deadline = performance.now() + 10_000;
    const read = (path) => fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(2_000) }).then(response => {
      if (!response.ok) throw new Error("Owned Ollama metadata not available.");
      return response.json();
    });
    let ownsListener = false;
    while (!ownsListener && performance.now() < deadline && child.exitCode === null) {
      stopped.signal.throwIfAborted();
      const listenerPids = command("/usr/sbin/lsof", ["-nP", "-t", "-iTCP:" + port, "-sTCP:LISTEN"]).trim();
      ownsListener = listenerPids === String(child.pid);
      if (!ownsListener) await sleep(100);
    }
    if (!ownsListener || child.exitCode !== null || (await read("/api/version")).version !== "0.40.16") throw new Error("The owned Ollama daemon did not start at the pinned version.");
    const [status, tags, initial] = await Promise.all([read("/api/status"), read("/api/tags"), read("/api/ps")]);
    if (status.cloud?.disabled !== true || tags.models.length !== 1 || tags.models[0].name !== model
      || tags.models[0].digest !== manifestDigest || initial.models.length !== 0) {
      throw new Error("The owned daemon failed cloud disablement, asset identity or cold-start verification.");
    }
    profile.cloudDisabled = true;
    profile.status = "sampling";
    return await use(origin, read);
  } finally {
    await stopDaemon(child, exited);
    profile.daemonProcessesClosed = true;
  }
}

function command(bin, args) {
  try { return execFileSync(bin, args, { encoding: "utf8", timeout: 2_000 }); } catch { return ""; }
}

async function residencyObservation(read, model, manifestDigest) {
  const { models } = await read("/api/ps");
  const loaded = models.find(entry => entry.name === model);
  if (models.length !== Number(Boolean(loaded)) || (loaded && loaded.digest !== manifestDigest)) {
    throw new Error("Unexpected resident model identity.");
  }
  return { loaded, monotonicMs: performance.now(), wallTimeMs: Date.now() };
}

function resources({ loaded }) {
  return {
    resident: Boolean(loaded), memoryBytes: finite(loaded?.size), gpuBytes: finite(loaded?.size_vram),
    activeContextTokens: finite(loaded?.context_length), expiresAt: loaded?.expires_at ?? null,
    freeMemoryPercent: finite(Number(command("/usr/bin/memory_pressure", ["-Q"]).match(/free percentage:\s*(\d+)%/u)?.[1])),
    swapUsedMiB: finite(Number(command("/usr/sbin/sysctl", ["-n", "vm.swapusage"]).match(/used = ([0-9.]+)M/u)?.[1])),
    loadAverage1Minute: loadavg()[0]
  };
}

async function observeIdleExpiry(read, model, manifestDigest, minutes, idleStartMs, initial, expiry, checkpoint) {
  const requestedMs = minutes * 60_000;
  const reportedRemainingMs = Date.parse(initial.loaded?.expires_at) - initial.wallTimeMs;
  expiry.reportedRemainingMs = finite(reportedRemainingMs);
  if (!initial.loaded || !Number.isFinite(reportedRemainingMs) ||
      Math.abs(reportedRemainingMs - requestedMs) > timingToleranceMs) {
    expiry.status = "initial_deadline_mismatch";
    return;
  }
  expiry.status = "observing";
  expiry.lastResidentIdleMs = initial.monotonicMs - idleStartMs;
  const expectedExpiryMs = initial.monotonicMs + reportedRemainingMs;
  const stopAtMs = expectedExpiryMs + expiryGraceMs;
  await checkpoint();
  while (performance.now() < stopAtMs) {
    await sleep(Math.min(pollMs, Math.max(0, stopAtMs - performance.now())), undefined, { signal: stopped.signal });
    const point = await residencyObservation(read, model, manifestDigest);
    expiry.pollCount++;
    const elapsedMs = point.monotonicMs - initial.monotonicMs;
    expiry.wallClockDriftMs = (point.wallTimeMs - initial.wallTimeMs) - elapsedMs;
    if (Math.abs(expiry.wallClockDriftMs) > timingToleranceMs) {
      expiry.status = "clock_discontinuity";
      return;
    }
    if (!point.loaded) {
      expiry.firstAbsentIdleMs = point.monotonicMs - idleStartMs;
      expiry.status = point.monotonicMs < expectedExpiryMs - timingToleranceMs ? "early_eviction"
        : point.monotonicMs > stopAtMs ? "not_observed_within_grace"
          : expiry.lastResidentIdleMs < expectedExpiryMs - idleStartMs - pollMs - timingToleranceMs ? "observation_gap"
            : "observed";
      expiry.afterIdle = resources(point);
      return;
    }
    if (point.loaded.expires_at !== initial.loaded.expires_at) {
      expiry.status = "deadline_changed";
      return;
    }
    expiry.lastResidentIdleMs = point.monotonicMs - idleStartMs;
  }
  expiry.status = "not_observed_within_grace";
}

async function compareProfile(directory, policy, model, manifestDigest, minutes, observeExpiry, profile, checkpoint) {
  return launchOwnedDaemon(directory, policy, model, manifestDigest, profile, async (origin, read) => {
    const pin = { profileVersion: `l04-owned-${minutes}m`, modelRevision: `sha256:${manifestDigest}` };
    const target = { baseUrl: origin + "/v1", backendId: "ollama", model, task: "agent_decision" };
    const admissions = [];
    const wireResidency = [];
    const fetchOwned = resolveLocalHttpFetch(target, pin, () => ({
      ...target, ...pin,
      ollamaKeepAliveMinutes: minutes,
      onInferenceAdmission: (admission) => admissions.push(admission),
      fetch: (url, init) => {
        wireResidency.push(JSON.parse(init.body).keep_alive);
        return fetch(url, init);
      }
    }));
    const request = {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, think: false, stream: false,
        messages: [{ role: "user", content: "Reply with exactly this number: 6" }],
        options: { temperature: 0, num_ctx: 4_096, num_predict: 32, seed: 17 } })
    };
    async function sample(phase, signal = stopped.signal) {
      const start = performance.now();
      const response = await fetchOwned(origin + "/api/chat", { ...request, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!response.ok) throw new Error("The isolated model request failed.");
      const data = await response.json();
      const wallMs = performance.now() - start;
      return {
        phase, wallMs, accepted: data.done === true && data.message?.content?.trim() === "6",
        providerTotalMs: duration(data.total_duration), loadMs: duration(data.load_duration), promptMs: duration(data.prompt_eval_duration),
        generationMs: duration(data.eval_duration), promptTokens: finite(data.prompt_eval_count), outputTokens: finite(data.eval_count)
      };
    }
    profile.before = resources(await residencyObservation(read, model, manifestDigest));
    const cold = await sample("cold");
    profile.afterCold = resources(await residencyObservation(read, model, manifestDigest));
    const warmPending = sample("warm");
    const cancel = new AbortController();
    const cancelled = sample("queued_cancelled", cancel.signal).then(() => false, error => error?.name === "AbortError");
    const contended = sample("queued_warm");
    cancel.abort();
    const [warm, queued, cancelledBeforeDispatch] = await Promise.all([warmPending, contended, cancelled]);
    const idleStartMs = performance.now();
    const initial = await residencyObservation(read, model, manifestDigest);
    Object.assign(profile, {
      after: resources(initial),
      remainingResidencySeconds: initial.loaded ? finite((Date.parse(initial.loaded.expires_at) - initial.wallTimeMs) / 1e3) : null,
      admissions, wireResidency, cancelledBeforeDispatch, samples: [cold, warm, queued]
    });
    if (profile.before.resident || !profile.afterCold.resident || !profile.after.resident ||
        !profile.samples.every(result => result.accepted) || !cancelledBeforeDispatch ||
        wireResidency.length !== 3 || !wireResidency.every(value => value === `${minutes}m`)) {
      profile.status = "probe_failed";
      return;
    }
    if (observeExpiry) {
      profile.status = "waiting_for_idle_expiry";
      await observeIdleExpiry(read, model, manifestDigest, minutes, idleStartMs, initial, profile.expiry, checkpoint);
    }
    profile.status = !observeExpiry || profile.expiry.status === "observed" ? "passed" : "expiry_failed";
  });
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", default: "qwen3.5:4b-q4_K_M" },
    minutes: { type: "string", multiple: true },
    "observe-expiry": { type: "boolean" }
  }
});
const [directory, policy, output] = positionals;
const model = values.model;
const pins = Object.hasOwn(modelPins, model) ? modelPins[model] : undefined;
const minutes = values.minutes?.map(Number) ?? supportedMinutes;
if (positionals.length !== 3 || !pins || !minutes.every(value => supportedMinutes.includes(value)) ||
    new Set(minutes).size !== minutes.length || process.platform !== "darwin") {
  throw new Error("Usage: measure-ollama-residency.mjs OWNED_MODEL_DIR SEATBELT_POLICY OUTPUT_JSON [--model EXACT_PIN] [--minutes 5|15|30]... [--observe-expiry]");
}
const { compatibilityCatalogDigest, manifestDigest } = pins;
const ownedDirectory = await realpath(directory);
if (ownedDirectory !== directory ||
    ownedDirectory === await realpath(join(process.env.HOME, ".ollama/models")).catch(() => undefined)) {
  throw new Error("Provide the absolute path of a disposable cloned model store.");
}
const verifiedAssetCount = await verifyModelStore(ownedDirectory, pins);
const report = { schemaVersion: 2, version: "0.40.16", model, compatibilityCatalogDigest, manifestDigest, verifiedAssetCount,
  hardware: command("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]).trim(),
  memoryBytes: finite(Number.parseInt(command("/usr/sbin/sysctl", ["-n", "hw.memsize"]), 10)),
  osBuild: command("/usr/bin/sw_vers", ["-buildVersion"]).trim(),
  startedAt: new Date().toISOString(),
  observation: { pollMs, timingToleranceMs, expiryGraceMs }, profiles: [] };
const selectedProfiles = minutes.map(minutes => ({
  minutes, status: "pending", daemonStarted: false, cloudDisabled: false, daemonProcessesClosed: false,
  expiry: { status: values["observe-expiry"] ? "pending" : "not_requested", pollCount: 0 }
}));
report.profiles = selectedProfiles;
// Reserve the result file before starting inference and checkpoint only our own file.
const result = await open(output, "wx");
async function checkpoint() {
  assertMetricsOnly(report);
  const encoded = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  await result.write(encoded, 0, encoded.length, 0);
  await result.truncate(encoded.length);
  await result.sync();
}
try {
  await checkpoint();
  for (const profile of selectedProfiles) {
    if (stopped.signal.aborted) break;
    profile.startedAt = new Date().toISOString();
    try {
      await compareProfile(ownedDirectory, policy, model, manifestDigest, profile.minutes, values["observe-expiry"], profile, checkpoint);
    } catch {
      profile.status = profile.daemonStarted && !profile.daemonProcessesClosed ? "cleanup_unconfirmed"
        : stopped.signal.aborted ? "interrupted"
          : profile.expiry.status === "observing" ? "expiry_metadata_failed" : "probe_failed";
      if (profile.expiry.status === "observing") profile.expiry.status = profile.status;
    }
    profile.finishedAt = new Date().toISOString();
    await checkpoint();
    if (profile.status === "cleanup_unconfirmed") break;
  }
} finally {
  await result.close();
}
if (selectedProfiles.some(profile => profile.status !== "passed")) process.exitCode = 1;
