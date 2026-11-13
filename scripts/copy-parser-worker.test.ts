import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { copyParserWorker, verifyParserWorker } from "./copy-parser-worker.mjs";

const owned: string[] = [];
afterEach(async () => { for (const directory of owned.splice(0)) await rm(directory, { recursive: true, force: true }); });

it("copies verified worker bytes beside CLI entrypoints and rejects a later modification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vdt-parser-package-")); owned.push(root);
  const source = path.join(root, "packages/data-harness/src"), destination = path.join(root, "dist");
  await mkdir(source, { recursive: true }); await mkdir(destination);
  const bytes = "worker fixture";
  const manifest = { schemaVersion: 1, entrypoint: "parser-worker.cjs", byteLength: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") };
  await writeFile(path.join(source, "parser-worker.cjs"), bytes);
  await writeFile(path.join(source, "parser-worker.manifest.json"), JSON.stringify(manifest));
  expect(copyParserWorker(destination, root)).toMatchObject(manifest);
  expect(await readFile(path.join(destination, "parser-worker.cjs"), "utf8")).toBe(bytes);
  await writeFile(path.join(destination, "parser-worker.cjs"), "stale output");
  expect(() => verifyParserWorker(destination)).toThrow(/digest/);
  expect(await readFile(path.join(source, "parser-worker.cjs"), "utf8")).toBe(bytes);
});
