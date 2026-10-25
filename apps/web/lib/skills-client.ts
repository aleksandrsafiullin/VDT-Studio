import type { SkillCard } from "@vdt-studio/vdt-agent";
import type { StoredSkillSelection } from "@vdt-studio/storage";
import { readBoundedText } from "@vdt-studio/ai-harness/browser";

export type { SkillCard };
export interface SkillDocument extends SkillCard { raw: string }
export interface SkillFileLibrary { rootPath: string; folders: string[]; issues: { path: string; message: string }[] }
export interface SkillLibraryResponse { skills: SkillCard[]; files: SkillFileLibrary }
export interface VdtSkillContext { skill: (SkillCard & { source: "auto" | "user" | "agent"; reason: string }) | null; selection?: StoredSkillSelection; needsReselection?: boolean; message?: string }

export async function skillRequest<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}), ...(body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  }) });
  const payload = JSON.parse(await readBoundedText(response, 512 * 1024, "Skills response", signal));
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "Skill operation could not complete.");
  return payload as T;
}

export const listSkills = () => skillRequest<SkillLibraryResponse>("/api/skills");
export const readSkill = (id: string, version?: number) => skillRequest<{ skill: SkillDocument }>(`/api/skills?${new URLSearchParams({ id, ...(version ? { version: String(version) } : {}) })}`);
export const getVdtSkillContext = (projectId: string, vdtId: string, rootKpi?: string) => skillRequest<VdtSkillContext>(`/api/skills/selection?${new URLSearchParams({ projectId, vdtId, ...(rootKpi?.trim() ? { rootKpi } : {}) })}`);
export const skillsChanged = () => window.dispatchEvent(new Event("vdt:skills-changed"));

export const NEW_SKILL_MARKDOWN = `---
name: new-skill
description: Describe the modelling approach and when to use it.
---

# New skill

## When to use

Describe the KPI and business context covered by this skill.

## Decomposition method

Describe the drivers, their relationships and formula templates.

## Required inputs

List the inputs, their units and time period. Keep project values out of the skill.

## Validation

Check formula references, units, double counting and assumptions.
`;
