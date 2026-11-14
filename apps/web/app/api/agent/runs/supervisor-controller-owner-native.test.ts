import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { admitPackagedWindowsStorage } from "@vdt-studio/storage";
import path from "node:path";
import { expect, it } from "vitest";
import { supervisorFenceOwnership, supervisorOwnerDeath, supervisorProcessOwner } from "./supervisor-controller-owner";

const runtime = process.env.VDT_WINDOWS_DATA_TEST_RUNTIME;
const parent = process.env.VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT;

it.runIf(process.platform === "win32" && Boolean(runtime && parent))("uses real Windows identity to deny a live controller and recognize its death", async () => {
  const scope = mkdtempSync(path.join(parent!, "owner-proof-"));
  const admission = admitPackagedWindowsStorage(runtime!, path.join(scope, "parent"));
  try {
    const owner = supervisorProcessOwner();
    expect(Boolean(owner), "Verified Windows addon registry and boot GUID discovery").toBe(true);
    const child = fork(path.resolve("apps/web/app/api/agent/runs/fixtures/supervisor-native-owner-child.ts"), [runtime!, path.join(scope, "child")], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("apps/web/tsconfig.json") }
    });
    const exited = once(child, "exit");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    try {
      const message = once(child, "message").then(([value]) => value);
      const token = await Promise.race([
        message,
        exited.then(() => { throw new Error(`Owner child exited before reporting identity: ${stderr}`); }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Native owner discovery exceeded 12 seconds.")), 12_000);
        })
      ]);
      if (typeof token !== "string" || !token.startsWith("agent-process-owner:v2:")) throw new Error("Native owner token was unavailable.");
      expect(supervisorFenceOwnership(token, owner)).toBe("foreign");
      expect(supervisorOwnerDeath(token, owner)).toBe("alive");
      expect(child.kill("SIGKILL")).toBe(true);
      await exited;
      expect(supervisorOwnerDeath(token, owner)).toBe("dead");
    } finally {
      if (timer) clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  } finally {
    admission.close();
    rmSync(scope, { recursive: true, force: true });
  }
}, 30_000);
