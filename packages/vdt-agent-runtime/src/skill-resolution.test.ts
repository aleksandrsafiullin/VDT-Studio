import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAvailableSkillLibrary, pinAvailableSkill } from "@vdt-studio/vdt-agent";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { LocalSkillRepository } from "@vdt-studio/storage";
import { AgentRunStore } from "./run-store";
import type { AgentToolContext } from "./tool-registry";
import { createDefaultToolRegistry } from "./tools";
import type { VdtAgentStartRequest } from "./types";

const excavation = "mining.excavation";
const haulage = "mining.haulage_truck_cycle";
const workspace = { projectId: "skill_resolution_project", vdtId: "skill_resolution_tree" };

function skillRun(options: Partial<VdtAgentStartRequest> = {}) {
  const store = new AgentRunStore();
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Output", projectTitle: "Output" });
  const state = store.createRun({
    mode: "continue_project", providerId: "model_agent",
    input: { rootKpi: "Output", project: builder.getProject() },
    skillResolution: { selectionRevision: 0 },
    ...options
  });
  const { runId } = state;
  const tools = createDefaultToolRegistry();
  const context: AgentToolContext = {
    runId, store, builder, signal: state.abortController.signal,
    emit: (event) => store.appendEvent(runId, event),
    getRun: () => store.getSnapshot(runId),
    updateRun: (patch) => store.updateRun(runId, patch)
  };
  return { state: () => store.getState(runId), call: (name: string, args: object = {}) => tools.run(name, args, context) };
}

describe("semantic skill selection on the local tool registry", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vdt-f08-skill-tests-"));
    vi.stubEnv("VDT_DATA_DIR", dataDir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("requires an exact read receipt and preserves a concurrent explicit Context choice", async () => {
    const repository = new LocalSkillRepository(dataDir);
    await loadAvailableSkillLibrary(repository);
    const auto = await pinAvailableSkill("generic.logical_kpi_decomposition", "auto", "Context preview.", undefined, repository);
    const manual = await pinAvailableSkill(haulage, "user", "Chosen in Context.", undefined, repository);
    const provisional = skillRun({ workspace });
    expect(await provisional.call("vdt.create_draft", { rootKpi: "Output" })).toMatchObject({
      ok: false, error: { code: "SKILL_RESOLUTION_REQUIRED" }
    });
    expect(await provisional.call("skill.search", { rootKpi: "Ore haulage" })).toMatchObject({
      ok: false, error: { code: "SKILL_DISCOVERY_REQUIRED" }
    });
    await provisional.call("skill.list");
    const read = await provisional.call("skill.read", { skillId: excavation });
    expect(read.ok).toBe(true);
    const readReceiptId = (read.output as { readReceiptId: string }).readReceiptId;
    expect(provisional.state().selectedSkills).toEqual([]);
    expect(await provisional.call("skill.select", { skillId: haulage, readReceiptId, reason: "Another candidate." })).toMatchObject({
      ok: false, error: { code: "SKILL_READ_REQUIRED" }
    });

    repository.select(workspace.projectId, workspace.vdtId, {
      skillId: auto.id, contentHash: auto.contentHash, version: auto.version, source: auto.source, reason: auto.reason, rootKpi: "Output"
    }, 0);
    const choose = { skillId: excavation, readReceiptId, reason: "The request is about production from the working face." };
    expect(await provisional.call("skill.select", choose)).toMatchObject({ ok: true });
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toMatchObject({ skillId: excavation, revision: 2, source: "agent" });
    expect(await provisional.call("skill.compile_recipe", { skillId: haulage })).toMatchObject({
      ok: false, error: { code: "SKILL_SELECTION_REQUIRED" }
    });

    const stale = skillRun({ workspace, skillResolution: { selectionRevision: 2 } });
    await stale.call("skill.list");
    const nextRead = await stale.call("skill.read", { skillId: excavation });
    repository.select(workspace.projectId, workspace.vdtId, {
      skillId: manual.id, contentHash: manual.contentHash, version: manual.version, source: manual.source, reason: manual.reason, rootKpi: "Output"
    }, 2);
    expect(await stale.call("skill.select", { ...choose, readReceiptId: (nextRead.output as { readReceiptId: string }).readReceiptId })).toMatchObject({
      ok: false, error: { code: "SKILL_CONFLICT" }
    });
    expect(stale.state().selectedSkills).toEqual([]);
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toMatchObject({ skillId: haulage, revision: 3, source: "user" });

    const pinned = skillRun({ workspace, input: { rootKpi: "Output", skillSelection: manual }, skillResolution: { selectionRevision: 3 } });
    const pinRead = await pinned.call("skill.read", { skillId: haulage });
    expect(pinRead.output).toMatchObject({ id: haulage, version: manual.version, contentHash: manual.contentHash });
    expect(pinned.state().request.skillResolution?.outcome).toBe("selected");
    await pinned.call("skill.list");
    const alternative = await pinned.call("skill.read", { skillId: excavation });
    expect(await pinned.call("skill.select", { ...choose, readReceiptId: (alternative.output as { readReceiptId: string }).readReceiptId })).toMatchObject({
      ok: false, error: { code: "SKILL_USER_PINNED" }
    });
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toMatchObject({ skillId: haulage, revision: 3, source: "user" });
  });

  it("bounds catalog pages and waits for review of positive scoped search results before a partial gap", async () => {
    const repository = new LocalSkillRepository(dataDir);
    for (let index = 0; index < 8; index += 1) {
      const id = `user.catalog_fixture_${index}`;
      repository.files.create("", id, id, [
        "---", `id: ${id}`, "version: 1", `title: ${id}`, "domain: custom",
        `description: ${JSON.stringify("Local sample context. ".repeat(80))}`,
        "patterns:", "  - catalog fixture", "kpi_patterns:", "  - fixture KPI",
        "requires:", "  - fixture input", "outputs:", "  - fixture result",
        "---", "Data for a catalog-bound regression."
      ].join("\n"));
    }
    const run = skillRun();
    expect(await run.call("skill.list", { offset: 16 })).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_OFFSET_UNKNOWN" } });
    const first = await run.call("skill.list");
    const page = first.output as { skills: Array<{ description: string }>; nextOffset: number };
    expect(page.skills).toHaveLength(16);
    expect(page.skills.every((card) => card.description.length <= 300)).toBe(true);
    expect(page.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mining.excavation", scopeGuidance: expect.arrayContaining([expect.stringContaining("excavation-only")]) }),
      expect.objectContaining({ id: "mining.production_volume", scopeGuidance: expect.arrayContaining([expect.stringContaining("mining production volume")]) })
    ]));
    expect(page.nextOffset).toBe(16);
    const reason = { reason: "The available processes do not cover the user’s request." };
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    const search = await run.call("skill.search", { rootKpi: "Truck cycle time", maxSkills: 1 });
    const { candidates } = search.output as { candidates: Array<{ id: string }> };
    expect(candidates).toHaveLength(1);
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    expect(await run.call("skill.read", { skillId: candidates[0]!.id })).toMatchObject({ ok: true });
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: true, output: { outcome: "no_applicable_skill" } });
    expect(run.state().selectedSkills).toEqual([]);
    expect(run.state().events.find((event) => event.metadata?.outcome === "no_applicable_skill")?.metadata).toMatchObject({
      catalogComplete: false, scopedSearchReviewed: true, searchCandidateIds: [candidates[0]!.id]
    });
    expect(await run.call("skill.list", { offset: page.nextOffset })).toMatchObject({ ok: true, output: { nextOffset: null } });
  });
});
