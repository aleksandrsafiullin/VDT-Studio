import { NextResponse } from "next/server";
import {
  isLocalRunnerConnectionFailure,
  localRunnerOfflineMessage,
  runAiTask,
  type RunAiTaskResult
} from "@vdt-studio/ai-harness";
import {
  AiRouteProviderError,
  createAiProvider,
  readLocalRunnerProviderConfig,
  readMaxTokens,
  type AiRouteProviderRequest
} from "@/lib/ai-route-provider";
import {
  assertRunTaskBodySize,
  parseRunTaskRequest,
  resolveRunTaskType,
  type RunTaskRequestBody
} from "./parse-run-task-request";

/**
 * Bounded AI task route for web-runnable VDT AI actions.
 * Tree generation remains on `/api/ai/generate-vdt`; schema-only planning runs through local-runner completions.
 */
export async function POST(request: Request) {
  let body: (RunTaskRequestBody & Record<string, unknown>) | undefined;
  let bodyText = "";

  try {
    try {
      bodyText = await request.text();
    } catch {
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
    assertRunTaskBodySize(bodyText, taskType);

    const { input } = parseRunTaskRequest(body);
    const maxTokens = readMaxTokens(body.providerConfig);
    const taskInput = maxTokens !== undefined ? { ...input, maxTokens } : input;

    const provider = createAiProvider(body as AiRouteProviderRequest, request.url);
    const result = await runAiTask(taskType, provider, taskInput);

    return NextResponse.json({ ok: true, result });
  } catch (error) {
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
        error.message.includes("must use /api/ai/generate-vdt") ||
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
      const runnerUrl =
        body?.providerId === "local_runner"
          ? readLocalRunnerProviderConfig(body.providerConfig, new URL(request.url).origin).runnerUrl
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
