import type { AiPersonalisation, InstructionPreferences, KpiSuggestionPeriod, VdtProject } from "@vdt-studio/vdt-core";
import { workspacePersonalisation } from "./personalisation";
import type { StoredProjectSummary } from "./vdt-storage-client";

export interface SmartKpiScopeState {
  personalisation?: InstructionPreferences;
  project: VdtProject;
  workspace: { activeProjectId?: string | undefined; activeVdtId?: string | undefined; projectSummaries: StoredProjectSummary[] };
}
export interface SmartKpiScope {
  personalisation?: AiPersonalisation;
  workspaceId: string;
  vdtId: string | null;
  period: KpiSuggestionPeriod;
  goal?: string;
  blockedReason?: string;
  periodWarning?: string;
}
const grains: Record<string, KpiSuggestionPeriod["grain"]> = {
  shift: "shift", "per shift": "shift", смена: "shift", посменно: "shift",
  day: "day", daily: "day", "per day": "day", день: "day", ежедневно: "day",
  week: "week", weekly: "week", "per week": "week", неделя: "week", еженедельно: "week",
  month: "month", monthly: "month", "per month": "month", месяц: "month", ежемесячно: "month",
  quarter: "quarter", quarterly: "quarter", "per quarter": "quarter", квартал: "quarter", ежеквартально: "quarter",
  year: "year", yearly: "year", annual: "year", annually: "year", "per year": "year", год: "year", ежегодно: "year"
};
const normalized = (text: string) => text.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");

/** Actual graph/record evidence only: the editor brief may be stale and its
 * historical monthly fallback cannot establish the calculation period. */
export function resolveSmartKpiScope(state: SmartKpiScopeState): SmartKpiScope {
  const owner = state.workspace.activeProjectId;
  const vdtId = state.workspace.activeVdtId ?? null;
  const summary = owner ? state.workspace.projectSummaries.find(s => s.project.id === owner) : undefined;
  const entry = summary?.vdts.find(e => e.vdt.id === vdtId);
  const root = state.project.graph.nodes.find(n => n.id === state.project.rootNodeId);
  const rootSources = [...new Set((root?.assumptions ?? []).filter(a => /^Time period:\s*/.test(a)).map(a => a.replace(/^Time period:\s*/, "").trim()).filter(Boolean))];
  const sources = [...rootSources, ...(entry?.vdt.timePeriod?.trim() ? [entry.vdt.timePeriod.trim()] : [])];
  const distinct = [...new Set(sources.map(s => grains[normalized(s)] ?? normalized(s)))];
  const text = rootSources[0] ?? entry?.vdt.timePeriod?.trim();
  const ambiguous = distinct.length > 1;
  const oversized = sources.some(s => s.length > 100);
  const grain = !ambiguous && !oversized && text ? grains[normalized(text)] ?? "custom" : "custom";
  const period: KpiSuggestionPeriod = {
    key: ambiguous ? `conflict:${sources.join(" | ")}`.slice(0, 120) : oversized ? "unspecified:period-source-too-long" : text ? `explicit:${text}` : "unspecified:no-period-source",
    grain
  };
  return {
    personalisation: workspacePersonalisation(state),
    workspaceId: (owner ?? `draft:${state.project.id}`).slice(0, 160), vdtId, period,
    ...(state.project.description?.trim() ? { goal: state.project.description.trim().slice(0, 1000) } : {}),
    ...(vdtId && (!owner || !entry || entry.vdt.projectId !== owner) ? { blockedReason: "Stored VDT ownership is unavailable. Refresh the workspace before applying Smart suggestions." } : {}),
    ...(grain === "custom" ? { periodWarning: ambiguous ? "The graph and stored period disagree. Formula replacement is unavailable until the period is reconciled."
      : "The analysis period is unspecified or custom. Suggestions can be added as context; formula replacement requires an explicit supported period." } : {})
  };
}
