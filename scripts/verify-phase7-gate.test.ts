import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_RUN_TASK_TYPES, CANONICAL_TASK_TYPES, verifyPhase7Gate } from "./verify-phase7-gate.mjs";

const tempDirs: string[] = [];

async function writeStaticFixture(options: { readme?: string; runTaskParser?: string } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vdt-phase7-fixture-"));
  tempDirs.push(root);

  await mkdir(path.join(root, "packages/vdt-core/src"), { recursive: true });
  await mkdir(path.join(root, "packages/model-bridge/src"), { recursive: true });
  await mkdir(path.join(root, "apps/web/app/api/ai/run-task"), { recursive: true });
  await mkdir(path.join(root, "apps/web/app/api/ai/generate-vdt"), { recursive: true });
  await mkdir(path.join(root, "apps/web/components/vdt"), { recursive: true });
  await mkdir(path.join(root, "apps/web/lib"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });

  await writeFile(
    path.join(root, "packages/vdt-core/src/types.ts"),
    [`export type VdtAiTaskType =`, ...CANONICAL_TASK_TYPES.map((taskType) => `  | "${taskType}"`), ";"].join("\n")
  );
  await writeFile(path.join(root, "packages/vdt-core/package.json"), JSON.stringify({ name: "@vdt-studio/vdt-core" }));
  await writeFile(
    path.join(root, "packages/model-bridge/src/contract.ts"),
    'import type { VdtAiTaskType } from "@vdt-studio/vdt-core";\nexport type { VdtAiTaskType };\n'
  );
  await writeFile(
    path.join(root, "packages/model-bridge/package.json"),
    JSON.stringify({ name: "@vdt-studio/model-bridge", dependencies: { "@vdt-studio/vdt-core": "workspace:*" } })
  );
  await writeFile(
    path.join(root, "apps/web/app/api/ai/run-task/parse-run-task-request.ts"),
    options.runTaskParser ??
      [
        ...CANONICAL_RUN_TASK_TYPES.filter((taskType) => taskType !== "generate_tree").map((taskType) => `"${taskType}",`),
        'throw new Error("generate_tree must use /api/ai/generate-vdt.");'
      ].join("\n")
  );
  await writeFile(
    path.join(root, "apps/web/app/api/ai/run-task/route.ts"),
    "Bounded AI task route for web-runnable VDT AI actions.\n"
  );
  await writeFile(path.join(root, "apps/web/app/api/ai/generate-vdt/route.ts"), 'taskType: "generate_tree"\n');
  await writeFile(path.join(root, "apps/web/components/vdt/component.tsx"), "export const ok = true;\n");
  await writeFile(path.join(root, "apps/web/lib/lib.ts"), "export const ok = true;\n");
  await writeFile(
    path.join(root, "README.md"),
    options.readme ??
      `VDT Studio exposes 13 bounded AI tasks.\n${["agent_decision", ...CANONICAL_RUN_TASK_TYPES].map((taskType) => `\`${taskType}\``).join("\n")}\n`
  );
  await writeFile(path.join(root, "docs/ROADMAP.md"), "Phase 7 verification gate verified for bounded AI actions.\n");
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("verify-phase7-gate", () => {
  it("passes the current repository and runs all mock tasks", async () => {
    await expect(verifyPhase7Gate()).resolves.toMatchObject({
      taskCount: 14,
      schemaCount: 14,
      mockTaskCount: 12
    });
  });

  it("fails when README does not list bounded AI tasks", async () => {
    const root = await writeStaticFixture({ readme: "No AI action section.\n" });
    await expect(verifyPhase7Gate(root, { runMockSmoke: false })).rejects.toThrow(/README must list/);
  });

  it("fails when run-task stops rejecting generate_tree", async () => {
    const root = await writeStaticFixture({ runTaskParser: CANONICAL_RUN_TASK_TYPES.map((taskType) => `"${taskType}",`).join("\n") });
    await expect(verifyPhase7Gate(root, { runMockSmoke: false })).rejects.toThrow(/run-task route must reject generate_tree/);
  });
});
