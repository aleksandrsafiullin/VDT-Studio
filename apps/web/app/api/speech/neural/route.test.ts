import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSpeechRuntime } from "@vdt-studio/local-runner/speech";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";

const mockHost = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  verifyInstallation: vi.fn(async (_signal: AbortSignal) => undefined),
  synthesize: vi.fn(async (_preview: unknown, _text: string, _signal: AbortSignal) => "UklGRgAAAABXQVZF")
}));

vi.mock("@vdt-studio/local-runner/speech", async importOriginal => {
  const actual = await importOriginal<typeof import("@vdt-studio/local-runner/speech")>();
  const speech = new actual.SpeechRuntime({ appleVoice: {
    preview: async () => "", recognize: async () => "",
    status: async () => ({ state: "apple_voice_status", supported: true, voices: [],
      recognition: [{ locale: "en", systemLocale: "en-US", status: "installed" }] })
  } });
  class FixtureAssets extends actual.NeuralVoiceAssetInstaller {
    constructor(directory: string) {
      const catalog = actual.NEURAL_VOICES.map(voice => ({
        ...voice, assets: voice.assets.map(asset => ({
          ...asset, bytes: 7, sha256: createHash("sha256").update("fixture").digest("hex")
        }))
      }));
      super(directory, { catalog, fetch: mockHost.fetch });
    }
  }
  return { ...actual, getSpeechRuntime: () => speech, NeuralVoiceAssetInstaller: FixtureAssets, createPiperVoiceEngine: () => mockHost };
});

const url = "http://localhost:38191/api/speech/neural";
const joe = "en_US-joe-medium";
const denis = "ru_RU-denis-medium";
let root: string;

function post(input: object, options: { origin?: string | null; signal?: AbortSignal } = {}) {
  const headers = new Headers({ "content-type": "application/json", "sec-fetch-site": "same-origin" });
  if (options.origin !== null) headers.set("origin", options.origin ?? new URL(url).origin);
  return POST(new Request(url, { method: "POST", headers, body: JSON.stringify(input), signal: options.signal ?? null }));
}

beforeEach(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), "vdt-neural-route-"));
  for (const [name, value] of Object.entries({
    VDT_APP_MODE: "development_web", VDT_NEURAL_VOICE_OWNER_PORT: "38191", VDT_NEURAL_VOICE_ASSET_DIR: join(root, "assets"),
    VDT_NEURAL_VOICE_PYTHON: "/approved/python", VDT_NEURAL_VOICE_PYTHON_SHA256: "a".repeat(64),
    VDT_NEURAL_VOICE_LIBRARIES: "/approved/libraries", VDT_NEURAL_VOICE_LIBRARIES_SHA256: "b".repeat(64)
  })) vi.stubEnv(name, value);
  mockHost.fetch.mockImplementation(async () => new Response("fixture"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, "__vdtNeuralVoiceHost");
  await rm(root, { recursive: true, force: true });
});

it("rejects hosted, Desktop, wrong or missing origin, and generic listeners without launcher ownership", async () => {
  for (const mode of ["hosted_web", "desktop"]) {
    vi.stubEnv("VDT_APP_MODE", mode);
    expect((await post({ operation: "status" })).status).toBe(403);
  }
  vi.stubEnv("VDT_APP_MODE", "development_web");
  expect((await post({ operation: "status" }, { origin: "http://outside.example:38191" })).status).toBe(403);
  expect((await post({ operation: "status" }, { origin: null })).status).toBe(403);
  vi.stubEnv("VDT_NEURAL_VOICE_OWNER_PORT", "38192");
  expect((await post({ operation: "status" })).status).toBe(403);
  vi.stubEnv("VDT_NEURAL_VOICE_OWNER_PORT", "");
  expect((await post({ operation: "status" })).status).toBe(403);
  expect(mockHost.verifyInstallation).not.toHaveBeenCalled();
  expect(mockHost.fetch).not.toHaveBeenCalled();
});

it("exposes verified capability only after checking the approved installation", async () => {
  mockHost.verifyInstallation.mockRejectedValueOnce(new Error("/sensitive/path"));
  const unavailable = await post({ operation: "status" });
  expect(await unavailable.json()).toEqual({ available: false });
  const ready = await post({ operation: "status" });
  expect(ready.headers.get("cache-control")).toBe("no-store");
  expect(await ready.json()).toMatchObject({ available: true, voices: [{ id: joe }, { id: denis }] });
  expect(mockHost.fetch).not.toHaveBeenCalled();
});

it("requires exact one-use consent and keeps check, foreign offers, and removal local", async () => {
  expect(await (await post({ operation: "check", voiceId: joe })).json()).toEqual({ state: "missing" });
  expect((await post({ operation: "offer", voiceId: joe, url: "https://outside.example" })).status).toBe(400);
  const { offerId } = await (await post({ operation: "offer", voiceId: joe })).json();
  expect((await post({ operation: "install", voiceId: joe, offerId, confirmed: false })).status).toBe(400);
  expect((await post({ operation: "install", voiceId: denis, offerId, confirmed: true })).status).toBe(409);
  expect(mockHost.fetch).not.toHaveBeenCalled();
  expect(await (await post({ operation: "install", voiceId: joe, offerId, confirmed: true })).json()).toEqual({ state: "verified" });
  expect(mockHost.fetch).toHaveBeenCalledTimes(3);
  expect((await post({ operation: "install", voiceId: joe, offerId, confirmed: true })).status).toBe(409);
  expect((await post({ operation: "remove", voiceId: joe, confirmed: false })).status).toBe(400);
  expect(await (await post({ operation: "remove", voiceId: joe, confirmed: true })).json()).toEqual({ state: "missing" });
  expect(await (await post({ operation: "check", voiceId: joe })).json()).toEqual({ state: "missing" });
  expect(mockHost.fetch).toHaveBeenCalledTimes(3);
});

it("aborts a confirmed download using only the matching offer and leaves no installed voice", async () => {
  let downloading!: () => void;
  const started = new Promise<void>(resolve => { downloading = resolve; });
  mockHost.fetch.mockImplementationOnce(async (_input, init) => {
    downloading();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const { offerId } = await (await post({ operation: "offer", voiceId: joe })).json();
  const install = post({ operation: "install", voiceId: joe, offerId, confirmed: true });
  await started;
  await post({ operation: "cancel", offerId: randomUUID() });
  expect((await post({ operation: "install", voiceId: joe, offerId, confirmed: true })).status).toBe(409);
  await post({ operation: "cancel", offerId });
  expect((await install).status).toBe(409);
  expect(await (await post({ operation: "check", voiceId: joe })).json()).toEqual({ state: "missing" });
});

it("revokes a matching offer if cancellation arrives ahead of the install request", async () => {
  const { offerId } = await (await post({ operation: "offer", voiceId: joe })).json();
  await post({ operation: "cancel", offerId });
  expect((await post({ operation: "install", voiceId: joe, offerId, confirmed: true })).status).toBe(409);
  expect(mockHost.fetch).not.toHaveBeenCalled();
});

it("plays a host-fixed sample under the shared speech lease until the exact preview owner stops", async () => {
  const speech = getSpeechRuntime();
  const capture = { operation: "open_session", selection: {
    version: 1, scopeId: "a".repeat(64), analytics: { mode: "local", providerId: "ollama", modelId: "model" },
    language: "en", stt: { providerId: "apple_local", modelId: "system" }, tts: null, realtime: null
  } };
  expect((await post({ operation: "preview", voiceId: joe, text: "untrusted", confirmed: true })).status).toBe(400);
  const response = await post({ operation: "preview", voiceId: joe, confirmed: true });
  expect(response.status).toBe(200);
  const payload = await response.json();
  try {
    expect(payload).toMatchObject({ previewId: expect.any(String), expiresAt: expect.any(Number), waveformBase64: "UklGRgAAAABXQVZF" });
    expect(mockHost.synthesize).toHaveBeenCalledExactlyOnceWith(
      { voiceId: joe, locale: "en", ratePercent: 100, volumePercent: 80 },
      "Review the updated baseline in VDT Studio.", expect.any(AbortSignal));
    await expect(speech.request(capture)).rejects.toThrow("before starting capture");
    await post({ operation: "stop", previewId: randomUUID() });
    await expect(speech.request(capture)).rejects.toThrow("before starting capture");
    expect((await post({ operation: "preview", voiceId: denis, confirmed: true })).status).toBe(409);
  } finally { await post({ operation: "stop", previewId: payload.previewId }); }
  const mic = await speech.request(capture);
  if (!("state" in mic) || mic.state !== "open") throw new Error("Expected a capture lease.");
  try {
    expect((await post({ operation: "preview", voiceId: joe, confirmed: true })).status).toBe(409);
  } finally { await speech.request({ operation: "close_session", sessionId: mic.sessionId }); }
});

it("cancels rendering and releases the speech slot when the preview request disconnects", async () => {
  const controller = new AbortController();
  let ready!: (signal: AbortSignal) => void;
  const started = new Promise<AbortSignal>(resolve => { ready = resolve; });
  mockHost.synthesize.mockImplementationOnce(async (_voice, _text, signal) => {
    ready(signal);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const response = post({ operation: "preview", voiceId: denis, confirmed: true }, { signal: controller.signal });
  const renderer = await started;
  controller.abort();
  expect((await response).status).toBe(409);
  expect(renderer.aborted).toBe(true);
  const again = await post({ operation: "preview", voiceId: joe, confirmed: true });
  expect(again.status).toBe(200);
  await post({ operation: "stop", previewId: (await again.json()).previewId });
});
