import type { StateStorage } from "zustand/middleware";
import { kpiCanonicalJson } from "@vdt-studio/vdt-core";
import type { SaveStoredVdtRevisionInput } from "./vdt-storage-client";

let persistenceProblem = false;
/** Browser quota errors must not throw after Zustand already published state.
 * Smart separately confirms its exact journal before dispatching a stored write. */
export const studioStateStorage: StateStorage = {
  getItem(name) { try { return globalThis.localStorage.getItem(name); } catch { persistenceProblem = true; return null; } },
  setItem(name, value) { try { globalThis.localStorage.setItem(name, value); persistenceProblem = false; } catch { persistenceProblem = true; } },
  removeItem(name) { try { globalThis.localStorage.removeItem(name); persistenceProblem = false; } catch { persistenceProblem = true; } }
};
export const studioStatePersistenceProblem = () => persistenceProblem;
export function smartKpiJournalPersisted(id: string, input?: SaveStoredVdtRevisionInput): boolean {
  try {
    const journal = JSON.parse(globalThis.localStorage.getItem("vdt-studio-state") ?? "null")?.state?.smartKpiOperation;
    return journal?.id === id && (input ? journal.phase === "committing" && kpiCanonicalJson(journal.input) === kpiCanonicalJson(input) : journal.phase === "preparing");
  } catch { return false; }
}
