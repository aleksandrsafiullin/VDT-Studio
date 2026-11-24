import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";
import { resolveSmartHostIdentity } from "@/lib/smart-kpi-host-identity";
import { SMART_KPI_FAILURE_REASONS } from "@/lib/smart-kpi-errors";
import { SMART_WEB_METADATA_TIMEOUT_MS } from "@/lib/smart-kpi-metadata";
import { smartRecord, smartString } from "@vdt-studio/vdt-core";
import { isModelReasoningValue } from "@vdt-studio/ai-harness/browser";

export async function POST(request: Request) {
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort();
  let timedOut = false;
  const expire = () => { timedOut = true; abort(); };
  let timer = setTimeout(expire, SMART_WEB_METADATA_TIMEOUT_MS);
  const headers = { "cache-control": "no-store" };
  try {
    const body: unknown = JSON.parse((await readAiRouteBody(request, SMART_HTTP_BODY_BYTES, { allowLocalHostReconstruction: true })).text);
    smartRecord(body, ["backendId", "model", "modelReasoning", "timeoutMs"], ["backendId"]);
    if (typeof body.backendId !== "string") throw Object.assign(new Error("A harness backend ID is required."), { code: "INVALID_PROVIDER" });
    if (body.model !== undefined) smartString(body.model, 160);
    if (body.modelReasoning !== undefined && !isModelReasoningValue(body.modelReasoning)) throw Object.assign(new Error("Invalid selected reasoning value."), { code: "INVALID_REASONING" });
    if (body.timeoutMs !== undefined) {
      if (typeof body.timeoutMs !== "number" || !Number.isSafeInteger(body.timeoutMs) || body.timeoutMs <= 0) throw Object.assign(new Error("Invalid metadata deadline."), { code: "INVALID_TIMEOUT" });
      clearTimeout(timer); timer = setTimeout(expire, Math.min(body.timeoutMs, SMART_WEB_METADATA_TIMEOUT_MS));
    }
    const identity = await resolveSmartHostIdentity(body.backendId as string, body.model as string | undefined, controller.signal, process.env, isModelReasoningValue(body.modelReasoning) ? body.modelReasoning : undefined);
    controller.signal.throwIfAborted();
    return Response.json({ ok: true, identity }, { headers });
  } catch (error) {
    const failure = error && typeof error === "object" && "code" in error ? String(error.code) : "SUGGESTIONS_UNAVAILABLE";
    const code = timedOut && failure !== "CLEANUP_UNCONFIRMED" ? "METADATA_TIMEOUT" : failure;
    const status = code === "METADATA_TIMEOUT" ? 504 : aiRouteGuardStatus(error)
      ?? (code === "REASONING_UNSUPPORTED" || code.startsWith("INVALID_") ? 422 : 503);
    const message = SMART_KPI_FAILURE_REASONS[code] ?? "Selected execution identity is unavailable.";
    return Response.json({ ok: false, error: { code, message } }, { status, headers });
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
