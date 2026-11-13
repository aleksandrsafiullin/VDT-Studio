import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [privateParent, output] = process.argv.slice(2);
assert(process.platform === "win32" && process.arch === "x64" && /^v24\./.test(process.version));
assert(privateParent && output, "Usage: probe PRIVATE_NTFS_PARENT OUTPUT");
const workspace = fs.mkdtempSync(path.join(privateParent, "self-kill-"));
try {
  const marker = path.join(workspace, "marker.json");
  const child = spawnSync(process.execPath, ["-e", `
    const fs = require('node:fs');
    const marker = process.argv[1];
    fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, requestedSignal: 'SIGKILL' }), { flag: 'wx' });
    process.kill(process.pid, 'SIGKILL');
    fs.writeFileSync(marker + '.continued', 'unexpected');
  `, marker], { timeout: 10_000, encoding: "utf8", windowsHide: true });
  assert.ifError(child.error);
  assert(!fs.existsSync(marker + ".continued"), "Self-killed child continued");
  const observation = {
    platform: process.platform, architecture: process.arch, nodeVersion: process.version,
    mechanism: "Child process.kill(process.pid, SIGKILL)",
    marker: JSON.parse(fs.readFileSync(marker, "utf8")), observedExitCode: child.status,
    observedSignal: child.signal, stderr: child.stderr
  };
  fs.writeFileSync(output, JSON.stringify(observation, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(observation));
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
