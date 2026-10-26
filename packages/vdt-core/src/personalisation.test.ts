import { describe, expect, it } from "vitest";
import { INSTRUCTION_TOTAL_LIMIT, normalizeInstructionPreferences, resolveAiPersonalisation, validAiPersonalisation, validInstructionPreferences } from "./personalisation";
import { buildKpiSuggestionContext, kpiSuggestionCacheKey } from "./suggestions/identity";
import { createSmartKpiMeasuredFixture } from "./suggestions/fixtures";
import { buildKpiSuggestionTaskInput, kpiSuggestionEnvelopeBytes } from "./suggestions/model-output";
import { KPI_SUGGESTION_LIMITS } from "./suggestions/types";

const preferences = (second = "Explain assumptions.") => ({ instructions: [
  { id: "language", enabled: true, text: "Reply in Russian." },
  { id: "assumptions", enabled: true, text: second },
  { id: "disabled", enabled: false, text: "Keep this text for later." }
] });

describe("multiple user instructions", () => {
  it("migrates the former single text once, preserving its disabled state", () => {
    const migrated = normalizeInstructionPreferences({ enabled: false, text: "  Reply in Russian.  " });
    expect(migrated).toEqual({ instructions: [{ id: "legacy-user-instruction", enabled: false, text: "Reply in Russian." }] });
    expect(normalizeInstructionPreferences(migrated)).toEqual(migrated);
    expect(resolveAiPersonalisation(migrated)).toEqual({});
    expect(normalizeInstructionPreferences({ enabled: true, text: "" })).toEqual({ instructions: [] });
  });

  it("combines enabled entries in order and keeps disabled text out of the prompt", () => {
    const saved = preferences();
    expect(resolveAiPersonalisation(saved)).toEqual({ userInstructions: "Reply in Russian.\n\nExplain assumptions." });
    expect(saved.instructions[2]?.text).toBe("Keep this text for later.");
    saved.instructions[1]!.enabled = false;
    expect(resolveAiPersonalisation(saved)).toEqual({ userInstructions: "Reply in Russian." });
  });

  it("rejects duplicate IDs, blank entries, oversized lists and combined text", () => {
    const saved = preferences();
    expect(validInstructionPreferences(saved)).toBe(true);
    expect(validInstructionPreferences({ instructions: [saved.instructions[0], saved.instructions[0]] })).toBe(false);
    expect(validInstructionPreferences({ instructions: [{ id: "blank", enabled: true, text: " " }] })).toBe(false);
    expect(validInstructionPreferences({ instructions: Array.from({ length: 21 }, (_, id) => ({ id: String(id), enabled: true, text: "Rule" })) })).toBe(false);
    expect(validInstructionPreferences({ instructions: [0, 1].map(id => ({ id: String(id), enabled: true, text: "x".repeat(1500) })) })).toBe(false);
    expect(validAiPersonalisation({ userInstructions: "x".repeat(INSTRUCTION_TOTAL_LIMIT + 1) })).toBe(false);
    expect(validAiPersonalisation({ userInstructions: "valid", systemPrompt: "override" })).toBe(false);
  });

  it("invalidates Smart identity when an enabled item changes, but ignores disabled edits and old project rules", async () => {
    const project = createSmartKpiMeasuredFixture();
    const options = { workspaceId: "owner", vdtId: null, targetNodeId: project.rootNodeId, period: { key: "2026", grain: "year" as const } };
    const first = await buildKpiSuggestionContext(project, { ...options, personalisation: resolveAiPersonalisation(preferences()) });
    const second = await buildKpiSuggestionContext(project, { ...options, personalisation: resolveAiPersonalisation(preferences("Cite data sources.")) });
    expect(buildKpiSuggestionTaskInput(first).context.personalisation).toEqual(resolveAiPersonalisation(preferences()));
    expect(second.contextHash).not.toBe(first.contextHash);
    expect(kpiSuggestionCacheKey(second, "catalog")).not.toBe(kpiSuggestionCacheKey(first, "catalog"));
    const disabledEdit = preferences(); disabledEdit.instructions[2]!.text = "Another disabled instruction.";
    const same = await buildKpiSuggestionContext(project, { ...options, personalisation: { ...resolveAiPersonalisation(disabledEdit), projectRules: "Retired project rule" } });
    expect(same.contextHash).toBe(first.contextHash);
    expect(same.personalisation).not.toHaveProperty("projectRules");
  });

  it("retains complete maximum-length Unicode instructions inside the Smart budget", async () => {
    const project = createSmartKpiMeasuredFixture();
    project.businessContext = "Business definitions. ".repeat(400);
    const saved = { instructions: [{ id: "first", enabled: true, text: "漢".repeat(1500) }, { id: "second", enabled: true, text: "界".repeat(1498) }] };
    const personalisation = resolveAiPersonalisation(saved);
    expect(personalisation.userInstructions?.length).toBe(INSTRUCTION_TOTAL_LIMIT);
    const context = await buildKpiSuggestionContext(project, { workspaceId: "owner", vdtId: null, targetNodeId: project.rootNodeId,
      period: { key: "2026", grain: "year" }, personalisation });
    expect(context.personalisation).toEqual(personalisation);
    expect(kpiSuggestionEnvelopeBytes(context)).toBeLessThanOrEqual(KPI_SUGGESTION_LIMITS.inputBytes);
  });
});
