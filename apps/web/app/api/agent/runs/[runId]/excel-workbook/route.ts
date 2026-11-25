import { createExcelWorkbook, EXCEL_MIME_TYPE } from "@vdt-studio/vdt-core";
import { requireLocalFileRequest } from "../../../../data/request-context";
import { DataApiError } from "../../../../data/store";
import { openVdtStorageDatabase } from "../../../../vdt/storage-database";
import { jsonError, parseSafeId } from "../../../../vdt/storage-response";
import { ExcelWorkbookError, resolveSavedExcelWorkbook } from "../../excel-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  let db: ReturnType<typeof openVdtStorageDatabase> | undefined;
  try {
    requireLocalFileRequest(request);
    const query = new URL(request.url).searchParams;
    const run = parseSafeId((await params).runId, "runId");
    const revision = parseSafeId(query.get("revisionId"), "revisionId");
    const id = query.get("id");
    if (!run.ok || !revision.ok || !id || !/^excel_[a-f0-9]{64}$/.test(id)) {
      return jsonError("A valid saved Excel workbook link is required.", 400, "EXCEL_LINK_INVALID");
    }

    db = openVdtStorageDatabase(process.cwd());
    const record = db.getAgentRun(run.value);
    if (!record?.vdtId) {
      return jsonError("No saved VDT is available for this run.", 404, "EXCEL_REVISION_UNAVAILABLE");
    }
    const { descriptor, project } = resolveSavedExcelWorkbook(db, {
      runId: record.id,
      projectId: record.projectId,
      vdtId: record.vdtId,
      revisionId: revision.value,
      scenarioId: query.get("scenarioId")
    });
    if (id !== descriptor.id || query.get("scenarioId") !== descriptor.scenarioId) {
      return jsonError("The workbook link does not match this saved revision and scenario.", 404, "EXCEL_LINK_MISMATCH");
    }

    const bytes = createExcelWorkbook(project, descriptor.scenarioId);
    const filename = Array.from(descriptor.filename).map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\uFFFD" : char;
    }).join("");
    const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": EXCEL_MIME_TYPE,
        "Content-Disposition": `attachment; filename="VDT.xlsx"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof ExcelWorkbookError || error instanceof DataApiError) {
      return jsonError(error.message, error.status, error.code);
    }
    return jsonError("The Excel workbook could not be exported.", 500, "EXCEL_EXPORT_FAILED");
  } finally {
    db?.close();
  }
}
