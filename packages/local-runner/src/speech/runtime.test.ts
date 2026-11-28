import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SIDECAR_PROTOCOL_VERSION, parseSidecarFrame } from "../sidecar/protocol";
import { pcmWave } from "./audio";
import { parseSpeechRequest, SpeechRuntime, validateSpeechWave } from "./runtime";
import { createAppleVoiceAdapter, type AppleVoiceAdapter } from "./apple-voice";
import { speechRouteEligible } from "./admission";
import type { SpeechAnalyticsMode, SpeechJobResult, SpeechSelection, SpeechSessionAdmission, SpeechStatus } from "./catalog";

const directories: string[] = [];
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-speech-test-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function selection(mode: SpeechAnalyticsMode = "local"): SpeechSelection {
  return {
    version: 1, analytics: { mode, providerId: "selected_analytics", modelId: "model_1" },
    scopeId: "project-a/vdt-b", language: "ru",
    stt: { providerId: "whisper_local", modelId: "base" }, tts: null, realtime: null
  };
}

const ready: SpeechStatus = {
  supported: true, engineReady: true, installedModels: ["base"],
  installation: { state: "idle", downloadedBytes: 0, totalBytes: 0 }
};

async function open(runtime: SpeechRuntime, options = selection()): Promise<SpeechSessionAdmission> {
  return await runtime.request({ operation: "open_session", selection: options }) as SpeechSessionAdmission;
}

describe("local speech runtime boundary", () => {
  it("requires explicit confirmation and rejects paths, executable arguments and arbitrary model names", () => {
    expect(() => parseSpeechRequest({ operation: "install", modelId: "base" })).toThrow(/Confirm/);
    expect(() => parseSpeechRequest({ operation: "install", modelId: "base", confirmed: true, url: "https://attacker.test/model" })).toThrow(/field/);
    expect(() => parseSpeechRequest({ operation: "install", modelId: "../../file", confirmed: true })).toThrow(/supported speech model/);
    expect(() => parseSpeechRequest({ operation: "status", executable: "sh" })).toThrow(/field/);
    expect(() => parseSpeechRequest({ operation: "constructor" })).toThrow(/Unsupported/);
    expect(() => parseSpeechRequest({ operation: "open_session", selection: { ...selection(), language: "--flag" } })).toThrow(/language/);
  });

  it("preserves the closed selection and session tokens through the private IPC frame", () => {
    for (const payload of [
      { operation: "open_session", selection: selection("cli_subscription") },
      { operation: "transcribe", sessionId: randomUUID(), jobId: randomUUID(), audioBase64: "AA==" },
      { operation: "close_session", sessionId: randomUUID() }
    ]) {
      const message = parseSidecarFrame(JSON.stringify({
        protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId: randomUUID(), method: "speech", payload
      }));
      expect(message).toMatchObject({ method: "speech", payload });
      expect(parseSpeechRequest(payload)).toEqual(payload);
    }
  });

  it("never treats a partial model file as installed", async () => {
    const dir = await directory();
    await writeFile(path.join(dir, "ggml-base.bin"), "incomplete model");
    const runtime = new SpeechRuntime({ directory: dir, platform: "darwin", arch: "arm64" });
    expect(await runtime.status()).toMatchObject({ supported: true, engineReady: false, installedModels: [] });
  });

  it.each(["darwin-arm64", "darwin-x64", "win32-x64"])("provides an installer for %s without requiring development tools", async (target) => {
    const [platform, arch] = target.split("-");
    expect((await new SpeechRuntime({ directory: await directory(), platform: platform!, arch: arch! }).status()).supported).toBe(true);
  });

  it("fails closed for unsupported hosts", async () => {
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "linux", arch: "x64" });
    expect((await runtime.status()).supported).toBe(false);
    await expect(runtime.request({ operation: "install", modelId: "base", confirmed: true })).rejects.toThrow(/supports macOS/);
  });

  it("bounds audio and rejects malformed WAV headers before launching recognition", () => {
    const wav = Buffer.from(pcmWave(new Float32Array(16_000)));
    validateSpeechWave(wav);
    wav.writeUInt32LE(48_000, 24);
    expect(() => validateSpeechWave(wav)).toThrow(/16 kHz/);
    expect(() => validateSpeechWave(Buffer.from(pcmWave(new Float32Array(16_000 * 13))))).toThrow(/bounded/);
    expect(() => parseSpeechRequest({ operation: "transcribe", sessionId: randomUUID(), jobId: randomUUID(), audioBase64: "A".repeat(600_000) })).toThrow(/too large/);
  });

  it("rejects a bad download, cleans only its staging files and permits retry", async () => {
    const dir = await directory();
    await writeFile(path.join(dir, "keep.txt"), "unrelated");
    const fetcher = vi.fn(async () => new Response("bad archive"));
    const runtime = new SpeechRuntime({ directory: dir, platform: "darwin", arch: "arm64", fetcher });
    await runtime.request({ operation: "install", modelId: "tiny", confirmed: true });
    await vi.waitFor(async () => expect((await runtime.status()).installation.state).toBe("error"));
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual(["keep.txt"]));
    expect((await runtime.status()).engineReady).toBe(false);
    await runtime.request({ operation: "install", modelId: "tiny", confirmed: true });
    await vi.waitFor(async () => expect(fetcher).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual(["keep.txt"]));
  });

  it("cancels a pending download and cleans its staging directory", async () => {
    const dir = await directory();
    const fetcher: typeof fetch = async (_input, options) => {
      const signal = options?.signal;
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
    };
    const runtime = new SpeechRuntime({ directory: dir, platform: "darwin", arch: "arm64", fetcher });
    await runtime.request({ operation: "install", modelId: "base", confirmed: true });
    await runtime.request({ operation: "cancel_install" });
    await vi.waitFor(async () => expect((await runtime.status()).installation.state).toBe("cancelled"));
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });

  it("rejects altered engine bytes even when the download has the expected size", async () => {
    const dir = await directory();
    const runtime = new SpeechRuntime({ directory: dir, platform: "darwin", arch: "arm64", fetcher: async () => new Response(new Uint8Array(1_215_153)) });
    await runtime.request({ operation: "install", modelId: "base", confirmed: true });
    await vi.waitFor(async () => expect((await runtime.status()).installation).toMatchObject({ state: "error", error: expect.stringContaining("verification") }));
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
  });

  it.each(["local", "cli_subscription", "api_keys", "legacy"] as const)(
    "admits installed local Whisper for %s and rejects unimplemented routes before any download or inference",
    async (mode) => {
      const fetcher = vi.fn<typeof fetch>();
      const recognize = vi.fn();
      const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", fetcher, recognize });
      const status = vi.spyOn(runtime, "status").mockResolvedValue(ready);
      const requested = selection(mode);
      for (const blocked of [
        { ...requested, stt: null },
        { ...requested, stt: { providerId: "api", modelId: "cloud-recognizer" } },
        { ...requested, stt: { providerId: "subscription", modelId: "cli-recognizer" } },
        { ...requested, stt: { providerId: "apple_local", modelId: "system-recognizer" } },
        { ...requested, tts: { providerId: "apple_local", modelId: "system-voice" } },
        { ...requested, realtime: { providerId: "api", modelId: "realtime" } }
      ]) {
        await expect(runtime.request({ operation: "open_session", selection: blocked })).rejects.toThrow(/unavailable|unified voice/);
      }
      await expect(runtime.request({ operation: "open_session", selection: {
        ...requested, stt: { ...requested.stt, boundary: "on_device", consent: "explicit_component", billing: "none" }
      } })).rejects.toThrow(/unsupported or missing field/);
      expect(status).not.toHaveBeenCalled();

      const admission = await open(runtime, requested);
      expect(admission).toMatchObject({ analytics: requested.analytics, language: "ru", scopeId: "project-a/vdt-b",
        stt: { providerId: "whisper_local", modelId: "base", boundary: "on_device", billing: "none", credential: { kind: "none" },
          consent: "explicit_component", scope: "bound_voice_session" }, tts: null, realtime: null });
      await expect(open(runtime, { ...requested, scopeId: "project-other/vdt-other" })).rejects.toThrow(/owns the microphone/);
      await runtime.request({ operation: "close_session", sessionId: admission.sessionId });
      expect(fetcher).not.toHaveBeenCalled();
      expect(recognize).not.toHaveBeenCalled();
    }
  );

  it.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
    "rechecks the host helper resolver for every process and rejects a symlink at the package path", async () => {
      const dir = await realpath(await directory());
      const executable = path.join(dir, "vdt-apple-voice");
      const payload = JSON.stringify({ status: "ok", boundary: "on_device",
        recognition: [{ locale: "en", systemLocale: "en-US", status: "asset_required" }], installedVoices: [] });
      const fixture = path.join(dir, "fixture");
      await writeFile(fixture, `#!/bin/sh
printf '%s\n' '${payload}'
`, { mode: 0o700 });
      await symlink(fixture, executable);
      const verifiedHelper = vi.fn(async () => executable);
      const adapter = createAppleVoiceAdapter(verifiedHelper);
      await expect(adapter.status()).rejects.toThrow(/helper is unavailable/);
      await rm(executable, { force: true });
      await writeFile(executable, await readFile(fixture), { mode: 0o700 });
      await expect(adapter.status()).resolves.toMatchObject({ supported: true, recognition: [{ locale: "en", status: "asset_required" }] });
      expect(verifiedHelper).toHaveBeenCalledTimes(2);
    }
  );

  it("uses only the host-native adapter for the exact installed recognition locale and fixed preview", async () => {
    const native: AppleVoiceAdapter = {
      status: vi.fn<AppleVoiceAdapter["status"]>(async () => ({
        state: "apple_voice_status", supported: true,
        recognition: [{ locale: "en", status: "installed" }, { locale: "ru", status: "unsupported_locale" }], voices: []
      })),
      recognize: vi.fn(async (_wave, language) => language === "en" ? "Two production stages." : ""),
      preview: vi.fn(async () => "AQID")
    };
    const options = { directory: await directory(), platform: "darwin", arch: "arm64" };
    const runtime = new SpeechRuntime({ ...options, appleVoice: native });
    const unconfigured = new SpeechRuntime(options);
    const request = {
      ...selection("local"), language: "en" as const, stt: { providerId: "apple_local", modelId: "system" } as const
    };
    await expect(unconfigured.request({ operation: "apple_status" })).resolves.toMatchObject({ supported: false });
    await expect(open(unconfigured, request)).rejects.toThrow(/unavailable/);
    await expect(open(runtime, { ...request, language: "ru" })).rejects.toThrow(/installed on-device assets/);
    expect(native.recognize).not.toHaveBeenCalled();

    const active = await open(runtime, request);
    expect(active.stt).toMatchObject({ providerId: "apple_local", modelId: "system", boundary: "on_device", billing: "none" });
    const preview = { locale: "en", voiceId: "approved-voice", ratePercent: 100, volumePercent: 70 };
    await expect(runtime.request({ operation: "apple_preview", preview })).rejects.toThrow(/Stop capture/);
    const jobId = randomUUID();
    await runtime.request({
      operation: "transcribe", sessionId: active.sessionId, jobId,
      audioBase64: Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64")
    });
    await vi.waitFor(async () => expect(await runtime.request({ operation: "result", sessionId: active.sessionId, jobId }))
      .toEqual({ state: "complete", text: "Two production stages." }));
    expect(native.recognize).toHaveBeenCalledOnce();
    expect(native.recognize).toHaveBeenCalledWith(expect.any(Uint8Array), "en", expect.any(AbortSignal));
    await runtime.request({ operation: "close_session", sessionId: active.sessionId });
    await expect(runtime.request({ operation: "apple_preview", preview: { ...preview, text: "external request" } })).rejects.toThrow(/field/);
    await expect(runtime.request({ operation: "apple_preview", preview })).resolves.toEqual({
      state: "apple_voice_preview", waveformBase64: "AQID"
    });
    expect(native.preview).toHaveBeenCalledExactlyOnceWith(preview);
  });

  it("requires fresh confirmation for an exact Apple locale and reports cancellation, retry and verified readiness", async () => {
    let installed = false;
    let finish: (() => void) | undefined;
    const install = vi.fn<NonNullable<AppleVoiceAdapter["install"]>>(async (_locale, _systemLocale, signal, progress) => {
      progress(0.4);
      await new Promise<void>((resolve, reject) => {
        finish = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const runtime = new SpeechRuntime({
      directory: await directory(), platform: "darwin", arch: "arm64",
      appleVoice: {
        status: async () => ({ state: "apple_voice_status", supported: true, voices: [], recognition: [
          { locale: "en", systemLocale: "en-US", status: installed ? "installed" : "asset_required" },
          { locale: "ru", status: "unsupported_locale" }
        ] }),
        recognize: vi.fn(),
        preview: vi.fn(),
        install
      }
    });
    const offer = async () => await runtime.request({ operation: "apple_install_offer", locale: "en" }) as { setupId: string };
    await runtime.request({ operation: "apple_status" });
    await expect(runtime.request({ operation: "apple_install_offer", locale: "ru" })).rejects.toThrow(/cannot use/);
    await expect(runtime.request({ operation: "apple_install", locale: "en", setupId: randomUUID(), confirmed: true })).rejects.toThrow(/fresh setup/);
    const first = await offer();
    const request = { operation: "apple_install", locale: "en", setupId: first.setupId };
    await expect(runtime.request(request)).rejects.toThrow(/Confirm/);
    await expect(runtime.request({ ...request, locale: "ru", confirmed: true })).rejects.toThrow(/fresh setup/);
    expect(install).not.toHaveBeenCalled();

    await expect(runtime.request({ ...request, confirmed: true })).resolves.toMatchObject({ phase: "preparing" });
    await vi.waitFor(async () => expect(await runtime.request({ operation: "apple_install_status", setupId: first.setupId }))
      .toMatchObject({ phase: "downloading", fraction: 0.4 }));
    await expect(runtime.request({ operation: "apple_cancel_install", setupId: first.setupId })).resolves.toMatchObject({ phase: "cancelling" });
    await vi.waitFor(async () => expect(await runtime.request({ operation: "apple_install_status", setupId: first.setupId }))
      .toMatchObject({ phase: "cancelled" }));
    await expect(runtime.request({ ...request, confirmed: true })).rejects.toThrow(/fresh setup/);

    const second = await offer();
    await runtime.request({ ...request, setupId: second.setupId, confirmed: true });
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(install.mock.calls.every(([locale, systemLocale]) => locale === "en" && systemLocale === "en-US")).toBe(true);
    expect((await runtime.request({ operation: "apple_status" }))).toMatchObject({ recognition: [expect.objectContaining({ status: "asset_required" }), expect.anything()] });
    installed = true;
    finish?.();
    await vi.waitFor(async () => expect(await runtime.request({ operation: "apple_install_status", setupId: second.setupId }))
      .toMatchObject({ phase: "ready", locale: "en" }));
  });

  it("keeps a silent capture reserved and expires an abandoned session without reassigning its token", async () => {
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64" });
    vi.spyOn(runtime, "status").mockResolvedValue(ready);
    let time = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    try {
      const first = await open(runtime);
      time += 90_000;
      await expect(runtime.request({ operation: "keep_session", sessionId: first.sessionId })).resolves.toEqual({ state: "active" });
      time += 90_000;
      await expect(open(runtime)).rejects.toThrow(/owns the microphone/);
      time += 31_000;
      const second = await open(runtime);
      expect(second.sessionId).not.toBe(first.sessionId);
      await expect(runtime.request({ operation: "keep_session", sessionId: first.sessionId })).rejects.toThrow(/expired/);
      await runtime.request({ operation: "close_session", sessionId: second.sessionId });
    } finally { clock.mockRestore(); }
  });

  it("keeps setup separate and revokes outstanding jobs and prior session access on a scope change", async () => {
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", fetcher: vi.fn<typeof fetch>() });
    await expect(open(runtime)).rejects.toThrow(/Download the selected speech model/);

    let aborted: AbortSignal | undefined;
    let complete!: (text: string) => void;
    const recognize = vi.fn((_model: string, _audio: Uint8Array, _language: string, signal: AbortSignal) => {
      aborted = signal;
      return new Promise<string>((resolve) => { complete = resolve; });
    });
    const installed = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", recognize });
    vi.spyOn(installed, "status").mockResolvedValue(ready);
    const first = await open(installed);
    const jobId = randomUUID();
    const audioBase64 = Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64");
    await expect(installed.request({ operation: "transcribe", sessionId: randomUUID(), jobId, audioBase64 })).rejects.toThrow(/expired/);
    await expect(installed.request({ operation: "transcribe", sessionId: first.sessionId, jobId, audioBase64, modelId: "small" })).rejects.toThrow(/field/);
    expect(recognize).not.toHaveBeenCalled();
    await installed.request({ operation: "transcribe", sessionId: first.sessionId, jobId, audioBase64 });
    expect(recognize).toHaveBeenCalledOnce();
    await installed.request({ operation: "close_session", sessionId: first.sessionId });
    expect(aborted?.aborted).toBe(true);
    complete("late discarded words");
    const second = await open(installed, { ...selection("api_keys"), scopeId: "project-new/vdt-new" });
    await expect(installed.request({ operation: "result", sessionId: first.sessionId, jobId })).rejects.toThrow(/expired/);
    await expect(installed.request({ operation: "result", sessionId: second.sessionId, jobId })).rejects.toThrow(/expired/);
    await installed.request({ operation: "close_session", sessionId: second.sessionId });
  });

  it("requires explicit component consent and the corresponding trusted paid-route grant", () => {
    const local = { component: "stt", boundary: "on_device", billing: "none" } as const;
    const api = { component: "realtime", boundary: "provider_service", billing: "api" } as const;
    const subscription = { component: "tts", boundary: "provider_service", billing: "subscription" } as const;
    const consent = { explicitComponentConsent: true };
    for (const mode of ["local", "legacy", "cli_subscription", "api_keys"] as const) {
      expect(speechRouteEligible(mode, local, { explicitComponentConsent: false })).toBe(false);
      expect(speechRouteEligible(mode, local, consent)).toBe(true);
      expect(speechRouteEligible(mode, { ...local, component: "realtime" }, consent)).toBe(false);
      expect(speechRouteEligible(mode, api, consent)).toBe(false);
      expect(speechRouteEligible(mode, api, { ...consent, explicitApiBilling: true })).toBe(mode === "api_keys" || mode === "cli_subscription");
      expect(speechRouteEligible(mode, api, { explicitComponentConsent: false, explicitApiBilling: true })).toBe(false);
      expect(speechRouteEligible(mode, subscription, { ...consent, verifiedSubscription: true })).toBe(mode === "cli_subscription");
      expect(speechRouteEligible(mode, subscription, consent)).toBe(false);
    }
  });

  it("returns immediately while inference runs and ignores a cancelled late result", async () => {
    let finish: (text: string) => void = () => undefined;
    const recognize = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", recognize });
    vi.spyOn(runtime, "status").mockResolvedValue(ready);
    const { sessionId } = await open(runtime);
    const jobId = randomUUID();
    const audioBase64 = Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64");
    expect(await runtime.request({ operation: "transcribe", sessionId, audioBase64, jobId })).toEqual({ state: "processing" });
    await expect(runtime.request({ operation: "transcribe", sessionId, audioBase64, jobId: randomUUID() })).rejects.toThrow(/busy/);
    await runtime.request({ operation: "cancel", jobId, sessionId });
    await expect(runtime.request({ operation: "transcribe", sessionId, audioBase64, jobId: randomUUID() })).rejects.toThrow(/busy/);
    finish("late text");
    await Promise.resolve();
    expect(await runtime.request({ operation: "result", jobId, sessionId })).toEqual({ state: "cancelled" });
  });

  it("publishes successful recognition as text without sending an agent message", async () => {
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", recognize: async () => "  Создай дерево прибыли.  " });
    vi.spyOn(runtime, "status").mockResolvedValue(ready);
    const { sessionId } = await open(runtime);
    const jobId = randomUUID();
    await runtime.request({ operation: "transcribe", sessionId, audioBase64: Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64"), jobId });
    await vi.waitFor(async () => expect(await runtime.request({ operation: "result", jobId, sessionId })).toEqual({ state: "complete", text: "Создай дерево прибыли." } satisfies SpeechJobResult));
  });
});
