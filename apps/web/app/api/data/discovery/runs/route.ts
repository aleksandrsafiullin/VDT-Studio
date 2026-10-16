import { runRawDataDiscovery, type AnalyzeRawDatasetInput, type DataDiscoveryStructuredProvider } from "@vdt-studio/data-harness";
import type { AiRouteProviderRequest } from "@/lib/ai-route-provider";
import { jsonError, readJsonObject } from "../../../vdt/storage-response";
import { createManagedAwareAiProvider } from "../../../agent/runs/managed-ai-provider";
import { dataApiErrorResponse, readDataOwner, readIncomingKpiOptions, readProject, requireTarget } from "../../request-context";
import { DataApiError, readDatasetFile, requireDataId, saveDiscoveryRun } from "../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    // Unscoped legacy records remain accessible only in trusted local mode. New uploads are always scoped.
    const owner = readDataOwner(body, false);
    const datasetId = requireDataId(body.datasetId, "datasetId");
    const project = readProject(body.project, owner);
    const file = await readDatasetFile(datasetId, owner);
    if (!file) return jsonError("Dataset file was not found. Choose a retained project source or upload the file again.", 404, "DATASET_NOT_FOUND");
    const entryContext = readEntryContext(body.entryContext);
    if (entryContext?.purpose === "incoming_kpis") {
      if (!owner) throw new DataApiError("File-based incoming KPIs require a persisted project and VDT.");
      entryContext.targetNodeId = requireTarget(project, entryContext.targetNodeId ?? body.targetNodeId);
    } else if (entryContext?.targetNodeId) requireTarget(project, entryContext.targetNodeId);
    const incomingKpiOptions = readIncomingKpiOptions(body.incomingKpiOptions);
    let provider: DataDiscoveryStructuredProvider | undefined;
    if (typeof body.providerId === "string" && body.providerId.trim()) {
      try { provider = createManagedAwareAiProvider(body as AiRouteProviderRequest, request.url); }
      catch (error) {
        const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400;
        return jsonError(error instanceof Error ? error.message : "Data discovery provider could not be created.", status, "DATA_DISCOVERY_PROVIDER_ERROR");
      }
    }
    const providerModel = readProviderModel(body.providerConfig);
    const snapshot = await runRawDataDiscovery({
      datasetId, file: file.metadata, bytes: file.bytes, project,
      ...(entryContext ? { entryContext } : {}),
      ...(incomingKpiOptions ? { incomingKpiOptions } : {}),
      ...(provider ? { provider } : {}),
      ...(providerModel ? { providerModel } : {})
    });
    if (owner) { snapshot.workspaceProjectId = owner.projectId; snapshot.vdtId = owner.vdtId; }
    await saveDiscoveryRun(snapshot, owner, project);
    return Response.json({ ok: true, runId: snapshot.runId, snapshot });
  } catch (error) { return dataApiErrorResponse(error); }
}

function readEntryContext(value: unknown): AnalyzeRawDatasetInput["entryContext"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataApiError("entryContext must be a JSON object.");
  const input = value as Record<string, unknown>;
  if (input.purpose !== undefined && input.purpose !== "incoming_kpis" && input.purpose !== "data_mapping") throw new DataApiError("The discovery purpose is invalid.");
  return {
    ...(typeof input.source === "string" ? { source: input.source.slice(0, 200) } : {}),
    ...(typeof input.cardName === "string" ? { cardName: input.cardName.slice(0, 200) } : {}),
    ...(input.targetNodeId === undefined ? {} : { targetNodeId: requireDataId(input.targetNodeId, "targetNodeId") }),
    ...(input.purpose === "incoming_kpis" || input.purpose === "data_mapping" ? { purpose: input.purpose } : {})
  };
}

function readProviderModel(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const model = (value as Record<string, unknown>).model;
  return typeof model === "string" && model.trim().length > 0 ? model.trim().slice(0, 160) : undefined;
}
