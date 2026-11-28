import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { pcmWave } from "./audio";

it.skipIf(process.platform === "win32")("checks Whisper stdin consumption and leaves no audio after abrupt host exit", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "vdt-whisper-crash-test-"));
  try {
    const speech = path.join(fixture, "speech");
    const tmp = path.join(fixture, "tmp");
    const legacy = path.join(tmp, "vdt-speech-audio-legacy");
    const crashMarker = path.join(fixture, "synthetic-crash-reached");
    const installed = path.join(speech, "ggml-base.bin");
    await mkdir(speech);
    await mkdir(legacy, { recursive: true });
    await writeFile(installed, "installed model sentinel");
    await writeFile(path.join(legacy, "input.wav"), "legacy sentinel");
    await writeFile(path.join(tmp, "vdt-speech-audio-malformed"), "foreign sentinel");
    await symlink(speech, path.join(tmp, "vdt-speech-audio-symlink"));

    // The fake executable checks the binary contract without loading a model.
    const wav = pcmWave(Float32Array.from({ length: 16_000 }, (_, index) => Math.sin(index)));
    const audioHash = createHash("sha256").update(wav).digest("hex");
    await writeFile(path.join(speech, "whisper-cpp-darwin-arm64"), `#!${process.execPath}
const { createHash } = require("node:crypto");
const args = process.argv.slice(2);
if (args[args.indexOf("-f") + 1] !== "-" || args[args.indexOf("-of") + 1] !== "vdt-dictation") process.exit(2);
if (args.some(option => /^-o(?!f$)/.test(option))) process.exit(3);
const hash = createHash("sha256");
process.stdin.on("data", chunk => hash.update(chunk));
process.stdin.on("end", () => {
  if (hash.digest("hex") !== ${JSON.stringify(audioHash)}) process.exit(4);
  const mode = process.env.VDT_WHISPER_TEST_MODE;
  if (mode === "crash") {
    require("node:fs").writeFileSync(${JSON.stringify(crashMarker)}, "stdin verified");
    process.kill(process.ppid, "SIGKILL");
    return;
  }
  if (mode === "missing") {
    process.stdout.write("untrusted transcript");
    return;
  }
  const bytes = mode === "mismatch" ? ${wav.byteLength - 1} : ${wav.byteLength};
  process.stderr.write("read_audio_data: read ");
  setTimeout(() => {
    process.stderr.write(bytes + " bytes from stdin" + (mode === "truncated" ? "" : "\\r\\n"));
    if (mode === "transcript") process.stdout.write("Проверка [SILENCE]");
  }, 20);
});
`, { mode: 0o700 });

    const app = `
      import { SpeechRuntime } from ${JSON.stringify(new URL("./runtime.ts", import.meta.url).href)};
      import { pcmWave } from ${JSON.stringify(new URL("./audio.ts", import.meta.url).href)};
      process.env.TMPDIR = ${JSON.stringify(tmp)};
      const directory = process.env.VDT_WHISPER_TEST_DIR;
      const runtime = new SpeechRuntime({ directory, platform: "darwin", arch: "arm64" });
      const wav = pcmWave(Float32Array.from({ length: 16_000 }, (_, index) => Math.sin(index)));
      try {
        console.log(await runtime.recognize(directory + "/ggml-base.bin", wav, "ru", new AbortController().signal));
      } catch (error) {
        console.log(error.message);
        process.exitCode = 5;
      }
    `;
    const error = "Local recognition failed. Try the Tiny model or restart dictation.";
    for (const [mode, expectedCode, expectedSignal, expectedOutput] of [
      ["transcript", 0, null, "Проверка"],
      ["silence", 0, null, ""],
      ["missing", 5, null, error],
      ["mismatch", 5, null, error],
      ["truncated", 5, null, error],
      ["crash", null, "SIGKILL", ""]
    ] as const) {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>((resolve, reject) => {
        const host = spawn(process.execPath, [
          "--import", fileURLToPath(import.meta.resolve("tsx")), "--input-type=module", "--eval", app
        ], {
          cwd: fixture, env: { ...process.env, VDT_WHISPER_TEST_DIR: speech, VDT_WHISPER_TEST_MODE: mode },
          stdio: ["ignore", "pipe", "ignore"], timeout: 8_000, killSignal: "SIGKILL"
        });
        let stdout = "";
        host.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
        host.once("error", reject);
        host.once("close", (code, signal) => resolve({ code, signal, stdout: stdout.trim() }));
      });
      expect(result, mode).toEqual({ code: expectedCode, signal: expectedSignal, stdout: expectedOutput });
      if (mode === "crash") await expect(readFile(crashMarker, "utf8")).resolves.toBe("stdin verified");
      expect((await readdir(tmp)).sort()).toEqual([
        "vdt-speech-audio-legacy", "vdt-speech-audio-malformed", "vdt-speech-audio-symlink"
      ]);
      expect((await readdir(speech)).sort()).toEqual(["ggml-base.bin", "whisper-cpp-darwin-arm64"]);
      await expect(readFile(path.join(legacy, "input.wav"), "utf8")).resolves.toBe("legacy sentinel");
      await expect(readFile(path.join(tmp, "vdt-speech-audio-malformed"), "utf8")).resolves.toBe("foreign sentinel");
      await expect(readFile(path.join(tmp, "vdt-speech-audio-symlink", "ggml-base.bin"), "utf8")).resolves.toBe("installed model sentinel");
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 20_000);
