import type { StateStorage } from "zustand/middleware";
import { kpiCanonicalJson } from "@vdt-studio/vdt-core";
import type { SaveStoredVdtRevisionInput } from "./vdt-storage-client";
import { compactSmartKpiStorage, expandSmartKpiStorage } from "./smart-kpi-storage-codec";

let persistenceProblem = false;
const unreadable = new Set<string>();
/** Browser quota errors must not throw after Zustand already published state.
 * Smart separately confirms its exact journal before dispatching a stored write. */
export const studioStateStorage: StateStorage = {
  getItem(name) {
    let value: string | null;
    try { value = globalThis.localStorage.getItem(name); }
    catch { persistenceProblem = true; return null; }
    if (value === null) return null;
    try { const expanded = expandSmartKpiStorage(value); unreadable.delete(name); return expanded; }
    catch { unreadable.add(name); persistenceProblem = true; return null; }
  },
  setItem(name, value) {
    if (unreadable.has(name)) { persistenceProblem = true; return; }
    try { globalThis.localStorage.setItem(name, value); persistenceProblem = false; }
    catch (error) {
      if ((error as { name?: string })?.name === "QuotaExceededError" || (error as { name?: string })?.name === "NS_ERROR_DOM_QUOTA_REACHED") {
        try {
          const compact = compactSmartKpiStorage(value);
          if (compact) { globalThis.localStorage.setItem(name, compact); persistenceProblem = false; return; }
        } catch { /* Keep the previously durable record and the current draft. */ }
      }
      persistenceProblem = true;
    }
  },
  removeItem(name) { try { globalThis.localStorage.removeItem(name); unreadable.delete(name); persistenceProblem = false; } catch { persistenceProblem = true; } }
};
export const studioStatePersistenceProblem = () => persistenceProblem;
export function smartKpiJournalPersisted(id: string, input?: SaveStoredVdtRevisionInput): boolean {
  try {
    const value = studioStateStorage.getItem("vdt-studio-state");
    if (typeof value !== "string") return false;
    const journal = JSON.parse(value)?.state?.smartKpiOperation;
    return journal?.id === id && (input ? journal.phase === "committing" && kpiCanonicalJson(journal.input) === kpiCanonicalJson(input) : journal.phase === "preparing");
  } catch { return false; }
}
