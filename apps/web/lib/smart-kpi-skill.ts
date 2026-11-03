import type { KpiSuggestionSkill } from "@vdt-studio/vdt-core";
import { readBoundedText } from "@vdt-studio/ai-harness/browser";

export interface SmartKpiSkillState {
  workspaceId: string;
  vdtId: string;
  status: "loading" | "ready" | "unavailable";
  skill?: KpiSuggestionSkill;
  reason?: string;
}

export async function loadSmartKpiSkill(projectId: string, vdtId: string, rootKpi: string, signal?: AbortSignal): Promise<KpiSuggestionSkill> {
  const query = new URLSearchParams({ projectId, vdtId, rootKpi });
  const response = await fetch(`/api/ai/suggestions/skill?${query}`, { cache: "no-store", ...(signal ? { signal } : {}) });
  const result = JSON.parse(await readBoundedText(response, 192 * 1024, "Selected modelling skill", signal));
  if (!response.ok || !result.ok || !result.skill) throw new Error("The selected skill is unavailable. Choose a current skill in Context.");
  return result.skill as KpiSuggestionSkill;
}
