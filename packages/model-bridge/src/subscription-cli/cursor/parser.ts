import { extractBoundedJson } from "../../safe-json";
import type { SubscriptionCliParseResult } from "../types";

export interface CursorStreamParseLimits {
  maxBytes: number;
  maxLines: number;
}

/** Aligns with local-runner EXECUTION_LIMITS defaults for stdout/line caps. */
export const DEFAULT_CURSOR_STREAM_PARSE_LIMITS: CursorStreamParseLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxLines: 100_000
});

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assistantText(event: Record<string, unknown>): string | undefined {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return undefined;
  const parts = message.content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
  return parts || undefined;
}

/**
 * Heuristic (per Cursor CLI docs):
 * - Ignore partial `assistant` deltas; prefer the terminal `result` event.
 * - When `result.result` contains JSON, parse it as the structured payload.
 * - Fall back to the raw `result` string when JSON extraction fails.
 */
export function parseCursorStreamJson(
  stdout: string,
  limits: CursorStreamParseLimits = DEFAULT_CURSOR_STREAM_PARSE_LIMITS
): SubscriptionCliParseResult {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(limits.maxLines) || limits.maxLines <= 0) {
    throw new Error("maxLines must be a positive integer.");
  }
  if (byteLength(stdout) > limits.maxBytes) {
    throw new Error(`Cursor stream output exceeds ${limits.maxBytes} bytes.`);
  }

  let lineCount = 0;
  let terminalResult: Record<string, unknown> | undefined;
  let terminalError: string | undefined;
  let lastAssistantText: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    lineCount += 1;
    if (lineCount > limits.maxLines) {
      throw new Error(`Cursor stream output exceeds ${limits.maxLines} lines.`);
    }
    if (byteLength(line) > limits.maxBytes) {
      throw new Error(`Cursor stream line exceeds ${limits.maxBytes} bytes.`);
    }

    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(event) || typeof event.type !== "string") continue;

    if (event.type === "assistant") {
      const text = assistantText(event);
      if (text) lastAssistantText = text;
      continue;
    }

    if (event.type === "error") {
      terminalError =
        typeof event.message === "string"
          ? event.message
          : typeof event.error === "string"
            ? event.error
            : "Cursor Agent reported an error event.";
      continue;
    }

    if (event.type === "done") {
      if (typeof event.error === "string") terminalError = event.error;
      continue;
    }

    if (event.type === "result") {
      terminalResult = event;
      if (event.is_error === true || event.subtype === "error") {
        terminalError =
          typeof event.result === "string" && event.result.trim()
            ? event.result
            : "Cursor Agent completed with an error result.";
      }
    }
  }

  if (terminalError) {
    return { output: undefined, error: terminalError };
  }

  if (!terminalResult) {
    if (lastAssistantText) {
      try {
        return { output: extractBoundedJson(lastAssistantText, limits.maxBytes), rawText: lastAssistantText };
      } catch {
        return { output: undefined, rawText: lastAssistantText, error: "Cursor stream ended without a terminal result event." };
      }
    }
    return { output: undefined, error: "Cursor stream did not contain a terminal result event." };
  }

  const rawText = typeof terminalResult.result === "string" ? terminalResult.result : undefined;
  if (!rawText?.trim()) {
    return { output: undefined, error: "Cursor result event did not include assistant text." };
  }

  try {
    return { output: extractBoundedJson(rawText, limits.maxBytes), rawText };
  } catch {
    return { output: rawText, rawText };
  }
}
