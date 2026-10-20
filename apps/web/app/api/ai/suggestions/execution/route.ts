import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";
import { resolveSmartCodexHostIdentity } from "@/lib/smart-kpi-host-identity";
import { smartRecord, smartString } from "@vdt-studio/vdt-core";

export async function POST(request: Request) {
  const controller = new AbortController(), abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true }); if (request.signal.aborted) abort();
  let timer = setTimeout(abort, 5_000); const headers = { "cache-control": "no-store" };
  try {
    const body: unknown = JSON.parse((await readAiRouteBody(request, SMART_HTTP_BODY_BYTES)).text);
    smartRecord(body, ["backendId", "model", "timeoutMs"], ["backendId"]);
    if (body.backendId !== "codex_subscription") throw new Error("Unsupported Smart identity backend.");
    if (body.model !== undefined) smartString(body.model, 160);
    if (body.timeoutMs !== undefined) {
      if (typeof body.timeoutMs !== "number" || !Number.isSafeInteger(body.timeoutMs) || body.timeoutMs <= 0) throw new Error("Invalid metadata deadline.");
      clearTimeout(timer); timer = setTimeout(abort, Math.min(body.timeoutMs, 5_000));
    }
    const identity = await resolveSmartCodexHostIdentity(body.model as string | undefined, controller.signal);
    return Response.json({ ok: true, identity }, { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SUGGESTIONS_UNAVAILABLE";
    return Response.json({ ok: false, error: { code, message: "Selected execution identity is unavailable." } }, { status: aiRouteGuardStatus(error) ?? 503, headers });
  } finally { clearTimeout(timer); request.signal.removeEventListener("abort", abort); }
}
