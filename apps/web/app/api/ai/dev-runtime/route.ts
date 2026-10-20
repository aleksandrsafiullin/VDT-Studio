import * as runtime from "@vdt-studio/local-runner/server-runtime";
import { NextResponse } from "next/server";
import { resolveVdtAppModeForRequest } from "@/lib/app-mode";
import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";

type RuntimeContext = ReturnType<typeof runtime.createLocalRuntimeContext>;

const runtimeGlobal = globalThis as typeof globalThis & {
  __vdtStudioDevelopmentRuntime?: RuntimeContext;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadRuntime() {
  runtimeGlobal.__vdtStudioDevelopmentRuntime ??= runtime.createLocalRuntimeContext();
  return { runtime, context: runtimeGlobal.__vdtStudioDevelopmentRuntime };
}

function jsonRuntimeResult(result: { statusCode: number; payload?: unknown }) {
  return NextResponse.json(result.payload ?? { ok: true }, { status: result.statusCode });
}

function normalizeRuntimeError(error: unknown) {
  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "DEV_RUNTIME_ERROR";
  const message = error instanceof Error ? error.message : "Development runtime failed.";
  return { statusCode, payload: { ok: false, error: { code, message } } };
}

export async function POST(request: Request) {
  if (resolveVdtAppModeForRequest(request) !== "development_web") {
    return NextResponse.json(
      { ok: false, error: "Development local runtime is only available in development_web mode." },
      { status: 404 }
    );
  }

  let body: unknown, bodyBytes = 0;
  try {
    const read = await readAiRouteBody(request); bodyBytes = read.bytes; body = JSON.parse(read.text);
  } catch (error) {
    const status = aiRouteGuardStatus(error);
    if (status) return NextResponse.json({ ok: false, error: "AI request admission failed." }, { status });
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "Request body must be an object." }, { status: 400 });
  }

  try {
    const { runtime, context } = loadRuntime();
    const operation = typeof body.operation === "string" ? body.operation : "";

    if (operation === "test") {
      const backendId = typeof body.backendId === "string" ? body.backendId.trim() : "";
      if (!backendId) {
        return NextResponse.json({ ok: false, error: "backendId is required." }, { status: 400 });
      }
      return jsonRuntimeResult(await runtime.checkRuntimeBackendReadiness(backendId, context));
    }

    if (operation === "complete") {
      if (isRecord(body.request) && body.request.taskType === "suggest_incoming_kpis" && bodyBytes > SMART_HTTP_BODY_BYTES) return NextResponse.json({ ok: false, error: "Smart request exceeds its bound." }, { status: 413 });
      return jsonRuntimeResult(await runtime.completeRuntime(runtime.parseCompletionPayload(body.request), context, request.signal));
    }

    if (operation === "list_models") {
      const backendId = typeof body.backendId === "string" ? body.backendId.trim() : "";
      if (!backendId) {
        return NextResponse.json({ ok: false, error: "backendId is required." }, { status: 400 });
      }
      return jsonRuntimeResult(await runtime.listRuntimeModels(backendId, context));
    }

    if (operation === "open_provider_auth") {
      const backendId = typeof body.backendId === "string" ? body.backendId.trim() : "";
      if (!backendId) {
        return NextResponse.json({ ok: false, error: "backendId is required." }, { status: 400 });
      }
      return jsonRuntimeResult(await runtime.openRuntimeProviderAuth(backendId, context));
    }

    if (operation === "cancel") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      return jsonRuntimeResult(await runtime.cancelRuntimeRequestWithAcknowledgement(requestId, context));
    }

    if (operation === "run") {
      const requestId = typeof body.requestId === "string" ? body.requestId : "";
      return jsonRuntimeResult(runtime.getRuntimeRun(requestId, context));
    }

    return NextResponse.json({ ok: false, error: `Unsupported operation: ${operation || "(missing)"}` }, { status: 400 });
  } catch (error) {
    return jsonRuntimeResult(normalizeRuntimeError(error));
  }
}
