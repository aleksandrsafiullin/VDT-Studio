import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDarwinSandboxProfile, wrapDarwinSandbox } from "./darwin";
import { wrapSandbox } from "./index";

const isDarwin = process.platform === "darwin";
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("wrapSandbox platform routing", () => {
  it("returns unsupported diagnostic on non-darwin", () => {
    if (isDarwin) return;
    const result = wrapSandbox("/bin/echo", ["ok"], {
      profile: {
        tempCwd: "/tmp/vdt-run",
        repoCwd: "/repo",
        providerExecutable: "/usr/bin/echo"
      }
    });
    expect(result.command).toBe("/bin/echo");
    expect(result.args).toEqual(["ok"]);
    expect(result.diagnostic).toMatch(/unsupported/i);
    expect(result.profilePath).toBeUndefined();
  });
});

describe.skipIf(!isDarwin)("darwin sandbox profile", () => {
  it("contains deny rules for repo reads and allows network, temp, and provider binary", () => {
    const tempCwd = "/private/tmp/vdt-run-abc";
    const repoCwd = "/Users/dev/VDT Design/vdt-studio";
    const providerExecutable = "/usr/local/bin/agent";
    const profile = buildDarwinSandboxProfile({
      tempCwd,
      repoCwd,
      providerExecutable,
      homeDir: "/Users/dev",
      allowedReadPaths: ["/Users/dev/.cursor"],
      deniedReadPaths: ["/Users/dev/project"]
    });

    expect(profile).toContain("(deny default)");
    expect(profile).toContain(`(allow file-write* (subpath "${tempCwd}"))`);
    expect(profile).toContain(`(allow process-exec (literal "${providerExecutable}"))`);
    expect(profile).toContain(`(deny file-read* (subpath "${repoCwd}"))`);
    expect(profile).toContain(`(require-not (subpath "${tempCwd}"))`);
    expect(profile).toContain('(require-not (subpath "/Users/dev/.cursor"))');
    expect(profile).toContain('(deny file-read* (subpath "/Users/dev/project"))');
    expect(profile).not.toContain("(allow file-write* (subpath \"/Users/dev/project\"))");
  });

  it("wrapDarwinSandbox returns sandbox-exec command with profile file", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-wrap-");
    const wrapped = wrapDarwinSandbox(process.execPath, ["-e", "process.exit(0)"], {
      profile: {
        tempCwd,
        repoCwd: process.cwd(),
        providerExecutable: process.execPath
      }
    });

    expect(wrapped.command).toBe("sandbox-exec");
    expect(wrapped.args[0]).toBe("-f");
    expect(wrapped.args[1]).toBe(wrapped.profilePath);
    expect(wrapped.args[2]).toBe("--");
    expect(wrapped.args[3]).toBe(process.execPath);
    await expect(readFile(wrapped.profilePath!, "utf8")).resolves.toContain("(deny default)");
  });

  it("allows the provider executable to read and write inside the temp cwd", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-positive-");
    const probeScript = path.join(tempCwd, "positive-probe.cjs");
    const outputPath = path.join(tempCwd, "result.txt");
    await writeFile(
      probeScript,
      [
        "const { readFileSync, writeFileSync } = require('node:fs');",
        "const value = readFileSync(__filename, 'utf8');",
        "writeFileSync(process.env.OUTPUT_PATH, value.includes('positive-probe') ? 'ok' : 'bad');",
        "process.stdout.write('ok');"
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 }
    );
    const wrapped = wrapDarwinSandbox(process.execPath, [probeScript], {
      profile: { tempCwd, repoCwd: process.cwd(), providerExecutable: process.execPath }
    });
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: tempCwd,
        env: { PATH: process.env.PATH, NO_COLOR: "1", OUTPUT_PATH: outputPath },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    expect(result).toMatchObject({ code: 0, signal: null, stdout: "ok" });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("ok");
  }, 30_000);

  it("blocks honey-file reads outside the temp cwd", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-honey-");
    const repoCwd = await makeTempDir("vdt-sandbox-repo-");
    const honeyPath = path.join(repoCwd, "honey.txt");
    await writeFile(honeyPath, "secret", { encoding: "utf8", mode: 0o600 });

    const profile = buildDarwinSandboxProfile({
      tempCwd,
      repoCwd,
      providerExecutable: process.execPath
    });
    expect(profile).toContain(path.basename(repoCwd));

    const probeScript = path.join(tempCwd, "probe.cjs");
    await writeFile(
      probeScript,
      [
        "const { readFileSync } = require('node:fs');",
        "const target = process.env.HONEY_PATH;",
        "if (!target) {",
        "  process.stderr.write('HONEY_PATH missing');",
        "  process.exit(1);",
        "}",
        "try {",
        "  const value = readFileSync(target, 'utf8');",
        "  console.log(`LEAKED:${value}`);",
        "  process.exit(0);",
        "} catch (error) {",
        "  const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN';",
        "  console.error(String(code));",
        "  process.exit(1);",
        "}"
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 }
    );

    const wrapped = wrapDarwinSandbox(process.execPath, [probeScript], {
      profile: {
        tempCwd,
        repoCwd,
        providerExecutable: process.execPath
      }
    });

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: tempCwd,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, NO_COLOR: "1", HONEY_PATH: honeyPath },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });

    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("LEAKED:secret");
    expect(result.stderr).not.toContain("secret");
  }, 30_000);

  it("blocks reads from the temp root outside the request directory", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-temp-read-");
    const outsideDir = await makeTempDir("vdt-sandbox-temp-outside-");
    const outsidePath = path.join(outsideDir, "outside.txt");
    await writeFile(outsidePath, "temp-secret", { encoding: "utf8", mode: 0o600 });

    const probeScript = path.join(tempCwd, "temp-read-probe.cjs");
    await writeFile(
      probeScript,
      [
        "const { readFileSync } = require('node:fs');",
        "try {",
        "  process.stdout.write(`LEAKED:${readFileSync(process.env.OUTSIDE_PATH, 'utf8')}`);",
        "  process.exit(0);",
        "} catch (error) {",
        "  process.stderr.write(String(error && error.code ? error.code : 'blocked'));",
        "  process.exit(1);",
        "}"
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 }
    );
    const wrapped = wrapDarwinSandbox(process.execPath, [probeScript], {
      profile: { tempCwd, repoCwd: process.cwd(), providerExecutable: process.execPath }
    });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: tempCwd,
        env: { PATH: process.env.PATH, NO_COLOR: "1", OUTSIDE_PATH: outsidePath },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("LEAKED:temp-secret");
  }, 30_000);

  it("blocks writes outside the ephemeral temp cwd", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-write-");
    const outsideDir = await makeTempDir("vdt-sandbox-outside-");
    const outsidePath = path.join(outsideDir, "should-not-exist.txt");
    const probeScript = path.join(tempCwd, "write-probe.cjs");
    await writeFile(
      probeScript,
      "require('node:fs').writeFileSync(process.env.OUTSIDE_PATH, 'unsafe');",
      { encoding: "utf8", mode: 0o700 }
    );
    const wrapped = wrapDarwinSandbox(process.execPath, [probeScript], {
      profile: { tempCwd, repoCwd: process.cwd(), providerExecutable: process.execPath }
    });
    const result = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: tempCwd,
        env: { PATH: process.env.PATH, OUTSIDE_PATH: outsidePath },
        stdio: "ignore"
      });
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(result).not.toBe(0);
    await expect(readFile(outsidePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("blocks unrelated shell execution", async () => {
    const tempCwd = await makeTempDir("vdt-sandbox-shell-");
    const probeScript = path.join(tempCwd, "shell-probe.cjs");
    await writeFile(
      probeScript,
      [
        "const { spawnSync } = require('node:child_process');",
        "const result = spawnSync('/bin/sh', ['-c', 'echo unsafe'], { encoding: 'utf8' });",
        "if (result.status === 0) {",
        "  process.stdout.write(result.stdout);",
        "  process.exit(0);",
        "}",
        "process.stderr.write(String(result.error?.code || result.status || 'blocked'));",
        "process.exit(1);"
      ].join("\n"),
      { encoding: "utf8", mode: 0o700 }
    );
    const wrapped = wrapDarwinSandbox(process.execPath, [probeScript], {
      profile: { tempCwd, repoCwd: process.cwd(), providerExecutable: process.execPath }
    });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(wrapped.command, wrapped.args, {
        cwd: tempCwd,
        env: { PATH: process.env.PATH, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).not.toContain("unsafe");
  }, 30_000);
});

describe.skipIf(isDarwin)("darwin sandbox tests skipped", () => {
  it("documents darwin-only integration coverage", () => {
    expect(process.platform).not.toBe("darwin");
  });
});
