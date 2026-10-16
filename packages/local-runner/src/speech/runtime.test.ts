import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pcmWave } from "./audio";
import { parseSpeechRequest, SpeechRuntime, validateSpeechWave } from "./runtime";
import type { SpeechJobResult, SpeechStatus } from "./catalog";

const directories: string[] = [];
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), "vdt-speech-test-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("local speech runtime boundary", () => {
  it("requires explicit confirmation and rejects paths, executable arguments and arbitrary model names", () => {
    expect(() => parseSpeechRequest({ operation: "install", modelId: "base" })).toThrow(/Confirm/);
    expect(() => parseSpeechRequest({ operation: "install", modelId: "base", confirmed: true, url: "https://attacker.test/model" })).toThrow(/field/);
    expect(() => parseSpeechRequest({ operation: "install", modelId: "../../file", confirmed: true })).toThrow(/supported speech model/);
    expect(() => parseSpeechRequest({ operation: "status", executable: "sh" })).toThrow(/field/);
    expect(() => parseSpeechRequest({ operation: "constructor" })).toThrow(/Unsupported/);
    expect(() => parseSpeechRequest({ operation: "transcribe", modelId: "base", language: "--flag", audioBase64: "AA==", jobId: randomUUID() })).toThrow(/language/);
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
    expect(() => parseSpeechRequest({ operation: "transcribe", modelId: "base", language: "ru", jobId: randomUUID(), audioBase64: "A".repeat(600_000) })).toThrow(/too large/);
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

  it("returns immediately while inference runs and ignores a cancelled late result", async () => {
    let finish: (text: string) => void = () => undefined;
    const recognize = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", recognize });
    vi.spyOn(runtime, "status").mockResolvedValue({ supported: true, engineReady: true, installedModels: ["base"], installation: { state: "idle", downloadedBytes: 0, totalBytes: 0 } } satisfies SpeechStatus);
    const jobId = randomUUID();
    const audioBase64 = Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64");
    expect(await runtime.request({ operation: "transcribe", modelId: "base", language: "ru", audioBase64, jobId })).toEqual({ state: "processing" });
    await expect(runtime.request({ operation: "transcribe", modelId: "base", language: "ru", audioBase64, jobId: randomUUID() })).rejects.toThrow(/busy/);
    await runtime.request({ operation: "cancel", jobId });
    await expect(runtime.request({ operation: "transcribe", modelId: "base", language: "ru", audioBase64, jobId: randomUUID() })).rejects.toThrow(/busy/);
    finish("late text");
    await Promise.resolve();
    expect(await runtime.request({ operation: "result", jobId })).toEqual({ state: "cancelled" });
  });

  it("publishes successful recognition as text without sending an agent message", async () => {
    const runtime = new SpeechRuntime({ directory: await directory(), platform: "darwin", arch: "arm64", recognize: async () => "  Создай дерево прибыли.  " });
    vi.spyOn(runtime, "status").mockResolvedValue({ supported: true, engineReady: true, installedModels: ["base"], installation: { state: "idle", downloadedBytes: 0, totalBytes: 0 } });
    const jobId = randomUUID();
    await runtime.request({ operation: "transcribe", modelId: "base", language: "ru", audioBase64: Buffer.from(pcmWave(new Float32Array(16_000))).toString("base64"), jobId });
    await vi.waitFor(async () => expect(await runtime.request({ operation: "result", jobId })).toEqual({ state: "complete", text: "Создай дерево прибыли." } satisfies SpeechJobResult));
  });
});
