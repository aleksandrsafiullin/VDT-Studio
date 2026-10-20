import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SidecarProcessHost } from "./host";
import { parseSidecarFrame, SIDECAR_PROTOCOL_VERSION } from "./protocol";

const directories: string[] = [], hosts: SidecarProcessHost[] = [];
async function fixture(wait = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-native-smart-metadata-")); directories.push(directory);
  const home = path.join(directory, "codex-home"); await mkdir(home); await writeFile(path.join(home, "config.toml"), 'model = "synthetic-selected"\n');
  const started = path.join(directory, "probe-started");
  await writeFile(path.join(directory, "codex"), `#!${process.execPath}\nif(!process.argv.includes('--version'))process.exit(91);require('node:fs').writeFileSync(${JSON.stringify(started)},'started');console.log('codex-cli 0.146.0');${wait ? "setInterval(()=>{},1000)" : "process.exit(0)"}`, { mode: 0o700 });
  const host = new SidecarProcessHost({ command: process.execPath, args: ["--import", "tsx", fileURLToPath(new URL("./index.ts", import.meta.url))],
    env: { ...process.env, PATH: directory, HOME: directory, CODEX_HOME: home }, handshakeTimeoutMs: 15000 }); hosts.push(host);
  return { host, started };
}
afterEach(async () => { await Promise.all(hosts.splice(0).map(host => host.stop())); await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe.skipIf(process.platform === "win32")("native Smart metadata pipe", () => {
  it("admits exact host metadata through the real pipe with no model completion and stable re-admission", async () => {
    const { host } = await fixture();
    const first = await host.request("smart_execution", { backendId: "codex_subscription", timeoutMs: 1000 });
    expect(first).toMatchObject({ ok: true, identity: { backendId: "codex_subscription", modelId: "synthetic-selected", requestModel: "synthetic-selected", modelResolution: "exact" } });
    expect(await host.request("smart_execution", { backendId: "codex_subscription", timeoutMs: 1000 })).toEqual(first);
  });
  it("routes cancellation to the same live metadata request and awaits probe cleanup", async () => {
    const { host, started } = await fixture(true); const operation = await host.beginRequest("smart_execution", { backendId: "codex_subscription", timeoutMs: 5000 }); void operation.response.catch(() => {});
    for (let i = 0; i < 100 && !(await readFile(started).catch(() => undefined)); i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(await readFile(started, "utf8")).toBe("started"); await host.cancel(operation.requestId);
    await expect(operation.response).rejects.toMatchObject({ message: expect.stringContaining("CANCELLED") });
  });
  it("rejects endpoint/command overrides, wrong backends and oversized deadlines in the strict method", () => {
    for (const payload of [{ backendId: "ollama" }, { backendId: "codex_subscription", timeoutMs: 5001 }, { backendId: "codex_subscription", endpoint: "https://unselected.example" }]) {
      expect(() => parseSidecarFrame(JSON.stringify({ protocolVersion: SIDECAR_PROTOCOL_VERSION, type: "request", requestId: crypto.randomUUID(), method: "smart_execution", payload }))).toThrow();
    }
  });
});
