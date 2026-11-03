import { type KpiSuggestionSkill, type KpiSuggestionContext, smartAssert } from "@vdt-studio/vdt-core";
import { getVdtSkill } from "../app/api/skills/service";

/** Reuse Context's exact pin; never infer a skill from a Smart target name. */
export async function readSmartKpiSkill(projectId: string, vdtId: string, rootKpi?: string): Promise<KpiSuggestionSkill> {
  const { pin } = await getVdtSkill(projectId, vdtId, rootKpi);
  return { id: pin.id, title: pin.title, version: pin.version, contentHash: pin.contentHash, content: pin.raw };
}

/** Admission and completion both observe the current selection. An immutable
 * old pin cannot become a current suggestion after a Context selection change. */
export async function assertCurrentSmartKpiSkill(context: KpiSuggestionContext): Promise<void> {
  if (!context.vdtId) return;
  const current = await readSmartKpiSkill(context.workspaceId, context.vdtId, context.root.name);
  const selected = context.selectedSkill;
  smartAssert(selected && selected.id === current.id && selected.version === current.version
    && selected.contentHash === current.contentHash && selected.content === current.content,
  "STALE_SKILL", "The selected modelling skill changed. Refresh Suggested KPI.");
}
