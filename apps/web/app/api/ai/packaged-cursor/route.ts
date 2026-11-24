import { CHAT_STARTER_LIMITS, validateChatStarterInput } from "@vdt-studio/vdt-core";
import { aiRouteGuardStatus, readAiRouteBody } from "@/lib/ai-route-body";
import { hasSameLocalOrigin } from "@/lib/local-request-origin";
import { standardPackagedCursorProfile } from "../../agent/runs/packaged-cursor-profile";

export const runtime = "nodejs";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  // The packaged HTTP host first verifies the one-use-bootstrap session
  // cookie, direct Host and fetch metadata before forwarding to Next.
  if (!hasSameLocalOrigin(request)) return json({ ok: false }, 403);

  let body: unknown;
  try {
    const { text } = await readAiRouteBody(request, CHAT_STARTER_LIMITS.requestBytes, { allowLocalHostReconstruction: true });
    body = JSON.parse(text);
  } catch (error) {
    return json({ ok: false }, aiRouteGuardStatus(error) ?? 400);
  }
  if (body && typeof body === "object" && "operation" in body && body.operation === "chat_starters") {
    const { model, input } = body as { model?: unknown; input?: unknown };
    if (Object.keys(body).some(key => !["operation", "model", "input"].includes(key))
      || (model !== undefined && (typeof model !== "string" || model.length > 160))) return json({ ok: false }, 400);
    let context;
    try {
      context = validateChatStarterInput(input);
    } catch {
      return json({ ok: false }, 400);
    }
    try {
      const { completePackagedCursorChatStarters } = await import("../../agent/runs/runtime");
      const result = await completePackagedCursorChatStarters(model, context, request.signal);
      return result
        ? json({ ok: true, result: { kind: "chat_starters", prompts: result.prompts } })
        : json({ ok: false, legacy: true }, 404);
    } catch {
      return json({ ok: false, message: "The managed Cursor connection could not generate questions." }, 503);
    }
  }

  if (!standardPackagedCursorProfile()) return json({ ok: false, legacy: true }, 404);
  if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !("operation" in body)
    || (body.operation !== "status" && body.operation !== "recheck" && body.operation !== "sign_in")) {
    return json({ ok: false }, 400);
  }

  const { refreshPackagedCursorConnection, signInPackagedCursor } = await import("../../agent/runs/runtime");
  try {
    const snapshot = body.operation === "sign_in"
      ? await signInPackagedCursor()
      : await refreshPackagedCursorConnection(body.operation === "recheck");
    return json({ ok: true, ...snapshot });
  } catch {
    return json({ ok: false, message: "Cursor sign-in could not be completed. Recheck the connection or retry Sign in." }, 409);
  }
}
