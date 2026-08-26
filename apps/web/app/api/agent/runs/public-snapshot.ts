import { createHash } from "node:crypto";
import type {
  MutationProposal,
  VdtAgentRunSnapshot
} from "@vdt-studio/vdt-agent-runtime";

export const PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES = 256 * 1024;

export interface AppliedMutationHistoryEntry {
  id: string;
  status: "applied";
  title: string;
  summary: string;
  baseRevision: number;
  selectedChangeIds: string[];
  changeSet: MutationProposal["changeSet"];
  changeSetHash: string;
  previewProjectHash: string;
  createdAt: string;
  appliedAt?: string | undefined;
}

export type PublicAgentRunSnapshot = VdtAgentRunSnapshot & {
  appliedMutationHistory: AppliedMutationHistoryEntry[];
  snapshotProjection: {
    schemaVersion: 2;
    compact: true;
    targetBytes: number;
    omittedAppliedHistory: number;
  };
};

/** Public projection only. Full proposals/checkpoints remain in internal
 * persistence; the browser receives a full preview solely for the currently
 * pending approval. */
export function compactPublicAgentSnapshot(
  snapshot: VdtAgentRunSnapshot
): PublicAgentRunSnapshot {
  const terminalApplied = (snapshot.mutationProposals ?? [])
    .filter((proposal) => proposal.status === "applied")
    .map(appliedHistoryEntry);
  const compactEvents = snapshot.events.slice(-200).map(({ patch: _patch, ...event }) => ({
    ...event,
    metadata: redactSecrets(event.metadata) as Record<string, unknown> | undefined
  }));
  const request = snapshot.request.executionBindingId
    ? {
        ...snapshot.request,
        // Binding-based starts never echo server-owned provider settings. The
        // executionSummary is the authoritative read-only identity projection.
        providerConfig: undefined
      }
    : {
        ...snapshot.request,
        ...(snapshot.request.providerConfig
          ? { providerConfig: redactSecrets(snapshot.request.providerConfig) as Record<string, unknown> }
          : {})
      };
  let omittedAppliedHistory = 0;
  const output = {
    ...structuredClone(snapshot),
    request,
    events: compactEvents,
    chatMessages: snapshot.chatMessages.slice(-100),
    visibleContext: {
      ...snapshot.visibleContext,
      visibleMessages: snapshot.visibleContext.visibleMessages.slice(-50)
    },
    // The full active proposal already has one canonical public location:
    // pendingMutationProposal. Do not duplicate its preview in history.
    mutationProposals: undefined,
    appliedMutationHistory: terminalApplied,
    snapshotProjection: {
      schemaVersion: 2 as const,
      compact: true as const,
      targetBytes: PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES,
      omittedAppliedHistory
    }
  } satisfies PublicAgentRunSnapshot;

  if (jsonBytes(output) > PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES) {
    output.events = output.events.slice(-64);
    output.chatMessages = output.chatMessages.slice(-50);
    output.visibleContext.visibleMessages = output.visibleContext.visibleMessages.slice(-25);
  }
  if (
    jsonBytes(output) > PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES
    && output.project
    && output.draftProject
    && hashJson(output.project) === hashJson(output.draftProject)
  ) {
    output.project = undefined;
  }
  while (
    jsonBytes(output) > PUBLIC_AGENT_SNAPSHOT_TARGET_BYTES
    && output.appliedMutationHistory.length > 1
  ) {
    output.appliedMutationHistory.shift();
    omittedAppliedHistory += 1;
    output.snapshotProjection.omittedAppliedHistory = omittedAppliedHistory;
  }
  return output;
}

function appliedHistoryEntry(proposal: MutationProposal): AppliedMutationHistoryEntry {
  return {
    id: proposal.id,
    status: "applied",
    title: proposal.title,
    summary: proposal.summary,
    baseRevision: proposal.baseRevision,
    selectedChangeIds: [...proposal.selectedChangeIds],
    changeSet: structuredClone(proposal.changeSet),
    changeSetHash: hashJson(proposal.changeSet),
    previewProjectHash: hashJson(proposal.previewProject),
    createdAt: proposal.createdAt,
    ...(proposal.appliedAt ? { appliedAt: proposal.appliedAt } : {})
  };
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)])
  );
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      /api[_-]?key|token|authorization|password|secret/i.test(key)
        ? "[redacted]"
        : redactSecrets(entry)
    ])
  );
}
