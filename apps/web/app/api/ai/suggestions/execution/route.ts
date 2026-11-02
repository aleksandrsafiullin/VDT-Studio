import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";
import { resolveSmartHostIdentity } from "@/lib/smart-kpi-host-identity";
import { smartRecord, smartString } from "@vdt-studio/vdt-core";
import { isModelReasoningValue } from "@vdt-studio/ai-harness/browser";

export async function POST(request: Request) {
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort();
  let timer = setTimeout(abort, 5_000); const headers = { "cache-control": "no-store" };
  try {
    const body: unknown = JSON.parse((await readAiRouteBody(request, SMART_HTTP_BODY_BYTES, { allowLocalHostReconstruction: true })).text);
    smartRecord(body, ["backendId", "model", "modelReasoning", "timeoutMs"], ["backendId"]);
    if (typeof body.backendId !== "string") throw new Error("A harness backend ID is required.");
    if (body.model !== undefined) smartString(body.model, 160);
    if (body.modelReasoning !== undefined && !isModelReasoningValue(body.modelReasoning)) throw Object.assign(new Error("Invalid selected reasoning value."), { code: "INVALID_REASONING" });
    if (body.timeoutMs !== undefined) {
      if (typeof body.timeoutMs !== "number" || !Number.isSafeInteger(body.timeoutMs) || body.timeoutMs <= 0) throw new Error("Invalid metadata deadline.");
      clearTimeout(timer); timer = setTimeout(abort, Math.min(body.timeoutMs, 5_000));
    }
    const identity = await resolveSmartHostIdentity(body.backendId as string, body.model as string | undefined, controller.signal, process.env, isModelReasoningValue(body.modelReasoning) ? body.modelReasoning : undefined);
    return Response.json({ ok: true, identity }, { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SUGGESTIONS_UNAVAILABLE";
    return Response.json({ ok: false, error: { code, message: "Selected execution identity is unavailable." } }, { status: aiRouteGuardStatus(error) ?? 503, headers });
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
