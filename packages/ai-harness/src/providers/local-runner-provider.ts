import type { AiProvider, AiTaskType, LocalRunnerProviderConfig } from "../types";

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
    const response = await fetch(`${this.config.runnerUrl.replace(/\/$/, "")}/run`, {
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

    const payload = (await response.json()) as LocalRunnerRunResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? `Local runner failed with ${response.status}.`);
    }
    if (payload.output === undefined) {
      throw new Error("Local runner response did not include structured output.");
    }

    return payload.output as TOutput;
  }
}
