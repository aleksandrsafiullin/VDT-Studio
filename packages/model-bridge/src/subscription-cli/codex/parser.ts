import { extractBoundedJson } from "../../safe-json";
import type { SubscriptionCliParseResult } from "../types";

export interface CodexExecParseLimits {
  maxBytes: number;
  maxLines: number;
}

export const DEFAULT_CODEX_EXEC_PARSE_LIMITS: CodexExecParseLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxLines: 100_000
});

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexStreamEvent(value: Record<string, unknown>): boolean {
  const type = value.type;
  return (
    type === "thread.started" ||
    type === "turn.started" ||
    type === "turn.completed" ||
    type === "turn.failed" ||
    type === "item.started" ||
    type === "item.updated" ||
    type === "item.completed" ||
    type === "error"
  );
}

function agentMessageText(item: Record<string, unknown>): string | undefined {
  const itemType = item.type ?? item.item_type;
  if (itemType !== "agent_message" && itemType !== "assistant_message") return undefined;
  return typeof item.text === "string" ? item.text : undefined;
}

function extractStructuredCandidate(value: Record<string, unknown>): unknown | undefined {
  if (isCodexStreamEvent(value)) return undefined;
  if ("ok" in value || "projectTitle" in value || "rootNodeId" in value) return value;
  return undefined;
}

/**
 * Parse Codex exec JSON output:
 * - Prefer structured final JSON objects emitted with --output-schema.
 * - Fall back to terminal agent_message text from JSONL item.completed events.
 * - Surface auth/quota errors from stream events and stderr heuristics.
 */
export function parseCodexExecJson(
  stdout: string,
  stderr: string,
  limits: CodexExecParseLimits = DEFAULT_CODEX_EXEC_PARSE_LIMITS
): SubscriptionCliParseResult {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(limits.maxLines) || limits.maxLines <= 0) {
    throw new Error("maxLines must be a positive integer.");
  }
  if (byteLength(stdout) > limits.maxBytes) {
    throw new Error(`Codex exec output exceeds ${limits.maxBytes} bytes.`);
  }

  const combinedError = `${stdout}\n${stderr}`.trim();
  if (/auth|login|sign[\s-]?in|not logged in/i.test(combinedError) && !/"ok"\s*:\s*true/.test(stdout)) {
    return { output: undefined, error: stderr.trim() || "Codex authentication required." };
  }
  if (/quota|usage limit|rate.?limit/i.test(combinedError) && !/"ok"\s*:\s*true/.test(stdout)) {
    return { output: undefined, error: stderr.trim() || "Codex usage limit reached." };
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return { output: undefined, error: stderr.trim() || "Codex exec produced no stdout." };
  }

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (isRecord(direct)) {
      const candidate = extractStructuredCandidate(direct);
      if (candidate !== undefined) return { output: candidate, rawText: trimmed };
    }
  } catch {
    // Continue with JSONL parsing.
  }

  let lineCount = 0;
  let terminalError: string | undefined;
  let lastAgentText: string | undefined;
  let lastStructured: unknown | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > limits.maxLines) {
      throw new Error(`Codex exec output exceeds ${limits.maxLines} lines.`);
    }
    if (byteLength(line) > limits.maxBytes) {
      throw new Error(`Codex exec line exceeds ${limits.maxBytes} bytes.`);
    }

    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;

    if (event.type === "error") {
      terminalError =
        typeof event.message === "string"
          ? event.message
          : typeof event.error === "string"
            ? event.error
            : "Codex exec reported an error event.";
      continue;
    }

    if (event.type === "turn.failed") {
      const nested = isRecord(event.error) && typeof event.error.message === "string" ? event.error.message : undefined;
      terminalError = nested ?? "Codex exec turn failed.";
      continue;
    }

    const structured = extractStructuredCandidate(event);
    if (structured !== undefined) {
      lastStructured = structured;
      continue;
    }

    if (event.type === "item.completed" && isRecord(event.item)) {
      const text = agentMessageText(event.item);
      if (text) lastAgentText = text;
    }
  }

  if (terminalError) return { output: undefined, error: terminalError };
  if (lastStructured !== undefined) {
    return { output: lastStructured, rawText: JSON.stringify(lastStructured) };
  }
  if (lastAgentText) {
    try {
      return { output: extractBoundedJson(lastAgentText, limits.maxBytes), rawText: lastAgentText };
    } catch {
      return { output: undefined, rawText: lastAgentText, error: "Codex agent message did not contain structured JSON." };
    }
  }

  try {
    return { output: extractBoundedJson(trimmed, limits.maxBytes), rawText: trimmed };
  } catch {
    return { output: undefined, error: stderr.trim() || "Codex exec output did not contain structured JSON." };
  }
}
