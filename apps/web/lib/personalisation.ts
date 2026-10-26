import { resolveAiPersonalisation, type InstructionPreferences } from "@vdt-studio/vdt-core";
import type { StoredProjectSummary } from "./vdt-storage-client";

export interface PersonalisationState {
  personalisation?: InstructionPreferences | undefined;
  workspace: { activeProjectId?: string | undefined; projectSummaries: StoredProjectSummary[] };
}

export function workspacePersonalisation(state: PersonalisationState) {
  return resolveAiPersonalisation(state.personalisation);
}
