import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRunStore, createDefaultToolRegistry, type AgentToolContext } from "@vdt-studio/vdt-agent-runtime";
import { VdtBuilderSession } from "@vdt-studio/vdt-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaStructuralSkillGap } from "./ollama-structural-skill-gap";

describe("the Ollama structural Supervisor Skill gap boundary", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "vdt-ollama-gap-"));
    vi.stubEnv("VDT_DATA_DIR", directory);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  function fixture(outcome: "structural_model" | "calculated_baseline" = "structural_model") {
    const store = new AgentRunStore();
    const builder = new VdtBuilderSession();
    builder.createDraft({ projectTitle: "Output", rootKpi: "Output" });
    const state = store.createRun({
      mode: "continue_project", providerId: "model_agent", outcome,
      input: { rootKpi: "Output", project: builder.getProject() }, skillResolution: { selectionRevision: 0 }
    });
    const { runId } = state;
    const context: AgentToolContext = {
      runId, store, builder, signal: state.abortController.signal,
      emit: event => store.appendEvent(runId, event),
      getRun: () => store.getSnapshot(runId),
      updateRun: patch => store.updateRun(runId, patch)
    };
    const scope = new OllamaStructuralSkillGap();
    const registry = scope.registry(createDefaultToolRegistry());
    const call = (name: string, args: object = {}) => registry.run(name, args, context);
    let resultNumber = 0;
    const present = (toolName: string, output: unknown, status = "succeeded", externalCallId = `result-${++resultNumber}`) => scope.present({
      type: "tool_results", batchId: externalCallId,
      results: [{ externalCallId, toolName, resultCode: "OK", status, payload: { output } }]
    });
    const observe = async (name: string, args?: object) => {
      const result = await call(name, args);
      expect(result.ok).toBe(true);
      present(name, result.output);
      return result.output;
    };
    const gap = () => call("skill.report_gap", { reason: "The reviewed catalog does not cover this process." });
    return { scope, builder, observe, gap, present, state: () => store.getState(runId) };
  }

  it("rejects a list-only gap without changing the draft or its revision, then accepts an exact empty search", async () => {
    const { builder, observe, gap, state } = fixture();
    const originalProject = builder.getProject();
    const revision = builder.getRevision();
    await observe("skill.list");
    await expect(gap()).resolves.toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    expect(state().request.skillResolution?.outcome).toBeUndefined();
    expect(builder.getProject()).toEqual(originalProject);
    expect(builder.getRevision()).toBe(revision);
    expect(await observe("skill.search", { rootKpi: "zzzxqz nonmatching" })).toEqual({ candidates: [] });
    await expect(gap()).resolves.toMatchObject({ ok: true, output: { outcome: "no_applicable_skill" } });
    expect(state().events.find(event => event.metadata?.outcome === "no_applicable_skill")?.metadata)
      .toMatchObject({ catalogComplete: true, scopedSearchReviewed: true });
    expect(builder.getRevision()).toBe(revision);
  });

  it("checks the union of scoped search results and only accepts an exact read identity", async () => {
    const { observe, present, gap } = fixture();
    await observe("skill.list");
    const listed = await observe("skill.search", { rootKpi: "Truck cycle time", maxSkills: 1 }) as {
      candidates: { id: string; version: number; contentHash: string }[];
    };
    expect(listed.candidates).toHaveLength(1);
    const candidate = listed.candidates[0]!;
    await observe("skill.search", { rootKpi: "zzzxqz nonmatching" });
    present("skill.read", { ...candidate, contentHash: "other-hash", readReceiptId: "old-receipt" });
    await expect(gap()).resolves.toMatchObject({ ok: false, error: { code: "SKILL_CATALOG_REVIEW_REQUIRED" } });
    await observe("skill.read", { skillId: candidate.id });
    await expect(gap()).resolves.toMatchObject({ ok: true, output: { outcome: "no_applicable_skill" } });
  });

  it("fences queued input and does not reuse a previous-scope successful search", async () => {
    const { scope, observe, present, gap } = fixture();
    await observe("skill.list");
    const old = await observe("skill.search", { rootKpi: "zzzxqz nonmatching" });
    const instruction = { type: "user_instruction", text: "Review handwritten records instead." } as const;
    scope.queue(instruction);
    await expect(gap()).resolves.toMatchObject({ ok: false });
    scope.present({ type: "human_input", input: instruction });
    present("skill.search", old, "succeeded", "result-2");
    await expect(gap()).resolves.toMatchObject({ ok: false });
    await observe("skill.search", { rootKpi: "Handwritten record indexing" });
    await expect(gap()).resolves.toMatchObject({ ok: true });
  });

  it("preserves the existing gap behavior for a nonstructural Ollama run", async () => {
    const { observe, gap } = fixture("calculated_baseline");
    await observe("skill.list");
    await expect(gap()).resolves.toMatchObject({ ok: true, output: { outcome: "no_applicable_skill" } });
  });
});
