import { AppleTransportError } from "@vdt-studio/local-runner/apple-foundation-models";
import { createAppleNativeChatStarterProvider } from "../../agent/runs/apple-native-chat-starters";
import { APPLE_NATIVE_PROVIDER_ID } from "../../agent/runs/apple-native-host";
import { NextResponse } from "next/server";
import { prepareSmartKpiResponse } from "@/lib/smart-kpi-service";
import { readAiRouteBody, SMART_HTTP_BODY_BYTES, aiRouteGuardStatus } from "@/lib/ai-route-body";
import {
  isLocalRunnerConnectionFailure,
  localRunnerOfflineMessage,
  runAiTask,
  type RunAiTaskInputMap,
  type RunAiTaskResult
} from "@vdt-studio/ai-harness";
import { AiRouteProviderError, readMaxTokens } from "@/lib/ai-route-provider";
import { assertTaskProviderAdmission, createTaskAiProvider } from "../../agent/runs/managed-ai-provider";
import {
  assertRunTaskBodySize,
  parseRunTaskRequest,
  resolveRunTaskType,
  type RunTaskRequestBody,
  type RunTaskType
} from "./parse-run-task-request";

/**
 * Bounded AI task route for web-runnable VDT AI actions.
 * Tree generation is owned by `/api/agent/runs`; schema-only planning runs through local-runner completions.
 */
export async function POST(request: Request) {
  let body: (RunTaskRequestBody & Record<string, unknown>) | undefined;
  let bodyText = "";

  try {
    try {
      bodyText = (await readAiRouteBody(request, undefined, { allowLocalHostReconstruction: true })).text;
    } catch (error) {
      const status = aiRouteGuardStatus(error);
      if (status) return NextResponse.json({ ok: false, error: "AI request admission failed." }, { status });
      return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    }

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json({ ok: false, error: "Request body must be an object." }, { status: 400 });
    }

    body = parsedBody as RunTaskRequestBody & Record<string, unknown>;

    const taskType = resolveRunTaskType(body.taskType);
    if (taskType === "suggest_incoming_kpis" && new TextEncoder().encode(bodyText).byteLength > SMART_HTTP_BODY_BYTES) return NextResponse.json({ ok: false, error: "Smart request exceeds its bound." }, { status: 413 });
    assertRunTaskBodySize(bodyText, taskType);

    const { input } = parseRunTaskRequest(body);
    if (taskType === "suggest_incoming_kpis") {
      if (body.providerId !== APPLE_NATIVE_PROVIDER_ID) assertTaskProviderAdmission(body, { task: "suggested_kpi", completions: [taskType] });
      const result = await prepareSmartKpiResponse({
        input, providerId: String(body.providerId ?? ""),
        ...(body.providerConfig ? { providerConfig: body.providerConfig } : {}),
        ...(body.expectedExecution === undefined ? {} : { expectedExecution: body.expectedExecution })
      }, request.signal, request.url);
      return NextResponse.json({ ok: true, result: { kind: "suggestions", result } }, { headers: { "cache-control": "no-store" } });
    }
    if (body.providerId === APPLE_NATIVE_PROVIDER_ID) {
      if (taskType !== "suggest_chat_starters") throw new AppleTransportError("invalid_request");
      const provider = createAppleNativeChatStarterProvider(body);
      const result = await runAiTask(taskType, provider, { ...input, signal: request.signal } as RunAiTaskInputMap[typeof taskType]);
      return NextResponse.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
    }
    const maxTokens = readMaxTokens(body.providerConfig);
    const taskInput = { ...input, ...(maxTokens !== undefined ? { maxTokens } : {}), signal: request.signal };

    // Background starters must use the explicit connection without inheriting a
    // server API key or the main chat's reasoning preference.
    if (taskType === "suggest_chat_starters") {
      const apiKey = body.providerConfig?.apiKey;
      if (body.providerId !== "local_runner" && body.providerId !== "mock" && (typeof apiKey !== "string" || !apiKey.trim())) {
        return NextResponse.json({ ok: false, error: "A configured API key is required." }, { status: 400 });
      }
      if (body.providerConfig) {
        body.providerConfig = { ...body.providerConfig };
        for (const key of ["modelReasoning", "reasoningEffort", "thinkingBudget", "disableThinking", "adaptiveThinking"]) delete body.providerConfig[key];
      }
    }
    const provider = createTaskAiProvider(body, request.url, { task: "bounded_task", completions: [taskType] });
    const result = await runAiTask(taskType, provider, taskInput as RunAiTaskInputMap[Exclude<RunTaskType, "suggest_incoming_kpis">]);

    const response = NextResponse.json({ ok: true, result });
    if (taskType === "suggest_chat_starters") response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof AppleTransportError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 409 });
    if (error instanceof AiRouteProviderError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    if (
      error instanceof Error &&
      (error.message.includes("base URL") ||
        error.message.includes("Local runner URL") ||
        error.message.includes("local runner URLs") ||
        error.message.includes("provider URLs") ||
        error.message.includes("must also provide") ||
        error.message.includes("endpoint") ||
        error.message.includes("must be") ||
        error.message.includes("is required") ||
        error.message.includes("must use /api/agent/runs") ||
        error.message.includes("Unsupported taskType") ||
        error.message.includes("Request body must be") ||
        error.message.includes("input.project") ||
        error.message.includes("input."))
    ) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    if (error instanceof Error && (error.name === "ZodError" || error.message.startsWith("AI output"))) {
      return NextResponse.json(
        {
          ok: false,
          error: error.name === "ZodError" ? "AI response failed schema validation." : error.message
        },
        { status: 422 }
      );
    }

    if (error instanceof Error && isLocalRunnerConnectionFailure(error)) {
      const requestedRunnerUrl = body?.providerId === "local_runner" && typeof body.providerConfig?.pairingToken === "string"
        ? body.providerConfig.runnerUrl : undefined;
      const runnerUrl = typeof requestedRunnerUrl === "string" ? requestedRunnerUrl
        : (process.env.VDT_LOCAL_RUNNER_URL ?? "http://127.0.0.1:8765");
      return NextResponse.json(
        {
          ok: false,
          error: error.message.startsWith("Local runner is offline")
            ? error.message
            : localRunnerOfflineMessage(runnerUrl)
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message.replace(/OpenAI-compatible provider failed with \d+:.*/s, "OpenAI-compatible provider failed.")
            : "AI response could not be parsed."
      },
      { status: 502 }
    );
  }
}

export type RunTaskSuccessResponse = {
  ok: true;
  result: RunAiTaskResult;
};

export type RunTaskErrorResponse = {
  ok: false;
  error: string;
};
