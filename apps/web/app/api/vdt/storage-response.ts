import { createHash, randomUUID } from "node:crypto";
import { calculateGraph } from "@vdt-studio/vdt-core";
import type { ProjectRecord, VdtDatabase, VdtRecord } from "@vdt-studio/storage";
import { assertSafeId } from "@vdt-studio/storage";

export interface StoredVdtSummary {
  vdt: VdtRecord;
  revisionCount: number;
  nodeCount?: number | undefined;
  rootValue?: number | undefined;
  rootUnit?: string | undefined;
}

export interface StoredProjectSummary {
  project: ProjectRecord;
  counts: {
    vdts: number;
    revisions: number;
    conversations: number;
    agentRuns: number;
    mutationProposals: number;
    comparisons: number;
  };
  vdts: StoredVdtSummary[];
}

export function parseSafeId(value: unknown, label: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${label} is required.` };
  }
  try {
    return { ok: true, value: assertSafeId(value.trim(), label) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${label} is invalid.` };
  }
}

export function generatedSafeId(prefix: string, value: string): string {
  const hash = createHash("sha256").update(`${value}:${randomUUID()}`).digest("hex").slice(0, 12);
  const safeBody = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 72)
    .replace(/[_-]+$/, "") || "item";
  return assertSafeId(`${prefix}_${safeBody}_${hash}`, prefix);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function parseVdtStatus(value: unknown): VdtRecord["status"] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "draft" || value === "reviewed" || value === "approved" || value === "archived") return value;
  throw new Error("VDT status must be draft, reviewed, approved, or archived.");
}

export function buildStoredProjectSummary(database: VdtDatabase, project: ProjectRecord): StoredProjectSummary {
  const vdts = database.listVdts(project.id).map((vdt) => buildStoredVdtSummary(database, vdt));
  return {
    project,
    counts: {
      vdts: vdts.length,
      revisions: vdts.reduce((total, item) => total + item.revisionCount, 0),
      conversations: database.listConversations(project.id).length,
      agentRuns: database.listAgentRuns(project.id).length,
      mutationProposals: database.listProjectMutationProposals(project.id).length,
      comparisons: database.listComparisons(project.id).length
    },
    vdts
  };
}

function buildStoredVdtSummary(database: VdtDatabase, vdt: VdtRecord): StoredVdtSummary {
  const revisions = database.listVdtRevisions(vdt.id);
  const activeRevision = revisions.find((revision) => revision.id === vdt.activeRevisionId) ?? revisions.at(-1);
  if (!activeRevision) {
    return { vdt, revisionCount: revisions.length, rootUnit: vdt.unit };
  }

  try {
    const snapshot = database.readVdtRevision(activeRevision);
    const rootNode = snapshot.graph.nodes.find((node) => node.id === snapshot.rootNodeId);
    const calculation = calculateGraph(snapshot);
    return {
      vdt,
      revisionCount: revisions.length,
      nodeCount: snapshot.graph.nodes.length,
      rootValue: Number.isFinite(calculation.rootValue) ? calculation.rootValue : undefined,
      rootUnit: rootNode?.unit ?? vdt.unit
    };
  } catch {
    return { vdt, revisionCount: revisions.length, rootUnit: vdt.unit };
  }
}

export function jsonError(message: string, status = 400, code = "VDT_STORAGE_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
