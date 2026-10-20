import { prepareSmartKpiResponse, type SmartKpiServiceRequest } from "@/lib/smart-kpi-service";
import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";

/** Fixed small endpoint: streamed request cap applies before JSON materializes. */
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store", "content-type": "application/json" };
  try {
    const { text } = await readAiRouteBody(request, SMART_HTTP_BODY_BYTES);
    const result = await prepareSmartKpiResponse(JSON.parse(text) as SmartKpiServiceRequest, request.signal, request.url);
    return Response.json({ ok: true, result }, { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "PREPARATION_FAILED";
    // Never return upstream free-form text, request config or credentials.
    const status = aiRouteGuardStatus(error) ?? (code === "TIMEOUT" ? 504 : code === "SUGGESTIONS_UNAVAILABLE" ? 503 : code === "CANCELLED" ? 409 : 422);
    return Response.json({ ok: false, error: { code, message: code === "TIMEOUT" ? "Preparation timed out." : code === "SUGGESTIONS_UNAVAILABLE" ? "Selected execution is unavailable for suggestions." : "Suggestions could not be prepared." } }, { status, headers });
  }
}
