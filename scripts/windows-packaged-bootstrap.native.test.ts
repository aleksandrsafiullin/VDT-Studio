import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

const runtime = process.env.VDT_WINDOWS_DATA_TEST_RUNTIME;
const parent = process.env.VDT_WINDOWS_DATA_TEST_PRIVATE_PARENT;
const require = createRequire(import.meta.url);

test.runIf(process.platform === "win32" && Boolean(runtime && parent))(
  "activates the packaged Windows launcher and admits real storage through the Next startup hook",
  async () => {
    const fixture = fs.mkdtempSync(path.join(parent!, "packaged-launcher-"));
    const profile = path.join(fixture, "profile");
    const runtimeCopy = path.join(fixture, "runtime");
    fs.mkdirSync(runtimeCopy);
    const addon = fs.readFileSync(path.join(runtime!, "windows-storage.node"));
    fs.writeFileSync(path.join(runtimeCopy, "windows-storage.node"), addon);
    fs.writeFileSync(path.join(runtimeCopy, "windows-storage.manifest.json"), JSON.stringify({
      schemaVersion: 1, fileName: "windows-storage.node", architecture: "x64", nodeApiVersion: 8,
      nodeVersion: process.versions.node, sha256: createHash("sha256").update(addon).digest("hex"),
    }));
    fs.copyFileSync(path.resolve("apps/desktop/windows-runtime.cjs"), path.join(fixture, "windows-runtime.cjs"));
    const instrumentation = pathToFileURL(path.resolve("apps/web/instrumentation.ts")).href;
    const storage = pathToFileURL(path.resolve("packages/vdt-storage/src/index.ts")).href;
    fs.writeFileSync(path.join(fixture, "packaged-web.cjs"), `exports.start = async () => {
      const { register } = await import(${JSON.stringify(instrumentation)});
      await register();
      const { openVdtDatabase } = await import(${JSON.stringify(storage)});
      const db = openVdtDatabase(process.cwd(), { dataDir: process.env.VDT_DATA_DIR });
      try { console.log(JSON.stringify(db.listProjects())); } finally { db.close(); }
    };`);
    const child = spawn(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href,
      path.join(fixture, "windows-runtime.cjs"), "web"], {
      env: { ...process.env, NEXT_RUNTIME: "nodejs", VDT_APP_MODE: "desktop",
        VDT_WINDOWS_STORAGE_RUNTIME_DIR: runtimeCopy, VDT_DATA_DIR: profile },
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const done = once(child, "close");
    let output = "", stderr = "";
    child.stdout!.on("data", bytes => output += bytes);
    child.stderr!.on("data", bytes => stderr += bytes);
    try {
      expect(fs.existsSync(profile)).toBe(false);
      child.stdin!.end("start\n");
      expect((await done)[0], stderr).toBe(0);
      expect(JSON.parse(output)).toEqual([]);
      expect(fs.existsSync(path.join(profile, "app.sqlite"))).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await done;
      }
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }, 60_000,
);
