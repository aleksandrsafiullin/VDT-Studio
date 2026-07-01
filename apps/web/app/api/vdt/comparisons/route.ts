import { createHash, randomUUID } from "node:crypto";
import { compareVdtProjects } from "@vdt-studio/vdt-core";
import { assertSafeId } from "@vdt-studio/storage";
import { openVdtStorageDatabase } from "../storage-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompareRequestBody {
  projectId?: unknown;
  leftRevisionId?: unknown;
  rightRevisionId?: unknown;
  comparisonId?: unknown;
  summary?: unknown;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const comparisonId = url.searchParams.get("comparisonId");
  const projectId = url.searchParams.get("projectId");
  const database = openVdtStorageDatabase(process.cwd());
  try {
    if (comparisonId) {
      const parsed = parseSafeId(comparisonId, "comparisonId");
      if (!parsed.ok) return jsonError(parsed.message);
      const comparison = database.getComparison(parsed.value);
      if (!comparison) return jsonError("Comparison not found.", 404, "COMPARISON_NOT_FOUND");
      return Response.json({ ok: true, comparison });
    }

    const parsedProjectId = parseSafeId(projectId, "projectId");
    if (!parsedProjectId.ok) return jsonError(parsedProjectId.message);
    if (!database.getProject(parsedProjectId.value)) {
      return jsonError("Project not found.", 404, "PROJECT_NOT_FOUND");
    }
    return Response.json({
      ok: true,
      comparisons: database.listComparisons(parsedProjectId.value)
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT comparison lookup failed.", 500, "COMPARISON_LOOKUP_FAILED");
  } finally {
    database.close();
  }
}

export async function POST(request: Request) {
  let body: CompareRequestBody;
  try {
    body = await request.json() as CompareRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = parseCompareRequest(body);
  if (!parsed.ok) return jsonError(parsed.message);

  const database = openVdtStorageDatabase(process.cwd());
  try {
    const leftRevision = database.getVdtRevision(parsed.leftRevisionId);
    const rightRevision = database.getVdtRevision(parsed.rightRevisionId);
    if (!leftRevision || !rightRevision) {
      return jsonError("Both VDT revisions must exist.", 404, "REVISION_NOT_FOUND");
    }
    const leftVdt = database.getVdt(leftRevision.vdtId);
    const rightVdt = database.getVdt(rightRevision.vdtId);
    if (!leftVdt || !rightVdt || leftVdt.projectId !== parsed.projectId || rightVdt.projectId !== parsed.projectId) {
      return jsonError("Both VDT revisions must belong to the requested project.", 400, "PROJECT_MISMATCH");
    }

    const leftProject = database.readVdtRevision(leftRevision);
    const rightProject = database.readVdtRevision(rightRevision);
    const result = compareVdtProjects(leftProject, rightProject);
    const comparison = database.createComparison({
      id: parsed.comparisonId ?? comparisonId(parsed.leftRevisionId, parsed.rightRevisionId),
      projectId: parsed.projectId,
      leftVdtId: leftRevision.vdtId,
      rightVdtId: rightRevision.vdtId,
      leftRevisionId: leftRevision.id,
      rightRevisionId: rightRevision.id,
      result,
      summary: parsed.summary ?? defaultComparisonSummary(result.bottleneckCandidates.length)
    });

    return Response.json({ ok: true, comparison });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "VDT comparison failed.", 500, "COMPARISON_FAILED");
  } finally {
    database.close();
  }
}

function parseCompareRequest(body: CompareRequestBody):
  | {
      ok: true;
      projectId: string;
      leftRevisionId: string;
      rightRevisionId: string;
      comparisonId?: string | undefined;
      summary?: string | undefined;
    }
  | { ok: false; message: string } {
  const projectId = parseSafeId(body.projectId, "projectId");
  if (!projectId.ok) return projectId;
  const leftRevisionId = parseSafeId(body.leftRevisionId, "leftRevisionId");
  if (!leftRevisionId.ok) return leftRevisionId;
  const rightRevisionId = parseSafeId(body.rightRevisionId, "rightRevisionId");
  if (!rightRevisionId.ok) return rightRevisionId;
  const comparisonId = body.comparisonId === undefined ? undefined : parseSafeId(body.comparisonId, "comparisonId");
  if (comparisonId && !comparisonId.ok) return comparisonId;
  const summary = typeof body.summary === "string" && body.summary.trim()
    ? body.summary.trim().slice(0, 1_000)
    : undefined;
  return {
    ok: true,
    projectId: projectId.value,
    leftRevisionId: leftRevisionId.value,
    rightRevisionId: rightRevisionId.value,
    ...(comparisonId ? { comparisonId: comparisonId.value } : {}),
    ...(summary ? { summary } : {})
  };
}

function parseSafeId(value: unknown, label: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, message: `${label} is required.` };
  }
  try {
    return { ok: true, value: assertSafeId(value.trim(), label) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${label} is invalid.` };
  }
}

function comparisonId(leftRevisionId: string, rightRevisionId: string): string {
  const id = `comparison_${leftRevisionId}_${rightRevisionId}_${randomUUID()}`;
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return assertSafeId(`comparison_${hash}`, "comparisonId");
}

function defaultComparisonSummary(candidateCount: number): string {
  return `Compared VDT revisions and found ${candidateCount} bottleneck candidate${candidateCount === 1 ? "" : "s"}.`;
}

function jsonError(message: string, status = 400, code = "COMPARISON_REQUEST_ERROR") {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
