import type { AiProvider, AiTaskType, LocalRunnerProviderConfig } from "../types";

export function localRunnerOfflineMessage(runnerUrl: string): string {
  const normalized = runnerUrl.replace(/\/$/, "");
  return `Local runner is offline at ${normalized}. Start it with pnpm local-runner:start (or pnpm dev:all) — see docs/LOCAL_RUNNER.md.`;
}

export function isLocalRunnerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message.startsWith("Local runner is offline")) {
    return true;
  }

  // Only classify fetch failures when the client could not reach local-runner itself.
  // Upstream provider errors (e.g. Ollama offline) arrive as normal Error messages from /run.
  if (!(error instanceof TypeError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const cause = error.cause;
  const causeMessage = cause instanceof Error ? cause.message.toLowerCase() : String(cause ?? "").toLowerCase();
  const causeCode =
    cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: string }).code ?? "") : "";

  return (
    message === "fetch failed" ||
    message.includes("econnrefused") ||
    causeMessage.includes("econnrefused") ||
    causeCode === "ECONNREFUSED" ||
    causeCode === "ENOTFOUND"
  );
}

interface LocalRunnerRunResponse {
  ok: boolean;
  output?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

export class LocalRunnerProvider implements AiProvider {
  id = "local_runner";
  name = "Local Runner";
  type = "local_runner" as const;

  constructor(private readonly config: LocalRunnerProviderConfig) {}

  async completeStructured<TInput, TOutput>(params: {
    taskType: AiTaskType;
    input: TInput;
    schema: unknown;
    systemPrompt: string;
    userPrompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<TOutput> {
    const runnerUrl = this.config.runnerUrl.replace(/\/$/, "");
    let response: Response;

    try {
      response = await fetch(`${runnerUrl}/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          providerId: this.config.runnerProviderId,
          taskType: params.taskType,
          input: params.input,
          schema: params.schema,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
          model: params.model,
          providerConfig: this.config.providerConfig,
          timeoutSec: this.config.timeoutSec
        })
      });
    } catch (error) {
      if (isLocalRunnerConnectionFailure(error)) {
        throw new Error(localRunnerOfflineMessage(runnerUrl));
      }
      throw error;
    }

    const payload = (await response.json()) as LocalRunnerRunResponse;
    if (!response.ok || !payload.ok) {
      const detail = payload.error?.message ?? `status ${response.status}`;
      throw new Error(`Local runner request failed: ${detail}`);
    }
    if (payload.output === undefined) {
      throw new Error("Local runner response did not include structured output.");
    }

    return payload.output as TOutput;
  }
}
