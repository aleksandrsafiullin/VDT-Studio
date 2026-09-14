import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "./types";

const helper = fileURLToPath(new URL("./sequence-3-transform.host-child.ts", import.meta.url));
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

type HostSuiteReport = {
  counts: { accepted: number; blocked: number };
  knownAnswers: Array<{
    id: string;
    expected: JsonValue;
    first: JsonValue;
    second: JsonValue;
  }>;
  mutated: JsonValue;
};

let hostSuitePromise: Promise<HostSuiteReport> | undefined;

function runHostSuiteInChild(): Promise<HostSuiteReport> {
  hostSuitePromise ??= new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", helper], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `Sequence 3 host suite child exited (code=${String(code)}, signal=${String(signal)}): ${
              stderr || stdout
            }`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as HostSuiteReport);
      } catch (error) {
        reject(
          new Error(
            `Sequence 3 host suite child returned invalid JSON: ${stdout}; ${String(error)}`
          )
        );
      }
    });
  });
  return hostSuitePromise;
}

// Child pays the ~105s inflate+parse; this worker stays free for Vitest RPC.
describe("Sequence 3 legacy-adoption host", { timeout: 240_000 }, () => {
  it("matches all 204 frozen host vectors exactly", async () => {
    const report = await runHostSuiteInChild();
    expect(report.counts).toEqual({ accepted: 36, blocked: 168 });
  });

  it("is deterministic for baseline and empty input known answers", async () => {
    const report = await runHostSuiteInChild();
    expect(report.knownAnswers.map((entry) => entry.id)).toEqual([
      "host.valid.baseline",
      "host.valid.empty_input"
    ]);
    for (const entry of report.knownAnswers) {
      expect(entry.first).toEqual(entry.expected);
      expect(entry.second).toEqual(entry.expected);
    }
  });

  it("rejects a successful module that mutates the input-output gap", async () => {
    const report = await runHostSuiteInChild();
    expect(report.mutated).toEqual({
      outcome: "blocked",
      code: "LAR_HOST_WASM_OUTPUT",
      failingRowIndex: 0,
      failingColumn: null,
      persistedBlockedReason: "postcondition_failed"
    });
  });
});
