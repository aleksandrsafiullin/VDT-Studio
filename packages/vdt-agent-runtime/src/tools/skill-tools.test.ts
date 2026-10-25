import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { draftSkillMarkdown, publishManagedSkill } from "@vdt-studio/vdt-agent";
import { LocalSkillRepository } from "@vdt-studio/storage";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { AgentRunStore } from "../run-store";
import { ToolRegistry, type AgentToolContext } from "../tool-registry";
import { createSkillTools } from "./skill-tools";

describe("skill tools", () => {
  it("keeps a read custom version pinned after edits and persists the agent choice for Context", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vdt-skill-runtime-"));
    vi.stubEnv("VDT_DATA_DIR", dir);
    try {
      const raw = draftSkillMarkdown({ title: "Custom process", description: "A custom process method", domain: "operations", patterns: ["Custom output"], instructions: "Multiply the measured production rate by active operating time. Keep all time units consistent." });
      const first = publishManagedSkill({ raw });
      const { registry, context, store, runId } = testRegistry();
      const request = store.getState(runId).request;
      store.updateRun(runId, { request: { ...request, workspace: { projectId: "p", vdtId: "v" } } });
      await registry.run("skill.read", { skillId: first.id }, context);
      publishManagedSkill({ id: first.id, expectedVersion: 1, raw: raw.replace("Custom process", "Changed process") });
      const read = await registry.run("skill.read", { skillId: first.id }, context);
      expect(read.output).toMatchObject({ version: 1, title: "Custom process", contentHash: first.contentHash });
      expect((await registry.run("skill.select", { skillId: first.id, reason: "This custom method fits the changed process." }, context)).ok).toBe(true);
      expect(new LocalSkillRepository().getSelection("p", "v")).toMatchObject({ skillId: first.id, version: 1, contentHash: first.contentHash, source: "agent" });
    } finally { vi.unstubAllEnvs(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("requires a successful read before explicit selection and replaces the primary skill", async () => {
    const { registry, context, store, runId } = testRegistry();
    const args = { skillId: "finance.revenue_profit", reason: "The request changed to operating profit." };
    expect((await registry.run("skill.select", args, context)).error?.code).toBe("SKILL_READ_REQUIRED");
    await registry.run("skill.read", { skillId: args.skillId }, context);
    expect((await registry.run("skill.select", args, context)).ok).toBe(true);
    expect(store.getState(runId).selectedSkills).toMatchObject([{ id: args.skillId, source: "agent", version: 2, reason: args.reason }]);
    expect(store.getState(runId).request.input.skillSelection?.contentHash).toMatch(/^sha256:/);
    await registry.run("skill.read", { skillId: "mining.excavation" }, context);
    await registry.run("skill.select", { skillId: "mining.excavation", reason: "Excavation is now the requested process." }, context);
    expect(store.getState(runId).selectedSkills.map(skill => skill.id)).toEqual(["mining.excavation"]);
  });
  it("keeps skill.read selection-neutral", async () => {
    const { registry, context, store, runId } = testRegistry();

    const result = await registry.run("skill.read", {
      skillId: "mining.excavation"
    }, context);

    expect(result.ok).toBe(true);
    expect(store.getState(runId).selectedSkills).toEqual([]);
  });

  it("returns recipe quality, source, and warnings from skill.compile_recipe", async () => {
    const { registry, context, store, runId } = testRegistry();

    const result = await registry.run("skill.compile_recipe", {
      skillId: "mining.drill_and_blast"
    }, context);

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      skillId: "mining.drill_and_blast",
      recipeQuality: "complete",
      recipeSource: "template",
      warnings: expect.any(Array)
    });
    expect(store.getState(runId).selectedSkills.map((skill) => skill.id)).toEqual([
      "mining.drill_and_blast"
    ]);
  });

  it("does not seed a missing generic-support recipe as a domain draft", async () => {
    const builder = new VdtBuilderSession({ now: () => "2026-07-01T00:00:00.000Z" });
    builder.createDraft({ projectTitle: "Custom KPI", rootKpi: "Custom KPI" });
    const { registry, context, store, runId } = testRegistry(builder);
    store.updateRun(runId, {
      recipes: [{
        skillId: "mining.unseeded_process",
        recipeQuality: "missing",
        recipeSource: "generic_fallback",
        requiredInputs: ["driver_logic"],
        questions: [],
        initialDrivers: [],
        formulaTemplates: [],
        deepenRules: [],
        warnings: ["Executable recipe missing."]
      }]
    });

    const result = await registry.run("skill.seed_draft_from_recipe", {
      skillId: "mining.unseeded_process",
      rootKpi: "Custom KPI"
    }, context);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "RECIPE_INCOMPLETE"
    });
  });
});

function testRegistry(builder?: VdtBuilderSession) {
  const store = new AgentRunStore({ now: () => "2026-07-01T00:00:00.000Z" });
  const run = store.createRun({
    mode: "generate_vdt",
    input: { rootKpi: "Mining KPI" },
    providerId: "mock",
    options: { autoApplyPatches: true }
  });
  if (builder) store.updateRun(run.runId, { builder, draftProject: builder.getProject() });
  const registry = new ToolRegistry();
  for (const tool of createSkillTools()) registry.register(tool);
  const context = {
    runId: run.runId,
    store,
    emit: (event) => store.appendEvent(run.runId, event),
    getRun: () => store.getSnapshot(run.runId),
    updateRun: (patch) => {
      store.updateRun(run.runId, patch);
    },
    builder,
    signal: run.abortController.signal
  } satisfies AgentToolContext;
  return { registry, context, store, runId: run.runId };
}
