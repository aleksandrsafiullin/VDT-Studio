import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isCodingAgentId, runAgent, type CodingAgentId } from "@vdt-studio/cli";
import type { AiCompletionParams, AiProvider } from "@vdt-studio/ai-harness";

const MAX_CLI_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface LocalCliAiProviderConfig {
  agentId: string;
  model?: string | undefined;
  timeoutSec?: number | undefined;
}

function parseJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    }
    throw new Error("Local CLI response did not contain valid JSON.");
  }
}

async function executeCli(
  agentId: CodingAgentId,
  prompt: string,
  systemPrompt: string | undefined,
  model: string | undefined,
  timeoutSec: number
): Promise<{ messages: string[]; stdout: string }> {
  const isolatedCwd = await mkdtemp(path.join(os.tmpdir(), "vdt-studio-cli-"));
  const controller = new AbortController();
  const messages: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    for await (const event of runAgent(
      {
        agentId,
        prompt,
        cwd: isolatedCwd,
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(model ? { model } : {})
      },
      {
        signal: controller.signal,
        timeoutMs: timeoutSec * 1_000,
        maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
        allowedCwdRoots: [isolatedCwd],
        // Adapters that require non-interactive approval run only inside the empty temporary directory.
        allowDangerousPermissions: true
      }
    )) {
      if (event.type === "message" && event.role === "assistant") {
        messages.push(event.content);
      } else if (event.type === "stdout") {
        stdout.push(event.data);
      } else if (event.type === "stderr") {
        stderr.push(event.data);
      } else if (event.type === "tool-call") {
        controller.abort();
        throw new Error(`Local CLI attempted an unsupported tool call (${event.name}) while generating VDT JSON.`);
      } else if (event.type === "error") {
        const detail = stderr.join("").trim().slice(-500);
        throw new Error(detail ? `${event.error.message}: ${detail}` : event.error.message);
      }
    }

    const rawStdout = stdout.join("").trim();
    if (messages.length === 0 && !rawStdout) {
      throw new Error("Local CLI returned no assistant output.");
    }
    return { messages, stdout: rawStdout };
  } finally {
    controller.abort();
    await rm(isolatedCwd, { recursive: true, force: true });
  }
}

function parseCliJson(result: { messages: string[]; stdout: string }): unknown {
  const candidates = [
    ...[...result.messages].reverse(),
    result.messages.join("\n"),
    result.stdout
  ].filter((value) => value.trim().length > 0);
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return parseJsonValue(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Local CLI response did not contain valid JSON.");
}

export class LocalCliAiProvider implements AiProvider {
  id = "local_cli";
  name = "Local CLI";
  type = "cli" as const;
  private readonly agentId: CodingAgentId;
  private readonly model?: string | undefined;
  private readonly timeoutSec: number;

  constructor(config: LocalCliAiProviderConfig) {
    if (!isCodingAgentId(config.agentId)) {
      throw new Error(`Unknown Local CLI agent: ${config.agentId}`);
    }
    this.agentId = config.agentId;
    this.model = config.model;
    this.timeoutSec = Math.min(Math.max(config.timeoutSec ?? 120, 10), 900);
  }

  async completeStructured<TInput, TOutput>(params: AiCompletionParams<TInput>): Promise<TOutput> {
    const validator = params.schema as { parse?: (input: unknown) => TOutput };
    let repairMessage = "";
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt = [
        params.userPrompt,
        "Return only one JSON object matching the requested VDT contract. Do not wrap it in Markdown.",
        repairMessage
      ].filter(Boolean).join("\n\n");
      const result = await executeCli(
        this.agentId,
        prompt,
        params.systemPrompt,
        params.model ?? this.model,
        this.timeoutSec
      );

      try {
        const value = parseCliJson(result);
        return typeof validator?.parse === "function" ? validator.parse(value) : value as TOutput;
      } catch (error) {
        lastError = error;
        repairMessage = `Your previous JSON was invalid. Correct every schema issue and return the complete JSON again. Validation error: ${
          error instanceof Error ? error.message.slice(0, 1_500) : "unknown validation error"
        }`;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Local CLI returned invalid structured output.");
  }

  async testConnection(): Promise<void> {
    const result = await executeCli(
      this.agentId,
      'Return only this JSON object: {"ok":true}',
      "Do not use tools, inspect files, or modify the workspace.",
      this.model,
      Math.min(this.timeoutSec, 60)
    );
    const value = parseCliJson(result);
    if (!value || typeof value !== "object" || (value as { ok?: unknown }).ok !== true) {
      throw new Error("Local CLI responded, but did not return the expected connection-test JSON.");
    }
  }
}
