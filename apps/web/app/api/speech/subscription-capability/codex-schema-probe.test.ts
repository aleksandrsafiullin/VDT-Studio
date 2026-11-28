import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { CODEX_SCHEMA_PROBE_SANDBOX } from "./codex-schema-probe";

const execute = promisify(execFile);

it.runIf(process.platform === "darwin")("reads only its own scratch and blocks unrelated files, aliases, and writes", async () => {
  const testRoot = await mkdtemp(join(await realpath(tmpdir()), "vdt-codex-speech-sandbox-test-"));
  try {
    const scratch = join(testRoot, "scratch");
    const permitted = join(scratch, "sample");
    const unrelated = join(testRoot, "unrelated");
    const alias = join(scratch, "alias");
    await mkdir(scratch, { mode: 0o700 });
    await writeFile(permitted, "allowed synthetic metadata", { mode: 0o600 });
    await writeFile(unrelated, "outside synthetic metadata", { mode: 0o600 });
    await symlink(unrelated, alias);

    const run = async (command: string, ...arguments_: string[]) => {
      const executable = await realpath(command);
      return execute("/usr/bin/sandbox-exec", ["-D", `SCRATCH=${scratch}`, "-D", `EXECUTABLE=${executable}`,
        "-p", CODEX_SCHEMA_PROBE_SANDBOX, executable, ...arguments_], {
        cwd: scratch, env: { NODE_ENV: "production", TMPDIR: scratch, PATH: "/usr/bin:/bin", LANG: "C" }, timeout: 2_000, maxBuffer: 2_048
      });
    };
    await expect(run("/bin/cat", permitted)).resolves.toMatchObject({ stdout: "allowed synthetic metadata" });
    await expect(run("/bin/cat", unrelated)).rejects.toMatchObject({ code: 1, stdout: "" });
    await expect(run("/bin/cat", alias)).rejects.toMatchObject({ code: 1, stdout: "" });
    await expect(run("/bin/ln", unrelated, join(scratch, "hard-link"))).rejects.toMatchObject({ code: 1 });
    await expect(run("/usr/bin/touch", join(scratch, "created"))).resolves.toBeDefined();
    await expect(run("/usr/bin/touch", join(testRoot, "outside-write"))).rejects.toMatchObject({ code: 1 });
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
});
