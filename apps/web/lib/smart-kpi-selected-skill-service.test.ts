import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { buildKpiSuggestionContext, buildKpiSuggestionTaskInput, createSmartKpiMeasuredFixture } from "@vdt-studio/vdt-core";
import type { AiProvider } from "@vdt-studio/ai-harness";
vi.mock("./smart-kpi-skill-host", () => ({ assertCurrentSmartKpiSkill: vi.fn(async () => {}) }));
import { assertCurrentSmartKpiSkill } from "./smart-kpi-skill-host";
import { prepareSmartKpiResponse } from "./smart-kpi-service";
afterEach(() => vi.mocked(assertCurrentSmartKpiSkill).mockReset());

it("rejects an obsolete selected skill after inference without repair or another provider call", async () => {
  const content = "# Support time\nUse disjoint cause categories.";
  const selectedSkill = { id: "custom.support", title: "Support", version: 1, content, contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}` };
  const input = buildKpiSuggestionTaskInput(await buildKpiSuggestionContext(createSmartKpiMeasuredFixture(0), {
    workspaceId: `selected_skill_${crypto.randomUUID()}`, vdtId: "vdt", targetNodeId: "measured_output", period: { key: "2026", grain: "year" }, selectedSkill }));
  let finish!: (value: unknown) => void;
  const completeStructured = vi.fn(async () => new Promise(resolve => { finish = resolve; }));
  const pending = prepareSmartKpiResponse({ input, providerId: "local_runner", providerConfig: { backendId: "codex_subscription" } }, new AbortController().signal,
    "http://localhost:3000", { provider: async () => ({ completeStructured }) as unknown as AiProvider });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  vi.mocked(assertCurrentSmartKpiSkill).mockRejectedValue(Object.assign(new Error("Selected skill changed"), { code: "STALE_SKILL" }));
  finish({ status: "empty", rationale: "No matching definition.", groups: [], limitations: [] });
  await expect(pending).rejects.toMatchObject({ code: "STALE_SKILL" });
  expect(completeStructured).toHaveBeenCalledTimes(1); expect(assertCurrentSmartKpiSkill).toHaveBeenCalledTimes(2);
});
