import { runRawDataDiscovery, type AnalyzeRawDatasetInput, type DataDiscoveryStructuredProvider } from "@vdt-studio/data-harness";
import { readProviderConfig } from "@/lib/ai-route-provider";
import { jsonError, readJsonObject } from "../../../vdt/storage-response";
import { AppleTransportError } from "@vdt-studio/local-runner/apple-foundation-models";
import { createAppleNativeDataProvider } from "../../../agent/runs/apple-native-data";
import { resolveAppleNativeTaskExecution } from "../../../agent/runs/apple-native-binding";
import { APPLE_NATIVE_PROVIDER_ID } from "../../../agent/runs/apple-native-host";
import { agentExecutionBindingRegistry } from "../../../agent/runs/runtime";
import { createTaskAiProvider, type TaskProviderPolicy, type TaskProviderRequest } from "../../../agent/runs/managed-ai-provider";
import { assertAppleSavedKpiScope, dataApiErrorResponse, readDataOwner, readIncomingKpiOptions, readProject, requireTarget } from "../../request-context";
import { checkAnalysisCancellation, DataApiError, withRetainedDatasetForAnalysis, requireDataId, saveDiscoveryRun } from "../../store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fileAnalysisPolicy: TaskProviderPolicy = {
  task: "file_analysis", completions: ["data_agent_decision", "analyze_raw_dataset", "review_dataset_proposal"]
};

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    // Unscoped legacy records remain accessible only in trusted local mode. New uploads are always scoped.
    const owner = readDataOwner(body, false);
    const datasetId = requireDataId(body.datasetId, "datasetId");
    const project = readProject(body.project, owner);
    return await withRetainedDatasetForAnalysis(datasetId, owner, request.signal, async (file) => {
      if (!file) return jsonError("Dataset file was not found. Choose a retained project source or upload the file again.", 404, "DATASET_NOT_FOUND");
      let entryContext = readEntryContext(body.entryContext);
      if (entryContext?.purpose === "incoming_kpis") {
        if (!owner) throw new DataApiError("File-based incoming KPIs require a persisted project and VDT.");
        entryContext.targetNodeId = requireTarget(project, entryContext.targetNodeId ?? body.targetNodeId);
      } else if (entryContext?.targetNodeId) requireTarget(project, entryContext.targetNodeId);
      const incomingKpiOptions = readIncomingKpiOptions(body.incomingKpiOptions);
      let verifyAppleScope: (() => void) | undefined;
      let provider: DataDiscoveryStructuredProvider | undefined;
      let providerModel: string | undefined;
      const appleSelected = body.providerId === APPLE_NATIVE_PROVIDER_ID;
      if (appleSelected) {
        if (!owner || entryContext?.purpose !== "incoming_kpis" || body.executionBindingId !== undefined || body.executionMode !== undefined || body.localHttpSelection !== undefined) {
          return jsonError("Apple file analysis requires a saved project, an incoming KPI, and one verified Local execution binding.", 400, "BINDING_CAPABILITY_DENIED");
        }
        const target = requireTarget(project, entryContext.targetNodeId);
        verifyAppleScope = () => assertAppleSavedKpiScope(owner, project, target);
        verifyAppleScope();
        // Host marker is retained with the run. readEntryContext admits no
        // caller-supplied marker, and recalculation preserves this object.
        const scopedContext = { ...entryContext, appleSavedScope: true };
        entryContext = scopedContext;
        try {
          const admitted = resolveAppleNativeTaskExecution(agentExecutionBindingRegistry, body as TaskProviderRequest, "file_analysis");
          const retainedXlsx = /\.xlsx$/iu.test(file.metadata.fileName)
            && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b && file.bytes[2] === 0x03 && file.bytes[3] === 0x04;
          provider = createAppleNativeDataProvider(admitted, verifyAppleScope, retainedXlsx);
          providerModel = admitted.pinned.identity.model;
        } catch (error) {
          if (error instanceof AppleTransportError) return jsonError(error.message, 409, `APPLE_DATA_${error.code.toUpperCase()}`);
          throw error;
        }
      } else if (body.providerId !== undefined || body.expectedExecution !== undefined || body.executionBindingId !== undefined
        || body.executionMode !== undefined || body.localHttpSelection !== undefined) {
        try {
          if (body.providerId === "openai_compatible" && body.expectedExecution === undefined && missingDirectOpenAiKey(body.providerConfig)) {
            return jsonError("Configure an OpenAI API key in Settings, or choose Analyze file locally.", 400, "DATA_DISCOVERY_PROVIDER_KEY_REQUIRED");
          }
          const configured = createTaskAiProvider(body as TaskProviderRequest, request.url, fileAnalysisPolicy);
          provider = {
            async completeStructured(params) {
              try { return await configured.completeStructured(params); }
              catch (error) {
                if (error instanceof TypeError && error.message === "fetch failed") {
                  throw new DataApiError("Could not reach the selected AI provider. Check its connection, or choose Analyze file locally.", 502, "DATA_DISCOVERY_PROVIDER_UNREACHABLE");
                }
                throw error;
              }
            }
          };
        } catch (error) {
          const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400;
          return jsonError(error instanceof Error ? error.message : "Data discovery provider could not be created.", status,
            (error as { code?: unknown }).code === "BINDING_CAPABILITY_DENIED" ? "BINDING_CAPABILITY_DENIED" : "DATA_DISCOVERY_PROVIDER_ERROR");
        }
      }
      if (!appleSelected) providerModel = readProviderModel(body.providerConfig);
      const snapshot = await runRawDataDiscovery({
        datasetId, file: file.metadata, bytes: file.bytes, project, signal: request.signal,
        ...(entryContext ? { entryContext } : {}),
        ...(incomingKpiOptions ? {
          incomingKpiOptions: appleSelected ? { ...incomingKpiOptions, confirmed: false } : incomingKpiOptions
        } : {}),
        ...(provider ? { provider } : {}),
        ...(appleSelected ? { limits: { maxModelCallsPerRun: 1 } } : {}),
        ...(providerModel ? { providerModel } : {})
      });
      if (owner) { snapshot.workspaceProjectId = owner.projectId; snapshot.vdtId = owner.vdtId; }
      checkAnalysisCancellation(request.signal);
      verifyAppleScope?.();
      await saveDiscoveryRun(snapshot, owner, project);
      return Response.json({ ok: true, runId: snapshot.runId, snapshot });
    });
  } catch (error) { return dataApiErrorResponse(error); }
}

function missingDirectOpenAiKey(value: unknown): boolean {
  const settings = readProviderConfig(value);
  const defaultUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? "https://api.openai.com/v1";
  const effectiveUrl = settings.baseUrl ?? defaultUrl;
  let origin: string;
  try { origin = new URL(effectiveUrl).origin; }
  catch { return false; } // The provider factory validates URL configuration.
  if (origin !== "https://api.openai.com") return false;
  const effectiveKey = effectiveUrl === defaultUrl ? settings.apiKey ?? process.env.OPENAI_COMPATIBLE_API_KEY : settings.apiKey;
  return !effectiveKey?.trim();
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
