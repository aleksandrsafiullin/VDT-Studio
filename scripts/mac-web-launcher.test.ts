import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const launcher = fileURLToPath(new URL("./mac-web-launcher.mjs", import.meta.url));

it.skipIf(process.platform !== "darwin")("leaves an unrelated HTTP listener alive even when a legacy PID file names it", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "vdt-mac-launcher-"));
  const foreign = spawn(process.execPath, ["-e", `
    const server = require("node:http").createServer((_, response) => response.end("foreign"));
    server.listen(0, "127.0.0.1", () => process.send(server.address().port));
  `], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const closed = once(foreign, "close");
  try {
    const [port] = await once(foreign, "message", { signal: AbortSignal.timeout(5_000) }) as [number];
    mkdirSync(join(cwd, ".vdt"));
    writeFileSync(join(cwd, ".vdt/dev-web.pid"), String(foreign.pid));

    const run = (action: string) => spawnSync(process.execPath, [launcher, action, String(port)], {
      cwd, encoding: "utf8", timeout: 5_000
    });
    expect(run("status").stdout.trim()).toBe("occupied");
    const stop = run("stop");
    expect(stop.status).toBe(1);
    expect(stop.stderr).toContain("outside this launcher");
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2_000) });
    expect(await response.text()).toBe("foreign");
  } finally {
    foreign.kill("SIGTERM");
    await closed;
    rmSync(cwd, { recursive: true, force: true });
  }
});
