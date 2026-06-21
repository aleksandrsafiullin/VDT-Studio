import { randomUUID } from "node:crypto";
import type { AiProvider, AiTaskType, LocalRunnerProviderConfig } from "../types";

export function localRunnerOfflineMessage(runnerUrl: string): string {
  const normalized = runnerUrl.replace(/\/$/, "");
  return `Local runner is offline at ${normalized}. Start it with vdt runner start and pair this browser session.`;
}

export function isLocalRunnerConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("Local runner is offline")) return true;
  if (!(error instanceof TypeError)) return false;
  const message = error.message.toLowerCase();
  const cause = error.cause;
  const causeMessage = cause instanceof Error ? cause.message.toLowerCase() : String(cause ?? "").toLowerCase();
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String(cause.code ?? "") : "";
  return message === "fetch failed" || message.includes("econnrefused") || causeMessage.includes("econnrefused") || causeCode === "ECONNREFUSED" || causeCode === "ENOTFOUND";
}

interface CompletionResponse {
  ok: boolean;
  output?: unknown;
  error?: { code?: string; message?: string };
}

const taskMap: Record<AiTaskType, string> = {
  generate_vdt: "generate_tree",
  deepen_node: "deepen_node",
  simplify_branch: "simplify_branch",
  suggest_alternative_decomposition: "suggest_alternative",
  review_model: "review_model",
  check_units: "check_units",
  suggest_formula: "suggest_formula",
  explain_node: "explain_node",
  generate_scenario_summary: "explain_scenario",
  generate_executive_summary: "generate_executive_summary"
};

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
    signal?: AbortSignal;
  }): Promise<TOutput> {
    const runnerUrl = this.config.runnerUrl.replace(/\/$/, "");
    const connectionTest = Boolean(params.input && typeof params.input === "object" && "probe" in params.input);
    let response: Response;
    try {
      response = await fetch(`${runnerUrl}/v1/completions`, {
        method: "POST",
        redirect: "error",
        ...(params.signal ? { signal: params.signal } : {}),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.pairingToken}`,
          origin: this.config.origin
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          backendId: this.config.backendId,
          taskType: taskMap[params.taskType],
          schemaId: connectionTest ? "connection-test-v1" : "generate-tree-v1",
          input: connectionTest
            ? { probe: true }
            : { data: params.input, systemPrompt: params.systemPrompt, userPrompt: params.userPrompt },
          ...(params.model ?? this.config.model ? { model: params.model ?? this.config.model } : {}),
          ...(this.config.timeoutMs ? { timeoutMs: this.config.timeoutMs } : {})
        })
      });
    } catch (error) {
      if (isLocalRunnerConnectionFailure(error)) throw new Error(localRunnerOfflineMessage(runnerUrl));
      throw error;
    }

    const payload = (await response.json()) as CompletionResponse;
    if (!response.ok || !payload.ok) {
      const detail = payload.error?.message ?? `status ${response.status}`;
      throw new Error(`Local runner request failed: ${detail}`);
    }
    if (payload.output === undefined) throw new Error("Local runner response did not include structured output.");
    return payload.output as TOutput;
  }
}
