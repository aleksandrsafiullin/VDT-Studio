import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureSeparateOpenAiVoiceCredential, separateOpenAiVoiceFingerprint, withSeparateOpenAiVoiceCredential } from "./separate-openai-voice-credential";

const variable = "VDT_OPENAI_VOICE_API_KEY_FILE";
let directory: string;
let keyPath: string;
beforeEach(() => {
  directory = mkdtempSync(join(realpathSync(tmpdir()), "vdt-voice-file-"));
  keyPath = join(directory, "voice.key");
  writeFileSync(keyPath, "synthetic-voice-credential\n", { mode: 0o600 });
  vi.stubEnv("VDT_APP_MODE", "development_web");
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
});

afterEach(() => {
  vi.stubEnv(variable, "");
  captureSeparateOpenAiVoiceCredential();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true });
});

function configure(path: string) {
  vi.stubEnv(variable, path);
  captureSeparateOpenAiVoiceCredential();
  expect(process.env[variable]).toBeUndefined();
  return separateOpenAiVoiceFingerprint();
}

it.skipIf(typeof process.getuid !== "function")("keeps the private credential behind startup authority and an exact fingerprint", () => {
  const fingerprint = configure(keyPath)!;
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const use = vi.fn(() => "transport result");
  expect(withSeparateOpenAiVoiceCredential("wrong-fingerprint", use)).toBeUndefined();
  expect(use).not.toHaveBeenCalled();
  expect(withSeparateOpenAiVoiceCredential(fingerprint, use)).toBe("transport result");
  expect(use).toHaveBeenCalledExactlyOnceWith("synthetic-voice-credential");
});

it.skipIf(typeof process.getuid !== "function")("rejects broader permissions, symlink traversal, relative paths, directories and oversized content", () => {
  chmodSync(keyPath, 0o640);
  expect(configure(keyPath)).toBeUndefined();
  chmodSync(keyPath, 0o600);
  const symlink = join(directory, "linked-key");
  symlinkSync(keyPath, symlink);
  expect(configure(symlink)).toBeUndefined();
  const linkedDirectory = join(directory, "linked-dir");
  symlinkSync(directory, linkedDirectory);
  expect(configure(join(linkedDirectory, "voice.key"))).toBeUndefined();
  expect(configure("voice.key")).toBeUndefined();
  expect(configure(directory)).toBeUndefined();
  writeFileSync(keyPath, "x".repeat(1_027));
  expect(configure(keyPath)).toBeUndefined();
});

it("consumes a disabled or hosted configuration without exposing a credential", () => {
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "false");
  expect(configure(keyPath)).toBeUndefined();
  vi.stubEnv("VDT_OPENAI_SPEECH_BYOK_ENABLED", "true");
  vi.stubEnv("VDT_APP_MODE", "hosted_web");
  expect(configure(keyPath)).toBeUndefined();
  vi.stubEnv("VDT_APP_MODE", "desktop");
  expect(configure(keyPath)).toBeUndefined();
});

it.skipIf(process.platform !== "darwin")("rejects a macOS extended ACL granting another principal access despite mode 0600", () => {
  execFileSync("/bin/chmod", ["+a", "everyone allow read", keyPath], { stdio: "ignore" });
  expect(configure(keyPath)).toBeUndefined();
});
