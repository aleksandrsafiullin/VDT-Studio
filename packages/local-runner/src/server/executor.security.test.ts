import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { BackendManifest } from "../cli/types";
import { executeCompletion } from "./executor";
import { createManifestRegistry } from "./manifests";

const fakeBackend = fileURLToPath(new URL("./fixtures/fake-backend.mjs", import.meta.url));
const fakeCursor = fileURLToPath(new URL("./fixtures/fake-cursor.cjs", import.meta.url));
const tempDirs: string[] = [];

function customManifest(args: readonly string[] = ["valid"]): BackendManifest {
  return {
    id: "secure_custom",
    label: "Secure custom test backend",
    kind: "custom_cli",
    supportLevel: "experimental",
    taskTypes: ["generate_tree"],
    schemaIds: ["connection-test-v1", "generate-tree-v1"],
    modelSelection: false,
    cli: { executableAliases: ["secure-custom"], args, versionArgs: ["--version"] },
    safety: { toolsDisabled: true, requiresOsSandbox: false, certified: true }
  };
}

function request(schemaId = "connection-test-v1") {
  return {
    requestId: crypto.randomUUID(),
    backendId: "secure_custom",
    taskType: "generate_tree" as const,
    schemaId,
    input: { probe: true }
  };
}

function cursorManifestWithoutSandbox(): BackendManifest {
  const manifest = createManifestRegistry().get("cursor_subscription")!;
  return {
    ...manifest,
    safety: {
      toolsDisabled: false,
      requiresOsSandbox: false,
      certified: true,
      ephemeralWorkspaceOnly: true,
      trustEphemeralWorkspace: true
    }
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("executor security boundary", () => {
  it("rejects relative and NUL-containing resolved executables before spawn", async () => {
    await expect(
      executeCompletion(customManifest(), request(), new AbortController().signal, {
        resolveExecutable: async () => "relative-tool"
      })
    ).rejects.toMatchObject({ code: "UNSAFE_EXECUTABLE" });

    await expect(
      executeCompletion(customManifest(), request(), new AbortController().signal, {
        resolveExecutable: async () => `${process.execPath}\0suffix`
      })
    ).rejects.toMatchObject({ code: "UNSAFE_EXECUTABLE" });
  });

  it("rejects dangerous, NUL and path-traversal manifest arguments before spawn", async () => {
    for (const arg of ["--force", "safe\0unsafe", "../secret", "/tmp/vdt/../secret"]) {
      await expect(
        executeCompletion(customManifest([arg]), request(), new AbortController().signal, {
          resolveExecutable: async () => fakeBackend
        })
      ).rejects.toMatchObject({ code: "UNSAFE_CLI_ARGS", arg });
    }
  });

  it("filters secrets from child environment and localizes reviewed script execution to the temp cwd", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-executor-security-"));
    tempDirs.push(tempRoot);
    let captured:
      | {
          command: string;
          args: readonly string[];
          cwd: string | undefined;
          env: NodeJS.ProcessEnv | undefined;
        }
      | undefined;

    const result = await executeCompletion(
      customManifest(["valid"]),
      request(),
      new AbortController().signal,
      {
        tempRoot,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          SECRET_TOKEN: "never-leak",
          OPENAI_API_KEY: "sk-never"
        },
        resolveExecutable: async () => fakeBackend,
        spawn: (command, args, options) => {
          captured = {
            command,
            args,
            cwd: typeof options.cwd === "string" ? options.cwd : undefined,
            env: options.env
          };
          const child = new EventEmitter() as any;
          child.stdin = new PassThrough();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          setImmediate(() => {
            child.stdout.end(JSON.stringify({ ok: true }));
            child.stderr.end();
            child.emit("close", 0);
          });
          return child;
        }
      }
    );

    expect(result.schemaValid).toBe(true);
    expect(result.output).toMatchObject({ ok: true });
    expect(captured?.command).toBe(process.execPath);
    expect(captured?.args[0]).toContain(path.basename(tempRoot));
    expect(captured?.args[0]).not.toBe(fakeBackend);
    expect(captured?.cwd).toContain(path.basename(tempRoot));
    expect(captured?.env).toMatchObject({ NO_COLOR: "1" });
    expect(captured?.env).toHaveProperty("PATH");
    expect(captured?.env).not.toHaveProperty("SECRET_TOKEN");
    expect(captured?.env).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("runs external JavaScript CLIs from their install path", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-executor-install-js-"));
    tempDirs.push(tempRoot);
    const installedScript = path.join(tempRoot, "codex.js");
    await writeFile(installedScript, "#!/usr/bin/env node\n", { encoding: "utf8" });
    let captured:
      | {
          command: string;
          args: readonly string[];
          cwd: string | undefined;
        }
      | undefined;

    const result = await executeCompletion(
      customManifest(["valid"]),
      request(),
      new AbortController().signal,
      {
        tempRoot,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME
        },
        resolveExecutable: async () => installedScript,
        spawn: (command, args, options) => {
          captured = {
            command,
            args,
            cwd: typeof options.cwd === "string" ? options.cwd : undefined
          };
          const child = new EventEmitter() as any;
          child.stdin = new PassThrough();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          setImmediate(() => {
            child.stdout.end(JSON.stringify({ ok: true }));
            child.stderr.end();
            child.emit("close", 0);
          });
          return child;
        }
      }
    );

    expect(result.schemaValid).toBe(true);
    expect(captured?.command).toBe(process.execPath);
    expect(captured?.args[0]).toMatch(/codex\.js$/);
    expect(captured?.args[0]).toContain(path.basename(tempRoot));
    expect(captured?.args[0]).not.toContain("vdt-run-");
    expect(captured?.cwd).toContain(path.basename(tempRoot));
  });

  it("preserves Cursor data dir auth in ephemeral workspace mode", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-cursor-state-"));
    tempDirs.push(tempRoot);
    let captured:
      | {
          args: readonly string[];
          cwd: string | undefined;
          env: NodeJS.ProcessEnv | undefined;
        }
      | undefined;

    const result = await executeCompletion(
      cursorManifestWithoutSandbox(),
      {
        ...request(),
        backendId: "cursor_subscription"
      },
      new AbortController().signal,
      {
        tempRoot,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        resolveExecutable: async () => fakeCursor,
        spawn: (_command, args, options) => {
          captured = {
            args,
            cwd: typeof options.cwd === "string" ? options.cwd : undefined,
            env: options.env
          };
          const child = new EventEmitter() as any;
          child.stdin = new PassThrough();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          setImmediate(() => {
            child.stdout.end(`${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify({ ok: true }) })}\n`);
            child.stderr.end();
            child.emit("close", 0);
          });
          return child;
        }
      }
    );

    expect(result.schemaValid).toBe(true);
    expect(captured?.args).toEqual(expect.arrayContaining(["--mode", "ask"]));
    expect(captured?.args).not.toContain("--force");
    expect(captured?.cwd).toContain(path.basename(tempRoot));
    expect(captured?.env).not.toHaveProperty("CURSOR_DATA_DIR");
    expect(captured?.env?.NODE_COMPILE_CACHE).toBe(path.join(captured?.cwd ?? "", "node-compile-cache"));
  });

  it("uses a writable ephemeral Codex home instead of mutating the user Codex home", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-home-"));
    const sourceHome = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-source-home-"));
    tempDirs.push(tempRoot, sourceHome);
    await writeFile(path.join(sourceHome, ".keep"), "", { encoding: "utf8" });
    const sourceCodexHome = path.join(sourceHome, ".codex");
    await mkdir(sourceCodexHome, { recursive: true });
    await writeFile(path.join(sourceCodexHome, "auth.json"), '{"tokens":"redacted"}', { encoding: "utf8" });
    await writeFile(path.join(sourceCodexHome, "installation_id"), "test-installation", { encoding: "utf8" });
    const manifest = createManifestRegistry().get("codex_subscription")!;
    let captured:
      | {
          args: readonly string[];
          cwd: string | undefined;
          env: NodeJS.ProcessEnv | undefined;
        }
      | undefined;

    const result = await executeCompletion(
      manifest,
      {
        ...request(),
        backendId: "codex_subscription"
      },
      new AbortController().signal,
      {
        tempRoot,
        env: { PATH: process.env.PATH, HOME: sourceHome },
        resolveExecutable: async () => fakeBackend,
        spawn: (_command, args, options) => {
          captured = {
            args,
            cwd: typeof options.cwd === "string" ? options.cwd : undefined,
            env: options.env
          };
          const child = new EventEmitter() as any;
          child.stdin = new PassThrough();
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = () => true;
          setImmediate(() => {
            child.stdout.end(
              [
                JSON.stringify({ type: "thread.started", thread_id: "test-thread" }),
                JSON.stringify({ type: "turn.started" }),
                JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify({ ok: true }) } }),
                JSON.stringify({ type: "turn.completed" })
              ].join("\n")
            );
            child.stderr.end();
            child.emit("close", 0);
          });
          return child;
        }
      }
    );

    expect(result.schemaValid).toBe(true);
    expect(captured?.args).toEqual(expect.arrayContaining(["--ephemeral", "--ignore-rules"]));
    expect(captured?.env?.CODEX_HOME).toBe(path.join(captured?.cwd ?? "", "codex-home"));
    expect(captured?.env?.CODEX_HOME).not.toBe(sourceCodexHome);
  });

  it("rejects tool-capable cursor manifests without sandbox or ephemeral workspace certification", async () => {
    const manifest = createManifestRegistry().get("cursor_subscription")!;
    await expect(
      executeCompletion(
        {
          ...manifest,
          safety: {
            toolsDisabled: false,
            requiresOsSandbox: false,
            certified: true,
            trustEphemeralWorkspace: true
          }
        },
        { ...request(), backendId: "cursor_subscription" },
        new AbortController().signal,
        { resolveExecutable: async () => fakeCursor }
      )
    ).rejects.toMatchObject({ code: "UNSAFE_CONFIGURATION" });
  });
});
