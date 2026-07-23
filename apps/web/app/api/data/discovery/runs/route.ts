import { runRawDataDiscovery } from "@vdt-studio/data-harness";
import type { VdtProject } from "@vdt-studio/vdt-core";
import { createAiProvider, type AiRouteProviderRequest } from "@/lib/ai-route-provider";
import { jsonError, readJsonObject } from "../../../vdt/storage-response";
import { readDatasetFile, saveDiscoveryRun } from "../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Discovery run request could not be parsed.");
  }

  const datasetId = typeof body.datasetId === "string" ? body.datasetId.trim() : "";
  if (!datasetId) {
    return jsonError("datasetId is required.");
  }

  const project = readProject(body.project);
  if (!project) {
    return jsonError("A current VDT project snapshot is required.");
  }

  const file = await readDatasetFile(datasetId);
  if (!file) {
    return jsonError("Dataset file was not found. Upload the file again.", 404, "DATASET_NOT_FOUND");
  }

  const entryContext = readEntryContext(body.entryContext);
  let provider: ReturnType<typeof createAiProvider> | undefined;
  if (typeof body.providerId === "string" && body.providerId.trim()) {
    try {
      provider = createAiProvider(body as AiRouteProviderRequest, request.url);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400;
      return jsonError(
        error instanceof Error ? error.message : "Data discovery provider could not be created.",
        status,
        "DATA_DISCOVERY_PROVIDER_ERROR"
      );
    }
  }
  const providerModel = readProviderModel(body.providerConfig);
  const snapshot = await runRawDataDiscovery({
    datasetId,
    file: file.metadata,
    bytes: file.bytes,
    text: file.textPreview,
    project,
    ...(entryContext ? { entryContext } : {}),
    ...(provider ? { provider } : {}),
    ...(providerModel ? { providerModel } : {})
  });
  await saveDiscoveryRun(snapshot);

  return Response.json({
    ok: true,
    runId: snapshot.runId,
    snapshot
  });
}

function readProject(value: unknown): VdtProject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<VdtProject>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.rootNodeId !== "string" ||
    !candidate.graph ||
    !Array.isArray(candidate.graph.nodes) ||
    !Array.isArray(candidate.graph.edges)
  ) {
    return undefined;
  }
  return candidate as VdtProject;
}

function readEntryContext(value: unknown):
  | { source?: string | undefined; cardName?: string | undefined; targetNodeId?: string | undefined }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = readOptionalString((value as Record<string, unknown>).source);
  const cardName = readOptionalString((value as Record<string, unknown>).cardName);
  const targetNodeId = readOptionalString((value as Record<string, unknown>).targetNodeId);
  return {
    ...(source ? { source } : {}),
    ...(cardName ? { cardName } : {}),
    ...(targetNodeId ? { targetNodeId } : {})
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readProviderModel(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const model = (value as Record<string, unknown>).model;
  return typeof model === "string" && model.trim().length > 0 ? model.trim().slice(0, 160) : undefined;
}
