import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSubscriptionCliModels } from "../../detection";
import { listCodexModels } from "./adapter";

const directories: string[] = [];
const visibleModels = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

async function catalogExecutable(instructionBytes: number) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vdt-codex-catalog-test-"));
  directories.push(directory);
  const executable = path.join(directory, "codex");
  const models = [...visibleModels.map((slug) => ({ slug, visibility: "list" })),
    { slug: "gpt-reserve", visibility: "hide" }, { slug: "codex-auto-review", visibility: "hide" }];
  // Matches the captured nine-record envelope, with synthetic text instead of provider instructions.
  await writeFile(executable, `#!${process.execPath}\nconst models = ${JSON.stringify(models)};\nfor (const model of models) model.base_instructions = 'x'.repeat(${instructionBytes});\nprocess.stdout.write(JSON.stringify({ models }));\n`, { mode: 0o700 });
  return executable;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("Codex raw catalog process limits", () => {
  for (const [name, list] of [
    ["adapter", listCodexModels],
    ["compatibility discovery", (executable: string) => discoverSubscriptionCliModels("codex", executable)]
  ] as const) {
    it(`reads a valid catalog larger than 512 KiB through default ${name}`, async () => {
      const executable = await catalogExecutable(64 * 1024);
      const result = await list(executable);
      expect(result).toEqual(expect.arrayContaining(visibleModels));
      if (name === "adapter") expect(result).toEqual(visibleModels);
    });

    it(`rejects catalog output above 2 MiB through default ${name}`, async () => {
      const executable = await catalogExecutable(256 * 1024);
      await expect(list(executable)).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
    });
  }
});
