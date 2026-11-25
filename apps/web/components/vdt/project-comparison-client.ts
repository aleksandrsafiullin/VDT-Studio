import type { VdtComparisonRecord } from "@vdt-studio/storage";
import { fetchStoredVdtRevisionState } from "@/lib/vdt-storage-client";

const endpoint = "/api/vdt/comparisons";

async function request<T>(url: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store", signal,
    ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const payload = await response.json() as T & { ok?: boolean; error?: { message?: string } };
  signal.throwIfAborted();
  if (!response.ok || payload.ok !== true) throw new Error(payload.error?.message ?? "Could not load the comparison.");
  return payload;
}

export async function listProjectComparisons(projectId: string, signal: AbortSignal): Promise<VdtComparisonRecord[]> {
  const { comparisons } = await request<{ comparisons: VdtComparisonRecord[] }>(`${endpoint}?${new URLSearchParams({ projectId })}`, signal);
  return comparisons.filter((row) => row.projectId === projectId);
}

export async function openProjectComparison(projectId: string, comparisonId: string, signal: AbortSignal): Promise<VdtComparisonRecord> {
  const { comparison } = await request<{ comparison: VdtComparisonRecord }>(`${endpoint}?${new URLSearchParams({ comparisonId })}`, signal);
  if (comparison?.projectId !== projectId || comparison.id !== comparisonId) throw new Error("That comparison is unavailable in this project.");
  return comparison;
}

// SQLite's comparison primary key collapses simultaneous writes for the same ordered revisions.
async function pairId(projectId: string, leftRevisionId: string, rightRevisionId: string): Promise<string> {
  const key = new TextEncoder().encode(JSON.stringify([projectId, leftRevisionId, rightRevisionId]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", key);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `comparison_pair_${hash}`;
}

export async function compareSavedVdts(projectId: string, leftVdtId: string, rightVdtId: string, signal: AbortSignal): Promise<VdtComparisonRecord> {
  if (!leftVdtId || !rightVdtId || leftVdtId === rightVdtId) throw new Error("Choose two different VDTs.");
  signal.throwIfAborted();
  const [left, right] = await Promise.all([fetchStoredVdtRevisionState(leftVdtId), fetchStoredVdtRevisionState(rightVdtId)]);
  signal.throwIfAborted();
  if (left.head.projectId !== projectId || right.head.projectId !== projectId || left.head.vdtId !== leftVdtId || right.head.vdtId !== rightVdtId) {
    throw new Error("Both VDTs must belong to this project.");
  }
  const leftRevisionId = left.head.activeRevisionId;
  const rightRevisionId = right.head.activeRevisionId;
  if (!leftRevisionId || !rightRevisionId) throw new Error("Save both VDTs before comparing them.");

  const matchesPair = (row: VdtComparisonRecord) => row.projectId === projectId &&
    row.leftVdtId === leftVdtId && row.rightVdtId === rightVdtId &&
    row.leftRevisionId === leftRevisionId && row.rightRevisionId === rightRevisionId;
  const existing = (await listProjectComparisons(projectId, signal)).find(matchesPair);
  if (existing) return existing;
  const comparisonId = await pairId(projectId, leftRevisionId, rightRevisionId);
  signal.throwIfAborted();
  let comparison: VdtComparisonRecord;
  try {
    ({ comparison } = await request<{ comparison: VdtComparisonRecord }>(
      endpoint, signal, { projectId, leftRevisionId, rightRevisionId, comparisonId }
    ));
  } catch (caught) {
    signal.throwIfAborted();
    // A concurrent writer, or a lost success response, can leave the pair saved.
    try {
      comparison = await openProjectComparison(projectId, comparisonId, signal);
    } catch {
      signal.throwIfAborted();
      throw caught;
    }
  }
  if (!comparison || !matchesPair(comparison)) throw new Error("The comparison did not match the selected revisions.");
  return comparison;
}
