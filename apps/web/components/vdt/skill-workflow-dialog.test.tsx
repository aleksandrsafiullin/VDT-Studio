import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseFrontmatter } from "@vdt-studio/vdt-agent";
import { cloneProject, productionVolumeProject } from "@vdt-studio/vdt-core";
import { modelReasoningKey } from "@vdt-studio/ai-harness/browser";
import { DEFAULT_EXECUTION_SETTINGS, type ExecutionSettings } from "@/lib/execution-mode-catalog";
import { skillContextRootKpi, type VdtSkillContext } from "@/lib/skills-client";
import { skillAuthorTimeoutMs } from "@/lib/skill-author-deadline";
import type { SkillUpdateChange } from "@/lib/skill-workflow";
import { captureSkillAuthorRequest, formatSkillAuthorElapsed, newSkillWorkingMarkdown, observeSkillAuthorElapsed, revalidateSkillWorkflowContext, skillAuthorBudgetLabel, skillContextIdentity, skillDraftInstructions, SkillAuthorWaiting, SkillChangeReview, SkillWorkflowChoices } from "./skill-workflow-dialog";

vi.mock("./vdt-store", () => ({ useVdtStudioStore: vi.fn() }));
const { fetchContext, notifyContextChanged } = vi.hoisted(() => ({ fetchContext: vi.fn(), notifyContextChanged: vi.fn() }));
vi.mock("@/lib/skills-client", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/skills-client")>(), getVdtSkillContext: fetchContext, skillsChanged: notifyContextChanged
}));

const authored = `---
id: user.draft
title: "Source model"
description: "Old description"
domain: "custom"
version: 1
patterns:
  - "Revenue"
kpi_patterns:
  - "Revenue"
requires:
  - site_specific_inputs
outputs:
  - root_kpi
---

## Method

Multiply quantity and realized price. Check their period and units.
`;

function selected(): VdtSkillContext {
  return {
    skill: { id: "user.revenue", title: "Revenue", description: "Revenue modelling", domain: "custom", version: 2, contentHash: "sha256:base", folder: "revenue", source: "user", reason: "Selected in Context" },
    selection: { schemaVersion: "local_skill_selection.v1", revision: 3, skillId: "user.revenue", version: 2, contentHash: "sha256:base", source: "user", reason: "Selected in Context", rootKpi: "Revenue", updatedAt: "2026-11-03T00:00:00Z" }
  };
}

describe("Skill workflow review", () => {
  it("exports an independent portable identity with the user's metadata and exact edited instructions", () => {
    const instructions = `${skillDraftInstructions(authored)}\n## Checks\n\nConfirm that returns are counted once.`;
    const raw = newSkillWorkingMarkdown(authored, 'Выручка "магазина"', "Quantity × realized price", instructions);
    const parsed = parseFrontmatter(raw);
    expect(parsed.attributes.name).toBe("выручка-магазина");
    expect(parsed.attributes.title).toBe('Выручка "магазина"');
    expect(parsed.attributes.description).toBe("Quantity × realized price");
    expect(parsed.attributes.id).toBeUndefined();
    expect(parsed.attributes.version).toBeUndefined();
    expect(parsed.attributes.patterns).toEqual(["Revenue"]);
    expect(skillDraftInstructions(raw)).toBe(`${instructions.trim()}\n`);
  });

  it("does not reinterpret replacement tokens or discard a host-prepared topology on download", () => {
    const topology = '```vdt-topology\n{"rootFormula":"quantity * price"}\n```';
    const raw = newSkillWorkingMarkdown(authored.replaceAll("\n", "\r\n"), "Revenue $&", "Review $` and $' as literal text", `${skillDraftInstructions(authored)}\n${topology}`);
    expect(parseFrontmatter(raw).attributes.title).toBe("Revenue $&");
    expect(parseFrontmatter(raw).attributes.description).toBe("Review $` and $' as literal text");
    expect(raw).toContain(topology);
    expect(raw).not.toContain("id: user.draft");
  });

  it("keeps invalid names, empty instructions and oversized files out of save/download", () => {
    expect(() => newSkillWorkingMarkdown(authored, "!!!", "Description", skillDraftInstructions(authored))).toThrow(/letters or numbers/);
    expect(() => newSkillWorkingMarkdown(authored, "Revenue\nInjected", "Description", skillDraftInstructions(authored))).toThrow(/name/);
    expect(() => newSkillWorkingMarkdown(authored, "Revenue", "Description", "")).toThrow(/instructions/);
    expect(() => newSkillWorkingMarkdown(authored, "Revenue", "Description", "я".repeat(70_000))).toThrow(/128 KiB/);
    expect(() => skillDraftInstructions("Instructions without metadata")).toThrow(/metadata/);
  });

  it("invalidates a captured review when its pinned skill, revision or reselection state changes", () => {
    const original = selected(), identity = skillContextIdentity(original);
    expect(skillContextIdentity({ ...original, skill: { ...original.skill!, reason: "A clearer explanation" } })).toBe(identity);
    expect(skillContextIdentity({ ...original, selection: { ...original.selection!, revision: 4 } })).not.toBe(identity);
    expect(skillContextIdentity({ ...original, skill: { ...original.skill!, version: 3 } })).not.toBe(identity);
    expect(skillContextIdentity({ ...original, skill: { ...original.skill!, contentHash: "sha256:changed" } })).not.toBe(identity);
    expect(skillContextIdentity({ ...original, needsReselection: true })).not.toBe(identity);
    expect(skillContextIdentity(undefined)).not.toBe(identity);
  });

  it("refreshes a changed external selection before rejecting, allowing retry with the refreshed Context", async () => {
    const previous = selected(), fresh = { ...previous, selection: { ...previous.selection!, revision: 4 } };
    fetchContext.mockReset().mockResolvedValue(fresh); notifyContextChanged.mockClear();
    const input = { projectId: "project", vdtId: "tree", rootKpi: "Revenue", context: previous, stillCurrent: () => true };
    await expect(revalidateSkillWorkflowContext(input)).rejects.toThrow(/Context is refreshing/);
    expect(notifyContextChanged).toHaveBeenCalledOnce();
    await expect(revalidateSkillWorkflowContext({ ...input, context: fresh })).resolves.toBe(fresh);
    expect(notifyContextChanged).toHaveBeenCalledOnce();
  });

  it("checks an initially empty Context and preserves thematic creation when no skill exists", async () => {
    const empty: VdtSkillContext = { skill: null, needsReselection: true };
    fetchContext.mockReset().mockResolvedValue(empty); notifyContextChanged.mockClear();
    const input = { projectId: "project", vdtId: "tree", rootKpi: "Revenue", context: undefined, stillCurrent: () => true };
    await expect(revalidateSkillWorkflowContext(input)).rejects.toThrow(/Context is refreshing/);
    await expect(revalidateSkillWorkflowContext({ ...input, context: empty })).resolves.toBe(empty);
    expect(fetchContext).toHaveBeenCalledTimes(2);
    expect(notifyContextChanged).toHaveBeenCalledOnce();
    fetchContext.mockResolvedValue(selected());
    await expect(revalidateSkillWorkflowContext({ ...input, context: empty })).rejects.toThrow(/Context is refreshing/);
    expect(notifyContextChanged).toHaveBeenCalledTimes(2);
  });

  it("does not refresh an unrelated tree after a late Context response", async () => {
    fetchContext.mockReset().mockResolvedValue(selected()); notifyContextChanged.mockClear();
    await expect(revalidateSkillWorkflowContext({ projectId: "project", vdtId: "old-tree", rootKpi: "Revenue", context: undefined, stillCurrent: () => false })).rejects.toThrow(/tree changed/);
    expect(notifyContextChanged).not.toHaveBeenCalled();
  });

  it("uses the renamed graph root rather than a stale brief for both Context reads", async () => {
    const project = cloneProject(productionVolumeProject), staleBrief = "Original production";
    project.graph.nodes.find(node => node.id === project.rootNodeId)!.name = "Renamed production";
    const rootKpi = skillContextRootKpi(project, staleBrief), context = selected();
    fetchContext.mockReset().mockResolvedValue(context); notifyContextChanged.mockClear();
    await revalidateSkillWorkflowContext({ projectId: "project", vdtId: "tree", rootKpi, context, stillCurrent: () => true });
    expect(fetchContext).toHaveBeenCalledWith("project", "tree", "Renamed production");
    expect(rootKpi).not.toBe(staleBrief);
  });

  it("presents distinct new/update actions and makes unavailable updates non-actionable", () => {
    const html = renderToStaticMarkup(<SkillWorkflowChoices mode="create" canUpdate={false} onModeChange={() => undefined} />);
    expect(html).toContain("Save as new skill");
    expect(html).toContain("Update used skill");
    expect(html).toMatch(/<button[^>]*aria-pressed="true"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Update used skill/s);
  });

  it("shows the evidence, original passage and editable replacement for a selectable change", () => {
    const change: SkillUpdateChange = { id: "returns", title: "Account for returns", reason: "The tree now distinguishes gross and net quantity.", nodeIds: ["net_quantity"], before: "Use total quantity.", after: "Use net quantity after returns.", kind: "replace" };
    const html = renderToStaticMarkup(<SkillChangeReview change={change} selected disabled={false} nodes={[{ id: "net_quantity", name: "Net quantity" }]} onSelected={() => undefined} onEdit={() => undefined} onViewNode={() => undefined} />);
    expect(html).toContain('type="checkbox" checked=""');
    expect(html).toContain("The tree now distinguishes gross and net quantity.");
    expect(html).toContain("Use total quantity.");
    expect(html).toContain("Use net quantity after returns.");
    expect(html).toContain('aria-label="Proposed passage: Account for returns"');
    expect(html).toContain("Net quantity</button>");
    expect(html).not.toContain('readOnly=""');
  });

  it("keeps host formula changes read-only and unselected changes disabled for editing", () => {
    const change: SkillUpdateChange = { id: "host.topology", title: "Reusable formulas", reason: "Validated from the current tree.", nodeIds: [], before: "", after: '```vdt-topology\n{}\n```', kind: "topology" };
    const topology = renderToStaticMarkup(<SkillChangeReview change={change} selected disabled={false} nodes={[]} onSelected={() => undefined} onEdit={() => undefined} onViewNode={() => undefined} />);
    expect(topology).toContain('readOnly=""');
    expect(topology).toContain("Prepared from the tree’s validated formulas.");
    const ordinary = renderToStaticMarkup(<SkillChangeReview change={{ ...change, id: "guidance", kind: "add", after: "Check periods and units." }} selected={false} disabled={false} nodes={[]} onSelected={() => undefined} onEdit={() => undefined} onViewNode={() => undefined} />);
    expect(ordinary).toMatch(/<textarea[^>]*disabled=""/);
    expect(ordinary).not.toContain('checked=""');
  });
});

describe("Skill Author waiting feedback", () => {
  it("keeps the captured provider, model, reasoning and budget when settings change for the next request", () => {
    const settings: ExecutionSettings = { ...DEFAULT_EXECUTION_SETTINGS, executionMode: "local_cli", localRunnerPresetId: "ollama_openai", runnerProviderId: "local_http_stub", localModel: "qwen-original" };
    const initial = captureSkillAuthorRequest(settings, "tree").execution;
    const reasoningKey = modelReasoningKey(initial.providerId, initial.providerConfig ?? {});
    settings.modelReasoningBySource = { [reasoningKey]: "high" };
    const inFlight = captureSkillAuthorRequest(settings, "tree");
    settings.modelReasoningBySource[reasoningKey] = "low";
    Object.assign(settings, { executionMode: "byok", gatewayPresetId: "openai-default", byokProtocol: "openai", useMockProvider: false, model: "api-next-request", localModel: "qwen-next-request" });
    const next = captureSkillAuthorRequest(settings, "tree");
    expect(inFlight.execution).toMatchObject({ providerId: "local_runner", providerConfig: { model: "qwen-original", modelReasoning: "high" } });
    expect(inFlight.preparation).toMatchObject({ providerId: "local_runner", timeoutMs: 300_000 });
    expect(next.execution).toMatchObject({ providerId: "openai_compatible", providerConfig: { model: "api-next-request" } });
    expect(next.preparation).toMatchObject({ providerId: "openai_compatible", timeoutMs: 90_000 });
  });

  it.each([
    [0, "0:00"], [999, "0:00"], [1000, "0:01"], [90_500, "1:30"],
    [300_000, "5:00"], [3671_000, "61:11"], [-1000, "0:00"]
  ])("shows elapsed %i ms as %s", (elapsed, expected) => {
    expect(formatSkillAuthorElapsed(elapsed)).toBe(expected);
  });

  it("explains the captured local budget and keeps the live timer outside the status announcement", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    try {
      const preparation = { key: "captured-tree", providerId: "local_runner", startedAt: Date.now() - 95_000, timeoutMs: skillAuthorTimeoutMs("local_runner") };
      const html = renderToStaticMarkup(<SkillAuthorWaiting operation="create" preparation={preparation} onCancel={() => undefined} />);
      expect(html).toContain("Preparing a reusable skill…");
      expect(html).toContain("This can take up to 5 minutes.");
      expect(html).toContain('data-provider-id="local_runner"');
      expect(html).toContain('role="timer" aria-live="off">Elapsed 1:35</span>');
      expect(html.match(/<div role="status">([\s\S]*?)<\/div>/)?.[1]).not.toContain("Elapsed");
      expect(html).toContain("Cancel preparation</button>");
      expect(html).not.toContain("disabled=");
      expect(html).not.toContain("progressbar");
      expect(html).not.toContain("%");
    } finally { vi.useRealTimers(); }
  });

  it("uses the remote budget for update preparation", () => {
    const preparation = { key: "captured-tree", providerId: "openai_compatible", startedAt: Date.now(), timeoutMs: skillAuthorTimeoutMs("openai_compatible") };
    const html = renderToStaticMarkup(<SkillAuthorWaiting operation="update" preparation={preparation} onCancel={() => undefined} />);
    expect(html).toContain("Comparing the tree and skill…");
    expect(html).toContain("This can take up to 90 seconds.");
    expect(html).not.toContain("5 minutes");
    expect(skillAuthorBudgetLabel(preparation.timeoutMs)).toBe("90 seconds");
  });

  it("recomputes elapsed wall time and keeps observing beyond the host budget until cleaned up", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
    const startedAt = Date.now(), onElapsed = vi.fn(), cleanup = observeSkillAuthorElapsed(startedAt, onElapsed);
    try {
      expect(onElapsed).toHaveBeenLastCalledWith(0);
      vi.advanceTimersByTime(1000);
      expect(onElapsed).toHaveBeenLastCalledWith(1000);
      // A throttled tab resumes using actual wall time, not a tick counter.
      vi.setSystemTime(startedAt + 310_000);
      vi.advanceTimersByTime(1000);
      expect(onElapsed).toHaveBeenLastCalledWith(311_000);
      expect(vi.getTimerCount()).toBe(1);
      const calls = onElapsed.mock.calls.length;
      cleanup();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(300_000);
      expect(onElapsed).toHaveBeenCalledTimes(calls);
    } finally { cleanup(); vi.useRealTimers(); }
  });
});
