import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAvailableSkillLibrary, pinAvailableSkill } from "@vdt-studio/vdt-agent";
import { calculateGraph, VdtBuilderSession } from "@vdt-studio/vdt-core";
import { LocalSkillRepository } from "@vdt-studio/storage";
import { AgentRunStore } from "./run-store";
import { AgentToolError, type AgentToolContext } from "./tool-registry";
import { createDefaultToolRegistry } from "./tools";
import type { VdtAgentStartRequest } from "./types";

const excavation = "mining.excavation";
const haulage = "mining.haulage_truck_cycle";
const workspace = { projectId: "skill_resolution_project", vdtId: "skill_resolution_tree" };

function skillRun(options: Partial<VdtAgentStartRequest> = {}, assertSkillSelectionScope?: () => void) {
  const store = new AgentRunStore();
  const builder = new VdtBuilderSession();
  builder.createDraft({ rootKpi: "Output", projectTitle: "Output", ...(options.input?.unit ? { unit: options.input.unit } : {}) });
  const state = store.createRun({
    mode: "continue_project", providerId: "model_agent",
    input: { rootKpi: "Output", project: builder.getProject() },
    skillResolution: { selectionRevision: 0 },
    options: { autoApplyPatches: true },
    ...options
  });
  const { runId } = state;
  const tools = createDefaultToolRegistry();
  const context: AgentToolContext = {
    runId, store, builder, signal: state.abortController.signal, assertSkillSelectionScope,
    emit: (event) => store.appendEvent(runId, event),
    getRun: () => store.getSnapshot(runId),
    updateRun: (patch) => store.updateRun(runId, patch)
  };
  return {
    state: () => store.getState(runId),
    call: (name: string, args: object = {}) => tools.run(name, args, context),
    store, builder, runId
  };
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

  it("keeps scoped Skill excerpts within the review limit and honors explicit limits", async () => {
    const repository = new LocalSkillRepository(dataDir);
    const regularId = "user.volume_method";
    const longId = "user.volume_method_extended";
    const regularBody = `## Scope Boundary\n${"Measured operating volume. ".repeat(70)}Count completed items only.`;
    const longBody = `## Scope Boundary\n${"Measured operating volume. ".repeat(100)}Count completed items only.`;
    for (const [id, body] of [[regularId, regularBody], [longId, longBody]] as const) {
      repository.files.create("", id, id, [
        "---", `id: ${id}`, "version: 1", "title: Operating volume method", "domain: custom",
        "patterns:", "  - operating volume", "kpi_patterns:", "  - completed items",
        "requires:", "  - measured volume", "outputs:", "  - completed count", "---", body
      ].join("\n"));
    }

    const scoped = skillRun();
    expect(await scoped.call("skill.list")).toMatchObject({ ok: true });
    expect(await scoped.call("skill.read", { skillId: regularId })).toMatchObject({
      ok: true, output: { excerpt: regularBody }
    });
    expect(await scoped.call("skill.read", { skillId: regularId, maxChars: 200 })).toMatchObject({
      ok: true, output: { excerpt: `${regularBody.slice(0, 197).trimEnd()}...` }
    });
    expect(await scoped.call("skill.read", { skillId: longId })).toMatchObject({
      ok: true, output: { excerpt: `${longBody.slice(0, 2_396).trimEnd()}...` }
    });
    const legacy = skillRun({ skillResolution: undefined });
    expect(await legacy.call("skill.read", { skillId: regularId })).toMatchObject({
      ok: true, output: { excerpt: `${regularBody.slice(0, 1_797).trimEnd()}...` }
    });
  });

  it("recalls declared outputs only from current user scope after an empty exact agent search", async () => {
    const repository = new LocalSkillRepository(dataDir);
    const id = "user.window_diagnostics";
    repository.files.create("", id, id, [
      "---", `id: ${id}`, "version: 1", "title: Optical output assay", "domain: custom",
      "description: Verify instrument output.",
      "patterns:", "  - preflight instrument test", "kpi_patterns:", "  - lens accuracy",
      "requires:", "  - test reading", "outputs:", "  - panoramic_alignment",
      "---", "Inspect the calibration report and model its readings."
    ].join("\n"));

    const run = skillRun({ workspace, input: { rootKpi: "Output", prompt: "Model how panoramic the displayed image remains after adjustment." } });
    const project = run.builder.getProject();
    expect(await run.call("skill.list")).toMatchObject({ ok: true });
    expect(await run.call("skill.search", { rootKpi: "Displayed image" })).toMatchObject({
      ok: true, output: { candidates: [{ id, version: 1, contentHash: expect.stringMatching(/^sha256:/u) }] }
    });
    expect(await run.call("skill.search", { rootKpi: "Truck cycle time", maxSkills: 1 })).toMatchObject({
      ok: true, output: { candidates: [{ id: haulage }] }
    });
    run.store.appendChatMessage(run.runId, { role: "user", kind: "instruction",
      text: "Change the task to monthly review hours for digitized court recordings." });
    expect(await run.call("skill.search", { rootKpi: "Activity hours", businessContext: "Panoramic estimates" })).toMatchObject({
      ok: true, output: { candidates: [] }
    });
    run.store.appendChatMessage(run.runId, { role: "user", kind: "answer", text: "Panoramic placeholder.",
      answers: [{ questionId: "requested_output", selectedOptionIds: ["panoramic"] }] });
    expect(await run.call("skill.search", { rootKpi: "Activity hours" })).toMatchObject({ ok: true, output: { candidates: [] } });
    run.store.appendChatMessage(run.runId, { role: "user", kind: "answer", text: "User answered the pending question.",
      answers: [{ questionId: "requested_output", fields: { output: "Carry forward the panoramic image result." } }] });
    expect(await run.call("skill.search", { rootKpi: "Activity hours" })).toMatchObject({
      ok: true, output: { candidates: [{ id }] }
    });
    run.store.appendChatMessage(run.runId, { role: "user", kind: "instruction", text: "Instead count digitized court recordings." });
    expect(await run.call("skill.search", { rootKpi: "Activity hours" })).toMatchObject({ ok: true, output: { candidates: [] } });
    expect(run.state().selectedSkills).toEqual([]);
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toBeFalsy();
    expect(run.builder.getProject()).toEqual(project);

    const legacy = skillRun({ skillResolution: undefined,
      input: { rootKpi: "Output", prompt: "Model how panoramic the displayed image remains after adjustment." } });
    expect(await legacy.call("skill.search", { rootKpi: "Displayed image" })).toMatchObject({
      ok: true, output: { candidates: [{ id: "generic.logical_kpi_decomposition", score: 1 }] }
    });
  });

  it("checks trusted scope after the catalog yield and before writing the reviewed Skill", async () => {
    let current = true;
    const assertScope = vi.fn(() => {
      if (!current) throw new AgentToolError("APPLE_SKILL_SCOPE_CHANGED", "Review the newer instruction.");
    });
    const run = skillRun({ workspace }, assertScope);
    await run.call("skill.list");
    const read = await run.call("skill.read", { skillId: excavation });
    expect(read.ok).toBe(true);
    const args = { skillId: excavation, readReceiptId: (read.output as { readReceiptId: string }).readReceiptId,
      reason: "The user described a production cut at the working face." };
    const stale = run.call("skill.select", args);
    expect(assertScope).not.toHaveBeenCalled();
    current = false;
    expect(await stale).toMatchObject({ ok: false, error: { code: "APPLE_SKILL_SCOPE_CHANGED" } });
    expect(run.state().selectedSkills).toEqual([]);
    expect(run.state().events.some(event => event.type === "skill_selected")).toBe(false);
    const repository = new LocalSkillRepository(dataDir);
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toBeFalsy();

    current = true;
    expect(await run.call("skill.select", args)).toMatchObject({ ok: true });
    expect(repository.getSelection(workspace.projectId, workspace.vdtId)).toMatchObject({ skillId: excavation, source: "agent" });
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
    expect(await provisional.call("vdt.add_driver", { parentNodeId: provisional.builder.getProject().rootNodeId, name: "Unauthorized stale method" }))
      .toMatchObject({ ok: false, error: { code: "SKILL_CONFLICT" } });
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

  it.each(["en", "ru"])("uses the read non-mining method and its exact receipt (%s)", async (locale) => {
    const repository = new LocalSkillRepository(dataDir);
    const definitions = [
      { id: "user.review_r742", title: "Caption desk acceptance accounting", description: "Accepted captions checked by the human desk.",
        instructions: "Count accepted captions in distinct live and correction queues. Subtract returned captions from checks within each queue. Exclude publication delivery." },
      { id: "user.publish_p306", title: "Caption publishing reconciliation", description: "Accepted captions in a publication delivery ledger.",
        instructions: "Count acceptance receipts by publishing destination. Exclude human review observations." }
    ];
    for (const skill of definitions) repository.files.create("", skill.id, skill.id, [
      "---", `id: ${skill.id}`, `title: ${skill.title}`, "version: 1", "domain: custom",
      `description: ${skill.description}`, "patterns:", "  - accepted captions", "kpi_patterns:", "  - Accepted captions",
      "requires:", "  - caption review queue", "outputs:", "  - accepted captions", "---", skill.instructions
    ].join("\n"));
    const prompt = locale === "ru" ? "Посчитай принятые субтитры по двум независимым очередям ручной проверки." :
      "Calculate accepted captions across two disjoint queues of human review.";
    const run = skillRun({ input: { prompt, rootKpi: "Accepted captions", unit: "1" } });
    const readCatalog = await run.call("skill.list");
    const offset = (readCatalog.output as { nextOffset?: number }).nextOffset;
    if (offset) await run.call("skill.list", { offset });
    const [chosen, distractor] = definitions;
    const read = await run.call("skill.read", { skillId: chosen!.id });
    const distractorRead = await run.call("skill.read", { skillId: distractor!.id });
    expect(read.ok, JSON.stringify(read.error)).toBe(true);
    expect(read.output).toMatchObject({ title: chosen!.title, excerpt: expect.stringContaining("Exclude publication delivery") });
    expect(distractorRead.output).toMatchObject({ title: distractor!.title });
    const readReceiptId = (read.output as { readReceiptId: string }).readReceiptId;
    const reason = locale === "ru" ? "Обе очереди проходят ручную проверку." : "Both queues go through desk review.";
    const select = { skillId: chosen!.id, readReceiptId, reason };
    expect(await run.call("skill.select", select)).toMatchObject({ ok: true });
    expect(await run.call("skill.select", select)).toMatchObject({ ok: true });
    const root = run.builder.getProject().rootNodeId;
    expect(await run.call("vdt.add_drivers_batch", {
      drivers: [["checked_live", 180], ["returned_live", 30], ["checked_corrections", 40], ["returned_corrections", 10]]
        .map(([nodeId, baselineValue]) => ({ parentNodeId: root, nodeId, baselineValue, name: nodeId, unit: "1" }))
    })).toMatchObject({ ok: true });
    const formula = await run.call("vdt.set_formula", { nodeId: root, formula: "checked_live - returned_live + checked_corrections - returned_corrections" });
    expect(formula.ok, JSON.stringify(formula.error)).toBe(true);
    const reopened = JSON.parse(JSON.stringify(run.builder.getProject()));
    expect(calculateGraph(reopened).rootValue).toBe(180);
    expect(calculateGraph(reopened, { overrides: [{ nodeId: "returned_corrections", value: 15 }] }).rootValue).toBe(175);
    const events = run.state().events;
    const selection = events.filter(event => event.type === "skill_selected");
    expect(selection).toHaveLength(1);
    expect(selection[0]?.metadata).toMatchObject({
      id: chosen!.id, methodTitle: chosen!.title, reason, version: 1, selectionId: expect.stringMatching(/^[a-f0-9]{64}$/),
      readReceiptId, contentHash: (read.output as { contentHash: string }).contentHash
    });
    expect(events.findIndex(event => event.type === "skill_selected"))
      .toBeLessThan(events.findIndex(event => event.metadata?.toolName === "vdt.add_drivers_batch"));
    expect(run.state().chatMessages.filter(message => message.kind === "status")).toHaveLength(1);
  });

  it.each(["accept_method", "decline_method"])("holds graph writes until the exact method choice is submitted: %s", async (choice) => {
    const run = skillRun({ skillResolution: { selectionRevision: 0, confirmationRequired: true } });
    await run.call("skill.list");
    const read = await run.call("skill.read", { skillId: excavation });
    const args = { skillId: excavation, readReceiptId: (read.output as { readReceiptId: string }).readReceiptId, reason: "It covers the face boundary." };
    const proposed = await run.call("skill.select", args);
    const question = run.state().pendingQuestions?.[0];
    expect(proposed.output).toMatchObject({ questions: [{ id: question?.id, options: expect.arrayContaining([expect.objectContaining({ id: choice })]) }] });
    expect(run.state().status).toBe("needs_user_input");
    const graphBefore = run.builder.getProject().graph;
    expect(await run.call("vdt.add_driver", { parentNodeId: run.builder.getProject().rootNodeId, name: "Added" }))
      .toMatchObject({ ok: false, error: { code: "SKILL_RESOLUTION_REQUIRED" } });
    expect(run.state().events.some(event => event.type === "skill_selected")).toBe(false);
    run.store.appendChatMessage(run.runId, { role: "user", kind: "answer", answers: [{ questionId: question!.id, selectedOptionIds: [choice] }] });
    run.store.updateRun(run.runId, { status: "running", pendingQuestions: undefined });
    const finalized = await run.call("skill.select", args);
    expect(run.builder.getProject().graph).toEqual(graphBefore);
    if (choice === "accept_method") expect(finalized).toMatchObject({ ok: true, output: { selectedSkill: { id: excavation } } });
    else {
      expect(finalized).toMatchObject({ ok: false, error: { code: "SKILL_METHOD_DECLINED" } });
      expect(await run.call("skill.report_gap", { reason: "Bypass attempt." }))
        .toMatchObject({ ok: false, error: { code: "SKILL_METHOD_CONFIRMATION_REQUIRED" } });
    }
  });

  it("requires complete paginated review and rejects an unrelated empty search before a genuine gap", async () => {
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
    const emptySearch = await run.call("skill.search", { rootKpi: "zzzxqz-nonexistent-process" });
    expect(emptySearch.output).toMatchObject({ candidates: [] });
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    const search = await run.call("skill.search", { rootKpi: "Truck cycle time", maxSkills: 1 });
    const { candidates } = search.output as { candidates: Array<{ id: string }> };
    expect(candidates).toHaveLength(1);
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    expect(await run.call("skill.read", { skillId: candidates[0]!.id })).toMatchObject({ ok: true });
    expect(await run.call("skill.report_gap", reason)).toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    expect(await run.call("skill.list", { offset: page.nextOffset })).toMatchObject({ ok: true, output: { nextOffset: null } });
    expect(await run.call("skill.report_gap", { reason: "These methods do not cover digitized archive name verification." }))
      .toMatchObject({ ok: true, output: { outcome: "no_applicable_skill" } });
    expect(run.state().selectedSkills).toEqual([]);
    expect(run.state().events.find((event) => event.metadata?.outcome === "no_applicable_skill")?.metadata).toMatchObject({
      catalogComplete: true, scopedSearchReviewed: true, searchCandidateIds: [candidates[0]!.id]
    });
  });
});
