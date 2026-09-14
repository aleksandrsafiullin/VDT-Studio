import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkpointTransportError,
  isModelContractViolation,
  sameCanonicalWorkspacePath,
  wrapSpawnCountingRunner
} from "./checkpoint-transport-common";
import { ActionBatchContractError } from "./action-batch";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("sameCanonicalWorkspacePath", () => {
  it("treats parent-symlink aliases of the same directory as equal", async () => {
    const workspace = await temporaryDirectory("vdt-canonical-workspace-");
    const canonical = await realpath(workspace);
    expect(sameCanonicalWorkspacePath(canonical, canonical)).toBe(true);
    if (workspace !== canonical) {
      expect(sameCanonicalWorkspacePath(workspace, canonical)).toBe(true);
    }
    const alias = path.join(await temporaryDirectory("vdt-canonical-alias-"), "workspace");
    await symlink(canonical, alias, "dir");
    expect(sameCanonicalWorkspacePath(alias, canonical)).toBe(true);
  });

  it("rejects a different directory, relative paths, and unresolvable paths", async () => {
    const workspace = await realpath(await temporaryDirectory("vdt-canonical-workspace-"));
    const other = await realpath(await temporaryDirectory("vdt-canonical-other-"));
    expect(sameCanonicalWorkspacePath(other, workspace)).toBe(false);
    expect(sameCanonicalWorkspacePath(".", workspace)).toBe(false);
    expect(sameCanonicalWorkspacePath("/tmp/does-not-exist-vdt-canonical", workspace)).toBe(false);
    expect(sameCanonicalWorkspacePath(null, workspace)).toBe(false);
  });

  it("rejects a post-spawn symlink swap that two-sided realpath would accept", async () => {
    const workspace = await realpath(await temporaryDirectory("vdt-canonical-workspace-"));
    const other = await realpath(await temporaryDirectory("vdt-canonical-other-"));
    await rm(workspace, { recursive: true, force: true });
    await symlink(other, workspace, "dir");
    expect(sameCanonicalWorkspacePath(other, workspace)).toBe(false);
  });

  it("rejects .. traversal outward and a child symlink that points outward", async () => {
    const workspace = await realpath(await temporaryDirectory("vdt-canonical-workspace-"));
    const other = await realpath(await temporaryDirectory("vdt-canonical-other-"));
    expect(sameCanonicalWorkspacePath(path.join(workspace, ".."), workspace)).toBe(false);
    expect(sameCanonicalWorkspacePath(path.join(workspace, "..", path.basename(other)), workspace)).toBe(false);
    const child = path.join(workspace, "outward");
    await symlink(other, child, "dir");
    expect(sameCanonicalWorkspacePath(child, workspace)).toBe(false);
  });
});

describe("wrapSpawnCountingRunner", () => {
  it("increments on each run() invocation, independently of segment count", async () => {
    const calls: string[] = [];
    const runner = wrapSpawnCountingRunner({
      async run(request: { id: string }) {
        calls.push(request.id);
        return { stdout: request.id, stderr: "" };
      }
    });
    await runner.run({ id: "a" });
    await runner.run({ id: "b" });
    await runner.run({ id: "c" });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(runner.processSpawnCount).toBe(3);
  });
});

describe("isModelContractViolation", () => {
  it("treats action-batch and protocol codes as model output failures", () => {
    expect(isModelContractViolation(new ActionBatchContractError(
      "ACTION_BATCH_CONTROL_TOOL_MIXED",
      "run.request_finish must be the only call in an action batch."
    ))).toBe(true);
    expect(isModelContractViolation(new ActionBatchContractError(
      "ACTION_BATCH_INVALID",
      "batch.calls is empty."
    ))).toBe(true);
    expect(isModelContractViolation(checkpointTransportError(
      "CODEX_CHECKPOINT_PROTOCOL_INVALID",
      "Codex output contains malformed JSONL."
    ))).toBe(true);
    expect(isModelContractViolation(checkpointTransportError(
      "CODEX_CHECKPOINT_PROTOCOL_AMBIGUOUS",
      "Two envelopes."
    ))).toBe(true);
    expect(isModelContractViolation(checkpointTransportError(
      "CURSOR_CHECKPOINT_PROTOCOL_MISMATCH",
      "Unknown event type."
    ))).toBe(true);
  });

  it("keeps security, process, configuration, and uncoded errors loud", () => {
    expect(isModelContractViolation(new ActionBatchContractError(
      "SECURITY_BOUNDARY_BREACH",
      "shell.exec is forbidden."
    ))).toBe(false);
    expect(isModelContractViolation(checkpointTransportError(
      "SECURITY_BOUNDARY_BREACH",
      "Codex attempted forbidden shell."
    ))).toBe(false);
    expect(isModelContractViolation(checkpointTransportError(
      "CODEX_CHECKPOINT_PROCESS_FAILED",
      "Codex reported a failed checkpoint turn."
    ))).toBe(false);
    expect(isModelContractViolation(checkpointTransportError(
      "CLAUDE_CHECKPOINT_CONFIGURATION_INVALID",
      "allowedToolNames must contain 1-100 tools."
    ))).toBe(false);
    expect(isModelContractViolation(new Error("sqlite disk I/O failed"))).toBe(false);
    expect(isModelContractViolation("not an error")).toBe(false);
  });
});
