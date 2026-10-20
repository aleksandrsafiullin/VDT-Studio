import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";
import { cancelSmartKpiPreparation } from "@/lib/smart-kpi-service";
import { smartRecord, smartString } from "@vdt-studio/vdt-core";

export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const body: unknown = JSON.parse((await readAiRouteBody(request, SMART_HTTP_BODY_BYTES)).text);
    smartRecord(body, ["requestId"]); smartString(body.requestId, 160);
    const result = await cancelSmartKpiPreparation(body.requestId);
    return Response.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "PREPARATION_FAILED";
    return Response.json({ ok: false, error: { code, message: "Preparation cancellation could not be confirmed." } }, { status: aiRouteGuardStatus(error) ?? (code === "RUN_NOT_FOUND" ? 404 : 422), headers });
  }
}
